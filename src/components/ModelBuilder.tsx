import {
  Check,
  Clipboard,
  Download,
  FileImage,
  Info,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildModelPrompts,
  DEFAULT_ASSETS,
  DEFAULT_MODEL_BRIEF,
  formatPromptDocument,
  inspectImageFile,
  type AssetInspection,
  type AssetKind,
  type LocalAvatarAssetSet,
  type ModelBrief,
  validateAssetInspections,
} from "../lib/modelPack";
import type { RigProfile } from "../lib/avatarRigProfile";
import { BoneEditor } from "./BoneEditor";

interface RigInference {
  profile: RigProfile;
  confidence: "high" | "low";
  notes: string[];
}

interface ModelBuilderProps {
  activeAssets: LocalAvatarAssetSet;
  activeProfile: RigProfile;
  onApplyAssets: (assets: LocalAvatarAssetSet, profile: RigProfile) => void;
  onResetAssets: () => void;
}

const labels: Record<AssetKind, string> = {
  neutral: "Neutral anchor",
  blink: "Blink state",
  mouthOpen: "Mouth-open state",
  background: "Background（任意）",
};

function saveText(content: string, filename: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function copyText(content: string) {
  await navigator.clipboard.writeText(content);
}

export function ModelBuilder({ activeAssets, activeProfile, onApplyAssets, onResetAssets }: ModelBuilderProps) {
  const [brief, setBrief] = useState<ModelBrief>(DEFAULT_MODEL_BRIEF);
  const [candidateAssets, setCandidateAssets] = useState<LocalAvatarAssetSet>(activeAssets);
  const [inspections, setInspections] = useState<Partial<Record<AssetKind, AssetInspection>>>({});
  const [fileErrors, setFileErrors] = useState<Partial<Record<AssetKind, string>>>({});
  const [busyKinds, setBusyKinds] = useState<Partial<Record<AssetKind, boolean>>>({});
  const [candidateProfile, setCandidateProfile] = useState<RigProfile>(activeProfile);
  const [rigInference, setRigInference] = useState<RigInference | null>(null);
  const [rigBusy, setRigBusy] = useState(false);
  const [rigError, setRigError] = useState<string | null>(null);
  const [rigRevision, setRigRevision] = useState(0);
  const [rigManuallyAdjusted, setRigManuallyAdjusted] = useState(false);
  const [overlayState, setOverlayState] = useState<"blink" | "mouthOpen">("blink");
  const [overlayOpacity, setOverlayOpacity] = useState(0.62);
  const [copied, setCopied] = useState<string | null>(null);
  const [toolName, setToolName] = useState("AI image generation tool");
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("オリジナルデザイン。外部画像を使う場合はURLと利用条件を記録してください。");
  const inputs = useRef<Partial<Record<AssetKind, HTMLInputElement | null>>>({});
  const activeAssetsRef = useRef(activeAssets);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const fileRequestsRef = useRef<Partial<Record<AssetKind, number>>>({});
  const rigRequestRef = useRef(0);
  const copyTimeoutRef = useRef<number>();
  const prompts = useMemo(() => buildModelPrompts(brief), [brief]);
  const promptDocument = useMemo(() => formatPromptDocument(brief, prompts), [brief, prompts]);
  const validation = useMemo(() => validateAssetInspections(inspections), [inspections]);
  const requiredLoaded = Boolean(inspections.neutral && inspections.blink && inspections.mouthOpen);
  const requiredBusy = Boolean(busyKinds.neutral || busyKinds.blink || busyKinds.mouthOpen);
  const requiredError = Boolean(fileErrors.neutral || fileErrors.blink || fileErrors.mouthOpen);
  const readyForRig = requiredLoaded && validation.valid && !requiredBusy && !requiredError;
  const canApply = readyForRig && !busyKinds.background && !rigBusy && Boolean(rigInference);

  useEffect(() => {
    activeAssetsRef.current = activeAssets;
  }, [activeAssets]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(copyTimeoutRef.current);
      const activeUrls = new Set(Object.values(activeAssetsRef.current));
      for (const url of ownedObjectUrlsRef.current) {
        if (!activeUrls.has(url)) URL.revokeObjectURL(url);
      }
      ownedObjectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!readyForRig) return;
    let cancelled = false;
    const request = ++rigRequestRef.current;
    setRigBusy(true);
    setRigError(null);
    setRigInference(null);
    const sources = { neutral: candidateAssets.neutral, blink: candidateAssets.blink, mouthOpen: candidateAssets.mouthOpen };
    // 推定処理は画像3枚の検証が終わってから読み込みます。
    void import("../lib/avatarRigAnalysis").then(({ inferRigFromImages }) => inferRigFromImages(sources)).then((result) => {
      if (cancelled || request !== rigRequestRef.current) return;
      setCandidateProfile(result.profile);
      setRigInference(result);
      setRigManuallyAdjusted(false);
    }).catch((error: unknown) => {
      if (!cancelled && request === rigRequestRef.current) setRigError(error instanceof Error ? error.message : "画像からボーンを推定できませんでした。再試行してください。");
    }).finally(() => {
      if (!cancelled && request === rigRequestRef.current) setRigBusy(false);
    });
    return () => { cancelled = true; };
  }, [readyForRig, candidateAssets.neutral, candidateAssets.blink, candidateAssets.mouthOpen, rigRevision]);

  const updateBrief = (key: keyof ModelBrief, value: string) => setBrief((current) => ({ ...current, [key]: value }));

  const chooseFile = (kind: AssetKind) => inputs.current[kind]?.click();

  const readFile = async (kind: AssetKind, file: File | undefined) => {
    if (!file) return;
    const request = (fileRequestsRef.current[kind] ?? 0) + 1;
    fileRequestsRef.current[kind] = request;
    setBusyKinds((current) => ({ ...current, [kind]: true }));
    setFileErrors((current) => ({ ...current, [kind]: undefined }));
    if (kind !== "background") {
      rigRequestRef.current += 1;
      setRigInference(null);
      setRigBusy(false);
      setRigError(null);
    }
    try {
      const inspection = await inspectImageFile(kind, file);
      if (!mountedRef.current || fileRequestsRef.current[kind] !== request) return;
      const url = URL.createObjectURL(file);
      ownedObjectUrlsRef.current.add(url);
      setCandidateAssets((current) => {
        const previous = current[kind];
        const activeUrls = new Set(Object.values(activeAssetsRef.current));
        if (previous && ownedObjectUrlsRef.current.has(previous) && !activeUrls.has(previous)) {
          URL.revokeObjectURL(previous);
          ownedObjectUrlsRef.current.delete(previous);
        }
        return { ...current, [kind]: url };
      });
      setInspections((current) => ({ ...current, [kind]: inspection }));
      if (kind === "blink" || kind === "mouthOpen") setOverlayState(kind);
    } catch (error) {
      if (!mountedRef.current || fileRequestsRef.current[kind] !== request) return;
      setFileErrors((current) => ({
        ...current,
        [kind]: error instanceof Error ? error.message : "画像を確認できませんでした。",
      }));
    } finally {
      if (mountedRef.current && fileRequestsRef.current[kind] === request) setBusyKinds((current) => ({ ...current, [kind]: false }));
    }
  };

  const copyPrompt = async (key: keyof typeof prompts) => {
    try {
      await copyText(prompts[key]);
      if (!mountedRef.current) return;
      setCopied(key);
      window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(null), 1_600);
    } catch {
      if (mountedRef.current) setCopied(null);
    }
  };

  const saveManifest = () => {
    saveText(JSON.stringify({
      schemaVersion: 2,
      modelType: "lightweight-web-expression-state-rig",
      renderer: "custom-webgl-mesh" as const,
      generatedAt,
      tool: toolName,
      reference,
      brief,
      prompts,
      inspections,
      validation,
      profile: candidateProfile,
      rigInference: rigInference ? {
        method: "registered-expression-differences-and-alpha-silhouette",
        confidence: rigInference.confidence,
        notes: rigInference.notes,
        manuallyAdjusted: rigManuallyAdjusted,
      } : null,
    }, null, 2), "local-avatar-rig-model-manifest.json", "application/json;charset=utf-8");
  };

  const applyCandidateAssets = () => {
    if (!canApply) return;
    onApplyAssets(candidateAssets, candidateProfile);
    const appliedUrls = new Set(Object.values(candidateAssets));
    for (const url of ownedObjectUrlsRef.current) {
      if (appliedUrls.has(url)) ownedObjectUrlsRef.current.delete(url);
    }
  };

  return (
    <div className="model-builder">
      <section className="builder-intro">
        <div className="section-heading">
          <div><Sparkles size={18} /><strong>モデル生成ブリーフ</strong></div>
          <span>ローカル生成・外部送信なし</span>
        </div>
        <p>キャラクター定義から、同一登録のNeutral・瞬き・口開きプロンプトを作ります。画像生成APIは自動実行せず、利用するツールと費用を選べます。</p>
        <div className="boundary-note"><Info size={16} /><span>出力は軽量Webプレビューリグ用です。階層化された制作素材や特定ベンダーの専用モデル形式は生成しません。</span></div>
      </section>

      <section className="builder-section">
        <div className="brief-grid">
          <label><span>キャラクター</span><textarea value={brief.identity} onChange={(event) => updateBrief("identity", event.target.value)} /></label>
          <label><span>配信上の役割</span><textarea value={brief.role} onChange={(event) => updateBrief("role", event.target.value)} /></label>
          <label><span>配色</span><textarea value={brief.palette} onChange={(event) => updateBrief("palette", event.target.value)} /></label>
          <label><span>衣装</span><textarea value={brief.outfit} onChange={(event) => updateBrief("outfit", event.target.value)} /></label>
          <label><span>シグネチャーモチーフ</span><input value={brief.motif} onChange={(event) => updateBrief("motif", event.target.value)} /></label>
          <label><span>除外事項</span><textarea value={brief.exclusions} onChange={(event) => updateBrief("exclusions", event.target.value)} /></label>
        </div>
        <div className="builder-actions">
          <button type="button" onClick={() => saveText(promptDocument, "local-avatar-rig-generation-brief.md")}><Download size={16} />プロンプト一式を保存</button>
          <button type="button" className="secondary" onClick={() => setBrief(DEFAULT_MODEL_BRIEF)}><RotateCcw size={16} />既定値へ戻す</button>
        </div>
        <div className="prompt-cards">
          {(["neutral", "blink", "mouthOpen", "transparencyRepair"] as const).map((key) => (
            <details key={key} open={key === "neutral"}>
              <summary>{key === "neutral" ? "1. Neutral anchor" : key === "blink" ? "2. Blink state" : key === "mouthOpen" ? "3. Mouth-open state" : "透過修復"}</summary>
              <pre>{prompts[key]}</pre>
              <button type="button" className="copy-button" onClick={() => void copyPrompt(key)}>{copied === key ? <Check size={15} /> : <Clipboard size={15} />}{copied === key ? "コピー済み" : "コピー"}</button>
            </details>
          ))}
        </div>
      </section>

      <section className="builder-section">
        <div className="section-heading">
          <div><Upload size={18} /><strong>生成画像の取込・検証</strong></div>
          <span>新規素材は同寸法・実アルファ必須</span>
        </div>
        <p>Neutralを確定してから、それを編集対象としてBlinkとMouth-openを生成してください。選択したファイルはブラウザ外へ送信しません。</p>
        <div className="asset-drop-grid">
          {(["neutral", "blink", "mouthOpen", "background"] as const).map((kind) => {
            const inspection = inspections[kind];
            const error = fileErrors[kind];
            return (
              <div key={kind} className={`asset-drop ${inspection ? "loaded" : ""} ${error ? "error" : ""}`}>
                <input
                  ref={(element) => { inputs.current[kind] = element; }}
                  type="file"
                  accept="image/png"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void readFile(kind, file);
                  }}
                />
                <FileImage size={21} />
                <strong>{labels[kind]}</strong>
                {inspection ? (
                  <>
                    <span>{inspection.name}</span>
                    <small>{inspection.width}×{inspection.height} · {inspection.hasAlpha ? "実アルファ" : "不透明"}</small>
                    <small>SHA {inspection.sha256.slice(0, 12)}…</small>
                  </>
                ) : <span>{error ?? (kind === "background" ? "権利を確認したPNG" : "透明PNGを選択")}</span>}
                <button type="button" onClick={() => chooseFile(kind)} disabled={busyKinds[kind]}>{busyKinds[kind] ? "検査中…" : inspection ? "差し替え" : "選択"}</button>
                {inspection && error ? <small role="alert">{error}</small> : null}
              </div>
            );
          })}
        </div>

        <div className="registration-checker">
          <div className="registration-preview checkerboard">
            <img src={candidateAssets.neutral} alt="Neutral状態" />
            <img src={candidateAssets[overlayState]} alt={overlayState === "blink" ? "Blink重ね合わせ" : "Mouth-open重ね合わせ"} style={{ opacity: overlayOpacity }} />
          </div>
          <div className="registration-controls">
            <strong>位置合わせプレビュー</strong>
            <p>輪郭・髪・肩が動かず、指定した目または口だけが変化することを目視確認します。</p>
            <div className="segmented">
              <button type="button" className={overlayState === "blink" ? "selected" : ""} onClick={() => setOverlayState("blink")}>Blink</button>
              <button type="button" className={overlayState === "mouthOpen" ? "selected" : ""} onClick={() => setOverlayState("mouthOpen")}>Mouth</button>
            </div>
            <label className="control-slider"><span>差分の濃さ<output>{Math.round(overlayOpacity * 100)}%</output></span><input type="range" min="0" max="1" step="0.01" value={overlayOpacity} onChange={(event) => setOverlayOpacity(Number(event.target.value))} /></label>
          </div>
        </div>

        {requiredLoaded ? (
          <div className={validation.valid ? "validation-box valid" : "validation-box invalid"}>
            {validation.valid ? <ShieldCheck size={20} /> : <X size={20} />}
            <div>
              <strong>{validation.valid ? "自動検査に合格しました" : "取込条件を満たしていません"}</strong>
              {validation.errors.map((error) => <p key={error}>{error}</p>)}
              {validation.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              {validation.valid ? <p>最後に重ね合わせと明暗背景で縁を目視確認してください。</p> : null}
            </div>
          </div>
        ) : null}

        <section className="bone-setup" aria-label="画像からのボーン設定">
          <div className="section-heading"><div><Sparkles size={17} /><strong>画像からボーンを推定</strong></div></div>
          <div className="bone-inference-status" role="status" data-confidence={rigInference?.confidence}>
            {rigBusy ? "目・口の差分とキャラクターの輪郭から、関節位置を推定しています…" : rigInference ? (
              <>
                <strong>{rigInference.confidence === "low" ? "推定・位置確認が必要です" : "画像から推定しました。関節位置をご確認ください。"}</strong>
                <ul>{rigInference.notes.map((note) => <li key={note}>{note}</li>)}</ul>
              </>
            ) : "Neutral・Blink・Mouth-openの3枚が取込条件を満たすと、自動でボーンを推定します。"}
          </div>
          {rigError ? <p className="bone-inference-error" role="alert">{rigError}</p> : null}
          {rigInference && !rigBusy ? <BoneEditor image={candidateAssets.neutral} profile={candidateProfile} onChange={(nextProfile) => {
            setCandidateProfile(nextProfile);
            setRigManuallyAdjusted(true);
          }} /> : null}
          <div className="builder-actions">
            <button type="button" className="secondary" disabled={!readyForRig || rigBusy} onClick={() => {
              rigRequestRef.current += 1;
              setRigBusy(true);
              setRigInference(null);
              setRigRevision((current) => current + 1);
            }}><Sparkles size={15} />画像からボーンを再推定</button>
          </div>
        </section>

        <div className="provenance-grid">
          <label><span>生成ツール</span><input value={toolName} onChange={(event) => setToolName(event.target.value)} /></label>
          <label><span>生成日</span><input type="date" value={generatedAt} onChange={(event) => setGeneratedAt(event.target.value)} /></label>
          <label className="wide"><span>参照元・利用条件</span><textarea value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        </div>
        <div className="builder-actions">
          <button type="button" disabled={!canApply} onClick={applyCandidateAssets}><Check size={16} />検証済み素材をプレビューへ適用</button>
          <button type="button" className="secondary" onClick={saveManifest} disabled={!canApply}><Download size={16} />Manifestを保存</button>
          <button type="button" className="secondary" onClick={() => {
            rigRequestRef.current += 1;
            for (const kind of Object.keys(labels) as AssetKind[]) fileRequestsRef.current[kind] = (fileRequestsRef.current[kind] ?? 0) + 1;
            const activeUrls = new Set(Object.values(activeAssetsRef.current));
            for (const url of ownedObjectUrlsRef.current) {
              if (!activeUrls.has(url)) URL.revokeObjectURL(url);
            }
            ownedObjectUrlsRef.current.clear();
            setCandidateAssets(DEFAULT_ASSETS);
            setInspections({});
            setFileErrors({});
            setBusyKinds({});
            setRigInference(null);
            setRigBusy(false);
            setRigError(null);
            onResetAssets();
          }}><RotateCcw size={16} />標準モデルへ戻す</button>
        </div>
      </section>
    </div>
  );
}
