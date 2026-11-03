package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultBackupInterval = 24 * time.Hour
	defaultBackupKeep     = 30
)

type BackupManager struct {
	store      *Store
	backupDir  string
	interval   time.Duration
	keep       int
	mu         sync.Mutex
	lastBackup time.Time
}

type BackupInfo struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	SizeBytes  int64     `json:"sizeBytes"`
	ModifiedAt time.Time `json:"modifiedAt"`
}

func NewBackupManager(
	store *Store,
	backupDir string,
	interval time.Duration,
	keep int,
) *BackupManager {
	if interval < 15*time.Minute {
		interval = defaultBackupInterval
	}
	if keep < 1 {
		keep = defaultBackupKeep
	}
	return &BackupManager{
		store:     store,
		backupDir: backupDir,
		interval:  interval,
		keep:      keep,
	}
}

func (manager *BackupManager) Start(ctx context.Context) {
	go func() {
		manager.runDueBackup(ctx)
		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				manager.runDueBackup(ctx)
			}
		}
	}()
}

func (manager *BackupManager) runDueBackup(ctx context.Context) {
	if !manager.backupDue() {
		return
	}
	backupCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	backupPath, err := manager.Create(backupCtx)
	if err != nil {
		log.Printf("自动备份失败: %v", err)
		return
	}
	log.Printf("数据库备份完成: %s", backupPath)
}

func (manager *BackupManager) backupDue() bool {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if !manager.lastBackup.IsZero() {
		return time.Since(manager.lastBackup) >= manager.interval
	}
	latest, err := latestBackupTime(manager.backupDir)
	if err != nil {
		return true
	}
	manager.lastBackup = latest
	return latest.IsZero() || time.Since(latest) >= manager.interval
}

func (manager *BackupManager) Create(ctx context.Context) (string, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	if err := os.MkdirAll(manager.backupDir, 0o755); err != nil {
		return "", fmt.Errorf("创建备份目录: %w", err)
	}
	now := time.Now()
	baseName := "xyz-" + now.Format("20060102-150405")
	finalPath := filepath.Join(manager.backupDir, baseName+".db")
	if _, err := os.Stat(finalPath); err == nil {
		finalPath = filepath.Join(
			manager.backupDir,
			fmt.Sprintf("%s-%03d.db", baseName, now.Nanosecond()/1_000_000),
		)
	}
	tempPath := finalPath + ".tmp"
	_ = os.Remove(tempPath)

	if _, err := manager.store.db.ExecContext(ctx, `VACUUM INTO ?`, tempPath); err != nil {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("创建 SQLite 快照: %w", err)
	}
	if err := verifySQLiteFile(tempPath); err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("完成备份文件: %w", err)
	}
	manager.lastBackup = now
	if err := manager.rotate(); err != nil {
		return finalPath, err
	}
	return finalPath, nil
}

func (manager *BackupManager) rotate() error {
	entries, err := os.ReadDir(manager.backupDir)
	if err != nil {
		return fmt.Errorf("读取备份目录: %w", err)
	}
	type backupFile struct {
		name    string
		modTime time.Time
	}
	files := make([]backupFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() ||
			!strings.HasPrefix(entry.Name(), "xyz-") ||
			!strings.HasSuffix(entry.Name(), ".db") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, backupFile{name: entry.Name(), modTime: info.ModTime()})
	}
	sort.Slice(files, func(left, right int) bool {
		return files[left].modTime.After(files[right].modTime)
	})
	for index := manager.keep; index < len(files); index++ {
		path := filepath.Join(manager.backupDir, files[index].name)
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("删除旧备份 %s: %w", files[index].name, err)
		}
	}
	return nil
}

func (manager *BackupManager) List() ([]BackupInfo, error) {
	entries, err := os.ReadDir(manager.backupDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []BackupInfo{}, nil
		}
		return nil, err
	}
	backups := make([]BackupInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() ||
			!strings.HasPrefix(entry.Name(), "xyz-") ||
			!strings.HasSuffix(entry.Name(), ".db") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		backups = append(backups, BackupInfo{
			Name:       entry.Name(),
			Path:       filepath.Join(manager.backupDir, entry.Name()),
			SizeBytes:  info.Size(),
			ModifiedAt: info.ModTime(),
		})
	}
	sort.Slice(backups, func(left, right int) bool {
		return backups[left].ModifiedAt.After(backups[right].ModifiedAt)
	})
	return backups, nil
}

func (manager *BackupManager) Info(path string) (BackupInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return BackupInfo{}, err
	}
	return BackupInfo{
		Name:       filepath.Base(path),
		Path:       path,
		SizeBytes:  info.Size(),
		ModifiedAt: info.ModTime(),
	}, nil
}

func latestBackupTime(backupDir string) (time.Time, error) {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		if os.IsNotExist(err) {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}
	var latest time.Time
	for _, entry := range entries {
		if entry.IsDir() ||
			!strings.HasPrefix(entry.Name(), "xyz-") ||
			!strings.HasSuffix(entry.Name(), ".db") {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().After(latest) {
			latest = info.ModTime()
		}
	}
	return latest, nil
}

func verifySQLiteFile(path string) error {
	dsn := "file:" + filepath.ToSlash(path) + "?mode=ro&_busy_timeout=5000"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return fmt.Errorf("打开备份校验: %w", err)
	}
	defer db.Close()
	var result string
	if err := db.QueryRow(`PRAGMA quick_check`).Scan(&result); err != nil {
		return fmt.Errorf("校验备份数据库: %w", err)
	}
	if result != "ok" {
		return fmt.Errorf("备份数据库完整性检查失败: %s", result)
	}
	return nil
}

func backupManagerFromEnv(store *Store, dataDir string) *BackupManager {
	if envFalse("XYZ_BACKUP_ENABLED") {
		return nil
	}
	backupDir := strings.TrimSpace(os.Getenv("XYZ_BACKUP_DIR"))
	if backupDir == "" {
		backupDir = filepath.Join(dataDir, "backups")
	}
	intervalHours := envInt("XYZ_BACKUP_INTERVAL_HOURS", 24)
	keep := envInt("XYZ_BACKUP_KEEP", defaultBackupKeep)
	return NewBackupManager(
		store,
		backupDir,
		time.Duration(intervalHours)*time.Hour,
		keep,
	)
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envFalse(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "0", "false", "no", "off":
		return true
	default:
		return false
	}
}
