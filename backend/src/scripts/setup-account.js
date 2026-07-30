import readline from "node:readline";
import { db } from "../db/index.js";
import { createAccount } from "../services/authService.js";

// No open registration by design - this is the only way an account gets
// created, and it refuses to run twice unless you explicitly mean it to.
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
      "An account already exists. Re-run with --force to replace it (this deletes the existing one)."
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

  await createAccount(username, password);
  console.log(`Account "${username}" created.`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
