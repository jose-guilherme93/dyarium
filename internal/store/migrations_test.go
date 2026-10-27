package store

import (
	"context"
	"path/filepath"
	"testing"
)

// Um build intermediario pode ter gravado a migracao 0018 antes de todas as
// colunas existirem. O boot reconcilia: sem isso, a leitura da transcricao falha
// e o dashboard mostra todos os audios sem texto.
func TestMigrateReconcilesRevisionColumns(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "drift.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// Simula o banco que ficou sem as colunas, com a versao 18 ja registrada.
	for _, statement := range []string{
		`ALTER TABLE transcripts DROP COLUMN revised_text`,
		`ALTER TABLE transcripts DROP COLUMN revised_comprehension`,
		`ALTER TABLE segments DROP COLUMN user_edited`,
	} {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			t.Fatalf("derrubar coluna: %v", err)
		}
	}
	s.Close()

	s, err = Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate 2: %v", err)
	}

	for _, column := range [][2]string{
		{"transcripts", "revised_text"},
		{"transcripts", "revised_comprehension"},
		{"segments", "user_edited"},
	} {
		ok, err := s.tableHasColumn(ctx, column[0], column[1])
		if err != nil {
			t.Fatalf("has column: %v", err)
		}
		if !ok {
			t.Fatalf("coluna %s.%s nao foi reconciliada", column[0], column[1])
		}
	}
}
