package main

import (
	"context"
	"encoding/json"
	"testing"
)

func TestStoreRoundTrip(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	classroom := []byte(`{"id":"class-1","name":"测试班","students":[{"id":"s01","number":1,"name":"江屿"}]}`)
	if err := store.SaveClassroom(ctx, classroom); err != nil {
		t.Fatal(err)
	}

	questions := []byte(`[{"id":"q1","subject":"math","prompt":"$1+1=$","options":["$1$","$2$","$3$","$4$"],"correctIndex":1,"topic":"加法","difficulty":"基础"}]`)
	if err := store.ReplaceQuestions(ctx, questions); err != nil {
		t.Fatal(err)
	}

	drafts := []byte(`{"math":{"subject":"math","title":"测试题包","questionIds":["q1"],"secondsPerQuestion":30,"updatedAt":"2026-01-01T00:00:00Z"}}`)
	if err := store.ReplacePackDrafts(ctx, drafts); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAppliedPack(ctx, "math"); err != nil {
		t.Fatal(err)
	}

	result, err := store.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !result.HasData || result.AppliedPack != "math" {
		t.Fatalf("unexpected bootstrap: %+v", result)
	}
	if len(result.Questions) != 1 || len(result.PackDrafts) != 1 {
		t.Fatalf("missing stored records: %+v", result)
	}

	var decodedClassroom map[string]any
	if err := json.Unmarshal(result.Classroom, &decodedClassroom); err != nil {
		t.Fatal(err)
	}
	if decodedClassroom["name"] != "测试班" {
		t.Fatalf("unexpected classroom: %v", decodedClassroom)
	}
	if len(result.ClassroomDirectory) == 0 {
		t.Fatal("legacy classroom was not wrapped into a classroom directory")
	}
}

func TestStoreClassroomDirectoryRoundTrip(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	directory := []byte(`{
		"version":1,
		"activeClassId":"class-2",
		"classrooms":[
			{"id":"class-1","name":"高一（1）班","students":[{"id":"c1-s01","number":1,"name":"江屿"}]},
			{"id":"class-2","name":"高二（3）班","students":[{"id":"c2-s01","number":1,"name":"欧阳子墨"},{"id":"c2-s02","number":2,"name":"上官若溪"}]}
		]
	}`)
	if err := store.SaveClassroomDirectory(ctx, directory); err != nil {
		t.Fatal(err)
	}

	result, err := store.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !result.HasData || len(result.ClassroomDirectory) == 0 {
		t.Fatalf("missing classroom directory: %+v", result)
	}

	var decodedDirectory classroomDirectoryMeta
	if err := json.Unmarshal(result.ClassroomDirectory, &decodedDirectory); err != nil {
		t.Fatal(err)
	}
	if len(decodedDirectory.Classrooms) != 2 || decodedDirectory.ActiveClassID != "class-2" {
		t.Fatalf("unexpected directory: %+v", decodedDirectory)
	}

	var decodedActive classroomMeta
	if err := json.Unmarshal(result.Classroom, &decodedActive); err != nil {
		t.Fatal(err)
	}
	if decodedActive.Name != "高二（3）班" || len(decodedActive.Students) != 2 {
		t.Fatalf("bootstrap did not expose the active classroom: %+v", decodedActive)
	}
}

func TestStorePracticeAttemptRoundTrip(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	attempt := []byte(`{
		"id":"attempt-1",
		"classId":"class-1",
		"className":"高一（1）班",
		"studentId":"s01",
		"studentNumber":1,
		"studentName":"江屿",
		"subject":"math",
		"packTitle":"函数基础单选",
		"mode":"test",
		"questionCount":2,
		"correctCount":1,
		"score":50,
		"totalElapsedMs":3000,
		"startedAt":"2026-11-03T01:00:00Z",
		"completedAt":"2026-11-03T01:00:03Z",
		"answers":[
			{"questionId":"q1","topic":"函数","selectedOriginalIndex":0,"correct":true,"timedOut":false,"elapsedMs":1000},
			{"questionId":"q2","topic":"集合","selectedOriginalIndex":null,"correct":false,"timedOut":true,"elapsedMs":2000}
		]
	}`)
	if err := store.SavePracticeAttempt(ctx, attempt); err != nil {
		t.Fatal(err)
	}
	if err := store.SavePracticeAttempt(ctx, attempt); err != nil {
		t.Fatal(err)
	}

	attempts, err := store.ListPracticeAttempts(ctx, "class-1", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 1 {
		t.Fatalf("expected one idempotent attempt, got %d", len(attempts))
	}
	if otherClass, err := store.ListPracticeAttempts(ctx, "class-2", 20); err != nil {
		t.Fatal(err)
	} else if len(otherClass) != 0 {
		t.Fatalf("class filter returned unrelated attempts: %d", len(otherClass))
	}
}
