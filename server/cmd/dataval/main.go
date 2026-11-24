// Command dataval validates the game content in data/ and can emit the client-safe subset (ADR 0011).
//
//	go run ./cmd/dataval -data ../data                          # validate only
//	go run ./cmd/dataval -data ../data -emit-client ../client/data
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
)

func main() {
	dataDir := flag.String("data", "../data", "the data/ directory")
	emitClient := flag.String("emit-client", "", "if set, write the client-safe data to this directory")
	flag.Parse()

	c, err := content.Load(*dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "data/ is invalid:\n%v\n", err)
		os.Exit(1)
	}
	if *emitClient != "" {
		if err := c.EmitClient(*emitClient); err != nil {
			fmt.Fprintf(os.Stderr, "emit client data: %v\n", err)
			os.Exit(1)
		}
	}
	fmt.Printf("data/ ok: %d skills, max level %d, content hash %s\n", len(c.Skills), c.Progression.MaxLevel, c.Hash[:12])
}
