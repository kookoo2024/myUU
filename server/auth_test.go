package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTeacherAuthProtectsDataAndSessions(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	mux := http.NewServeMux()
	NewAPI(store).Register(mux)
	server := httptest.NewServer(mux)
	defer server.Close()

	anonymous, err := http.Get(server.URL + "/api/bootstrap")
	if err != nil {
		t.Fatal(err)
	}
	anonymous.Body.Close()
	if anonymous.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous bootstrap returned %d", anonymous.StatusCode)
	}

	publicPractice, err := http.Get(server.URL + "/api/practice/bootstrap")
	if err != nil {
		t.Fatal(err)
	}
	publicPractice.Body.Close()
	if publicPractice.StatusCode != http.StatusOK {
		t.Fatalf("public practice bootstrap returned %d", publicPractice.StatusCode)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	setupRequest, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/auth/setup",
		bytes.NewBufferString(`{"password":"teacher-password-2026"}`),
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
	cookies := jar.Cookies(setupRequest.URL)
	if len(cookies) != 1 || cookies[0].Name != sessionCookieName {
		t.Fatalf("unexpected session cookie: %+v", cookies)
	}
	setCookieHeader := setupResponse.Header.Get("Set-Cookie")
	if !strings.Contains(setCookieHeader, "HttpOnly") ||
		!strings.Contains(setCookieHeader, "SameSite=Strict") {
		t.Fatalf("session cookie is missing security attributes: %s", setCookieHeader)
	}

	sessionResponse, err := client.Get(server.URL + "/api/auth/session")
	if err != nil {
		t.Fatal(err)
	}
	defer sessionResponse.Body.Close()
	var session struct {
		Authenticated bool `json:"authenticated"`
		SetupRequired bool `json:"setupRequired"`
	}
	if err := json.NewDecoder(sessionResponse.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	if !session.Authenticated || session.SetupRequired {
		t.Fatalf("unexpected session status: %+v", session)
	}

	missingMarker, err := http.NewRequest(
		http.MethodPut,
		server.URL+"/api/classrooms",
		bytes.NewBufferString(`{"version":1,"activeClassId":"c1","classrooms":[{"id":"c1","name":"测试班","students":[{"id":"s1","number":1,"name":"江屿"}]}]}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	missingMarker.Header.Set("Content-Type", "application/json")
	missingMarkerResponse, err := client.Do(missingMarker)
	if err != nil {
		t.Fatal(err)
	}
	missingMarkerResponse.Body.Close()
	if missingMarkerResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("write without marker returned %d", missingMarkerResponse.StatusCode)
	}

	unsafeLogout, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/auth/logout",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	unsafeLogoutResponse, err := client.Do(unsafeLogout)
	if err != nil {
		t.Fatal(err)
	}
	unsafeLogoutResponse.Body.Close()
	if unsafeLogoutResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("logout without marker returned %d", unsafeLogoutResponse.StatusCode)
	}

	logoutRequest, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/auth/logout",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	logoutRequest.Header.Set("X-XYZ-Request", "1")
	logoutResponse, err := client.Do(logoutRequest)
	if err != nil {
		t.Fatal(err)
	}
	logoutResponse.Body.Close()
	if logoutResponse.StatusCode != http.StatusOK {
		t.Fatalf("logout returned %d", logoutResponse.StatusCode)
	}

	afterLogout, err := client.Get(server.URL + "/api/bootstrap")
	if err != nil {
		t.Fatal(err)
	}
	afterLogout.Body.Close()
	if afterLogout.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bootstrap after logout returned %d", afterLogout.StatusCode)
	}
}

func TestTeacherLoginRateLimit(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := setPassword(t.Context(), store, "rate-limit-password"); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	NewAPI(store).Register(mux)
	server := httptest.NewServer(mux)
	defer server.Close()

	for index := 0; index < authMaxFailures; index++ {
		request, err := http.NewRequest(
			http.MethodPost,
			server.URL+"/api/auth/login",
			bytes.NewBufferString(`{"password":"wrong-password"}`),
		)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d returned %d", index+1, response.StatusCode)
		}
	}

	blockedRequest, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/auth/login",
		bytes.NewBufferString(`{"password":"rate-limit-password"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	blockedRequest.Header.Set("Content-Type", "application/json")
	blockedResponse, err := http.DefaultClient.Do(blockedRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer blockedResponse.Body.Close()
	if blockedResponse.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("rate-limited login returned %d", blockedResponse.StatusCode)
	}
	if strings.TrimSpace(blockedResponse.Header.Get("Retry-After")) == "" {
		t.Fatal("rate-limited login did not include Retry-After")
	}
}
