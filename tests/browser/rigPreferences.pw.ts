import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_AVATAR_BONES } from "../../src/lib/avatarRigProfile";

const SETTINGS_KEY = "local-avatar-rig:preferences:v2";
const MODEL_ID = "default-navigator-v1";
const neutralAsset = new URL("../../public/assets/vtuber-rig-default-neutral-v1.png", import.meta.url).pathname;

const profileAt = (eyeY: number) => ({
  leftEyeCenter: [0.4455, eyeY],
  rightEyeCenter: [0.5615, eyeY],
  mouthCenter: [0.4995, 0.489],
});

const modelButton = (page: Page) => page.getByRole("button", { name: /Navigator/ });

async function openProfileControls(page: Page) {
  const details = page.locator("details.calibration-section");
  if (await details.getAttribute("open") === null) {
    await page.getByText("独自モデルの顔パッチ位置", { exact: true }).click();
  }
  return page.getByRole("slider", { name: "目の高さ", exact: true });
}

async function seedPreferences(page: Page, preferences: unknown) {
  await page.addInitScript(({ settingsKey, value }) => {
    if (window.localStorage.getItem(settingsKey) === null) {
      window.localStorage.setItem(settingsKey, JSON.stringify(value));
    }
  }, { settingsKey: SETTINGS_KEY, value: preferences });
}

test("keeps the selected model's calibration and pose when its button is clicked again", async ({ page }) => {
  await page.goto("/");
  const eyeY = await openProfileControls(page);
  await eyeY.fill("0.4");
  const yaw = page.getByRole("slider", { name: "Yaw", exact: true });
  await yaw.fill("12");

  await modelButton(page).click();

  await expect(eyeY).toHaveValue("0.4");
  await expect(yaw).toHaveValue("12");
});

test("retains the calibration and inferred joints through reloads", async ({ page }) => {
  await page.goto("/");
  const eyeY = await openProfileControls(page);
  await eyeY.fill("0.4");

  await page.reload();
  await expect(modelButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(await openProfileControls(page)).toHaveValue("0.4");

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)!), SETTINGS_KEY);
  expect(stored.profilesByModel).toEqual({
    [MODEL_ID]: { ...profileAt(0.4), bones: DEFAULT_AVATAR_BONES },
  });
});

test("seeds an older single-profile setting into its recorded model", async ({ page }) => {
  await seedPreferences(page, {
    motion: false,
    pointerFollow: false,
    backgroundMode: "blue",
    activeModelId: MODEL_ID,
    profileModelId: MODEL_ID,
    profile: profileAt(0.33),
  });
  await page.goto("/");
  await expect(await openProfileControls(page)).toHaveValue("0.33");
  await page.reload();
  await expect(await openProfileControls(page)).toHaveValue("0.33");
  await expect(page.getByRole("checkbox", { name: "呼吸・瞬き・髪物理" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "ポインター追従" })).not.toBeChecked();
});

test("isolates malformed profile coordinates without discarding the other settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const malformed = { ...profileAt(0.33), leftEyeCenter: { x: 0.4455, y: 0.33 } };
  await seedPreferences(page, {
    motion: false,
    pointerFollow: false,
    backgroundMode: "blue",
    activeModelId: MODEL_ID,
    profileModelId: MODEL_ID,
    profile: malformed,
    profilesByModel: { [MODEL_ID]: malformed },
  });
  await page.goto("/");
  await expect(await openProfileControls(page)).toHaveValue("0.3745");
  await expect(page.getByRole("checkbox", { name: "呼吸・瞬き・髪物理" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "ポインター追従" })).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("uses a valid older profile when the new stored entry is malformed", async ({ page }) => {
  await seedPreferences(page, {
    activeModelId: MODEL_ID,
    profileModelId: MODEL_ID,
    profile: profileAt(0.4),
    profilesByModel: { [MODEL_ID]: { ...profileAt(0.35), leftEyeCenter: [0.4455, "0.35"] } },
  });
  await page.goto("/");
  await expect(await openProfileControls(page)).toHaveValue("0.4");
});

test("keeps custom imports and their calibration temporary without overwriting the built-in calibration", async ({ page }) => {
  await page.goto("/");
  const eyeY = await openProfileControls(page);
  await eyeY.fill("0.4");

  await page.getByRole("button", { name: "モデル生成", exact: true }).click();
  const fileInputs = page.locator('input[type="file"]');
  for (let index = 0; index < 3; index += 1) {
    await fileInputs.nth(index).setInputFiles(neutralAsset);
  }
  await expect(page.getByText("自動検査に合格しました", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "検証済み素材をプレビューへ適用", exact: true }).click();
  await page.getByRole("button", { name: "コントロール", exact: true }).click();
  await expect(page.locator("img.avatar-character-fallback")).toHaveAttribute("src", /^blob:/);
  await (await openProfileControls(page)).fill("0.42");

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)!), SETTINGS_KEY);
  expect(stored.activeModelId).toBe(MODEL_ID);
  expect(stored.profile).toEqual({ ...profileAt(0.4), bones: DEFAULT_AVATAR_BONES });
  expect(stored.profilesByModel).toEqual({ [MODEL_ID]: { ...profileAt(0.4), bones: DEFAULT_AVATAR_BONES } });
  expect(JSON.stringify(stored)).not.toContain("blob:");
  expect(JSON.stringify(stored)).not.toContain("custom");

  await page.reload();
  await expect(modelButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(await openProfileControls(page)).toHaveValue("0.4");
});
