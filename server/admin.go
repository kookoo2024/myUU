package main

import (
	"context"
	"net/http"
	"os"
	"time"
)

const serverVersion = "0.2.0"

func (api *API) handleAdminStatus(w http.ResponseWriter, r *http.Request) {
	databaseBytes, walBytes, err := api.databaseSizes()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取数据库状态失败", err)
		return
	}

	backupCount := 0
	var latestBackup *BackupInfo
	if api.backups != nil {
		backups, err := api.backups.List()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取备份状态失败", err)
			return
		}
		backupCount = len(backups)
		if len(backups) > 0 {
			latest := backups[0]
			latestBackup = &latest
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"service":       "题场课堂竞技场",
		"version":       serverVersion,
		"startedAt":     api.startedAt.UTC().Format(time.RFC3339),
		"uptimeSeconds": int64(time.Since(api.startedAt).Seconds()),
		"dataDir":       api.store.dataDir,
		"databasePath":  api.store.dbPath,
		"databaseBytes": databaseBytes,
		"walBytes":      walBytes,
		"autoBackup":    api.backups != nil,
		"backupDir":     api.backupDirectory(),
		"backupCount":   backupCount,
		"latestBackup":  latestBackup,
		"serverTime":    time.Now().UTC().Format(time.RFC3339),
	})
}

func (api *API) handleBackupList(w http.ResponseWriter, _ *http.Request) {
	if api.backups == nil {
		writeJSON(w, http.StatusOK, []BackupInfo{})
		return
	}
	backups, err := api.backups.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取备份列表失败", err)
		return
	}
	writeJSON(w, http.StatusOK, backups)
}

func (api *API) handleBackupCreate(w http.ResponseWriter, r *http.Request) {
	if api.backups == nil {
		writeError(w, http.StatusServiceUnavailable, "自动备份未启用", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	path, err := api.backups.Create(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建备份失败", err)
		return
	}
	info, err := api.backups.Info(path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取新备份信息失败", err)
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (api *API) databaseSizes() (int64, int64, error) {
	databaseBytes, err := fileSize(api.store.dbPath)
	if err != nil {
		return 0, 0, err
	}
	walBytes, err := fileSize(api.store.dbPath + "-wal")
	if err != nil && !os.IsNotExist(err) {
		return 0, 0, err
	}
	return databaseBytes, walBytes, nil
}

func (api *API) backupDirectory() string {
	if api.backups == nil {
		return ""
	}
	return api.backups.backupDir
}

func fileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	return info.Size(), nil
}
