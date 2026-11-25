package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func TestLoginRejectsMissingAndLongUsernameBeforeAuthentication(t *testing.T) {
	h := &AuthHandler{}
	r := gin.New()
	r.POST("/login", h.Login)
	for _, username := range []string{"", "  ", strings.Repeat("x", 65), strings.Repeat("中", 65)} {
		body, _ := json.Marshal(map[string]string{"username": username, "password": "test-only-password"})
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("username %q: %d", username, w.Code)
		}
	}
}

func TestAuthSessionResponsesIncludeAppVersion(t *testing.T) {
	const version = "v9.8.7-test"
	logger := zap.NewNop()
	db, err := database.NewDB(filepath.Join(t.TempDir(), "auth.db"), logger)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	manager := security.NewAuthManager(12)
	password, err := manager.AttachRBACStore(db)
	if err != nil {
		t.Fatal(err)
	}

	h := NewAuthHandler(manager, &config.Config{Version: version}, "", logger)
	r := gin.New()
	r.POST("/api/auth/login", h.Login)
	r.GET("/api/auth/validate", security.AuthMiddleware(manager), h.Validate)

	checkVersion := func(req *http.Request) string {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("%s returned status %d", req.URL.Path, w.Code)
		}
		var session struct {
			Token      string `json:"token"`
			AppVersion string `json:"app_version"`
		}
		if err := json.NewDecoder(w.Body).Decode(&session); err != nil {
			t.Fatal(err)
		}
		if session.AppVersion != version {
			t.Errorf("%s app_version = %q, want %q", req.URL.Path, session.AppVersion, version)
		}
		return session.Token
	}

	body, err := json.Marshal(loginRequest{Username: "admin", Password: password})
	if err != nil {
		t.Fatal(err)
	}
	login := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	login.Header.Set("Content-Type", "application/json")
	token := checkVersion(login)

	validate := httptest.NewRequest(http.MethodGet, "/api/auth/validate", nil)
	validate.Header.Set("Authorization", "Bearer "+token)
	checkVersion(validate)
}
