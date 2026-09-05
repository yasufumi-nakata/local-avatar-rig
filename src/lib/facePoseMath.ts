import type { FaceRigPose } from "./faceRigPose";

export interface FaceTrackingSample extends FaceRigPose {
  centerX: number;
  centerY: number;
  faceWidth: number;
}

export interface FaceCalibration {
  centerX: number;
  centerY: number;
  faceWidth: number;
  yaw: number;
  pitch: number;
  roll: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeDegrees(value: number) {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
}

export function createFaceCalibration(sample: FaceTrackingSample): FaceCalibration {
  return {
    centerX: sample.centerX,
    centerY: sample.centerY,
    faceWidth: sample.faceWidth,
    yaw: sample.yaw,
    pitch: sample.pitch,
    roll: sample.roll,
  };
}

/**
 * MediaPipe/camera coordinates are converted to the mirrored renderer
 * axes consumed by the renderer. Returning the calibration makes this pure and
 * testable while the Worker remains responsible for calibration lifetime.
 */
export function mapFaceSampleToRigPose(
  sample: FaceTrackingSample,
  calibration: FaceCalibration | null,
): { pose: FaceRigPose; calibration: FaceCalibration } {
  const activeCalibration = calibration ?? createFaceCalibration(sample);
  const yawDelta = normalizeDegrees(sample.yaw - activeCalibration.yaw);
  const pitchDelta = normalizeDegrees(sample.pitch - activeCalibration.pitch);
  const rollDelta = normalizeDegrees(sample.roll - activeCalibration.roll);
  const scaleRatio = sample.faceWidth / Math.max(0.001, activeCalibration.faceWidth);

  return {
    calibration: activeCalibration,
    pose: {
      x: clamp(-(sample.centerX - activeCalibration.centerX) * 78, -11, 11),
      y: clamp((sample.centerY - activeCalibration.centerY) * 62, -8, 8),
      yaw: clamp(-yawDelta, -30, 30),
      pitch: clamp(-pitchDelta * 0.9, -30, 30),
      roll: clamp(-rollDelta, -30, 30),
      scale: clamp(1 + (scaleRatio - 1) * 0.16, 0.975, 1.04),
      eyeX: clamp(sample.eyeX, -1, 1),
      eyeY: clamp(sample.eyeY, -1, 1),
      blinkLeft: clamp(sample.blinkLeft, 0, 1),
      blinkRight: clamp(sample.blinkRight, 0, 1),
      mouthOpen: clamp(sample.mouthOpen, 0, 1),
      smile: clamp(sample.smile, 0, 1),
    },
  };
}
