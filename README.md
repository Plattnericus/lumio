# Lumio

A self-hosted personal cloud for photos, PDFs, Word and PowerPoint files —
plus a Garmin Connect IQ companion app to browse it from your wrist. No
Authentik, no Cloudflare Tunnel, no third-party identity provider: it's just
this app, served straight off a VPS's public IP.

## Features

- Own login, own sessions — no external auth dependency
- Multi-user: a first-run setup wizard creates the admin account, who can
  then provision further accounts — still no open self-registration
- A Photos-style library: date-grouped grid, favorites, and non-exclusive
  albums (a file can live in as many albums as you want and still shows up
  in the main library)
- Deleted files land in a 30-day trash, restorable until then, purged for
  good afterward — no accidental permanent deletes
- Per-file sharing by username — view/download only, never delete or
  re-share; everything stays private unless you explicitly share it
- Drag-and-drop upload with real file-type validation (magic bytes, not
  extensions)
- A lightbox with wheel-zoom/click-drag on desktop and pinch/double-tap on
  mobile, plus an inline PDF viewer — no forced download just to look at
  something
- Light/dark/auto theme
- Passwordless sign-in via passkeys (WebAuthn), on top of password + TOTP —
  a registered passkey skips the TOTP prompt entirely, since it already
  proves possession and (usually) biometrics
- "Stay logged in" sessions that quietly extend themselves while you're
  actually using the app, instead of a fixed 7-day cliff
- Garmin watch app: pair once with a code typed directly on the watch (no
  phone-side settings screen), then filter by All Photos / Favorites / a
  specific album and browse, view, and zoom/pan your photos on-device
- Real TLS via a Let's Encrypt certificate issued directly for the server's
  IP address (no domain required)
- Optional auto-update on new releases, off by default, admin-toggled

## Tech stack

| Component | Choice |
|---|---|
| `backend/` | Node.js + Express, JSON API only |
| Database | SQLite via `better-sqlite3` |
| `frontend/` | Vanilla JS/HTML/CSS, no framework, no build server |
| `garmin-app/` | Connect IQ SDK, Monkey C |
| Reverse proxy / TLS | nginx |
| Tests | Vitest (backend) |
| CI/CD | GitHub Actions |
| Releases | Conventional Commits + release-please |

## Repo structure & branch strategy

```
lumio/
├── backend/            # Express API, SQLite, auth, uploads
├── frontend/            # Static dashboard
├── garmin-app/          # Connect IQ project
├── .github/workflows/    # CI, release, deploy
└── README.md
```

- `main` — protected, always deployable, the only branch releases/deploys are
  cut from.
- `backend`, `frontend`, `garmin-app` — long-lived per-component branches,
  merged into `main` via PR once CI is green.

## Prerequisites

- Node.js (see `backend/.nvmrc` for the version) and npm
- A Connect IQ SDK install + simulator for `garmin-app/`
- nginx and certbot ≥ 5.4 on the deploy target
- `gh` CLI for repo/release operations (optional, convenience only)

## Local setup

### backend/

```bash
cd backend
cp .env.example .env   # fill in real values, never commit .env
npm install
npm run dev
```

Open the frontend (or hit `GET /api/setup/status`) and the first-run setup
wizard walks you through creating the admin account — no need to run
`npm run setup-account` for that anymore. That script still exists as an
SSH-only disaster-recovery tool; see Security notes below.

### frontend/

```bash
cd frontend
npm install
npm run dev   # served separately in dev; nginx serves frontend/dist in prod
```

### garmin-app/

Open `garmin-app/` in the Connect IQ SDK / VS Code plugin and run it against
the Vivoactive 6 simulator. Everything is entered directly on the watch with
a hand-built on-screen keyboard - no phone-side settings screen, nothing
hardcoded:

- First run asks for your **Lumio server's address** (e.g.
  `https://your-server:8444`), checks it's actually reachable before saving,
  and gives you a clear error and another chance if it isn't.
- Then it asks for a **pairing code** - generate one from the dashboard's
  "Pair Garmin watch" button, type it in on the watch, press the checkmark.
  The resulting device token is stored on-device and it won't ask again
  unless that storage is cleared.
- After pairing, a quick filter menu (All Photos / Favorites / an album)
  decides what the photo list below it actually shows.

## Environment variables

All of these live in `backend/.env` (see `backend/.env.example` for the full,
value-free template — never commit the real file).

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Port the API listens on (bound to `127.0.0.1` only) |
| `SESSION_SECRET` | Random secret for signing session cookies |
| `DB_PATH` | Path to the SQLite database file |
| `UPLOAD_DIR` | Path where uploaded files are stored |
| `SETUP_TOKEN_PATH` | Where the one-time first-run setup token is written. Defaults to `setup-token.txt` next to `DB_PATH` |
| `MAX_UPLOAD_MB` | Upload size limit in megabytes |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_LOCKOUT_MINUTES` | Failed login attempts allowed before a temporary lockout, and how long it lasts |
| `PAIRING_CODE_TTL_MINUTES` | How long a Garmin pairing code stays valid |
| `TRASH_RETENTION_DAYS` | How long a deleted file sits in trash before it's purged for good |
| `SESSION_MAX_AGE_DAYS` | How long a "stay logged in" session lasts before it must be re-established |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` | Passkey (WebAuthn) settings - RP ID is the bare domain (no scheme/port) the app is served from, origin is the full URL the browser sees. Both `RP_ID` and `ORIGIN` have safe localhost defaults outside production but **must** be set explicitly once `NODE_ENV=production` |
| `DUO_INTEGRATION_KEY` / `DUO_SECRET_KEY` / `DUO_API_HOSTNAME` | Reserved for a future Duo Security integration - not read by any code path yet, since that needs a real Duo account to build and test against |
| `TRUSTED_PROXY_SUBNETS` | Comma-separated subnets Express trusts as reverse-proxy hops (`loopback` by default). Add another only if something sits in front of nginx - see Domain access below |

## CI/CD & release process

- Every PR runs `.github/workflows/ci.yml`: a `dorny/paths-filter` job
  decides which of `backend`/`frontend`/`garmin-app` actually changed, then
  only those jobs run (lint, tests, `npm audit`). Merging into `main`
  requires this to pass (branch protection).
- `release-please` watches `main`'s Conventional Commit history and opens a
  release PR with a generated `CHANGELOG.md`. Merging that PR cuts a GitHub
  Release + tag.
- `deploy.yml` triggers on `release: published`: SSH onto the VPS, checkout
  the tag, `npm ci --production` (backend) and a static rebuild (frontend),
  restart the service, then poll `/api/health`. A failed health check rolls
  back to the previously deployed commit automatically and fails the
  workflow — a bad release never stays live.

### Required GitHub Actions secrets

None of these are hardcoded anywhere in the workflows - set them under
the repo's Settings → Secrets and variables → Actions.

| Secret | Purpose |
|---|---|
| `RELEASE_PLEASE_TOKEN` | A PAT (not the default `GITHUB_TOKEN`) for `release-please-action`. Required because a release created with the default token doesn't fire the `release: published` event `deploy.yml` waits for. |
| `DEPLOY_SSH_KEY` | Private half of the deploy keypair (generated on the VPS - see Deployment below). |
| `DEPLOY_SSH_USER` | The account the deploy key logs in as on the VPS. |
| `VPS_HOST` | The VPS's public IP or hostname. |
| `GARMIN_USERNAME` / `GARMIN_PASSWORD` | Your own Garmin Connect developer account, used only to download the Connect IQ SDK in the `garmin` CI job. Without these the compile-check step fails at the download - that's expected until they're set, not a sign the app itself is broken. |

## Deployment

### One-command install

On a fresh Ubuntu/Debian server:

```bash
curl -fsSL https://raw.githubusercontent.com/Plattnericus/lumio/main/scripts/install.sh | sudo LE_EMAIL=you@example.com bash
```

Installs Node, nginx, certbot, fail2ban; creates a dedicated system user;
clones the repo; builds both apps; issues a real Let's Encrypt certificate;
installs the hardened systemd service, fail2ban jail, certificate-expiry
check, and daily backup timer - then starts it. Every path and setting is
overridable via env vars (`INSTALL_DIR`, `HTTPS_PORT`, `SYSTEM_USER`,
`SERVER_ADDRESS`, `BACKUP_RETENTION_DAYS`), nothing is hardcoded.

Targets the common case: a server where nginx can own port 80 and
`HTTPS_PORT` itself. If something else already holds one of those ports
(as on the actual VPS this project was built against - see below), the
script detects it, skips what it can't safely automate, and tells you
exactly what to do by hand instead of guessing at someone else's config.

Verified: syntax-checked, zero shellcheck warnings, every generated
config file (systemd unit via `systemd-analyze verify`, nginx vhost via
`nginx -t`) validated against real tooling, and the certbot invocation
matches the exact command already proven to work in Certificate renewal
below - not the `--nginx` plugin, which is untested for `--ip-address`
certificates specifically.

### Manual / this project's actual VPS

Deployed to `/root/lumio` on the VPS, reachable at
`https://<vps-ip>:8444`. Port 8444 rather than 8443 only matters if
something else on the box already holds 8443 - pick whichever is actually
free on your server. nginx serves `frontend/dist` as static files and
proxies `/api/*` to the Node process on `127.0.0.1`. The Node process
itself never binds to a public interface.

The backend runs as a dedicated, unprivileged system user via a hardened
systemd unit (`NoNewPrivileges`, `ProtectSystem=strict` with the data
directory as the one writable exception, `PrivateTmp`, and more) - see
the unit's own comments for the two hardening flags that had to be left
off and why (`ProtectHome` conflicts with code living under `/root`;
`MemoryDenyWriteExecute` breaks Node's V8 JIT).

### Domain access on this VPS

The same server also runs Netbird (haproxy + Caddy, both in Docker) and
Unifi for unrelated services, sharing the box's one public IP on ports
80/443. Lumio is additionally reachable at `https://pics.plattnericus.dev`
by fronting the same nginx (`https://<vps-ip>:8444`) with a new Caddy site
block - purely additive, no changes to Netbird/Unifi's own routing:

- Caddy already terminates TLS for every other hostname on this box via
  its own automatic HTTPS (real Let's Encrypt certs, no IP-cert dance
  needed here since it's a normal domain). A new site block reverse-proxies
  `pics.plattnericus.dev` to nginx's existing `8444` listener over the
  Docker bridge, skipping upstream cert verification for that one internal
  hop (nginx's own cert is issued for the bare IP, not this hostname) -
  the same pattern already used for this box's Unifi site block.
- haproxy's TCP-passthrough backend to Caddy (`be_caddy_tls`) sends
  `send-proxy-v2`, and Caddy's `:443` listener is configured to accept
  PROXY protocol only from haproxy's own address. Without this, every
  request reaching Lumio via the domain would appear to come from an
  internal Docker address instead of the real visitor, silently breaking
  per-client rate limiting and the fail2ban app-login jail for that path.
  `TRUSTED_PROXY_SUBNETS` (see Environment variables) must include the
  Docker bridge subnet the Caddy/haproxy containers sit on in addition to
  `loopback` for this to resolve correctly end to end.
- `ufw` is intentionally not used anywhere on this box - `fail2ban` plus
  the containers' own port bindings are what's actually in effect.
- Direct `https://<vps-ip>:8444` access keeps working unchanged alongside
  the domain.

## Certificate renewal

TLS uses a Let's Encrypt certificate issued directly for the server's IP
address (GA since January 2026), valid for ~160 hours. Certbot (install via
snap, not apt - Ubuntu's packaged version is too old to support IP
certificates) sets up its own twice-daily renewal timer; run an additional
check that alerts if less than 48 hours remain, since a silent renewal
failure has a much smaller safety margin than it would with a normal
90-day certificate. This is a hard requirement, not a one-time setup step.

## Backup & restore

`npm run backup` (from `backend/`) snapshots the database and upload
directory into `backend/data/backups/`, rotating anything older than 7
days. It uses SQLite's own online backup API rather than a plain file
copy, which isn't safe against a live WAL-mode database.

Run it daily via a systemd timer on the VPS - a oneshot service calling
`npm run backup` in `/root/lumio/backend`, triggered by a timer with
`OnCalendar=daily`, the same pattern as the certificate-check timer.

Override the destination or retention window with `BACKUP_DIR` and
`BACKUP_RETENTION_DAYS` env vars.

**Restore:** stop the service, copy a backed-up `.sqlite` file back to the
path in `DB_PATH`, copy the matching `uploads-<timestamp>/` snapshot back to
`UPLOAD_DIR`, restart the service.

**Offsite backup target: not yet decided — TODO.** A VPS failure currently
takes the local rotation down with it. Pick a destination (a second machine,
object storage, etc.) and this gets wired in as a follow-up.

## Security notes

- Argon2id password hashing, no open self-registration. The first-run web
  setup wizard creates the one admin account; that admin provisions any
  further accounts (always `role: user` — no admin-creates-admin). A
  one-time setup token (generated at boot, readable only by the app's own
  system user, single-use) gates the wizard: without it, a browser-based
  setup route would let whoever's request reaches it first become the
  permanent admin, since the box is reachable at a bare public IP with
  nothing in front of it.
- `backend/src/scripts/setup-account.js` still exists, demoted to an
  SSH-only emergency/disaster-recovery tool — its `--force` flag fully
  wipes every account (and, via cascade, every file), so it prompts with
  the real affected-user count before doing that.
- Sharing is owner-controlled and one-directional: a file shared with you
  can be viewed and downloaded, never deleted or re-shared, and only the
  owner ever sees who it's shared with. Revoking a share removes access
  immediately.
- Sessions: `httpOnly`, `secure`, `sameSite=strict` cookies, rolling expiry
  (each request extends it, up to `SESSION_MAX_AGE_DAYS`) - only the
  server-side session store's own already-valid-session check can extend
  it, so an expired session can't be silently resurrected; CSRF protection
  on all state-changing routes.
- Rate limiting + lockout on `/api/login`, with a generic error message that
  never reveals whether a username exists.
- Passkeys (WebAuthn) are a phishing-resistant alternative to password+TOTP,
  not a weaker side door: registration requires an existing authenticated
  session, login is usernameless (the server identifies the account from
  the credential ID the browser returns, never a client-supplied username),
  and a successful passkey login is treated as fully authenticated on its
  own - it already proves possession and (usually) biometrics, the same
  assurance level TOTP exists to add on top of a password. Duo Security
  integration is stubbed (env vars only, no code path yet) pending a real
  Duo account to build and test against - not built blind.
- Deleting a file moves it to a 30-day trash instead of touching disk -
  restorable until a background sweep (or an operator's own cron, via
  `backend/src/scripts/purge-trash.js`) purges it for good. Removing a
  user (from Settings) still deletes every one of their files immediately
  regardless of trash state - trash is a safety net against your own
  mistakes, not a way to keep a removed user's data around longer than
  intended.
- Uploads are validated by magic bytes against an allow-list (jpg, png,
  webp, pdf, docx, pptx), size-limited, stored under randomized filenames,
  and only ever served through an authenticated endpoint — never mounted
  statically.
- `fail2ban` watches both sshd and repeated app login failures.
- Auto-update is off by default — an admin has to explicitly enable it in
  Settings before a new release deploys itself.

## License

Private project — no license granted for reuse.
