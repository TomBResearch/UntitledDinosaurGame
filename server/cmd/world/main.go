// Command world is a world server: one process per world, one tick goroutine per region
// (docs/architecture/world-server.md). Clients connect over WebSocket to /w/<world-id>.
//
//	go run ./cmd/world -dev-tickets     # local development: ws://127.0.0.1:8090/w/dev
//
// Join tickets from the backend API are accepted when WORLD_TICKET_KEY is set (the same key as the
// API's), for this world only (-world). -premium-only refuses accounts without Premium. Ticket players
// are saved, so tickets also need DATABASE_URL: Postgres, as the udg_world role (ADR 0017). Dev
// players are never saved and need no database.
//
// SIGTERM (or Ctrl-C) shuts it down cleanly: no new connections; if anyone is playing, a warning and
// -shutdown-warning (60 s) of play; then every player is sent kick(shutdown), saved and their lease
// released, and the regions stop. A second signal skips what's left of the warning.
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
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist/pgpersist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/region"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/world"
)

func main() {
	if err := run(); err != nil {
		slog.Error("world server failed", "err", err)
		os.Exit(1)
	}
}

func run() error {
	addr := flag.String("addr", "127.0.0.1:8090", "listen address")
	worldID := flag.String("world", "dev", "world id: clients connect to /w/<world>")
	dataDir := flag.String("data", "../data", "the data/ directory")
	spawnRegion := flag.String("spawn-region", "test_greybox", "region players join")
	devTickets := flag.Bool("dev-tickets", false, `accept "dev:<name>" join tickets (development only)`)
	premiumOnly := flag.Bool("premium-only", false, "only accounts with Premium (and staff) may join")
	origins := flag.String("origins", "localhost:*,127.0.0.1:*",
		"comma-separated browser origins allowed to connect besides the server's own host")
	shutdownWarning := flag.Duration("shutdown-warning", 60*time.Second,
		"on SIGTERM, how long players are warned before the world stops (skipped if nobody is on)")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	slog.SetDefault(log)

	data, err := content.Load(*dataDir)
	if err != nil {
		return fmt.Errorf("loading %s: %w", *dataDir, err)
	}
	hz := data.Progression.Server.TickHz

	// The database, for saving ticket players (ADR 0017).
	wcfg := world.DefaultConfig(*worldID, data.Hash)
	var saver *persist.Saver
	var stopSaver func()
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		var pool *pgxpool.Pool
		saver, pool, err = openSaver(dbURL, *worldID, log)
		if err != nil {
			return err
		}
		defer pool.Close()
		wcfg.Saver = saver
	}

	cfg := region.ConfigFor(data)
	cfg.Saver = saver
	var regions []*region.Region
	var spawn *region.Region
	for _, rf := range data.Regions {
		r, err := region.New(rf, cfg)
		if err != nil {
			return err
		}
		regions = append(regions, r)
		if r.ID() == *spawnRegion {
			spawn = r
		}
	}
	if spawn == nil {
		return fmt.Errorf("no region %q in %s/regions", *spawnRegion, *dataDir)
	}

	wcfg.DevTickets = *devTickets
	wcfg.PremiumOnly = *premiumOnly
	if env := os.Getenv("WORLD_TICKET_KEY"); env != "" {
		if wcfg.TicketKey, err = ticket.ParseKey(env); err != nil {
			return err
		}
		if saver == nil {
			return errors.New("WORLD_TICKET_KEY is set but DATABASE_URL isn't: ticket players have to be saved and leased (ADR 0017)")
		}
	} else if !*devTickets {
		log.Warn("WORLD_TICKET_KEY is not set and dev tickets are off: nobody can join")
	}
	for _, o := range strings.Split(*origins, ",") {
		if o = strings.TrimSpace(o); o != "" {
			wcfg.OriginPatterns = append(wcfg.OriginPatterns, o)
		}
	}
	if *devTickets {
		log.Warn("DEV TICKETS ARE ON: anyone can join with a \"dev:<name>\" ticket as any name. Use -dev-tickets on a public server only behind the playtest gate (docs/operations/deploy.md).")
	}

	// The regions tick until regionCtx ends, which is after every session has closed.
	regionCtx, stopRegions := context.WithCancel(context.Background())
	defer stopRegions()
	var ticking sync.WaitGroup
	interval := time.Second / time.Duration(hz)
	for _, r := range regions {
		ticking.Go(func() { r.Run(regionCtx, interval) })
	}
	srv := world.New(wcfg, regions, spawn, regionCtx.Done(), log)
	if saver != nil {
		// The saver writes saves and renews leases until the shutdown has queued the last saves.
		saver.SetOnLost(srv.LostLease)
		saverCtx, cancel := context.WithCancel(context.Background())
		saverDone := make(chan struct{})
		go func() { saver.Run(saverCtx); close(saverDone) }()
		stopSaver = func() { cancel(); <-saverDone }
		defer stopSaver()
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	httpSrv := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.Serve(ln) }()
	log.Info("world server listening", "world", *worldID, "url", "ws://"+ln.Addr().String()+"/w/"+*worldID,
		"regions", len(regions), "spawn_region", spawn.ID(), "tick_hz", hz, "content_hash", data.Hash[:12],
		"join_tickets", wcfg.TicketKey != nil, "premium_only", wcfg.PremiumOnly, "saving", saver != nil,
		"idle_logout_s", data.Progression.Session.IdleLogoutS)

	sigs := make(chan os.Signal, 2)
	signal.Notify(sigs, syscall.SIGTERM, os.Interrupt)
	defer signal.Stop(sigs)
	select {
	case err := <-serveErr:
		return err
	case <-sigs:
	}

	// The shutdown (world-server.md, "Shutdown"). Compose's stop_grace_period must cover all of it:
	// the warning, then up to 10 s for connections to close and 15 s for the last saves.
	srv.StopJoins()
	if n := srv.Sessions(); n > 0 && *shutdownWarning > 0 {
		log.Info("shutting down: warning players", "players", n, "in", *shutdownWarning)
		srv.Warn(context.Background(), *shutdownWarning)
		t := time.NewTimer(*shutdownWarning)
		select {
		case <-t.C:
		case <-sigs:
			log.Info("second signal: skipping the rest of the warning")
			t.Stop()
		}
	}
	log.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Warn("http shutdown", "err", err)
	}
	if err := srv.Shutdown(ctx); err != nil {
		log.Warn("session shutdown", "err", err)
	}
	// Each region saves anyone still in it as it stops.
	stopRegions()
	ticking.Wait()
	if saver != nil {
		stopSaver()
		drain, cancelDrain := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancelDrain()
		if err := saver.Drain(drain); err != nil {
			log.Error("not every character was saved", "err", err)
		} else {
			log.Info("everyone saved", "leases_still_held", saver.Held())
		}
	}
	log.Info("stopped")
	return nil
}

// openSaver connects to the world's database as udg_world, checks the world is in the worlds table,
// and ends any lease the world still holds from before a crash. The API applies migrations; the world
// never does.
func openSaver(dbURL, worldID string, log *slog.Logger) (*persist.Saver, *pgxpool.Pool, error) {
	id, err := strconv.Atoi(worldID)
	if err != nil {
		return nil, nil, fmt.Errorf("-world=%q: a world that saves characters needs the numeric id from the worlds table", worldID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return nil, nil, fmt.Errorf("database: %w", err)
	}
	store := pgpersist.New(pool)
	var ok bool
	for { // the database may still be starting (Compose starts everything together)
		ok, err = store.WorldExists(ctx, id)
		if err == nil || ctx.Err() != nil {
			break
		}
		log.Info("waiting for the database", "err", err)
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
	if err != nil {
		pool.Close()
		return nil, nil, fmt.Errorf("database: %w", err)
	}
	if !ok {
		pool.Close()
		return nil, nil, fmt.Errorf("world %d isn't in the worlds table", id)
	}
	n, err := store.ReleaseWorld(ctx, id)
	if err != nil {
		pool.Close()
		return nil, nil, fmt.Errorf("releasing leases left from before: %w", err)
	}
	if n > 0 {
		log.Warn("released online leases left over from a crash", "world", id, "characters", n)
	}
	return persist.NewSaver(persist.SaverConfig{Store: store, World: id, Log: log}), pool, nil
}
