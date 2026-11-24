// Command world is a world server: one process per world, one tick goroutine per region
// (docs/architecture/world-server.md). Clients connect over WebSocket to /w/<world-id>.
//
//	go run ./cmd/world -dev-tickets     # local development: ws://127.0.0.1:8090/w/dev
//
// SIGTERM (or Ctrl-C) shuts it down cleanly: no new connections, every player is sent kick(shutdown)
// and closed, then the regions stop.
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
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/region"
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
	origins := flag.String("origins", "localhost:*,127.0.0.1:*",
		"comma-separated browser origins allowed to connect besides the server's own host")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	slog.SetDefault(log)

	data, err := content.Load(*dataDir)
	if err != nil {
		return fmt.Errorf("loading %s: %w", *dataDir, err)
	}
	hz := data.Progression.Server.TickHz
	cfg := region.ConfigFor(data)
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

	wcfg := world.DefaultConfig(*worldID, data.Hash)
	wcfg.DevTickets = *devTickets
	for _, o := range strings.Split(*origins, ",") {
		if o = strings.TrimSpace(o); o != "" {
			wcfg.OriginPatterns = append(wcfg.OriginPatterns, o)
		}
	}
	if *devTickets {
		log.Warn("DEV TICKETS ARE ON: anyone can join with a \"dev:<name>\" ticket as any name. Never use -dev-tickets on a public server.")
	}

	// The regions tick until regionCtx ends, which is after every session has closed.
	regionCtx, stopRegions := context.WithCancel(context.Background())
	defer stopRegions()
	var ticking sync.WaitGroup
	interval := time.Second / time.Duration(hz)
	for _, r := range regions {
		ticking.Go(func() { r.Run(regionCtx, interval) })
	}
	srv := world.New(wcfg, spawn, regionCtx.Done(), log)

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	httpSrv := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.Serve(ln) }()
	log.Info("world server listening", "world", *worldID, "url", "ws://"+ln.Addr().String()+"/w/"+*worldID,
		"regions", len(regions), "spawn_region", spawn.ID(), "tick_hz", hz, "content_hash", data.Hash[:12])

	sigs, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stopSignals()
	select {
	case err := <-serveErr:
		return err
	case <-sigs.Done():
	}

	log.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Warn("http shutdown", "err", err)
	}
	if err := srv.Shutdown(ctx); err != nil {
		log.Warn("session shutdown", "err", err)
	}
	stopRegions()
	ticking.Wait()
	log.Info("stopped")
	return nil
}
