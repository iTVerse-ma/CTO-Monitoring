// Owner-console tenant provisioning, run by the background queue pump (lib/queue).
// Extracted from the old synchronous create route, with onStep() progress. Returns
// the CLIENT admin + Connecteo's recovery creds (owner console = full access).
import crypto from 'node:crypto';
import { getInstance } from './instances';
import { getPack, CATALOG_BY_ID } from './packs';
import {
  createDatabase, ensureLocalization, installModules, setCompanyProfile,
  reapplyBranding, createTenantAdmin, ensureWarehouses, configureMailServer,
} from './odoo';
import type { Job } from './queue';

const BASE_MODULES = ['cto_branding', 'cto_security_profiles', 'cto_dashboard', 'cto_contacts', 'cto_accounting'];
const FICHE_FIELDS = ['cto_rc', 'cto_cnss', 'cto_patente',
  'cto_manager_name', 'cto_manager_role', 'cto_manager_phone', 'cto_manager_email'];

function addonModules(ids: any): string[] {
  const out: string[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const c = CATALOG_BY_ID[id];
    if (c && c.kind === 'module' && c.module) out.push(c.module);
  }
  return out;
}
function genPassword() { return crypto.randomBytes(12).toString('base64url').slice(0, 16); }

export async function provisionOwner(job: Job, onStep: (step: string, pct: number) => void) {
  const b = job.payload || {};
  const packDef = getPack(b.pack) || getPack('start');
  if (!packDef) throw new Error('no packs configured');
  const pack = packDef.id;
  const inst = getInstance(b.instance);
  const name: string = b.name;
  const companyName = typeof b.companyName === 'string' ? b.companyName.trim() : '';
  const logo = typeof b.logo === 'string' && b.logo ? b.logo : null;
  const extraUsers = Math.max(0, Number.parseInt(b.extraUsers, 10) || 0);
  const extraDepots = Math.max(0, Number.parseInt(b.extraDepots, 10) || 0);
  const addons = addonModules(b.addons);
  const fiche = b.fiche || {};

  const adminPassword = inst.adminPassword || genPassword();
  onStep('Création de la base', 10);
  await createDatabase(inst, name, adminPassword);

  let localizationWarning: string | null = null;
  onStep('Localisation Maroc', 22);
  try {
    await ensureLocalization(inst, name, adminPassword, {
      countryCode: inst.defaultCountry || 'MA', currencyCode: inst.defaultCurrency || 'MAD',
    });
  } catch (e: any) { localizationWarning = String(e?.message || e); }

  const modules = [...new Set([...BASE_MODULES, ...(packDef.modules || []), ...addons])].join(',');
  onStep('Installation des applications', 45);
  let installed: any[] = [];
  let moduleWarning: string | null = null;
  try { installed = (await installModules(inst, name, adminPassword, modules)).installed; }
  catch (e: any) { moduleWarning = String(e?.message || e); }

  let profileWarning = null, logoWarning = null, brandingWarning = null, depotWarning = null, mailWarning = null;
  let tenantAdmin: any = null, adminWarning: string | null = null;
  if (!moduleWarning) {
    onStep('Profil & pack', 70);
    try {
      const vals: any = { cto_pack: pack, cto_pack_label: packDef.name, cto_pack_users: packDef.users + extraUsers };
      if (companyName) vals.name = companyName;
      for (const f of FICHE_FIELDS) if (fiche[f]) vals[f] = fiche[f];
      if (fiche.cto_if) vals.vat = fiche.cto_if;
      if (fiche.cto_ice) vals.company_registry = fiche.cto_ice;
      await setCompanyProfile(inst, name, adminPassword, vals);
    } catch (e: any) { profileWarning = String(e?.message || e); }
    if (logo) {
      try { await setCompanyProfile(inst, name, adminPassword, { logo }); }
      catch (e: any) { logoWarning = String(e?.message || e); }
    }
    onStep('Personnalisation', 82);
    try { await reapplyBranding(inst, name, adminPassword); }
    catch (e: any) { brandingWarning = String(e?.message || e); }
    if (extraDepots > 0) {
      try { await ensureWarehouses(inst, name, adminPassword, 1 + extraDepots); }
      catch (e: any) { depotWarning = String(e?.message || e); }
    }
    onStep('Messagerie', 88);
    try {
      await configureMailServer(inst, name, adminPassword, {
        host: inst.mailHost || 'cto_postfix', port: inst.mailPort || 587,
        encryption: inst.mailEncryption || 'none',
        domain: inst.mailDomain || inst.domain,
        defaultFromLocal: inst.mailDefaultFromLocal || 'contact',
      });
    } catch (e: any) { mailWarning = String(e?.message || e); }
    onStep('Compte client', 95);
    try {
      const ficheEmail = fiche.cto_manager_email;
      const login = ficheEmail || `gestion@${name}.${inst.domain}`;
      const adminName = fiche.cto_manager_name || 'Administrateur';
      const password = genPassword();
      await createTenantAdmin(inst, name, adminPassword, { login, name: adminName, password, lang: inst.defaultLang || 'fr_FR' });
      tenantAdmin = { login, password };
    } catch (e: any) { adminWarning = String(e?.message || e); }
  }

  return {
    name, pack, packLabel: packDef.name, url: `https://${name}.${inst.domain}`,
    admin: tenantAdmin || { login: 'admin', password: adminPassword },
    recovery: { login: 'admin', password: adminPassword },
    installed, extraUsers, extraDepots,
    localizationWarning, moduleWarning, profileWarning, logoWarning, brandingWarning, depotWarning, mailWarning, adminWarning,
  };
}
