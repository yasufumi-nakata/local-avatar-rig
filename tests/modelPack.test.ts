import { describe, expect, it } from "vitest";
import {
  buildModelPrompts,
  DEFAULT_MODEL_BRIEF,
  formatPromptDocument,
  inspectPngHeader,
  MAX_IMPORTED_PNG_BYTES,
  type AssetInspection,
  validateAssetInspections,
} from "../src/lib/modelPack";

function inspection(
  kind: AssetInspection["kind"],
  overrides: Partial<AssetInspection> = {},
): AssetInspection {
  return {
    kind,
    name: `${kind}.png`,
    width: 1672,
    height: 941,
    hasAlpha: true,
    transparentPixelRatio: 0.42,
    sha256: "a".repeat(64),
    ...overrides,
  };
}

function pngHeader(width: number, height: number) {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  header.set([73, 72, 68, 82], 12);
  const view = new DataView(header.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return header;
}

describe("model prompt builder", () => {
  it("keeps identity registration and transparency constraints in every state", () => {
    const prompts = buildModelPrompts(DEFAULT_MODEL_BRIEF);
    expect(prompts.neutral).toContain("1672x941");
    expect(prompts.neutral).toContain("genuinely transparent alpha");
    expect(prompts.blink).toContain("change only the eyelids");
    expect(prompts.blink).toContain("pixel registration");
    expect(prompts.mouthOpen).toContain("change only the mouth");
    expect(prompts.mouthOpen).toContain("no opaque or checkerboard background");
  });

  it("labels the output honestly as a lightweight vendor-neutral rig", () => {
    const prompts = buildModelPrompts(DEFAULT_MODEL_BRIEF);
    const document = formatPromptDocument(DEFAULT_MODEL_BRIEF, prompts);
    expect(document).toContain("軽量Webプレビューリグ");
    expect(document).toContain("特定ベンダーの専用モデル形式や階層PSDは生成しません");
  });
});

describe("custom asset validation", () => {
  it("accepts registered transparent PNG state metadata", () => {
    const result = validateAssetInspections({
      neutral: inspection("neutral"),
      blink: inspection("blink"),
      mouthOpen: inspection("mouthOpen"),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects mismatched dimensions and painted opaque backgrounds", () => {
    const result = validateAssetInspections({
      neutral: inspection("neutral"),
      blink: inspection("blink", { width: 1600 }),
      mouthOpen: inspection("mouthOpen", { hasAlpha: false, transparentPixelRatio: 0 }),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("neutralと同じ寸法");
    expect(result.errors.join("\n")).toContain("実際の透明アルファ");
  });

  it("requires all three expression states", () => {
    const result = validateAssetInspections({ neutral: inspection("neutral") });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("blink画像がありません。");
    expect(result.errors).toContain("mouthOpen画像がありません。");
  });

  it("rejects non-16:9 rigs", () => {
    const square = validateAssetInspections({
      neutral: inspection("neutral", { width: 1024, height: 1024 }),
      blink: inspection("blink", { width: 1024, height: 1024 }),
      mouthOpen: inspection("mouthOpen", { width: 1024, height: 1024 }),
    });
    expect(square.valid).toBe(false);
    expect(square.errors.join("\n")).toContain("16:9");
  });
});

describe("PNG preflight", () => {
  it("reads a valid IHDR before image decode", () => {
    expect(inspectPngHeader(pngHeader(1672, 941), 1_000_000, 4096)).toEqual({ width: 1672, height: 941 });
  });

  it("rejects forged, oversized and texture-incompatible PNGs before decode", () => {
    expect(() => inspectPngHeader(new Uint8Array(24), 100, 4096)).toThrow("PNG署名");
    expect(() => inspectPngHeader(pngHeader(1672, 941), MAX_IMPORTED_PNG_BYTES + 1, 4096)).toThrow("20MB以下");
    expect(() => inspectPngHeader(pngHeader(4096, 3000), 1_000_000, 4096)).toThrow("1,000万画素以下");
    expect(() => inspectPngHeader(pngHeader(3000, 1688), 1_000_000, 2048)).toThrow("最大寸法は2048");
  });
});
