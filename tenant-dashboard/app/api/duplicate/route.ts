import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { validateName } from '@/lib/validate';
import { databaseExists } from '@/lib/pg';
import { duplicateDatabase } from '@/lib/odoo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  try {
    const { instance, name, newName } = await request.json();
    const inst = getInstance(instance);
    const err = validateName(newName);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    if (await databaseExists(inst, newName))
      return NextResponse.json({ ok: false, error: `database '${newName}' already exists` }, { status: 409 });
    await duplicateDatabase(inst, name, newName);
    return NextResponse.json({ ok: true, url: `https://${newName}.${inst.domain}` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}
