import argon2 from "argon2";
import { Router } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import {
  attemptLogin,
  beginTotpEnrollment,
  changePassword,
  confirmTotpEnrollment,
  disableTotp,
  getUser,
  validateCredentials,
  verifyTotpToken,
} from "../services/authService.js";
import {
  consumeLoginChallenge,
  deleteCredential,
  findCredentialByCredentialId,
  listCredentialIds,
  listCredentialsForUser,
  saveCredential,
  stashLoginChallenge,
  touchCredential,
} from "../services/webauthnService.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { loginRateLimit } from "../middleware/loginRateLimit.js";
import { issueSession } from "../lib/session.js";
import { SESSION_COOKIE_NAME } from "../constants.js";
import { env } from "../config/env.js";

export const authRouter = Router();

authRouter.post("/login", loginRateLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Username and password required" });
    }

    const result = await attemptLogin(username, password);

    if (result.status === "invalid") {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (result.status === "locked") {
      return res.status(429).json({ error: "Too many attempts, try again later" });
    }
    if (result.status === "totp_required") {
      req.session.pendingTotpUserId = result.user.id;
      // Duo Security plug-in point (not built - needs the user's own paid
      // Duo account credentials, which don't exist yet, see env.js). Once
      // those exist, a hypothetical per-user "duo enrolled" flag would let
      // this branch redirect the client into Duo's hosted auth flow
      // (built from env.duoIntegrationKey/duoSecretKey/duoApiHostname)
      // instead of, or in addition to, the TOTP prompt below - issueSession
      // would only run after Duo's own callback verifies the factor, same
      // as TOTP below only runs after verifyTotpToken succeeds.
      return res.json({ totpRequired: true });
    }

    await issueSession(req, result.user);
    res.json({ username: result.user.username, role: result.user.role, csrfToken: req.session.csrfToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login/totp", loginRateLimit, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const pendingUserId = req.session.pendingTotpUserId;
    if (!pendingUserId || typeof token !== "string") {
      return res.status(400).json({ error: "No pending login" });
    }

    const user = getUser(pendingUserId);
    const valid = user && (await verifyTotpToken(user, token));
    if (!valid) {
      return res.status(401).json({ error: "Invalid code" });
    }

    await issueSession(req, user);
    res.json({ username: user.username, role: user.role, csrfToken: req.session.csrfToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireAuth, csrfProtection, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ ok: true });
  });
});

authRouter.get("/me", requireAuth, (req, res) => {
  const user = getUser(req.session.userId);
  res.json({
    username: user.username,
    role: user.role,
    totpEnabled: Boolean(user.totp_enabled),
    csrfToken: req.session.csrfToken,
  });
});

authRouter.post("/totp/setup", requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const user = getUser(req.session.userId);
    const { secret, otpauthUri } = await beginTotpEnrollment(user.username);
    req.session.pendingTotpSecret = secret;
    res.json({ secret, otpauthUri });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/totp/confirm", requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const secret = req.session.pendingTotpSecret;
    if (!secret || typeof token !== "string") {
      return res.status(400).json({ error: "No pending TOTP enrollment" });
    }

    const confirmed = await confirmTotpEnrollment(req.session.userId, secret, token);
    if (!confirmed) {
      return res.status(401).json({ error: "Invalid code" });
    }

    delete req.session.pendingTotpSecret;
    res.json({ enabled: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/totp/disable", requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    const user = getUser(req.session.userId);
    const valid = typeof password === "string" && (await argon2.verify(user.password_hash, password));
    if (!valid) {
      return res.status(401).json({ error: "Invalid password" });
    }
    disableTotp(user.id);
    res.json({ enabled: false });
  } catch (err) {
    next(err);
  }
});

// An admin sets a new user's initial password directly - this is the
// only way that account can ever change it afterward.
authRouter.post("/password", requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const user = getUser(req.session.userId);
    const valid =
      typeof currentPassword === "string" && (await argon2.verify(user.password_hash, currentPassword));
    if (!valid) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const validationError = validateCredentials(user.username, newPassword);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    await changePassword(user.id, newPassword);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- WebAuthn passkeys ---
//
// Registration (below) requires an existing session - a passkey is added
// to an already-logged-in account from Account settings, never used to
// create one. Login (further below) is the opposite: it has no session
// at all, by design - that's what makes it usernameless.

authRouter.post("/webauthn/register/options", requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const user = getUser(req.session.userId);
    const options = await generateRegistrationOptions({
      rpName: env.webauthnRpName,
      rpID: env.webauthnRpId,
      userName: user.username,
      // A stable, non-random handle derived from the real user id (rather
      // than letting the library default to a random one) so
      // excludeCredentials keeps working the same way across repeated
      // registration ceremonies for the same account.
      userID: isoUint8Array.fromUTF8String(String(user.id)),
      attestationType: "none",
      excludeCredentials: listCredentialIds(user.id).map((credentialId) => ({ id: credentialId })),
      // residentKey: "required" is what makes the resulting credential
      // discoverable/usernameless - the browser/OS can offer it up at
      // login time with no username typed first.
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });

    // Mirrors how /totp/setup stashes pendingTotpSecret - short-lived
    // server-side state for a ceremony that isn't done yet, cleared by
    // register/verify below whether it succeeds or fails.
    req.session.pendingWebauthnChallenge = options.challenge;
    res.json(options);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/webauthn/register/verify", requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const expectedChallenge = req.session.pendingWebauthnChallenge;
    if (!expectedChallenge) {
      return res.status(400).json({ error: "No pending passkey registration" });
    }
    delete req.session.pendingWebauthnChallenge;

    // deviceLabel is our own addition, not part of the browser's
    // RegistrationResponseJSON - verifyRegistrationResponse only ever
    // reads the fields it knows about, so passing the rest through as
    // `response` is safe even with this extra sibling key present.
    const { deviceLabel, ...response } = req.body || {};

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: env.webauthnOrigin,
        expectedRPID: env.webauthnRpId,
      });
    } catch {
      verification = { verified: false };
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Passkey registration could not be verified" });
    }

    const { credential } = verification.registrationInfo;
    saveCredential({
      userId: req.session.userId,
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      deviceLabel: typeof deviceLabel === "string" ? deviceLabel.slice(0, 100) : null,
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/webauthn/credentials", requireAuth, (req, res) => {
  res.json(listCredentialsForUser(req.session.userId));
});

authRouter.delete("/webauthn/credentials/:id", requireAuth, csrfProtection, (req, res) => {
  const deleted = deleteCredential(Number(req.params.id), req.session.userId);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// Usernameless (discoverable-credential) login: no session exists yet,
// same loginRateLimit as /login and no csrfProtection, same precedent as
// /login and /setup - there's no session/CSRF token yet to check one
// against.
authRouter.post("/webauthn/login/options", loginRateLimit, async (req, res, next) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: env.webauthnRpId,
      // allowCredentials is deliberately omitted - that's what lets the
      // browser/OS surface any discoverable passkey registered for this
      // site without the user ever typing a username first.
      userVerification: "preferred",
    });

    stashLoginChallenge(options.challenge);
    // challengeId round-trips back on login/verify so this request (which
    // has nowhere else to keep state - see webauthnService.js's comment
    // on why an in-memory map replaces req.session here) can be matched
    // back to its own challenge.
    res.json({ ...options, challengeId: options.challenge });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/webauthn/login/verify", loginRateLimit, async (req, res, next) => {
  try {
    const { challengeId, ...response } = req.body || {};
    if (typeof challengeId !== "string" || !consumeLoginChallenge(challengeId)) {
      return res.status(401).json({ error: "Passkey login failed" });
    }

    // This is how the server learns *who* is authenticating - no username
    // was ever collected. Same generic-error spirit as attemptLogin's
    // dummy-hash timing defense: an unrecognized credential ID gets the
    // exact same response as a recognized one that fails verification,
    // never a distinguishable error.
    const credentialRow = typeof response.id === "string" ? findCredentialByCredentialId(response.id) : null;
    if (!credentialRow) {
      return res.status(401).json({ error: "Passkey login failed" });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeId,
        expectedOrigin: env.webauthnOrigin,
        expectedRPID: env.webauthnRpId,
        credential: {
          id: credentialRow.credential_id,
          publicKey: isoBase64URL.toBuffer(credentialRow.public_key),
          counter: credentialRow.counter,
        },
      });
    } catch {
      // Covers a bad/replayed counter, which the library reports by
      // throwing rather than returning verified: false - either way this
      // surfaces as the same generic 401, never a 500.
      verification = { verified: false };
    }

    if (!verification.verified) {
      return res.status(401).json({ error: "Passkey login failed" });
    }

    touchCredential(credentialRow.id, verification.authenticationInfo.newCounter);

    const user = getUser(credentialRow.user_id);

    // Deliberately skips the totp_required branch /login takes above - a
    // passkey ceremony already asserts possession of the authenticator
    // plus (with userVerification) a biometric/PIN check, so it stands on
    // its own as a second factor rather than needing TOTP stacked on top,
    // even for a user with totp_enabled. The password path is unchanged
    // and still gates on it.
    await issueSession(req, user);
    res.json({ username: user.username, role: user.role, csrfToken: req.session.csrfToken });
  } catch (err) {
    next(err);
  }
});
