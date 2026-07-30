import { resolveDeviceToken } from "../services/pairingService.js";

export function requireDeviceToken(req, res, next) {
  const header = req.get("Authorization") || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid device token" });
  }

  const userId = resolveDeviceToken(token);
  if (!userId) {
    return res.status(401).json({ error: "Missing or invalid device token" });
  }

  req.deviceUserId = userId;
  next();
}
