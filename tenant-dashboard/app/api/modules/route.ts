import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { CATALOG_BY_ID } from '@/lib/packs';
import { installModules, uninstallModules, setPackUsers, ensureWarehouses } from '@/lib/odoo';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

// Resolve add-on catalog ids (kind 'module') to Odoo module names.
function modulesFor(ids: any): string[] {
  const out: string[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const c = CATALOG_BY_ID[id];
    if (c && c.kind === 'module' && c.module) out.push(c.module);
  }
  return out;
}

// Modify an existing tenant's subscription: add/remove add-on modules, change the
// seat count, add dépôts. Owner-only (same SSO gate as the rest of the console).
// NOTE: uninstalling an Odoo app is destructive (drops its data) — the UI confirms.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const inst = getInstance(body.instance);
    const db = String(body.db || '').trim();
    if (!db) return NextResponse.json({ ok: false, error: 'db required' }, { status: 400 });
    const adminPassword = inst.adminPassword;
    if (!adminPassword) return NextResponse.json({ ok: false, error: 'no shared admin password configured' }, { status: 400 });

    const toInstall = modulesFor(body.install);
    const toUninstall = modulesFor(body.uninstall).filter((m) => !toInstall.includes(m));
    const result: any = {};

    if (toInstall.length) result.installed = (await installModules(inst, db, adminPassword, toInstall.join(','))).installed;
    if (toUninstall.length) result.uninstalled = (await uninstallModules(inst, db, adminPassword, toUninstall.join(','))).uninstalled;
    if (body.packUsers !== undefined && body.packUsers !== null && body.packUsers !== '')
      result.packUsers = (await setPackUsers(inst, db, adminPassword, body.packUsers)).cto_pack_users;
    if (body.extraDepots !== undefined && Number(body.extraDepots) > 0)
      result.warehouses = (await ensureWarehouses(inst, db, adminPassword, 1 + Number(body.extraDepots))).warehouses;

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any).message || e) }, { status: 400 });
  }
}
