import { NextResponse } from 'next/server';
import { containerLogs } from '@/lib/infra';

export const dynamic = 'force-dynamic';

export async function GET(request: any) {
  const id = request.nextUrl.searchParams.get('id') || '';
  const tail = Number(request.nextUrl.searchParams.get('tail')) || 200;
  try {
    return NextResponse.json({ ok: true, logs: await containerLogs(id, tail) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }
}
