package api

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The production routing keeps the deletion hook off the internet: Caddy only proxies /api/* to the
// API's public port, answers 404 for /internal/*, and nothing publishes the internal port.

func readRepo(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile("../../../" + path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// withoutComments drops # comments (Caddyfile and YAML).
func withoutComments(s string) string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if i := strings.Index(line, "#"); i >= 0 {
			line = line[:i]
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func TestCaddyNeverRoutesToTheInternalPort(t *testing.T) {
	caddy := withoutComments(readRepo(t, "infra/production/Caddyfile"))
	if !regexp.MustCompile(`handle /internal/\* \{\s*respond 404\s*\}`).MatchString(caddy) {
		t.Error("the Caddyfile must answer 404 for /internal/*")
	}
	proxies := regexp.MustCompile(`reverse_proxy\s+(\S*api\S*)`).FindAllStringSubmatch(caddy, -1)
	if len(proxies) == 0 {
		t.Fatal("no reverse_proxy to the API found")
	}
	for _, p := range proxies {
		if p[1] != "api:3000" {
			t.Errorf("Caddy proxies to %s; only the public port api:3000 is allowed", p[1])
		}
	}
	if strings.Contains(caddy, "3001") || strings.Contains(caddy, "udg-api") {
		t.Error("the Caddyfile mentions the API's internal port or container name")
	}
}

func TestComposeKeepsTheInternalPortPrivate(t *testing.T) {
	compose := withoutComments(readRepo(t, "infra/production/docker-compose.yml"))
	i := strings.Index(compose, "\n  api:\n")
	if i < 0 {
		t.Fatal("no api service in the Compose file")
	}
	api := compose[i+1:]
	if j := regexp.MustCompile(`\n  [a-z0-9-]+:\n`).FindStringIndex(api[1:]); j != nil {
		api = api[:j[0]+1]
	}
	if !strings.Contains(api, "-internal-addr=0.0.0.0:3001") || !strings.Contains(api, "-addr=0.0.0.0:3000") {
		t.Error("the api service must listen on 3000 (public, via Caddy) and 3001 (internal)")
	}
	if regexp.MustCompile(`(?m)^\s+(ports|expose):`).MatchString(api) {
		t.Error("the api service must not publish ports: Caddy and the platform reach it over Docker networks")
	}
}
