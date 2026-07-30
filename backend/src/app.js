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
import { filesRouter } from "./routes/files.js";
import { pairingRouter } from "./routes/pairing.js";
import { garminRouter } from "./routes/garmin.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

const SqliteStore = createSqliteStore(session);

export function createApp() {
  const app = express();

  // Sits behind nginx, which sits behind the VPS's own reverse proxy chain -
  // needed so secure cookies and rate-limit keys see the real client IP.
  if (isProduction) {
    app.set("trust proxy", 1);
  }

  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      autoLogging: !isProduction,
      // pino-http's default req serializer logs the raw socket address,
      // which behind nginx is just nginx's own loopback IP - not useful
      // for fail2ban or anything else that needs the real client. req.ip
      // is Express's trust-proxy-aware value instead.
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
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/files", filesRouter);
  app.use("/api/pairing", pairingRouter);
  app.use("/api/garmin", garminRouter);

  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return app;
}
