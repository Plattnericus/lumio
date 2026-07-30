// Invoked over SSH by deploy.yml, on the server itself - checking a
// setting this way means the workflow never needs the server to be
// externally HTTP-reachable, which matters since this box's public port
// isn't currently reachable from the internet at all.
//
// Silence logging before importing db/index.js (which logs "database
// ready" on load) - a dynamic import, not a static one, since static
// imports are hoisted above this assignment and would run before it.
// Without this, pino's log line and the true/false answer both land on
// stdout, corrupting the exact string comparison the caller does on it.
process.env.LOG_LEVEL = "silent";

const { db } = await import("../db/index.js");

const row = db.prepare("SELECT value FROM app_settings WHERE key = 'auto_update_enabled'").get();
process.stdout.write(row?.value === "true" ? "true" : "false");
db.close();
