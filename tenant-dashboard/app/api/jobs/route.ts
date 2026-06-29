import { NextResponse } from 'next/server';
import { listJobs } from '@/lib/queue';

export const dynamic = 'force-dynamic';

// Poll target for the "Créations en cours" panel. Owner-only via Authentik SSO (edge).
export async function GET() {
  return NextResponse.json({ ok: true, jobs: listJobs() });
}
