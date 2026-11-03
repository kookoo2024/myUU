package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultUpdateRepository = "kookoo2024/myUU"
	maxUpdateManifestBytes  = 256 << 10
	maxUpdateExecutableSize = 200 << 20
)

var updateVersionPattern = regexpMustCompileVersion()

type UpdateManager struct {
	repository    string
	current       string
	dataDir       string
	updateDir     string
	managed       bool
	enabled       bool
	releaseAPI    string
	downloadProxy string
	httpClient    *http.Client
	mu            sync.Mutex
	operationMu   sync.Mutex
	latest        *latestUpdate
	lastChecked   time.Time
}

type UpdateStatus struct {
	Enabled         bool   `json:"enabled"`
	Repository      string `json:"repository"`
	CurrentVersion  string `json:"currentVersion"`
	ManagedRunner   bool   `json:"managedRunner"`
	PreparedVersion string `json:"preparedVersion"`
	PendingVersion  string `json:"pendingVersion"`
	CanInstall      bool   `json:"canInstall"`
	LastCheckedAt   string `json:"lastCheckedAt"`
}

type UpdateCheck struct {
	UpdateStatus
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseURL      string `json:"releaseUrl"`
	PublishedAt     string `json:"publishedAt"`
	Notes           string `json:"notes"`
}

type preparedUpdate struct {
	Version     string `json:"version"`
	FileName    string `json:"fileName"`
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
	FromVersion string `json:"fromVersion"`
	PreparedAt  string `json:"preparedAt"`
}

type latestUpdate struct {
	Manifest  releaseManifest
	Release   githubRelease
	CheckedAt time.Time
}

type releaseManifest struct {
	Version string `json:"version"`
	Asset   string `json:"asset"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
	Notes   string `json:"notes"`
}

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	HTMLURL     string        `json:"html_url"`
	PublishedAt string        `json:"published_at"`
	Body        string        `json:"body"`
	Draft       bool          `json:"draft"`
	Prerelease  bool          `json:"prerelease"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

func NewUpdateManager(dataDir string) *UpdateManager {
	repository := strings.TrimSpace(os.Getenv("XYZ_UPDATE_REPO"))
	if repository == "" {
		repository = defaultUpdateRepository
	}
	enabled := !envFalse("XYZ_UPDATE_ENABLED")
	downloadProxy := strings.TrimSpace(os.Getenv("XYZ_UPDATE_DOWNLOAD_PROXY"))
	if downloadProxy == "" {
		downloadProxy = "https://gh-proxy.com/"
	}
	if downloadProxy == "-" || strings.EqualFold(downloadProxy, "off") {
		downloadProxy = ""
	}
	updateDir := filepath.Join(dataDir, "updates")
	return &UpdateManager{
		repository:    repository,
		current:       serverVersion,
		dataDir:       dataDir,
		updateDir:     updateDir,
		managed:       envTrue("XYZ_MANAGED_RUNNER"),
		enabled:       enabled,
		releaseAPI:    "https://api.github.com/repos/" + repository + "/releases/latest",
		downloadProxy: downloadProxy,
		httpClient: &http.Client{
			Timeout: 3 * time.Minute,
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
				ForceAttemptHTTP2:     true,
				TLSHandshakeTimeout:   10 * time.Second,
				ResponseHeaderTimeout: 30 * time.Second,
				ExpectContinueTimeout: time.Second,
			},
		},
	}
}

func (m *UpdateManager) Status() UpdateStatus {
	status := UpdateStatus{
		Enabled:        m != nil && m.enabled && runtime.GOOS == "windows",
		Repository:     defaultUpdateRepository,
		CurrentVersion: serverVersion,
	}
	if m == nil {
		return status
	}
	status.Repository = m.repository
	status.ManagedRunner = m.managed

	prepared, err := m.readPrepared()
	if err == nil && prepared.Version != "" {
		if updateFileExists(filepath.Join(m.updateDir, prepared.FileName)) {
			status.PreparedVersion = prepared.Version
		}
	}
	pending, err := m.readPending()
	if err == nil && pending.Version != "" {
		status.PendingVersion = pending.Version
	}
	m.mu.Lock()
	if !m.lastChecked.IsZero() {
		status.LastCheckedAt = m.lastChecked.UTC().Format(time.RFC3339)
	}
	m.mu.Unlock()

	status.CanInstall =
		status.Enabled &&
			status.ManagedRunner &&
			status.PreparedVersion != "" &&
			status.PendingVersion == "" &&
			isNewerVersion(status.PreparedVersion, status.CurrentVersion)
	return status
}

func (m *UpdateManager) Check(ctx context.Context) (UpdateCheck, error) {
	if m == nil || !m.enabled || runtime.GOOS != "windows" {
		return UpdateCheck{UpdateStatus: m.Status()}, errors.New("在线更新当前未启用")
	}
	latest, err := m.fetchLatest(ctx)
	if err != nil {
		return UpdateCheck{UpdateStatus: m.Status()}, err
	}
	return m.checkResult(latest), nil
}

func (m *UpdateManager) Download(ctx context.Context) (UpdateCheck, error) {
	if m == nil || !m.enabled || runtime.GOOS != "windows" {
		return UpdateCheck{UpdateStatus: m.Status()}, errors.New("在线更新当前未启用")
	}
	m.operationMu.Lock()
	defer m.operationMu.Unlock()
	latest, err := m.cachedOrFetchLatest(ctx)
	if err != nil {
		return UpdateCheck{UpdateStatus: m.Status()}, err
	}
	if !isNewerVersion(latest.Manifest.Version, m.current) {
		return m.checkResult(latest), errors.New("当前已经是最新版本")
	}
	asset, ok := findAsset(latest.Release.Assets, latest.Manifest.Asset)
	if !ok {
		return m.checkResult(latest), errors.New("发布中缺少更新程序文件")
	}
	if latest.Manifest.Size > 0 && asset.Size > 0 && latest.Manifest.Size != asset.Size {
		return m.checkResult(latest), errors.New("更新清单与发布文件大小不一致")
	}

	if err := os.MkdirAll(m.updateDir, 0o755); err != nil {
		return m.checkResult(latest), fmt.Errorf("创建更新目录失败：%w", err)
	}
	fileName := updateFileName(latest.Manifest.Version)
	targetPath := filepath.Join(m.updateDir, fileName)
	downloadErr := m.downloadWithFallback(ctx, asset.BrowserDownloadURL, targetPath, latest.Manifest)
	if downloadErr != nil {
		return m.checkResult(latest), downloadErr
	}
	prepared := preparedUpdate{
		Version:     latest.Manifest.Version,
		FileName:    fileName,
		SHA256:      strings.ToLower(latest.Manifest.SHA256),
		Size:        latest.Manifest.Size,
		FromVersion: m.current,
		PreparedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	if err := writeJSONAtomic(filepath.Join(m.updateDir, "prepared-update.json"), prepared); err != nil {
		return m.checkResult(latest), fmt.Errorf("保存更新准备信息失败：%w", err)
	}
	return m.checkResult(latest), nil
}

func (m *UpdateManager) downloadWithFallback(
	ctx context.Context,
	rawURL string,
	targetPath string,
	manifest releaseManifest,
) error {
	directCtx, cancelDirect := context.WithTimeout(ctx, 45*time.Second)
	directErr := m.downloadAndVerify(directCtx, rawURL, targetPath, manifest)
	cancelDirect()
	if directErr == nil {
		return nil
	}

	fallbackURL := proxyDownloadURL(m.downloadProxy, rawURL)
	if fallbackURL == "" || fallbackURL == rawURL {
		return directErr
	}
	if err := m.downloadAndVerify(ctx, fallbackURL, targetPath, manifest); err != nil {
		return fmt.Errorf("GitHub 下载失败（%v），备用镜像下载也失败：%w", directErr, err)
	}
	return nil
}

func proxyDownloadURL(proxyPrefix string, rawURL string) string {
	proxyPrefix = strings.TrimSpace(proxyPrefix)
	rawURL = strings.TrimSpace(rawURL)
	if proxyPrefix == "" || rawURL == "" {
		return ""
	}
	if proxyPrefix == "-" || strings.EqualFold(proxyPrefix, "off") {
		return ""
	}
	return strings.TrimRight(proxyPrefix, "/") + "/" + rawURL
}

func (m *UpdateManager) PrepareInstall() error {
	status := m.Status()
	if !status.Enabled {
		return errors.New("在线更新当前未启用")
	}
	if !status.ManagedRunner {
		return errors.New("当前服务不是由计划任务守护启动，无法安全自动替换")
	}
	m.operationMu.Lock()
	defer m.operationMu.Unlock()
	if status.PendingVersion != "" {
		return fmt.Errorf("版本 %s 已经在等待重启安装", status.PendingVersion)
	}
	prepared, err := m.readPrepared()
	if err != nil {
		return errors.New("尚未下载可安装的更新")
	}
	if !isNewerVersion(prepared.Version, m.current) {
		return errors.New("当前已经是最新版本")
	}
	fileName := filepath.Base(strings.TrimSpace(prepared.FileName))
	if fileName == "" || fileName == "." || fileName != prepared.FileName {
		return errors.New("更新文件名称不正确")
	}
	sourcePath := filepath.Join(m.updateDir, fileName)
	actualHash, size, err := fileSHA256(sourcePath)
	if err != nil {
		return errors.New("更新程序文件不存在，请重新下载")
	}
	if size != prepared.Size || actualHash != strings.ToLower(prepared.SHA256) {
		return errors.New("更新程序校验失败，请重新下载")
	}
	prepared.PreparedAt = time.Now().UTC().Format(time.RFC3339)
	if err := writeJSONAtomic(filepath.Join(m.updateDir, "pending-update.json"), prepared); err != nil {
		return fmt.Errorf("写入待安装标记失败：%w", err)
	}
	return nil
}

func (m *UpdateManager) fetchLatest(ctx context.Context) (*latestUpdate, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, m.releaseAPI, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", "xyz-classroom-arena/"+m.current)

	response, err := m.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("连接 GitHub 失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, errors.New("仓库还没有发布正式版本")
	}
	if response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusTooManyRequests {
		return nil, errors.New("GitHub 查询次数暂时受限，请稍后再试")
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub 返回异常状态：%d", response.StatusCode)
	}
	var release githubRelease
	if err := json.NewDecoder(io.LimitReader(response.Body, maxUpdateManifestBytes)).Decode(&release); err != nil {
		return nil, fmt.Errorf("读取 GitHub 发布信息失败：%w", err)
	}
	if release.Draft || release.Prerelease {
		return nil, errors.New("最新发布不是正式版本")
	}
	manifestAsset, ok := findAsset(release.Assets, "update.json")
	if !ok {
		return nil, errors.New("发布中缺少 update.json")
	}
	manifest, err := m.fetchManifest(ctx, manifestAsset.BrowserDownloadURL)
	if err != nil {
		return nil, err
	}
	if !updateVersionPattern.MatchString(manifest.Version) {
		return nil, errors.New("更新清单版本号格式不正确")
	}
	if tagVersion := strings.TrimPrefix(strings.TrimSpace(release.TagName), "v"); tagVersion != manifest.Version {
		return nil, errors.New("发布标签与更新清单版本不一致")
	}
	if manifest.Asset == "" || filepath.Base(manifest.Asset) != manifest.Asset {
		return nil, errors.New("更新清单中的程序文件名不正确")
	}
	if len(manifest.SHA256) != sha256.Size*2 {
		return nil, errors.New("更新清单缺少有效 SHA256")
	}
	if _, err := hex.DecodeString(manifest.SHA256); err != nil {
		return nil, errors.New("更新清单 SHA256 格式不正确")
	}
	if manifest.Size <= 0 || manifest.Size > maxUpdateExecutableSize {
		return nil, errors.New("更新程序大小异常")
	}

	latest := &latestUpdate{
		Manifest:  manifest,
		Release:   release,
		CheckedAt: time.Now().UTC(),
	}
	m.mu.Lock()
	m.latest = latest
	m.lastChecked = latest.CheckedAt
	m.mu.Unlock()
	return latest, nil
}

func (m *UpdateManager) cachedOrFetchLatest(ctx context.Context) (*latestUpdate, error) {
	m.mu.Lock()
	latest := m.latest
	m.mu.Unlock()
	if latest != nil {
		return latest, nil
	}
	return m.fetchLatest(ctx)
}

func (m *UpdateManager) fetchManifest(ctx context.Context, rawURL string) (releaseManifest, error) {
	var manifest releaseManifest
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return manifest, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "xyz-classroom-arena/"+m.current)
	response, err := m.httpClient.Do(request)
	if err != nil {
		return manifest, fmt.Errorf("下载更新清单失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return manifest, fmt.Errorf("下载更新清单返回异常状态：%d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxUpdateManifestBytes)).Decode(&manifest); err != nil {
		return manifest, fmt.Errorf("更新清单不是有效 JSON：%w", err)
	}
	return manifest, nil
}

func (m *UpdateManager) downloadAndVerify(
	ctx context.Context,
	rawURL string,
	targetPath string,
	manifest releaseManifest,
) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/octet-stream")
	request.Header.Set("User-Agent", "xyz-classroom-arena/"+m.current)
	response, err := m.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("下载更新程序失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("下载更新程序返回异常状态：%d", response.StatusCode)
	}

	tempPath := targetPath + ".part"
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("创建更新临时文件失败：%w", err)
	}
	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hasher), io.LimitReader(response.Body, maxUpdateExecutableSize+1))
	syncErr := file.Sync()
	closeErr := file.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("写入更新程序失败：%w", errors.Join(copyErr, syncErr, closeErr))
	}
	if written > maxUpdateExecutableSize || written != manifest.Size {
		_ = os.Remove(tempPath)
		return errors.New("下载的更新程序大小不正确")
	}
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if actualHash != strings.ToLower(manifest.SHA256) {
		_ = os.Remove(tempPath)
		return errors.New("下载的更新程序 SHA256 校验失败")
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("保存更新程序失败：%w", err)
	}
	return nil
}

func (m *UpdateManager) checkResult(latest *latestUpdate) UpdateCheck {
	status := m.Status()
	available := isNewerVersion(latest.Manifest.Version, status.CurrentVersion)
	return UpdateCheck{
		UpdateStatus:    status,
		LatestVersion:   latest.Manifest.Version,
		UpdateAvailable: available,
		ReleaseURL:      latest.Release.HTMLURL,
		PublishedAt:     latest.Release.PublishedAt,
		Notes:           truncateText(latest.Release.Body, 4000),
	}
}

func (m *UpdateManager) readPrepared() (preparedUpdate, error) {
	var prepared preparedUpdate
	err := readJSONFile(filepath.Join(m.updateDir, "prepared-update.json"), &prepared)
	return prepared, err
}

func (m *UpdateManager) readPending() (preparedUpdate, error) {
	var pending preparedUpdate
	err := readJSONFile(filepath.Join(m.updateDir, "pending-update.json"), &pending)
	return pending, err
}

func findAsset(assets []githubAsset, name string) (githubAsset, bool) {
	for _, asset := range assets {
		if asset.Name == name {
			return asset, true
		}
	}
	return githubAsset{}, false
}

func updateFileName(version string) string {
	safe := strings.NewReplacer("/", "-", "\\", "-", " ", "-").Replace(version)
	return "xyz-server-" + safe + ".exe"
}

func fileSHA256(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hasher := sha256.New()
	size, err := io.Copy(hasher, io.LimitReader(file, maxUpdateExecutableSize+1))
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hasher.Sum(nil)), size, nil
}

func updateFileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Size() > 0
}

func writeJSONAtomic(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tempPath := path + ".tmp"
	if err := os.WriteFile(tempPath, append(data, '\n'), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return nil
}

func readJSONFile(path string, value any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}

func isNewerVersion(candidate string, current string) bool {
	candidateCore, candidatePre, okCandidate := parseVersion(candidate)
	currentCore, currentPre, okCurrent := parseVersion(current)
	if !okCandidate || !okCurrent {
		return false
	}
	for index := range candidateCore {
		if candidateCore[index] != currentCore[index] {
			return candidateCore[index] > currentCore[index]
		}
	}
	if candidatePre == currentPre {
		return false
	}
	if candidatePre == "" {
		return currentPre != ""
	}
	if currentPre == "" {
		return false
	}
	return candidatePre > currentPre
}

func parseVersion(value string) ([3]int, string, bool) {
	var core [3]int
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	if value == "" {
		return core, "", false
	}
	mainPart := value
	prerelease := ""
	if index := strings.IndexAny(value, "-+"); index >= 0 {
		mainPart = value[:index]
		if value[index] == '-' {
			prerelease = value[index+1:]
		}
	}
	parts := strings.Split(mainPart, ".")
	if len(parts) != 3 {
		return core, "", false
	}
	for index, part := range parts {
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 {
			return core, "", false
		}
		core[index] = number
	}
	return core, prerelease, true
}

func truncateText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func regexpMustCompileVersion() *regexp.Regexp {
	return regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
}

func (api *API) handleUpdateStatus(w http.ResponseWriter, _ *http.Request) {
	if api.updater == nil {
		writeJSON(w, http.StatusOK, UpdateStatus{
			Enabled:        false,
			Repository:     defaultUpdateRepository,
			CurrentVersion: serverVersion,
		})
		return
	}
	writeJSON(w, http.StatusOK, api.updater.Status())
}

func (api *API) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if api.updater == nil {
		writeError(w, http.StatusServiceUnavailable, "在线更新未启用", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	result, err := api.updater.Check(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (api *API) handleUpdateDownload(w http.ResponseWriter, r *http.Request) {
	if api.updater == nil {
		writeError(w, http.StatusServiceUnavailable, "在线更新未启用", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	result, err := api.updater.Download(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (api *API) handleUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if api.updater == nil {
		writeError(w, http.StatusServiceUnavailable, "在线更新未启用", nil)
		return
	}
	if api.restart == nil {
		writeError(w, http.StatusServiceUnavailable, "服务重启入口未准备好", nil)
		return
	}
	if err := api.updater.PrepareInstall(); err != nil {
		writeError(w, http.StatusConflict, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"ok":         true,
		"restarting": true,
	})
	go func() {
		time.Sleep(800 * time.Millisecond)
		api.restart()
	}()
}
