import crypto from "node:crypto";
import { db } from "../db/index.js";
import { env } from "../config/env.js";

// Crockford-ish alphabet without 0/O/1/I so a code read off a tiny watch
// screen and typed on a dashboard (or vice versa) isn't ambiguous.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

const insertCode = db.prepare(
  "INSERT INTO pairing_codes (code, user_id, expires_at) VALUES (?, ?, ?)"
);
const getCode = db.prepare("SELECT * FROM pairing_codes WHERE code = ?");
const consumeCode = db.prepare(
  "UPDATE pairing_codes SET consumed_at = ? WHERE code = ?"
);
const insertToken = db.prepare(
  "INSERT INTO device_tokens (user_id, token_hash, label) VALUES (?, ?, ?) RETURNING id"
);
const getTokenByHash = db.prepare("SELECT * FROM device_tokens WHERE token_hash = ?");
const touchToken = db.prepare("UPDATE device_tokens SET last_used_at = ? WHERE id = ?");

function randomCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function createPairingCode(userId) {
  const code = randomCode();
  const expiresAt = Math.floor(Date.now() / 1000) + env.pairingCodeTtlMinutes * 60;
  insertCode.run(code, userId, expiresAt);
  return { code, expiresAt };
}

export function exchangePairingCode(code) {
  const row = getCode.get(code);
  const now = Math.floor(Date.now() / 1000);

  if (!row || row.consumed_at || row.expires_at < now) {
    return null;
  }

  consumeCode.run(now, code);

  const rawToken = crypto.randomBytes(32).toString("base64url");
  insertToken.get(row.user_id, hashToken(rawToken), "Garmin");

  return rawToken;
}

export function resolveDeviceToken(rawToken) {
  const row = getTokenByHash.get(hashToken(rawToken));
  if (!row) return null;
  touchToken.run(Math.floor(Date.now() / 1000), row.id);
  return row.user_id;
}
