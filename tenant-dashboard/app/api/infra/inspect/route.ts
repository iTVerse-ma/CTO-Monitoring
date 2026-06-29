import { NextResponse } from 'next/server';
import { inspectContainer } from '@/lib/infra';

export const dynamic = 'force-dynamic';

export async function GET(request: any) {
  const id = request.nextUrl.searchParams.get('id') || '';
  try {
    return NextResponse.json({ ok: true, info: await inspectContainer(id) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }
}
