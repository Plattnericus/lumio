import argon2 from "argon2";
import { generate, generateSecret, generateURI, verify } from "otplib";
import { db } from "../db/index.js";
import { env } from "../config/env.js";
import { listAllOwnedFiles, unlinkFileAssets } from "./uploadService.js";

// Verified against a dummy hash when the username doesn't exist, so a login
// attempt for a nonexistent account takes roughly the same time as one for
// a real account - otherwise response timing alone leaks which usernames
// are registered.
const DUMMY_HASH = await argon2.hash("not-a-real-password", { type: argon2.argon2id });

const getUserByUsername = db.prepare("SELECT * FROM users WHERE username = ?");
const getUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const countUsers = db.prepare("SELECT COUNT(*) as count FROM users");
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
const updatePasswordHash = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
const listAllUsers = db.prepare(
  "SELECT id, username, role, totp_enabled, created_at FROM users ORDER BY created_at"
);
const countAdmins = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
const deleteUserRow = db.prepare("DELETE FROM users WHERE id = ?");

export async function createAccount(username, password, role = "user") {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  insertUser.run({ username, passwordHash, role });
}

const MIN_PASSWORD_LENGTH = 12;
// 3-32 chars, letters/digits/dot/underscore/hyphen only - rejects
// whitespace-only names, stray unicode, and anything that would be
// confusing to type back in correctly (the whole point of this check
// is that whoever's handed this username can retype it without guessing).
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

export function validateCredentials(username, password) {
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    return "Username must be 3-32 characters: letters, numbers, dots, hyphens, or underscores only";
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

// Hash first, touch the database only in one uninterrupted synchronous
// block after that - better-sqlite3 is synchronous and Node is
// single-threaded, so nothing can interleave between the count check and
// the insert. That's what actually makes this race-safe against two
// concurrent setup requests, not the db.transaction() wrapper itself
// (which is here for self-documentation - there's no async gap for it to
// protect against).
const createAdminIfNoneExists = db.transaction((username, passwordHash) => {
  if (countUsers.get().count > 0) return false;
  insertUser.run({ username, passwordHash, role: "admin" });
  return true;
});

export async function createInitialAdminAccount(username, password) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return createAdminIfNoneExists(username, passwordHash);
}

export function findUserByUsername(username) {
  return getUserByUsername.get(username);
}

export function hasAnyUsers() {
  return countUsers.get().count > 0;
}

export function listUsers() {
  return listAllUsers.all().map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    totpEnabled: Boolean(u.totp_enabled),
    createdAt: u.created_at,
  }));
}

// A server must never end up with zero admins - checked before letting
// an admin delete another admin account.
export function isLastAdmin(userId) {
  const user = getUserById.get(userId);
  return Boolean(user) && user.role === "admin" && countAdmins.get().count <= 1;
}

// ON DELETE CASCADE removes the files/shares/tokens rows, but not the
// actual bytes on disk - unlink those first, or they'd leak forever.
//
// Deliberately uses listAllOwnedFiles (unfiltered by deleted_at) rather
// than listFiles: an admin removing a user must hard-delete every owned
// file's bytes regardless of trash state. This is a documented exception
// to the soft-delete default introduced with trash - listFiles's
// deleted_at IS NULL filter would otherwise silently skip trashed files
// here, leaving their bytes orphaned on disk once the DB row vanishes via
// cascade.
export async function deleteUserAndFiles(userId) {
  for (const file of listAllOwnedFiles(userId)) {
    await unlinkFileAssets(file);
  }
  deleteUserRow.run(userId);
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

export async function changePassword(userId, newPassword) {
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  updatePasswordHash.run(passwordHash, userId);
}

// Exported for tests that need a real TOTP code for a given secret.
export async function generateTotpToken(secret) {
  return generate({ secret });
}
