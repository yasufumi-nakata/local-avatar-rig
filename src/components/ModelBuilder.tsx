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

interface ModelBuilderProps {
  activeAssets: LocalAvatarAssetSet;
  onApplyAssets: (assets: LocalAvatarAssetSet) => void;
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

export function ModelBuilder({ activeAssets, onApplyAssets, onResetAssets }: ModelBuilderProps) {
  const [brief, setBrief] = useState<ModelBrief>(DEFAULT_MODEL_BRIEF);
  const [candidateAssets, setCandidateAssets] = useState<LocalAvatarAssetSet>(activeAssets);
  const [inspections, setInspections] = useState<Partial<Record<AssetKind, AssetInspection>>>({});
  const [fileErrors, setFileErrors] = useState<Partial<Record<AssetKind, string>>>({});
  const [busy, setBusy] = useState<AssetKind | null>(null);
  const [overlayState, setOverlayState] = useState<"blink" | "mouthOpen">("blink");
  const [overlayOpacity, setOverlayOpacity] = useState(0.62);
  const [copied, setCopied] = useState<string | null>(null);
  const [toolName, setToolName] = useState("AI image generation tool");
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("オリジナルデザイン。外部画像を使う場合はURLと利用条件を記録してください。");
  const inputs = useRef<Partial<Record<AssetKind, HTMLInputElement | null>>>({});
  const activeAssetsRef = useRef(activeAssets);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const prompts = useMemo(() => buildModelPrompts(brief), [brief]);
  const promptDocument = useMemo(() => formatPromptDocument(brief, prompts), [brief, prompts]);
  const validation = useMemo(() => validateAssetInspections(inspections), [inspections]);
  const requiredLoaded = Boolean(inspections.neutral && inspections.blink && inspections.mouthOpen);

  useEffect(() => {
    activeAssetsRef.current = activeAssets;
  }, [activeAssets]);

  useEffect(() => () => {
    const activeUrls = new Set(Object.values(activeAssetsRef.current));
    for (const url of ownedObjectUrlsRef.current) {
      if (!activeUrls.has(url)) URL.revokeObjectURL(url);
    }
    ownedObjectUrlsRef.current.clear();
  }, []);

  const updateBrief = (key: keyof ModelBrief, value: string) => setBrief((current) => ({ ...current, [key]: value }));

  const chooseFile = (kind: AssetKind) => inputs.current[kind]?.click();

  const readFile = async (kind: AssetKind, file: File | undefined) => {
    if (!file) return;
    setBusy(kind);
    setFileErrors((current) => ({ ...current, [kind]: undefined }));
    try {
      const inspection = await inspectImageFile(kind, file);
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
      setFileErrors((current) => ({
        ...current,
        [kind]: error instanceof Error ? error.message : "画像を確認できませんでした。",
      }));
    } finally {
      setBusy(null);
    }
  };

  const copyPrompt = async (key: keyof typeof prompts) => {
    try {
      await copyText(prompts[key]);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1_600);
    } catch {
      setCopied(null);
    }
  };

  const saveManifest = () => {
    saveText(JSON.stringify({
      schemaVersion: 1,
      modelType: "lightweight-web-expression-state-rig",
      renderer: "custom-webgl-mesh",
      generatedAt,
      tool: toolName,
      reference,
      brief,
      prompts,
      inspections,
      validation,
    }, null, 2), "local-avatar-rig-model-manifest.json", "application/json;charset=utf-8");
  };

  const applyCandidateAssets = () => {
    onApplyAssets(candidateAssets);
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
                <button type="button" onClick={() => chooseFile(kind)} disabled={busy === kind}>{busy === kind ? "検査中…" : inspection ? "差し替え" : "選択"}</button>
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

        <div className="provenance-grid">
          <label><span>生成ツール</span><input value={toolName} onChange={(event) => setToolName(event.target.value)} /></label>
          <label><span>生成日</span><input type="date" value={generatedAt} onChange={(event) => setGeneratedAt(event.target.value)} /></label>
          <label className="wide"><span>参照元・利用条件</span><textarea value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        </div>
        <div className="builder-actions">
          <button type="button" disabled={!validation.valid} onClick={applyCandidateAssets}><Check size={16} />検証済み素材をプレビューへ適用</button>
          <button type="button" className="secondary" onClick={saveManifest} disabled={!requiredLoaded}><Download size={16} />Manifestを保存</button>
          <button type="button" className="secondary" onClick={() => {
            const activeUrls = new Set(Object.values(activeAssetsRef.current));
            for (const url of ownedObjectUrlsRef.current) {
              if (!activeUrls.has(url)) URL.revokeObjectURL(url);
            }
            ownedObjectUrlsRef.current.clear();
            setCandidateAssets(DEFAULT_ASSETS);
            setInspections({});
            setFileErrors({});
            onResetAssets();
          }}><RotateCcw size={16} />標準モデルへ戻す</button>
        </div>
      </section>
    </div>
  );
}
