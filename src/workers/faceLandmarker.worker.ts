import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  Matrix,
} from "@mediapipe/tasks-vision";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import { mapBlendshapeScoresToExpression } from "../lib/faceExpressionMath";
import { createRestrictedWorkerFetch, fetchVerifiedFaceModel } from "../lib/faceModel";
import { measureLandmarkPair, measureLandmarkSpan } from "../lib/faceLandmarkGeometry";
import type { FaceRigPose } from "../lib/faceRigPose";
import {
  mapFaceSampleToRigPose,
  type FaceCalibration,
  type FaceTrackingSample,
} from "../lib/facePoseMath";

interface InitMessage {
  type: "init";
}

interface FrameMessage {
  type: "frame";
  bitmap: ImageBitmap;
  timestamp: number;
}

type IncomingMessage = InitMessage | FrameMessage;

type FaceSample = FaceTrackingSample;

let landmarker: FaceLandmarker | null = null;
let calibration: FaceCalibration | null = null;
let initializing: Promise<void> | null = null;
const workerRuntime = "local-avatar-rig-local-wasm-v3";

// Workerからの外部通信は、利用者が顔追従を開始した後の固定モデル取得だけを許可します。
// それ以外の計測・遠隔API要求は成功応答へ置換して外へ出しません。
const nativeFetch = self.fetch.bind(self);
const nativeConsoleWarn = self.console.warn.bind(self.console);
const nativeConsoleError = self.console.error.bind(self.console);
self.console.warn = ((...args: unknown[]) => {
  const message = args.map(String).join(" ");
  if (/FaceBlendshapesGraph acceleration|OpenGL error checking is disabled|Feedback manager requires a model with a single signature/u.test(message)) {
    return;
  }
  nativeConsoleWarn(...args);
}) as typeof console.warn;
self.console.error = ((...args: unknown[]) => {
  const message = args.map(String).join(" ");
  if (/Created TensorFlow Lite XNNPACK delegate for CPU/u.test(message)) return;
  nativeConsoleError(...args);
}) as typeof console.error;

self.fetch = createRestrictedWorkerFetch(nativeFetch, self.location.href);

async function assertNetworkPolicy() {
  const probe = await fetch("https://local-avatar-rig.invalid/__local_only_probe__", { method: "POST" });
  if (probe.headers.get("x-local-avatar-rig-local-only") !== "blocked") {
    throw new Error("顔追従のローカル通信制限を確認できませんでした。");
  }
}

function scoreMap(result: FaceLandmarkerResult) {
  return new Map(
    (result.faceBlendshapes[0]?.categories ?? []).map((category) => [category.categoryName, category.score]),
  );
}

// MediaPipe exposes the 4x4 pose matrix in column-major order. We only use
// its rotation component, then calibrate it against the first centered frame.
function eulerDegrees(matrix: Matrix | undefined) {
  if (!matrix || matrix.data.length < 11) return null;
  const values = matrix.data;
  const pitch = Math.atan2(values[6], values[10]);
  const yaw = Math.atan2(-values[2], Math.hypot(values[6], values[10]));
  const roll = Math.atan2(values[1], values[0]);
  const toDegrees = 180 / Math.PI;
  return {
    pitch: pitch * toDegrees,
    yaw: yaw * toDegrees,
    roll: roll * toDegrees,
  };
}

function readSample(result: FaceLandmarkerResult, image: { width: number; height: number }): FaceSample | null {
  const landmarks = result.faceLandmarks[0];
  if (!landmarks || landmarks.length < 455) return null;

  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  const forehead = landmarks[10];
  const chin = landmarks[152];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const nose = landmarks[1];
  if (!leftTemple || !rightTemple || !forehead || !chin || !leftEye || !rightEye || !nose) return null;

  const centerX = (leftTemple.x + rightTemple.x) / 2;
  const centerY = (forehead.y + chin.y) / 2;
  const faceWidth = Math.max(0.001, measureLandmarkSpan(leftTemple, rightTemple, image));
  const eyeLine = measureLandmarkPair(leftEye, rightEye, image);
  const eyesWidth = Math.max(0.001, eyeLine.distance);
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeRoll = eyeLine.angleDegrees;
  const noseYaw = ((nose.x - eyeMidX) / eyesWidth) * 42;
  const rotation = eulerDegrees(result.facialTransformationMatrixes[0]);
  const scores = scoreMap(result);
  const expression = mapBlendshapeScoresToExpression(scores);

  return {
    centerX,
    centerY,
    faceWidth,
    x: 0,
    y: 0,
    yaw: rotation?.yaw ?? noseYaw,
    pitch: rotation?.pitch ?? 0,
    // The eye line is steadier than the matrix for small illustrated-avatar tilts.
    // Both fall back to the same image-space sign: the matrix rotates about the
    // camera's +Z (up is +Y), so its roll is the negative of the eye-line angle
    // measured on the image (where y grows downwards).
    roll: Number.isFinite(eyeRoll) ? eyeRoll : -(rotation?.roll ?? 0),
    scale: 1,
    ...expression,
  };
}

function toRigPose(sample: FaceSample): FaceRigPose {
  const mapped = mapFaceSampleToRigPose(sample, calibration);
  calibration = mapped.calibration;
  return mapped.pose;
}

async function createLandmarker() {
  await assertNetworkPolicy();
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  // WASMのローダーとバイナリは同一オリジンから読み込みます。
  const fileset = {
    wasmLoaderPath,
    wasmBinaryPath,
  };
  const commonOptions = {
    runningMode: "VIDEO" as const,
    numFaces: 1,
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  };
  postMessage({ type: "progress", message: "顔追従エンジンを読み込んでいます。" });
  const vision = await FilesetResolver.forVisionTasks(undefined, true);
  // forVisionTasks selects the module-capable runtime, while the explicit URLs
  // keep both loader and binary inside the local Vite build.
  const localFileset = { ...vision, ...fileset };

  postMessage({ type: "progress", message: "検証済み顔追従モデルを提供元から取得しています。" });
  const modelAssetBuffer = await fetchVerifiedFaceModel();
  postMessage({ type: "progress", message: "顔追従モデルを初期化しています。" });

  // The worker already keeps synchronous inference away from the UI thread.
  // CPU initialization is deterministic across Safari, Chromium and virtual
  // displays, while worker WebGL can remain pending indefinitely on some Macs.
  let timeoutId = 0;
  try {
    landmarker = await Promise.race([
      FaceLandmarker.createFromOptions(localFileset, {
        ...commonOptions,
        baseOptions: { modelAssetBuffer, delegate: "CPU" },
      }),
      new Promise<never>((_resolve, reject) => {
        timeoutId = self.setTimeout(() => {
          reject(new Error("顔追従モデルの初期化が時間内に完了しませんでした。"));
        }, 20_000);
      }),
    ]);
  } finally {
    if (timeoutId) self.clearTimeout(timeoutId);
  }
  postMessage({ type: "ready", delegate: "CPU", runtime: workerRuntime, inferenceLocal: true });
}

async function initialize() {
  landmarker?.close();
  landmarker = null;
  calibration = null;
  await createLandmarker();
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  if (event.data.type === "init") {
    if (!initializing) {
      initializing = initialize()
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "顔追従モデルを開始できませんでした。";
          postMessage({ type: "error", message });
        })
        .finally(() => {
          initializing = null;
        });
    }
    return;
  }

  const { bitmap, timestamp } = event.data;
  if (!landmarker) {
    bitmap.close();
    postMessage({ type: "frame-complete" });
    return;
  }

  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);
    const sample = readSample(result, bitmap);
    if (!sample) {
      // 見失っても正面の基準は保持します。再開始時のinitializeだけで校正を戻します。
      postMessage({ type: "missing" });
    } else {
      postMessage({ type: "pose", pose: toRigPose(sample) });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "顔の読み取りに失敗しました。";
    postMessage({ type: "error", message });
  } finally {
    bitmap.close();
    postMessage({ type: "frame-complete" });
  }
};
