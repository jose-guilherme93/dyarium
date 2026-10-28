package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
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

// A 0.2.1 veio de uma linha paralela: a versao 6 era a analise rica, nao o
// multi-audio. Este teste monta exatamente esse banco e garante que o Migrate
// atual reconcilia as colunas que faltam antes de chegar na 0012.
func TestMigrateFromLegacyReleaseLine(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	if _, err := s.DB().ExecContext(ctx,
		`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		t.Fatalf("schema_migrations: %v", err)
	}
	migrations, err := loadMigrations()
	if err != nil {
		t.Fatalf("load migrations: %v", err)
	}
	// Aplica o schema comum ate a analise rica (versao 5 na linha atual).
	for _, m := range migrations {
		if m.version > 5 {
			break
		}
		if err := s.applyMigration(ctx, m); err != nil {
			t.Fatalf("apply %s: %v", m.name, err)
		}
	}
	// A linha antiga gravou a analise rica como versao 6. A 0006 atual
	// (multi-audio) nunca rodou, entao uploads.entry_id nao existe.
	if _, err := s.DB().ExecContext(ctx,
		`INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)`,
		time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatalf("registrar versao 6: %v", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for _, statement := range []string{
		`INSERT INTO entries (id, status, source, duration_seconds, created_at, updated_at)
		 VALUES ('e_legacy', 'ready', 'upload', 12, '` + now + `', '` + now + `')`,
		`INSERT INTO attachments (id, entry_id, kind, storage_key, created_at)
		 VALUES ('a_legacy', 'e_legacy', 'original', 'objects/a', '` + now + `')`,
		`INSERT INTO transcripts (id, entry_id, model, text, created_at)
		 VALUES ('t_legacy', 'e_legacy', 'whisper', 'fala antiga', '` + now + `')`,
	} {
		if _, err := s.DB().ExecContext(ctx, statement); err != nil {
			t.Fatalf("semear banco antigo: %v", err)
		}
	}

	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate legacy: %v", err)
	}

	for _, column := range [][2]string{
		{"uploads", "entry_id"},
		{"attachments", "duration_seconds"},
		{"transcripts", "attachment_id"},
		{"uploads", "author"},
	} {
		ok, err := s.tableHasColumn(ctx, column[0], column[1])
		if err != nil {
			t.Fatalf("has column: %v", err)
		}
		if !ok {
			t.Fatalf("coluna %s.%s nao foi criada", column[0], column[1])
		}
	}

	var attachmentID string
	if err := s.DB().QueryRowContext(ctx,
		`SELECT attachment_id FROM transcripts WHERE id = 't_legacy'`).Scan(&attachmentID); err != nil {
		t.Fatalf("transcricao: %v", err)
	}
	if attachmentID != "a_legacy" {
		t.Fatalf("transcricao nao foi ligada ao audio: %q", attachmentID)
	}
	var duration float64
	if err := s.DB().QueryRowContext(ctx,
		`SELECT duration_seconds FROM attachments WHERE id = 'a_legacy'`).Scan(&duration); err != nil {
		t.Fatalf("duracao: %v", err)
	}
	if duration != 12 {
		t.Fatalf("duracao = %v, queria 12", duration)
	}
	var indexes int
	if err := s.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_entries_sha256_active'`).Scan(&indexes); err != nil {
		t.Fatalf("indice antigo: %v", err)
	}
	if indexes != 1 {
		t.Fatal("indice da linha antiga nao foi recriado")
	}

	// A segunda subida nao repete nada nem quebra.
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate legacy de novo: %v", err)
	}
}
