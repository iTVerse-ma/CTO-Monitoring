// Instance registry. Loaded from a JSON file (mounted read-only, chmod 600) that
// holds the per-Odoo-deployment secrets (master password + Postgres creds).
// SECRETS NEVER LEAVE THE SERVER: the client only ever sees what publicInstance()
// returns (id/label/domain/defaults), never the master password or PG password.
import fs from 'node:fs';

const FILE = process.env.INSTANCES_FILE || '/app/instances.json';

let cache = null;
function load() {
  if (cache) return cache;
  const raw = fs.readFileSync(FILE, 'utf8');
  const parsed = JSON.parse(raw);
  cache = parsed.instances || [];
  return cache;
}

export function allInstances() {
  return load();
}

export function getInstance(id) {
  const inst = load().find((i) => i.id === id);
  if (!inst) throw new Error(`unknown instance: ${id}`);
  return inst;
}

// Browser-safe projection — no secrets.
export function publicInstance(i) {
  return {
    id: i.id,
    label: i.label,
    domain: i.domain,
    defaultModules: i.defaultModules || '',
    defaultLang: i.defaultLang || 'en_US',
    defaultCountry: i.defaultCountry || '',
  };
}

export function publicInstances() {
  return load().map(publicInstance);
}
