package store

import (
	"context"
	"fmt"
	"time"
)

// MetricsSnapshot is the last writing-metrics snapshot received from a device.
// Payload is the versioned snapshot document (see docs/api.md), kept as JSON so
// the app can evolve the metric set without a server migration.
type MetricsSnapshot struct {
	DeviceID      string
	DeviceName    string
	SchemaVersion int
	GeneratedAt   time.Time
	ReceivedAt    time.Time
	Payload       string
}

// SaveMetricsSnapshot upserts the snapshot of a device. The device is
// identified by an opaque id the app generates; the last one wins.
func (s *Store) SaveMetricsSnapshot(ctx context.Context, m MetricsSnapshot) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO metrics_snapshots (device_id, device_name, schema_version, generated_at, received_at, payload)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(device_id) DO UPDATE SET
			device_name = excluded.device_name,
			schema_version = excluded.schema_version,
			generated_at = excluded.generated_at,
			received_at = excluded.received_at,
			payload = excluded.payload`,
		m.DeviceID, m.DeviceName, m.SchemaVersion, ts(m.GeneratedAt), ts(m.ReceivedAt), m.Payload)
	if err != nil {
		return fmt.Errorf("store: save metrics snapshot: %w", err)
	}
	return nil
}

// ListMetricsSnapshots returns the last snapshot of each device, most recently
// received first.
func (s *Store) ListMetricsSnapshots(ctx context.Context, limit int) ([]MetricsSnapshot, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT device_id, COALESCE(device_name,''), schema_version, generated_at, received_at, payload
		FROM metrics_snapshots ORDER BY received_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list metrics snapshots: %w", err)
	}
	defer rows.Close()
	var out []MetricsSnapshot
	for rows.Next() {
		var m MetricsSnapshot
		var generatedAt, receivedAt string
		if err := rows.Scan(&m.DeviceID, &m.DeviceName, &m.SchemaVersion, &generatedAt, &receivedAt, &m.Payload); err != nil {
			return nil, fmt.Errorf("store: scan metrics snapshot: %w", err)
		}
		m.GeneratedAt = parseTS(generatedAt)
		m.ReceivedAt = parseTS(receivedAt)
		out = append(out, m)
	}
	return out, rows.Err()
}

// DeleteMetricsSnapshot removes the snapshot of a device. It returns ErrNotFound
// when the device has never sent metrics.
func (s *Store) DeleteMetricsSnapshot(ctx context.Context, deviceID string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM metrics_snapshots WHERE device_id = ?`, deviceID)
	if err != nil {
		return fmt.Errorf("store: delete metrics snapshot: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
