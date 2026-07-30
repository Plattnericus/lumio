const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Synchronizer token pattern: the token lives in the server-side session
// (not just a cookie), so an attacker can't set their own matching pair the
// way they could with a plain double-submit cookie.
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const provided = req.get("X-CSRF-Token");
  if (!req.session.csrfToken || provided !== req.session.csrfToken) {
    return res.status(403).json({ error: "Invalid or missing CSRF token" });
  }

  next();
}
