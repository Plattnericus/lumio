import { Router } from "express";
import {
  addFileToAlbum,
  AlbumError,
  createAlbum,
  deleteAlbum,
  listAlbums,
  removeFileFromAlbum,
  renameAlbum,
} from "../services/albumService.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { csrfProtection } from "../middleware/csrf.js";

export const albumsRouter = Router();

albumsRouter.use(requireAuth);

function handleAlbumError(err, res, next) {
  if (err instanceof AlbumError) {
    return res.status(err.status).json({ error: err.message });
  }
  next(err);
}

function validName(name) {
  return typeof name === "string" && name.trim().length > 0;
}

albumsRouter.get("/", (req, res) => {
  res.json(listAlbums(req.session.userId));
});

albumsRouter.post("/", csrfProtection, (req, res) => {
  const { name } = req.body || {};
  if (!validName(name)) {
    return res.status(400).json({ error: "Name is required" });
  }

  const album = createAlbum(req.session.userId, name.trim());
  res.status(201).json({ id: album.id, name: album.name, createdAt: album.created_at, fileCount: 0 });
});

albumsRouter.put("/:id", csrfProtection, (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!validName(name)) {
      return res.status(400).json({ error: "Name is required" });
    }

    renameAlbum(Number(req.params.id), req.session.userId, name.trim());
    res.status(204).end();
  } catch (err) {
    handleAlbumError(err, res, next);
  }
});

// Deleting an album never touches the member files themselves - only the
// albums row and its album_files memberships (cascaded by the FK) go
// away; the files stay exactly where they were in scope=mine.
albumsRouter.delete("/:id", csrfProtection, (req, res, next) => {
  try {
    deleteAlbum(Number(req.params.id), req.session.userId);
    res.status(204).end();
  } catch (err) {
    handleAlbumError(err, res, next);
  }
});

albumsRouter.post("/:id/files", csrfProtection, (req, res, next) => {
  try {
    const fileId = Number(req.body?.fileId);
    if (!Number.isInteger(fileId)) {
      return res.status(400).json({ error: "fileId is required" });
    }

    addFileToAlbum(Number(req.params.id), fileId, req.session.userId);
    res.status(201).json({ ok: true });
  } catch (err) {
    handleAlbumError(err, res, next);
  }
});

albumsRouter.delete("/:id/files/:fileId", csrfProtection, (req, res, next) => {
  try {
    removeFileFromAlbum(Number(req.params.id), Number(req.params.fileId), req.session.userId);
    res.status(204).end();
  } catch (err) {
    handleAlbumError(err, res, next);
  }
});
