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
