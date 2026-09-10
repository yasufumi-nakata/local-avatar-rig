import { expect, test, type Page, type Route } from "@playwright/test";

// The renderer-level cases import the module by its source path, which only
// the dev server serves. The production preview exposes bundled chunks instead.
test.skip(process.env.LOCAL_AVATAR_RIG_TEST_BUILD === "1", "requires dev-server source modules");

interface RigLifecycleTestState {
  images: HTMLImageElement[];
  programsCreated: number;
  texturesCreated: number;
  contextExtension: WEBGL_lose_context | null;
}

declare global {
  interface Window {
    __localAvatarRigLifecycle: RigLifecycleTestState;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state: RigLifecycleTestState = {
      images: [],
      programsCreated: 0,
      texturesCreated: 0,
      contextExtension: null,
    };
    window.__localAvatarRigLifecycle = state;
    const NativeImage = window.Image;
    window.Image = class extends NativeImage {
      constructor(width?: number, height?: number) {
        super(width, height);
        state.images.push(this);
      }
    };
    const createProgram = WebGLRenderingContext.prototype.createProgram;
    WebGLRenderingContext.prototype.createProgram = function () {
      state.programsCreated += 1;
      return createProgram.call(this);
    };
    const createTexture = WebGLRenderingContext.prototype.createTexture;
    WebGLRenderingContext.prototype.createTexture = function () {
      state.texturesCreated += 1;
      return createTexture.call(this);
    };
  });
});

test("does not resurrect a renderer destroyed while its textures are loading", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas.avatar-rig-canvas")).toHaveAttribute("data-rig-ready", "true");

  const result = await page.evaluate(async () => {
    const rendererPath = "/src/lib/webglAvatarRenderer.ts";
    const posePath = "/src/lib/faceRigPose.ts";
    const { WebGLAvatarRenderer, DEFAULT_AVATAR_TEXTURES } = await import(rendererPath);
    const { NEUTRAL_FACE_RIG_POSE } = await import(posePath);
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const renderer = new WebGLAvatarRenderer(canvas);
    const before = window.__localAvatarRigLifecycle.texturesCreated;
    const initialization = renderer.initialize(DEFAULT_AVATAR_TEXTURES);
    renderer.destroy();
    await initialization;
    renderer.render(performance.now(), NEUTRAL_FACE_RIG_POSE, {
      motion: false, speaking: false, audioLevel: 0, tracking: false,
    });
    const result = {
      ready: canvas.dataset.rigReady ?? null,
      createdAfterDestroy: window.__localAvatarRigLifecycle.texturesCreated - before,
      glError: canvas.getContext("webgl")!.getError(),
    };
    renderer.destroy();
    canvas.remove();
    return result;
  });

  expect(result).toEqual({ ready: null, createdAfterDestroy: 0, glError: 0 });
});

// This build ships a single built-in pack, so the superseded-initialize guard is
// driven on the renderer itself rather than through a pack switch in the UI.
async function startSupersededLoad(page: Page) {
  return page.evaluate(async () => {
    const rendererPath = "/src/lib/webglAvatarRenderer.ts";
    const { WebGLAvatarRenderer, DEFAULT_AVATAR_TEXTURES } = await import(rendererPath);
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const renderer = new WebGLAvatarRenderer(canvas);
    // Count only this rig's textures: the page's own rig waits on the same route.
    const gl = canvas.getContext("webgl")!;
    const nativeCreateTexture = gl.createTexture.bind(gl);
    const counted = { textures: 0 };
    gl.createTexture = () => { counted.textures += 1; return nativeCreateTexture(); };
    // The blink request is still held by the test, so this load cannot finish.
    const superseded = renderer.initialize(DEFAULT_AVATAR_TEXTURES)
      .then(() => "resolved" as const, (error: unknown) => `rejected: ${(error as Error).message}`);
    // Replace it with a set the held route does not cover.
    await renderer.initialize({ ...DEFAULT_AVATAR_TEXTURES, blink: DEFAULT_AVATAR_TEXTURES.neutral });
    (window as unknown as { __rigProbe: unknown }).__rigProbe = { renderer, canvas, superseded, counted };
    return {
      ready: canvas.dataset.rigReady ?? null,
      error: canvas.dataset.rigError ?? null,
      textures: counted.textures,
    };
  });
}

async function settleSupersededLoad(page: Page) {
  return page.evaluate(async () => {
    const probe = (window as unknown as {
      __rigProbe: {
        renderer: { destroy: () => void };
        canvas: HTMLCanvasElement;
        superseded: Promise<string>;
        counted: { textures: number };
      };
    }).__rigProbe;
    const outcome = await probe.superseded;
    const result = {
      outcome,
      ready: probe.canvas.dataset.rigReady ?? null,
      error: probe.canvas.dataset.rigError ?? null,
      textures: probe.counted.textures,
      glError: probe.canvas.getContext("webgl")!.getError(),
    };
    probe.renderer.destroy();
    probe.canvas.remove();
    return result;
  });
}

test("ignores a superseded texture load that resolves after the rig was replaced", async ({ page }) => {
  const heldBlink: Route[] = [];
  await page.route("**/vtuber-rig-default-blink-v1.png", (route) => { heldBlink.push(route); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => heldBlink.length).toBeGreaterThan(0);

  const replaced = await startSupersededLoad(page);
  expect(replaced.ready).toBe("true");
  expect(replaced.error).toBeNull();

  await Promise.all(heldBlink.map((route) => route.continue()));
  const settled = await settleSupersededLoad(page);
  expect(settled.outcome).toBe("resolved");
  expect(settled.ready).toBe("true");
  expect(settled.error).toBeNull();
  expect(settled.glError).toBe(0);
  expect(settled.textures).toBe(replaced.textures);
});

test("ignores a failed texture load from a rig that has already been replaced", async ({ page }) => {
  const heldBlink: Route[] = [];
  await page.route("**/vtuber-rig-default-blink-v1.png", (route) => { heldBlink.push(route); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => heldBlink.length).toBeGreaterThan(0);

  const replaced = await startSupersededLoad(page);
  expect(replaced.ready).toBe("true");

  await Promise.all(heldBlink.map((route) => route.abort("failed")));
  const settled = await settleSupersededLoad(page);
  expect(settled.outcome).toBe("resolved");
  expect(settled.ready).toBe("true");
  expect(settled.error).toBeNull();
  expect(settled.glError).toBe(0);
});

test("restores visible WebGL rendering after repeated context loss", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("canvas.avatar-rig-canvas");
  const fallback = page.locator("img.avatar-character-fallback");
  await expect(canvas).toHaveAttribute("data-rig-ready", "true");

  for (let cycle = 0; cycle < 2; cycle += 1) {
    const available = await canvas.evaluate((element) => {
      const gl = (element as HTMLCanvasElement).getContext("webgl")!;
      const extension = gl.getExtension("WEBGL_lose_context");
      window.__localAvatarRigLifecycle.contextExtension = extension;
      extension?.loseContext();
      return Boolean(extension);
    });
    expect(available).toBe(true);
    await expect(canvas).not.toHaveAttribute("data-rig-ready", "true");
    await expect(fallback).toHaveCSS("opacity", "1");

    await page.evaluate(() => window.__localAvatarRigLifecycle.contextExtension!.restoreContext());
    await expect(canvas).toHaveAttribute("data-rig-ready", "true");
    await expect(canvas).not.toHaveAttribute("data-rig-error");
    await expect(fallback).toHaveCSS("opacity", "0");
    await expect.poll(() => canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const gl = canvas.getContext("webgl")!;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    })).toBe(true);
  }
  expect(pageErrors).toEqual([]);
});

test("retains the renderer when switching between manual and tracked poses", async ({ page }) => {
  await page.addInitScript(() => {
    // A pending permission request is enough to switch the active pose source.
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => new Promise<MediaStream>(() => {}),
    });
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class {
        postMessage() {}
        terminate() {}
      },
    });
  });
  await page.goto("/");
  const canvas = page.locator("canvas.avatar-rig-canvas");
  await expect(canvas).toHaveAttribute("data-rig-ready", "true");
  const renderedYaw = () => canvas.evaluate((element) => {
    const gl = (element as HTMLCanvasElement).getContext("webgl")!;
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
    return (gl.getUniform(program, gl.getUniformLocation(program, "u_head")!) as Float32Array)[0];
  });
  await page.getByRole("slider", { name: "Yaw", exact: true }).fill("18");
  await expect.poll(renderedYaw).toBe(18);
  const before = await page.evaluate(() => window.__localAvatarRigLifecycle.programsCreated);

  await page.getByRole("button", { name: "顔追従", exact: true }).click();
  await expect(page.getByRole("button", { name: "顔追従を停止", exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute("data-rig-ready", "true");
  await expect.poll(renderedYaw).toBe(0);
  await page.getByRole("button", { name: "顔追従を停止", exact: true }).click();
  await expect(page.getByRole("button", { name: "顔追従", exact: true })).toBeVisible();
  await expect.poll(renderedYaw).toBe(18);

  expect(await page.evaluate(() => window.__localAvatarRigLifecycle.programsCreated)).toBe(before);
  await expect(canvas).toHaveAttribute("data-rig-ready", "true");
});
