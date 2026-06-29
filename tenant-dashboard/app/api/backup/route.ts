import { getInstance } from '@/lib/instances';
import { backupStream } from '@/lib/odoo';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function GET(request) {
  const id = request.nextUrl.searchParams.get('instance');
  const db = request.nextUrl.searchParams.get('db');
  try {
    const inst = getInstance(id);
    if (!db) throw new Error('db required');
    const stream = await backupStream(inst, db);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(stream as any, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${db}-${stamp}.zip"`,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
