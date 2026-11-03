package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const maxJSONBodyBytes = 8 << 20

type API struct {
	store     *Store
	auth      *TeacherAuth
	backups   *BackupManager
	updater   *UpdateManager
	restart   func()
	startedAt time.Time
}

func NewAPI(store *Store, backupManagers ...*BackupManager) *API {
	var backups *BackupManager
	if len(backupManagers) > 0 {
		backups = backupManagers[0]
	}
	return &API{
		store:     store,
		auth:      NewTeacherAuth(store),
		backups:   backups,
		startedAt: time.Now(),
	}
}

func (api *API) SetUpdateManager(updater *UpdateManager) {
	api.updater = updater
}

func (api *API) SetRestartHandler(restart func()) {
	api.restart = restart
}

func (api *API) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/health", api.handleHealth)
	api.auth.Register(mux)
	mux.Handle("GET /api/bootstrap", api.auth.Require(http.HandlerFunc(api.handleBootstrap)))
	mux.Handle("GET /api/practice/bootstrap", http.HandlerFunc(api.handlePracticeBootstrap))
	mux.Handle("PUT /api/classroom", api.auth.Require(http.HandlerFunc(api.handleClassroom)))
	mux.Handle("PUT /api/classrooms", api.auth.Require(http.HandlerFunc(api.handleClassrooms)))
	mux.Handle("PUT /api/questions", api.auth.Require(http.HandlerFunc(api.handleQuestions)))
	mux.Handle("PUT /api/pack-drafts", api.auth.Require(http.HandlerFunc(api.handlePackDrafts)))
	mux.Handle("PUT /api/applied-pack", api.auth.Require(http.HandlerFunc(api.handleAppliedPack)))
	mux.Handle("DELETE /api/applied-pack", api.auth.Require(http.HandlerFunc(api.handleAppliedPack)))
	mux.HandleFunc("POST /api/practice-attempts", api.handlePracticeAttemptCreate)
	mux.Handle("GET /api/practice-attempts", api.auth.Require(http.HandlerFunc(api.handlePracticeAttemptList)))
	mux.Handle("GET /api/admin/status", api.auth.Require(http.HandlerFunc(api.handleAdminStatus)))
	mux.Handle("GET /api/admin/backups", api.auth.Require(http.HandlerFunc(api.handleBackupList)))
	mux.Handle("POST /api/admin/backups", api.auth.Require(http.HandlerFunc(api.handleBackupCreate)))
	mux.Handle("GET /api/admin/update", api.auth.Require(http.HandlerFunc(api.handleUpdateStatus)))
	mux.Handle("GET /api/admin/update/check", api.auth.Require(http.HandlerFunc(api.handleUpdateCheck)))
	mux.Handle("POST /api/admin/update/download", api.auth.Require(http.HandlerFunc(api.handleUpdateDownload)))
	mux.Handle("POST /api/admin/update/install", api.auth.Require(http.HandlerFunc(api.handleUpdateInstall)))
}

func (api *API) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "xyz-server",
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

func (api *API) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	result, err := api.store.Bootstrap(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取本机数据失败", err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (api *API) handlePracticeBootstrap(w http.ResponseWriter, r *http.Request) {
	result, err := api.store.PracticeBootstrap(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取练习数据失败", err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (api *API) handleClassroom(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := api.store.SaveClassroom(r.Context(), body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleClassrooms(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := api.store.SaveClassroomDirectory(r.Context(), body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleQuestions(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := api.store.ReplaceQuestions(r.Context(), body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handlePackDrafts(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := api.store.ReplacePackDrafts(r.Context(), body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleAppliedPack(w http.ResponseWriter, r *http.Request) {
	subject := ""
	if r.Method == http.MethodPut {
		var request struct {
			Subject string          `json:"subject"`
			Draft   json.RawMessage `json:"draft"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确", nil)
			return
		}
		subject = strings.TrimSpace(request.Subject)
		if len(request.Draft) > 0 {
			if err := api.store.ApplyPack(r.Context(), subject, request.Draft); err != nil {
				writeError(w, http.StatusBadRequest, err.Error(), nil)
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
	}
	if err := api.store.SetAppliedPack(r.Context(), subject); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handlePracticeAttemptCreate(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := api.store.SavePracticeAttempt(r.Context(), body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (api *API) handlePracticeAttemptList(w http.ResponseWriter, r *http.Request) {
	classID := strings.TrimSpace(r.URL.Query().Get("classId"))
	limit := 80
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			writeError(w, http.StatusBadRequest, "练习记录数量参数不正确", nil)
			return
		}
		limit = parsed
	}
	attempts, err := api.store.ListPracticeAttempts(r.Context(), classID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取练习记录失败", err)
		return
	}
	writeJSON(w, http.StatusOK, attempts)
}

func readBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	if err != nil {
		return nil, errors.New("请求内容过大或无法读取")
	}
	if !json.Valid(body) {
		return nil, errors.New("请求内容不是有效 JSON")
	}
	return body, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write json response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string, err error) {
	if err != nil {
		log.Printf("%s: %v", message, err)
	}
	writeJSON(w, status, map[string]string{"error": message})
}
