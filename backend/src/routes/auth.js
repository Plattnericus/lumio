import argon2 from "argon2";
import { Router } from "express";
import {
  attemptLogin,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  getUser,
  verifyTotpToken,
} from "../services/authService.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { loginRateLimit } from "../middleware/loginRateLimit.js";
import { issueSession } from "../lib/session.js";
import { SESSION_COOKIE_NAME } from "../constants.js";

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
