import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [neutralPath, blinkSourcePath, mouthSourcePath, blinkOutputPath, mouthOutputPath] = process.argv.slice(2);

if (!mouthOutputPath) {
  console.error(
    "Usage: node scripts/compose-expression-states.mjs <neutral.png> <blink-source.png> <mouth-source.png> <blink-output.png> <mouth-output.png>",
  );
  process.exit(1);
}

const encode = async (filePath) => (await readFile(filePath)).toString("base64");
const neutral = await encode(neutralPath);
const blinkSource = await encode(blinkSourcePath);
const mouthSource = await encode(mouthSourcePath);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const outputs = await page.evaluate(async ({ neutral, blinkSource, mouthSource }) => {
    const load = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("PNGを復号できませんでした。"));
      image.src = `data:image/png;base64,${base64}`;
    });
    const [anchor, blink, mouth] = await Promise.all([
      load(neutral),
      load(blinkSource),
      load(mouthSource),
    ]);
    if (anchor.naturalWidth !== 1672 || anchor.naturalHeight !== 941) {
      throw new Error(`Neutralは1672x941が必要です（${anchor.naturalWidth}x${anchor.naturalHeight}）。`);
    }

    const width = anchor.naturalWidth;
    const height = anchor.naturalHeight;
    const ellipse = (context, centerX, centerY, radiusX, radiusY) => {
      context.save();
      context.translate(centerX * width, centerY * height);
      context.scale(radiusX * width, radiusY * height);
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.72, "rgba(255,255,255,1)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(-1, -1, 2, 2);
      context.restore();
    };

    const compose = (variant, kind) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("合成用Canvasを作成できませんでした。");
      context.drawImage(anchor, 0, 0, width, height);

      const patch = document.createElement("canvas");
      patch.width = width;
      patch.height = height;
      const patchContext = patch.getContext("2d");
      if (!patchContext) throw new Error("差分用Canvasを作成できませんでした。");
      patchContext.drawImage(variant, 0, 0, width, height);

      const mask = document.createElement("canvas");
      mask.width = width;
      mask.height = height;
      const maskContext = mask.getContext("2d");
      if (!maskContext) throw new Error("マスク用Canvasを作成できませんでした。");
      if (kind === "blink") {
        ellipse(maskContext, 0.4455, 0.3745, 0.067, 0.068);
        ellipse(maskContext, 0.5615, 0.3745, 0.067, 0.068);
      } else {
        ellipse(maskContext, 0.4995, 0.4890, 0.055, 0.045);
      }
      patchContext.globalCompositeOperation = "destination-in";
      patchContext.drawImage(mask, 0, 0);
      patchContext.globalCompositeOperation = "source-over";
      context.drawImage(patch, 0, 0);

      // 表情差分はRGBだけを採用し、輪郭のアルファはNeutralを厳密に維持する。
      // 生成元の透明度やCanvasの補間差が、固定状態のシルエットへ漏れるのを防ぐ。
      const anchorCanvas = document.createElement("canvas");
      anchorCanvas.width = width;
      anchorCanvas.height = height;
      const anchorContext = anchorCanvas.getContext("2d", { willReadFrequently: true });
      if (!anchorContext) throw new Error("Neutralアルファ用Canvasを作成できませんでした。");
      anchorContext.drawImage(anchor, 0, 0, width, height);
      const anchorPixels = anchorContext.getImageData(0, 0, width, height);
      const composedPixels = context.getImageData(0, 0, width, height);
      for (let index = 3; index < composedPixels.data.length; index += 4) {
        composedPixels.data[index] = anchorPixels.data[index];
      }
      context.putImageData(composedPixels, 0, 0);
      return canvas;
    };

    const measure = (imageOrCanvas) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("計測用Canvasを作成できませんでした。");
      context.drawImage(imageOrCanvas, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      let transparent = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) {
        const alpha = pixels[pixel * 4 + 3];
        if (alpha < 250) transparent += 1;
        if (alpha <= 127) continue;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return {
        transparentPixelRatio: transparent / (width * height),
        visibleAlphaBoundingBox: { minX, minY, maxX, maxY },
      };
    };

    const blinkCanvas = compose(blink, "blink");
    const mouthCanvas = compose(mouth, "mouth");
    return {
      blink: blinkCanvas.toDataURL("image/png").split(",", 2)[1],
      mouth: mouthCanvas.toDataURL("image/png").split(",", 2)[1],
      metrics: {
        neutral: measure(anchor),
        blink: measure(blinkCanvas),
        mouthOpen: measure(mouthCanvas),
      },
    };
  }, { neutral, blinkSource, mouthSource });

  await mkdir(path.dirname(blinkOutputPath), { recursive: true });
  await mkdir(path.dirname(mouthOutputPath), { recursive: true });
  await writeFile(blinkOutputPath, Buffer.from(outputs.blink, "base64"));
  await writeFile(mouthOutputPath, Buffer.from(outputs.mouth, "base64"));
  console.log(`✓ ${blinkOutputPath}`);
  console.log(`✓ ${mouthOutputPath}`);
  console.log(JSON.stringify(outputs.metrics, null, 2));
} finally {
  await browser.close();
}
