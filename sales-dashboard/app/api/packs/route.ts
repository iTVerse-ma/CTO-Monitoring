import { NextResponse } from 'next/server';
import { loadPacks } from '@/lib/packs';
import { requestAllowed } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Read-only catalog + packs for the create wizard. No PUT — commercials don't edit packs.
export async function GET(request: Request) {
  if (!requestAllowed(request))
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  try {
    const { catalog, packs } = loadPacks();
    return NextResponse.json({ ok: true, catalog, packs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any).message || e) }, { status: 400 });
  }
}
