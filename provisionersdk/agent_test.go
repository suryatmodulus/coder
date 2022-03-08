//go:build !windows
// +build !windows

// There isn't a portable Windows binary equivalent to "echo".
// This can be tested, but it's a bit harder.

package provisionersdk_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"

	"github.com/go-chi/render"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/provisionersdk"
)

func TestAgentScript(t *testing.T) {
	t.Parallel()
	t.Run("Run", func(t *testing.T) {
		t.Parallel()
		srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			echoPath, err := exec.LookPath("echo")
			require.NoError(t, err)
			content, err := os.ReadFile(echoPath)
			require.NoError(t, err)
			render.Status(r, http.StatusOK)
			render.Data(rw, r, content)
		}))
		t.Cleanup(srv.Close)
		srvURL, err := url.Parse(srv.URL)
		require.NoError(t, err)

		script, exists := provisionersdk.AgentScriptEnv()[fmt.Sprintf("CODER_AGENT_SCRIPT_%s_%s", runtime.GOOS, runtime.GOARCH)]
		if !exists {
			t.Skip("Agent not supported...")
			return
		}
		script = strings.ReplaceAll(script, "${ACCESS_URL}", srvURL.String())
		output, err := exec.Command("sh", "-c", script).CombinedOutput()
		t.Log(string(output))
		require.NoError(t, err)
		// Because we use the "echo" binary, we should expect the arguments provided
		// as the response to executing our script.
		require.Equal(t, "agent", strings.TrimSpace(string(output)))
	})
}
