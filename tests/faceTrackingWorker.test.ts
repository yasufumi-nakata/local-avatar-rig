import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { FaceRigPose } from "../src/lib/faceRigPose";

const detector = vi.hoisted(() => ({ result: null as FaceLandmarkerResult | null }));
vi.mock("../src/lib/faceModel", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/faceModel")>(),
  fetchVerifiedFaceModel: async () => new Uint8Array([1, 2, 3]),
}));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceLandmarker: {
    createFromOptions: async () => ({ detectForVideo: () => detector.result, close: () => {} }),
  },
}));

type Point = readonly [number, number, number];
type Orientation = { yaw: number; pitch: number; roll: number };
const front = { yaw: 0, pitch: 0, roll: 0 };

// Rz * Ry * Rx, matching the Worker's column-major Euler decomposition.
function rotate(point: Point, orientation: Orientation): Point {
  const pitch = orientation.pitch * Math.PI / 180;
  const yaw = orientation.yaw * Math.PI / 180;
  const roll = orientation.roll * Math.PI / 180;
  const px = point[0];
  const py = point[1] * Math.cos(pitch) - point[2] * Math.sin(pitch);
  const pz = point[1] * Math.sin(pitch) + point[2] * Math.cos(pitch);
  const yx = px * Math.cos(yaw) + pz * Math.sin(yaw);
  const yz = pz * Math.cos(yaw) - px * Math.sin(yaw);
  return [yx * Math.cos(roll) - py * Math.sin(roll), yx * Math.sin(roll) + py * Math.cos(roll), yz];
}

function faceResult(orientation: Orientation, image: { width: number; height: number }, relativeSize = 1): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const points: ReadonlyArray<readonly [number, Point]> = [
    [234, [-0.125, 0, 0]], [454, [0.125, 0, 0]],
    [10, [0, 0.13, 0]], [152, [0, -0.14, 0.01]],
    [33, [-0.06, 0.05, 0.02]], [263, [0.06, 0.05, 0.02]], [1, [0, 0.015, 0.06]],
  ];
  for (const [index, point] of points) {
    const [x, y, z] = rotate(point, orientation);
    // MediaPipe x/z use image-width units; y uses image-height units. Its
    // image y points down and relative z points away from the camera.
    landmarks[index] = { x: 0.5 + x * relativeSize, y: 0.5 - y * relativeSize * image.width / image.height, z: -z * relativeSize, visibility: 1 };
  }
  const xAxis = rotate([1, 0, 0], orientation);
  const yAxis = rotate([0, 1, 0], orientation);
  const zAxis = rotate([0, 0, 1], orientation);
  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: [...xAxis, 0, ...yAxis, 0, ...zAxis, 0, 0, 0, 0, 1] }],
  };
}

interface WorkerMessage { type: string; pose?: FaceRigPose }
let messages: WorkerMessage[];
let worker: { onmessage: ((event: MessageEvent) => void) | null };

async function initialize() {
  const previousReady = messages.filter((message) => message.type === "ready").length;
  worker.onmessage?.({ data: { type: "init" } } as MessageEvent);
  await vi.waitFor(() => expect(messages.filter((message) => message.type === "ready"), JSON.stringify(messages)).toHaveLength(previousReady + 1));
}

function sendFrame(result: FaceLandmarkerResult, timestamp: number, image: { width: number; height: number }) {
  detector.result = result;
  const bitmap = { ...image, close: vi.fn() };
  const start = messages.length;
  worker.onmessage?.({ data: { type: "frame", bitmap, timestamp } } as MessageEvent);
  expect(bitmap.close).toHaveBeenCalledOnce();
  const sent = messages.slice(start);
  expect(sent.at(-1)).toEqual({ type: "frame-complete" });
  return sent;
}

beforeEach(async () => {
  vi.resetModules();
  messages = [];
  const context = {
    onmessage: null,
    ...{
      fetch: async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3])),
      // createRestrictedWorkerFetch reads the worker's own origin from this URL.
      location: { href: "http://localhost/face-worker.js" },
      console: { warn: vi.fn(), error: vi.fn() },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
  };
  worker = context;
  vi.stubGlobal("self", context);
  // In a real Worker `self.fetch` and the global `fetch` binding are the same.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => context.fetch(input, init));
  vi.stubGlobal("postMessage", (message: WorkerMessage) => messages.push(message));
  await import("../src/workers/faceLandmarker.worker");
  await initialize();
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("real worker landmark-to-rig conversion", () => {
  it.each([{ width: 800, height: 800 }, { width: 800, height: 600 }, { width: 800, height: 450 }, { width: 800, height: 1200 }])("keeps scale for same-distance yaw/pitch/roll combinations at $width x $height", (image) => {
    sendFrame(faceResult(front, image), 100, image);
    let timestamp = 150;
    for (const yaw of [-30, 0, 30]) for (const pitch of [-25, 0, 25]) for (const roll of [-20, 0, 20]) {
      const pose = sendFrame(faceResult({ yaw, pitch, roll }, image), timestamp, image).find((message) => message.type === "pose")!.pose!;
      timestamp += 50;
      expect(pose.scale, JSON.stringify({ yaw, pitch, roll })).toBeCloseTo(1, 10);
      expect(pose.yaw).toBeCloseTo(-yaw, 10);
      expect(pose.pitch).toBeCloseTo(-pitch * 0.9, 10);
      expect(pose.roll).toBeCloseTo(roll, 10);
    }
    const closer = sendFrame(faceResult({ yaw: 30, pitch: 20, roll: 15 }, image, 1.2), timestamp, image).find((message) => message.type === "pose")!.pose!;
    expect(closer.scale).toBeCloseTo(1.032, 10);
  });

  it("retains its front calibration across missing frames and recalibrates on explicit restart", async () => {
    const image = { width: 640, height: 480 };
    const turned = { yaw: 20, pitch: 10, roll: 8 };
    sendFrame(faceResult(front, image), 100, image);
    const before = sendFrame(faceResult(turned, image), 150, image).find((message) => message.type === "pose")!.pose!;
    const missing = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] };
    for (const timestamp of [200, 250, 2000, 4000]) expect(sendFrame(missing, timestamp, image)).toContainEqual({ type: "missing" });
    const reacquired = sendFrame(faceResult(turned, image), 4050, image).find((message) => message.type === "pose")!.pose!;
    expect(reacquired).toEqual(before);
    const returned = sendFrame(faceResult(front, image), 4100, image).find((message) => message.type === "pose")!.pose!;
    expect(returned).toMatchObject({ yaw: -0, pitch: -0, roll: -0, scale: 1 });

    await initialize();
    const restarted = sendFrame(faceResult(turned, image), 5000, image).find((message) => message.type === "pose")!.pose!;
    expect(restarted).toMatchObject({ yaw: -0, pitch: -0, roll: -0, scale: 1 });
    const afterRestart = sendFrame(faceResult(front, image), 5050, image).find((message) => message.type === "pose")!.pose!;
    expect(afterRestart.yaw).toBeCloseTo(20, 10);
  });
});
