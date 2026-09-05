import { describe, expect, it, vi } from "vitest";
import { createRestrictedWorkerFetch, FACE_MODEL, fetchVerifiedFaceModel } from "../src/lib/faceModel";

function modelResponse(body: BodyInit | null, options: ResponseInit = {}) {
  const response = new Response(body, options);
  Object.defineProperty(response, "url", { value: FACE_MODEL.url, configurable: true });
  return response;
}

describe("face model network boundary", () => {
  it("allows only the exact external model GET and strips caller data", async () => {
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const restricted = createRestrictedWorkerFetch(native, "https://app.example/workers/face.js");
    await restricted(FACE_MODEL.url, { headers: { "x-user-data": "must-not-leave" }, credentials: "include" });
    expect(native).toHaveBeenCalledExactlyOnceWith(FACE_MODEL.url, {
      method: "GET", cache: "force-cache", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: undefined,
    });
    native.mockClear();
    for (const [url, method] of [
      [FACE_MODEL.url, "POST"],
      [`${FACE_MODEL.url}?payload=test`, "GET"],
      ["https://storage.googleapis.com/another-model.task", "GET"],
      ["https://metrics.example/collect", "POST"],
    ]) {
      const result = await restricted(url, { method });
      expect(result.headers.get("x-local-avatar-rig-local-only")).toBe("blocked");
    }
    expect(native).not.toHaveBeenCalled();
  });

  it("rejects redirects and unexpected response locations", async () => {
    for (const redirected of [false, true]) {
      const response = modelResponse(null);
      Object.defineProperty(response, "redirected", { value: redirected });
      if (!redirected) Object.defineProperty(response, "url", { value: "https://other.example/model.task" });
      await expect(fetchVerifiedFaceModel(vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow("取得元");
    }
  });

  it("rejects HTTP errors, truncated downloads and oversized streams", async () => {
    await expect(fetchVerifiedFaceModel(vi.fn<typeof fetch>().mockResolvedValue(modelResponse(null, { status: 503 })))).rejects.toThrow("取得元");
    await expect(fetchVerifiedFaceModel(vi.fn<typeof fetch>().mockResolvedValue(modelResponse(new Uint8Array(32))))).rejects.toThrow("サイズ");
    await expect(fetchVerifiedFaceModel(vi.fn<typeof fetch>().mockResolvedValue(modelResponse(new Uint8Array(FACE_MODEL.bytes + 1))))).rejects.toThrow("許可サイズ");
  });

  it("rejects a same-length model with a different SHA-256", async () => {
    const response = modelResponse(new Uint8Array(FACE_MODEL.bytes));
    await expect(fetchVerifiedFaceModel(vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow("SHA-256");
  });
});
