package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookieName   = "xyz_teacher"
	sessionLifetime     = 30 * 24 * time.Hour
	passwordIterations  = 210_000
	passwordSaltBytes   = 16
	passwordHashBytes   = 32
	minPasswordLength   = 8
	maxPasswordLength   = 128
	authMaxFailures     = 5
	authFailureWindow   = 10 * time.Minute
	authBlockDuration   = 5 * time.Minute
	authAttemptMaxItems = 500
)

type loginAttempt struct {
	failures     int
	windowStart  time.Time
	blockedUntil time.Time
	lastSeen     time.Time
}

type TeacherAuth struct {
	store    *Store
	now      func() time.Time
	mu       sync.Mutex
	attempts map[string]loginAttempt
}

func NewTeacherAuth(store *Store) *TeacherAuth {
	return &TeacherAuth{
		store:    store,
		now:      time.Now,
		attempts: map[string]loginAttempt{},
	}
}

func (auth *TeacherAuth) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/session", auth.handleSession)
	mux.HandleFunc("POST /api/auth/setup", auth.handleSetup)
	mux.HandleFunc("POST /api/auth/login", auth.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", auth.handleLogout)
}

func (auth *TeacherAuth) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authenticated, err := auth.isAuthenticated(r)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "验证教师登录状态失败", err)
			return
		}
		if !authenticated {
			writeError(w, http.StatusUnauthorized, "请先登录教师工作台", nil)
			return
		}
		if r.Method != http.MethodGet &&
			r.Method != http.MethodHead &&
			r.Header.Get("X-XYZ-Request") != "1" {
			writeError(w, http.StatusForbidden, "请求缺少安全标记", nil)
			return
		}
		if !sameOriginRequest(r) {
			writeError(w, http.StatusForbidden, "请求来源不正确", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (auth *TeacherAuth) handleSession(w http.ResponseWriter, r *http.Request) {
	credentialExists, err := auth.store.HasAdminCredential(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取教师登录配置失败", err)
		return
	}
	authenticated := false
	if credentialExists {
		authenticated, err = auth.isAuthenticated(r)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "验证教师登录状态失败", err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated":  authenticated,
		"setupRequired":  !credentialExists,
		"setupAllowed":   !credentialExists && localSetupAllowed(r),
		"sessionSeconds": int(sessionLifetime.Seconds()),
	})
}

func (auth *TeacherAuth) handleSetup(w http.ResponseWriter, r *http.Request) {
	if !localSetupAllowed(r) {
		writeError(w, http.StatusForbidden, "首次设置只能在这台服务器的本机浏览器完成", nil)
		return
	}
	exists, err := auth.store.HasAdminCredential(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取教师登录配置失败", err)
		return
	}
	if exists {
		writeError(w, http.StatusConflict, "教师密码已经设置，请直接登录", nil)
		return
	}
	password, err := readPasswordRequest(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := validatePassword(password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := setPassword(r.Context(), auth.store, password); err != nil {
		writeError(w, http.StatusInternalServerError, "保存教师密码失败", err)
		return
	}
	if err := auth.issueSession(w, r); err != nil {
		writeError(w, http.StatusInternalServerError, "创建教师登录会话失败", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (auth *TeacherAuth) handleLogin(w http.ResponseWriter, r *http.Request) {
	credentialExists, err := auth.store.HasAdminCredential(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取教师登录配置失败", err)
		return
	}
	if !credentialExists {
		writeError(w, http.StatusConflict, "请先在服务器本机设置教师密码", nil)
		return
	}

	clientKey := auth.clientKey(r)
	if retryAfter := auth.loginBlockedFor(clientKey); retryAfter > 0 {
		w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())))
		writeError(w, http.StatusTooManyRequests, "密码尝试次数过多，请稍后再试", nil)
		return
	}

	password, err := readPasswordRequest(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	credential, err := auth.store.GetAdminCredential(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取教师密码失败", err)
		return
	}
	derived := derivePassword(password, credential.Salt, credential.Iterations)
	if subtle.ConstantTimeCompare(derived, credential.Hash) != 1 {
		auth.recordLoginFailure(clientKey)
		writeError(w, http.StatusUnauthorized, "教师密码不正确", nil)
		return
	}

	auth.clearLoginFailures(clientKey)
	if err := auth.issueSession(w, r); err != nil {
		writeError(w, http.StatusInternalServerError, "创建教师登录会话失败", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (auth *TeacherAuth) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-XYZ-Request") != "1" || !sameOriginRequest(r) {
		writeError(w, http.StatusForbidden, "退出请求缺少安全标记", nil)
		return
	}
	if cookie, err := r.Cookie(sessionCookieName); err == nil && cookie.Value != "" {
		_ = auth.store.DeleteTeacherSession(r.Context(), hashSessionToken(cookie.Value))
	}
	auth.clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (auth *TeacherAuth) issueSession(w http.ResponseWriter, r *http.Request) error {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	expiresAt := auth.now().Add(sessionLifetime)
	if err := auth.store.CreateTeacherSession(
		r.Context(),
		hashSessionToken(token),
		expiresAt,
	); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/api",
		MaxAge:   int(sessionLifetime.Seconds()),
		HttpOnly: true,
		Secure:   secureRequest(r),
		SameSite: http.SameSiteStrictMode,
	})
	return nil
}

func (auth *TeacherAuth) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/api",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secureRequest(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func (auth *TeacherAuth) isAuthenticated(r *http.Request) (bool, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return false, nil
	}
	return auth.store.TeacherSessionValid(
		r.Context(),
		hashSessionToken(cookie.Value),
		auth.now(),
	)
}

func (auth *TeacherAuth) loginBlockedFor(key string) time.Duration {
	auth.mu.Lock()
	defer auth.mu.Unlock()
	attempt, exists := auth.attempts[key]
	if !exists {
		return 0
	}
	now := auth.now()
	if attempt.blockedUntil.After(now) {
		return attempt.blockedUntil.Sub(now)
	}
	return 0
}

func (auth *TeacherAuth) recordLoginFailure(key string) {
	auth.mu.Lock()
	defer auth.mu.Unlock()
	now := auth.now()
	attempt := auth.attempts[key]
	if attempt.windowStart.IsZero() || now.Sub(attempt.windowStart) > authFailureWindow {
		attempt = loginAttempt{windowStart: now}
	}
	attempt.failures++
	attempt.lastSeen = now
	if attempt.failures >= authMaxFailures {
		attempt.blockedUntil = now.Add(authBlockDuration)
	}
	auth.attempts[key] = attempt
	auth.pruneLoginAttemptsLocked(now)
}

func (auth *TeacherAuth) clearLoginFailures(key string) {
	auth.mu.Lock()
	defer auth.mu.Unlock()
	delete(auth.attempts, key)
}

func (auth *TeacherAuth) pruneLoginAttemptsLocked(now time.Time) {
	if len(auth.attempts) < authAttemptMaxItems {
		return
	}
	for key, attempt := range auth.attempts {
		if now.Sub(attempt.lastSeen) > authFailureWindow &&
			!attempt.blockedUntil.After(now) {
			delete(auth.attempts, key)
		}
	}
}

func (auth *TeacherAuth) clientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if isLoopbackHost(host) {
		for _, header := range []string{
			"CF-Connecting-IP",
			"X-Real-IP",
			"X-Forwarded-For",
		} {
			value := strings.TrimSpace(strings.Split(r.Header.Get(header), ",")[0])
			if value != "" {
				return value
			}
		}
	}
	return host
}

func readPasswordRequest(w http.ResponseWriter, r *http.Request) (string, error) {
	defer r.Body.Close()
	var request struct {
		Password string `json:"password"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return "", errors.New("密码请求格式不正确")
	}
	return request.Password, nil
}

func validatePassword(password string) error {
	if len(password) < minPasswordLength {
		return fmt.Errorf("密码至少需要 %d 个字符", minPasswordLength)
	}
	if len(password) > maxPasswordLength {
		return fmt.Errorf("密码不能超过 %d 个字符", maxPasswordLength)
	}
	return nil
}

func setPassword(ctx context.Context, store *Store, password string) error {
	salt := make([]byte, passwordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	hash := derivePassword(password, salt, passwordIterations)
	return store.SetAdminCredential(ctx, salt, hash, passwordIterations)
}

func ensureInitialPassword(
	ctx context.Context,
	store *Store,
	password string,
	reset bool,
) (bool, error) {
	if password == "" {
		return false, nil
	}
	if err := validatePassword(password); err != nil {
		return false, err
	}
	exists, err := store.HasAdminCredential(ctx)
	if err != nil {
		return false, err
	}
	if exists && !reset {
		return false, nil
	}
	if err := setPassword(ctx, store, password); err != nil {
		return false, err
	}
	return true, nil
}

func derivePassword(password string, salt []byte, iterations int) []byte {
	if iterations < 1 {
		iterations = passwordIterations
	}
	passwordBytes := []byte(password)
	block := make([]byte, len(salt)+4)
	copy(block, salt)
	block[len(block)-1] = 1

	mac := hmac.New(sha256.New, passwordBytes)
	_, _ = mac.Write(block)
	current := mac.Sum(nil)
	result := append([]byte(nil), current...)

	for iteration := 1; iteration < iterations; iteration++ {
		mac.Reset()
		_, _ = mac.Write(current)
		current = mac.Sum(nil)
		for index := range result {
			result[index] ^= current[index]
		}
	}
	return result[:passwordHashBytes]
}

func hashSessionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func secureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if strings.EqualFold(
		strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]),
		"https",
	) {
		return true
	}
	return strings.Contains(strings.ToLower(r.Header.Get("CF-Visitor")), `"scheme":"https"`)
}

func localSetupAllowed(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if !isLoopbackHost(host) {
		return false
	}
	if strings.TrimSpace(r.Header.Get("CF-Connecting-IP")) != "" {
		return false
	}
	if strings.TrimSpace(r.Header.Get("CF-Ray")) != "" {
		return false
	}
	if strings.TrimSpace(r.Header.Get("X-Forwarded-For")) != "" {
		return false
	}
	if strings.TrimSpace(r.Header.Get("X-Real-IP")) != "" {
		return false
	}
	return true
}

func isLoopbackHost(host string) bool {
	ip := net.ParseIP(strings.TrimSpace(host))
	return ip != nil && ip.IsLoopback()
}

func sameOriginRequest(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	if strings.EqualFold(parsed.Host, r.Host) {
		return true
	}
	originHost := parsed.Hostname()
	requestHost := r.Host
	if host, _, err := net.SplitHostPort(requestHost); err == nil {
		requestHost = host
	}
	return isLoopbackHost(originHost) && isLoopbackHost(requestHost)
}
