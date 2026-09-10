import { expect, test, type Page } from "@playwright/test";
import { RIG_VERTEX_SHADER } from "../../src/lib/webglAvatarRenderer";
import { DEFAULT_AVATAR_BONES, type AvatarBones, type RigProfile } from "../../src/lib/avatarRigProfile";

interface DeformationSample {
  points: number[][];
  head?: number[];
  body?: number[];
  hair?: number[];
  mouth?: number[];
  mouthCenter?: number[];
  translate?: number[];
  bones?: AvatarBones;
  profile?: RigProfile;
}

// Capture the production vertex shader's positions on the GPU. Only the GLSL
// interface syntax changes for WebGL 2 transform feedback; the rig math is shared.
async function deform(page: Page, samples: DeformationSample[]) {
  return page.evaluate(({ source, samples, defaultBones }) => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 is required for vertex position verification");
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compilation failed");
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, "#version 300 es\n" + source.replace(/\battribute\b/g, "in").replace(/\bvarying\b/g, "out"));
    const fragment = compile(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float; out vec4 color; void main() { color = vec4(1.0); }");
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.transformFeedbackVaryings(program, ["gl_Position"], gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Shader link failed");
    gl.useProgram(program);
    const input = gl.createBuffer();
    const output = gl.createBuffer();
    const feedback = gl.createTransformFeedback();
    const position = gl.getAttribLocation(program, "a_uv");
    gl.bindBuffer(gl.ARRAY_BUFFER, input);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
    gl.enable(gl.RASTERIZER_DISCARD);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const results = samples.map((sample) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, input);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sample.points.flat()), gl.STATIC_DRAW);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, sample.points.length * 4 * 4, gl.STREAM_READ);
      gl.uniform4fv(uniform("u_head"), sample.head ?? [0, 0, 0, 1]);
      gl.uniform4fv(uniform("u_body"), sample.body ?? [0, 0, 0, 0]);
      gl.uniform3fv(uniform("u_hair"), sample.hair ?? [0, 0, 0]);
      gl.uniform2fv(uniform("u_mouth"), sample.mouth ?? [0, 0]);
      gl.uniform2fv(uniform("u_mouth_center"), sample.mouthCenter ?? sample.profile?.mouthCenter ?? [0.4995, 0.489]);
      gl.uniform2fv(uniform("u_left_eye_center"), sample.profile?.leftEyeCenter ?? [0.4455, 0.3745]);
      gl.uniform2fv(uniform("u_right_eye_center"), sample.profile?.rightEyeCenter ?? [0.5615, 0.3745]);
      const bones = sample.bones ?? sample.profile?.bones ?? defaultBones;
      gl.uniform2fv(uniform("u_head_pivot"), bones.head);
      gl.uniform2fv(uniform("u_neck_pivot"), bones.neck);
      gl.uniform2fv(uniform("u_chest_pivot"), bones.chest);
      gl.uniform4fv(uniform("u_shoulders"), [...bones.leftShoulder, ...bones.rightShoulder]);
      gl.uniform2fv(uniform("u_translate"), sample.translate ?? [0, 0]);
      gl.uniform1f(uniform("u_aspect"), 16 / 9);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, sample.points.length);
      gl.endTransformFeedback();
      const positions = new Float32Array(sample.points.length * 4);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, positions);
      if (gl.getError() !== gl.NO_ERROR) throw new Error("Vertex capture failed");
      return sample.points.map((_, index) => [(positions[index * 4] + 1) / 2, (1 - positions[index * 4 + 1]) / 2]);
    });
    gl.deleteTransformFeedback(feedback);
    gl.deleteBuffer(input);
    gl.deleteBuffer(output);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return results;
  }, { source: RIG_VERTEX_SHADER, samples, defaultBones: DEFAULT_AVATAR_BONES });
}

test.beforeEach(async ({ page }) => { await page.goto("/"); });

test("hair physics keeps the face and clothing anchored", async ({ page }) => {
  const points = [[0.4455, 0.3745], [0.5615, 0.3745], [0.5, 0.405], [0.4995, 0.489], [0.5, 0.84], [0.65, 0.8]];
  const [still, swaying] = await deform(page, [{ points }, { points, hair: [2.5, 5, 2.5] }]);
  for (let index = 0; index < points.length; index += 1) {
    expect(swaying[index][0]).toBeCloseTo(still[index][0], 6);
    expect(swaying[index][1]).toBeCloseTo(still[index][1], 6);
  }
});

test("jaw opening follows the rolled head's local axis", async ({ page }) => {
  const points = [[0.4995, 0.55]];
  const [closed, open, rolledClosed, rolledOpen] = await deform(page, [
    { points }, { points, mouth: [1, 0] },
    { points, head: [0, 0, 30, 1] }, { points, head: [0, 0, 30, 1], mouth: [1, 0] },
  ]);
  const dx = (open[0][0] - closed[0][0]) * 16 / 9;
  const dy = open[0][1] - closed[0][1];
  const angle = 30 * 0.62 * Math.PI / 180;
  const rolledDx = (rolledOpen[0][0] - rolledClosed[0][0]) * 16 / 9;
  const rolledDy = rolledOpen[0][1] - rolledClosed[0][1];
  expect(Math.hypot(dx, dy)).toBeGreaterThan(0.001);
  // GLSL sin/cos precision varies by GPU; 1e-5 UV is under 0.02 source pixels.
  expect(rolledDx).toBeCloseTo(dx * Math.cos(angle) - dy * Math.sin(angle), 5);
  expect(rolledDy).toBeCloseTo(dx * Math.sin(angle) + dy * Math.cos(angle), 5);
});

test("jaw deformation follows the configured mouth position", async ({ page }) => {
  const points = [[0.44, 0.535], [0.56, 0.535]];
  const [closed, open] = await deform(page, [
    { points, mouthCenter: [0.44, 0.499] },
    { points, mouthCenter: [0.44, 0.499], mouth: [1, 0] },
  ]);
  expect(open[0][1] - closed[0][1]).toBeGreaterThan(0.001);
  expect(open[1][0]).toBeCloseTo(closed[1][0], 6);
  expect(open[1][1]).toBeCloseTo(closed[1][1], 6);
});

test("turning while nodding does not introduce an unrequested head tilt", async ({ page }) => {
  const points = [[0.4455, 0.3745], [0.5615, 0.3745]];
  const samples: DeformationSample[] = [];
  for (const yaw of [-30, 30]) for (const pitch of [-30, 30]) samples.push({ points, head: [yaw, pitch, 0, 1], mouthCenter: [0.5035, 0.489] });
  const frames = await deform(page, samples);
  for (const frame of frames) expect(frame[1][1]).toBeCloseTo(frame[0][1], 5);
});

test("head roll preserves face proportions and neck length while the torso stays anchored", async ({ page }) => {
  const bones = DEFAULT_AVATAR_BONES;
  const points = [[0.4455, 0.3745], [0.5615, 0.3745], [0.4995, 0.489], [...bones.head], [...bones.neck], [...bones.chest], [...bones.leftShoulder], [...bones.rightShoulder]];
  const frames = await deform(page, [-30, 0, 30].map(roll => ({ points, head: [0, 0, roll, 1], bones })));
  const distance = (a: number[], b: number[]) => Math.hypot((b[0] - a[0]) * 16 / 9, b[1] - a[1]);
  for (const frame of frames) {
    for (const [a, b] of [[0, 1], [0, 2], [1, 2], [3, 4]]) expect(distance(frame[a], frame[b])).toBeCloseTo(distance(points[a], points[b]), 5);
    for (let index = 4; index < points.length; index++) {
      expect(frame[index][0]).toBeCloseTo(points[index][0], 6);
      expect(frame[index][1]).toBeCloseTo(points[index][1], 6);
    }
  }
});

test("tracking translation moves the whole rig without stretching the neck", async ({ page }) => {
  const points = [[...DEFAULT_AVATAR_BONES.head], [...DEFAULT_AVATAR_BONES.neck], [...DEFAULT_AVATAR_BONES.chest]];
  const [still, moved] = await deform(page, [{ points }, { points, translate: [11 / 298, -8 / 167] }]);
  for (let i = 0; i < points.length; i++) {
    expect(moved[i][0] - still[i][0]).toBeCloseTo(11 / 298, 6);
    expect(moved[i][1] - still[i][1]).toBeCloseTo(-8 / 167, 6);
  }
});

test("a shifted or smaller imported character keeps jaw, neck and shoulder motion in proportion", async ({ page }) => {
  const points = [[0.4455, 0.3745], [0.5615, 0.3745], [0.4995, 0.55], [...DEFAULT_AVATAR_BONES.neck], [...DEFAULT_AVATAR_BONES.leftShoulder], [...DEFAULT_AVATAR_BONES.chest]];
  const base: DeformationSample = { points, head: [24, -15, 30, 1], mouth: [1, 0], hair: [1, 2, 1] };
  const scale = 0.6;
  const transform = (point: readonly number[]): [number, number] => [point[0] * scale + 0.1, point[1] * scale + 0.15];
  const profile: RigProfile = {
    leftEyeCenter: transform(points[0]), rightEyeCenter: transform(points[1]), mouthCenter: transform([0.4995, 0.489]),
    bones: Object.fromEntries(Object.entries(DEFAULT_AVATAR_BONES).map(([name, point]) => [name, transform(point)])) as unknown as AvatarBones,
  };
  const [full, smaller] = await deform(page, [base, { ...base, points: points.map(transform), profile }]);
  for (let i = 0; i < points.length; i++) {
    const expected = transform(full[i]);
    expect(smaller[i][0]).toBeCloseTo(expected[0], 5);
    expect(smaller[i][1]).toBeCloseTo(expected[1], 5);
  }
});

test("neutral preserves the mesh and combined extreme poses do not fold triangles", async ({ page }) => {
  const columns = 48;
  const rows = 30;
  const points = Array.from({ length: (columns + 1) * (rows + 1) }, (_, index) => [index % (columns + 1) / columns, Math.floor(index / (columns + 1)) / rows]);
  const samples: DeformationSample[] = [{ points }];
  for (const yaw of [-30, 30]) for (const pitch of [-30, 30]) for (const roll of [-30, 30]) {
    // Springs can still point the other way after a fast head turn. Translation
    // uses the slider limits on a 320px viewport, where the UV offset is largest.
    for (const bodyDirection of [-1, 1]) for (const hairDirection of [-1, 1]) {
      for (const x of [-11 / 298, 11 / 298]) for (const y of [-8 / 167, 8 / 167]) {
        samples.push({ points, head: [yaw, pitch, roll, 1], body: [6.6 * bodyDirection, 0, 9 * bodyDirection, 1], hair: [2.5 * hairDirection, 5 * hairDirection, 2.5 * hairDirection], mouth: [1, 0], translate: [x, y] });
      }
    }
  }
  const frames = await deform(page, samples);
  for (let index = 0; index < points.length; index += 1) {
    expect(frames[0][index][0]).toBeCloseTo(points[index][0], 6);
    expect(frames[0][index][1]).toBeCloseTo(points[index][1], 6);
  }
  for (const [index, frame] of frames.entries()) {
    const area = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let minimumArea = Infinity;
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      minimumArea = Math.min(minimumArea, area(frame[a], frame[a + 1], frame[a + columns + 1]), area(frame[a + 1], frame[a + columns + 2], frame[a + columns + 1]));
    }
    const { points: _, ...pose } = samples[index];
    expect(minimumArea, JSON.stringify(pose)).toBeGreaterThan(0);
  }
});
