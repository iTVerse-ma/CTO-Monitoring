import { NextResponse } from 'next/server';
import { loadPacks, savePacks } from '@/lib/packs';

export const dynamic = 'force-dynamic';

// Pack catalog + the three packs. Global (not per-instance), holds no secrets.
export async function GET() {
  try {
    const { catalog, packs } = loadPacks();
    return NextResponse.json({ ok: true, catalog, packs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any).message || e) }, { status: 400 });
  }
}

// Persist the editable bits of the three packs (modules / features / users).
// Names, prices and the catalog are fixed in code. Owner-only via the SSO gate.
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const saved = savePacks(body);
    return NextResponse.json({ ok: true, ...saved });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any).message || e) }, { status: 400 });
  }
}
