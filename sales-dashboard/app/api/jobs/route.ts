import { NextResponse } from 'next/server';
import { listJobs } from '@/lib/queue';
import { requestAllowed } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Poll target for the "Créations en cours" panel. Same Commerciaux gate as create.
export async function GET(request: Request) {
  if (!requestAllowed(request))
    return NextResponse.json({ ok: false, jobs: [] }, { status: 403 });
  return NextResponse.json({ ok: true, jobs: listJobs() });
}
