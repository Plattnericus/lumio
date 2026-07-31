import express from "express";
import helmet from "helmet";
import session from "express-session";
import createSqliteStore from "better-sqlite3-session-store";
import pinoHttp from "pino-http";
import { db } from "./db/index.js";
import { env, isProduction } from "./config/env.js";
import { logger } from "./logger.js";
import { SESSION_COOKIE_NAME } from "./constants.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { setupRouter } from "./routes/setup.js";
import { adminRouter } from "./routes/admin.js";
import { settingsRouter } from "./routes/settings.js";
import { filesRouter } from "./routes/files.js";
import { albumsRouter } from "./routes/albums.js";
import { pairingRouter } from "./routes/pairing.js";
import { garminRouter } from "./routes/garmin.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

const SqliteStore = createSqliteStore(session);

export function createApp() {
  const app = express();

  // Sits behind nginx, which sits behind the VPS's own reverse proxy chain -
  // needed so secure cookies and rate-limit keys see the real client IP.
  // A subnet list (not a hop count) so it stays correct regardless of how
  // many trusted hops are actually in front of it on a given request path.
  if (isProduction) {
    app.set("trust proxy", env.trustedProxies);
  }

  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      // Request logging needs to stay on in production - it's the whole
      // point of structured logging, and fail2ban's app-login jail reads
      // these lines to find failed attempts.
      customProps: (req) => ({ clientIp: req.ip }),
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.use(
    session({
      name: SESSION_COOKIE_NAME,
      store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900_000 } }),
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      // Rolling + a long-ish maxAge is standard "stay logged in" behavior -
      // reasonable given argon2id + TOTP/passkeys + account lockout already
      // guard the login itself. There's no "view/revoke other active
      // sessions" UI today; this doesn't add one either - that's a known,
      // pre-existing gap, not something newly introduced here. This is only
      // safe because better-sqlite3-session-store's `touch(sid, session, cb)`
      // (confirmed by reading its source) actually updates the persisted
      // `expire` column on every request, not just the Set-Cookie header -
      // otherwise the store's own 15-minute expired-session sweep above
      // could prune an active session out from under the user even while
      // the browser's cookie still looked unexpired.
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict",
        maxAge: env.sessionMaxAgeDays * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/setup", setupRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/files", filesRouter);
  app.use("/api/albums", albumsRouter);
  app.use("/api/pairing", pairingRouter);
  app.use("/api/garmin", garminRouter);

  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return app;
}
