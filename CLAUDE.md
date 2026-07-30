# CLAUDE.md

## What this is

Lumio is a self-hosted personal file cloud (photos, PDFs, Word, PowerPoint) with
a Garmin Connect IQ companion app. Fully self-contained — no Authentik, no
Cloudflare Tunnel, no external identity provider. Served directly over the
VPS's public IP.

## Repo structure

- `backend/` — Express JSON API, SQLite (better-sqlite3), auth, upload handling
- `frontend/` — static vanilla JS/HTML/CSS dashboard, served by nginx directly
- `garmin-app/` — Connect IQ (Monkey C) companion app for the Vivoactive 6
- `.github/workflows/` — CI, release, deploy, path-filtered per component

## Branch strategy

- `main` — protected, always deployable, the only source for releases/deploys.
  Never commit directly to it.
- `backend` / `frontend` / `garmin-app` — long-lived working branches per
  component, merged back into `main` via PR once CI is green.
- Short-lived `feature/*` branches off those are fine for individual changes.

## Standing rules

1. Comments, commit messages, README, this file: English, short, human —
   explain the *why*, not the *what*. No corporate filler.
2. One commit per meaningful change, Conventional Commits format
   (`feat:`/`fix:`/`chore:`/`docs:`/`security:`), authored as Plattnericus.
3. Nothing hardcoded — config and secrets live in `.env`, never in code.
   Check every diff for accidental secrets before committing.
4. Security over speed. Ask before anything touching firewall rules, SSH
   config, certificate issuance, or a force-push to `main`.
5. Check installed tool versions before assuming anything — don't guess.
6. `main` stays green and deployable. Work happens on the component branches,
   merged in via PR with passing CI.
7. Let's Encrypt IP certificates are valid ~160 hours. Renewal is mandatory
   infrastructure, not a one-time setup step — see the Certificate Renewal
   section in README.md.

## VPS reality check (why this deviates from a from-scratch design)

The target VPS is not an empty box — it already runs a live Netbird VPN mesh
(with its own Zitadel identity provider) and a Unifi Network Controller, both
in Docker. That changes a few decisions from the original plan:

- **Port 8444, not 8443** for Lumio's HTTPS — 8443 is already bound by the
  Unifi controller.
- **No ufw.** The box already exposes several Docker-published ports for
  Netbird/Unifi; a default-deny firewall allowing only Lumio's ports would cut
  those off. `fail2ban` only (sshd jail + Lumio login jail).
- **Port 80 is owned by the existing Caddy** (reached through a haproxy
  SNI-splitter in front of it — see `/opt/netbird/haproxy.cfg`). Lumio's ACME
  HTTP-01 challenge is served by a small addition to the existing
  `/opt/netbird/Caddyfile` (a `/.well-known/acme-challenge/` handler backed by
  a shared webroot), not by binding nginx to port 80. `haproxy.cfg` is left
  untouched.
- Lumio's own nginx binds only to `8444` (and proxies `/api/*` to Node on
  `127.0.0.1:3000`) — it never touches 80 or 443.

## Local setup & deploy

See README.md — Local Setup, Environment Variables, and Deployment sections.
