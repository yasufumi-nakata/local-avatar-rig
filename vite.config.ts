import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readNoticeFiles } from "./scripts/copy-notices.mjs";
import { FACE_MODEL } from "./src/lib/faceModel.ts";

const securityHeaders = {
  "Content-Security-Policy": `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:* ${FACE_MODEL.url}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function distributionNotices(): Plugin {
  let root: string;
  return {
    name: "distribution-notices",
    configResolved(config) {
      root = config.root;
    },
    async generateBundle() {
      for (const notice of await readNoticeFiles(root)) {
        this.emitFile({ type: "asset", ...notice });
      }
    },
    async configureServer(server) {
      const notices = new Map((await readNoticeFiles(root)).map((notice) => [
        `/${notice.fileName}`,
        notice.source,
      ]));
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const notice = notices.get(pathname);
        if (!notice) return next();
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(request.method === "HEAD" ? undefined : notice);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), distributionNotices()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    // React Fast Refresh injects an inline preamble, which the strict CSP rejects.
    // Keep the same script restrictions in development; reload after source edits.
    hmr: false,
    headers: securityHeaders,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: securityHeaders,
  },
  build: {
    sourcemap: true,
  },
});
