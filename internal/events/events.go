// Package events is a small in-memory publish/subscribe bus backing the SSE
// endpoint. It keeps a bounded ring of recent events so a reconnecting client
// can resume from Last-Event-ID.
package events

import (
	"encoding/json"
	"sync"
)

const ringSize = 256

// Event is a single server-sent event.
type Event struct {
	ID   int64
	Name string
	Data []byte
}

// Bus fans out events to subscribers.
type Bus struct {
	mu     sync.Mutex
	nextID int64
	ring   []Event
	subs   map[chan Event]struct{}
}

// NewBus builds an empty Bus.
func NewBus() *Bus {
	return &Bus{subs: map[chan Event]struct{}{}}
}

// Publish marshals payload and delivers the event to all subscribers.
func (b *Bus) Publish(name string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	b.mu.Lock()
	b.nextID++
	ev := Event{ID: b.nextID, Name: name, Data: data}
	b.ring = append(b.ring, ev)
	if len(b.ring) > ringSize {
		b.ring = b.ring[len(b.ring)-ringSize:]
	}
	subs := make([]chan Event, 0, len(b.subs))
	for ch := range b.subs {
		subs = append(subs, ch)
	}
	b.mu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- ev:
		default:
			// Slow consumer: drop the event rather than block publishers.
		}
	}
}

// Subscribe registers a new subscriber. The returned function unsubscribes.
func (b *Bus) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 32)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if _, ok := b.subs[ch]; ok {
			delete(b.subs, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}

// Since returns buffered events with an id greater than lastID.
func (b *Bus) Since(lastID int64) []Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []Event
	for _, ev := range b.ring {
		if ev.ID > lastID {
			out = append(out, ev)
		}
	}
	return out
}
