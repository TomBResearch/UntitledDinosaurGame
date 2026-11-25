// Command api is the backend API: worlds, characters and join tickets (docs/architecture/backend.md).
// It applies the database migrations when it starts, then serves /api/* over HTTP.
//
//	cd server && go run ./cmd/api      # with the environment below (infra/dev/api.env.example)
//
// Environment (secrets only ever come from here, never flags):
//
//	DATABASE_URL          Postgres, for example postgres://udg:udg@127.0.0.1:5433/udg?sslmode=disable
//	WORLD_TICKET_KEY      signs join tickets; the world servers have the same value
//	DINOSAUR_SERVICE_KEY  this game's key for the platform's service API
//	WORLD_DB_PASSWORD     optional: the password the world servers log in to Postgres with, as
//	                      the udg_world role (ADR 0017). The API sets it on the role at start.
//
// SIGTERM (or Ctrl-C) stops it cleanly.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api/pgstore"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
	"github.com/TomBResearch/UntitledDinosaurGame/server/migrations"
)

// version is set at build time (-ldflags "-X main.version=...").
var version = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error("api failed", "err", err)
		os.Exit(1)
	}
}

func run() error {
	addr := flag.String("addr", "127.0.0.1:3010", "listen address")
	dataDir := flag.String("data", "../data", "the data/ directory")
	platformURL := flag.String("platform", "https://accounts.untitledgames.co.uk",
		"the account platform's base URL for the service API (production: http://accounts:3100)")
	jwksURL := flag.String("jwks", "https://accounts.untitledgames.co.uk/.well-known/jwks.json", "the platform's public keys")
	issuer := flag.String("issuer", "https://accounts.untitledgames.co.uk", "access tokens' iss")
	audience := flag.String("audience", "tomblundell-games", "access tokens' aud")
	publicWS := flag.String("public-ws", "ws://127.0.0.1:8090", "where browsers reach the worlds (no path)")
	worldStatus := flag.String("world-status", "http://127.0.0.1:8090/status",
		"each world's status URL, with {id} for the world id (production: http://world-{id}:8090/status)")
	trustProxy := flag.Bool("trust-proxy", false, "take the client IP from X-Real-IP (behind Caddy)")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	slog.SetDefault(log)

	dbURL := os.Getenv("DATABASE_URL")
	serviceKey := os.Getenv("DINOSAUR_SERVICE_KEY")
	var missing []string
	for name, v := range map[string]string{"DATABASE_URL": dbURL, "WORLD_TICKET_KEY": os.Getenv("WORLD_TICKET_KEY"), "DINOSAUR_SERVICE_KEY": serviceKey} {
		if v == "" {
			missing = append(missing, name)
		}
	}
	slices.Sort(missing)
	if len(missing) > 0 {
		return fmt.Errorf("set %s in the environment", strings.Join(missing, ", "))
	}
	ticketKey, err := ticket.ParseKey(os.Getenv("WORLD_TICKET_KEY"))
	if err != nil {
		return err
	}

	data, err := content.Load(*dataDir)
	if err != nil {
		return fmt.Errorf("loading %s: %w", *dataDir, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	pool, err := pgxpool.New(ctx, dbURL)
	if err == nil {
		err = waitForDB(ctx, pool, log)
	}
	if err != nil {
		cancel()
		return fmt.Errorf("database: %w", err)
	}
	defer pool.Close()
	ran, err := migrations.Apply(ctx, pool)
	if err == nil {
		log.Info("migrations", "ran", ran)
		if pw := os.Getenv("WORLD_DB_PASSWORD"); pw != "" {
			err = migrations.SetWorldPassword(ctx, pool, pw)
		} else {
			log.Warn("WORLD_DB_PASSWORD is not set: the world servers can't log in to the database to save characters")
		}
	}
	cancel()
	if err != nil {
		return err
	}

	store := pgstore.New(pool)
	srv := api.New(api.Config{
		Store: store,
		Tokens: &platform.Verifier{Keys: platform.NewJWKS(*jwksURL, log), Issuer: *issuer, Audience: *audience,
			Now: time.Now},
		Accounts:   platform.NewAccounts(*platformURL, serviceKey),
		Worlds:     api.NewHTTPWorldStatus(*worldStatus),
		TicketKey:  ticketKey,
		PublicWS:   *publicWS,
		Data:       data,
		TrustProxy: *trustProxy,
		Version:    version,
		Log:        log,
	})

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	httpSrv := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.Serve(ln) }()
	log.Info("api listening", "addr", ln.Addr().String(), "version", version, "platform", *platformURL)

	sigs, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stopSignals()
	go purgeLoop(sigs, store, log)
	select {
	case err := <-serveErr:
		return err
	case <-sigs.Done():
	}
	log.Info("shutting down")
	shut, cancelShut := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShut()
	if err := httpSrv.Shutdown(shut); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// waitForDB retries until Postgres answers: in Compose, the API may start before it's ready.
func waitForDB(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) error {
	for {
		err := pool.Ping(ctx)
		if err == nil {
			return nil
		}
		log.Info("waiting for the database", "err", err)
		select {
		case <-ctx.Done():
			return err
		case <-time.After(time.Second):
		}
	}
}

// purgeLoop removes characters deleted more than 7 days ago, once an hour.
func purgeLoop(ctx context.Context, store api.Store, log *slog.Logger) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if n, err := store.Purge(ctx, time.Now()); err != nil {
			log.Error("purging deleted characters failed", "err", err)
		} else if n > 0 {
			log.Info("purged deleted characters", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
