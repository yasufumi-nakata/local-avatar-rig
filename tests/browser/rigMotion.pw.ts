import { expect, test } from "@playwright/test";

// These drive the renderer module by its source path, which only the dev
// server serves. The production preview exposes bundled chunks instead.
test.skip(process.env.LOCAL_AVATAR_RIG_TEST_BUILD === "1", "requires dev-server source modules");

test("renders the same shoulder response at low and high frame rates", async ({ page }) => {
  await page.goto("/");
  const frames = await page.evaluate(async () => {
    const rendererPath = "/src/lib/webglAvatarRenderer.ts";
    const posePath = "/src/lib/faceRigPose.ts";
    const { WebGLAvatarRenderer } = await import(rendererPath);
    const { NEUTRAL_FACE_RIG_POSE } = await import(posePath);
    const frames: Array<{ fps: number; body: number[] }> = [];
    for (const fps of [10, 15, 24, 30, 60, 144, 240]) {
      const canvas = document.createElement("canvas");
      const renderer = new WebGLAvatarRenderer(canvas);
      const gl = canvas.getContext("webgl")!;
      try {
        await renderer.initialize();
        const options = { motion: true, speaking: false, audioLevel: 0, tracking: true };
        renderer.render(1_000, NEUTRAL_FACE_RIG_POSE, options);
        const pose = { ...NEUTRAL_FACE_RIG_POSE, yaw: 24, pitch: -12, roll: 8 };
        for (let index = 1; index <= fps; index += 1) {
          renderer.render(1_000 + index * 1_000 / fps, pose, options);
        }
        const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
        const body = gl.getUniform(program, gl.getUniformLocation(program, "u_body")!) as Float32Array;
        frames.push({ fps, body: [body[0], body[2]] });
        if (gl.getError() !== gl.NO_ERROR) throw new Error("Shoulder frame did not render correctly");
      } finally {
        renderer.destroy();
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    }
    return frames;
  });
  const reference = frames.find(({ fps }) => fps === 60)!.body;
  expect(reference[0]).toBeGreaterThan(5);
  for (const { fps, body } of frames) expect(body, `${fps}fps after one second`).toEqual(reference);
});
