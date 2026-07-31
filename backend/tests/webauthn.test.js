import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// A real WebAuthn ceremony needs an actual authenticator cryptographically
// signing a challenge - that can't be faked in CI without reimplementing
// CBOR/COSE/attestation parsing ourselves. generateRegistrationOptions and
// generateAuthenticationOptions stay real (so challenges/exclusion lists
// are genuine), only the two verify* functions - the ones that would
// otherwise require a real signature - are stubbed to return canned
// success/failure. Everything else here (challenge storage/clearing,
// credential-ID lookup, counter/timestamp updates, CSRF/rate-limit
// placement, the 2FA bypass) is real route/service code under test.
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  };
});

import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";

let app;
let tmpDir;
let db;
let authService;

let ownerAgent;
let ownerCsrf;
let strangerAgent;
let strangerCsrf;
let totpAgent;
let totpCsrf;

const PASSWORD = "correct-horse-battery-staple";

// loginRateLimit (limit: 20 per 15-minute window) is a single shared
// middleware instance covering /login, /login/totp, and both new
// webauthn/login/* routes - every request through any of them counts
// against the same budget for this file's lifetime. Tests below log each
// user in exactly once via a shared agent (same convention as
// trash.test.js's ownerAgent/ownerCsrf) and consolidate the unauthenticated
// webauthn-login tests to stay comfortably under that shared limit.
const CRED_A = "fake-credential-id-AAA";
const CRED_B = "fake-credential-id-BBB";
const CRED_TOTP = "fake-credential-id-totp-user";

function registrationSuccess(credentialId, counter = 0) {
  return {
    verified: true,
    registrationInfo: {
      credential: {
        id: credentialId,
        publicKey: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        counter,
      },
    },
  };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-webauthn-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = "http://localhost:5173";

  const { createAccount } = await import("../src/services/authService.js");
  authService = await import("../src/services/authService.js");
  ({ db } = await import("../src/db/index.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();

  await createAccount("owner", PASSWORD);
  await createAccount("stranger", PASSWORD);
  // Registered as a passkey holder *before* totp_enabled is switched on
  // below (see the last describe block) - register/* needs a session, and
  // this account has no TOTP enrolled yet at this point in setup.
  await createAccount("totpuser", PASSWORD);

  ownerAgent = request.agent(app);
  ({ body: { csrfToken: ownerCsrf } } = await ownerAgent.post("/api/auth/login").send({ username: "owner", password: PASSWORD }));

  strangerAgent = request.agent(app);
  ({ body: { csrfToken: strangerCsrf } } = await strangerAgent
    .post("/api/auth/login")
    .send({ username: "stranger", password: PASSWORD }));

  totpAgent = request.agent(app);
  ({ body: { csrfToken: totpCsrf } } = await totpAgent
    .post("/api/auth/login")
    .send({ username: "totpuser", password: PASSWORD }));
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function credentialRow(credentialId) {
  return db.prepare("SELECT * FROM webauthn_credentials WHERE credential_id = ?").get(credentialId);
}

describe("passkey registration (logged in only)", () => {
  it("rejects register/options and register/verify without a session", async () => {
    const optionsRes = await request(app).post("/api/auth/webauthn/register/options").send({});
    expect(optionsRes.status).toBe(401);

    const verifyRes = await request(app).post("/api/auth/webauthn/register/verify").send({});
    expect(verifyRes.status).toBe(401);
  });

  it("rejects both without a CSRF token, even with a valid session", async () => {
    const optionsRes = await ownerAgent.post("/api/auth/webauthn/register/options").send({});
    expect(optionsRes.status).toBe(403);

    const verifyRes = await ownerAgent.post("/api/auth/webauthn/register/verify").send({});
    expect(verifyRes.status).toBe(403);
  });

  it("register/options returns discoverable-credential settings and an empty exclude list for a fresh user", async () => {
    const res = await ownerAgent.post("/api/auth/webauthn/register/options").set("X-CSRF-Token", ownerCsrf).send({});

    expect(res.status).toBe(200);
    expect(typeof res.body.challenge).toBe("string");
    // residentKey: "required" is what makes the credential discoverable/
    // usernameless at login time - the crux of the whole feature.
    expect(res.body.authenticatorSelection.residentKey).toBe("required");
    expect(res.body.excludeCredentials).toEqual([]);
  });

  it("register/verify stores the verified credential, clears the challenge, and can't be replayed", async () => {
    const optionsRes = await ownerAgent
      .post("/api/auth/webauthn/register/options")
      .set("X-CSRF-Token", ownerCsrf)
      .send({});
    const expectedChallenge = optionsRes.body.challenge;

    verifyRegistrationResponse.mockResolvedValueOnce(registrationSuccess(CRED_A));

    const verifyRes = await ownerAgent
      .post("/api/auth/webauthn/register/verify")
      .set("X-CSRF-Token", ownerCsrf)
      .send({ deviceLabel: "Test Key", id: "whatever-the-browser-sent", type: "public-key", response: {} });

    expect(verifyRes.status).toBe(201);
    expect(verifyRegistrationResponse).toHaveBeenCalledTimes(1);
    const passedOptions = verifyRegistrationResponse.mock.calls[0][0];
    expect(passedOptions.expectedChallenge).toBe(expectedChallenge);
    expect(passedOptions.expectedOrigin).toBe("http://localhost:5173");
    expect(passedOptions.expectedRPID).toBe("localhost");
    // deviceLabel is our own addition to the wire body, not part of a real
    // RegistrationResponseJSON - confirm it never leaks into the object
    // handed to the verification library.
    expect(passedOptions.response.deviceLabel).toBeUndefined();

    const stored = credentialRow(CRED_A);
    expect(stored).toBeTruthy();
    expect(stored.device_label).toBe("Test Key");
    expect(stored.counter).toBe(0);

    // The challenge was consumed by the call above - calling verify again
    // with no fresh register/options call must fail, not silently reuse it.
    const replayRes = await ownerAgent
      .post("/api/auth/webauthn/register/verify")
      .set("X-CSRF-Token", ownerCsrf)
      .send({ id: "another-attempt" });
    expect(replayRes.status).toBe(400);
    expect(verifyRegistrationResponse).toHaveBeenCalledTimes(1);
  });

  it("a failed verification is reported as 400 and stores nothing", async () => {
    await ownerAgent.post("/api/auth/webauthn/register/options").set("X-CSRF-Token", ownerCsrf).send({});

    verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });

    const verifyRes = await ownerAgent
      .post("/api/auth/webauthn/register/verify")
      .set("X-CSRF-Token", ownerCsrf)
      .send({ id: "doesnt-matter" });

    expect(verifyRes.status).toBe(400);
    expect(credentialRow("doesnt-matter")).toBeUndefined();
  });

  it("a subsequent options call excludes the already-registered credential", async () => {
    const res = await ownerAgent.post("/api/auth/webauthn/register/options").set("X-CSRF-Token", ownerCsrf).send({});
    expect(res.body.excludeCredentials.map((c) => c.id)).toContain(CRED_A);
  });

  it("GET /credentials lists device label and timestamps, never the credential ID or public key", async () => {
    const res = await ownerAgent.get("/api/auth/webauthn/credentials");

    expect(res.status).toBe(200);
    const entry = res.body.find((c) => c.deviceLabel === "Test Key");
    expect(entry).toBeTruthy();
    expect(typeof entry.id).toBe("number");
    expect(typeof entry.createdAt).toBe("number");
    expect(entry.credentialId).toBeUndefined();
    expect(entry.publicKey).toBeUndefined();
  });

  it("DELETE /credentials/:id 404s for another user's credential, succeeds for the owner", async () => {
    // A second, disposable credential so this deletion doesn't remove
    // CRED_A, which earlier tests in this describe block already depend on.
    await ownerAgent.post("/api/auth/webauthn/register/options").set("X-CSRF-Token", ownerCsrf).send({});
    verifyRegistrationResponse.mockResolvedValueOnce(registrationSuccess(CRED_B));
    await ownerAgent
      .post("/api/auth/webauthn/register/verify")
      .set("X-CSRF-Token", ownerCsrf)
      .send({ id: "whatever" });

    const rowId = credentialRow(CRED_B).id;

    const strangerDelete = await strangerAgent
      .delete(`/api/auth/webauthn/credentials/${rowId}`)
      .set("X-CSRF-Token", strangerCsrf);
    expect(strangerDelete.status).toBe(404);
    expect(credentialRow(CRED_B)).toBeTruthy();

    const ownerDelete = await ownerAgent
      .delete(`/api/auth/webauthn/credentials/${rowId}`)
      .set("X-CSRF-Token", ownerCsrf);
    expect(ownerDelete.status).toBe(204);
    expect(credentialRow(CRED_B)).toBeUndefined();

    const again = await ownerAgent
      .delete(`/api/auth/webauthn/credentials/${rowId}`)
      .set("X-CSRF-Token", ownerCsrf);
    expect(again.status).toBe(404);
  });
});

describe("usernameless passkey login (no session yet)", () => {
  it("login/options omits allowCredentials entirely and carries rate-limit headers", async () => {
    const res = await request(app).post("/api/auth/webauthn/login/options").send({});

    expect(res.status).toBe(200);
    expect(res.body.allowCredentials).toBeUndefined();
    expect(typeof res.body.challenge).toBe("string");
    expect(typeof res.body.challengeId).toBe("string");

    // Confirms loginRateLimit (the exact same limiter /login and
    // /login/totp use) is actually wired to this route, without needing
    // to fire 20+ requests to trip the limit itself.
    const hasRateLimitHeader = Object.keys(res.headers).some((h) => h.toLowerCase().includes("ratelimit"));
    expect(hasRateLimitHeader).toBe(true);
  });

  it("rejects a missing challengeId as a generic 401 - never a CSRF 403 - before any credential lookup", async () => {
    // No X-CSRF-Token header and no prior /login/options call: this route
    // has no session to check a CSRF token against (same precedent as
    // /login), so the only possible rejection here is the generic 401.
    const res = await request(app).post("/api/auth/webauthn/login/verify").send({ id: "whatever" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Passkey login failed");
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("an unrecognized credential ID gets the same generic 401 without ever calling the verifier", async () => {
    const optionsRes = await request(app).post("/api/auth/webauthn/login/options").send({});

    const res = await request(app)
      .post("/api/auth/webauthn/login/verify")
      .send({ challengeId: optionsRes.body.challengeId, id: "no-such-credential" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Passkey login failed");
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("a recognized credential that fails verification (e.g. bad/replayed counter) surfaces as 401, not 500", async () => {
    const optionsRes = await request(app).post("/api/auth/webauthn/login/options").send({});

    // The library reports a replayed/regressed counter by throwing rather
    // than resolving verified: false - the route must catch that too.
    verifyAuthenticationResponse.mockRejectedValueOnce(new Error("counter regressed"));

    const res = await request(app)
      .post("/api/auth/webauthn/login/verify")
      .send({ challengeId: optionsRes.body.challengeId, id: CRED_A });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Passkey login failed");
  });

  it("a verified credential logs the owning user in, updates counter/last_used_at, issues a session, and can't be replayed", async () => {
    const before = credentialRow(CRED_A);
    expect(before.last_used_at).toBeNull();

    const optionsRes = await request(app).post("/api/auth/webauthn/login/options").send({});

    verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    });

    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/webauthn/login/verify")
      .send({ challengeId: optionsRes.body.challengeId, id: CRED_A });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("owner");
    expect(res.body.role).toBe("user");
    expect(typeof res.body.csrfToken).toBe("string");
    expect(res.headers["set-cookie"]).toBeDefined();

    const after = credentialRow(CRED_A);
    expect(after.counter).toBe(7);
    expect(typeof after.last_used_at).toBe("number");

    // The session issued above is real and immediately usable.
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("owner");

    // Same challengeId, already consumed by the call above - a second
    // attempt must fail rather than accept a replay.
    const replay = await request(app)
      .post("/api/auth/webauthn/login/verify")
      .send({ challengeId: optionsRes.body.challengeId, id: CRED_A });
    expect(replay.status).toBe(401);
  });
});

describe("passkey login bypasses TOTP even when totp_enabled is set", () => {
  beforeAll(async () => {
    // totpAgent logged in above while totpuser still had no TOTP enrolled,
    // so register/* (which just needs *a* session) works normally here.
    // totp_enabled is only switched on afterward, directly in the DB - the
    // same "hand-shape a row" technique migration.test.js and
    // trash.test.js already use - rather than driving a real TOTP
    // enrollment ceremony through the API.
    await totpAgent.post("/api/auth/webauthn/register/options").set("X-CSRF-Token", totpCsrf).send({});
    verifyRegistrationResponse.mockResolvedValueOnce(registrationSuccess(CRED_TOTP));
    await totpAgent.post("/api/auth/webauthn/register/verify").set("X-CSRF-Token", totpCsrf).send({ id: "whatever" });

    db.prepare("UPDATE users SET totp_enabled = 1, totp_secret = ? WHERE username = ?").run(
      "not-a-real-secret",
      "totpuser"
    );
  });

  it("password login for this user now requires TOTP (sanity check on the setup above)", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/login").send({ username: "totpuser", password: PASSWORD });
    expect(res.body.totpRequired).toBe(true);
  });

  it("passkey login fully authenticates in one step - no totpRequired, no TOTP check reached", async () => {
    const totpSpy = vi.spyOn(authService, "verifyTotpToken");

    const optionsRes = await request(app).post("/api/auth/webauthn/login/options").send({});
    verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/webauthn/login/verify")
      .send({ challengeId: optionsRes.body.challengeId, id: CRED_TOTP });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("totpuser");
    expect(res.body.totpRequired).toBeUndefined();
    expect(typeof res.body.csrfToken).toBe("string");
    expect(totpSpy).not.toHaveBeenCalled();

    // Fully logged in already - no pending TOTP step stands between this
    // and a normal authenticated request.
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("totpuser");
    expect(me.body.totpEnabled).toBe(true);

    totpSpy.mockRestore();
  });
});
