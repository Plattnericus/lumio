import { db } from "../db/index.js";

const insertCredentialRow = db.prepare(
  `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_label)
   VALUES (@userId, @credentialId, @publicKey, @counter, @deviceLabel)`
);
const listCredentialIdsForUser = db.prepare(
  "SELECT credential_id FROM webauthn_credentials WHERE user_id = ?"
);
const listCredentialsForUserStmt = db.prepare(
  "SELECT id, device_label, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at"
);
const getCredentialByCredentialId = db.prepare("SELECT * FROM webauthn_credentials WHERE credential_id = ?");
const deleteCredentialRow = db.prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?");
const touchCredentialRow = db.prepare(
  "UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?"
);

// Used to populate excludeCredentials on register/options, so a user can't
// register the same authenticator twice.
export function listCredentialIds(userId) {
  return listCredentialIdsForUser.all(userId).map((row) => row.credential_id);
}

// Never returns public_key or credential_id - those never need to leave
// the server once stored, and the account settings UI only ever needs
// enough to let someone recognize and remove a passkey.
export function listCredentialsForUser(userId) {
  return listCredentialsForUserStmt.all(userId).map((row) => ({
    id: row.id,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

export function saveCredential({ userId, credentialId, publicKey, counter, deviceLabel }) {
  insertCredentialRow.run({
    userId,
    credentialId,
    publicKey,
    counter,
    deviceLabel: deviceLabel || null,
  });
}

// This is how usernameless login learns *who* is authenticating: the
// browser's assertion carries the credential ID it used, never a
// username, so login/verify looks the row (and its owning user) up by
// credential_id alone.
export function findCredentialByCredentialId(credentialId) {
  return getCredentialByCredentialId.get(credentialId);
}

export function deleteCredential(id, userId) {
  const result = deleteCredentialRow.run(id, userId);
  return result.changes > 0;
}

export function touchCredential(id, counter) {
  touchCredentialRow.run(counter, Math.floor(Date.now() / 1000), id);
}

// --- Usernameless login challenge storage ---
//
// login/options and login/verify run before any session exists - that's
// the entire point of usernameless/discoverable login, the server doesn't
// know who's authenticating until the assertion comes back. That means
// there's no req.session to stash the WebAuthn challenge in, the way
// register/options and /totp/setup do with req.session.pendingWebauthn
// Challenge / pendingTotpSecret.
//
// This deliberately does NOT reuse the pairing-code table's pattern
// (a persisted, DB-backed code with its own expiry): pairing codes exist
// because a human has to read one off a dashboard and type it into a
// physical watch, which can take minutes and must survive a server
// restart in between. A WebAuthn ceremony is a single unattended
// browser round-trip that authenticators themselves expect to finish
// within the `timeout` hint generateAuthenticationOptions() sends
// (60s) - there's no scenario where it needs to outlive this process.
//
// So: a plain in-process Map, keyed by the challenge itself rather than
// a second minted nonce. The challenge is already the cryptographically
// random, single-use value generateAuthenticationOptions() produced for
// this attempt, so reusing it as the lookup key doesn't create a new
// secret and costs nothing security-wise - knowing the challenge alone
// never lets anyone forge a valid signature over it; that still requires
// the private key on the authenticator. Entries are swept both lazily
// (whenever a new one is stashed) and on lookup, so an abandoned ceremony
// can't accumulate forever. This does mean a login flow can't span a
// server restart or multiple processes - acceptable for a single-instance
// deployment like this one; a clustered deployment would need to move
// this into the database or a shared cache instead.
const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const pendingLoginChallenges = new Map();

function sweepExpiredChallenges() {
  const now = Date.now();
  for (const [challenge, expiresAt] of pendingLoginChallenges) {
    if (expiresAt < now) pendingLoginChallenges.delete(challenge);
  }
}

export function stashLoginChallenge(challenge) {
  sweepExpiredChallenges();
  pendingLoginChallenges.set(challenge, Date.now() + LOGIN_CHALLENGE_TTL_MS);
}

// Single-use: consuming removes the entry regardless of whether the
// caller goes on to verify successfully, so a rejected assertion can
// never be retried against the same challenge either.
export function consumeLoginChallenge(challenge) {
  const expiresAt = pendingLoginChallenges.get(challenge);
  pendingLoginChallenges.delete(challenge);
  return Boolean(expiresAt) && expiresAt >= Date.now();
}
