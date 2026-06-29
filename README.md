# Monitoring — Connecteo infrastructure observability

Observability platform for the Connecteo stack and (later) the material
infrastructure managed by the infra team. **One service per subfolder**, each a
self-contained Docker stack on the shared external network `edge`, fronted by
Traefik on its own subdomain.

## Services

| Folder | Subdomain | Purpose | Status |
|---|---|---|---|
| `grafana/` | `graf.connecteo.net` | **The team's stack** — Grafana + Prometheus + Loki + Grafana Alloy + node-exporter + cAdvisor + SNMP Exporter. Metrics **and** logs (logs via Loki → Grafana Explore). | **Live** (SSO) |
| `grafana/` | `prom` / `allo` / `cadv` `.connecteo.net` | Prometheus / Alloy / cAdvisor **debug UIs** (prometheus/alloy/cadvisor joined `edge` 2026-06-16). | **Live** (SSO) |
| `tenant-dashboard/` | `ops.connecteo.net` | **Tenant Dashboard** (Next.js — TS / Next 16 / Node 24 since 2026-06-23) — tenant lifecycle (list/create/backup/restore/duplicate/drop) + pack & fiche editor (direct Postgres) + **per-tenant password reset** + masked admin/master creds. Multi-instance via `instances.json`. | **Live** (Authentik **owner-only**) |
| `sales-dashboard/` | `sales.connecteo.net` | **Espace Commercial** (Next.js, TS / Node 24) — **create-only** console for the sales team: creates a client and shows **only the client's login+password**, never Connecteo's admin/master. Shares the owner console's `instances.json`/`packs.json` (mounted **ro**). | **Live** (Authentik **`Commerciaux` group** + owner/akadmin) |
| `docker/` | `port.connecteo.net` | **Portainer CE** — Docker management. **NOT behind SSO** — Portainer CE can't header-SSO and forward-auth CORS-breaks its login XHR; uses its own admin login over HTTPS (Traefik → its `:9443`). | **Live** |

**Removed** (team doesn't use them): **ELK** (logs → Loki) and **Zabbix** (network/hardware → SNMP Exporter), plus the old **static** owner dashboard — the Next.js **Tenant Dashboard** (now at `ops.connecteo.net`) replaced it. Their stacks, volumes, and routes are gone.

## Conventions

- Each service stack joins the external `edge` network so Traefik can reach it by container name.
- Add the route to **`/srv/stacks/traefik/dynamic/monitoring.yml`** (one file for the whole platform).
- **Subdomains are short (≤ 4 letters)**: `graf` `prom` `allo` `cadv` `port` `ops`. Keep new ones ≤ 4 letters.
- Auth: **Authentik `forwardAuth`** — `graf/prom/allo/cadv` use the shared **domain-level** provider (`connecteo-forwardauth`, any Authentik user, akadmin/`fxt…`). **`ops`** is restricted to a **forward-single** provider + the **"Connecteo Owners"** group (login `owner`) — owner-only. **`port` (Portainer) is NOT SSO-gated** (own login; see above). To gate a new service: add the `authentik-forwardauth` middleware in `traefik/dynamic/monitoring.yml`. See `cto_one/HANDOFF.md` §4.
- These stacks are **infra (not in git)**.

## Per-service auth / first login

Everything sits behind Authentik SSO (forward-auth). What happens *after* the SSO gate:

| Service | Inner login | Notes |
|---|---|---|
| **Grafana** | none — true SSO | Authentik's `X-authentik-*` headers auto-sign-you-in as org **Admin** (`GF_AUTH_PROXY`). Break-glass admin in `grafana/.env` (`/login`). |

Secrets: `grafana/.env` is `chmod 600` (generated admin password).

## Operating

```bash
# bring the stack up / apply config changes
cd /srv/stacks/monitoring/grafana && docker compose up -d
docker compose logs -f                      # tail
# Grafana: Prometheus + Loki datasources and the "Connecteo — Containers & Host"
#   dashboard are provisioned. Logs: Explore → Loki → e.g. {container="cto_one_dev"}.
#   Import community metric dashboards by ID: 1860 (Node Exporter Full), 14282 (cAdvisor).
# Alloy ships every container's logs to Loki (config: grafana/alloy/config.alloy).
# SNMP: add device targets in grafana/prometheus/prometheus.yml (commented `snmp` job).
```

## Notes

- VPS headroom (2026-06-15): 8 cores / 22 GB RAM / 156 GB disk. No swap — Loki/Alloy are light (~150 MB combined); the heavy ELK stack was removed.
- **Alloy backfills history once**: on first start it reads each container's existing log file; Loki rejects entries older than its 7-day retention (`reject_old_samples`) — harmless, one-time, and it then only tails new logs.
- **Portainer is root-equivalent** (mounts the Docker socket) and is now **public at `port.connecteo.net`** (Traefik → its `:9443` via the `portainer-tls` serversTransport). It is **NOT** behind Authentik forward-auth: Portainer CE has no header-SSO and forward-auth CORS-breaks its login XHR — so it relies on its **own admin login** (`docker/portainer_admin_password`) over HTTPS. ⚠️ Root-equivalent + public → **harden**: add a Traefik `ipAllowList` (team/VPN IPs) and/or enable Portainer's TOTP MFA, or revert to the localhost:9443 SSH tunnel.
- **Hardening TODO**: Grafana auth-proxy trusts `X-authentik-*` from the whole `edge` subnet (`172.18.0.0/16`); any container on `edge` could forge them. Acceptable for now; tighten to Traefik's IP if `edge` ever hosts less-trusted workloads.
- Done: **Portainer**, **Grafana + Prometheus + Loki + Alloy + node-exporter + cAdvisor + SNMP Exporter**. Possible next: wire SNMP device targets, expose Portainer behind SSO at `port.connecteo.net`. The **Tenant Dashboard** lives at `monitoring/tenant-dashboard/` (`ops.connecteo.net`) — multi-instance Odoo tenant management + pack/fiche editor.
