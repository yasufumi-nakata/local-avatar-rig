import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { FACE_MODEL } from "../../src/lib/faceModel";

test.beforeEach(async ({ page }) => {
  // Exercise the real Worker and inference runtime with a synthetic black camera frame.
  // No physical camera, microphone or person is captured by this test.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const context = canvas.getContext("2d")!;
        context.fillRect(0, 0, 640, 480);
        const stream = canvas.captureStream(24);
        const interval = window.setInterval(() => context.fillRect(0, 0, 640, 480), 40);
        const track = stream.getVideoTracks()[0];
        const nativeStop = track.stop.bind(track);
        track.stop = () => { window.clearInterval(interval); nativeStop(); };
        return stream;
      },
    });
  });
});

test("starts the real Worker with a verified model and sends no camera frames", async ({ page, context, request }) => {
  const response = await request.get(FACE_MODEL.url, { maxRedirects: 0, timeout: 30_000 });
  expect(response.status()).toBe(200);
  const model = await response.body();
  expect(model.length).toBe(FACE_MODEL.bytes);
  expect(createHash("sha256").update(model).digest("hex")).toBe(FACE_MODEL.sha256);
  const external: Array<{ url: string; method: string; body: string | null }> = [];
  context.on("request", (outgoing) => {
    if (new URL(outgoing.url()).origin !== "http://127.0.0.1:4176") {
      external.push({ url: outgoing.url(), method: outgoing.method(), body: outgoing.postData() });
    }
  });
  await context.route(FACE_MODEL.url, (route) => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" },
    body: model,
  }));
  await page.goto("/");
  await expect(page.locator("canvas.avatar-rig-canvas")).toHaveAttribute("data-rig-ready", "true");
  expect(external).toEqual([]);
  await page.getByRole("button", { name: "顔追従", exact: true }).click();
  await expect(page.locator(".avatar-rig")).toHaveAttribute("data-face-tracking", "searching", { timeout: 40_000 });
  expect(external).toEqual([{ url: FACE_MODEL.url, method: "GET", body: null }]);
  await page.getByRole("button", { name: "顔追従を停止", exact: true }).click();
  await expect(page.locator(".avatar-rig")).toHaveAttribute("data-face-tracking", "idle");
  expect(await page.locator("video.face-tracking-input").evaluate((video: HTMLVideoElement) => video.srcObject)).toBeNull();
});

test("stops the real Worker and camera when model integrity fails", async ({ page, context }) => {
  await context.route(FACE_MODEL.url, (route) => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" },
    body: Buffer.alloc(FACE_MODEL.bytes),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "顔追従", exact: true }).click();
  await expect(page.locator(".stage-message")).toContainText("SHA-256", { timeout: 30_000 });
  await expect(page.locator(".avatar-rig")).toHaveAttribute("data-face-tracking", "error");
  expect(await page.locator("video.face-tracking-input").evaluate((video: HTMLVideoElement) => video.srcObject)).toBeNull();
});
