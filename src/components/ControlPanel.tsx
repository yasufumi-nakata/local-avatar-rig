import {
  Camera,
  CircleDot,
  Eye,
  Gauge,
  Mic,
  MousePointer2,
  RefreshCw,
  RotateCcw,
  ScanFace,
  Smile,
  UserRound,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FaceTrackingStatus } from "../hooks/useFaceTracking";
import { listVideoInputs, getStoredCameraDeviceId, setStoredCameraDeviceId } from "../lib/cameraDevice";
import { NEUTRAL_FACE_RIG_POSE, type FaceRigPose } from "../lib/faceRigPose";
import {
  BUILT_IN_AVATAR_PACK_LIST,
  type BuiltInAvatarPackId,
} from "../lib/modelPack";
import type { RigProfile } from "../lib/webglAvatarRenderer";
import type { BackgroundMode } from "./AvatarStage";

interface ControlPanelProps {
  activeModelId: BuiltInAvatarPackId | "custom";
  onModelChange: (modelId: BuiltInAvatarPackId) => void;
  pose: FaceRigPose;
  onPoseChange: (pose: FaceRigPose) => void;
  motion: boolean;
  onMotionChange: (enabled: boolean) => void;
  pointerFollow: boolean;
  onPointerFollowChange: (enabled: boolean) => void;
  backgroundMode: BackgroundMode;
  onBackgroundModeChange: (mode: BackgroundMode) => void;
  profile: RigProfile;
  onProfileChange: (profile: RigProfile) => void;
  faceTracking: {
    supported: boolean;
    running: boolean;
    status: FaceTrackingStatus;
    start: () => void;
    stop: () => void;
  };
  microphone: {
    supported: boolean;
    starting: boolean;
    running: boolean;
    level: number;
    start: () => void;
    stop: () => void;
  };
}

interface SliderProps {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function Slider({ label, value, minimum, maximum, step = 1, unit = "", disabled, onChange }: SliderProps) {
  const digits = step < 0.01 ? 3 : step < 1 ? 2 : 0;
  return (
    <label className="control-slider">
      <span>{label}<output>{value.toFixed(digits)}{unit}</output></span>
      <input
        type="range"
        aria-label={label}
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

const presets: Array<{ label: string; icon: typeof Smile; pose: Partial<FaceRigPose> }> = [
  { label: "ニュートラル", icon: CircleDot, pose: {} },
  { label: "笑顔", icon: Smile, pose: { smile: 0.9, eyeY: 0.14 } },
  { label: "会話", icon: Mic, pose: { mouthOpen: 0.72, smile: 0.35, pitch: 2 } },
  { label: "ウィンク", icon: Eye, pose: { blinkLeft: 1, smile: 0.85, roll: -5 } },
  { label: "首かしげ", icon: Waves, pose: { yaw: -9, pitch: 4, roll: -13, eyeX: 0.35 } },
];

export function ControlPanel({
  activeModelId,
  onModelChange,
  pose,
  onPoseChange,
  motion,
  onMotionChange,
  pointerFollow,
  onPointerFollowChange,
  backgroundMode,
  onBackgroundModeChange,
  profile,
  onProfileChange,
  faceTracking,
  microphone,
}: ControlPanelProps) {
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [cameraDeviceId, setCameraDeviceIdState] = useState(getStoredCameraDeviceId);
  const manualDisabled = faceTracking.running;

  const refreshCameras = async () => {
    try {
      setDevices(await listVideoInputs());
    } catch {
      setDevices([]);
    }
  };

  useEffect(() => {
    void refreshCameras();
  }, [faceTracking.running]);

  const profileControls = useMemo(() => ({
    eyeY: (profile.leftEyeCenter[1] + profile.rightEyeCenter[1]) / 2,
    eyeSpread: profile.rightEyeCenter[0] - profile.leftEyeCenter[0],
    mouthX: profile.mouthCenter[0],
    mouthY: profile.mouthCenter[1],
  }), [profile]);

  const changePose = (key: keyof FaceRigPose, value: number) => onPoseChange({ ...pose, [key]: value });
  const applyPreset = (patch: Partial<FaceRigPose>) => onPoseChange({ ...NEUTRAL_FACE_RIG_POSE, ...patch });

  return (
    <div className="control-panel">
      <section className="control-section">
        <div className="section-heading">
          <div><UserRound size={17} /><strong>キャラクター</strong></div>
          <span>{activeModelId === "custom" ? "持込モデル" : "組込みモデル"}</span>
        </div>
        <div className="character-picker" role="group" aria-label="キャラクター">
          {BUILT_IN_AVATAR_PACK_LIST.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className={activeModelId === pack.id ? "selected" : ""}
              aria-pressed={activeModelId === pack.id}
              onClick={() => onModelChange(pack.id)}
            >
              <strong>{pack.shortLabel}</strong>
              <span>{pack.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading">
          <div><Gauge size={17} /><strong>入力</strong></div>
          <span>権限は操作時のみ</span>
        </div>
        <div className="input-cards">
          <button
            type="button"
            className={faceTracking.running ? "input-card active" : "input-card"}
            onClick={faceTracking.running ? faceTracking.stop : faceTracking.start}
            disabled={!faceTracking.supported}
          >
            <ScanFace size={20} />
            <span><strong>顔追従</strong><small>{faceTracking.running ? faceTracking.status : "カメラ停止中"}</small></span>
          </button>
          <button
            type="button"
            className={microphone.running ? "input-card active" : "input-card"}
            onClick={microphone.running ? microphone.stop : microphone.start}
            disabled={!microphone.supported || microphone.starting}
          >
            <Mic size={20} />
            <span><strong>マイク口パク</strong><small>{microphone.starting ? "準備中" : microphone.running ? `音量 ${Math.round(microphone.level * 100)}%` : "録音・送信なし"}</small></span>
          </button>
        </div>

        <p className="input-privacy-note">顔追従を開始するとGoogleからモデルを取得します。接続先へIP等が伝わりますが、映像・音声は送信しません。</p>
        <div className="camera-select-row">
          <Camera size={16} />
          <select
            value={cameraDeviceId}
            onChange={(event) => {
              const value = event.target.value;
              setCameraDeviceIdState(value);
              setStoredCameraDeviceId(value);
              if (faceTracking.running) faceTracking.stop();
            }}
            aria-label="顔追従用カメラ"
          >
            <option value="">ブラウザの既定カメラ</option>
            {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
          </select>
          <button type="button" onClick={() => void refreshCameras()} aria-label="カメラ一覧を更新"><RefreshCw size={15} /></button>
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading">
          <div><SparkControlIcon /><strong>自動モーション</strong></div>
        </div>
        <div className="toggle-row">
          <label><input type="checkbox" checked={motion} onChange={(event) => onMotionChange(event.target.checked)} /><span />呼吸・瞬き・髪物理</label>
          <label><input type="checkbox" checked={pointerFollow} onChange={(event) => onPointerFollowChange(event.target.checked)} /><span /><MousePointer2 size={15} />ポインター追従</label>
        </div>
        <div className="background-picker" role="group" aria-label="背景">
          {(["scene", "transparent", "green", "blue"] as const).map((mode) => (
            <button key={mode} type="button" className={backgroundMode === mode ? "selected" : ""} onClick={() => onBackgroundModeChange(mode)}>
              {mode === "scene" ? "シーン" : mode === "transparent" ? "透過" : mode === "green" ? "グリーン" : "ブルー"}
            </button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading">
          <div><CircleDot size={17} /><strong>表情プリセット</strong></div>
          <button type="button" className="text-button" onClick={() => applyPreset({})} disabled={manualDisabled}><RotateCcw size={14} />リセット</button>
        </div>
        <div className="preset-grid">
          {presets.map(({ label, icon: Icon, pose: preset }) => (
            <button key={label} type="button" onClick={() => applyPreset(preset)} disabled={manualDisabled}><Icon size={16} />{label}</button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading">
          <div><Gauge size={17} /><strong>手動パラメータ</strong></div>
          {manualDisabled ? <span>顔追従中は自動</span> : <span>12 channels</span>}
        </div>
        <div className="slider-grid">
          <Slider label="横移動" value={pose.x} minimum={-11} maximum={11} unit="px" disabled={manualDisabled} onChange={(value) => changePose("x", value)} />
          <Slider label="縦移動" value={pose.y} minimum={-8} maximum={8} unit="px" disabled={manualDisabled} onChange={(value) => changePose("y", value)} />
          <Slider label="Yaw" value={pose.yaw} minimum={-30} maximum={30} unit="°" disabled={manualDisabled} onChange={(value) => changePose("yaw", value)} />
          <Slider label="Pitch" value={pose.pitch} minimum={-30} maximum={30} unit="°" disabled={manualDisabled} onChange={(value) => changePose("pitch", value)} />
          <Slider label="Roll" value={pose.roll} minimum={-30} maximum={30} unit="°" disabled={manualDisabled} onChange={(value) => changePose("roll", value)} />
          <Slider label="拡大" value={pose.scale} minimum={0.975} maximum={1.04} step={0.001} disabled={manualDisabled} onChange={(value) => changePose("scale", value)} />
          <Slider label="視線 X" value={pose.eyeX} minimum={-1} maximum={1} step={0.01} disabled={manualDisabled} onChange={(value) => changePose("eyeX", value)} />
          <Slider label="視線 Y" value={pose.eyeY} minimum={-1} maximum={1} step={0.01} disabled={manualDisabled} onChange={(value) => changePose("eyeY", value)} />
          <Slider label="左まぶた" value={pose.blinkLeft} minimum={0} maximum={1} step={0.01} disabled={manualDisabled} onChange={(value) => changePose("blinkLeft", value)} />
          <Slider label="右まぶた" value={pose.blinkRight} minimum={0} maximum={1} step={0.01} disabled={manualDisabled} onChange={(value) => changePose("blinkRight", value)} />
          <Slider label="口開き" value={pose.mouthOpen} minimum={0} maximum={1} step={0.01} disabled={manualDisabled} onChange={(value) => changePose("mouthOpen", value)} />
          <Slider label="笑顔" value={pose.smile} minimum={0} maximum={1} step={0.01} disabled={manualDisabled} onChange={(value) => changePose("smile", value)} />
        </div>
      </section>

      <details className="control-section calibration-section">
        <summary>独自モデルの顔パッチ位置</summary>
        <p>同じ16:9正面構図でも目・口がずれる場合だけ調整します。単位は画像幅・高さに対するUVです。</p>
        <Slider label="目の高さ" value={profileControls.eyeY} minimum={0.30} maximum={0.46} step={0.0005} onChange={(value) => onProfileChange({ ...profile, leftEyeCenter: [profile.leftEyeCenter[0], value], rightEyeCenter: [profile.rightEyeCenter[0], value] })} />
        <Slider label="目の間隔" value={profileControls.eyeSpread} minimum={0.07} maximum={0.16} step={0.0005} onChange={(value) => {
          const center = (profile.leftEyeCenter[0] + profile.rightEyeCenter[0]) / 2;
          onProfileChange({ ...profile, leftEyeCenter: [center - value / 2, profile.leftEyeCenter[1]], rightEyeCenter: [center + value / 2, profile.rightEyeCenter[1]] });
        }} />
        <Slider label="口 X" value={profileControls.mouthX} minimum={0.42} maximum={0.58} step={0.0005} onChange={(value) => onProfileChange({ ...profile, mouthCenter: [value, profile.mouthCenter[1]] })} />
        <Slider label="口 Y" value={profileControls.mouthY} minimum={0.42} maximum={0.58} step={0.0005} onChange={(value) => onProfileChange({ ...profile, mouthCenter: [profile.mouthCenter[0], value] })} />
      </details>
    </div>
  );
}

function SparkControlIcon() {
  return <Waves size={17} />;
}
