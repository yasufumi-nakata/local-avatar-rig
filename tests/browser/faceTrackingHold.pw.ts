import { expect, test, type Page } from "@playwright/test";
import type { FaceRigPose } from "../../src/lib/faceRigPose";

interface PoseHoldHarness {
  worker: { emit: (message: { type: string; pose?: FaceRigPose }) => void } | null;
  streams: MediaStream[];
  canvas: HTMLCanvasElement | null;
}

declare global { interface Window { __localAvatarRigPoseHold: PoseHoldHarness } }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state: PoseHoldHarness = { worker: null, streams: [], canvas: null };
    window.__localAvatarRigPoseHold = state;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      constructor() { state.worker = this; }
      emit(message: { type: string; pose?: FaceRigPose }) { this.onmessage?.({ data: message } as MessageEvent); }
      postMessage(message: { type: string; bitmap?: ImageBitmap }) {
        if (message.type === "init") queueMicrotask(() => this.onmessage?.({ data: { type: "ready", delegate: "CPU", runtime: "pose-hold-test", inferenceLocal: true } } as MessageEvent));
        if (message.type === "frame") {
          message.bitmap?.close();
          this.emit({ type: "frame-complete" });
        }
      }
      terminate() { this.onmessage = null; }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: FakeWorker });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        canvas.getContext("2d")!.fillRect(0, 0, canvas.width, canvas.height);
        state.canvas = canvas;
        const stream = canvas.captureStream(24);
        state.streams.push(stream);
        return stream;
      },
    });
  });
});

async function startTracking(page: Page) {
  await page.getByRole("button", { name: "顔追従", exact: true }).click();
  await expect(page.locator(".avatar-rig")).toHaveAttribute("data-face-tracking", "searching");
}

async function emitYaw(page: Page, yaw: number) {
  await page.evaluate((value) => window.__localAvatarRigPoseHold.worker!.emit({
    type: "pose",
    pose: { x: 0, y: 0, yaw: value, pitch: 0, roll: 0, scale: 1, eyeX: 0, eyeY: 0, blinkLeft: 0, blinkRight: 0, mouthOpen: 0, smile: 0 },
  }), yaw);
}

const renderedYaw = (page: Page) => page.locator(".avatar-rig").evaluate((element) => Number((element as HTMLElement).style.getPropertyValue("--rig-yaw").replace("deg", "")));

test("holds a brief missed detection, accepts a turned return, and eases home after sustained loss", async ({ page }) => {
  // Software rendering can delay a 100ms wall-clock timer beyond the 300ms hold.
  // Advance performance.now and animation frames together to test that boundary.
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.goto("/");
  await startTracking(page);
  await page.clock.pauseAt(new Date("2026-01-01T01:00:00Z"));
  await emitYaw(page, 30);
  await page.clock.runFor(500);
  const before = await renderedYaw(page);
  expect(before).toBeGreaterThan(29.5);
  await page.evaluate(() => window.__localAvatarRigPoseHold.worker!.emit({ type: "missing" }));
  await page.clock.runFor(150);
  const held = await renderedYaw(page);
  expect(held).toBeGreaterThan(29.5);
  expect(Math.abs(held - before)).toBeLessThan(0.5);

  await emitYaw(page, -20);
  await page.clock.runFor(600);
  expect(await renderedYaw(page)).toBeLessThan(-19.5);
  for (let frame = 0; frame < 5; frame += 1) {
    await page.evaluate(() => window.__localAvatarRigPoseHold.worker!.emit({ type: "missing" }));
    await page.clock.runFor(100);
    if (frame === 1) expect(await renderedYaw(page)).toBeLessThan(-19.5);
  }
  expect(Math.abs(await renderedYaw(page))).toBeLessThan(3);
  await expect(page.locator(".avatar-rig")).toHaveAttribute("data-face-tracking", "searching");
});

test("cancels a pending lost-face hold on stop and does not apply it to a restarted session", async ({ page }) => {
  await page.goto("/");
  await startTracking(page);
  await emitYaw(page, 24);
  await expect.poll(() => renderedYaw(page)).toBeGreaterThan(23.5);
  await page.evaluate(() => window.__localAvatarRigPoseHold.worker!.emit({ type: "missing" }));
  await page.getByRole("button", { name: "顔追従を停止", exact: true }).click();
  await expect(page.locator(".avatar-rig")).toHaveAttribute("data-face-tracking", "idle");
  expect(await renderedYaw(page)).toBe(0);
  expect(await page.evaluate(() => window.__localAvatarRigPoseHold.streams[0].getVideoTracks()[0].readyState)).toBe("ended");

  await startTracking(page);
  expect(await renderedYaw(page)).toBe(0);
  await emitYaw(page, -18);
  await page.waitForTimeout(450);
  expect(await renderedYaw(page)).toBeLessThan(-17.5);
  await expect(page.locator(".avatar-rig")).toHaveAttribute("data-face-tracking", "tracking");
});
