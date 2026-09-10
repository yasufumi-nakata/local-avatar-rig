import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_AVATAR_BONES } from "../../src/lib/avatarRigProfile";

const SETTINGS_KEY = "local-avatar-rig:preferences:v2";
const MODEL_ID = "default-navigator-v1";
const packAsset = (state: "neutral" | "blink" | "mouth-open") =>
  new URL(`../../public/assets/vtuber-rig-default-${state}-v1.png`, import.meta.url).pathname;
const profileAt = (eyeY: number) => ({
  leftEyeCenter: [0.4455, eyeY], rightEyeCenter: [0.5615, eyeY], mouthCenter: [0.4995, 0.489],
});

async function openBones(page: Page) {
  const details = page.locator("details.bone-section");
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
  return details;
}

test("keeps edited joints through reloads", async ({ page }) => {
  await page.goto("/");
  await openBones(page);
  const headY = page.getByRole("slider", { name: "頭の付け根 Y", exact: true });
  await headY.fill("0.54");
  await page.reload();
  await openBones(page);
  await expect(headY).toHaveValue("0.54");
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY);
  expect(saved.profilesByModel[MODEL_ID].bones.head).toEqual([DEFAULT_AVATAR_BONES.head[0], 0.54]);
});

test("constrains a dragged neck joint to preserve its connection below the head", async ({ page }) => {
  await page.goto("/");
  const editor = await openBones(page);
  await editor.scrollIntoViewIfNeeded();
  const preview = await editor.locator(".bone-preview").boundingBox();
  const neck = await editor.getByRole("button", { name: "首の根元を選択", exact: true }).boundingBox();
  expect(preview).not.toBeNull();
  expect(neck).not.toBeNull();
  await page.mouse.move(neck!.x + neck!.width / 2, neck!.y + neck!.height / 2);
  await page.mouse.down();
  await page.mouse.move(neck!.x + neck!.width / 2, preview!.y + 5, { steps: 5 });
  await page.mouse.up();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY);
  const bones = saved.profilesByModel[MODEL_ID].bones;
  expect(bones.neck[1]).toBeLessThan(0.625);
  expect(bones.neck[1] - bones.head[1]).toBeGreaterThanOrEqual(0.015);
  expect(bones.neck[1]).toBeLessThan(bones.chest[1]);
  await expect(page.getByRole("combobox", { name: "調整する関節", exact: true })).toHaveValue("neck");
});

test("discards malformed stored bones while retaining valid face calibration", async ({ page }) => {
  await page.addInitScript(({ key, modelId, profile }) => {
    localStorage.setItem(key, JSON.stringify({
      activeModelId: modelId,
      profilesByModel: { [modelId]: { ...profile, bones: { head: [0.5, 0.6], neck: [0.5, 0.4] } } },
    }));
  }, { key: SETTINGS_KEY, modelId: MODEL_ID, profile: profileAt(0.4) });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openBones(page);
  await expect(page.getByRole("slider", { name: "頭の付け根 Y", exact: true }))
    .toHaveValue(String(Number(DEFAULT_AVATAR_BONES.head[1].toFixed(3))));
  await page.locator("details.calibration-section summary").click();
  await expect(page.getByRole("slider", { name: "目の高さ", exact: true })).toHaveValue("0.4");
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY);
  expect(saved.profilesByModel[MODEL_ID]).toEqual(profileAt(0.4));
  expect(errors).toEqual([]);
});

test("infers imported joints, exports their evidence, and applies the same adjusted rig with the images", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "モデル生成", exact: true }).click();
  const inputs = page.locator('input[type="file"]');
  for (const [index, state] of (["neutral", "blink", "mouth-open"] as const).entries()) await inputs.nth(index).setInputFiles(packAsset(state));
  const apply = page.getByRole("button", { name: "検証済み素材をプレビューへ適用", exact: true });
  await expect(apply).toBeEnabled();
  await expect(page.locator(".bone-inference-status")).toHaveAttribute("data-confidence", /high|low/);
  await expect(page.locator(".bone-preview .bone-joint")).toHaveCount(5);
  await page.getByRole("slider", { name: "頭の付け根 Y", exact: true }).fill("0.54");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Manifestを保存", exact: true }).click();
  const download = await downloadPromise;
  let contents = "";
  for await (const chunk of await download.createReadStream()) contents += chunk.toString();
  const manifest = JSON.parse(contents);
  expect(manifest.schemaVersion).toBe(2);
  expect(manifest.renderer).toBe("custom-webgl-mesh");
  expect(manifest.profile.bones.head[1]).toBe(0.54);
  expect(manifest.rigInference.notes.length).toBeGreaterThan(0);
  expect(manifest.rigInference.manuallyAdjusted).toBe(true);
  expect(manifest.inspections.neutral.sha256).toMatch(/^[a-f0-9]{64}$/);

  await apply.click();
  await page.getByRole("button", { name: "コントロール", exact: true }).click();
  await expect(page.locator("img.avatar-character-fallback")).toHaveAttribute("src", /^blob:/);
  await openBones(page);
  await expect(page.getByRole("slider", { name: "頭の付け根 Y", exact: true })).toHaveValue("0.54");
  await page.locator("details.calibration-section summary").click();
  await expect.poll(async () => Number(await page.getByRole("slider", { name: "口 X", exact: true }).inputValue())).toBeCloseTo(manifest.profile.mouthCenter[0], 3);
  const saved = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
  expect(saved).not.toContain("blob:");
  expect(saved).not.toContain("custom");
  expect(errors).toEqual([]);
});

test("labels missing expression differences as an estimate requiring position review", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "モデル生成", exact: true }).click();
  const inputs = page.locator('input[type="file"]');
  // The same image in all three slots leaves no eye or mouth difference to locate.
  for (let index = 0; index < 3; index += 1) await inputs.nth(index).setInputFiles(packAsset("neutral"));
  await expect(page.getByRole("button", { name: "検証済み素材をプレビューへ適用", exact: true })).toBeEnabled();
  await expect(page.locator(".bone-inference-status")).toHaveAttribute("data-confidence", "low");
  await expect(page.getByText("推定・位置確認が必要です", { exact: true })).toBeVisible();
});

test("does not replace adjusted joints when an earlier image inference finishes late", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { holdFirst: true, release: null as (() => void) | null };
    Object.defineProperty(window, "__boneInferenceTest", { value: state });
    const NativeImage = window.Image;
    window.Image = class extends NativeImage {
      override set onload(callback: ((this: GlobalEventHandlers, event: Event) => unknown) | null) {
        super.onload = callback ? (event) => {
          if (state.holdFirst && this.src.startsWith("blob:")) {
            state.holdFirst = false;
            state.release = () => { callback.call(this, event); };
          } else callback.call(this, event);
        } : null;
      }
      override get onload() { return super.onload; }
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "モデル生成", exact: true }).click();
  const inputs = page.locator('input[type="file"]');
  for (let index = 0; index < 3; index += 1) await inputs.nth(index).setInputFiles(packAsset("neutral"));
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __boneInferenceTest: { release: unknown } }).__boneInferenceTest.release))).toBe(true);
  for (const [index, state] of (["neutral", "blink", "mouth-open"] as const).entries()) await inputs.nth(index).setInputFiles(packAsset(state));
  const headY = page.getByRole("slider", { name: "頭の付け根 Y", exact: true });
  await expect(headY).toBeVisible();
  await headY.fill("0.54");
  await page.evaluate(async () => {
    (window as unknown as { __boneInferenceTest: { release: () => void } }).__boneInferenceTest.release();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  });
  await expect(headY).toHaveValue("0.54");
  await expect(page.getByRole("button", { name: "検証済み素材をプレビューへ適用", exact: true })).toBeEnabled();
});

test("ignores a stale image inspection and releases an unapplied import on leaving the builder", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { created: [] as string[], revoked: [] as string[], release: null as (() => void) | null };
    Object.defineProperty(window, "__boneImportTest", { value: state });
    const createBitmap = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (image: ImageBitmapSource) => {
      if (image instanceof File && image.name === "slow-neutral.png") await new Promise<void>((resolve) => { state.release = resolve; });
      return createBitmap(image);
    }) as typeof createImageBitmap;
    const createUrl = URL.createObjectURL.bind(URL);
    const revokeUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => { const url = createUrl(object); state.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { state.revoked.push(url); revokeUrl(url); };
  });
  const image = await (await page.request.get("/assets/vtuber-rig-default-neutral-v1.png")).body();
  await page.goto("/");
  await page.getByRole("button", { name: "モデル生成", exact: true }).click();
  const neutralInput = page.locator('input[type="file"]').first();
  await neutralInput.setInputFiles({ name: "slow-neutral.png", mimeType: "image/png", buffer: image });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __boneImportTest: { release: unknown } }).__boneImportTest.release))).toBe(true);
  await neutralInput.setInputFiles({ name: "new-neutral.png", mimeType: "image/png", buffer: image });
  await expect(page.locator(".asset-drop").first()).toContainText("new-neutral.png");
  await page.evaluate(() => (window as unknown as { __boneImportTest: { release: () => void } }).__boneImportTest.release());
  await page.getByRole("button", { name: "コントロール", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = (window as unknown as { __boneImportTest: { created: string[]; revoked: string[] } }).__boneImportTest;
    return { created: state.created.length, revoked: state.revoked.length };
  })).toEqual({ created: 1, revoked: 1 });
});
