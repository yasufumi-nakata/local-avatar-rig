import { describe, expect, it } from "vitest";
import { createFaceCalibration, mapFaceSampleToRigPose, normalizeDegrees, type FaceTrackingSample } from "../src/lib/facePoseMath";

function sample(overrides: Partial<FaceTrackingSample> = {}): FaceTrackingSample {
  return {
    centerX: 0.5,
    centerY: 0.5,
    faceWidth: 0.25,
    x: 0,
    y: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    scale: 1,
    eyeX: 0,
    eyeY: 0,
    blinkLeft: 0,
    blinkRight: 0,
    mouthOpen: 0,
    smile: 0,
    ...overrides,
  };
}

describe("face pose coordinate mapping", () => {
  it("returns a neutral pose for the calibration frame", () => {
    const first = sample();
    const result = mapFaceSampleToRigPose(first, null);
    expect(result.calibration).toEqual(createFaceCalibration(first));
    expect(result.pose).toMatchObject({ x: -0, y: 0, yaw: -0, pitch: -0, roll: -0, scale: 1 });
  });

  it("mirrors horizontal movement, yaw and roll while keeping image-down y positive", () => {
    const baseline = createFaceCalibration(sample());
    const { pose } = mapFaceSampleToRigPose(sample({
      centerX: 0.6,
      centerY: 0.6,
      yaw: 12,
      pitch: 10,
      roll: 8,
    }), baseline);
    expect(pose.x).toBeLessThan(0);
    expect(pose.y).toBeGreaterThan(0);
    expect(pose.yaw).toBe(-12);
    expect(pose.pitch).toBe(-9);
    expect(pose.roll).toBe(-8);
  });

  it("clamps angles, scale and expression channels to the renderer contract", () => {
    const baseline = createFaceCalibration(sample());
    const { pose } = mapFaceSampleToRigPose(sample({
      faceWidth: 2,
      yaw: -120,
      pitch: 120,
      roll: -120,
      eyeX: 2,
      eyeY: -2,
      blinkLeft: 3,
      mouthOpen: -1,
      smile: 5,
    }), baseline);
    expect(pose).toMatchObject({ yaw: 30, pitch: -30, roll: 30, scale: 1.04, eyeX: 1, eyeY: -1, blinkLeft: 1, mouthOpen: 0, smile: 1 });
  });

  it("normalizes wrapped angles", () => {
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
  });
});
