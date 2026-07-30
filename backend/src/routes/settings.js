import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { csrfProtection } from "../middleware/csrf.js";

export const settingsRouter = Router();

const getSetting = db.prepare("SELECT value FROM app_settings WHERE key = ?");
const upsertSetting = db.prepare(
  "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

settingsRouter.use(requireAuth, requireAdmin);

settingsRouter.get("/", (req, res) => {
  const row = getSetting.get("auto_update_enabled");
  res.json({ autoUpdateEnabled: row?.value === "true" });
});

settingsRouter.put("/", csrfProtection, (req, res) => {
  const { autoUpdateEnabled } = req.body || {};
  if (typeof autoUpdateEnabled !== "boolean") {
    return res.status(400).json({ error: "autoUpdateEnabled must be a boolean" });
  }
  upsertSetting.run("auto_update_enabled", String(autoUpdateEnabled));
  res.json({ autoUpdateEnabled });
});
