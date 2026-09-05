import type { FaceRigPose } from "./faceRigPose";

export type FaceExpressionChannels = Pick<
  FaceRigPose,
  "eyeX" | "eyeY" | "blinkLeft" | "blinkRight" | "mouthOpen" | "smile"
>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * MediaPipeのARKit互換blendshape名を、描画側の0..1表情チャンネルへ変換します。
 * 左右のまぶたは混ぜずに保持し、片目閉じを独立制御できるようにします。
 */
export function mapBlendshapeScoresToExpression(
  scores: ReadonlyMap<string, number>,
): FaceExpressionChannels {
  const blinkLeft = clamp(((scores.get("eyeBlinkLeft") ?? 0) - 0.08) / 0.72, 0, 1);
  const blinkRight = clamp(((scores.get("eyeBlinkRight") ?? 0) - 0.08) / 0.72, 0, 1);
  const jawOpen = scores.get("jawOpen") ?? 0;
  const mouthFunnel = scores.get("mouthFunnel") ?? 0;
  const mouthOpen = clamp((Math.max(jawOpen, mouthFunnel * 0.72) - 0.035) / 0.58, 0, 1);
  const smile = clamp(
    ((scores.get("mouthSmileLeft") ?? 0) + (scores.get("mouthSmileRight") ?? 0)) / 1.35,
    0,
    1,
  );
  const eyeX = clamp((
    (scores.get("eyeLookOutLeft") ?? 0)
    + (scores.get("eyeLookInRight") ?? 0)
    - (scores.get("eyeLookInLeft") ?? 0)
    - (scores.get("eyeLookOutRight") ?? 0)
  ) * 1.15, -1, 1);
  const eyeY = clamp((
    (scores.get("eyeLookUpLeft") ?? 0)
    + (scores.get("eyeLookUpRight") ?? 0)
    - (scores.get("eyeLookDownLeft") ?? 0)
    - (scores.get("eyeLookDownRight") ?? 0)
  ) * 0.9, -1, 1);

  return { eyeX, eyeY, blinkLeft, blinkRight, mouthOpen, smile };
}
