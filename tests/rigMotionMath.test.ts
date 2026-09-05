import { describe, expect, it } from "vitest";
import {
  autoBlinkEnvelope,
  BLINK_DURATION_MS,
  blinkStartAt,
  SecondaryMotionController,
  speechMouthTarget,
  turnCoupledGaze,
} from "../src/lib/rigMotionMath";

describe("rig motion curves", () => {
  it("keeps automatic blinks short and separates their onsets", () => {
    expect(autoBlinkEnvelope(0)).toBe(0);
    const starts = Array.from({ length: 12 }, (_, cycle) => blinkStartAt(cycle));
    const gaps = starts.slice(1).map((start, index) => start - starts[index]);

    expect(BLINK_DURATION_MS).toBeLessThanOrEqual(200);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3_100);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5_500);
    for (const start of starts) {
      expect(autoBlinkEnvelope(start)).toBe(0);
      expect(autoBlinkEnvelope(start + 60)).toBe(1);
      expect(autoBlinkEnvelope(start + BLINK_DURATION_MS + 1)).toBe(0);
    }
  });

  it("maps real RMS levels to bounded speech targets without a synthetic idle pulse", () => {
    expect(speechMouthTarget(false, 1)).toBe(0);
    expect(speechMouthTarget(true, 0)).toBeCloseTo(0.06);
    expect(speechMouthTarget(true, 0.2)).toBeGreaterThan(0.3);
    expect(speechMouthTarget(true, 1)).toBe(1);
  });

  it("leads gaze toward the face turn and preserves manual clamping", () => {
    expect(turnCoupledGaze(0, -30)).toBeCloseTo(-0.34);
    expect(turnCoupledGaze(0, 30)).toBeCloseTo(0.34);
    expect(turnCoupledGaze(0.9, 30)).toBe(1);
    expect(turnCoupledGaze(-0.9, -30)).toBe(-1);
  });
});

describe("secondary motion controller", () => {
  it("keeps the manual motion-off pose deterministic while retaining shoulder follow", () => {
    const controller = new SecondaryMotionController();
    const frame = controller.step(1 / 60, { yaw: 24, pitch: 0, roll: 0 }, false, 0);

    expect(frame.bodyX).toBeCloseTo(5.28);
    expect(frame.bodyZ).toBe(0);
    expect(frame.hairFront).toBe(0);
    expect(frame.hairSide).toBe(0);
    expect(frame.hairBack).toBe(0);
  });

  it("produces comparable hair peaks at 30, 60 and 120fps", () => {
    const simulate = (fps: number) => {
      const controller = new SecondaryMotionController();
      let peak = 0;
      let frame = controller.step(1 / fps, { yaw: 0, pitch: 0, roll: 0 }, true, 0);
      for (let index = 1; index <= fps * 2; index += 1) {
        const yaw = index / fps >= 0.2 ? 24 : 0;
        frame = controller.step(1 / fps, { yaw, pitch: 0, roll: 0 }, true, 0);
        peak = Math.max(peak, Math.abs(frame.hairSide));
      }
      return { peak, settled: frame.hairSide, body: frame.bodyX };
    };
    const samples = [30, 60, 120].map(simulate);

    expect(Math.max(...samples.map(({ peak }) => peak)) - Math.min(...samples.map(({ peak }) => peak))).toBeLessThan(0.18);
    expect(Math.max(...samples.map(({ settled }) => settled)) - Math.min(...samples.map(({ settled }) => settled))).toBeLessThan(0.08);
    expect(Math.max(...samples.map(({ body }) => body)) - Math.min(...samples.map(({ body }) => body))).toBeLessThan(0.08);
  });
});
