package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"
)

func TestAPIStateRoundTrip(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	mux := http.NewServeMux()
	NewAPI(store).Register(mux)
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
		bytes.NewBufferString(`{"password":"api-test-password"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	setupRequest.Header.Set("Content-Type", "application/json")
	setupResponse, err := client.Do(setupRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer setupResponse.Body.Close()
	if setupResponse.StatusCode != http.StatusCreated {
		t.Fatalf("auth setup returned %d", setupResponse.StatusCode)
	}

	put := func(path string, body string) {
		t.Helper()
		request, err := http.NewRequest(http.MethodPut, server.URL+path, bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-XYZ-Request", "1")
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s returned %d", path, response.StatusCode)
		}
	}

	put("/api/classrooms", `{"version":1,"activeClassId":"class-api","classrooms":[{"id":"class-api","name":"API 测试班","students":[{"id":"s01","number":1,"name":"江屿"}]},{"id":"class-api-2","name":"API 测试二班","students":[{"id":"s02","number":1,"name":"欧阳子墨"}]}]}`)
	put("/api/questions", `[{"id":"q-api","subject":"math","prompt":"$1+1=$","options":["$1$","$2$","$3$","$4$"],"correctIndex":1,"topic":"加法","difficulty":"基础"}]`)
	put("/api/applied-pack", `{"subject":"math","draft":{"subject":"math","title":"API题包","questionIds":["q-api"],"secondsPerQuestion":30,"updatedAt":"2026-01-01T00:00:00Z"}}`)
	post := func(path string, body string) {
		t.Helper()
		request, err := http.NewRequest(http.MethodPost, server.URL+path, bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("%s returned %d", path, response.StatusCode)
		}
	}
	post("/api/practice-attempts", `{
		"id":"attempt-api",
		"classId":"class-api",
		"className":"API 测试班",
		"studentId":"s01",
		"studentNumber":1,
		"studentName":"江屿",
		"subject":"math",
		"packTitle":"API 练习",
		"mode":"practice",
		"questionCount":1,
		"correctCount":1,
		"score":100,
		"totalElapsedMs":1200,
		"startedAt":"2026-11-03T01:00:00Z",
		"completedAt":"2026-11-03T01:00:02Z",
		"answers":[
			{"questionId":"q-api","topic":"加法","selectedOriginalIndex":1,"correct":true,"timedOut":false,"elapsedMs":1200}
		]
	}`)

	response, err := client.Get(server.URL + "/api/bootstrap")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	var result Bootstrap
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if !result.HasData || result.AppliedPack != "math" {
		t.Fatalf("unexpected bootstrap: %+v", result)
	}
	if len(result.Questions) != 1 || len(result.PackDrafts) != 1 {
		t.Fatalf("missing records: %+v", result)
	}
	var directory classroomDirectoryMeta
	if err := json.Unmarshal(result.ClassroomDirectory, &directory); err != nil {
		t.Fatal(err)
	}
	if len(directory.Classrooms) != 2 || directory.ActiveClassID != "class-api" {
		t.Fatalf("missing classroom directory: %+v", directory)
	}

	attemptResponse, err := client.Get(server.URL + "/api/practice-attempts?classId=class-api")
	if err != nil {
		t.Fatal(err)
	}
	defer attemptResponse.Body.Close()
	var attempts []json.RawMessage
	if err := json.NewDecoder(attemptResponse.Body).Decode(&attempts); err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 1 {
		t.Fatalf("expected one practice attempt, got %d", len(attempts))
	}
}
