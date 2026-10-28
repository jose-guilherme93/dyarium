package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/joseti/dyarium/internal/store"
)

// dedupe is the maintenance command that merges notes which are duplicates of
// the same audio into a single one. It is destructive, so it accepts --dry-run
// to preview. It reads only the storage paths from the environment (mirroring
// the config defaults) so it does not require the token or the master key.
func dedupe(dryRun bool) error {
	dbPath := envOr("DIARY_DB_PATH", "data/diary.db")
	dataDir := envOr("DIARY_DATA_DIR", "data")

	st, err := store.Open(dbPath)
	if err != nil {
		return err
	}
	defer st.Close()

	ctx := context.Background()
	if err := st.Migrate(ctx); err != nil {
		return err
	}
	report, err := st.DeduplicateEntries(ctx, dryRun)
	if err != nil {
		return err
	}

	fmt.Printf("notas duplicadas mescladas: %d\n", report.Merged)
	if dryRun {
		fmt.Printf("objetos redundantes a remover: %d\n", len(report.RemovedObjects))
		fmt.Println("simulacao: nada foi alterado")
		return nil
	}

	removed, failed := 0, 0
	for _, key := range report.RemovedObjects {
		if err := os.Remove(filepath.Join(dataDir, key)); err != nil && !os.IsNotExist(err) {
			failed++
			continue
		}
		removed++
	}
	fmt.Printf("objetos redundantes removidos: %d\n", removed)
	if failed > 0 {
		fmt.Printf("objetos que nao foi possivel remover: %d\n", failed)
	}
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
