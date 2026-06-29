import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { listDatabases, getTenantBilling } from '@/lib/pg';
import { getPack, computeBilling } from '@/lib/packs';

export const dynamic = 'force-dynamic';

const DAY_MS = 86400000;

export async function GET(request: any) {
  const id = request.nextUrl.searchParams.get('instance');
  try {
    const inst = getInstance(id);
    const dbs = await listDatabases(inst);
    // Enrich each tenant with billing DERIVED from its live state (pack, installed
    // modules, seats, warehouses). Parallel + best-effort: a tenant that can't be
    // read just comes back without billing info, never breaking the list.
    const enriched = await Promise.all(
      dbs.map(async (d) => {
        const b = await getTenantBilling(inst, d.name);
        if (!b || !b.installed) return { ...d, billing: null };
        const pack = b.pack ? getPack(b.pack) : null;
        const bill = pack ? computeBilling(pack, b) : null;
        const renewal = b.created ? new Date(new Date(b.created).getTime() + 30 * DAY_MS).toISOString() : null;
        return {
          ...d,
          created: b.created,
          renewal,
          packId: b.pack,
          packName: pack?.name || b.pack || null,
          monthly: bill ? bill.monthly : null,
          lines: bill ? bill.lines : [],
          // raw state for the per-tenant module editor
          installedModules: b.modules,
          packUsers: b.packUsers,
          warehouses: b.warehouses,
        };
      }),
    );
    return NextResponse.json({ ok: true, databases: enriched });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any).message || e) }, { status: 400 });
  }
}
