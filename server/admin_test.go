package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAdminStatusAndManualBackup(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	manager := NewBackupManager(
		store,
		filepath.Join(store.dataDir, "backups"),
		time.Hour,
		10,
	)
	mux := http.NewServeMux()
	NewAPI(store, manager).Register(mux)
	server := httptest.NewServer(mux)
	defer server.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	setupRequest, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/auth/setup",
		bytes.NewBufferString(`{"password":"admin-status-password"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	setupRequest.Header.Set("Content-Type", "application/json")
	setupResponse, err := client.Do(setupRequest)
	if err != nil {
		t.Fatal(err)
	}
	setupResponse.Body.Close()
	if setupResponse.StatusCode != http.StatusCreated {
		t.Fatalf("setup returned %d", setupResponse.StatusCode)
	}

	statusResponse, err := client.Get(server.URL + "/api/admin/status")
	if err != nil {
		t.Fatal(err)
	}
	defer statusResponse.Body.Close()
	if statusResponse.StatusCode != http.StatusOK {
		t.Fatalf("admin status returned %d", statusResponse.StatusCode)
	}
	var status struct {
		Version       string `json:"version"`
		DatabaseBytes int64  `json:"databaseBytes"`
		AutoBackup    bool   `json:"autoBackup"`
		BackupCount   int    `json:"backupCount"`
	}
	if err := json.NewDecoder(statusResponse.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	if status.Version == "" || status.DatabaseBytes <= 0 || !status.AutoBackup {
		t.Fatalf("unexpected admin status: %+v", status)
	}
	if status.BackupCount != 0 {
		t.Fatalf("expected no initial backups, got %d", status.BackupCount)
	}

	backupRequest, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/admin/backups",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	backupRequest.Header.Set("X-XYZ-Request", "1")
	backupResponse, err := client.Do(backupRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer backupResponse.Body.Close()
	if backupResponse.StatusCode != http.StatusCreated {
		t.Fatalf("manual backup returned %d", backupResponse.StatusCode)
	}
	var backup BackupInfo
	if err := json.NewDecoder(backupResponse.Body).Decode(&backup); err != nil {
		t.Fatal(err)
	}
	if backup.Name == "" || backup.SizeBytes <= 0 {
		t.Fatalf("unexpected backup info: %+v", backup)
	}
	if _, err := os.Stat(backup.Path); err != nil {
		t.Fatal(err)
	}

	listResponse, err := client.Get(server.URL + "/api/admin/backups")
	if err != nil {
		t.Fatal(err)
	}
	defer listResponse.Body.Close()
	var backups []BackupInfo
	if err := json.NewDecoder(listResponse.Body).Decode(&backups); err != nil {
		t.Fatal(err)
	}
	if len(backups) != 1 || backups[0].Name != backup.Name {
		t.Fatalf("unexpected backup list: %+v", backups)
	}
}
