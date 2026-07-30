import { Router } from "express";
import {
  createInitialAdminAccount,
  findUserByUsername,
  hasAnyUsers,
  validateCredentials,
} from "../services/authService.js";
import { verifyAndConsumeSetupToken } from "../services/setupTokenService.js";
import { issueSession } from "../lib/session.js";
import { setupRateLimit } from "../middleware/loginRateLimit.js";

export const setupRouter = Router();

setupRouter.get("/status", (req, res) => {
  res.json({ needsSetup: !hasAnyUsers() });
});

// No csrfProtection: same precedent as /login and /login/totp - there is
// no session/CSRF token yet at this point, nothing to check it against.
setupRouter.post("/", setupRateLimit, async (req, res, next) => {
  try {
    // Checked first, ahead of the token: once setup is done the token
    // file is already gone, and "this is already done" is a clearer
    // answer than "your token is wrong" for what's actually a moot point.
    if (hasAnyUsers()) {
      return res.status(409).json({ error: "Setup already completed" });
    }

    const { username, password, setupToken } = req.body || {};

    // Validate credentials before touching the token: it's single-use,
    // and burning it on a request that was never going to succeed would
    // strand the operator with no way to retry.
    const validationError = validateCredentials(username, password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (!verifyAndConsumeSetupToken(setupToken)) {
      return res.status(403).json({ error: "Invalid or missing setup token" });
    }

    const created = await createInitialAdminAccount(username, password);
    if (!created) {
      // Someone else's request won the race between our two checks above.
      return res.status(409).json({ error: "Setup already completed" });
    }

    const user = findUserByUsername(username);
    await issueSession(req, user);
    res.status(201).json({ username: user.username, role: user.role, csrfToken: req.session.csrfToken });
  } catch (err) {
    next(err);
  }
});
