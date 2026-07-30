import { Router } from "express";
import {
  createAccount,
  deleteUserAndFiles,
  isLastAdmin,
  listUsers,
  validateCredentials,
} from "../services/authService.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { csrfProtection } from "../middleware/csrf.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/users", (req, res) => {
  res.json(listUsers());
});

adminRouter.post("/users", csrfProtection, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const validationError = validateCredentials(username, password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Admin-created accounts are always plain users in this version - a
    // second admin, if ever needed, goes through the CLI script's
    // disaster-recovery path instead of an admin-creates-admin flow.
    await createAccount(username, password, "user");
    res.status(201).json({ username });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "SQLITE_CONSTRAINT") {
      return res.status(409).json({ error: "Username already exists" });
    }
    next(err);
  }
});

adminRouter.delete("/users/:id", csrfProtection, async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);

    if (targetId === req.session.userId) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    if (isLastAdmin(targetId)) {
      return res.status(400).json({ error: "Cannot delete the last admin" });
    }

    await deleteUserAndFiles(targetId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
