// Command sitegen builds the static wiki and dev docs site (ADR 0012).
//
//	cd server && go run ./cmd/sitegen -root .. -out ../build/site
//
// It writes <out>/wiki/ (published wiki pages only) and <out>/dev/ (all of docs/
// plus a preview of every wiki page). tools/build-site.sh is the usual way to run it.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/sitegen"
)

func main() {
	root := flag.String("root", "..", "repository root (holds wiki/, docs/ and site/)")
	out := flag.String("out", "", "output folder (default <root>/build/site)")
	theme := flag.String("theme", "", "theme folder (default <root>/site)")
	repoURL := flag.String("repo-url", "https://github.com/TomBResearch/UntitledDinosaurGame/blob/main", "where /dev/ links to repo files outside docs/ and wiki/")
	flag.Parse()
	if *out == "" {
		*out = filepath.Join(*root, "build", "site")
	}
	if *theme == "" {
		*theme = filepath.Join(*root, "site")
	}

	start := time.Now()
	stats, err := sitegen.Build(sitegen.Config{Root: *root, Out: *out, Theme: *theme, RepoURL: *repoURL})
	if err != nil {
		var problems sitegen.Problems
		if errors.As(err, &problems) {
			fmt.Fprintf(os.Stderr, "Site build failed with %d problem(s):\n", len(problems))
			for _, p := range problems {
				fmt.Fprintln(os.Stderr, "  "+p)
			}
		} else {
			fmt.Fprintln(os.Stderr, "Site build failed:", err)
		}
		os.Exit(1)
	}
	for _, w := range stats.Warnings {
		fmt.Fprintln(os.Stderr, "warning: "+w)
	}
	fmt.Printf("Site built in %dms: /wiki/ has %d published page(s) (%d draft(s) left out), /dev/ has %d page(s). Output: %s\n",
		time.Since(start).Milliseconds(), stats.WikiPublished, stats.WikiDrafts, stats.DevPages, *out)
}
