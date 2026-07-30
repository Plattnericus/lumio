import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// There is nothing to transpile or bundle - the source is already valid,
// browser-native ES modules. "Build" just means "assemble the static
// files nginx will serve" into a clean dist/ directory.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const ENTRIES = ["index.html", "src", "public"];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const entry of ENTRIES) {
  const source = path.join(ROOT, entry);
  if (fs.existsSync(source)) {
    fs.cpSync(source, path.join(DIST, entry), { recursive: true });
  }
}

console.log(`Built ${ENTRIES.join(", ")} -> dist/`);
