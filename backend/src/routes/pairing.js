import { Router } from "express";
import { createPairingCode, exchangePairingCode } from "../services/pairingService.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { pairingExchangeRateLimit } from "../middleware/loginRateLimit.js";

export const pairingRouter = Router();

// Authenticated: the dashboard asks for a short-lived code to show/type
// into the watch.
pairingRouter.post("/codes", requireAuth, csrfProtection, (req, res) => {
  const { code, expiresAt } = createPairingCode(req.session.userId);
  res.status(201).json({ code, expiresAt });
});

// Unauthenticated: the watch trades that code for a long-lived API token.
// Aggressively rate-limited since it has no session to lean on.
pairingRouter.post("/exchange", pairingExchangeRateLimit, (req, res) => {
  const { code } = req.body || {};
  if (typeof code !== "string") {
    return res.status(400).json({ error: "Invalid or expired code" });
  }

  const token = exchangePairingCode(code.toUpperCase());
  if (!token) {
    return res.status(400).json({ error: "Invalid or expired code" });
  }

  res.json({ token });
});
