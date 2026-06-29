import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';

export const dynamic = 'force-dynamic';

// Returns the shared "admin" recovery password for an instance. Server-side only
// (the whole console is behind Authentik SSO); fetched on demand so the secret
// isn't baked into every page load. Connecteo-internal — never shown to tenants.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const inst = getInstance(searchParams.get('instance'));
    return NextResponse.json({
      ok: true,
      login: 'admin',
      password: inst.adminPassword || null,
      masterPassword: inst.masterPassword || null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}
