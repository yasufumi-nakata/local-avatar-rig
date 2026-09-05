import { describe, expect, it } from "vitest";
import { mapBlendshapeScoresToExpression } from "../src/lib/faceExpressionMath";

describe("MediaPipe blendshape mapping", () => {
  it("keeps left and right eyelid channels independent", () => {
    const leftOnly = mapBlendshapeScoresToExpression(new Map([
      ["eyeBlinkLeft", 0.8],
      ["eyeBlinkRight", 0.08],
    ]));
    const rightOnly = mapBlendshapeScoresToExpression(new Map([
      ["eyeBlinkLeft", 0.08],
      ["eyeBlinkRight", 0.8],
    ]));

    expect(leftOnly).toMatchObject({ blinkLeft: 1, blinkRight: 0 });
    expect(rightOnly).toMatchObject({ blinkLeft: 0, blinkRight: 1 });
  });

  it("maps jaw, funnel, smile and gaze scores into bounded renderer channels", () => {
    const expression = mapBlendshapeScoresToExpression(new Map([
      ["jawOpen", 1],
      ["mouthFunnel", 1],
      ["mouthSmileLeft", 1],
      ["mouthSmileRight", 1],
      ["eyeLookOutLeft", 1],
      ["eyeLookInRight", 1],
      ["eyeLookUpLeft", 1],
      ["eyeLookUpRight", 1],
    ]));

    expect(expression).toMatchObject({ mouthOpen: 1, smile: 1, eyeX: 1, eyeY: 1 });
  });

  it("returns neutral values when MediaPipe omits optional categories", () => {
    expect(mapBlendshapeScoresToExpression(new Map())).toEqual({
      eyeX: 0,
      eyeY: 0,
      blinkLeft: 0,
      blinkRight: 0,
      mouthOpen: 0,
      smile: 0,
    });
  });
});
