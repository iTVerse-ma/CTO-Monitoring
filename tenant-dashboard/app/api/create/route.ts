import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getInstance } from '@/lib/instances';
import { validateName } from '@/lib/validate';
import { databaseExists } from '@/lib/pg';
import { getPack, CATALOG_BY_ID } from '@/lib/packs';
import { createDatabase, ensureLocalization, installModules, setCompanyProfile, reapplyBranding, createTenantAdmin, ensureWarehouses, configureMailServer } from '@/lib/odoo';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

// Always present: Connecteo white-label + the pack/profile model + the branded
// dashboard + the Clients/Fournisseurs split + Comptabilité (the flagship Moroccan
// accounting app — its app shell ships everywhere; billing of it is per-pack).
const BASE_MODULES = ['cto_branding', 'cto_security_profiles', 'cto_dashboard', 'cto_contacts', 'cto_accounting'];
// IF/ICE are written through to the company's partner (vat/company_registry) via the
// mirror below — not as res_company columns. The rest are plain res_company fields.
const FICHE_FIELDS = ['cto_rc', 'cto_cnss', 'cto_patente',
  'cto_manager_name', 'cto_manager_role', 'cto_manager_phone', 'cto_manager_email'];

// Resolve add-on catalog ids (kind 'module') chosen in the wizard to Odoo modules.
// Website is now just a catalog module ('site' -> 'website') — no special-casing.
function addonModules(ids: any): string[] {
  const out: string[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const c = CATALOG_BY_ID[id];
    if (c && c.kind === 'module' && c.module) out.push(c.module);
  }
  return out;
}

function genPassword() {
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { instance, name, fiche } = body;
    const packDef = getPack(body.pack) || getPack('start');
    if (!packDef) return NextResponse.json({ ok: false, error: 'no packs configured' }, { status: 400 });
    const pack = packDef.id;
    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
    const logo = typeof body.logo === 'string' && body.logo ? body.logo : null; // base64, no data-URL prefix
    const extraUsers = Math.max(0, Number.parseInt(body.extraUsers, 10) || 0);
    const extraDepots = Math.max(0, Number.parseInt(body.extraDepots, 10) || 0);
    const addons = addonModules(body.addons);
    const inst = getInstance(instance);

    const err = validateName(name);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    if (await databaseExists(inst, name))
      return NextResponse.json({ ok: false, error: `database '${name}' already exists` }, { status: 409 });

    // The default "admin" (uid 2) is Connecteo's shared recovery account — same
    // password on every tenant (configured in instances.json). The CLIENT logs in
    // with their own account below.
    const adminPassword = inst.adminPassword || genPassword();
    await createDatabase(inst, name, adminPassword);

    // Country=Morocco + currency=MAD BEFORE the accounting modules install, so the
    // Moroccan l10n_ma chart (PCM/CGNC) + legal TVA grid load. Non-fatal.
    let localizationWarning = null;
    try {
      await ensureLocalization(inst, name, adminPassword, {
        countryCode: inst.defaultCountry || 'MA',
        currencyCode: inst.defaultCurrency || 'MAD',
      });
    } catch (e) {
      localizationWarning = String((e as any).message || e);
    }

    // Install the Connecteo base + the pack's apps + the chosen add-on modules.
    const modules = [...new Set([...BASE_MODULES, ...(packDef.modules || []), ...addons])].join(',');
    let installed: string[] = [];
    let moduleWarning = null;
    try {
      const r = await installModules(inst, name, adminPassword, modules);
      installed = r.installed;
    } catch (e) {
      moduleWarning = String((e as any).message || e);
    }

    // Pack + included seats (pack users + sold extras) + client fiche on the company.
    let profileWarning = null;
    let logoWarning = null;
    let brandingWarning = null;
    let depotWarning = null;
    let mailWarning = null;
    if (!moduleWarning) {
      try {
        const vals: any = { cto_pack: pack, cto_pack_label: packDef.name, cto_pack_users: packDef.users + extraUsers };
        if (companyName) vals.name = companyName;
        for (const f of FICHE_FIELDS) if (fiche && fiche[f]) vals[f] = fiche[f];
        if (fiche && fiche.cto_if) vals.vat = fiche.cto_if;               // IF  -> native vat
        if (fiche && fiche.cto_ice) vals.company_registry = fiche.cto_ice; // ICE -> native company_registry
        await setCompanyProfile(inst, name, adminPassword, vals);
      } catch (e) {
        profileWarning = String((e as any).message || e);
      }
      if (logo) {
        try {
          await setCompanyProfile(inst, name, adminPassword, { logo });
        } catch (e) {
          logoWarning = String((e as any).message || e);
        }
      }
      try {
        await reapplyBranding(inst, name, adminPassword);
      } catch (e) {
        brandingWarning = String((e as any).message || e);
      }
      // Extra dépôts -> one stock warehouse each (needs the Stock app). Non-fatal.
      if (extraDepots > 0) {
        try {
          await ensureWarehouses(inst, name, adminPassword, 1 + extraDepots);
        } catch (e) {
          depotWarning = String((e as any).message || e);
        }
      }
      // Outgoing mail: internal Postfix smarthost (cto_postfix -> Brevo). Authless
      // local relay, provisioned for EVERY tenant. Global From = contact@<domain>,
      // Reply-To = author (via the mail.alias.domain). Non-fatal.
      try {
        await configureMailServer(inst, name, adminPassword, {
          host: inst.mailHost || 'cto_postfix', port: inst.mailPort || 587,
          encryption: inst.mailEncryption || 'none',
          domain: inst.mailDomain || inst.domain,
          defaultFromLocal: inst.mailDefaultFromLocal || 'contact',
        });
      } catch (e) {
        mailWarning = String((e as any).message || e);
      }
    }

    // The CLIENT's own admin (Direction). The default "admin" (uid 2) stays as a
    // hidden Connecteo recovery login; uid 1 (OdooBot) is inactive.
    let tenantAdmin = null;
    let adminWarning = null;
    if (!moduleWarning) {
      try {
        const ficheEmail = fiche && fiche.cto_manager_email;
        const login = ficheEmail || `gestion@${name}.${inst.domain}`;
        const adminName = (fiche && fiche.cto_manager_name) || 'Administrateur';
        const password = genPassword();
        await createTenantAdmin(inst, name, adminPassword, {
          login, name: adminName, password, lang: inst.defaultLang || 'fr_FR',
        });
        tenantAdmin = { login, password };
      } catch (e) {
        adminWarning = String((e as any).message || e);
      }
    }

    return NextResponse.json({
      ok: true,
      name,
      pack,
      packLabel: packDef.name,
      admin: tenantAdmin || { login: 'admin', password: adminPassword },
      recovery: { login: 'admin', password: adminPassword },
      installed,
      extraUsers,
      extraDepots,
      localizationWarning,
      moduleWarning,
      profileWarning,
      logoWarning,
      brandingWarning,
      depotWarning,
      mailWarning,
      adminWarning,
      url: `https://${name}.${inst.domain}`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any).message || e) }, { status: 400 });
  }
}
