import { Router } from "express";
import { db } from "../db/index.js";

export const healthRouter = Router();

healthRouter.get("/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", uptime: process.uptime() });
  } catch (err) {
    req.log?.error({ err }, "health check failed");
    res.status(503).json({ status: "error" });
  }
});
