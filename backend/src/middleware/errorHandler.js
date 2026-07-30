import { isProduction } from "../config/env.js";
import { logger } from "../logger.js";
import { RejectedUploadError } from "../services/uploadService.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "Not found" });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || (err instanceof RejectedUploadError ? 415 : 500) || 500;

  if (status >= 500) {
    logger.error({ err, path: req.path }, "unhandled error");
  }

  res.status(status).json({
    error: status >= 500 && isProduction ? "Internal server error" : err.message,
  });
}
