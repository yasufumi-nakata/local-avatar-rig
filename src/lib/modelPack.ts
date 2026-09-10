import type { AvatarTextureSources, RigProfile } from "./webglAvatarRenderer";
import { DEFAULT_AVATAR_BONES } from "./avatarRigProfile";

export type AssetKind = "neutral" | "blink" | "mouthOpen" | "background";

export interface ModelBrief {
  identity: string;
  role: string;
  palette: string;
  outfit: string;
  motif: string;
  exclusions: string;
}

export interface ModelPromptPack {
  neutral: string;
  blink: string;
  mouthOpen: string;
  transparencyRepair: string;
}

export interface AssetInspection {
  kind: AssetKind;
  name: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  transparentPixelRatio: number;
  sha256: string;
}

export interface AssetValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface LocalAvatarAssetSet extends AvatarTextureSources {
  background?: string;
}

export type BuiltInAvatarPackId = "default-navigator-v1";

export interface BuiltInAvatarPack {
  id: BuiltInAvatarPackId;
  displayName: string;
  shortLabel: string;
  description: string;
  assets: LocalAvatarAssetSet;
  profile: RigProfile;
  altText: string;
  manifestUrl: string;
}

export const MAX_IMPORTED_PNG_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORTED_IMAGE_PIXELS = 10_000_000;
export const MAX_IMPORTED_IMAGE_DIMENSION = 4096;
const TARGET_ASPECT_RATIO = 16 / 9;
const ASPECT_RATIO_TOLERANCE = 0.02;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export const DEFAULT_MODEL_BRIEF: ModelBrief = {
  identity: "若い成人の女性型バーチャル研究ナビゲーター。落ち着きがあり、知的で親しみやすい表情",
  role: "技術・研究配信を案内する、穏やかで反応のよいナビゲーター",
  palette: "月光のような銀青の髪、琥珀色の瞳、深紺・ティール・金のアクセント",
  outfit: "控えめなハイネックの深紺の研究服。境界の明瞭なパネル、細いティールのライン、小さな金の縁取り",
  motif: "片側の小さな四芒星ヘアオーナメント",
  exclusions: "実在人物、第三者ロゴ、文字、透かし、性的な衣装、顔を隠す小物、手、複雑すぎるアクセサリー",
};

const DEFAULT_NAVIGATOR_PROFILE: RigProfile = {
  leftEyeCenter: [0.4455, 0.3745],
  rightEyeCenter: [0.5615, 0.3745],
  mouthCenter: [0.4995, 0.4890],
  bones: DEFAULT_AVATAR_BONES,
};

export const BUILT_IN_AVATAR_PACKS: Record<BuiltInAvatarPackId, BuiltInAvatarPack> = {
  "default-navigator-v1": {
    id: "default-navigator-v1",
    displayName: "Default Navigator",
    shortLabel: "Navigator",
    description: "銀青の研究ナビゲーター",
    assets: {
      neutral: "/assets/vtuber-rig-default-neutral-v1.png",
      blink: "/assets/vtuber-rig-default-blink-v1.png",
      mouthOpen: "/assets/vtuber-rig-default-mouth-open-v1.png",
    },
    profile: DEFAULT_NAVIGATOR_PROFILE,
    altText: "銀青の髪と琥珀色の瞳、深紺の研究服をまとったオリジナル2D VTuberアバター",
    manifestUrl: "/assets/default-navigator-v1.manifest.json",
  },
};

export const BUILT_IN_AVATAR_PACK_LIST = Object.values(BUILT_IN_AVATAR_PACKS);
export const DEFAULT_BUILT_IN_AVATAR_PACK_ID: BuiltInAvatarPackId = "default-navigator-v1";
export const DEFAULT_ASSETS = BUILT_IN_AVATAR_PACKS[DEFAULT_BUILT_IN_AVATAR_PACK_ID].assets;
export const DEFAULT_PROFILE = BUILT_IN_AVATAR_PACKS[DEFAULT_BUILT_IN_AVATAR_PACK_ID].profile;

export function isBuiltInAvatarPackId(value: unknown): value is BuiltInAvatarPackId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BUILT_IN_AVATAR_PACKS, value);
}

export const DEFAULT_ASSET_MANIFEST = {
  model: "Default Navigator web preview rig v1",
  canvas: { width: 1672, height: 941 },
  mouthPatchMode: "registered-alpha" as const,
  note: "3状態は同一寸法・実アルファで、目と口の局所差分だけをNeutralへ登録しています。",
  sha256: {
    neutral: "48629bb48a253325e599b9356fa13782c0f1b5a4f148c107756e42360e86c74f",
    blink: "9ebb6b2488a1ee537dbe9bf58be125496d44d251b773799da2bb8b714a2c117b",
    mouthOpen: "56cd42e688fb6b4f82855875b0738ab745c176f5ae24a9628b3e9d543cd42de6",
  },
};

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function buildModelPrompts(brief: ModelBrief): ModelPromptPack {
  const identity = clean(brief.identity);
  const role = clean(brief.role);
  const palette = clean(brief.palette);
  const outfit = clean(brief.outfit);
  const motif = clean(brief.motif);
  const exclusions = clean(brief.exclusions);
  const registration = "preserve the exact 1672x941 canvas, genuine transparent alpha, pixel registration, crop, silhouette, head angle, face shape, hair, outfit, body proportions, shoulder pose, lighting, colors, rendering, and linework";

  return {
    neutral: [
      "Use case: stylized-concept",
      "Asset type: transparent VTuber character anchor for a lightweight web expression-state rig",
      `Primary request: create a new original front-facing VTuber character for ${role}`,
      `Subject: ${identity}; eyes fully open; mouth gently closed; relaxed symmetric head-and-torso pose; arms and hands entirely out of frame`,
      "Style/medium: premium 2D anime character illustration, crisp production linework, refined cel shading, clean separated-looking forms",
      "Composition/framing: exact 1672x941 wide canvas; perfectly straight-on camera; character centered; complete hair silhouette, neck, torso, and both shoulders visible; generous transparent padding; no tilt; no three-quarter perspective",
      `Color palette: ${palette}`,
      `Outfit: ${outfit}`,
      `Signature motif: ${motif}`,
      "Rig affordances: distinct front bangs, left and right side locks, back hair mass, face, neck, shoulders, torso, and sleeves; unobstructed eyes and mouth",
      "Anatomy for rigging: a natural short straight neck beneath the jaw; clearly readable chin, neck base and collar; level shoulders; head centered over the neck and chest; preserve these junctions in every expression state",
      "Constraints: genuinely transparent alpha background; original design; no text; no watermark; no logo; no backdrop; no props; no cropped hair or shoulders; no duplicate body parts",
      `Avoid: ${exclusions}; opaque background; painted checkerboard; dynamic pose; face occlusion; loose strands crossing the eyes or mouth; twisted or elongated neck; shoulder tilt; collar merging into the jaw`,
    ].join("\n"),
    blink: [
      "Use case: identity-preserve",
      "Asset type: registered VTuber blink state for a lightweight web expression-state rig",
      "Input image: Image 1 is the accepted neutral character anchor and the only edit target",
      "Primary request: close both eyelids naturally for a calm single blink frame",
      `Constraints: change only the eyelids and the minimum eye-area linework; ${registration}; keep both eyelids symmetric; no added elements; no text; no watermark; no opaque or checkerboard background`,
      "Avoid: head movement, body movement, hair movement, changed mouth, changed eyebrows, tears, wink, squint",
    ].join("\n"),
    mouthOpen: [
      "Use case: identity-preserve",
      "Asset type: registered transparent mouth-open state for a lightweight web expression-state rig",
      "Input image: Image 1 is the accepted neutral character anchor and the only edit target",
      "Primary request: change only the small closed mouth into a natural modest talking mouth with a dark interior and a subtle small tongue",
      `Constraints: change only the mouth; ${registration}; no added elements; no text; no watermark; no opaque or checkerboard background`,
      "Avoid: head movement, changed face shape, changed eyes, changed hair, exaggerated expression, teeth-heavy grin",
    ].join("\n"),
    transparencyRepair: [
      "Use case: background-extraction",
      "Asset type: transparent VTuber state repair",
      "Primary request: remove the entire flat or checkerboard background and replace it with genuine transparent alpha",
      `Constraints: change only the background; ${registration}; preserve clean anti-aliased edges with no white, black, or gray fringe; no new background; no text; no watermark`,
      "Output requirement: actual PNG transparency outside the character, not a painted checkerboard or flat color",
    ].join("\n"),
  };
}

export function formatPromptDocument(brief: ModelBrief, prompts: ModelPromptPack) {
  return `# VTuberモデル生成ブリーフ\n\n` +
    `この文書は軽量Webプレビューリグ用です。特定ベンダーの専用モデル形式や階層PSDは生成しません。\n\n` +
    `## キャラクター定義\n\n` +
    `- アイデンティティ: ${brief.identity}\n` +
    `- 配信上の役割: ${brief.role}\n` +
    `- 配色: ${brief.palette}\n` +
    `- 衣装: ${brief.outfit}\n` +
    `- モチーフ: ${brief.motif}\n` +
    `- 除外: ${brief.exclusions}\n\n` +
    `## Neutral anchor\n\n\`\`\`text\n${prompts.neutral}\n\`\`\`\n\n` +
    `## Blink state\n\n\`\`\`text\n${prompts.blink}\n\`\`\`\n\n` +
    `## Mouth-open state\n\n\`\`\`text\n${prompts.mouthOpen}\n\`\`\`\n\n` +
    `## Transparency repair\n\n\`\`\`text\n${prompts.transparencyRepair}\n\`\`\`\n\n` +
    `## 受入条件\n\n` +
    `- 3状態は同じ1672x941、正面、同一位置、実アルファPNG\n` +
    `- 髪、肩、袖を切らない\n` +
    `- 顎の下に自然な短い首を置き、襟元と水平な肩の境界を明瞭にする\n` +
    `- blinkはまぶた、mouth-openは口以外を変えない\n` +
    `- neutralとの重ね合わせで輪郭が跳ねない\n` +
    `- 取込後のボーン推定で頭の付け根を顎の下、首の根元を襟元、肩と胸を胴体へ合わせる\n` +
    `- 明暗両背景で縁に白・黒・市松が出ない\n`;
}

export function validateAssetInspections(
  inspections: Partial<Record<AssetKind, AssetInspection>>,
): AssetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const required: AssetKind[] = ["neutral", "blink", "mouthOpen"];
  for (const kind of required) {
    if (!inspections[kind]) errors.push(`${kind}画像がありません。`);
  }
  const neutral = inspections.neutral;
  if (!neutral) return { valid: false, errors, warnings };

  for (const kind of required) {
    const item = inspections[kind];
    if (!item) continue;
    if (item.width !== neutral.width || item.height !== neutral.height) {
      errors.push(`${kind}はneutralと同じ寸法にしてください（${item.width}×${item.height} / ${neutral.width}×${neutral.height}）。`);
    }
    if (!item.hasAlpha || item.transparentPixelRatio < 0.01) {
      errors.push(`${kind}には実際の透明アルファが必要です。市松模様を描いた背景は利用できません。`);
    }
  }
  const aspectRatio = neutral.width / neutral.height;
  if (Math.abs(aspectRatio - TARGET_ASPECT_RATIO) > ASPECT_RATIO_TOLERANCE) {
    errors.push("neutralは16:9キャンバスにしてください。固定メッシュの変形位置が合わないため適用できません。");
  }
  if (neutral.width < 1200 || neutral.height < 675) {
    warnings.push("配信時の精細さを保つには、1200×675以上を推奨します。");
  }
  const background = inspections.background;
  if (background && (background.width !== neutral.width || background.height !== neutral.height)) {
    errors.push(`backgroundはneutralと同じ寸法にしてください（${background.width}×${background.height} / ${neutral.width}×${neutral.height}）。`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function browserTextureDimensionLimit() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl");
  if (!gl) return 2048;
  const reported = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  return Number.isFinite(reported)
    ? Math.min(MAX_IMPORTED_IMAGE_DIMENSION, reported)
    : 2048;
}

export function inspectPngHeader(
  header: Uint8Array,
  fileSize: number,
  textureLimit = MAX_IMPORTED_IMAGE_DIMENSION,
) {
  if (fileSize > MAX_IMPORTED_PNG_BYTES) {
    throw new Error(`PNGは${MAX_IMPORTED_PNG_BYTES / 1024 / 1024}MB以下にしてください。`);
  }
  if (header.length < 24 || PNG_SIGNATURE.some((byte, index) => header[index] !== byte)) {
    throw new Error("PNG署名を確認できませんでした。拡張子だけを変更したファイルは利用できません。");
  }
  const chunkName = String.fromCharCode(...header.slice(12, 16));
  if (chunkName !== "IHDR") throw new Error("PNGのIHDRを確認できませんでした。");
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const effectiveLimit = Math.min(MAX_IMPORTED_IMAGE_DIMENSION, textureLimit);
  if (width < 1 || height < 1) throw new Error("PNGの寸法が不正です。");
  if (width > effectiveLimit || height > effectiveLimit) {
    throw new Error(`この端末で扱える最大寸法は${effectiveLimit}×${effectiveLimit}pxです。`);
  }
  if (width * height > MAX_IMPORTED_IMAGE_PIXELS) {
    throw new Error("PNGは合計1,000万画素以下にしてください。");
  }
  return { width, height };
}

export async function inspectImageFile(kind: AssetKind, file: File): Promise<AssetInspection> {
  if (file.type && file.type !== "image/png") throw new Error("PNGファイルを選択してください。");
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  const expected = inspectPngHeader(header, file.size, browserTextureDimensionLimit());
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
      throw new Error("PNGヘッダーと復号後の寸法が一致しません。");
    }
    const sampleWidth = Math.min(512, bitmap.width);
    const sampleHeight = Math.max(1, Math.round(bitmap.height * (sampleWidth / bitmap.width)));
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("画像の透明度を確認できませんでした。");
    context.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let transparent = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 250) transparent += 1;
    }
    const total = pixels.length / 4;
    return {
      kind,
      name: file.name,
      width: bitmap.width,
      height: bitmap.height,
      hasAlpha: transparent > 0,
      transparentPixelRatio: total > 0 ? transparent / total : 0,
      sha256: await sha256(file),
    };
  } finally {
    bitmap.close();
  }
}
