package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestVersionComparison(t *testing.T) {
	tests := []struct {
		candidate string
		current   string
		want      bool
	}{
		{candidate: "0.3.1", current: "0.3.0", want: true},
		{candidate: "v1.0.0", current: "0.9.9", want: true},
		{candidate: "0.3.0", current: "0.3.0", want: false},
		{candidate: "0.3.0", current: "0.3.0-dev", want: true},
		{candidate: "0.3.0-beta.1", current: "0.3.0", want: false},
		{candidate: "bad", current: "0.3.0", want: false},
	}
	for _, test := range tests {
		if got := isNewerVersion(test.candidate, test.current); got != test.want {
			t.Fatalf("isNewerVersion(%q, %q) = %v, want %v", test.candidate, test.current, got, test.want)
		}
	}
}

func TestUpdateVersionPatternOnlyAcceptsStableReleases(t *testing.T) {
	if !updateVersionPattern.MatchString("0.3.1") {
		t.Fatal("stable release version should be accepted")
	}
	if updateVersionPattern.MatchString("0.3.1-beta.1") {
		t.Fatal("prerelease version should be rejected")
	}
}

func TestUpdateCheckDownloadAndPrepare(t *testing.T) {
	updatePayload := []byte("test-update-executable")
	sum := sha256.Sum256(updatePayload)
	manifest := releaseManifest{
		Version: "0.3.1",
		Asset:   "xyz-server-windows-amd64.exe",
		SHA256:  hex.EncodeToString(sum[:]),
		Size:    int64(len(updatePayload)),
	}

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest":
			_ = json.NewEncoder(w).Encode(githubRelease{
				TagName:     "v0.3.1",
				HTMLURL:     "https://github.com/example/releases/tag/v0.3.1",
				PublishedAt: "2026-11-03T00:00:00Z",
				Body:        "修复课堂计时问题",
				Assets: []githubAsset{
					{
						Name:               "update.json",
						BrowserDownloadURL: server.URL + "/update.json",
						Size:               256,
					},
					{
						Name:               manifest.Asset,
						BrowserDownloadURL: server.URL + "/update.exe",
						Size:               int64(len(updatePayload)),
					},
				},
			})
		case "/update.json":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/update.exe":
			_, _ = w.Write(updatePayload)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	dataDir := t.TempDir()
	manager := NewUpdateManager(dataDir)
	manager.current = "0.3.0"
	manager.enabled = true
	manager.managed = true
	manager.releaseAPI = server.URL + "/latest"
	manager.httpClient = server.Client()

	check, err := manager.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !check.UpdateAvailable || check.LatestVersion != "0.3.1" {
		t.Fatalf("unexpected update check: %+v", check)
	}

	downloaded, err := manager.Download(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if downloaded.PreparedVersion != "0.3.1" || !downloaded.CanInstall {
		t.Fatalf("unexpected downloaded status: %+v", downloaded)
	}
	preparedPath := filepath.Join(dataDir, "updates", updateFileName("0.3.1"))
	if _, err := os.Stat(preparedPath); err != nil {
		t.Fatal(err)
	}
	if actual, size, err := fileSHA256(preparedPath); err != nil {
		t.Fatal(err)
	} else if actual != manifest.SHA256 || size != manifest.Size {
		t.Fatalf("downloaded update mismatch: %s %d", actual, size)
	}

	if err := manager.PrepareInstall(); err != nil {
		t.Fatal(err)
	}
	var pending preparedUpdate
	if err := readJSONFile(filepath.Join(dataDir, "updates", "pending-update.json"), &pending); err != nil {
		t.Fatal(err)
	}
	if pending.Version != "0.3.1" || pending.FileName != updateFileName("0.3.1") {
		t.Fatalf("unexpected pending update: %+v", pending)
	}
}

func TestUpdateDownloadRejectsChecksumMismatch(t *testing.T) {
	updatePayload := []byte("tampered-update")
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest":
			_ = json.NewEncoder(w).Encode(githubRelease{
				TagName: "v0.4.0",
				Assets: []githubAsset{
					{Name: "update.json", BrowserDownloadURL: server.URL + "/update.json"},
					{
						Name:               "xyz-server-windows-amd64.exe",
						BrowserDownloadURL: server.URL + "/update.exe",
						Size:               int64(len(updatePayload)),
					},
				},
			})
		case "/update.json":
			_ = json.NewEncoder(w).Encode(releaseManifest{
				Version: "0.4.0",
				Asset:   "xyz-server-windows-amd64.exe",
				SHA256:  fmt.Sprintf("%064d", 0),
				Size:    int64(len(updatePayload)),
			})
		case "/update.exe":
			_, _ = w.Write(updatePayload)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	manager := NewUpdateManager(t.TempDir())
	manager.current = "0.3.0"
	manager.enabled = true
	manager.releaseAPI = server.URL + "/latest"
	manager.httpClient = server.Client()

	if _, err := manager.Download(context.Background()); err == nil {
		t.Fatal("expected checksum mismatch to fail")
	}
}
