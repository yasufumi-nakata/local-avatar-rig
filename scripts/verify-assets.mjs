import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expected = [
  {
    path: "public/assets/vtuber-rig-default-neutral-v1.png",
    width: 1672,
    height: 941,
    bytes: 1_120_727,
    colorType: 6,
    sha256: "48629bb48a253325e599b9356fa13782c0f1b5a4f148c107756e42360e86c74f",
  },
  {
    path: "public/assets/vtuber-rig-default-blink-v1.png",
    width: 1672,
    height: 941,
    bytes: 1_294_747,
    colorType: 6,
    sha256: "9ebb6b2488a1ee537dbe9bf58be125496d44d251b773799da2bb8b714a2c117b",
  },
  {
    path: "public/assets/vtuber-rig-default-mouth-open-v1.png",
    width: 1672,
    height: 941,
    bytes: 1_306_371,
    colorType: 6,
    sha256: "56cd42e688fb6b4f82855875b0738ab745c176f5ae24a9628b3e9d543cd42de6",
  },
];

function readPngHeader(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("PNG signatureが一致しません。");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

const failures = [];
for (const asset of expected) {
  try {
    const buffer = await readFile(path.join(root, asset.path));
    const header = readPngHeader(buffer);
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (buffer.length !== asset.bytes) failures.push(`${asset.path}: サイズ ${buffer.length} bytes（期待 ${asset.bytes}）`);
    if (header.width !== asset.width || header.height !== asset.height) {
      failures.push(`${asset.path}: 寸法 ${header.width}x${header.height}（期待 ${asset.width}x${asset.height}）`);
    }
    if (header.colorType !== asset.colorType) failures.push(`${asset.path}: PNG color type ${header.colorType} が想定外です。`);
    if (digest !== asset.sha256) failures.push(`${asset.path}: SHA-256がmanifestと一致しません。`);
  } catch (error) {
    failures.push(`${asset.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const catalog = JSON.parse(await readFile(path.join(root, "public/assets/default-avatar.manifest.json"), "utf8"));
  if (catalog.defaultPackId !== "default-navigator-v1") {
    failures.push("default-avatar.manifest.json: 既定packがdefault-navigator-v1ではありません。");
  }
  const packs = catalog.availablePacks ?? [];
  if (packs.length !== 1 || packs[0]?.id !== "default-navigator-v1") {
    failures.push("default-avatar.manifest.json: 公開版の組込みpackはdefault-navigator-v1の1件だけにしてください。");
  }
  for (const pack of packs) {
    const manifest = JSON.parse(await readFile(path.join(root, "public/assets", pack.manifest), "utf8"));
    if (manifest.id !== pack.id) failures.push(`${pack.manifest}: pack IDがcatalogと一致しません。`);
    if (manifest.renderer !== "custom-webgl-mesh") failures.push(`${pack.manifest}: renderer境界が記録されていません。`);
    const assetEntries = Object.entries(manifest.assets ?? {});
    if (assetEntries.length !== 3) failures.push(`${pack.manifest}: 組込み画像は3状態だけにしてください。`);
    for (const [state, asset] of assetEntries) {
      const verified = expected.find(({ path: assetPath }) => assetPath === `public/assets/${asset.file}`);
      if (!verified) {
        failures.push(`${pack.manifest}: 未検証の資産 ${asset.file} を参照しています。`);
        continue;
      }
      if (asset.sha256 !== verified.sha256 || asset.bytes !== verified.bytes) {
        failures.push(`${pack.manifest}: ${asset.file}の検証値が一致しません。`);
      }
      if (asset.width !== 1672 || asset.height !== 941 || asset.pngColorType !== 6 || asset.alpha !== true) {
        failures.push(`${pack.manifest}: ${state}は1672x941 RGBA・実アルファ必須です。`);
      }
    }
  }
} catch (error) {
  failures.push(`組込みモデルmanifest: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const worker = await readFile(path.join(root, "src/workers/faceLandmarker.worker.ts"), "utf8");
  const modelLoader = await readFile(path.join(root, "src/lib/faceModel.ts"), "utf8");
  const requirements = [
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    "3_758_596",
    "redirect: \"error\"",
    "crypto.subtle.digest(\"SHA-256\"",
  ];
  for (const requirement of requirements) {
    if (!modelLoader.includes(requirement)) failures.push(`顔追従モデルの固定取得条件がありません: ${requirement}`);
  }
  if (/face_landmarker\.task\?url/u.test(worker)) failures.push("Face Landmarkerモデルをbundleへ直接取り込んでいます。");
} catch (error) {
  failures.push(`顔追従Worker: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log("✓ 組込みアバター3状態、単一pack manifest、顔追従モデルの固定取得条件を確認しました。");
}
