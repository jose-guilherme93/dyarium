import { describe, expect, it } from "vitest";
import { rippleWaves, RIPPLE_INTERVAL_MS, RIPPLE_TOTAL_MS } from "./ripple";

describe("rippleWaves", () => {
  it("comeca no raio do no com a opacidade cheia", () => {
    const [first] = rippleWaves(0, 20);
    expect(first.radius).toBe(20);
    expect(first.alpha).toBeCloseTo(0.7);
    expect(first.lineWidth).toBeCloseTo(2.6);
  });

  it("expande e desbota conforme envelhece", () => {
    const [first] = rippleWaves(400, 20);
    const [later] = rippleWaves(1000, 20);
    expect(first.radius).toBeGreaterThan(20);
    expect(later.radius).toBeGreaterThan(first.radius);
    expect(later.alpha).toBeLessThan(first.alpha);
  });

  it("acende uma onda nova a cada intervalo", () => {
    expect(rippleWaves(0, 20)).toHaveLength(1);
    expect(rippleWaves(800, 20)).toHaveLength(2);
    expect(rippleWaves(1600, 20)).toHaveLength(3);
  });

  it("para sozinha depois da rajada", () => {
    expect(rippleWaves(RIPPLE_TOTAL_MS, 20)).toHaveLength(0);
  });

  it("deixa um intervalo parado entre uma rajada e a seguinte", () => {
    expect(RIPPLE_INTERVAL_MS).toBeGreaterThan(RIPPLE_TOTAL_MS);
    expect(rippleWaves(RIPPLE_INTERVAL_MS, 20)).toHaveLength(0);
  });
});
