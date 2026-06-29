// Tenant DB names must be valid subdomains (subdomain = the database, per Odoo's
// dbfilter=^%d$). Same rule as new-tenant.sh.
const RESERVED = new Set(['postgres', 'template0', 'template1', 'www', 'mail', 'ns', 'auth', 'ops', 'grafana', 'zabbix', 'db',
  // platform subdomains — a tenant DB of the same name would shadow these in Traefik
  'sales', 'crea', 'vente', 'console', 'port', 'prom', 'allo', 'cadv', 'graf']);

export function validateName(name) {
  if (!name || typeof name !== 'string') return 'name is required';
  if (name.length > 63) return 'name too long (max 63)';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name))
    return 'invalid: lowercase a-z, 0-9, hyphens only (no underscores/uppercase)';
  if (RESERVED.has(name)) return `'${name}' is reserved`;
  return null;
}
