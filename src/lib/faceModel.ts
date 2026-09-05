export const FACE_MODEL = {
  url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  bytes: 3_758_596,
  sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
} as const;

export function createRestrictedWorkerFetch(nativeFetch: typeof fetch, workerUrl: string): typeof fetch {
  const origin = new URL(workerUrl).origin;
  return (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl, workerUrl);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.href === FACE_MODEL.url && method === "GET") {
      // Ignore caller-supplied headers, credentials and referrers for the sole external endpoint.
      return nativeFetch(FACE_MODEL.url, {
        method: "GET",
        cache: "force-cache",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: init?.signal,
      });
    }
    if (url.origin === origin || url.protocol === "blob:" || url.protocol === "data:") {
      return nativeFetch(input, { ...init, redirect: "error" });
    }
    return Promise.resolve(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "x-local-avatar-rig-local-only": "blocked" },
    }));
  };
}

export async function fetchVerifiedFaceModel(fetcher: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 30_000);
  try {
    const response = await fetcher(FACE_MODEL.url, {
      method: "GET",
      cache: "force-cache",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: abort.signal,
    });
    if (!response.ok || response.url !== FACE_MODEL.url || response.redirected) {
      throw new Error("顔追従モデルの取得元を確認できませんでした。");
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) !== FACE_MODEL.bytes) {
      throw new Error("顔追従モデルのサイズが検証値と一致しません。");
    }
    if (!response.body) throw new Error("顔追従モデルが空です。");
    const reader = response.body.getReader();
    const bytes = new Uint8Array(FACE_MODEL.bytes);
    let offset = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (offset + value.length > FACE_MODEL.bytes) {
          throw new Error("顔追従モデルが許可サイズを超えました。");
        }
        bytes.set(value, offset);
        offset += value.length;
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (offset !== FACE_MODEL.bytes) throw new Error("顔追従モデルのサイズが検証値と一致しません。");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== FACE_MODEL.sha256) throw new Error("顔追従モデルのSHA-256が検証値と一致しません。");
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}
