import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { validateName } from '@/lib/validate';
import { databaseExists } from '@/lib/pg';
import { getPack } from '@/lib/packs';
import { requestAllowed } from '@/lib/auth';
import { enqueue, hasActiveJob, setRunner } from '@/lib/queue';
import { provisionSales } from '@/lib/provision';

export const dynamic = 'force-dynamic';
// Now only validates + enqueues — the ~1 min provisioning runs in the background pump.
export const maxDuration = 60;

// Register the background provisioning runner once (module load).
setRunner(provisionSales);

// NON-BLOCKING create. The commercial gets an immediate jobId and can launch the next
// one right away; the queue (lib/queue) drains serially per instance so concurrent
// creates never collide on Postgres CREATE DATABASE or make anyone wait.
export async function POST(request: Request) {
  if (!requestAllowed(request))
    return NextResponse.json({ ok: false, error: 'Accès refusé (groupe « Commerciaux » requis).' }, { status: 403 });
  try {
    const body = await request.json();
    const packDef = getPack(body.pack) || getPack('start');
    if (!packDef) return NextResponse.json({ ok: false, error: 'aucun pack configuré' }, { status: 400 });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const inst = getInstance(body.instance); // throws for unknown/non-prod id -> caught -> 400

    const err = validateName(name);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    if (hasActiveJob(inst.id, name))
      return NextResponse.json({ ok: false, error: `« ${name} » est déjà en cours de création.` }, { status: 409 });
    if (await databaseExists(inst, name))
      return NextResponse.json({ ok: false, error: `Un client nommé « ${name} » existe déjà.` }, { status: 409 });

    const job = enqueue({
      instance: inst.id,
      name,
      label: packDef.name,
      payload: {
        instance: inst.id, name, pack: packDef.id,
        addons: body.addons, extraUsers: body.extraUsers, extraDepots: body.extraDepots,
        companyName: body.companyName, fiche: body.fiche, logo: body.logo,
      },
    });
    return NextResponse.json({ ok: true, queued: true, jobId: job.id, name }, { status: 202 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }
}
