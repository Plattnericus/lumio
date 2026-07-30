import rateLimit from "express-rate-limit";

// A coarse, IP-based net in front of the per-account lockout in
// authService - this is what stops one IP from hammering many usernames,
// the account lockout is what stops repeated guesses against one username.
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, try again later" },
});

export const pairingExchangeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, try again later" },
});

// Bounds argon2-hash CPU cost from repeated doomed setup attempts - this
// only ever matters for the first few minutes of a server's life.
export const setupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, try again later" },
});
