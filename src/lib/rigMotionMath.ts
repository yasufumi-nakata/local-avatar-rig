import type { FaceRigPose } from "./faceRigPose";

interface SpringValue {
  value: number;
  velocity: number;
}

export interface SecondaryMotionFrame {
  bodyX: number;
  bodyZ: number;
  hairFront: number;
  hairSide: number;
  hairBack: number;
}

const PHYSICS_STEP = 1 / 60;
const MAX_PHYSICS_ELAPSED = 0.1;
const BLINK_FIRST_START = 2_500;
const BLINK_BASE_INTERVAL = 4_300;
const BLINK_JITTER_SPAN = 1_200;
export const BLINK_CLOSE_MS = 52;
export const BLINK_HOLD_MS = 34;
export const BLINK_OPEN_MS = 96;
export const BLINK_DURATION_MS = BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS;

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function smoothMotionValue(current: number, target: number, tauMs: number, elapsedMs: number) {
  return current + (target - current) * (1 - Math.exp(-elapsedMs / tauMs));
}

function springStep(spring: SpringValue, target: number, stiffness: number, damping: number) {
  const acceleration = (target - spring.value) * stiffness - spring.velocity * damping;
  spring.velocity += acceleration * PHYSICS_STEP;
  spring.value += spring.velocity * PHYSICS_STEP;
}

function blinkJitter(cycle: number) {
  const value = Math.sin((cycle + 1) * 12.9898) * 43_758.5453;
  return (value - Math.floor(value) - 0.5) * BLINK_JITTER_SPAN;
}

export function blinkStartAt(cycle: number) {
  return BLINK_FIRST_START + cycle * BLINK_BASE_INTERVAL + blinkJitter(cycle);
}

/** 30fpsで約2フレームで閉じ、1フレーム保持、3フレームで開く瞬きです。 */
export function autoBlinkEnvelope(now: number) {
  if (now < 0) return 0;
  const approximateCycle = Math.max(0, Math.floor((now - BLINK_FIRST_START) / BLINK_BASE_INTERVAL));
  for (let cycle = Math.max(0, approximateCycle - 1); cycle <= approximateCycle + 1; cycle += 1) {
    const phase = now - blinkStartAt(cycle);
    if (phase < 0 || phase >= BLINK_DURATION_MS) continue;
    if (phase < BLINK_CLOSE_MS) return phase / BLINK_CLOSE_MS;
    if (phase < BLINK_CLOSE_MS + BLINK_HOLD_MS) return 1;
    return 1 - (phase - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS;
  }
  return 0;
}

/** RMSの実変化を使い、無音時や発話終了時に人工的な周期振動を残しません。 */
export function speechMouthTarget(speaking: boolean, audioLevel: number) {
  if (!speaking) return 0;
  return clamp(0.06 + Math.pow(clamp(audioLevel, 0, 1), 0.72) * 1.04, 0.06, 1);
}

/** 顔を向けた側へ視線が少し先行し、手動視線との合成後も範囲内へ収めます。 */
export function turnCoupledGaze(eyeX: number, yaw: number) {
  return clamp(eyeX + clamp(yaw / 30, -1, 1) * 0.34, -1, 1);
}

export class SecondaryMotionController {
  private readonly bodyX: SpringValue = { value: 0, velocity: 0 };
  private readonly bodyZ: SpringValue = { value: 0, velocity: 0 };
  private readonly hairFront: SpringValue = { value: 0, velocity: 0 };
  private readonly hairSide: SpringValue = { value: 0, velocity: 0 };
  private readonly hairBack: SpringValue = { value: 0, velocity: 0 };
  private accumulator = 0;
  private initialized = false;
  private previousYaw = 0;
  private previousPitch = 0;
  private previousRoll = 0;
  private pendingYawDelta = 0;
  private pendingPitchDelta = 0;
  private pendingRollDelta = 0;

  step(elapsedSeconds: number, pose: Pick<FaceRigPose, "yaw" | "pitch" | "roll">, enabled: boolean, breath: number): SecondaryMotionFrame {
    const bodyXTarget = clamp(pose.yaw * 0.22, -10, 10);
    const bodyZTarget = clamp(pose.roll * 0.30, -10, 10);

    if (!this.initialized) {
      this.previousYaw = pose.yaw;
      this.previousPitch = pose.pitch;
      this.previousRoll = pose.roll;
      this.initialized = true;
    } else {
      this.pendingYawDelta += pose.yaw - this.previousYaw;
      this.pendingPitchDelta += pose.pitch - this.previousPitch;
      this.pendingRollDelta += pose.roll - this.previousRoll;
      this.previousYaw = pose.yaw;
      this.previousPitch = pose.pitch;
      this.previousRoll = pose.roll;
    }

    if (!enabled) {
      this.bodyX.value = bodyXTarget;
      this.bodyX.velocity = 0;
      this.bodyZ.value = bodyZTarget;
      this.bodyZ.velocity = 0;
      for (const spring of [this.hairFront, this.hairSide, this.hairBack]) {
        spring.value = 0;
        spring.velocity = 0;
      }
      this.accumulator = 0;
      this.pendingYawDelta = 0;
      this.pendingPitchDelta = 0;
      this.pendingRollDelta = 0;
      return this.frame();
    }

    // 10fpsまで実時間に追従し、長い停止後も前フレームの端数を保持します。
    this.accumulator += clamp(elapsedSeconds, 0, MAX_PHYSICS_ELAPSED);
    let applyImpulse = true;
    while (this.accumulator + Number.EPSILON >= PHYSICS_STEP) {
      springStep(this.bodyX, bodyXTarget, 46, 13.5);
      springStep(this.bodyZ, bodyZTarget, 42, 12.5);

      const hairDriver = clamp(
        0.1724 * (pose.yaw / 30)
        + 0.3448 * (this.bodyZ.value / 10)
        + 0.2759 * (pose.pitch / 30)
        + 0.1379 * (this.bodyX.value / 10)
        + 0.0690 * breath,
        -1,
        1,
      );
      const impulse = applyImpulse
        ? clamp(
          -this.pendingYawDelta * 0.030
          - this.pendingPitchDelta * 0.018
          - this.pendingRollDelta * 0.024,
          -0.75,
          0.75,
        )
        : 0;
      springStep(this.hairFront, clamp(hairDriver * 2.5 + impulse, -2.5, 2.5), 18, 6.5);
      springStep(this.hairSide, clamp(hairDriver * 5.0 + impulse * 1.8, -5, 5), 14, 5.4);
      springStep(this.hairBack, clamp(hairDriver * 2.5 + impulse * 0.75, -2.5, 2.5), 11, 4.8);
      if (applyImpulse) {
        this.pendingYawDelta = 0;
        this.pendingPitchDelta = 0;
        this.pendingRollDelta = 0;
        applyImpulse = false;
      }
      this.accumulator = Math.max(0, this.accumulator - PHYSICS_STEP);
    }
    return this.frame();
  }

  private frame(): SecondaryMotionFrame {
    return {
      bodyX: this.bodyX.value,
      bodyZ: this.bodyZ.value,
      hairFront: this.hairFront.value,
      hairSide: this.hairSide.value,
      hairBack: this.hairBack.value,
    };
  }
}
