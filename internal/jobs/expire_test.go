package jobs

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestExpireStaleRetries(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	q := NewQueue(st.DB())

	oldID, err := q.Enqueue(ctx, TypeAnalyze, "velho", nil)
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	recentID, err := q.Enqueue(ctx, TypeAnalyze, "recente", nil)
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	old := time.Now().UTC().Add(-48 * time.Hour).Format(time.RFC3339)
	now := time.Now().UTC().Format(time.RFC3339)
	for id, when := range map[string]string{oldID: old, recentID: now} {
		if _, err := st.DB().ExecContext(ctx,
			`UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?`,
			string(StatusRetrying), when, id); err != nil {
			t.Fatalf("preparar retry: %v", err)
		}
	}

	expired, err := q.ExpireStaleRetries(ctx, 24*time.Hour)
	if err != nil {
		t.Fatalf("expire: %v", err)
	}
	if expired != 1 {
		t.Fatalf("expirados = %d, want 1", expired)
	}
	status := func(id string) string {
		var value string
		if err := st.DB().QueryRowContext(ctx, `SELECT status FROM jobs WHERE id = ?`, id).Scan(&value); err != nil {
			t.Fatalf("status: %v", err)
		}
		return value
	}
	if got := status(oldID); got != string(StatusDead) {
		t.Fatalf("job antigo = %q, want dead", got)
	}
	if got := status(recentID); got != string(StatusRetrying) {
		t.Fatalf("job recente = %q, deveria continuar retrying", got)
	}
}
