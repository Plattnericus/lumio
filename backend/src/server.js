import http from "node:http";
import { createApp } from "./app.js";
import { db } from "./db/index.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { ensureSetupToken } from "./services/setupTokenService.js";

ensureSetupToken();

const app = createApp();
const server = http.createServer(app);

// Bind to loopback only - nginx is the only thing that should ever reach
// this process, on the same host.
server.listen(env.port, "127.0.0.1", () => {
  logger.info({ port: env.port }, "lumio backend listening");
});

const SHUTDOWN_TIMEOUT_MS = 10_000;

function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  const forceExit = setTimeout(() => {
    logger.warn("shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  server.close(() => {
    clearTimeout(forceExit);
    db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
