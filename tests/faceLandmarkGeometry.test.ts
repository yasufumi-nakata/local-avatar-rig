import { describe, expect, it } from "vitest";
import { measureLandmarkPair } from "../src/lib/faceLandmarkGeometry";
import { createFaceCalibration, mapFaceSampleToRigPose } from "../src/lib/facePoseMath";
import { NEUTRAL_FACE_RIG_POSE } from "../src/lib/faceRigPose";

const cameraSizes = [
  { name: "square", width: 800, height: 800 },
  { name: "4:3", width: 800, height: 600 },
  { name: "16:9", width: 800, height: 450 },
  { name: "portrait", width: 800, height: 1200 },
];

describe.each(cameraSizes)("face landmarks from a $name camera", (image) => {
  const point = (x: number, y: number) => ({ x: x / image.width, y: y / image.height });

  it("measures a 3-4-5 eye line in image coordinates, independently of aspect ratio", () => {
    // These pixel coordinates are 80 px apart horizontally and 60 px vertically.
    const eyeLine = measureLandmarkPair(point(260, 170), point(340, 230), image);
    expect(eyeLine.angleDegrees).toBeCloseTo(36.86989764584402, 10);
    expect(eyeLine.distance).toBeCloseTo(100 / image.width, 12);

    const oppositeTilt = measureLandmarkPair(point(260, 230), point(340, 170), image);
    expect(oppositeTilt.angleDegrees).toBeCloseTo(-36.86989764584402, 10);
    expect(oppositeTilt.distance).toBeCloseTo(eyeLine.distance, 12);
  });

  it("preserves face width and calibrated scale when the head only rolls", () => {
    // Both pairs span 200 px; the second is the same face width at a 3-4-5 tilt.
    const straight = measureLandmarkPair(point(200, 200), point(400, 200), image);
    const tilted = measureLandmarkPair(point(220, 140), point(380, 260), image);
    expect(straight.distance).toBeCloseTo(0.25, 12);
    expect(tilted.distance).toBeCloseTo(straight.distance, 12);

    const baseline = {
      ...NEUTRAL_FACE_RIG_POSE,
      centerX: 300 / image.width,
      centerY: 200 / image.height,
      faceWidth: straight.distance,
    };
    const { pose } = mapFaceSampleToRigPose({
      ...baseline,
      faceWidth: tilted.distance,
      roll: tilted.angleDegrees,
    }, createFaceCalibration(baseline));
    expect(pose.scale).toBeCloseTo(1, 12);
  });
});
