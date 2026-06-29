import Link from 'next/link';
import { headers } from 'next/headers';
import Infra from '../Infra';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connecteo One — Infra', robots: { index: false, follow: false } };

export default async function Page() {
  const h = await headers();
  const user = h.get('x-authentik-username') || h.get('x-authentik-email') || 'unknown';
  return (
    <>
      <header className="top">
        <h1>Connecteo One — Infrastructure</h1>
        <div className="nav">
          <Link href="/">← Tenants</Link>
          <span className="who">signed in as <strong>{user}</strong></span>
        </div>
      </header>
      <main>
        <Infra />
      </main>
    </>
  );
}
