import path from "node:path";
import "dotenv/config";

// WEBAUTHN_RP_ID/WEBAUTHN_ORIGIN have safe dev-only defaults above
// ("localhost" / "http://localhost:5173") but no safe default in
// production - a wrong guess there would either break every passkey
// ceremony or (worse) validate against the wrong origin/RP ID.
const required = ["SESSION_SECRET", "WEBAUTHN_RP_ID", "WEBAUTHN_ORIGIN"];

function readEnv() {
  // Computed up front (rather than read back off `env.nodeEnv`, which
  // doesn't exist as a bound name until this whole object literal has
  // finished evaluating) so the WebAuthn defaults below can branch on it.
  const isProd = (process.env.NODE_ENV || "development") === "production";

  const env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 3000),
    sessionSecret: process.env.SESSION_SECRET,
    dbPath: process.env.DB_PATH || "./data/lumio.sqlite",
    uploadDir: process.env.UPLOAD_DIR || "./data/uploads",
    setupTokenPath:
      process.env.SETUP_TOKEN_PATH ||
      path.join(path.dirname(process.env.DB_PATH || "./data/lumio.sqlite"), "setup-token.txt"),
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
    loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX || 5),
    loginLockoutMinutes: Number(process.env.LOGIN_LOCKOUT_MINUTES || 15),
    pairingCodeTtlMinutes: Number(process.env.PAIRING_CODE_TTL_MINUTES || 10),
    trashRetentionDays: Number(process.env.TRASH_RETENTION_DAYS || 30),
    sessionMaxAgeDays: Number(process.env.SESSION_MAX_AGE_DAYS || 30),
    webauthnRpId: process.env.WEBAUTHN_RP_ID || (isProd ? undefined : "localhost"),
    webauthnRpName: process.env.WEBAUTHN_RP_NAME || "Lumio",
    webauthnOrigin: process.env.WEBAUTHN_ORIGIN || (isProd ? undefined : "http://localhost:5173"),
    // Reserved for a future Duo Security integration - unread by any code
    // path today. A later PR will document exactly where this plugs into
    // the login flow once real Duo account credentials exist.
    duoIntegrationKey: process.env.DUO_INTEGRATION_KEY,
    duoSecretKey: process.env.DUO_SECRET_KEY,
    duoApiHostname: process.env.DUO_API_HOSTNAME,
    // Express's trust-proxy subnets, comma-separated (accepts "loopback",
    // "linklocal", "uniquelocal", or CIDR ranges). Only nginx talks to this
    // process by default (loopback) - add the reverse proxy chain's own
    // internal subnet here if another hop (e.g. a domain-fronting proxy)
    // sits in front of nginx, otherwise req.ip resolves to that hop's own
    // address instead of the real client for every request behind it.
    trustedProxies: (process.env.TRUSTED_PROXY_SUBNETS || "loopback")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  // Fail fast in production rather than limping along without a session
  // secret - an unset secret would silently make every session guessable.
  if (env.nodeEnv === "production") {
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required env vars: ${missing.join(", ")}`);
    }
  } else if (!env.sessionSecret) {
    env.sessionSecret = "dev-only-insecure-secret-do-not-use-in-production";
  }

  return env;
}

export const env = readEnv();
export const isProduction = env.nodeEnv === "production";
