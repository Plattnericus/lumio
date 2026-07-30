import argon2 from "argon2";
import { generate, generateSecret, generateURI, verify } from "otplib";
import { db } from "../db/index.js";
import { env } from "../config/env.js";

// Verified against a dummy hash when the username doesn't exist, so a login
// attempt for a nonexistent account takes roughly the same time as one for
// a real account - otherwise response timing alone leaks which usernames
// are registered.
const DUMMY_HASH = await argon2.hash("not-a-real-password", { type: argon2.argon2id });

const getUserByUsername = db.prepare("SELECT * FROM users WHERE username = ?");
const getUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const insertUser = db.prepare(
  "INSERT INTO users (username, password_hash, role) VALUES (@username, @passwordHash, @role)"
);
const updateFailedAttempts = db.prepare(
  "UPDATE users SET failed_attempts = @failedAttempts, locked_until = @lockedUntil WHERE id = @id"
);
const resetLoginState = db.prepare(
  "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?"
);
const setTotpSecret = db.prepare(
  "UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?"
);
const clearTotp = db.prepare(
  "UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?"
);

export async function createAccount(username, password, role = "user") {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  insertUser.run({ username, passwordHash, role });
}

/**
 * @returns {{ status: "invalid" | "locked" }} | {{ status: "totp_required" | "ok", user }}
 */
export async function attemptLogin(username, password) {
  const user = getUserByUsername.get(username);

  if (!user) {
    await argon2.verify(DUMMY_HASH, password);
    return { status: "invalid" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (user.locked_until && user.locked_until > now) {
    return { status: "locked" };
  }

  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) {
    const failedAttempts = user.failed_attempts + 1;
    const lockedUntil =
      failedAttempts >= env.loginRateLimitMax
        ? now + env.loginLockoutMinutes * 60
        : null;
    updateFailedAttempts.run({ id: user.id, failedAttempts, lockedUntil });
    return { status: "invalid" };
  }

  resetLoginState.run(user.id);

  return { status: user.totp_enabled ? "totp_required" : "ok", user };
}

export async function verifyTotpToken(user, token) {
  if (!user.totp_secret) return false;
  const result = await verify({ secret: user.totp_secret, token });
  return result.valid;
}

export function getUser(id) {
  return getUserById.get(id);
}

export async function beginTotpEnrollment(username) {
  const secret = generateSecret();
  const otpauthUri = generateURI({ issuer: "Lumio", label: username, secret });
  return { secret, otpauthUri };
}

export async function confirmTotpEnrollment(userId, secret, token) {
  const result = await verify({ secret, token });
  if (!result.valid) return false;
  setTotpSecret.run(secret, userId);
  return true;
}

export function disableTotp(userId) {
  clearTotp.run(userId);
}

// Exported for tests that need a real TOTP code for a given secret.
export async function generateTotpToken(secret) {
  return generate({ secret });
}
