import { BookOpen, Code2, SlidersHorizontal, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AvatarStage, type BackgroundMode } from "./components/AvatarStage";
import { ControlPanel } from "./components/ControlPanel";
import { ModelBuilder } from "./components/ModelBuilder";
import { useFaceTracking } from "./hooks/useFaceTracking";
import { useMicrophoneLevel } from "./hooks/useMicrophoneLevel";
import { NEUTRAL_FACE_RIG_POSE, type FaceRigPose } from "./lib/faceRigPose";
import {
  BUILT_IN_AVATAR_PACKS,
  DEFAULT_BUILT_IN_AVATAR_PACK_ID,
  isBuiltInAvatarPackId,
  type BuiltInAvatarPackId,
  type LocalAvatarAssetSet,
} from "./lib/modelPack";
import { hasValidBones, isRigPoint, type RigProfile } from "./lib/avatarRigProfile";
import "./avatar-rig.css";
import "./styles.css";

type PanelTab = "control" | "model" | "guide";
type ProfilesByModel = Partial<Record<BuiltInAvatarPackId, RigProfile>>;

interface StoredPreferences {
  motion: boolean;
  pointerFollow: boolean;
  backgroundMode: BackgroundMode;
  profile: RigProfile;
  activeModelId: BuiltInAvatarPackId;
  profileModelId: BuiltInAvatarPackId;
  profilesByModel: ProfilesByModel;
}

const SETTINGS_KEY = "local-avatar-rig:preferences:v2";

function readProfile(profile: unknown): RigProfile | undefined {
  if (!profile || typeof profile !== "object") return undefined;
  const candidate = profile as Partial<RigProfile>;
  if (!isRigPoint(candidate.leftEyeCenter) || !isRigPoint(candidate.rightEyeCenter) || !isRigPoint(candidate.mouthCenter)) return undefined;
  // 旧設定は引き継ぎ、壊れたボーンだけを省いて有効な顔パッチ位置を残します。
  return {
    leftEyeCenter: candidate.leftEyeCenter,
    rightEyeCenter: candidate.rightEyeCenter,
    mouthCenter: candidate.mouthCenter,
    ...(hasValidBones(candidate.bones) ? { bones: candidate.bones } : {}),
  };
}

function loadPreferences(): StoredPreferences {
  const defaultPack = BUILT_IN_AVATAR_PACKS[DEFAULT_BUILT_IN_AVATAR_PACK_ID];
  const fallback: StoredPreferences = {
    motion: true,
    pointerFollow: true,
    backgroundMode: "scene",
    profile: defaultPack.profile,
    activeModelId: defaultPack.id,
    profileModelId: defaultPack.id,
    profilesByModel: {},
  };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<StoredPreferences> | null;
    if (parsed) {
      const activeModelId = isBuiltInAvatarPackId(parsed.activeModelId)
        ? parsed.activeModelId
        : fallback.activeModelId;
      const pack = BUILT_IN_AVATAR_PACKS[activeModelId];
      const profilesByModel: ProfilesByModel = {};
      for (const modelId of Object.keys(BUILT_IN_AVATAR_PACKS)) {
        if (!isBuiltInAvatarPackId(modelId)) continue;
        const profile = readProfile(parsed.profilesByModel?.[modelId]);
        if (profile) profilesByModel[modelId] = profile;
      }
      // 単一profileしか持たない旧設定は、選択中モデルではなく記録されたモデルへ引き継ぎます。
      const olderProfile = readProfile(parsed.profile);
      if (isBuiltInAvatarPackId(parsed.profileModelId)
        && !profilesByModel[parsed.profileModelId]
        && olderProfile) {
        profilesByModel[parsed.profileModelId] = olderProfile;
      }
      const profile = profilesByModel[activeModelId] ?? pack.profile;
      return {
        motion: parsed.motion ?? fallback.motion,
        pointerFollow: parsed.pointerFollow ?? fallback.pointerFollow,
        backgroundMode: ["scene", "transparent", "green", "blue"].includes(parsed.backgroundMode ?? "")
          ? parsed.backgroundMode as BackgroundMode
          : fallback.backgroundMode,
        profile,
        activeModelId,
        profileModelId: activeModelId,
        profilesByModel,
      };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [preferences] = useState(loadPreferences);
  const initialPack = BUILT_IN_AVATAR_PACKS[preferences.activeModelId];
  const rigRef = useRef<HTMLDivElement>(null);
  const manualPoseRef = useRef<FaceRigPose>({ ...NEUTRAL_FACE_RIG_POSE });
  const [manualPose, setManualPose] = useState<FaceRigPose>({ ...NEUTRAL_FACE_RIG_POSE });
  const [motion, setMotion] = useState(preferences.motion);
  const [pointerFollow, setPointerFollow] = useState(preferences.pointerFollow);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(preferences.backgroundMode);
  const [profilesByModel, setProfilesByModel] = useState(preferences.profilesByModel);
  const [customProfile, setCustomProfile] = useState<RigProfile>(preferences.profile);
  const [assets, setAssets] = useState<LocalAvatarAssetSet>(initialPack.assets);
  const [activeModelId, setActiveModelId] = useState<BuiltInAvatarPackId | "custom">(initialPack.id);
  const profile = activeModelId === "custom"
    ? customProfile
    : profilesByModel[activeModelId] ?? BUILT_IN_AVATAR_PACKS[activeModelId].profile;
  const [tab, setTab] = useState<PanelTab>("control");
  const faceTracking = useFaceTracking({ rigRef });
  const microphone = useMicrophoneLevel();
  const activeBlobUrlsRef = useRef(new Set<string>());

  manualPoseRef.current = manualPose;
  const activePoseRef = faceTracking.running ? faceTracking.poseRef : manualPoseRef;

  useEffect(() => {
    try {
      const persistedModelId = activeModelId === "custom"
        ? DEFAULT_BUILT_IN_AVATAR_PACK_ID
        : activeModelId;
      const persistedProfile = profilesByModel[persistedModelId]
        ?? BUILT_IN_AVATAR_PACKS[persistedModelId].profile;
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        motion,
        pointerFollow,
        backgroundMode,
        profile: persistedProfile,
        activeModelId: persistedModelId,
        profileModelId: persistedModelId,
        profilesByModel,
      }));
    } catch {
      // The studio remains functional when persistent browser storage is unavailable.
    }
  }, [activeModelId, backgroundMode, motion, pointerFollow, profilesByModel]);

  useEffect(() => {
    const nextUrls = new Set(Object.values(assets).filter((url) => url?.startsWith("blob:")));
    for (const url of activeBlobUrlsRef.current) {
      if (!nextUrls.has(url)) URL.revokeObjectURL(url);
    }
    activeBlobUrlsRef.current = nextUrls;
  }, [assets]);

  useEffect(() => () => {
    for (const url of activeBlobUrlsRef.current) URL.revokeObjectURL(url);
    activeBlobUrlsRef.current.clear();
  }, []);

  const toggleFaceTracking = () => {
    if (faceTracking.running) faceTracking.stop();
    else void faceTracking.start();
  };
  const toggleMicrophone = () => {
    if (microphone.starting) return;
    if (microphone.running) microphone.stop();
    else void microphone.start();
  };
  const applyAssets = (nextAssets: LocalAvatarAssetSet, nextProfile: RigProfile) => {
    for (const url of Object.values(nextAssets)) {
      if (url?.startsWith("blob:")) activeBlobUrlsRef.current.add(url);
    }
    setAssets(nextAssets);
    setCustomProfile(nextProfile);
    setActiveModelId("custom");
    setManualPose({ ...NEUTRAL_FACE_RIG_POSE });
  };
  const selectBuiltInModel = (modelId: BuiltInAvatarPackId) => {
    if (modelId === activeModelId) return;
    const pack = BUILT_IN_AVATAR_PACKS[modelId];
    setActiveModelId(modelId);
    setAssets(pack.assets);
    setManualPose({ ...NEUTRAL_FACE_RIG_POSE });
  };
  const updateProfile = (nextProfile: RigProfile) => {
    if (activeModelId === "custom") setCustomProfile(nextProfile);
    else setProfilesByModel((current) => ({ ...current, [activeModelId]: nextProfile }));
  };
  const avatarAlt = activeModelId === "custom"
    ? "利用者が読み込んだオリジナル2D VTuberアバター"
    : BUILT_IN_AVATAR_PACKS[activeModelId].altText;

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top" aria-label="Local Avatar Rig ホーム">
          <span className="brand-mark"><Sparkles size={21} /></span>
          <span><strong>Local Avatar Rig</strong><small>LOCAL 2D RIG</small></span>
        </a>
        <nav aria-label="メインメニュー">
          <button type="button" className={tab === "control" ? "active" : ""} onClick={() => setTab("control")}><SlidersHorizontal size={17} />コントロール</button>
          <button type="button" className={tab === "model" ? "active" : ""} onClick={() => setTab("model")}><WandSparkles size={17} />モデル生成</button>
          <button type="button" className={tab === "guide" ? "active" : ""} onClick={() => setTab("guide")}><BookOpen size={17} />ガイド</button>
        </nav>
        <div className="header-meta">
          <span className="privacy-badge"><i />端末内処理</span>
          <a href="https://github.com/yasufumi-nakata/local-avatar-rig" target="_blank" rel="noreferrer" aria-label="ソースリポジトリ"><Code2 size={19} /></a>
        </div>
      </header>

      <main id="top" className="studio-layout">
        <AvatarStage
          rigRef={rigRef}
          poseRef={activePoseRef}
          assets={assets}
          profile={profile}
          avatarAlt={avatarAlt}
          motion={motion}
          pointerFollow={pointerFollow}
          backgroundMode={backgroundMode}
          faceTracking={{
            videoRef: faceTracking.videoRef,
            supported: faceTracking.supported,
            running: faceTracking.running,
            status: faceTracking.status,
            message: faceTracking.message,
            toggle: toggleFaceTracking,
          }}
          microphone={{
            supported: microphone.supported,
            starting: microphone.starting,
            running: microphone.running,
            speaking: microphone.speaking,
            level: microphone.level,
            message: microphone.message,
            toggle: toggleMicrophone,
          }}
        />

        <aside className={`side-panel tab-${tab}`} aria-label={tab === "control" ? "制御パネル" : tab === "model" ? "モデル生成パネル" : "利用ガイド"}>
          <div className="panel-tab-heading">
            <span>{tab === "control" ? "RIG CONTROL" : tab === "model" ? "MODEL BUILDER" : "QUICK GUIDE"}</span>
            <strong>{tab === "control" ? "アバターを制御" : tab === "model" ? "モデルを作成・検証" : "安全に使い始める"}</strong>
          </div>
          {tab === "control" ? (
            <ControlPanel
              activeModelId={activeModelId}
              neutralImage={assets.neutral}
              onModelChange={selectBuiltInModel}
              pose={manualPose}
              onPoseChange={setManualPose}
              motion={motion}
              onMotionChange={setMotion}
              pointerFollow={pointerFollow}
              onPointerFollowChange={setPointerFollow}
              backgroundMode={backgroundMode}
              onBackgroundModeChange={setBackgroundMode}
              profile={profile}
              onProfileChange={updateProfile}
              faceTracking={{
                supported: faceTracking.supported,
                running: faceTracking.running,
                status: faceTracking.status,
                start: () => void faceTracking.start(),
                stop: faceTracking.stop,
              }}
              microphone={{
                supported: microphone.supported,
                starting: microphone.starting,
                running: microphone.running,
                level: microphone.level,
                start: () => void microphone.start(),
                stop: microphone.stop,
              }}
            />
          ) : tab === "model" ? (
            <ModelBuilder
              activeAssets={assets}
              activeProfile={profile}
              onApplyAssets={applyAssets}
              onResetAssets={() => {
                selectBuiltInModel(DEFAULT_BUILT_IN_AVATAR_PACK_ID);
              }}
            />
          ) : (
            <GuidePanel onOpenModelBuilder={() => setTab("model")} />
          )}
        </aside>
      </main>

      <footer>
        <span>軽量Web表情リグ · カメラ映像とマイク音声は保存・送信しません</span>
        <span><a href="/LICENSE" target="_blank" rel="noreferrer">MIT code</a> · <a href="/ASSET_LICENSE.md" target="_blank" rel="noreferrer">Artwork terms</a> · <a href="/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">Third-party notices</a></span>
      </footer>
    </div>
  );
}

function GuidePanel({ onOpenModelBuilder }: { onOpenModelBuilder: () => void }) {
  return (
    <div className="guide-panel">
      <section>
        <span className="step-number">01</span>
        <div><strong>まず手動制御を確認</strong><p>Yaw・Pitch・Roll、左右まぶた、口、笑顔を個別に動かせます。カメラやマイク権限は不要です。</p></div>
      </section>
      <section>
        <span className="step-number">02</span>
        <div><strong>顔追従を明示的に開始</strong><p>localhostまたはHTTPSで「顔追従」を押すと、Googleから検証用モデルを取得します。取得先へIP等が伝わり得ます。映像はその後端末内で姿勢値へ変換され、サーバーへ送られません。</p></div>
      </section>
      <section>
        <span className="step-number">03</span>
        <div><strong>必要ならマイク口パク</strong><p>音声波形から音量だけを読み、録音・文字起こし・外部送信は行いません。停止するとトラックを解放します。</p></div>
      </section>
      <section>
        <span className="step-number">04</span>
        <div><strong>独自モデルを作成</strong><p>NeutralをアンカーにBlinkとMouth-openを編集生成し、同寸法・実アルファ・位置登録を検証してから適用します。</p><button type="button" onClick={onOpenModelBuilder}><WandSparkles size={16} />モデル生成を開く</button></div>
      </section>
      <div className="guide-warning"><strong>出力形式の境界</strong><p>このアプリは3枚のラスター状態とWebGLメッシュを使う軽量プレビューリグです。階層化された制作素材や特定ベンダーの専用モデル形式は生成しません。</p></div>
    </div>
  );
}
