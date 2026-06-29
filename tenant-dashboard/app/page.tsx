import Link from 'next/link';
import { headers } from 'next/headers';
import { publicInstances } from '@/lib/instances';
import Console from './Console';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const h = await headers();
  // Set by Authentik forward-auth (Traefik) — who is logged in.
  const user = h.get('x-authentik-username') || h.get('x-authentik-email') || 'unknown';
  const instances = publicInstances();

  return (
    <>
      <header className="top">
        <h1>Connecteo One — Tenant Dashboard</h1>
        <div className="nav">
          <Link href="/docs">📘 Documentation Comptabilité</Link>
          <span className="who">signed in as <strong>{user}</strong></span>
        </div>
      </header>
      <main>
        <Console instances={instances} />
      </main>
    </>
  );
}
