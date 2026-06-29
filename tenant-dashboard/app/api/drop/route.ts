import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { dropDatabase } from '@/lib/odoo';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request) {
  try {
    const { instance, name } = await request.json();
    const inst = getInstance(instance);
    if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
    await dropDatabase(inst, name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}
