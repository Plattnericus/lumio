import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

let app;
let tmpDir;
let createAccount;
let db;
let SESSION_COOKIE_NAME;

const USERNAME = "roller";
const PASSWORD = "correct-horse-battery-staple";

// The session cookie's value looks like `s:<sid>.<hmac-signature>` before
// URL-encoding (see express-session/cookie-signature). Pulling the sid back
// out doesn't need the secret - the signature just proves authenticity, it
// doesn't hide the id - so a plain string split is enough to look the row
// up directly in better-sqlite3-session-store's own `sessions` table.
function parseSessionCookie(setCookieHeaders) {
  const raw = setCookieHeaders.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  expect(raw).toBeDefined();

  const [nameValue, ...attrs] = raw.split("; ");
  const rawValue = decodeURIComponent(nameValue.split("=").slice(1).join("="));
  const sid = rawValue.replace(/^s:/, "").split(".")[0];

  const expiresAttr = attrs.find((a) => a.toLowerCase().startsWith("expires="));
  expect(expiresAttr).toBeDefined();
  const expires = expiresAttr.slice(expiresAttr.indexOf("=") + 1);

  return { sid, expires };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-session-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");
  process.env.LOGIN_RATE_LIMIT_MAX = "5";
  process.env.LOGIN_LOCKOUT_MINUTES = "15";

  ({ createAccount } = await import("../src/services/authService.js"));
  ({ db } = await import("../src/db/index.js"));
  ({ SESSION_COOKIE_NAME } = await import("../src/constants.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();

  await createAccount(USERNAME, PASSWORD);
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("rolling session (stay logged in)", () => {
  it("advances both the Set-Cookie Expires header and the store's persisted expire on every request", async () => {
    const agent = request.agent(app);

    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PASSWORD });
    expect(loginRes.status).toBe(200);

    const first = parseSessionCookie(loginRes.headers["set-cookie"]);
    const firstRow = db.prepare("SELECT expire FROM sessions WHERE sid = ?").get(first.sid);
    expect(firstRow).toBeDefined();

    // The Set-Cookie `Expires` attribute is an HTTP-date with 1-second
    // resolution (unlike the store's own ISO-millisecond `expire` column),
    // so a short real wait keeps this assertion meaningful rather than
    // possibly comparing two timestamps that happen to round to the same
    // second.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const secondReqRes = await agent.get("/api/auth/me");
    expect(secondReqRes.status).toBe(200);

    const second = parseSessionCookie(secondReqRes.headers["set-cookie"]);
    const secondRow = db.prepare("SELECT expire FROM sessions WHERE sid = ?").get(second.sid);
    expect(secondRow).toBeDefined();

    // Same session id throughout - rolling refreshes the expiry, it
    // doesn't rotate the session.
    expect(second.sid).toBe(first.sid);

    // Proves the *cookie* is rolling, not fixed.
    expect(new Date(second.expires).getTime()).toBeGreaterThan(new Date(first.expires).getTime());

    // Proves the fix works end-to-end: the store's own persisted `expire`
    // column moved forward too, not just the browser-facing header - this
    // is the part that actually protects an active session from the
    // periodic expired-session sweep in app.js.
    expect(new Date(secondRow.expire).getTime()).toBeGreaterThan(new Date(firstRow.expire).getTime());
  });
});
