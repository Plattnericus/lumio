import crypto from "node:crypto";
import fs from "node:fs";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { hasAnyUsers } from "./authService.js";

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

// Called once at server startup. A browser-based setup wizard would
// otherwise let whoever's request reaches POST /api/setup first become
// the permanent admin - potentially anyone scanning the public IP before
// the real operator opens their own browser. This one-time token closes
// that race: it's generated locally, readable only by the app's own
// system user, and consumed on first use.
export function ensureSetupToken() {
  if (hasAnyUsers()) {
    clearSetupToken();
    return;
  }
  if (fs.existsSync(env.setupTokenPath)) {
    return;
  }
  const token = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(env.setupTokenPath, token, { mode: 0o600 });
  logger.info({ path: env.setupTokenPath }, "generated one-time setup token");
}

export function verifyAndConsumeSetupToken(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (!fs.existsSync(env.setupTokenPath)) return false;

  const actual = fs.readFileSync(env.setupTokenPath, "utf8").trim();
  const matches = crypto.timingSafeEqual(digest(candidate), digest(actual));
  if (!matches) return false;

  clearSetupToken();
  return true;
}

export function clearSetupToken() {
  fs.rmSync(env.setupTokenPath, { force: true });
}
