import { describe, expect, it } from "vitest";
import { inferRigFromImages, inferRigFromPixels, type RigImagePixels } from "../src/lib/avatarRigAnalysis";
import { hasValidBones, type RigProfile } from "../src/lib/avatarRigProfile";

type FixtureOptions = { x?: number; y?: number; scale?: number; neckLength?: number; skin?: readonly number[]; neckShade?: readonly number[] };

// An independently drawn character: opaque hair, face, eyes, neck and jacket,
// surrounded by transparency. The expressions change only the two eyes or mouth.
function character({ x = 180, y = 45, scale = 1, neckLength = 0, skin = [225, 172, 145], neckShade = skin }: FixtureOptions = {}) {
  const width = 384;
  const height = 320;
  const draw = (state: "neutral" | "blink" | "mouthOpen"): RigImagePixels => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const u = (px + 0.5 - x) / scale;
        const v = (py + 0.5 - y) / scale;
        let color: readonly number[] | null = null;
        if ((u / 63) ** 2 + ((v - 64) / 71) ** 2 <= 1) color = [63, 70, 132];
        if (v >= 132 + neckLength && v <= 210 + neckLength
          && Math.abs(u) <= 45 + (v - 132 - neckLength) * 0.75) color = [31, 45, 67];
        if (Math.abs(u) <= 17 && v >= 92 && v <= 135 + neckLength) color = neckShade;
        if ((u / 48) ** 2 + ((v - 56) / 56) ** 2 <= 1) color = skin;
        if (Math.abs(Math.abs(u) - 24) <= 10 && Math.abs(v - 63) <= (state === "blink" ? 1.5 : 7)) color = [25, 32, 63];
        if (Math.abs(u) <= 8 && Math.abs(v - 91) <= (state === "mouthOpen" ? 5 : 1)) color = [73, 25, 39];
        if (!color) continue;
        const offset = (py * width + px) * 4;
        data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2]; data[offset + 3] = 255;
      }
    }
    return { width, height, data };
  };
  return { neutral: draw("neutral"), blink: draw("blink"), mouthOpen: draw("mouthOpen") };
}

function points(profile: RigProfile) {
  return [profile.leftEyeCenter, profile.rightEyeCenter, profile.mouthCenter,
    profile.bones!.head, profile.bones!.neck, profile.bones!.chest, profile.bones!.leftShoulder, profile.bones!.rightShoulder];
}

function translate(image: RigImagePixels, dx: number, dy: number): RigImagePixels {
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const from = (sy * image.width + sx) * 4;
      const to = (y * image.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) data[to + channel] = image.data[from + channel];
    }
  }
  return { ...image, data };
}

describe("image-derived avatar rig", () => {
  it("finds both eyes and the mouth from registered expression changes", () => {
    const result = inferRigFromPixels(character());
    expect(result.confidence).toBe("high");
    expect(result.profile.leftEyeCenter[0] * 384).toBeCloseTo(156, 0);
    expect(result.profile.rightEyeCenter[0] * 384).toBeCloseTo(204, 0);
    expect(result.profile.leftEyeCenter[1] * 320).toBeCloseTo(108, 0);
    expect(result.profile.mouthCenter[0] * 384).toBeCloseTo(180, 0);
    expect(result.profile.mouthCenter[1] * 320).toBeCloseTo(136, 0);
    expect(hasValidBones(result.profile.bones)).toBe(true);
    expect(result.profile.bones!.head[1] * 320).toBeGreaterThan(145);
    expect(result.profile.bones!.head[1] * 320).toBeLessThan(168);
    expect(result.notes.join(" ")).toContain("推定");
  });

  it("moves every detected feature and bone with an off-center character", () => {
    const base = inferRigFromPixels(character());
    const shifted = inferRigFromPixels(character({ x: 216, y: 65 }));
    expect(shifted.confidence).toBe("high");
    const expected = points(base.profile);
    points(shifted.profile).forEach((point, index) => {
      expect((point[0] - expected[index][0]) * 384).toBeCloseTo(36, 0);
      expect((point[1] - expected[index][1]) * 320).toBeCloseTo(20, 0);
    });
  });

  it("scales the skeleton with the character rather than copying canvas coordinates", () => {
    const base = inferRigFromPixels(character());
    const small = inferRigFromPixels(character({ scale: 0.75 }));
    expect(small.confidence).toBe("high");
    const expected = points(base.profile);
    points(small.profile).forEach((point, index) => {
      expect(Math.abs(point[0] * 384 - (180 + (expected[index][0] * 384 - 180) * 0.75))).toBeLessThan(3);
      expect(Math.abs(point[1] * 320 - (45 + (expected[index][1] * 320 - 45) * 0.75))).toBeLessThan(4);
    });
  });

  it("uses visible neck length and a learned cheek color for differently colored characters", () => {
    const short = inferRigFromPixels(character());
    const long = inferRigFromPixels(character({ neckLength: 15, skin: [105, 68, 49] }));
    expect(long.confidence).toBe("high");
    expect(Math.abs(long.profile.bones!.head[1] - short.profile.bones!.head[1]) * 320).toBeLessThan(3);
    expect((long.profile.bones!.neck[1] - short.profile.bones!.neck[1]) * 320).toBeGreaterThan(11);
    expect((long.profile.bones!.neck[1] - short.profile.bones!.neck[1]) * 320).toBeLessThan(19);
  });

  it("does not mistake a dark jaw outline for the bottom of the neck", () => {
    const plain = inferRigFromPixels(character());
    const outlined = character();
    for (const image of Object.values(outlined)) {
      for (let y = 154; y <= 157; y += 1) {
        for (let x = 163; x <= 196; x += 1) image.data.set([25, 28, 41, 255], (y * image.width + x) * 4);
      }
    }
    const result = inferRigFromPixels(outlined);
    expect(result.confidence).toBe("high");
    expect(Math.abs(result.profile.bones!.neck[1] - plain.profile.bones!.neck[1]) * 320).toBeLessThan(2);
  });

  it("places the upper neck joint below the chin when the neck is shaded differently", () => {
    const plain = inferRigFromPixels(character());
    const shaded = inferRigFromPixels(character({ neckShade: [165, 108, 90] }));
    expect(shaded.confidence).toBe("high");
    // The independently drawn face ellipse ends at y=157; deformation must
    // begin below this boundary instead of classifying the dark neck as clothing.
    expect(shaded.profile.bones!.head[1] * 320).toBeGreaterThanOrEqual(157);
    expect(shaded.profile.bones!.head[1] * 320).toBeLessThan(164);
    expect(Math.abs(shaded.profile.bones!.neck[1] - plain.profile.bones!.neck[1]) * 320).toBeLessThan(2);
  });

  it("labels identical expression images as provisional rather than a successful detection", () => {
    const { neutral } = character();
    const result = inferRigFromPixels({ neutral, blink: neutral, mouthOpen: neutral });
    expect(result.confidence).toBe("low");
    expect(result.notes.join(" ")).toContain("差分がない");
    expect(result.notes.join(" ")).toContain("仮配置");
    expect(hasValidBones(result.profile.bones)).toBe(true);
  });

  it("does not report shifted expression images as reliable face locations", () => {
    const images = character();
    const result = inferRigFromPixels({ ...images, blink: translate(images.blink, 5, 2), mouthOpen: translate(images.mouthOpen, -4, 3) });
    expect(result.confidence).toBe("low");
    expect(result.notes.join(" ")).toContain("位置ずれ");
    expect(hasValidBones(result.profile.bones)).toBe(true);
  });

  it("ignores invisible RGB differences and tolerates small color noise", () => {
    const images = character();
    for (const image of [images.blink, images.mouthOpen]) {
      for (let index = 0; index < image.data.length; index += 4) {
        if (image.data[index + 3] === 0) image.data.set([127, 240, 90], index);
        else for (let channel = 0; channel < 3; channel += 1) image.data[index + channel] += 4;
      }
    }
    const result = inferRigFromPixels(images);
    expect(result.confidence).toBe("high");
    expect(result.profile.leftEyeCenter[0] * 384).toBeCloseTo(156, 0);
    expect(result.profile.mouthCenter[1] * 320).toBeCloseTo(136, 0);
  });

  it("flags repainted clothing even when the expression silhouette remains registered", () => {
    const images = character();
    for (const image of [images.blink, images.mouthOpen]) {
      for (let index = 220 * image.width * 4; index < image.data.length; index += 4) {
        if (image.data[index + 3]) image.data[index] += 90;
      }
    }
    const result = inferRigFromPixels(images);
    expect(result.confidence).toBe("low");
    expect(result.notes.join(" ")).toContain("集中していません");
  });

  it("does not claim a reliable silhouette for an opaque background", () => {
    const images = character();
    for (const image of Object.values(images)) {
      for (let index = 0; index < image.data.length; index += 4) {
        if (image.data[index + 3] === 0) image.data.set([240, 245, 250, 255], index);
      }
    }
    const result = inferRigFromPixels(images);
    expect(result.confidence).toBe("low");
    expect(result.notes.join(" ")).toContain("透過輪郭");
  });

  it("does not mark inferred torso joints as reliable when the torso is missing", () => {
    const images = character();
    for (const image of Object.values(images)) {
      for (let index = 181 * image.width * 4; index < image.data.length; index += 4) image.data[index + 3] = 0;
    }
    const result = inferRigFromPixels(images);
    expect(result.confidence).toBe("low");
    expect(result.notes.join(" ")).toContain("胴体");
    expect(hasValidBones(result.profile.bones)).toBe(true);
  });

  it("rejects mismatched dimensions before comparing pixels", () => {
    const images = character();
    const result = inferRigFromPixels({ ...images, blink: { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) } });
    expect(result.confidence).toBe("low");
    expect(result.notes.join(" ")).toContain("サイズが一致しない");
  });

  it("returns a finite safe fallback for corrupt pixels or an empty transparent image", () => {
    const images = character();
    const invalid = inferRigFromPixels({ ...images, neutral: { ...images.neutral, data: new Uint8ClampedArray(8) } });
    const empty: RigImagePixels = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) };
    const transparent = inferRigFromPixels({ neutral: empty, blink: empty, mouthOpen: empty });
    for (const result of [invalid, transparent]) {
      expect(result.confidence).toBe("low");
      expect(hasValidBones(result.profile.bones)).toBe(true);
      expect(points(result.profile).flat().every(Number.isFinite)).toBe(true);
    }
  });

  it("fails safely when browser image decoding is unavailable", async () => {
    const result = await inferRigFromImages({ neutral: "broken.png", blink: "broken.png", mouthOpen: "broken.png" });
    expect(result.confidence).toBe("low");
    expect(result.notes.join(" ")).toContain("利用できません");
  });
});
