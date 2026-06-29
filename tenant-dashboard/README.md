# Connecteo Tenant Dashboard

Next.js app to manage Odoo tenant databases through Odoo's **built-in DB API** plus
**direct Postgres** — **https://ops.connecteo.net**, behind Traefik + Authentik SSO
(**owner-only**: group "Connecteo Owners", login `owner` — NOT the shared monitoring SSO).
Title: "Connecteo One — Tenant Dashboard". *(Renamed 2026-06-16 from "db-console".)*

It is a full **create → duplicate → backup → restore → drop** console, **plus a
per-tenant pack & client-fiche editor**, and supersedes the public
`/web/database/manager` (locked down — see below). This is where the **owner**
manages packs and the fiche — inside Odoo those are read-only.

## What it does

- **Instance selector** — pick which Odoo deployment ("docker") to manage. Driven
  by `instances.json`; `cto_one_dev` is preconfigured. Add more by appending an
  entry there **and** the instance's DB network in `docker-compose.yml`.
- **List** databases + size + live connections — read straight from PostgreSQL
  (`pg_database`), because Odoo's `db.list` is filtered by `dbfilter=^%d$` and
  can't enumerate tenants.
- **Create** a tenant — set the **company name** + **logo**, pick a **pack** (a comparison panel
  shows what each includes) and optionally **Site web** (opt-in checkbox, any pack). Runs
  `/web/database/create`, installs the pack's apps via a dbfilter-scoped web session, writes the
  company name/logo/pack/fiche, then calls `res.company.cto_reapply_app_branding()`. (The logo is
  written in its own call so a bad image can't roll back the name/pack/fiche.) Creates the
  **client's own admin** (login = dirigeant
  email from the fiche, else generated; **Direction** profile = clone of the default admin minus
  `group_system`/`group_erp_manager`/`group_no_one`) — password shown once. The default `admin`
  (uid 2) stays as a **hidden shared Connecteo recovery** (same password on every tenant, from
  `instances.json` `adminPassword`); uid 1 (OdooBot) is inactive.
- **Réinit. mot de passe** (per tenant) — `/api/reset-admin` sets a fresh password on the tenant's
  Direction admin and shows it once (Odoo hashes passwords; originals aren't recoverable).
- **Credentials panel** — the shared `admin` recovery password + the master password, masked with
  reveal/copy, fetched on demand via `/api/admin-credential` (not baked into the page HTML).
- **Packs** (catalog editor) — packs are the single source of truth in **`packs.json`** (writable,
  via `/api/packs` + `lib/packs.js`), no longer hardcoded. Edit the **app contents** + **included
  users** of the built-in packs (Start/Pro/Max — names/ids locked, not deletable), and **create /
  rename / delete custom packs**. Apps are chosen from a curated catalog (friendly label → Odoo
  module) with an "advanced: add module by technical name" escape hatch. Edits apply to **new**
  tenants only — a pack's apps install at creation, never retro-installed onto existing tenants.
  `packs.json` is mounted **rw** (chmod 660, group 1001) so the container can persist edits.
- **Backup** — streams the `.zip` (DB dump + filestore) to your browser.
- **Restore** — upload a `.zip` into a new DB (neutralized "safe copy" by default).
- **Duplicate** / **Drop** (drop requires typing the name to confirm).
- **Fiche / Pack** (per tenant) — read & edit the **company name**, **pack** (any pack from
  `packs.json`), **logo**, and the client fiche (ICE/IF/RC/CNSS/Patente + dirigeant). The name,
  pack id/label/users and fiche are plain `res_company` columns written **straight in Postgres**
  (`lib/pg.js` `getCompanyProfile`/`updateCompanyProfile` → `/api/profile`); the **logo** is Binary
  so it's written through Odoo `call_kw` (non-fatal). No tenant login needed; Odoo re-reads them on
  the next page load (the systray badge + the read-only "Ma société" form). Note: changing the pack
  here updates the metadata only — a pack's **apps** are installed at tenant **creation**, not on
  later pack changes.
- **Documentation Comptabilité** (`/docs`, route `app/docs/page.js`, linked from the console
  header) — an owner-facing guide to the flagship Comptabilité app: CGNC compliance, the certified
  liasse (Bilan 3-col / CPC / ESG / Tableau de financement / ETIC), déclaration de TVA, invoice
  legal mentions, profiles, clôture, how-to + roadmap. Embedded visuals are **server-rendered**
  (the actual report PDFs → `pdftoppm`) in **`public/docs/*.png`** — regenerate them from a tenant
  via `_render_qweb_pdf` if the reports change. Styles share `globals.css` (`.doc-*` classes).

## Background create queue (non-blocking)

`POST /api/create` no longer blocks: it validates (name, duplicate, already-queued)
then **enqueues** the job and returns `202 { jobId }` immediately. A module-singleton
queue (`lib/queue.ts`) drains jobs in the background, **serialized per instance** (one
`createdb` at a time → no Postgres `CREATE DATABASE` contention; different instances run
in parallel). The UI polls **`GET /api/jobs`** every 2.5 s and shows a "Créations en
cours" panel with each job's step/% and the client credentials when done. The
provisioning flow lives in `lib/provision.ts` (`provisionOwner`). In-memory only — a
container restart drops queued/in-flight jobs. (Same lib in the sales console.)

## Infra view (`/infra`)

A read-only observability page ("🖥 Infra" in the header) showing **everything running
in our stacks**:
- **Host**: CPU / memory / disk / load / uptime (Prometheus + node-exporter).
- **Containers** grouped by stack: state, health, CPU %, RAM, ports, image.
- **Per-container drawer**: config (image, networks, mounts, command, env — secrets
  auto-redacted) + **live logs** (Docker logs, demuxed from the 8-byte frame header +
  ANSI-stripped).

Sources (`lib/infra.ts`, routes under `app/api/infra/*`):
- **`cto_docker_proxy`** — a `tecnativa/docker-socket-proxy` (GET-only: `CONTAINERS`/
  `IMAGES`/`NETWORKS`/`VOLUMES`/`INFO`; `POST=0`, `EXEC=0`), defined in
  `../docker/docker-compose.yml`, on an **isolated `infra_ro`** network joined only by
  this dashboard (NOT `edge`, so tenant Odoo containers can't reach the Docker API).
- **Prometheus** (`monitoring_prometheus:9090`) for cAdvisor + node-exporter metrics.

**Scope**: only our platform stacks are surfaced (`cto_*`, `authentik*`, `monitoring_*`,
`traefik`); the host's other projects (`o19_*`, `odoo11`, `n8n`, `vpn`) are filtered out
in `lib/infra.ts` `IN_SCOPE` — on both list **and** inspect (enforced at the API, not
just hidden in the UI).

## How it talks to Odoo (important quirks)

This Odoo exposes **only the `web` controllers** — no `/jsonrpc`, no `/xmlrpc/2/*`.
So the client (`lib/odoo.js`) uses:

- `/web/database/{create,duplicate,drop,backup,restore}` form endpoints.
- `/web/session/authenticate` + `/web/dataset/call_kw` for module installs.

Two gotchas baked into the code:
1. **`dbfilter=^%d$`** ties tenant-scoped calls (session auth, call_kw, backup) to
   the request **Host**. So those send `Host: <db>.connecteo.net`.
2. **`fetch()` silently drops the `Host` header** (it's forbidden), so those calls
   use raw `node:http` instead. DB-lifecycle form posts that aren't host-scoped
   (create/duplicate/drop/restore) use `fetch`.

## Security

- **SSO (owner-only)**: `ops.connecteo.net` is gated by a **forward-single** Authentik app
  (`connecteo-ops`) restricted to the **"Connecteo Owners"** group (login `owner`) — separate
  from the shared monitoring SSO (akadmin can't reach ops). Enforcement is at Traefik/Authentik.
- **Secrets**: master password + PG creds live in `instances.json` only
  (`chmod 640`, owner `ubuntu`, group `1001` = the container's `nodejs` group so it
  can read; **not** baked into the image — see `.dockerignore`). They never reach
  the browser (`lib/instances.js` → `publicInstance()` strips them).
- **No published host port** — only reachable through Traefik on `edge`.
- **Public DB manager — locked down (done)**: the `cto-dbmanager` router in
  `traefik/dynamic/odoo.yml` now gates `/web/database/(manager|selector|create|
  duplicate|drop|backup|restore)` on every tenant host behind `authentik-forwardauth`,
  so anonymous master-password attempts from the internet are blocked. `/web/database/list`
  is intentionally left open (Odoo's login flow uses it). The console is unaffected —
  it reaches Odoo internally by container name, not via Traefik.

## Operating

```bash
cd /srv/stacks/monitoring/tenant-dashboard
docker compose up -d --build      # build + run
docker compose logs -f
# add an instance: edit instances.json + add its *_default network to docker-compose.yml
# packs live in packs.json (mounted rw, chmod 660 group 1001) — edited from the UI;
#   also seeded automatically by lib/packs.js if the file is missing.

# FIRST-TIME Infra setup (once): the isolated read-only Docker API network + proxy
docker network create infra_ro
cd ../docker && docker compose up -d docker-socket-proxy
```

Relabel note: Odoo's native `vat` field ("Tax ID") is relabeled **"ICE"** for every tenant by
`cto_branding` (`models/res_partner.py`) — distinct from the `cto_ice` fiche field above.

Networks: `edge` (Traefik + reach `cto_one_dev:8069` + `monitoring_prometheus:9090`),
each instance's `*_default` (reach its Postgres for listing), and **`infra_ro`** (reach
the read-only `cto_docker_proxy:2375` for the Infra view).
