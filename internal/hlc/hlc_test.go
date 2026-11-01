package hlc

import (
	"testing"
	"time"
)

func fixedClock(t time.Time) *Clock {
	clock := NewClock("node-a")
	clock.wall = func() time.Time { return t }
	return clock
}

func TestNowIsStrictlyIncreasingWithinTheSameMillisecond(t *testing.T) {
	at := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	clock := fixedClock(at)
	first := clock.Now()
	second := clock.Now()
	if Compare(second, first) <= 0 {
		t.Fatalf("second stamp %q nao e maior que %q", second, first)
	}
	if first.Physical != second.Physical || second.Counter != first.Counter+1 {
		t.Fatalf("contador nao avancou: %+v %+v", first, second)
	}
}

func TestNowSurvivesTheWallClockSteppingBack(t *testing.T) {
	at := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	clock := fixedClock(at)
	first := clock.Now()
	clock.wall = func() time.Time { return at.Add(-time.Hour) }
	second := clock.Now()
	if Compare(second, first) <= 0 {
		t.Fatalf("stamp %q nao sobreviveu ao relogio voltar: %q", second, first)
	}
	if second.Physical != first.Physical {
		t.Fatalf("physical mudou ao voltar o relogio: %+v", second)
	}
}

func TestObserveMakesTheNextStampNewer(t *testing.T) {
	at := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	clock := fixedClock(at)
	remote := Timestamp{Physical: at.Add(time.Hour).UnixMilli(), Counter: 7, Node: "node-b"}
	clock.Observe(remote)
	next := clock.Now()
	if Compare(next, remote) <= 0 {
		t.Fatalf("stamp %q nao ficou depois do observado %q", next, remote)
	}
}

func TestObserveIgnoresOlderAndGarbageTokens(t *testing.T) {
	at := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	clock := fixedClock(at)
	issued := clock.Now()
	clock.ObserveToken("nao-e-versao")
	clock.Observe(issued)
	if Compare(clock.Last(), issued) != 0 {
		t.Fatalf("estado mudou com token invalido/antigo: %+v", clock.Last())
	}
}

func TestStringSortsLikeCompare(t *testing.T) {
	at := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	stamps := []Timestamp{
		{Physical: at.UnixMilli(), Counter: 0, Node: "a"},
		{Physical: at.UnixMilli(), Counter: 1, Node: "a"},
		{Physical: at.UnixMilli(), Counter: 1, Node: "b"},
		{Physical: at.UnixMilli() + 1, Counter: 0, Node: "a"},
	}
	for i := 1; i < len(stamps); i++ {
		if Compare(stamps[i-1], stamps[i]) >= 0 {
			t.Fatalf("ordem semantica quebrada em %d", i)
		}
		if !(stamps[i-1].String() < stamps[i].String()) {
			t.Fatalf("ordem textual diverge da semantica: %q %q", stamps[i-1], stamps[i])
		}
	}
}

func TestParseRoundTrip(t *testing.T) {
	stamp := Timestamp{Physical: 1761829200123, Counter: 42, Node: "instancia"}
	parsed, ok := Parse(stamp.String())
	if !ok {
		t.Fatalf("Parse falhou para %q", stamp)
	}
	if Compare(parsed, stamp) != 0 {
		t.Fatalf("round-trip mudou o stamp: %+v %+v", parsed, stamp)
	}
}

func TestParseLegacyTimestamp(t *testing.T) {
	legacy := "2026-10-30T12:00:00.123456789Z"
	parsed, ok := Parse(legacy)
	if !ok {
		t.Fatalf("Parse falhou para versao legada %q", legacy)
	}
	at, _ := time.Parse(time.RFC3339, legacy)
	if parsed.Physical != at.UnixMilli() || parsed.Counter != 0 || parsed.Node != "" {
		t.Fatalf("versao legada lida errado: %+v", parsed)
	}
}

func TestAfterComparesLegacyAndHybrid(t *testing.T) {
	legacy := "2026-10-30T12:00:00Z"
	later := Timestamp{Physical: time.Date(2026, 10, 30, 12, 0, 1, 0, time.UTC).UnixMilli(), Node: "x"}
	if !After(later.String(), legacy) {
		t.Fatalf("stamp novo %q deveria vencer a versao legada", later)
	}
	if After("", later.String()) || After("lixo", later.String()) {
		t.Fatal("token ilegivel nao pode vencer")
	}
	if After(legacy, legacy) {
		t.Fatal("mesmo token nao e mais novo")
	}
}
