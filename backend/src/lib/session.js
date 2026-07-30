import crypto from "node:crypto";

// The one place a session becomes "logged in" - used by every login path
// (password, TOTP-verified, first-run setup) so they can't drift apart.
export function issueSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      resolve();
    });
  });
}
