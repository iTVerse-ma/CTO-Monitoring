import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { validateName } from '@/lib/validate';
import { databaseExists } from '@/lib/pg';
import { restore } from '@/lib/odoo';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(request) {
  try {
    const form = await request.formData();
    const instance = form.get('instance');
    const name = form.get('name');
    const copy = form.get('copy') === 'true';
    const file = form.get('file');

    const inst = getInstance(instance);
    const err = validateName(name);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    if (!file || typeof file === 'string')
      return NextResponse.json({ ok: false, error: 'backup file required' }, { status: 400 });
    if (await databaseExists(inst, name))
      return NextResponse.json({ ok: false, error: `database '${name}' already exists` }, { status: 409 });

    await restore(inst, name, file, copy);
    return NextResponse.json({ ok: true, url: `https://${name}.${inst.domain}` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}
