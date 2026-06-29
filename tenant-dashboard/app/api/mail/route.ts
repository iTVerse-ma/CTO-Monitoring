import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { listDatabases } from '@/lib/pg';
import { configureMailServer } from '@/lib/odoo';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

// (Re)configure the outgoing-mail server on one tenant (`db`) or all of them
// (`all: true`) to use the internal Postfix smarthost (cto_postfix -> Brevo).
// Global From = contact@<maildomain>, Reply-To = author. Owner-only via the SSO gate.
function mailOpts(inst: any, _db: string) {
  return {
    host: inst.mailHost || 'cto_postfix',
    port: inst.mailPort || 587,
    encryption: inst.mailEncryption || 'none',
    domain: inst.mailDomain || inst.domain,
    defaultFromLocal: inst.mailDefaultFromLocal || 'contact',
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const inst = getInstance(body.instance);
    const adminPassword = inst.adminPassword;

    let targets: string[] = [];
    if (body.all) targets = (await listDatabases(inst)).map((d) => d.name);
    else if (body.db) targets = [String(body.db).trim()];
    else return NextResponse.json({ ok: false, error: 'db or all required' }, { status: 400 });

    const results: any[] = [];
    for (const db of targets) {
      try {
        const r = await configureMailServer(inst, db, adminPassword, mailOpts(inst, db));
        results.push({ db, ...r });
      } catch (e) {
        results.push({ db, configured: false, error: String((e as any).message || e) });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any).message || e) }, { status: 400 });
  }
}
