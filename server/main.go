package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"
	"time"
)

//go:embed all:web
var embeddedWeb embed.FS

func main() {
	dataDir := envOrDefault("XYZ_DATA_DIR", "data")
	store, err := OpenStore(dataDir)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer store.Close()

	if seeded, err := ensureInitialPassword(
		context.Background(),
		store,
		strings.TrimSpace(os.Getenv("XYZ_ADMIN_PASSWORD")),
		envTrue("XYZ_ADMIN_PASSWORD_RESET"),
	); err != nil {
		log.Fatalf("initialize teacher password: %v", err)
	} else if seeded {
		log.Printf("教师密码已从环境变量初始化")
	}

	backupCtx, stopBackups := context.WithCancel(context.Background())
	defer stopBackups()
	backupManager := backupManagerFromEnv(store, dataDir)
	if backupManager != nil {
		backupManager.Start(backupCtx)
		log.Printf("自动备份目录：%s", backupManager.backupDir)
	}

	restartCh := make(chan struct{}, 1)
	updateManager := NewUpdateManager(dataDir)
	api := NewAPI(store, backupManager)
	api.SetUpdateManager(updateManager)
	api.SetRestartHandler(func() {
		select {
		case restartCh <- struct{}{}:
		default:
		}
	})

	mux := http.NewServeMux()
	api.Register(mux)
	mux.Handle("/", spaHandler(embeddedWeb))

	addr := envOrDefault("XYZ_ADDR", ":8787")
	server := &http.Server{
		Addr:              addr,
		Handler:           securityHeaders(requestLogger(mux)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      4 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("题场服务端已启动：http://127.0.0.1%s", displayPort(addr))
		log.Printf("数据目录：%s", dataDir)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case <-stop:
		log.Printf("收到停止信号")
	case <-restartCh:
		log.Printf("收到在线更新重启请求")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func spaHandler(files embed.FS) http.Handler {
	webFS, err := fs.Sub(files, "web")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(webFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		requestPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if requestPath == "" || requestPath == "." {
			requestPath = "index.html"
		}
		if _, statErr := fs.Stat(webFS, requestPath); statErr == nil {
			if strings.HasPrefix(requestPath, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		index, readErr := fs.ReadFile(webFS, "index.html")
		if readErr != nil {
			http.Error(w, "前端尚未构建，请运行 npm run server:build", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
		}
	})
}

func envOrDefault(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envTrue(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func displayPort(addr string) string {
	if strings.HasPrefix(addr, ":") {
		return addr
	}
	if index := strings.LastIndex(addr, ":"); index >= 0 {
		return addr[index:]
	}
	return ":8787"
}
