# Espace Commercial — create-only tenant console (sales team)

Next.js (TypeScript, Node 24) app at **https://sales.connecteo.net** for the
**commercial team**. It does exactly one thing: **create a tenant** and show the
new client's **own login + password** — and deliberately nothing else.

## Why a separate app (not a mode of the owner console)
Security by construction. This app contains **no** admin-credential panel, **no**
database list, and **no** backup / drop / restore / duplicate / reset / packs-edit
endpoints — so there is nothing to leak even via URL/API poking. Concretely:

- `app/api/create` returns **only** `{ url, client: { login, password }, pack, … }`.
  It **strips** Connecteo's shared `recovery`/master secrets, and if the client's
  Direction account can't be created it returns **no creds + an escalation note**
  (it never falls back to exposing the shared `admin` password).
- The shared master / Postgres creds (`instances.json`, mounted **read-only**) are
  used **server-side only** to provision — never sent to the browser.
- `app/api/packs` is **GET-only** (read the catalog; commercials don't edit packs).

## Access (auth)
Behind the shared Authentik SSO (`authentik-forwardauth`, same as `ops`), then an
**in-app gate** (`lib/auth.ts`) that admits only the **`Commerciaux`** Authentik
group (plus `Connecteo Owners` and `authentik Admins`/akadmin). Deny-by-default:
no group header → "Accès réservé". Reads the trusted `X-authentik-groups` header
(same model as Grafana). To onboard a commercial: create their Authentik account
and add it to the **Commerciaux** group (`auth.connecteo.net` → Directory → Groups).

> A future hardening would be a dedicated Authentik proxy provider bound to the
> group (enforced *before* the app) instead of the in-app header check.

## Shape
- `app/page.tsx` — server component: group gate + render the create form.
- `app/Create.tsx` — the form (name / company / pack + optional fiche/logo/website)
  and the one-time result card (client URL + login + password, copyable).
- `lib/` — copied from `tenant-dashboard` (the proven `odoo`/`instances`/`packs`/
  `pg`/`validate` libs). `validate.ts` also reserves the platform subdomains
  (`sales`, `crea`, `vente`, `ops`, `graf`, …) so a tenant DB can't shadow them.

## Operate
```bash
cd /srv/stacks/monitoring/sales-dashboard
docker compose build && docker compose up -d     # rebuild + redeploy (image baked)
docker compose logs -f                            # tail
```
Traefik route: `traefik/dynamic/sales-dashboard.yml` (priority 1000, forward-auth).
Shares `instances.json` + `packs.json` from `../tenant-dashboard` (read-only).
