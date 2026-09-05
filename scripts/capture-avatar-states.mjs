import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.LOCAL_AVATAR_RIG_CAPTURE_URL ?? "http://127.0.0.1:4173";
const parsedUrl = new URL(baseUrl);
if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsedUrl.hostname)) {
  throw new Error(`撮影先はlocalhostに限定しています: ${parsedUrl.hostname}`);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotsRoot = path.join(repositoryRoot, "docs", "screenshots");
const stateDirectory = path.join(screenshotsRoot, "default-navigator-v1");
await mkdir(stateDirectory, { recursive: true });

const browserProblems = [];
const externalRequests = [];
function monitor(page) {
  page.on("pageerror", (error) => browserProblems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const chromiumReadbackNotice = message.type() === "warning"
      && message.text().includes("GL Driver Message")
      && message.text().includes("ReadPixels");
    if (!chromiumReadbackNotice && (message.type() === "error" || message.type() === "warning")) {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== parsedUrl.origin) externalRequests.push(request.url());
  });
}

async function waitForRig(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("canvas.avatar-rig-canvas[data-rig-ready='true']").waitFor();
  await page.locator("img.avatar-character-fallback[src='/assets/vtuber-rig-default-neutral-v1.png']").waitFor();
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1536, height: 1024 },
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  });
  monitor(page);
  await waitForRig(page);

  const navigatorButton = page.getByRole("button", { name: /Navigator 銀青の研究ナビゲーター/ });
  if (await navigatorButton.getAttribute("aria-pressed") !== "true") await navigatorButton.click();

  const motion = page.getByRole("checkbox", { name: "呼吸・瞬き・髪物理" });
  const pointer = page.getByRole("checkbox", { name: "ポインター追従" });
  if (await motion.isChecked()) await motion.uncheck({ force: true });
  if (await pointer.isChecked()) await pointer.uncheck({ force: true });
  await page.getByRole("group", { name: "背景" }).getByRole("button", { name: "グリーン" }).click();

  const fixedStageStyle = await page.addStyleTag({
    content: ".avatar-stage { width: 960px !important; height: 540px !important; aspect-ratio: 16 / 9 !important; }",
  });
  const stage = page.locator(".avatar-stage");
  const reset = page.getByRole("button", { name: "リセット", exact: true });
  const captureState = async (name) => {
    await page.waitForTimeout(180);
    const target = path.join(stateDirectory, `${name}.png`);
    await stage.screenshot({ path: target, animations: "disabled" });
    const size = await stage.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return [Math.round(rect.width), Math.round(rect.height)];
    });
    if (size[0] !== 960 || size[1] !== 540) throw new Error(`${name}: stage ${size.join("x")}`);
    console.log(`✓ ${path.relative(repositoryRoot, target)} (960x540)`);
  };

  await reset.click();
  await captureState("neutral");
  await page.getByRole("slider", { name: "左まぶた" }).fill("1");
  await page.getByRole("slider", { name: "右まぶた" }).fill("1");
  await captureState("blink");
  await reset.click();
  await page.getByRole("slider", { name: "Yaw" }).fill("-24");
  await captureState("yaw-left");
  await reset.click();
  await page.getByRole("slider", { name: "Yaw" }).fill("24");
  await captureState("yaw-right");
  await reset.click();
  await page.getByRole("slider", { name: "口開き" }).fill("0.72");
  await page.getByRole("slider", { name: "笑顔" }).fill("0.2");
  await captureState("speaking");

  await reset.click();
  await page.getByRole("group", { name: "背景" }).getByRole("button", { name: "シーン" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(180);
  const characterStudioPath = path.join(stateDirectory, "studio-desktop.png");
  await page.screenshot({ path: characterStudioPath, animations: "disabled" });
  console.log(`✓ ${path.relative(repositoryRoot, characterStudioPath)} (1536x1024)`);

  await fixedStageStyle.evaluate((element) => element.remove());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("canvas.avatar-rig-canvas[data-rig-ready='true']").waitFor();
  const studioPath = path.join(screenshotsRoot, "studio-desktop.png");
  await page.screenshot({ path: studioPath, animations: "disabled" });
  console.log(`✓ ${path.relative(repositoryRoot, studioPath)} (1536x1024)`);

  await page.getByRole("button", { name: "モデル生成" }).click();
  await page.waitForTimeout(120);
  const modelBuilderPath = path.join(screenshotsRoot, "model-builder-desktop.png");
  await page.screenshot({ path: modelBuilderPath, animations: "disabled" });
  console.log(`✓ ${path.relative(repositoryRoot, modelBuilderPath)} (1536x1024)`);

  const mobilePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  });
  monitor(mobilePage);
  await waitForRig(mobilePage);
  const mobilePath = path.join(screenshotsRoot, "studio-mobile.png");
  await mobilePage.screenshot({ path: mobilePath, animations: "disabled" });
  console.log(`✓ ${path.relative(repositoryRoot, mobilePath)} (390x844)`);
  await mobilePage.close();

  if (browserProblems.length > 0) throw new Error(`ブラウザ警告・エラー:\n${browserProblems.join("\n")}`);
  if (externalRequests.length > 0) throw new Error(`外部通信を検出しました:\n${externalRequests.join("\n")}`);
} finally {
  await browser.close();
}
