import { getUser } from "../services/authService.js";

// Sessions issued before this feature existed have no role in them (it's
// only set at login time, and sessions live 7 days) - self-heal that one
// case with a single DB lookup rather than forcing every existing
// session to re-login just to see the admin entry point. Every request
// after that hits the zero-DB-hit session value like requireAuth does.
export function requireAdmin(req, res, next) {
  if (req.session.role === undefined && req.session.userId) {
    const user = getUser(req.session.userId);
    req.session.role = user ? user.role : null;
  }

  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
