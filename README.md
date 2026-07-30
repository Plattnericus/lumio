# Lumio

A self-hosted personal cloud for photos, PDFs, Word and PowerPoint files —
plus a Garmin Connect IQ companion app to browse it from your wrist. No
Authentik, no Cloudflare Tunnel, no third-party identity provider: it's just
this app, served straight off a VPS's public IP.

## Features

- Own login, own sessions — no external auth dependency
- Multi-user: a first-run setup wizard creates the admin account, who can
  then provision further accounts — still no open self-registration
- Per-file sharing by username — view/download only, never delete or
  re-share; everything stays private unless you explicitly share it
- Drag-and-drop upload with real file-type validation (magic bytes, not
  extensions)
- Grid view with image thumbnails and type icons for documents
- Download and delete, filterable by file type
- Garmin watch app: pair once, then browse, view, and zoom/pan your
  photos on-device
- TOTP two-factor authentication
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
the Vivoactive 6 simulator. Before it can reach your server, set two app
settings (Connect IQ simulator: App Settings, or on a real watch: the
widget's settings in Garmin Connect Mobile) - neither is hardcoded:

- **Lumio server URL** - e.g. `https://your-server:8444`
- **Pairing code** - generated from the dashboard's "Pair Garmin watch"
  button, then press Select on the watch to exchange it for a token

The app stores the resulting device token locally and won't ask for the
code again unless that storage is cleared.

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
| `LOGIN_RATE_LIMIT_MAX` | Failed login attempts allowed before lockout |
| `PAIRING_CODE_TTL_MINUTES` | How long a Garmin pairing code stays valid |

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
- Sessions: `httpOnly`, `secure`, `sameSite=strict` cookies; CSRF protection
  on all state-changing routes.
- Rate limiting + lockout on `/api/login`, with a generic error message that
  never reveals whether a username exists.
- Uploads are validated by magic bytes against an allow-list (jpg, png,
  webp, pdf, docx, pptx), size-limited, stored under randomized filenames,
  and only ever served through an authenticated endpoint — never mounted
  statically.
- `fail2ban` watches both sshd and repeated app login failures.
- Auto-update is off by default — an admin has to explicitly enable it in
  Settings before a new release deploys itself.

## License

Private project — no license granted for reuse.
