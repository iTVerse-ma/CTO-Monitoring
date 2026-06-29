import { NextResponse } from 'next/server';
import { getInstance } from '@/lib/instances';
import { validateName } from '@/lib/validate';
import { databaseExists } from '@/lib/pg';
import { getPack } from '@/lib/packs';
import { enqueue, hasActiveJob, setRunner } from '@/lib/queue';
import { provisionOwner } from '@/lib/provision';

export const dynamic = 'force-dynamic';
// Now only validates + enqueues — the ~1 min provisioning runs in the background pump.
export const maxDuration = 60;

setRunner(provisionOwner);

// NON-BLOCKING create. Returns a jobId immediately; the queue (lib/queue) drains
// serially per instance so concurrent/rapid creates never collide on Postgres
// CREATE DATABASE or make the operator wait. Auth is enforced by Authentik SSO at
// the edge (owner-only), as for the rest of this console.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const packDef = getPack(body.pack) || getPack('start');
    if (!packDef) return NextResponse.json({ ok: false, error: 'no packs configured' }, { status: 400 });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const inst = getInstance(body.instance);

    const err = validateName(name);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    if (hasActiveJob(inst.id, name))
      return NextResponse.json({ ok: false, error: `« ${name} » est déjà en cours de création.` }, { status: 409 });
    if (await databaseExists(inst, name))
      return NextResponse.json({ ok: false, error: `database '${name}' already exists` }, { status: 409 });

    const job = enqueue({
      instance: inst.id, name, label: packDef.name,
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
