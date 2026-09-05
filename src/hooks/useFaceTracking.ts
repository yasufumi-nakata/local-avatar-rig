import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { getStoredCameraDeviceId } from "../lib/cameraDevice";
import { NEUTRAL_FACE_RIG_POSE, type FaceRigPose } from "../lib/faceRigPose";

export type FaceTrackingStatus = "idle" | "loading" | "searching" | "tracking" | "error";

interface WorkerReadyMessage {
  type: "ready";
  delegate: "CPU" | "GPU";
  runtime: string;
  inferenceLocal: true;
}

interface WorkerPoseMessage {
  type: "pose";
  pose: FaceRigPose;
}

interface WorkerStatusMessage {
  type: "missing" | "frame-complete";
}

interface WorkerProgressMessage {
  type: "progress";
  message: string;
}

interface WorkerErrorMessage {
  type: "error";
  message: string;
}

type WorkerMessage = WorkerReadyMessage | WorkerPoseMessage | WorkerStatusMessage | WorkerProgressMessage | WorkerErrorMessage;

interface UseFaceTrackingOptions {
  rigRef: RefObject<HTMLDivElement>;
}

function mix(current: number, target: number, amount: number) {
  return current + (target - current) * amount;
}

function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return "顔追従用カメラが許可されていません。ブラウザとmacOSのカメラ許可をご確認ください。";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "顔追従に使えるカメラが見つかりませんでした。";
  }
  if (name === "NotReadableError") {
    return "カメラを他のアプリが使用中です。OBSやビデオ会議アプリをご確認ください。";
  }
  return `顔追従を開始できませんでした。${name ? `（${name}）` : ""}`;
}

function setRigPose(element: HTMLDivElement | null, pose: FaceRigPose, status: FaceTrackingStatus) {
  if (!element) return;
  element.dataset.faceTracking = status;
  element.style.setProperty("--rig-x", `${pose.x.toFixed(2)}px`);
  element.style.setProperty("--rig-y", `${pose.y.toFixed(2)}px`);
  element.style.setProperty("--rig-yaw", `${pose.yaw.toFixed(2)}deg`);
  element.style.setProperty("--rig-pitch", `${pose.pitch.toFixed(2)}deg`);
  element.style.setProperty("--rig-roll", `${pose.roll.toFixed(2)}deg`);
  element.style.setProperty("--rig-scale", pose.scale.toFixed(4));
  element.style.setProperty("--blink-left", pose.blinkLeft.toFixed(3));
  element.style.setProperty("--blink-right", pose.blinkRight.toFixed(3));
  element.style.setProperty("--smile", pose.smile.toFixed(3));
}

export function useFaceTracking({ rigRef }: UseFaceTrackingOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const animationRef = useRef(0);
  const sessionRef = useRef(0);
  const runningRef = useRef(false);
  const workerReadyRef = useRef(false);
  const frameInFlightRef = useRef(false);
  const capturePendingRef = useRef(false);
  const lastCaptureRef = useRef(0);
  const lastAnimationRef = useRef(0);
  const targetPoseRef = useRef<FaceRigPose>({ ...NEUTRAL_FACE_RIG_POSE });
  const currentPoseRef = useRef<FaceRigPose>({ ...NEUTRAL_FACE_RIG_POSE });
  const statusRef = useRef<FaceTrackingStatus>("idle");
  const mountedRef = useRef(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<FaceTrackingStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const supported = window.isSecureContext
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof Worker === "function"
    && typeof createImageBitmap === "function";

  const updateStatus = useCallback((nextStatus: FaceTrackingStatus, nextMessage: string | null) => {
    statusRef.current = nextStatus;
    setRigPose(rigRef.current, currentPoseRef.current, nextStatus);
    if (!mountedRef.current) return;
    setStatus((current) => current === nextStatus ? current : nextStatus);
    setMessage((current) => current === nextMessage ? current : nextMessage);
  }, [rigRef]);

  const stopResources = useCallback(() => {
    runningRef.current = false;
    workerReadyRef.current = false;
    frameInFlightRef.current = false;
    capturePendingRef.current = false;
    sessionRef.current += 1;
    window.cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    workerRef.current?.terminate();
    workerRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetPose = useCallback((nextStatus: FaceTrackingStatus = "idle") => {
    targetPoseRef.current = { ...NEUTRAL_FACE_RIG_POSE };
    currentPoseRef.current = { ...NEUTRAL_FACE_RIG_POSE };
    setRigPose(rigRef.current, currentPoseRef.current, nextStatus);
  }, [rigRef]);

  const stop = useCallback(() => {
    stopResources();
    resetPose("idle");
    if (mountedRef.current) setRunning(false);
    updateStatus("idle", null);
  }, [resetPose, stopResources, updateStatus]);

  const startAnimation = useCallback((sessionId: number) => {
    const render = (now: number) => {
      if (!runningRef.current || sessionId !== sessionRef.current) return;
      const previous = lastAnimationRef.current || now;
      const elapsed = Math.min(100, Math.max(0, now - previous));
      lastAnimationRef.current = now;
      const amount = 1 - Math.exp(-elapsed / 72);
      const current = currentPoseRef.current;
      const target = targetPoseRef.current;
      const next: FaceRigPose = {
        x: mix(current.x, target.x, amount),
        y: mix(current.y, target.y, amount),
        yaw: mix(current.yaw, target.yaw, amount),
        pitch: mix(current.pitch, target.pitch, amount),
        roll: mix(current.roll, target.roll, amount),
        scale: mix(current.scale, target.scale, amount),
        eyeX: mix(current.eyeX, target.eyeX, Math.min(1, amount * 1.45)),
        eyeY: mix(current.eyeY, target.eyeY, Math.min(1, amount * 1.45)),
        blinkLeft: mix(current.blinkLeft, target.blinkLeft, Math.min(1, amount * 2.7)),
        blinkRight: mix(current.blinkRight, target.blinkRight, Math.min(1, amount * 2.7)),
        mouthOpen: mix(current.mouthOpen, target.mouthOpen, Math.min(1, amount * 2.2)),
        smile: mix(current.smile, target.smile, amount),
      };
      currentPoseRef.current = next;
      setRigPose(rigRef.current, next, statusRef.current);

      const video = videoRef.current;
      const shouldCapture = workerReadyRef.current
        && !frameInFlightRef.current
        && !capturePendingRef.current
        && now - lastCaptureRef.current >= 42
        && video?.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA;
      if (shouldCapture && video) {
        capturePendingRef.current = true;
        lastCaptureRef.current = now;
        void createImageBitmap(video)
          .then((bitmap) => {
            capturePendingRef.current = false;
            const worker = workerRef.current;
            if (!worker || !runningRef.current || sessionId !== sessionRef.current) {
              bitmap.close();
              return;
            }
            frameInFlightRef.current = true;
            worker.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]);
          })
          .catch(() => {
            capturePendingRef.current = false;
          });
      }

      animationRef.current = window.requestAnimationFrame(render);
    };
    lastAnimationRef.current = 0;
    animationRef.current = window.requestAnimationFrame(render);
  }, [rigRef]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    if (!supported) {
      resetPose("error");
      updateStatus("error", "顔追従にはlocalhostまたはHTTPSと、対応ブラウザのカメラ機能が必要です。");
      return;
    }

    stopResources();
    const sessionId = sessionRef.current;
    runningRef.current = true;
    if (mountedRef.current) setRunning(true);
    updateStatus("loading", "顔追従を端末内で準備しています。正面を向いてお待ちください。");

    let stream: MediaStream | null = null;
    try {
      // モデルとカメラを独立して準備します。許可ダイアログや仮想カメラの
      // 初回フレームが遅い場合でも、WASMの読み込み状況を利用者へ返せます。
      const worker = new Worker(new URL("../workers/faceLandmarker.worker.ts", import.meta.url), {
        type: "module",
        name: "local-avatar-rig-face-landmarker",
      });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (!runningRef.current || sessionId !== sessionRef.current) return;
        const data = event.data;
        if (data.type === "ready") {
          workerReadyRef.current = true;
          if (streamRef.current) {
            updateStatus("searching", `顔を探しています（${data.delegate}・映像は端末内だけで処理）。`);
          } else {
            updateStatus("loading", "顔追従モデルの準備ができました。カメラを待っています。");
          }
          return;
        }
        if (data.type === "progress") {
          updateStatus("loading", data.message);
          return;
        }
        if (data.type === "frame-complete") {
          frameInFlightRef.current = false;
          return;
        }
        if (data.type === "pose") {
          targetPoseRef.current = data.pose;
          if (statusRef.current !== "tracking") {
            updateStatus("tracking", "顔追従中です。カメラ映像は保存・送信しません。");
          }
          return;
        }
        if (data.type === "missing") {
          targetPoseRef.current = { ...NEUTRAL_FACE_RIG_POSE };
          if (statusRef.current !== "searching") {
            updateStatus("searching", "顔を見失いました。カメラの中央へ戻ってください。");
          }
          return;
        }
        if (data.type === "error") {
          stopResources();
          resetPose("error");
          if (mountedRef.current) setRunning(false);
          updateStatus("error", `顔追従処理を開始できませんでした。${data.message ? `（${data.message}）` : ""}`);
        }
      };
      worker.onerror = () => {
        if (!runningRef.current || sessionId !== sessionRef.current) return;
        stopResources();
        resetPose("error");
        if (mountedRef.current) setRunning(false);
        updateStatus("error", "顔追従処理が停止しました。もう一度開始してください。");
      };
      worker.postMessage({ type: "init" });
      startAnimation(sessionId);

      const preferredDeviceId = getStoredCameraDeviceId();
      const cameraRequest = navigator.mediaDevices.getUserMedia({
        video: {
          ...(preferredDeviceId ? { deviceId: { ideal: preferredDeviceId } } : {}),
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });
      // タイムアウト後に遅れて許可されたストリームも必ず解放します。
      void cameraRequest.then((candidate) => {
        if (!runningRef.current || sessionId !== sessionRef.current) {
          candidate.getTracks().forEach((track) => track.stop());
        }
      }).catch(() => undefined);
      // ブラウザ側の許可UIが応答しない場合にも、押下状態を永久に残しません。
      let cameraTimeoutId = 0;
      stream = await Promise.race([
        cameraRequest,
        new Promise<never>((_resolve, reject) => {
          cameraTimeoutId = window.setTimeout(() => {
            reject(new Error("顔追従用カメラの準備が時間内に完了しませんでした。"));
          }, 15_000);
        }),
      ]).finally(() => {
        if (cameraTimeoutId) window.clearTimeout(cameraTimeoutId);
      });
      if (!runningRef.current || sessionId !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (streamRef.current !== stream) return;
          stopResources();
          resetPose("error");
          if (mountedRef.current) setRunning(false);
          updateStatus("error", "顔追従用カメラの接続が終了しました。もう一度開始してください。");
        }, { once: true });
      }

      const video = videoRef.current;
      if (!video) throw new Error("顔追従用の映像を準備できませんでした。");
      video.srcObject = stream;
      // 一部の仮想カメラは最初のフレームが来るまで play() を保留します。
      // モデル初期化は映像の到着を待たずに進め、フレーム取得側で readyState を確認します。
      const playback = video.play();
      updateStatus(workerReadyRef.current ? "searching" : "loading", workerReadyRef.current
        ? "顔を探しています（CPU・映像は端末内だけで処理）。"
        : "カメラの準備ができました。顔追従モデルを初期化しています。");
      void playback.catch((error: unknown) => {
        if (!runningRef.current || sessionId !== sessionRef.current) return;
        stopResources();
        resetPose("error");
        if (mountedRef.current) setRunning(false);
        updateStatus("error", cameraErrorMessage(error));
      });
    } catch (error) {
      if (stream && streamRef.current !== stream) stream.getTracks().forEach((track) => track.stop());
      // 停止直後に再開始した場合、旧getUserMediaの拒否・timeoutが遅れても
      // 新しいWorkerとstreamへ干渉させません。
      if (sessionId !== sessionRef.current) return;
      stopResources();
      resetPose("error");
      if (mountedRef.current) setRunning(false);
      updateStatus("error", error instanceof Error && !(error instanceof DOMException)
        ? error.message
        : cameraErrorMessage(error));
    }
  }, [resetPose, startAnimation, stopResources, supported, updateStatus]);

  useEffect(() => {
    mountedRef.current = true;
    setRigPose(rigRef.current, NEUTRAL_FACE_RIG_POSE, "idle");
    return () => {
      mountedRef.current = false;
      stopResources();
      resetPose("idle");
    };
  }, [resetPose, rigRef, stopResources]);

  return {
    videoRef,
    poseRef: currentPoseRef,
    supported,
    running,
    status,
    message,
    start,
    stop,
  };
}
