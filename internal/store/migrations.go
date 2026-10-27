package store

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Migrate applies all embedded migrations that have not yet been applied. It is
// safe to call on every startup.
func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`); err != nil {
		return fmt.Errorf("store: create schema_migrations: %w", err)
	}

	applied, err := s.appliedVersions(ctx)
	if err != nil {
		return err
	}

	migrations, err := loadMigrations()
	if err != nil {
		return err
	}

	for _, m := range migrations {
		if applied[m.version] {
			continue
		}
		if err := s.applyMigration(ctx, m); err != nil {
			return err
		}
	}
	// Uma versao gravada no meio de uma mudanca de schema (build intermediario)
	// pode ter deixado colunas de fora. Reconciliar no boot evita que uma
	// leitura de transcricao quebre em silencio e o dashboard fique sem texto.
	if err := s.ensureRevisionSchema(ctx); err != nil {
		return err
	}
	// Cores de tag antigas (ou criadas por clientes que so mandam o nome) usam a
	// mesma paleta deterministica do app e do dashboard.
	return s.backfillTagColors(ctx)
}

// ensureRevisionSchema cria o que a revisao da transcricao precisa quando a
// migracao 0018 foi gravada por um build anterior, antes de todas as colunas
// existirem. Idempotente: num banco em dia nao faz nada.
func (s *Store) ensureRevisionSchema(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS transcript_revisions (
			segment_id     TEXT PRIMARY KEY REFERENCES segments (id) ON DELETE CASCADE,
			transcript_id  TEXT NOT NULL REFERENCES transcripts (id) ON DELETE CASCADE,
			text           TEXT NOT NULL,
			model          TEXT NOT NULL,
			prompt_version INTEGER NOT NULL DEFAULT 0,
			literal        INTEGER NOT NULL DEFAULT 0,
			created_at     TEXT NOT NULL
		)`); err != nil {
		return fmt.Errorf("store: ensure transcript_revisions: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_transcript_revisions_transcript
			ON transcript_revisions (transcript_id)`); err != nil {
		return fmt.Errorf("store: ensure revision index: %w", err)
	}
	columns := []struct {
		table      string
		column     string
		definition string
	}{
		{"transcripts", "revised_text", "TEXT NOT NULL DEFAULT ''"},
		{"transcripts", "revised_model", "TEXT NOT NULL DEFAULT ''"},
		{"transcripts", "revised_prompt_version", "INTEGER NOT NULL DEFAULT 0"},
		{"transcripts", "revised_literal", "INTEGER NOT NULL DEFAULT 0"},
		{"transcripts", "revised_comprehension", "INTEGER NOT NULL DEFAULT -1"},
		{"transcripts", "revised_rejected", "INTEGER NOT NULL DEFAULT 0"},
		{"transcripts", "revised_through", "INTEGER NOT NULL DEFAULT 0"},
		{"transcripts", "revised_finished", "INTEGER NOT NULL DEFAULT 0"},
		{"segments", "user_edited", "INTEGER NOT NULL DEFAULT 0"},
		{"analyses", "comprehension", "INTEGER NOT NULL DEFAULT -1"},
		{"analyses", "comprehension_source", "TEXT NOT NULL DEFAULT ''"},
		{"analyses", "stutter_rate", "REAL NOT NULL DEFAULT 0"},
		{"analyses", "hesitation_rate", "REAL NOT NULL DEFAULT 0"},
		{"analyses", "revised_segments", "INTEGER NOT NULL DEFAULT 0"},
	}
	for _, c := range columns {
		exists, err := s.tableHasColumn(ctx, c.table, c.column)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := s.db.ExecContext(ctx,
			fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", c.table, c.column, c.definition)); err != nil {
			return fmt.Errorf("store: ensure %s.%s: %w", c.table, c.column, err)
		}
	}
	return nil
}

// tableHasColumn reports whether a table already has the column.
func (s *Store) tableHasColumn(ctx context.Context, table, column string) (bool, error) {
	rows, err := s.db.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return false, fmt.Errorf("store: table info %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, pk int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return false, fmt.Errorf("store: scan table info %s: %w", table, err)
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

type migration struct {
	version int
	name    string
	sql     string
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("store: read migrations: %w", err)
	}
	var out []migration
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		version, err := parseVersion(e.Name())
		if err != nil {
			return nil, err
		}
		content, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, fmt.Errorf("store: read migration %s: %w", e.Name(), err)
		}
		out = append(out, migration{version: version, name: e.Name(), sql: string(content)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

func parseVersion(name string) (int, error) {
	base := strings.SplitN(name, "_", 2)[0]
	v, err := strconv.Atoi(base)
	if err != nil {
		return 0, fmt.Errorf("store: invalid migration name %q", name)
	}
	return v, nil
}

func (s *Store) appliedVersions(ctx context.Context) (map[int]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("store: query schema_migrations: %w", err)
	}
	defer rows.Close()
	applied := make(map[int]bool)
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return nil, fmt.Errorf("store: scan version: %w", err)
		}
		applied[v] = true
	}
	return applied, rows.Err()
}

func (s *Store) applyMigration(ctx context.Context, m migration) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, m.sql); err != nil {
		return fmt.Errorf("store: apply %s: %w", m.name, err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		m.version, time.Now().UTC().Format(time.RFC3339)); err != nil {
		return fmt.Errorf("store: record %s: %w", m.name, err)
	}
	return tx.Commit()
}
