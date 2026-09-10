import { RIG_VERTEX_SHADER } from "./avatarVertexShader";
import { resolveAvatarBones, type RigProfile } from "./avatarRigProfile";
export { RIG_VERTEX_SHADER } from "./avatarVertexShader";
export type { RigProfile } from "./avatarRigProfile";
import type { FaceRigPose } from "./faceRigPose";
import {
  autoBlinkEnvelope,
  clamp,
  SecondaryMotionController,
  smoothMotionValue,
  speechMouthTarget,
  turnCoupledGaze,
} from "./rigMotionMath";

export interface RigFrameOptions {
  motion: boolean;
  speaking: boolean;
  audioLevel: number;
  tracking: boolean;
}

interface Uniforms {
  neutral: WebGLUniformLocation;
  blink: WebGLUniformLocation;
  mouthTexture: WebGLUniformLocation;
  head: WebGLUniformLocation;
  body: WebGLUniformLocation;
  hair: WebGLUniformLocation;
  translate: WebGLUniformLocation;
  aspect: WebGLUniformLocation;
  eye: WebGLUniformLocation;
  eyeBlink: WebGLUniformLocation;
  mouth: WebGLUniformLocation;
  leftEyeCenter: WebGLUniformLocation;
  rightEyeCenter: WebGLUniformLocation;
  mouthCenter: WebGLUniformLocation;
  headPivot: WebGLUniformLocation;
  neckPivot: WebGLUniformLocation;
  chestPivot: WebGLUniformLocation;
  shoulders: WebGLUniformLocation;
}

export interface AvatarTextureSources {
  neutral: string;
  blink: string;
  mouthOpen: string;
}

export const DEFAULT_AVATAR_TEXTURES: AvatarTextureSources = {
  neutral: "/assets/vtuber-rig-default-neutral-v1.png",
  blink: "/assets/vtuber-rig-default-blink-v1.png",
  mouthOpen: "/assets/vtuber-rig-default-mouth-open-v1.png",
};

export const DEFAULT_RIG_PROFILE: RigProfile = {
  leftEyeCenter: [0.4455, 0.3745],
  rightEyeCenter: [0.5615, 0.3745],
  mouthCenter: [0.4995, 0.4890],
};

const FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 v_uv;

  uniform sampler2D u_neutral;
  uniform sampler2D u_blink_texture;
  uniform sampler2D u_mouth_texture;
  uniform vec2 u_eye;
  uniform vec2 u_eye_blink;
  uniform vec2 u_mouth;
  uniform vec2 u_left_eye_center;
  uniform vec2 u_right_eye_center;
  uniform vec2 u_mouth_center;

  float ellipseMask(vec2 point, vec2 center, vec2 radius, float feather) {
    float distanceFromCenter = length((point - center) / radius);
    return 1.0 - smoothstep(1.0 - feather, 1.0, distanceFromCenter);
  }

  void main() {
    vec4 color = texture2D(u_neutral, v_uv);
    float rigScale = max(0.035, abs(u_right_eye_center.x - u_left_eye_center.x)) / 0.116;

    // ParamEyeBallX/Y相当。虹彩中心だけを局所サンプリングして左右を同期移動します。
    vec2 gaze = vec2(u_eye.x * 0.0042, -u_eye.y * 0.0032) * rigScale;
    float leftIris = ellipseMask(v_uv, u_left_eye_center, vec2(0.019, 0.034) * rigScale, 0.36);
    float rightIris = ellipseMask(v_uv, u_right_eye_center, vec2(0.019, 0.034) * rigScale, 0.36);
    float irisMask = max(leftIris * (1.0 - u_eye_blink.x), rightIris * (1.0 - u_eye_blink.y));
    vec4 shiftedEye = texture2D(u_neutral, v_uv - gaze);
    color = mix(color, shiftedEye, irisMask * 0.88);

    // 左右のParamEyeOpenを独立適用します。閉じ画像の差分は目周辺だけに限定します。
    // 2枚の差分素材を線形合成すると中間値で開いた目と閉じた目が二重写しに
    // なるため、切り替わりを短い区間へ寄せて実際の瞬きに近づけます。
    float leftClosed = smoothstep(0.38, 0.62, u_eye_blink.x);
    float rightClosed = smoothstep(0.38, 0.62, u_eye_blink.y);
    float leftEye = ellipseMask(v_uv, u_left_eye_center, vec2(0.058, 0.060) * rigScale, 0.34) * leftClosed;
    float rightEye = ellipseMask(v_uv, u_right_eye_center, vec2(0.058, 0.060) * rigScale, 0.34) * rightClosed;
    vec4 closedEye = texture2D(u_blink_texture, v_uv);
    color = mix(color, closedEye, clamp(max(leftEye, rightEye), 0.0, 1.0));

    // 表情画像は実アルファでNeutralへ登録済みです。
    // 顔上の小さな口パッチだけを参照して合成範囲を限定します。
    // 参照位置と合成位置はどちらもpackごとの実測口中心に合わせます。
    // 以前は合成側だけが口より下（あご）にずれており、開いた口の上に閉じた口
    // の線が残って口が二重に見えていました。
    float openAmount = clamp(u_mouth.x, 0.0, 1.0);
    float smile = clamp(u_mouth.y, 0.0, 1.0);
    vec2 mouthCenter = u_mouth_center;
    float smileX = clamp((v_uv.x - mouthCenter.x) / (0.020 * rigScale), -1.0, 1.0);
    vec2 smileSourceUv = vec2(
      mouthCenter.x + (v_uv.x - mouthCenter.x) * (1.0 - smile * 0.10),
      v_uv.y + smile * (0.0005 + 0.0040 * smileX * smileX) * rigScale
    );
    float smilePatch = ellipseMask(v_uv, mouthCenter, vec2(0.042, 0.024) * rigScale, 0.42);
    color = mix(color, texture2D(u_neutral, smileSourceUv), smilePatch * smile * 0.86);
    // 不透明度だけで2枚を混ぜると中間の開き具合が二重写しになるため、
    // 開き量では口差分を縦に潰して実際の開口量として見せます。参照位置は
    // 口の周囲（肌）までに制限し、目や首を口へ引き込まないようにします。
    float openScale = mix(0.26, 1.0, openAmount);
    float sourceOffsetY = clamp((v_uv.y - mouthCenter.y) / openScale, -0.040 * rigScale, 0.040 * rigScale);
    vec4 openMouth = texture2D(u_mouth_texture, vec2(v_uv.x, mouthCenter.y + sourceOffsetY));
    float mouthPatch = ellipseMask(v_uv, mouthCenter, vec2(0.036, 0.030) * rigScale, 0.30);
    float mouthBlend = mouthPatch * smoothstep(0.02, 0.14, openAmount);
    color = mix(color, openMouth, mouthBlend);

    gl_FragColor = color;
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("アバター用シェーダーを作成できませんでした。");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, RIG_VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("アバター用描画プログラムを作成できませんでした。");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function requiredUniform(gl: WebGLRenderingContext, program: WebGLProgram, name: string) {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`アバター描画パラメータ ${name} が見つかりません。`);
  return location;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`アバター素材 ${source} を読み込めませんでした。`));
    image.src = source;
  });
}

function createTexture(gl: WebGLRenderingContext, image: HTMLImageElement, unit: number) {
  const texture = gl.createTexture();
  if (!texture) throw new Error("アバター用テクスチャを作成できませんでした。");
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return texture;
}

function createMesh(columns = 48, rows = 30) {
  const vertices = new Float32Array((columns + 1) * (rows + 1) * 2);
  let vertexCursor = 0;
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      vertices[vertexCursor++] = column / columns;
      vertices[vertexCursor++] = row / rows;
    }
  }

  const indices = new Uint16Array(columns * rows * 6);
  let indexCursor = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns + 1;
      const bottomRight = bottomLeft + 1;
      indices[indexCursor++] = topLeft;
      indices[indexCursor++] = bottomLeft;
      indices[indexCursor++] = topRight;
      indices[indexCursor++] = topRight;
      indices[indexCursor++] = bottomLeft;
      indices[indexCursor++] = bottomRight;
    }
  }
  return { vertices, indices };
}

export class WebGLAvatarRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Uniforms;
  private readonly position: number;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly indexCount: number;
  private textures: WebGLTexture[] = [];
  private initialized = false;
  private destroyed = false;
  private initializationId = 0;
  private lastFrameAt = 0;
  private readonly secondaryMotion = new SecondaryMotionController();
  private eyeX = 0;
  private eyeY = 0;
  private blinkLeft = 0;
  private blinkRight = 0;
  private mouthOpen = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("このブラウザでは2Dメッシュ変形を利用できません。");
    this.canvas = canvas;
    this.gl = gl;
    this.program = createProgram(gl);
    this.position = gl.getAttribLocation(this.program, "a_uv");
    if (this.position < 0) throw new Error("アバター用メッシュ属性が見つかりません。");

    this.uniforms = {
      neutral: requiredUniform(gl, this.program, "u_neutral"),
      blink: requiredUniform(gl, this.program, "u_blink_texture"),
      mouthTexture: requiredUniform(gl, this.program, "u_mouth_texture"),
      head: requiredUniform(gl, this.program, "u_head"),
      body: requiredUniform(gl, this.program, "u_body"),
      hair: requiredUniform(gl, this.program, "u_hair"),
      translate: requiredUniform(gl, this.program, "u_translate"),
      aspect: requiredUniform(gl, this.program, "u_aspect"),
      eye: requiredUniform(gl, this.program, "u_eye"),
      eyeBlink: requiredUniform(gl, this.program, "u_eye_blink"),
      mouth: requiredUniform(gl, this.program, "u_mouth"),
      leftEyeCenter: requiredUniform(gl, this.program, "u_left_eye_center"),
      rightEyeCenter: requiredUniform(gl, this.program, "u_right_eye_center"),
      mouthCenter: requiredUniform(gl, this.program, "u_mouth_center"),
      headPivot: requiredUniform(gl, this.program, "u_head_pivot"),
      neckPivot: requiredUniform(gl, this.program, "u_neck_pivot"),
      chestPivot: requiredUniform(gl, this.program, "u_chest_pivot"),
      shoulders: requiredUniform(gl, this.program, "u_shoulders"),
    };

    const mesh = createMesh();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!vertexBuffer || !indexBuffer) throw new Error("アバター用メッシュを作成できませんでした。");
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    this.indexCount = mesh.indices.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  }

  async initialize(sources: AvatarTextureSources = DEFAULT_AVATAR_TEXTURES) {
    if (this.destroyed) return;
    const initializationId = ++this.initializationId;
    this.initialized = false;
    delete this.canvas.dataset.rigReady;

    let images: HTMLImageElement[];
    try {
      images = await Promise.all([
        loadImage(sources.neutral),
        loadImage(sources.blink),
        loadImage(sources.mouthOpen),
      ]);
    } catch (error) {
      if (this.destroyed || initializationId !== this.initializationId) return;
      throw error;
    }
    // モデル切替やStrictModeのcleanup後に旧ロードが完了しても、
    // 新しい描画のready状態やGPUリソースへ触れないようにします。
    if (this.destroyed || initializationId !== this.initializationId || this.gl.isContextLost()) return;

    const textures: WebGLTexture[] = [];
    try {
      for (const [unit, image] of images.entries()) {
        textures.push(createTexture(this.gl, image, unit));
      }
    } catch (error) {
      for (const texture of textures) this.gl.deleteTexture(texture);
      throw error;
    }
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures = textures;
    this.initialized = true;
    delete this.canvas.dataset.rigError;
    this.canvas.dataset.rigReady = "true";
  }

  private resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  render(
    now: number,
    pose: FaceRigPose,
    options: RigFrameOptions,
    profile: RigProfile = DEFAULT_RIG_PROFILE,
  ) {
    if (!this.initialized || this.gl.isContextLost()) return;
    this.resize();
    const rawElapsed = this.lastFrameAt > 0 ? now - this.lastFrameAt : 16.667;
    const elapsed = clamp(rawElapsed, 0, 100);
    const seconds = elapsed / 1_000;
    this.lastFrameAt = now;

    const breath = options.motion ? (Math.sin((now / 5_200) * Math.PI * 2 - Math.PI / 2) + 1) * 0.5 : 0;
    const secondary = this.secondaryMotion.step(seconds, pose, options.motion, breath);

    this.eyeX = smoothMotionValue(this.eyeX, turnCoupledGaze(pose.eyeX, pose.yaw), 38, elapsed);
    this.eyeY = smoothMotionValue(this.eyeY, pose.eyeY, 42, elapsed);
    const autoBlink = options.motion && !options.tracking ? autoBlinkEnvelope(now) : 0;
    const leftBlinkTarget = Math.max(pose.blinkLeft, autoBlink);
    const rightBlinkTarget = Math.max(pose.blinkRight, autoBlink);
    this.blinkLeft = smoothMotionValue(this.blinkLeft, leftBlinkTarget, leftBlinkTarget > this.blinkLeft ? 9 : 28, elapsed);
    this.blinkRight = smoothMotionValue(this.blinkRight, rightBlinkTarget, rightBlinkTarget > this.blinkRight ? 9 : 28, elapsed);

    const mouthTarget = Math.max(pose.mouthOpen, speechMouthTarget(options.speaking, options.audioLevel));
    this.mouthOpen = smoothMotionValue(
      this.mouthOpen,
      mouthTarget,
      mouthTarget > this.mouthOpen ? 34 : 78,
      elapsed,
    );

    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(this.position);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[2]);
    gl.uniform1i(this.uniforms.neutral, 0);
    gl.uniform1i(this.uniforms.blink, 1);
    gl.uniform1i(this.uniforms.mouthTexture, 2);
    gl.uniform4f(this.uniforms.head, pose.yaw, pose.pitch, pose.roll, pose.scale);
    gl.uniform4f(this.uniforms.body, secondary.bodyX, 0, secondary.bodyZ, breath);
    gl.uniform3f(this.uniforms.hair, secondary.hairFront, secondary.hairSide, secondary.hairBack);
    gl.uniform2f(
      this.uniforms.translate,
      pose.x / Math.max(1, this.canvas.clientWidth),
      pose.y / Math.max(1, this.canvas.clientHeight),
    );
    gl.uniform1f(
      this.uniforms.aspect,
      Math.max(0.1, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight)),
    );
    gl.uniform2f(this.uniforms.eye, this.eyeX, this.eyeY);
    gl.uniform2f(this.uniforms.eyeBlink, this.blinkLeft, this.blinkRight);
    gl.uniform2f(this.uniforms.mouth, this.mouthOpen, pose.smile);
    gl.uniform2f(this.uniforms.leftEyeCenter, ...profile.leftEyeCenter);
    gl.uniform2f(this.uniforms.rightEyeCenter, ...profile.rightEyeCenter);
    gl.uniform2f(this.uniforms.mouthCenter, ...profile.mouthCenter);
    const bones = resolveAvatarBones(profile);
    gl.uniform2f(this.uniforms.headPivot, ...bones.head);
    gl.uniform2f(this.uniforms.neckPivot, ...bones.neck);
    gl.uniform2f(this.uniforms.chestPivot, ...bones.chest);
    gl.uniform4f(this.uniforms.shoulders, ...bones.leftShoulder, ...bones.rightShoulder);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.initialized = false;
    this.initializationId += 1;
    const gl = this.gl;
    for (const texture of this.textures) gl.deleteTexture(texture);
    this.textures = [];
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteProgram(this.program);
    delete this.canvas.dataset.rigReady;
  }
}
