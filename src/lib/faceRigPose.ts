/** Workerと表示側の間で受け渡す、描画ライブラリ非依存の軽量な顔リグ値です。 */
export interface FaceRigPose {
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
  eyeX: number;
  eyeY: number;
  blinkLeft: number;
  blinkRight: number;
  mouthOpen: number;
  smile: number;
}

export const NEUTRAL_FACE_RIG_POSE: FaceRigPose = {
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
};
