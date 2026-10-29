package jobs

import (
	"testing"
	"time"
)

func TestPresenceExpiresAndPrefersBrowser(t *testing.T) {
	clock := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	presence := NewPresence(60 * time.Second)
	presence.now = func() time.Time { return clock }

	if presence.Preferred() {
		t.Fatal("registry started preferred")
	}
	presence.Register(WorkerInfo{ID: "worker-a", Kind: WorkerKindBrowser, PreferClient: true})
	if !presence.Preferred() {
		t.Fatal("a preferred browser must pause the server runner")
	}
	if len(presence.List()) != 1 {
		t.Fatalf("workers = %d, want 1", len(presence.List()))
	}

	// A closed tab stops beating: after the TTL the server owns the queue again.
	clock = clock.Add(61 * time.Second)
	if presence.Preferred() {
		t.Fatal("expired worker still preferred")
	}
	if presence.Any() {
		t.Fatal("expired worker still listed")
	}

	// A worker that is downloading models registers without prefer_client and
	// must not hold the queue.
	presence.Register(WorkerInfo{ID: "worker-b", Kind: WorkerKindBrowser, PreferClient: false})
	if presence.Preferred() {
		t.Fatal("a downloading worker must not pause the server")
	}
	if !presence.Any() {
		t.Fatal("downloading worker should still be listed")
	}
}

func TestPresenceTouchAndUnregister(t *testing.T) {
	clock := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	presence := NewPresence(30 * time.Second)
	presence.now = func() time.Time { return clock }

	presence.Register(WorkerInfo{ID: "tab-1", PreferClient: true, Models: []string{"whisper-small"}})
	clock = clock.Add(20 * time.Second)
	if _, ok := presence.Touch("tab-1"); !ok {
		t.Fatal("touch failed for a registered worker")
	}
	clock = clock.Add(20 * time.Second)
	if !presence.Preferred() {
		t.Fatal("heartbeat should have extended presence")
	}

	presence.SetJob("tab-1", "job-1")
	workers := presence.List()
	if len(workers) != 1 || workers[0].CurrentJob != "job-1" {
		t.Fatalf("current job not recorded: %+v", workers)
	}

	presence.Unregister("tab-1")
	if presence.Any() {
		t.Fatal("unregister kept the worker")
	}
	if _, ok := presence.Touch("tab-1"); ok {
		t.Fatal("touch after unregister should fail")
	}
}
