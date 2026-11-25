package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestFrontendRoutes(t *testing.T) {
	t.Chdir("../..")
	router := gin.New()
	registerFrontendRoutes(router)

	for _, tc := range []struct {
		path, location string
		status         int
	}{
		{"/", "", http.StatusOK},
		{"/classic", "/", http.StatusFound},
		{"/api-docs", "/#/api-docs", http.StatusFound},
		{"/static/favicon.ico", "", http.StatusOK},
		{"/static/logo.png", "", http.StatusOK},
		{"/static/site.webmanifest", "", http.StatusOK},
		{"/static/i18n/en-US.json", "", http.StatusOK},
		{"/static/app/", "", http.StatusOK},
		{"/static/js/chat.js", "", http.StatusNotFound},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if w.Code != tc.status || w.Header().Get("Location") != tc.location {
				t.Fatalf("status %d, location %q", w.Code, w.Header().Get("Location"))
			}
			if tc.path == "/" && (!strings.Contains(w.Body.String(), `<div id="root">`) || w.Header().Get("Cache-Control") != "no-cache") {
				t.Fatal("root must serve the revalidated Semi entry point")
			}
		})
	}
}

func TestUpgradeDoesNotServeLeftoverClassicAssets(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.MkdirAll("web/static/js", 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("web/static/js/chat.js", []byte("stale"), 0644); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	registerFrontendRoutes(router)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/static/js/chat.js", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("leftover classic script returned %d", w.Code)
	}
}
