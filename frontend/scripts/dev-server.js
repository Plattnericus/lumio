import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// No bundler: the browser loads native ES modules directly. This server
// only exists to (a) serve those files with correct mime types and (b)
// proxy /api/* to the backend so the dev origin matches prod - same-origin
// cookies, no CORS setup to maintain in two places.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5173);
const API_TARGET = process.env.API_TARGET || "http://127.0.0.1:3000";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(req, res) {
  let filePath = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (req.url === "/" || req.url.startsWith("/?")) filePath = path.join(ROOT, "index.html");

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Anything unresolved falls back to index.html - there's no client
      // router yet, but this keeps a hard refresh on a deep link working
      // once there is one.
      fs.readFile(path.join(ROOT, "index.html"), (fallbackErr, fallbackData) => {
        if (fallbackErr) {
          res.writeHead(404).end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] }).end(fallbackData);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function proxyToApi(req, res) {
  const target = new URL(req.url, API_TARGET);
  const proxyReq = http.request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Backend unreachable: ${err.message}` }));
  });
  req.pipe(proxyReq);
}

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      proxyToApi(req, res);
    } else {
      serveStatic(req, res);
    }
  })
  .listen(PORT, () => {
    console.log(`Lumio frontend dev server on http://127.0.0.1:${PORT}`);
    console.log(`Proxying /api/* to ${API_TARGET}`);
  });
