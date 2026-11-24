// Command protogen generates the network protocol codecs from protocol/messages.schema
// (ADR 0005): Go for the world server and GDScript for the client. Standard library only.
//
//	go run ./cmd/protogen            # regenerate (tools/protogen.sh)
//	go run ./cmd/protogen -check     # fail if the committed files are stale (tools/check.sh)
//
// Paths are relative to server/.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
)

func main() {
	schemaPath := flag.String("schema", "../protocol/messages.schema", "the schema file")
	goOut := flag.String("go", "internal/proto/messages_gen.go", "the Go codec to write")
	gdOut := flag.String("gd", "../client/net/proto/messages.gd", "the GDScript codec to write")
	check := flag.Bool("check", false, "don't write: exit 1 if the generated files are missing or stale")
	flag.Parse()
	if err := run(*schemaPath, *goOut, *gdOut, *check); err != nil {
		fmt.Fprintln(os.Stderr, "protogen:", err)
		os.Exit(1)
	}
}

func run(schemaPath, goOut, gdOut string, check bool) error {
	f, err := os.Open(schemaPath)
	if err != nil {
		return err
	}
	defer f.Close()
	s, err := Parse(f)
	if err != nil {
		return err
	}
	goSrc, err := GenGo(s)
	if err != nil {
		return err
	}
	outputs := []struct {
		path string
		src  []byte
	}{{goOut, goSrc}, {gdOut, GenGDScript(s)}}
	stale := 0
	for _, o := range outputs {
		old, err := os.ReadFile(o.path)
		if err == nil && bytes.Equal(old, o.src) {
			continue
		}
		if check {
			fmt.Fprintf(os.Stderr, "%s is stale: run tools/protogen.sh and commit the result\n", o.path)
			stale++
			continue
		}
		if err := os.WriteFile(o.path, o.src, 0o644); err != nil {
			return err
		}
		fmt.Println("wrote", o.path)
	}
	if stale > 0 {
		return fmt.Errorf("%d generated file(s) out of date", stale)
	}
	fmt.Printf("protocol ok: %d messages, hash %08x\n", len(s.Messages), s.Hash)
	return nil
}
