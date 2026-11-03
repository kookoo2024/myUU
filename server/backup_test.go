package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSQLiteBackupAndRotation(t *testing.T) {
	dataDir := t.TempDir()
	store, err := OpenStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	classroom := []byte(`{
		"version":1,
		"activeClassId":"backup-class",
		"classrooms":[{
			"id":"backup-class",
			"name":"备份测试班",
			"students":[{"id":"backup-s1","number":1,"name":"江屿"}]
		}]
	}`)
	if err := store.SaveClassroomDirectory(context.Background(), classroom); err != nil {
		t.Fatal(err)
	}

	backupDir := filepath.Join(dataDir, "backups")
	manager := NewBackupManager(store, backupDir, time.Hour, 2)
	var latestBackup string
	for index := 0; index < 3; index++ {
		path, err := manager.Create(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(path); err != nil {
			t.Fatal(err)
		}
		if err := verifySQLiteFile(path); err != nil {
			t.Fatal(err)
		}
		latestBackup = path
		time.Sleep(12 * time.Millisecond)
	}

	backupDB, err := sql.Open(
		"sqlite3",
		"file:"+filepath.ToSlash(latestBackup)+"?mode=ro",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer backupDB.Close()
	var classroomCount int
	if err := backupDB.QueryRow(`SELECT COUNT(*) FROM classrooms`).Scan(&classroomCount); err != nil {
		t.Fatal(err)
	}
	if classroomCount != 1 {
		t.Fatalf("backup contains %d classrooms, want 1", classroomCount)
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".db" {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("expected 2 retained backups, got %d", count)
	}
}
