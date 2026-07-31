import { purgeExpiredTrash } from "../services/uploadService.js";
import { env } from "../config/env.js";
import { logger } from "../logger.js";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Runs once immediately (so anything that expired while the server was
// down gets swept without waiting up to 6h), then on a recurring interval
// for the rest of the process's life. Operators who prefer an external
// cron/systemd timer instead of this in-process interval can use
// scripts/purge-trash.js, which calls the same purgeExpiredTrash directly.
export function startTrashCleanupSchedule() {
  const sweep = async () => {
    try {
      const purged = await purgeExpiredTrash(env.trashRetentionDays);
      if (purged > 0) {
        logger.info({ purged }, "purged expired trash");
      }
    } catch (err) {
      logger.error({ err }, "trash cleanup sweep failed");
    }
  };

  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS);
}
