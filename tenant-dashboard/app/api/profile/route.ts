import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { getCompanyProfile, updateCompanyProfile } from '@/lib/pg';
import { setCompanyProfile } from '@/lib/odoo';

export const dynamic = 'force-dynamic';

// Read a tenant's Connecteo One profile (pack + client fiche) straight from its
// res.company columns. ?instance=<id>&db=<tenant>
export async function GET(request) {
  const id = request.nextUrl.searchParams.get('instance');
  const db = request.nextUrl.searchParams.get('db');
  try {
    const inst = getInstance(id);
    if (!db) throw new Error('missing db');
    const r = await getCompanyProfile(inst, db);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}

// Write a tenant's profile. Body: { instance, db, vals: {cto_pack, name, logo, ...} }
// The pack id/label/users + fiche + company name go straight to Postgres; the logo
// (Binary) is written through Odoo's authenticated call_kw. Note: changing the pack
// here updates metadata only — a pack's apps are installed at tenant CREATION, not
// re-installed on later pack changes.
export async function POST(request) {
  try {
    const { instance, db, vals } = await request.json();
    const inst = getInstance(instance);
    if (!db) throw new Error('missing db');
    const { logo, ...rest } = vals || {};
    const r = await updateCompanyProfile(inst, db, rest);
    let logoUpdated = false;
    let logoWarning = null;
    if (typeof logo === 'string' && logo) {
      // Authenticate as the shared admin (uid 2) and write the Binary logo field.
      // Non-fatal: a bad image must not fail the fiche save (already committed above).
      try {
        await setCompanyProfile(inst, db, inst.adminPassword, { logo });
        logoUpdated = true;
      } catch (e) {
        logoWarning = String(e.message || e);
      }
    }
    return NextResponse.json({ ok: true, ...r, logoUpdated, logoWarning });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}
