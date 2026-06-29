import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getInstance } from '@/lib/instances';
import { validateName } from '@/lib/validate';
import { databaseExists } from '@/lib/pg';
import { getPack, CATALOG_BY_ID } from '@/lib/packs';
import { createDatabase, ensureLocalization, installModules, setCompanyProfile, reapplyBranding, createTenantAdmin, ensureWarehouses, configureMailServer } from '@/lib/odoo';
import { requestAllowed } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const BASE_MODULES = ['cto_branding', 'cto_security_profiles', 'cto_dashboard', 'cto_contacts', 'cto_accounting'];
const FICHE_FIELDS = ['cto_rc', 'cto_cnss', 'cto_patente',
  'cto_manager_name', 'cto_manager_role', 'cto_manager_phone', 'cto_manager_email'];

// Resolve add-on catalog ids (kind 'module') chosen in the wizard to Odoo modules.
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

// Create-only provisioning for the SALES team. Same flow as the owner console, with
// two security differences: (1) the response NEVER includes Connecteo's shared
// recovery/master credentials; (2) if the client's own admin can't be created we do
// NOT fall back to the shared admin — we return no creds + an escalation note.
export async function POST(request: Request) {
  if (!requestAllowed(request))
    return NextResponse.json({ ok: false, error: 'Accès refusé (groupe « Commerciaux » requis).' }, { status: 403 });
  try {
    const body = await request.json();
    const { instance, name, fiche } = body;
    const packDef = getPack(body.pack) || getPack('start');
    if (!packDef) return NextResponse.json({ ok: false, error: 'aucun pack configuré' }, { status: 400 });
    const pack = packDef.id;
    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
    const logo = typeof body.logo === 'string' && body.logo ? body.logo : null;
    const extraUsers = Math.max(0, Number.parseInt(body.extraUsers, 10) || 0);
    const extraDepots = Math.max(0, Number.parseInt(body.extraDepots, 10) || 0);
    const addons = addonModules(body.addons);
    const inst = getInstance(instance);

    const err = validateName(name);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    if (await databaseExists(inst, name))
      return NextResponse.json({ ok: false, error: `Un client nommé « ${name} » existe déjà.` }, { status: 409 });

    // Shared recovery admin (uid 2) password — used SERVER-SIDE ONLY, never returned.
    const adminPassword = inst.adminPassword || genPassword();
    await createDatabase(inst, name, adminPassword);

    // Country=MA + currency=MAD BEFORE the accounting modules install. Non-fatal.
    let localizationWarning = null;
    try {
      await ensureLocalization(inst, name, adminPassword, {
        countryCode: inst.defaultCountry || 'MA',
        currencyCode: inst.defaultCurrency || 'MAD',
      });
    } catch (e) { localizationWarning = String((e as any).message || e); }

    // Connecteo base + pack apps + chosen add-on modules.
    const modules = [...new Set([...BASE_MODULES, ...(packDef.modules || []), ...addons])].join(',');
    let installed: any[] = [];
    let moduleWarning = null;
    try {
      const r = await installModules(inst, name, adminPassword, modules);
      installed = r.installed;
    } catch (e) { moduleWarning = String((e as any).message || e); }

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
        if (fiche && fiche.cto_if) vals.vat = fiche.cto_if;
        if (fiche && fiche.cto_ice) vals.company_registry = fiche.cto_ice;
        await setCompanyProfile(inst, name, adminPassword, vals);
      } catch (e) { profileWarning = String((e as any).message || e); }
      if (logo) {
        try { await setCompanyProfile(inst, name, adminPassword, { logo }); }
        catch (e) { logoWarning = String((e as any).message || e); }
      }
      try { await reapplyBranding(inst, name, adminPassword); }
      catch (e) { brandingWarning = String((e as any).message || e); }
      if (extraDepots > 0) {
        try { await ensureWarehouses(inst, name, adminPassword, 1 + extraDepots); }
        catch (e) { depotWarning = String((e as any).message || e); }
      }
      // Outgoing mail: internal Postfix smarthost (cto_postfix -> Brevo). Authless
      // local relay, provisioned for EVERY tenant. Global From = contact@<domain>.
      try {
        await configureMailServer(inst, name, adminPassword, {
          host: inst.mailHost || 'cto_postfix', port: inst.mailPort || 587,
          encryption: inst.mailEncryption || 'none',
          domain: inst.mailDomain || inst.domain,
          defaultFromLocal: inst.mailDefaultFromLocal || 'contact',
        });
      } catch (e) { mailWarning = String((e as any).message || e); }
    }

    // The CLIENT's own Direction login. On failure we DO NOT expose the shared admin.
    let client: any = null;
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
        client = { login, password };
      } catch (e) { adminWarning = String((e as any).message || e); }
    } else {
      adminWarning = 'Modules non installés — compte client non créé.';
    }

    return NextResponse.json({
      ok: true,
      name,
      pack,
      packLabel: packDef.name,
      url: `https://${name}.${inst.domain}`,
      client, // { login, password } for the CLIENT — null if it couldn't be created
      installed,
      extraUsers,
      extraDepots,
      localizationWarning, moduleWarning, profileWarning, logoWarning, brandingWarning, depotWarning, mailWarning, adminWarning,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any).message || e) }, { status: 400 });
  }
}
