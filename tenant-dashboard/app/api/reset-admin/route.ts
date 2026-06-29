import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getInstance } from '@/lib/instances';
import { resetTenantAdmin } from '@/lib/odoo';

export const dynamic = 'force-dynamic';

function genPassword() {
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

export async function POST(request) {
  try {
    const { instance, db } = await request.json();
    const inst = getInstance(instance);
    const password = genPassword();
    const r = await resetTenantAdmin(inst, db, inst.adminPassword, password);
    return NextResponse.json({ ok: true, db, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}
