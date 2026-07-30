import readline from "node:readline";
import { db } from "../db/index.js";
import { createAccount } from "../services/authService.js";

// SSH-only emergency/disaster-recovery tool - the primary way to create
// an account is now the first-run web setup wizard. --force is more
// dangerous than it used to be now that multiple real users (and their
// files, via ON DELETE CASCADE) can exist, so it prints exactly how much
// it's about to destroy and requires typing a real confirmation phrase
// rather than just accepting the flag.
//
// Uses the readline async-iterator interface rather than the classic
// question() callback API: with question(), several lines delivered in one
// stdin chunk can resolve only the first pending question and silently
// drop the rest (no listener is attached for a 'line' event that arrives
// with no question pending). Iterating the interface queues lines
// correctly regardless of timing.

async function main() {
  const force = process.argv.includes("--force");
  const existing = db.prepare("SELECT COUNT(*) as count FROM users").get();

  if (existing.count > 0 && !force) {
    console.error(
      "An account already exists. Re-run with --force to replace it (this deletes every existing account and all of their files)."
    );
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();

  async function ask(question, { hidden = false } = {}) {
    process.stdout.write(question);

    const defaultWriter = rl._writeToOutput;
    if (hidden) {
      rl._writeToOutput = (str) => {
        if (str.includes("\n")) rl.output.write("\n");
      };
    }

    const { value, done } = await lines.next();
    rl._writeToOutput = defaultWriter;
    if (hidden) process.stdout.write("\n");

    return done ? "" : value.trim();
  }

  if (existing.count > 0) {
    const fileCount = db.prepare("SELECT COUNT(*) as count FROM files").get().count;
    console.error(
      `WARNING: this will permanently delete ${existing.count} account(s) and ${fileCount} file(s). This cannot be undone.`
    );
    const confirmation = await ask('Type "DELETE ALL" to continue: ');
    if (confirmation !== "DELETE ALL") {
      console.error("Confirmation did not match - nothing was deleted.");
      rl.close();
      process.exit(1);
    }
  }

  const username = await ask("Username: ");
  const password = await ask("Password: ", { hidden: true });
  const confirm = await ask("Confirm password: ", { hidden: true });
  rl.close();

  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }
  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }

  if (existing.count > 0) {
    db.prepare("DELETE FROM users").run();
  }

  await createAccount(username, password, "admin");
  console.log(`Account "${username}" created as admin.`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
