import { expect, test } from "@playwright/test";

interface MediaTestState {
  audioCalls: number;
  videoCalls: number;
  workerTerminations: number;
  failAudioInitialization: boolean;
  audioStreams: MediaStream[];
  videoStreams: MediaStream[];
  createdObjectUrls: string[];
  revokedObjectUrls: string[];
}

declare global {
  interface Window {
    __localAvatarRigMediaTest: MediaTestState;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state: MediaTestState & { keepAlive: Array<AudioContext | HTMLCanvasElement> } = {
      audioCalls: 0,
      videoCalls: 0,
      workerTerminations: 0,
      failAudioInitialization: false,
      audioStreams: [],
      videoStreams: [],
      createdObjectUrls: [],
      revokedObjectUrls: [],
      keepAlive: [],
    };
    window.__localAvatarRigMediaTest = state;

    const nativeCreateObjectUrl = URL.createObjectURL.bind(URL);
    const nativeRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (object: Blob | MediaSource) => {
        const url = nativeCreateObjectUrl(object);
        state.createdObjectUrls.push(url);
        return url;
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: (url: string) => {
        state.revokedObjectUrls.push(url);
        nativeRevokeObjectUrl(url);
      },
    });

    const NativeAudioContext = window.AudioContext;
    const makeAudioStream = () => {
      const context = new NativeAudioContext();
      const destination = context.createMediaStreamDestination();
      state.keepAlive.push(context);
      state.audioStreams.push(destination.stream);
      return destination.stream;
    };
    const makeVideoStream = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      canvas.getContext("2d")?.fillRect(0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(24);
      state.keepAlive.push(canvas);
      state.videoStreams.push(stream);
      return stream;
    };

    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        if (constraints.audio) {
          state.audioCalls += 1;
          const stream = makeAudioStream();
          if (state.failAudioInitialization) {
            Object.defineProperty(window, "AudioContext", {
              configurable: true,
              value: class {
                constructor() {
                  throw new Error("synthetic AudioContext failure");
                }
              },
            });
          }
          return stream;
        }
        state.videoCalls += 1;
        if (state.videoCalls === 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 800));
          throw new DOMException("synthetic stale denial", "NotAllowedError");
        }
        return makeVideoStream();
      },
    });

    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(message: { type?: string; bitmap?: ImageBitmap }) {
        if (message.type === "init") {
          window.setTimeout(() => this.onmessage?.({
            data: { type: "ready", delegate: "CPU", runtime: "browser-test", inferenceLocal: true },
          } as MessageEvent), 0);
        } else if (message.type === "frame") {
          message.bitmap?.close();
          this.onmessage?.({ data: { type: "frame-complete" } } as MessageEvent);
        }
      }

      terminate() {
        state.workerTerminations += 1;
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: FakeWorker });
  });
});

test("loads the local WebGL rig without external requests", async ({ page }) => {
  const requests: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page).toHaveTitle("Local Avatar Rig");
  await expect(page.locator("canvas.avatar-rig-canvas")).toHaveAttribute("data-rig-ready", "true");
  await expect(page.locator("img.avatar-character-fallback")).toHaveCSS("opacity", "0");

  expect(pageErrors).toEqual([]);
  expect(requests.length).toBeGreaterThan(4);
  expect(requests.every((url) => new URL(url).origin === "http://127.0.0.1:4176")).toBe(true);
  const paths = requests.map((url) => new URL(url).pathname);
  expect(paths).toContain("/assets/vtuber-rig-default-neutral-v1.png");
  expect(paths).toContain("/assets/vtuber-rig-default-blink-v1.png");
  expect(paths).toContain("/assets/vtuber-rig-default-mouth-open-v1.png");
});

test("keeps Default Navigator expression assets registered and genuinely transparent", async ({ page }) => {
  await page.goto("/");
  const metrics = await page.evaluate(async () => {
    const paths = {
      neutral: "/assets/vtuber-rig-default-neutral-v1.png",
      blink: "/assets/vtuber-rig-default-blink-v1.png",
      mouthOpen: "/assets/vtuber-rig-default-mouth-open-v1.png",
    } as const;
    const decode = async (source: string) => {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`${source}: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const neutral = await decode(paths.neutral);
    const blink = await decode(paths.blink);
    const mouthOpen = await decode(paths.mouthOpen);
    const total = neutral.width * neutral.height;
    let transparent = 0;
    let alphaMismatch = 0;
    let blinkChanged = 0;
    let blinkOutside = 0;
    let mouthChanged = 0;
    let mouthOutside = 0;
    const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
      const dx = (x / neutral.width - cx) / rx;
      const dy = (y / neutral.height - cy) / ry;
      return dx * dx + dy * dy <= 1.02;
    };
    for (let pixel = 0; pixel < total; pixel += 1) {
      const offset = pixel * 4;
      if (neutral.pixels[offset + 3] < 250) transparent += 1;
      if (neutral.pixels[offset + 3] !== blink.pixels[offset + 3] || neutral.pixels[offset + 3] !== mouthOpen.pixels[offset + 3]) alphaMismatch += 1;
      const x = pixel % neutral.width;
      const y = Math.floor(pixel / neutral.width);
      const blinkDiff = [0, 1, 2, 3].some((channel) => Math.abs(neutral.pixels[offset + channel] - blink.pixels[offset + channel]) > 3);
      const mouthDiff = [0, 1, 2, 3].some((channel) => Math.abs(neutral.pixels[offset + channel] - mouthOpen.pixels[offset + channel]) > 3);
      if (blinkDiff) {
        blinkChanged += 1;
        const inside = inEllipse(x, y, 0.4455, 0.3745, 0.067, 0.068)
          || inEllipse(x, y, 0.5615, 0.3745, 0.067, 0.068);
        if (!inside) blinkOutside += 1;
      }
      if (mouthDiff) {
        mouthChanged += 1;
        if (!inEllipse(x, y, 0.4995, 0.489, 0.055, 0.045)) mouthOutside += 1;
      }
    }
    return {
      dimensions: [neutral.width, neutral.height],
      transparentRatio: transparent / total,
      alphaMismatch,
      blinkChanged,
      blinkOutside,
      mouthChanged,
      mouthOutside,
    };
  });

  expect(metrics.dimensions).toEqual([1672, 941]);
  expect(metrics.transparentRatio).toBeGreaterThan(0.6);
  expect(metrics.alphaMismatch).toBe(0);
  expect(metrics.blinkChanged).toBeGreaterThan(1_000);
  expect(metrics.blinkOutside).toBe(0);
  expect(metrics.mouthChanged).toBeGreaterThan(100);
  expect(metrics.mouthOutside).toBe(0);
});

test("renders distinct deterministic blink, turn and speech states", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas.avatar-rig-canvas")).toHaveAttribute("data-rig-ready", "true");
  await page.getByRole("checkbox", { name: "呼吸・瞬き・髪物理" }).uncheck({ force: true });
  await page.getByRole("checkbox", { name: "ポインター追従" }).uncheck({ force: true });
  await page.getByRole("group", { name: "背景" }).getByRole("button", { name: "グリーン" }).click();

  const stage = page.locator(".avatar-stage");
  const reset = page.getByRole("button", { name: "リセット", exact: true });
  const digest = async () => {
    const bytes = await stage.screenshot({ animations: "disabled" });
    let hash = 2_166_136_261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16_777_619) >>> 0;
    return `${bytes.length}:${hash}`;
  };
  const neutral = await digest();

  await page.getByRole("slider", { name: "左まぶた" }).fill("1");
  await page.getByRole("slider", { name: "右まぶた" }).fill("1");
  await page.waitForTimeout(120);
  const blink = await digest();

  await reset.click();
  await page.getByRole("slider", { name: "Yaw" }).fill("-24");
  await page.waitForTimeout(120);
  const yawLeft = await digest();

  await reset.click();
  await page.getByRole("slider", { name: "Yaw" }).fill("24");
  await page.waitForTimeout(120);
  const yawRight = await digest();

  await reset.click();
  await page.getByRole("slider", { name: "口開き" }).fill("0.72");
  await page.getByRole("slider", { name: "笑顔" }).fill("0.2");
  await page.waitForTimeout(180);
  const speaking = await digest();

  expect(new Set([neutral, blink, yawLeft, yawRight, speaking]).size).toBe(5);
});

test("exports a PNG containing the rendered WebGL avatar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas.avatar-rig-canvas")).toHaveAttribute("data-rig-ready", "true");
  await page.getByRole("group", { name: "背景" }).getByRole("button", { name: "グリーン" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNGを保存" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let byteCount = 0;
  for await (const chunk of stream) byteCount += chunk.length;
  expect(byteCount).toBeGreaterThan(50_000);
  await expect(page.locator(".stage-message")).toHaveText("現在のフレームをPNGで保存しました。");
});

test("deduplicates microphone start and releases the active track", async ({ page }) => {
  await page.goto("/");
  const startButton = page.getByRole("button", { name: "マイク口パク", exact: true });
  await startButton.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });

  await expect(page.getByRole("button", { name: "口パク中", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__localAvatarRigMediaTest.audioCalls)).toBe(1);
  expect(await page.evaluate(() => window.__localAvatarRigMediaTest.audioStreams[0]?.getAudioTracks()[0]?.readyState)).toBe("live");

  await page.getByRole("button", { name: "口パク中", exact: true }).click();
  await expect(startButton).toBeVisible();
  expect(await page.evaluate(() => window.__localAvatarRigMediaTest.audioStreams[0]?.getAudioTracks()[0]?.readyState)).toBe("ended");
});

test("releases a microphone track when AudioContext setup throws", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { window.__localAvatarRigMediaTest.failAudioInitialization = true; });
  await page.getByRole("button", { name: "マイク口パク", exact: true }).click();

  await expect(page.locator(".stage-message")).toContainText("マイク口パクを開始できませんでした");
  expect(await page.evaluate(() => window.__localAvatarRigMediaTest.audioStreams[0]?.getAudioTracks()[0]?.readyState)).toBe("ended");
});

test("ignores a stale camera rejection after stop and restart", async ({ page }) => {
  await page.goto("/");
  const startButton = page.getByRole("button", { name: "顔追従", exact: true });
  await startButton.click();
  const stopButton = page.getByRole("button", { name: "顔追従を停止", exact: true });
  await expect(stopButton).toBeVisible();
  await stopButton.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".avatar-rig")).toHaveAttribute("data-face-tracking", "idle");
  await expect(startButton).toBeVisible();
  await startButton.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(stopButton).toBeVisible();

  await page.waitForTimeout(1_000);
  await expect(stopButton).toBeVisible();
  expect(await page.evaluate(() => window.__localAvatarRigMediaTest.videoCalls)).toBe(2);
  expect(await page.evaluate(() => window.__localAvatarRigMediaTest.videoStreams[0]?.getVideoTracks()[0]?.readyState)).toBe("live");

  await stopButton.click();
  expect(await page.evaluate(() => window.__localAvatarRigMediaTest.videoStreams[0]?.getVideoTracks()[0]?.readyState)).toBe("ended");
});

test("keeps applied model URLs alive and revokes them after reset", async ({ page }) => {
  const neutralPath = new URL("../../public/assets/vtuber-rig-default-neutral-v1.png", import.meta.url).pathname;
  await page.goto("/");
  await page.getByRole("button", { name: "モデル生成" }).click();
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles(neutralPath);
  await fileInputs.nth(1).setInputFiles(neutralPath);
  await fileInputs.nth(2).setInputFiles(neutralPath);

  await expect(page.getByText("自動検査に合格しました")).toBeVisible();
  await page.getByRole("button", { name: "検証済み素材をプレビューへ適用" }).click();
  await expect(page.locator("canvas.avatar-rig-canvas")).toHaveAttribute("data-rig-ready", "true");
  await page.getByRole("button", { name: "コントロール" }).click();

  const beforeReset = await page.evaluate(() => ({
    created: [...window.__localAvatarRigMediaTest.createdObjectUrls],
    revoked: [...window.__localAvatarRigMediaTest.revokedObjectUrls],
  }));
  expect(beforeReset.created).toHaveLength(3);
  expect(beforeReset.revoked).toEqual([]);

  await page.getByRole("button", { name: "モデル生成" }).click();
  await page.getByRole("button", { name: "標準モデルへ戻す" }).click();
  await expect.poll(() => page.evaluate(() => window.__localAvatarRigMediaTest.revokedObjectUrls.length)).toBe(3);
  const afterReset = await page.evaluate(() => window.__localAvatarRigMediaTest);
  expect(new Set(afterReset.revokedObjectUrls)).toEqual(new Set(afterReset.createdObjectUrls));
});
