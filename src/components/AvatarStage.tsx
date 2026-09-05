import { Download, Expand, Mic, MicOff, ScanFace, Sparkles } from "lucide-react";
import {
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type { FaceTrackingStatus } from "../hooks/useFaceTracking";
import type { FaceRigPose } from "../lib/faceRigPose";
import type { LocalAvatarAssetSet } from "../lib/modelPack";
import type { RigProfile } from "../lib/webglAvatarRenderer";
import { WebGLAvatar } from "./WebGLAvatar";

export type BackgroundMode = "scene" | "transparent" | "green" | "blue";

interface AvatarStageProps {
  rigRef: RefObject<HTMLDivElement>;
  poseRef: MutableRefObject<FaceRigPose>;
  assets: LocalAvatarAssetSet;
  profile: RigProfile;
  avatarAlt: string;
  motion: boolean;
  pointerFollow: boolean;
  backgroundMode: BackgroundMode;
  faceTracking: {
    videoRef: RefObject<HTMLVideoElement>;
    supported: boolean;
    running: boolean;
    status: FaceTrackingStatus;
    message: string | null;
    toggle: () => void;
  };
  microphone: {
    supported: boolean;
    starting: boolean;
    running: boolean;
    speaking: boolean;
    level: number;
    message: string | null;
    toggle: () => void;
  };
}

type AvatarStyle = CSSProperties & { "--look-x": string; "--look-y": string };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function paintSceneBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#06121a");
  base.addColorStop(0.48, "#0b2a37");
  base.addColorStop(1, "#081018");
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(
    width * 0.5,
    height * 0.35,
    0,
    width * 0.5,
    height * 0.35,
    width * 0.5,
  );
  glow.addColorStop(0, "rgba(55, 216, 197, 0.28)");
  glow.addColorStop(1, "rgba(55, 216, 197, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
}

export function AvatarStage({
  rigRef,
  poseRef,
  assets,
  profile,
  avatarAlt,
  motion,
  pointerFollow,
  backgroundMode,
  faceTracking,
  microphone,
}: AvatarStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const characterRef = useRef<HTMLImageElement>(null);
  const backgroundRef = useRef<HTMLImageElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);

  const enterFullscreen = useCallback(async () => {
    try {
      await stageRef.current?.requestFullscreen();
    } catch {
      setCaptureMessage("全画面表示を開始できませんでした。ブラウザ設定をご確認ください。");
    }
  }, []);

  const saveSnapshot = useCallback(async () => {
    const output = document.createElement("canvas");
    output.width = 1672;
    output.height = 941;
    const context = output.getContext("2d");
    if (!context) {
      setCaptureMessage("PNGを書き出せませんでした。");
      return;
    }
    if (backgroundMode === "scene") {
      if (assets.background && backgroundRef.current?.complete && backgroundRef.current.naturalWidth > 0) {
        context.drawImage(backgroundRef.current, 0, 0, output.width, output.height);
      } else {
        paintSceneBackground(context, output.width, output.height);
      }
    } else if (backgroundMode === "green" || backgroundMode === "blue") {
      context.fillStyle = backgroundMode === "green" ? "#00b140" : "#0047bb";
      context.fillRect(0, 0, output.width, output.height);
    }

    const rigCanvas = canvasRef.current;
    const fallback = characterRef.current;
    if (rigCanvas?.dataset.rigReady === "true" && rigCanvas.width > 0) {
      context.drawImage(rigCanvas, 0, 0, output.width, output.height);
    } else if (fallback?.complete) {
      context.drawImage(fallback, 0, 0, output.width, output.height);
    } else {
      setCaptureMessage("アバターの準備が終わってからお試しください。");
      return;
    }

    const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
    if (!blob) {
      setCaptureMessage("PNGを書き出せませんでした。");
      return;
    }
    downloadBlob(blob, `local-avatar-rig-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    setCaptureMessage("現在のフレームをPNGで保存しました。");
  }, [assets.background, backgroundMode]);

  const avatarStyle: AvatarStyle = {
    "--look-x": `${look.x}px`,
    "--look-y": `${look.y}px`,
  };

  return (
    <section className="preview-column" aria-label="VTuberプレビュー">
      <div
        ref={stageRef}
        className={`avatar-stage avatar-scene background-${backgroundMode} ${motion ? "motion-enabled" : ""}`}
        onPointerMove={(event) => {
          if (!pointerFollow) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setLook({
            x: Math.max(-8, Math.min(8, ((event.clientX - bounds.left) / bounds.width - 0.5) * 16)),
            y: Math.max(-6, Math.min(6, ((event.clientY - bounds.top) / bounds.height - 0.5) * 12)),
          });
        }}
        onPointerLeave={() => setLook({ x: 0, y: 0 })}
      >
        {backgroundMode === "scene" && assets.background ? (
          <img ref={backgroundRef} className="avatar-stage-background" src={assets.background} alt="" />
        ) : null}
        <div
          ref={rigRef}
          className={`avatar-rig ${motion ? "motion-enabled" : ""}`}
          style={avatarStyle}
          data-rig-state={microphone.speaking ? "speaking" : "idle"}
        >
          <WebGLAvatar
            canvasRef={canvasRef}
            characterRef={characterRef}
            poseRef={poseRef}
            motion={motion}
            speaking={microphone.speaking}
            audioLevel={microphone.level}
            faceTrackingStatus={faceTracking.status}
            assets={assets}
            profile={profile}
            altText={avatarAlt}
          />
        </div>
        <span className="avatar-ground-shadow" aria-hidden="true" />
        <video
          ref={faceTracking.videoRef}
          className="face-tracking-input"
          muted
          playsInline
          aria-hidden="true"
          tabIndex={-1}
        />

        <div className="stage-topbar">
          <span className="stage-brand"><Sparkles size={15} /> LOCAL RIG</span>
          <span className={`status-pill ${faceTracking.status}`}>
            <i />
            {faceTracking.status === "tracking"
              ? "顔追従中"
              : faceTracking.status === "searching"
                ? "顔を検索中"
                : faceTracking.status === "loading"
                  ? "追従準備中"
                  : "手動制御"}
          </span>
        </div>

        <div className="stage-actions">
          <button
            type="button"
            className={faceTracking.running ? "stage-action active" : "stage-action"}
            onClick={faceTracking.toggle}
            disabled={!faceTracking.supported}
            title={faceTracking.supported ? "端末内だけで顔を追従します" : "localhostまたはHTTPSが必要です"}
          >
            <ScanFace size={17} />
            {faceTracking.running ? "顔追従を停止" : "顔追従"}
          </button>
          <button
            type="button"
            className={microphone.running ? "stage-action active" : "stage-action"}
            onClick={microphone.toggle}
            disabled={!microphone.supported || microphone.starting}
          >
            {microphone.running ? <Mic size={17} /> : <MicOff size={17} />}
            {microphone.starting ? "マイク準備中" : microphone.running ? "口パク中" : "マイク口パク"}
          </button>
          <button type="button" className="stage-action icon-only" onClick={() => void saveSnapshot()} aria-label="PNGを保存">
            <Download size={18} />
          </button>
          <button type="button" className="stage-action icon-only" onClick={() => void enterFullscreen()} aria-label="全画面表示">
            <Expand size={18} />
          </button>
        </div>
      </div>
      <div className="stage-message" role="status" aria-live="polite">
        {captureMessage ?? faceTracking.message ?? microphone.message ?? "顔追従の開始時にGoogleからモデルを取得します。映像・音声は端末内で処理します。"}
      </div>
    </section>
  );
}
