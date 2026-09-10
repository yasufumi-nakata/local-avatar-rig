import { DEFAULT_AVATAR_BONES, hasValidBones, type AvatarBones, type RigPoint, type RigProfile } from "./avatarRigProfile";

export interface RigImagePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface RigAnalysisResult {
  profile: RigProfile;
  confidence: "high" | "low";
  notes: string[];
}

type ExpressionImages<T> = { neutral: T; blink: T; mouthOpen: T };
type PixelPoint = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Component = Bounds & PixelPoint & { count: number; energy: number };
type Difference = { components: Component[]; count: number; alphaChanges: number };
class RigImageLoadError extends Error {}

const ANALYSIS_SIZE = 768;
const MAX_IMAGE_PIXELS = 10_000_000;
const MAX_IMAGE_DIMENSION = 4096;
const DEFAULT_PROFILE: RigProfile = {
  leftEyeCenter: [0.445, 0.375],
  rightEyeCenter: [0.555, 0.375],
  mouthCenter: [0.5, 0.49],
  bones: DEFAULT_AVATAR_BONES,
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const fallback = (note: string): RigAnalysisResult => ({ profile: { ...DEFAULT_PROFILE }, confidence: "low", notes: [note, "関節は仮配置です。画像を確認してから調整してください。"] });

function validPixels(image: RigImagePixels): boolean {
  return Boolean(image && Number.isInteger(image.width) && Number.isInteger(image.height)
    && image.width >= 16 && image.height >= 16
    && image.width <= MAX_IMAGE_DIMENSION && image.height <= MAX_IMAGE_DIMENSION
    && image.width * image.height <= MAX_IMAGE_PIXELS
    && (image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)
    && image.data.length === image.width * image.height * 4);
}

function resizePixels(image: RigImagePixels): RigImagePixels {
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (Math.min(image.height - 1, Math.floor((y + 0.5) / scale)) * image.width
        + Math.min(image.width - 1, Math.floor((x + 0.5) / scale))) * 4;
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) data[target + channel] = image.data[source + channel];
    }
  }
  return { width, height, data };
}

function foreground(image: RigImagePixels): { bounds: Bounds; count: number; rows: Bounds[] } | null {
  const xs = new Uint32Array(image.width);
  const ys = new Uint32Array(image.height);
  const rows: Bounds[] = [];
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    const row = { left: image.width, right: -1, top: y, bottom: y };
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < 96) continue;
      xs[x] += 1;
      ys[y] += 1;
      count += 1;
      row.left = Math.min(row.left, x);
      row.right = x;
    }
    rows.push(row);
  }
  if (count < image.width * image.height * 0.015) return null;
  // Ignore isolated transparent-edge specks rather than letting one pixel set the scale.
  const quantile = (histogram: Uint32Array, fraction: number) => {
    let total = 0;
    for (let index = 0; index < histogram.length; index += 1) {
      total += histogram[index];
      if (total >= count * fraction) return index;
    }
    return histogram.length - 1;
  };
  return {
    bounds: { left: quantile(xs, 0.002), right: quantile(xs, 0.998), top: quantile(ys, 0.002), bottom: quantile(ys, 0.998) },
    count,
    rows,
  };
}

function differences(neutral: RigImagePixels, expression: RigImagePixels): Difference {
  const { width, height } = neutral;
  const energy = new Uint8Array(width * height);
  let count = 0;
  let alphaChanges = 0;
  for (let index = 0; index < energy.length; index += 1) {
    const offset = index * 4;
    const alphaA = neutral.data[offset + 3] / 255;
    const alphaB = expression.data[offset + 3] / 255;
    if ((alphaA > 0.38) !== (alphaB > 0.38)) alphaChanges += 1;
    if (Math.max(alphaA, alphaB) < 0.38) continue;
    let delta = Math.abs(alphaA - alphaB) * 255;
    for (let channel = 0; channel < 3; channel += 1) {
      delta = Math.max(delta, Math.abs(neutral.data[offset + channel] * alphaA - expression.data[offset + channel] * alphaB));
    }
    if (delta >= 20) { energy[index] = Math.round(delta); count += 1; }
  }
  // A closed eyelid/closed lip can leave a thin unchanged stripe between two
  // changed areas. Join those areas without counting the added bridge as evidence.
  const connected = new Uint8Array(energy.length);
  const bridgeRadius = Math.max(1, Math.round(Math.min(width, height) * 0.006));
  for (let index = 0; index < energy.length; index += 1) {
    if (!energy[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let row = Math.max(0, y - bridgeRadius); row <= Math.min(height - 1, y + bridgeRadius); row += 1) {
      connected.fill(1, row * width + Math.max(0, x - bridgeRadius), row * width + Math.min(width, x + bridgeRadius + 1));
    }
  }
  const seen = new Uint8Array(energy.length);
  const queue = new Int32Array(energy.length);
  const components: Component[] = [];
  for (let index = 0; index < energy.length; index += 1) {
    if (seen[index] || !connected[index]) continue;
    let start = 0;
    let end = 1;
    queue[0] = index;
    seen[index] = 1;
    const component: Component = { left: width, right: 0, top: height, bottom: 0, x: 0, y: 0, count: 0, energy: 0 };
    while (start < end) {
      const next = queue[start++];
      const x = next % width;
      const y = Math.floor(next / width);
      const weight = energy[next];
      if (weight) {
        component.count += 1;
        component.energy += weight;
        component.x += (x + 0.5) * weight;
        component.y += (y + 0.5) * weight;
        component.left = Math.min(component.left, x);
        component.right = Math.max(component.right, x);
        component.top = Math.min(component.top, y);
        component.bottom = Math.max(component.bottom, y);
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (!seen[neighbor] && connected[neighbor]) { seen[neighbor] = 1; queue[end++] = neighbor; }
        }
      }
    }
    if (component.count < 3) continue;
    component.x /= component.energy;
    component.y /= component.energy;
    components.push(component);
  }
  return { components: components.sort((a, b) => b.energy - a.energy).slice(0, 80), count, alphaChanges };
}

function findEyes(difference: Difference, bounds: Bounds): [Component, Component] | null {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const candidates = difference.components.filter((part) => part.right - part.left < width * 0.3
    && part.bottom - part.top < height * 0.19
    && part.y > bounds.top + height * 0.15 && part.y < bounds.top + height * 0.62);
  let best: [Component, Component] | null = null;
  let bestScore = 0;
  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      const [left, right] = [candidates[first], candidates[second]].sort((a, b) => a.x - b.x);
      const separation = right.x - left.x;
      const imbalance = Math.min(left.count, right.count) / Math.max(left.count, right.count);
      if (separation < width * 0.1 || separation > width * 0.5 || imbalance < 0.2
        || Math.abs(left.y - right.y) > separation * 0.24) continue;
      const score = (left.energy + right.energy) * Math.sqrt(imbalance) / (1 + Math.abs(left.y - right.y) / separation * 12);
      if (score > bestScore) { bestScore = score; best = [left, right]; }
    }
  }
  return best;
}

function findMouth(difference: Difference, eyes: readonly PixelPoint[]): Component | null {
  const eyeX = (eyes[0].x + eyes[1].x) / 2;
  const eyeY = (eyes[0].y + eyes[1].y) / 2;
  const separation = eyes[1].x - eyes[0].x;
  const candidates = difference.components.filter((part) => Math.abs(part.x - eyeX) < separation * 0.55
    && part.y - eyeY > separation * 0.25 && part.y - eyeY < separation * 1.55
    && part.right - part.left < separation * 0.95 && part.bottom - part.top < separation * 0.7);
  return candidates.sort((a, b) => {
    const score = (part: Component) => part.energy / (1 + Math.abs(part.x - eyeX) / separation * 4
      + Math.abs((part.y - eyeY) / separation - 0.65));
    return score(b) - score(a);
  })[0] ?? null;
}

function estimateBones(
  image: RigImagePixels,
  shape: NonNullable<ReturnType<typeof foreground>>,
  eyes: readonly PixelPoint[],
  mouth: PixelPoint,
): { bones: AvatarBones; skinFound: boolean; bodyFound: boolean } {
  const eyeY = (eyes[0].y + eyes[1].y) / 2;
  const separation = eyes[1].x - eyes[0].x;
  const centerX = (mouth.x + (eyes[0].x + eyes[1].x) / 2) / 2;
  const radius = Math.max(1, Math.round(separation * 0.08));
  const samples: number[][] = [[], [], []];
  for (const side of [-1, 1]) {
    const xCenter = Math.round(mouth.x + side * separation * 0.38);
    const yCenter = Math.round(eyeY + (mouth.y - eyeY) * 0.65);
    for (let y = yCenter - radius; y <= yCenter + radius; y += 1) {
      for (let x = xCenter - radius; x <= xCenter + radius; x += 1) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        const index = (y * image.width + x) * 4;
        if (image.data[index + 3] < 192) continue;
        for (let channel = 0; channel < 3; channel += 1) samples[channel].push(image.data[index + channel]);
      }
    }
  }
  const color = samples.map(median);
  const colorSum = color.reduce((sum, value) => sum + value, 0);
  const chroma = color.map((value) => value / Math.max(1, colorSum));
  const centralColor = (y: number) => {
    const values: number[][] = [[], [], []];
    for (let x = Math.round(centerX - radius / 2); x <= Math.round(centerX + radius / 2); x += 1) {
      if (x < 0 || x >= image.width || y < 0 || y >= image.height) continue;
      const index = (Math.round(y) * image.width + x) * 4;
      if (image.data[index + 3] < 192) continue;
      for (let channel = 0; channel < 3; channel += 1) values[channel].push(image.data[index + channel]);
    }
    return values.map(median);
  };
  const chromaDistance = (candidate: number[], reference: number[]) => {
    const sum = candidate.reduce((total, value) => total + value, 0);
    return candidate.reduce((distance, value, channel) => distance + (value / Math.max(1, sum) - reference[channel]) ** 2, 0);
  };
  // The skin below a drawn jaw is often much darker/warmer than the cheeks.
  // Locate that transition and learn its color, so cheek-only classification
  // neither ends the neck at the chin nor starts neck deformation inside the face.
  const jawGap = Math.max(2, Math.round(separation * 0.035));
  let jawY: number | null = null;
  let neckChroma = chroma;
  for (let y = Math.round(mouth.y + separation * 0.22); y <= mouth.y + separation * 0.8; y += 1) {
    const before = centralColor(y - jawGap);
    const after = centralColor(y + jawGap);
    const afterSum = after.reduce((sum, value) => sum + value, 0);
    if (before.reduce((sum, value) => sum + value, 0) - afterSum < Math.max(35, colorSum * 0.1)
      || afterSum < colorSum * 0.45 || chromaDistance(after, chroma) > 0.007) continue;
    const afterChroma = after.map((value) => value / Math.max(1, afterSum));
    const continuation = centralColor(y + jawGap + Math.max(3, Math.round(separation * 0.07)));
    if (chromaDistance(continuation, afterChroma) > 0.003
      || continuation.reduce((sum, value) => sum + value, 0) < afterSum * 0.65) continue;
    jawY = y + jawGap;
    neckChroma = afterChroma;
    break;
  }
  const isSkin = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
    const index = (y * image.width + x) * 4;
    if (image.data[index + 3] < 160) return false;
    const sum = image.data[index] + image.data[index + 1] + image.data[index + 2];
    if (sum < colorSum * 0.45 || sum > colorSum * 1.2 || sum < 45) return false;
    let cheekDistance = 0;
    let neckDistance = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      cheekDistance += (image.data[index + channel] / sum - chroma[channel]) ** 2;
      neckDistance += (image.data[index + channel] / sum - neckChroma[channel]) ** 2;
    }
    return Math.min(cheekDistance, neckDistance) < 0.0019;
  };
  const skinRows: { y: number; width: number }[] = [];
  const scanStart = Math.round(mouth.y + separation * 0.15);
  const scanEnd = Math.min(image.height - 1, Math.round(mouth.y + separation * 1.6));
  for (let y = scanStart; y <= scanEnd; y += 1) {
    const center = Math.round(centerX);
    // A one-pixel ink outline must not split the visible jaw from the neck.
    const matches = (x: number) => isSkin(x, y) || isSkin(x, y - 1) || isSkin(x, y + 1);
    if (!matches(center)) { skinRows.push({ y, width: 0 }); continue; }
    const extent = (direction: number) => {
      let last = center;
      let gap = 0;
      for (let step = 1; step <= separation * 1.15; step += 1) {
        const x = center + direction * step;
        if (matches(x)) { last = x; gap = 0; }
        else { gap += 1; if (gap > Math.max(1, separation * 0.035)) break; }
      }
      return last;
    };
    skinRows.push({ y, width: extent(1) - extent(-1) + 1 });
  }
  // Visible neck is a sustained narrow central region following the broader jaw.
  let neckStart = -1;
  let neckEnd = -1;
  const minimumRun = Math.max(3, Math.round(separation * 0.12));
  for (let start = 0; start < skinRows.length; start += 1) {
    if (skinRows[start].width < separation * 0.22 || skinRows[start].width > separation * 0.92) continue;
    let end = start;
    while (end + 1 < skinRows.length && skinRows[end + 1].width >= separation * 0.18
      && skinRows[end + 1].width <= separation * 1.02) end += 1;
    if (end - start + 1 >= minimumRun) { neckStart = start; neckEnd = end; break; }
  }
  const skinFound = samples[0].length >= 12 && colorSum > 60 && neckStart >= 0;
  let headY = jawY === null ? mouth.y + separation * 0.4 : jawY + separation * 0.025;
  let neckY = skinFound ? skinRows[neckEnd].y + separation * 0.15 : mouth.y + separation * 0.7;
  headY = clamp(headY, mouth.y + separation * 0.2, image.height * 0.84);
  neckY = clamp(neckY, headY + image.height * 0.022, image.height * 0.89);

  const smoothWidth = (y: number) => median(Array.from({ length: 7 }, (_, offset) => {
    const row = shape.rows[clamp(Math.round(y + offset - 3), 0, image.height - 1)];
    return Math.max(0, row.right - row.left);
  }));
  // Find the lower silhouette's widening after the neck/hair waist.
  const shoulderStart = Math.round(neckY + separation * 0.2);
  const shoulderEnd = Math.min(shape.bounds.bottom - 2, Math.round(neckY + separation * 1.15));
  let shoulderY = neckY + separation * 0.65;
  let bestScore = -Infinity;
  for (let y = shoulderStart; y <= shoulderEnd; y += 1) {
    const width = smoothWidth(y);
    const growth = smoothWidth(y + separation * 0.22) - smoothWidth(y - separation * 0.22);
    if (width < separation * 2) continue;
    const score = growth - Math.abs(y - (neckY + separation * 0.55)) * 0.2;
    if (score > bestScore) { bestScore = score; shoulderY = y; }
  }
  const chestY = clamp(Math.max(neckY + separation, shoulderY + separation * 0.5), neckY + image.height * 0.065, image.height * 0.98);
  shoulderY = clamp(shoulderY, neckY + image.height * 0.01, chestY - image.height * 0.015);
  const shoulderRow = shape.rows[clamp(Math.round(shoulderY), 0, image.height - 1)];
  const bodyFound = shape.bounds.bottom >= chestY && smoothWidth(chestY) >= separation * 2
    && smoothWidth(shoulderY) >= separation * 1.8;
  const leftEdge = shoulderRow.right > shoulderRow.left ? shoulderRow.left : centerX - separation * 1.4;
  const rightEdge = shoulderRow.right > shoulderRow.left ? shoulderRow.right : centerX + separation * 1.4;
  const uv = (x: number, y: number): RigPoint => [clamp(x / image.width, 0, 1), clamp(y / image.height, 0, 1)];
  return {
    bones: {
      head: uv(centerX, headY),
      neck: uv(centerX, neckY),
      chest: uv(centerX, chestY),
      leftShoulder: uv(Math.min(centerX - separation * 0.5, leftEdge + (centerX - leftEdge) * 0.2), shoulderY),
      rightShoulder: uv(Math.max(centerX + separation * 0.5, rightEdge - (rightEdge - centerX) * 0.2), shoulderY),
    },
    skinFound,
    bodyFound,
  };
}

/** Local, deterministic pixel analysis. It does not upload images or run a face-identification service. */
export function inferRigFromPixels(sources: ExpressionImages<RigImagePixels>): RigAnalysisResult {
  if (!sources || ![sources.neutral, sources.blink, sources.mouthOpen].every(validPixels)) {
    return fallback("画像の画素データが不正か、解析可能な寸法を超えています。");
  }
  if ([sources.blink, sources.mouthOpen].some((image) => image.width !== sources.neutral.width || image.height !== sources.neutral.height)) {
    return fallback("3枚の画像サイズが一致しないため、表情差分を解析できませんでした。");
  }
  const neutral = resizePixels(sources.neutral);
  const shape = foreground(neutral);
  if (!shape) return fallback("透過画像内に十分な大きさのキャラクターを見つけられませんでした。");
  const blink = differences(neutral, resizePixels(sources.blink));
  const mouthOpen = differences(neutral, resizePixels(sources.mouthOpen));
  const notes: string[] = [];
  const hasSilhouette = shape.count < neutral.width * neutral.height * 0.96;
  if (!hasSilhouette) notes.push("透過輪郭を確認できないため、背景を含む関節位置は仮の推定です。");
  const eyeParts = findEyes(blink, shape.bounds);
  const eyesLocalized = Boolean(eyeParts && (eyeParts[0].count + eyeParts[1].count) / Math.max(1, blink.count) >= 0.65
    && blink.count / shape.count < 0.12 && blink.alphaChanges / shape.count < 0.015);
  const boxWidth = shape.bounds.right - shape.bounds.left;
  const boxHeight = shape.bounds.bottom - shape.bounds.top;
  const centerX = (shape.bounds.left + shape.bounds.right) / 2;
  const eyes: [PixelPoint, PixelPoint] = eyesLocalized && eyeParts ? eyeParts : [
    { x: centerX - boxWidth * 0.105, y: shape.bounds.top + boxHeight * 0.36 },
    { x: centerX + boxWidth * 0.105, y: shape.bounds.top + boxHeight * 0.36 },
  ];
  if (!eyesLocalized) notes.push(blink.count < 6
    ? "まばたき画像に十分な目の差分がないため、目は輪郭に対する仮配置です。"
    : "まばたき画像の差分が両目に集中していません。位置ずれや髪・服の変化を確認してください。目は仮配置です。");
  const mouthPart = findMouth(mouthOpen, eyes);
  const mouthLocalized = Boolean(mouthPart && mouthPart.count / Math.max(1, mouthOpen.count) >= 0.55
    && mouthOpen.count / shape.count < 0.055 && mouthOpen.alphaChanges / shape.count < 0.015);
  const mouth: PixelPoint = mouthLocalized && mouthPart ? mouthPart
    : { x: (eyes[0].x + eyes[1].x) / 2, y: (eyes[0].y + eyes[1].y) / 2 + (eyes[1].x - eyes[0].x) * 0.65 };
  if (!mouthLocalized) notes.push(mouthOpen.count < 3
    ? "口開き画像に十分な口の差分がないため、口は仮配置です。"
    : "口開き画像の差分が口に集中していません。位置ずれや表情以外の変化を確認してください。口は仮配置です。");
  if (eyesLocalized && mouthLocalized) notes.push("まばたきと口開きの局所差分から、両目と口の位置を推定しました。");
  const estimated = estimateBones(neutral, shape, eyes, mouth);
  if (!hasValidBones(estimated.bones)) return fallback("顔と首・胸の位置関係を安全に推定できませんでした。画像内の大きさや構図を確認してください。");
  notes.push(estimated.skinFound
    ? "頬の色、中央の首幅、透過輪郭から関節を推定しました。髪や服で隠れる首根元・肩・胸はプレビューで調整してください。"
    : "肌領域から首の境界を確認できませんでした。顔の大きさと輪郭に基づく仮の関節配置です。");
  if (!estimated.bodyFound) notes.push("首より下の胴体の輪郭を十分に確認できませんでした。肩と胸の関節は仮配置です。");
  const uv = (point: PixelPoint): RigPoint => [clamp(point.x / neutral.width, 0, 1), clamp(point.y / neutral.height, 0, 1)];
  return {
    profile: { leftEyeCenter: uv(eyes[0]), rightEyeCenter: uv(eyes[1]), mouthCenter: uv(mouth), bones: estimated.bones },
    confidence: hasSilhouette && eyesLocalized && mouthLocalized && estimated.skinFound && estimated.bodyFound ? "high" : "low",
    notes,
  };
}

function loadLocalImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined" || typeof document === "undefined") { reject(new RigImageLoadError("ブラウザーの画像解析機能が利用できません。")); return; }
    if (typeof source !== "string" || !source) { reject(new RigImageLoadError("画像の参照先が不正です。")); return; }
    let url: URL;
    try { url = new URL(source, window.location.href); }
    catch { reject(new RigImageLoadError("画像の参照先が不正です。")); return; }
    if (!["blob:", "data:"].includes(url.protocol) && url.origin !== window.location.origin) {
      reject(new RigImageLoadError("画像解析には、このアプリ内の画像または読み込んだローカル画像をご利用ください。")); return;
    }
    const image = new Image();
    const timeout = window.setTimeout(() => { image.onload = null; image.onerror = null; image.src = ""; reject(new RigImageLoadError("画像の読み込みが時間内に完了しませんでした。")); }, 15_000);
    const cleanup = () => { window.clearTimeout(timeout); image.onload = null; image.onerror = null; };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new RigImageLoadError("画像を読み込めませんでした。PNGファイルを確認してください。")); };
    image.src = source;
  });
}

/** Decode only in this browser; expression registration is checked before any resizing. */
export async function inferRigFromImages(sources: ExpressionImages<string>): Promise<RigAnalysisResult> {
  try {
    const loaded = await Promise.all([sources.neutral, sources.blink, sources.mouthOpen].map(loadLocalImage));
    const neutral = loaded[0];
    if (loaded.some((image) => image.naturalWidth !== neutral.naturalWidth || image.naturalHeight !== neutral.naturalHeight)) {
      return fallback("3枚の画像サイズが一致しないため、表情差分を解析できませんでした。");
    }
    if (neutral.naturalWidth < 16 || neutral.naturalHeight < 16 || neutral.naturalWidth > MAX_IMAGE_DIMENSION
      || neutral.naturalHeight > MAX_IMAGE_DIMENSION || neutral.naturalWidth * neutral.naturalHeight > MAX_IMAGE_PIXELS) {
      return fallback("画像が小さすぎるか、解析可能な寸法を超えています。");
    }
    const scale = Math.min(1, ANALYSIS_SIZE / Math.max(neutral.naturalWidth, neutral.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(neutral.naturalWidth * scale);
    canvas.height = Math.round(neutral.naturalHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return fallback("画像を解析するCanvasを準備できませんでした。");
    const pixels = loaded.map((image) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    });
    return inferRigFromPixels({ neutral: pixels[0], blink: pixels[1], mouthOpen: pixels[2] });
  } catch (error) {
    return fallback(error instanceof RigImageLoadError ? error.message : "画像の読み込み・画素の取得に失敗しました。画像形式やブラウザーの状態を確認してください。");
  }
}
