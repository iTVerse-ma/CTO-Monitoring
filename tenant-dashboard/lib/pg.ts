// Direct PostgreSQL access — used to list databases + sizes reliably, and to
// read/write the tenant's Connecteo One profile (pack + client fiche) on its
// res.company. These are plain stored columns, so the owner edits them straight
// from the dashboard without needing the tenant's Odoo password. (Odoo re-reads
// them on the next page load — the systray badge + read-only "Ma société" form.)
import pg from 'pg';
import { CATALOG_MODULES } from './packs';

const RESERVED = new Set(['postgres', 'template0', 'template1']);

// The Connecteo One profile columns on res.company, owned by cto_security_profiles.
// Packs are dynamic now (see lib/packs): cto_pack is a free identifier carrying a
// display label + included-users, all set by the dashboard.
const PROFILE_COLUMNS = [
  'cto_pack', 'cto_pack_label', 'cto_pack_users',
  'cto_ice', 'cto_if', 'cto_rc', 'cto_cnss', 'cto_patente',
  'cto_manager_name', 'cto_manager_role', 'cto_manager_phone', 'cto_manager_email',
];
// Writable via direct Postgres = the profile columns + the plain company name.
// (logo is Binary -> written through Odoo call_kw, not here.)
const WRITABLE_COLUMNS = new Set([...PROFILE_COLUMNS, 'name']);

// Connect to a SPECIFIC tenant database (listDatabases connects to `postgres`).
function tenantClient(inst, db) {
  return new pg.Client({
    host: inst.pg.host,
    port: inst.pg.port || 5432,
    user: inst.pg.user,
    password: inst.pg.password,
    database: db,
    connectionTimeoutMillis: 5000,
  });
}

// IF/ICE do NOT live on res_company — they are related fields stored on the
// company's res.partner (vat = Identifiant Fiscal, company_registry = ICE). That's
// what the Odoo "Ma société" form and the invoices read. The dashboard form keys
// cto_if/cto_ice therefore map onto the partner, not the (legacy, form-ignored)
// res_company cto_if/cto_ice columns.
const PARTNER_FIELD_BY_KEY = { cto_if: 'vat', cto_ice: 'company_registry' };

// Read the main company's pack + fiche. Returns { installed:false } when the
// tenant doesn't have cto_security_profiles (columns absent).
export async function getCompanyProfile(inst, db) {
  const client = tenantClient(inst, db);
  await client.connect();
  try {
    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'res_company' AND column_name = ANY($1)`,
      [PROFILE_COLUMNS],
    );
    if (cols.length === 0) return { installed: false, profile: null };
    // Read IF/ICE from the partner (canonical), not the legacy res_company columns.
    const companyCols = cols
      .map((c) => c.column_name)
      .filter((c) => !PARTNER_FIELD_BY_KEY[c]);
    const { rows } = await client.query(
      `SELECT c.id, c.name, ${companyCols.map((c) => `c."${c}"`).join(', ')},
              p.vat AS cto_if, p.company_registry AS cto_ice
       FROM res_company c LEFT JOIN res_partner p ON p.id = c.partner_id
       ORDER BY c.id LIMIT 1`,
    );
    return { installed: true, profile: rows[0] || null };
  } finally {
    await client.end();
  }
}

// Write the main company's pack + fiche (parameterized; column allowlist).
// IF/ICE (cto_if/cto_ice keys) are routed to the company's res.partner
// (vat/company_registry); the rest are plain res_company columns.
export async function updateCompanyProfile(inst, db, vals) {
  const all = Object.entries(vals || {}).filter(
    ([k, v]) => WRITABLE_COLUMNS.has(k) && v !== undefined,
  );
  if (all.length === 0) return { updated: [] };

  const companyEntries = all.filter(([k]) => !PARTNER_FIELD_BY_KEY[k]);
  const partnerEntries = all
    .filter(([k]) => PARTNER_FIELD_BY_KEY[k])
    .map(([k, v]) => [PARTNER_FIELD_BY_KEY[k], v]); // [vat|company_registry, value]

  const client = tenantClient(inst, db);
  await client.connect();
  try {
    const { rows: idRows } = await client.query(
      'SELECT id, partner_id FROM res_company ORDER BY id LIMIT 1',
    );
    if (!idRows.length) throw new Error('no company found in this tenant');
    const cid = idRows[0].id;
    const pid = idRows[0].partner_id;
    const updated = [];

    const writeRow = async (table, entries, rowId) => {
      if (!entries.length || !rowId) return;
      const sets = entries.map(([k], i) => `"${k}" = $${i + 1}`);
      const params = entries.map(([, v]) => (v === '' ? null : v));
      params.push(rowId);
      await client.query(
        `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      updated.push(...entries.map(([k]) => k));
    };

    await writeRow('res_company', companyEntries, cid);
    await writeRow('res_partner', partnerEntries, pid);
    return { updated };
  } finally {
    await client.end();
  }
}

export async function databaseExists(inst, name) {
  const dbs = await listDatabases(inst);
  return dbs.some((d) => d.name === name);
}

// Per-tenant billing inputs, read straight from the tenant DB (no Odoo HTTP):
//   created   : res_company.create_date (proxy for the subscription start)
//   pack      : res_company.cto_pack + cto_pack_users (included seats + sold extras)
//   modules   : installed Odoo modules that belong to our priced catalog
//   warehouses: stock.warehouse count (extra-dépôt billing; 0 when stock absent)
// Resilient: any failure (non-Odoo DB, connection refused) -> { installed:false }
// so one bad database never breaks the whole list.
export async function getTenantBilling(inst, db) {
  const client = tenantClient(inst, db);
  try {
    await client.connect();
    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='res_company' AND column_name = ANY($1)`,
      [['cto_pack', 'cto_pack_users']],
    );
    const hasPack = cols.some((c) => c.column_name === 'cto_pack');
    const { rows: comp } = await client.query(
      `SELECT ${hasPack ? 'cto_pack, cto_pack_users,' : ''} create_date
         FROM res_company ORDER BY id LIMIT 1`,
    );
    const company = comp[0] || {};
    const { rows: mods } = await client.query(
      `SELECT name FROM ir_module_module
        WHERE state IN ('installed','to upgrade','to install') AND name = ANY($1)`,
      [CATALOG_MODULES],
    );
    let warehouses = 0;
    try {
      const { rows: wh } = await client.query('SELECT count(*)::int AS n FROM stock_warehouse');
      warehouses = wh[0]?.n || 0;
    } catch { warehouses = 0; } // table absent = stock not installed
    return {
      installed: true,
      created: company.create_date ? new Date(company.create_date).toISOString() : null,
      pack: hasPack ? company.cto_pack || null : null,
      packUsers: hasPack ? Number(company.cto_pack_users || 0) : 0,
      modules: mods.map((m) => m.name),
      warehouses,
    };
  } catch (e) {
    return { installed: false, error: String(e.message || e) };
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

export async function listDatabases(inst) {
  const client = new pg.Client({
    host: inst.pg.host,
    port: inst.pg.port || 5432,
    user: inst.pg.user,
    password: inst.pg.password,
    database: inst.pg.database || 'postgres',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT d.datname AS name,
             pg_database_size(d.datname) AS bytes,
             pg_size_pretty(pg_database_size(d.datname)) AS size,
             (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) AS connections
      FROM pg_database d
      WHERE NOT d.datistemplate
      ORDER BY d.datname;
    `);
    return rows
      .filter((r) => !RESERVED.has(r.name))
      .map((r) => ({
        name: r.name,
        bytes: Number(r.bytes),
        size: r.size,
        connections: Number(r.connections),
      }));
  } finally {
    await client.end();
  }
}
