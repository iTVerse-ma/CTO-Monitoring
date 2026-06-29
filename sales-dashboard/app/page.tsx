import { currentUser } from '@/lib/auth';
import { publicInstances } from '@/lib/instances';
import { loadPacks } from '@/lib/packs';
import Create from './Create';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await currentUser();
  if (!user.allowed) {
    return (
      <main className="forbidden">
        <h1>Accès réservé</h1>
        <p>Cet espace est réservé à l&apos;équipe commerciale (groupe «&nbsp;Commerciaux&nbsp;»).</p>
        <p className="muted">Connecté en tant que <strong>{user.username}</strong>. Demandez l&apos;accès à un administrateur.</p>
      </main>
    );
  }
  const instances = publicInstances();
  const { packs, catalog } = loadPacks();
  return <Create instances={instances} packs={packs} catalog={catalog} user={user.username} />;
}
