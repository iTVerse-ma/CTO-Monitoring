// Pack catalog + pricing — the single source of truth for Connecteo One's THREE
// packs (Start / Pro / Max) and the priced add-on catalog.
//
// Prices are HT in MAD, taken verbatim from the public offer
// (connecteo.ma/connecteo-one). They are REFERENCE DATA, set in code so they can't
// silently drift from the published grid. Only the EDITABLE bits of each pack
// (its included modules, included features, included users) persist to packs.json.
//
// There are NO custom packs anymore: exactly Start/Pro/Max, always, in this order.
// What a pack contains is editable; the three packs themselves are fixed.
import fs from 'node:fs';

const FILE = process.env.PACKS_FILE || '/app/packs.json';
const MODULE_NAME = /^[a-z0-9_]+$/; // Odoo technical module name

// --- The add-on catalog --------------------------------------------------
// `kind`:
//   'base'     -> ships with the pack base price (Ventes, Facturation). Free; here for labels.
//   'module'   -> a real Odoo module: installable / uninstallable, billed when added beyond the pack.
//   'feature'  -> billing-only line, no separate Odoo module (Télédéclaration ships inside Comptabilité).
//   'quantity' -> billed per unit (extra user / extra dépôt); no module.
//   'soon'     -> announced, not yet provisionable (shown disabled).
// `sub` = monthly subscription HT, `acq` = one-time acquisition HT (MAD).
export const CATALOG = [
  { id: 'ventes', label: 'Ventes — devis & commandes', module: 'sale_management', sub: 0, acq: 0, kind: 'base' },
  { id: 'facturation', label: 'Facturation', module: 'account', sub: 0, acq: 0, kind: 'base' },
  { id: 'compta', label: 'Comptabilité et TVA', module: 'l10n_ma', sub: 199, acq: 2399, kind: 'module' },
  { id: 'teledeclaration', label: 'Télédéclaration', module: null, sub: 99, acq: 1199, kind: 'feature' },
  { id: 'crm', label: 'CRM commercial', module: 'crm', sub: 99, acq: 1199, kind: 'module' },
  { id: 'achats', label: 'Achats', module: 'purchase', sub: 99, acq: 1199, kind: 'module' },
  { id: 'stock', label: 'Stock', module: 'stock', sub: 99, acq: 1199, kind: 'module' },
  { id: 'projet', label: 'Gestion de projet', module: 'project', sub: 99, acq: 1199, kind: 'module' },
  { id: 'fabrication', label: 'Fabrication', module: 'mrp', sub: 199, acq: 2399, kind: 'module' },
  { id: 'parc', label: 'Parc automobile', module: 'fleet', sub: 79, acq: 949, kind: 'module' },
  { id: 'pos', label: 'Point de vente', module: 'point_of_sale', sub: 99, acq: 1199, kind: 'module' },
  { id: 'site', label: 'Site web', module: 'website', sub: 149, acq: 1799, kind: 'module' },
  { id: 'boutique', label: 'Boutique en ligne', module: 'website_sale', sub: 299, acq: 3599, kind: 'module' },
  { id: 'email', label: 'Email et WhatsApp', module: 'mass_mailing', sub: 99, acq: 1199, kind: 'module' },
  { id: 'depot', label: 'Dépôt supplémentaire', module: null, sub: 49, acq: 599, kind: 'quantity' },
  { id: 'user', label: 'Utilisateur supplémentaire', module: null, sub: 99, acq: 1199, kind: 'quantity' },
  { id: 'paie', label: 'Gestion de la paie', module: null, sub: 199, acq: 2399, kind: 'soon' },
];

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
export const CATALOG_BY_MODULE = Object.fromEntries(CATALOG.filter((c) => c.module).map((c) => [c.module, c]));
// Every catalog Odoo module (used to filter a tenant's installed modules down to billable ones).
export const CATALOG_MODULES = CATALOG.filter((c) => c.module).map((c) => c.module);

// --- The three packs (fixed identity; editable contents) -----------------
// name + basePrice + defaultUsers are reference data (code). modules/features/users persist.
const PACK_META = [
  { id: 'start', name: 'Start', basePrice: 149, defaultUsers: 1 },
  { id: 'pro', name: 'Pro', basePrice: 399, defaultUsers: 3 },
  { id: 'max', name: 'Max', basePrice: 899, defaultUsers: 5 },
];
const PACK_ORDER = PACK_META.map((p) => p.id);

const DEFAULT_MODULES: Record<string, string[]> = {
  start: ['sale_management', 'account'],
  pro: ['sale_management', 'account', 'l10n_ma', 'purchase', 'stock', 'crm'],
  max: ['sale_management', 'account', 'l10n_ma', 'purchase', 'stock', 'crm', 'project', 'mass_mailing'],
};
// Features (no Odoo module) bundled free with a pack. Télédéclaration ships with
// Comptabilité, so Pro/Max (which include Comptabilité) get it free; Start pays.
const DEFAULT_FEATURES: Record<string, string[]> = {
  start: [],
  pro: ['teledeclaration'],
  max: ['teledeclaration'],
};

function sanitizeModules(raw: any, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const out: string[] = [];
  for (const m of raw) {
    const mod = String(m || '').trim();
    if (mod && MODULE_NAME.test(mod) && !out.includes(mod)) out.push(mod);
  }
  return out;
}
function sanitizeFeatures(raw: any, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const feat = CATALOG.filter((c) => c.kind === 'feature').map((c) => c.id);
  const out: string[] = [];
  for (const f of raw) {
    const id = String(f || '').trim();
    if (feat.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// Read the editable bits from packs.json and merge with the fixed PACK_META so the
// result is ALWAYS exactly the three packs, in order, with code-authoritative
// name/basePrice and persisted modules/features/users.
export function loadPacks() {
  let persisted: any = {};
  try { persisted = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { /* seed below */ }
  const byId: Record<string, any> = {};
  if (Array.isArray(persisted.packs)) for (const p of persisted.packs) if (p && p.id) byId[String(p.id).toLowerCase()] = p;

  const packs = PACK_META.map((meta) => {
    const p = byId[meta.id] || {};
    let users = Number.parseInt(p.users, 10);
    if (!Number.isFinite(users) || users < 0) users = meta.defaultUsers;
    return {
      id: meta.id,
      name: meta.name,
      basePrice: meta.basePrice,
      users,
      modules: sanitizeModules(p.modules, DEFAULT_MODULES[meta.id]),
      features: sanitizeFeatures(p.features, DEFAULT_FEATURES[meta.id]),
    };
  });
  return { catalog: CATALOG, packs };
}

// Find a pack by id (create flow). Returns null when unknown.
export function getPack(id: string) {
  return loadPacks().packs.find((p) => p.id === id) || null;
}

// Validate + normalize an incoming { packs } payload to exactly the three packs.
// Unknown ids are ignored; missing ones re-seed from defaults. Names/prices are
// fixed (code), so only users/modules/features are read from the payload.
export function normalizePacks(data: any) {
  const byId: Record<string, any> = {};
  if (data && Array.isArray(data.packs)) for (const p of data.packs) if (p && p.id) byId[String(p.id).toLowerCase()] = p;
  const packs = PACK_META.map((meta) => {
    const p = byId[meta.id] || {};
    let users = Number.parseInt(p.users, 10);
    if (!Number.isFinite(users) || users < 0) users = meta.defaultUsers;
    return {
      id: meta.id,
      users,
      modules: sanitizeModules(p.modules, DEFAULT_MODULES[meta.id]),
      features: sanitizeFeatures(p.features, DEFAULT_FEATURES[meta.id]),
    };
  });
  return { packs };
}

export function savePacks(data: any) {
  const clean = normalizePacks(data);
  fs.writeFileSync(FILE, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  // Return the FULL packs (with name/basePrice) so the editor refreshes correctly.
  return loadPacks();
}

// --- Pricing -------------------------------------------------------------
// Compute a tenant's monthly HT bill from LIVE state (derived, no separate store):
//   pack             : the resolved pack object (basePrice, users, modules, features)
//   installedModules : the tenant's installed Odoo module names
//   packUsers        : res_company.cto_pack_users (pack.users + any sold extras)
//   warehouses       : number of stock.warehouse records (extra dépôts beyond the first)
// A catalog module already in the pack is free; anything installed beyond it bills.
export function computeBilling(pack: any, { modules = [], packUsers = 0, warehouses = 0 }: any) {
  const installed = new Set(modules);
  const inPack = new Set(pack?.modules || []);
  const feats = new Set(pack?.features || []);
  const lines: any[] = [{ id: 'pack', label: `Pack ${pack?.name || ''}`, qty: 1, unit: pack?.basePrice || 0, total: pack?.basePrice || 0 }];

  let comptaBilled = false;
  for (const c of CATALOG) {
    if (c.kind !== 'module' || !c.module) continue;
    if (!installed.has(c.module)) continue;     // not provisioned -> not billed
    if (inPack.has(c.module)) continue;         // included in the pack -> free
    lines.push({ id: c.id, label: c.label, qty: 1, unit: c.sub, total: c.sub });
    if (c.id === 'compta') comptaBilled = true;
  }
  // Télédéclaration (feature): free when in the pack; otherwise billed iff Comptabilité is billed.
  if (!feats.has('teledeclaration') && comptaBilled) {
    const t = CATALOG_BY_ID['teledeclaration'];
    lines.push({ id: t.id, label: t.label, qty: 1, unit: t.sub, total: t.sub });
  }
  // Extra users sold beyond the pack's included seats.
  const extraUsers = Math.max(0, (packUsers || 0) - (pack?.users || 0));
  if (extraUsers > 0) {
    const u = CATALOG_BY_ID['user'];
    lines.push({ id: 'user', label: `${u.label} ×${extraUsers}`, qty: extraUsers, unit: u.sub, total: u.sub * extraUsers });
  }
  // Extra dépôts = stock warehouses beyond the first.
  const extraDepots = Math.max(0, (warehouses || 0) - 1);
  if (extraDepots > 0) {
    const d = CATALOG_BY_ID['depot'];
    lines.push({ id: 'depot', label: `${d.label} ×${extraDepots}`, qty: extraDepots, unit: d.sub, total: d.sub * extraDepots });
  }

  const monthly = lines.reduce((s, l) => s + (l.total || 0), 0);
  return { lines, monthly };
}
