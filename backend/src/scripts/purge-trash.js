// For operators who prefer an external cron/systemd timer over the
// in-process setInterval in lib/trashCleanup.js. Both call the same
// purgeExpiredTrash under the hood - pick one, not both, to avoid running
// the sweep twice as often as intended (harmless since a purge is
// idempotent, just redundant work).
//
// Silence logging before importing db/index.js (which logs "database
// ready" on load) - a dynamic import, not a static one, since static
// imports are hoisted above this assignment and would run before it.
// Without this, pino's log line would land on stdout alongside the purge
// count, corrupting a cron job's clean output.
process.env.LOG_LEVEL = "silent";

const { db } = await import("../db/index.js");
const { purgeExpiredTrash } = await import("../services/uploadService.js");
const { env } = await import("../config/env.js");

const purged = await purgeExpiredTrash(env.trashRetentionDays);
process.stdout.write(`${purged}`);
db.close();
