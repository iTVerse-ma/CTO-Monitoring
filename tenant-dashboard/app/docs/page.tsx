import Link from 'next/link';
import { headers } from 'next/headers';

export const metadata = {
  title: 'Documentation — Comptabilité | Connecteo One',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

function Figure({ src, caption }) {
  return (
    <figure className="doc-figure">
      <img src={src} alt={caption} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default async function DocsPage() {
  const h = await headers();
  const user = h.get('x-authentik-username') || h.get('x-authentik-email') || 'propriétaire';

  const toc = [
    ['apercu', "Vue d'ensemble"],
    ['cgnc', 'Conformité marocaine'],
    ['etats', 'États de synthèse'],
    ['dynamiques', 'Rapports dynamiques'],
    ['tva', 'Déclaration de TVA'],
    ['edi', 'Télédéclaration EDI'],
    ['factures', 'Factures légales'],
    ['profils', 'Profils & accès'],
    ['cloture', 'Clôture & exercices'],
    ['utiliser', "Comment l'utiliser"],
    ['roadmap', 'Feuille de route'],
  ];

  return (
    <>
      <header className="top">
        <h1>Connecteo One — Documentation Comptabilité</h1>
        <div className="nav">
          <Link href="/">← Console</Link>
          <span className="who">{user}</span>
        </div>
      </header>

      <main className="doc">
        <div className="doc-hero">
          <h2>La Comptabilité marocaine de Connecteo One</h2>
          <p>
            L'application <strong>Comptabilité</strong> est le principal argument de vente de
            Connecteo One : une comptabilité <strong>conforme au plan comptable marocain (CGNC)</strong>,
            incluse dans <strong>tous les packs</strong> (Start, Pro, Max). Elle est prête dès la création
            d'un client — plan comptable marocain, TVA aux taux légaux, états de synthèse officiels,
            déclaration de TVA et mentions légales sur les factures.
          </p>
          <nav className="doc-toc">
            {toc.map(([id, label]) => (
              <a key={id} href={`#${id}`}>{label}</a>
            ))}
          </nav>
        </div>

        {/* ---------- Vue d'ensemble ---------- */}
        <section id="apercu" className="card doc">
          <h2>Vue d'ensemble</h2>
          <p className="lead">Ce qu'apporte l'application Comptabilité, et pour qui.</p>
          <p>
            Conçue pour les TPE/PME marocaines, la Comptabilité couvre le cycle complet : facturation
            client et fournisseur, encaissements, plan comptable marocain, TVA, immobilisations et
            amortissements, et l'édition des <strong>états de synthèse officiels</strong> (la liasse CGNC).
            Techniquement, c'est une couche Connecteo en marque blanche au-dessus d'une suite comptable
            éprouvée et de la localisation marocaine — invisible pour le client, qui ne voit que
            « Comptabilité ».
          </p>
          <ul>
            <li><strong>Incluse dans tous les packs</strong> — pas une option, c'est le socle.</li>
            <li><strong>Marocaine dès la création</strong> du client (plan CGNC + TVA légale chargés automatiquement).</li>
            <li><strong>Accès par profil</strong> : Direction → Responsable comptable, Gestion → Comptable, Consultation → Auditeur (lecture seule).</li>
          </ul>
        </section>

        {/* ---------- Conformité ---------- */}
        <section id="cgnc" className="card doc">
          <h2>Conformité marocaine (CGNC) <span className="badge done">en place</span></h2>
          <p className="lead">Le cœur réglementaire, chargé automatiquement à la création du client.</p>
          <table className="kv">
            <tbody>
              <tr><td>Plan comptable</td><td>Plan Comptable Marocain (PCM/CGNC) — <strong>639 comptes</strong>, classes 1 à 7, au lieu d'un plan générique.</td></tr>
              <tr><td>TVA</td><td>Grille légale <strong>20 % / 14 % / 10 % / 7 %</strong> (+ exonéré / hors-champ), avec les étiquettes de déclaration DGI sur chaque écriture.</td></tr>
              <tr><td>Devise & langue</td><td>Dirham (MAD) et français, par défaut.</td></tr>
              <tr><td>Comment</td><td>Le pays (Maroc) et la devise (MAD) sont posés <em>avant</em> l'installation du moteur comptable, ce qui déclenche le chargement automatique du plan marocain.</td></tr>
            </tbody>
          </table>
          <div className="callout">
            La classification CGNC (masses, rubriques, postes) est pilotée par le <strong>code comptable</strong>,
            donc les comptes du plan marocain alimentent automatiquement le Bilan, le CPC et la déclaration de TVA.
          </div>
        </section>

        {/* ---------- États de synthèse ---------- */}
        <section id="etats" className="card doc">
          <h2>États de synthèse — la liasse CGNC <span className="badge done">Modèle Normal</span></h2>
          <p className="lead">
            Les cinq états officiels, édités pour la période choisie depuis
            <span className="pill">Comptabilité → États de synthèse (Maroc)</span>.
          </p>

          <h3>Bilan — 3 colonnes (Brut / Amortissements &amp; Provisions / Net) + N-1</h3>
          <p>
            Le Bilan officiel marocain : côté Actif, les trois colonnes réglementaires (valeur brute,
            amortissements et provisions, valeur nette) ; côté Passif en net ; avec la colonne de
            l'exercice précédent. Le résultat de l'exercice est reporté dans les capitaux propres et
            l'<strong>Actif est toujours égal au Passif</strong>.
          </p>
          <Figure src="/docs/bilan.png" caption="Bilan complet — Actif (3 colonnes : Brut / Amort. & Prov. / Net) et Passif." />

          <h3>CPC — Compte de Produits et Charges, en cascade</h3>
          <p>
            Le CPC enchaîne les résultats successifs : résultat d'exploitation → financier → courant →
            non courant → avant impôts → <strong>résultat net</strong>.
          </p>
          <Figure src="/docs/cpc.png" caption="CPC en cascade jusqu'au résultat net de l'exercice." />

          <h3>ESG, Tableau de financement, ETIC</h3>
          <p>
            L'<strong>ESG</strong> (État des Soldes de Gestion) déroule la formation du résultat (marge brute,
            valeur ajoutée, EBE) et la capacité d'autofinancement (CAF). Le <strong>Tableau de financement</strong>
            présente la synthèse des masses du bilan (fonds de roulement, besoin de financement, trésorerie
            nette). L'<strong>ETIC</strong> regroupe les tableaux calculés (immobilisations, amortissements,
            provisions, créances, dettes, TVA) et un modèle pour les notes qualitatives.
          </p>
          <div className="doc-figrow">
            <Figure src="/docs/esg.png" caption="ESG — Tableau de Formation des Résultats + CAF." />
            <Figure src="/docs/tf.png" caption="Tableau de financement — synthèse des masses du bilan." />
          </div>
          <Figure src="/docs/etic.png" caption="ETIC — tableaux calculés (immobilisations, provisions, créances, dettes, TVA) + notes." />
        </section>

        {/* ---------- Rapports dynamiques ---------- */}
        <section id="dynamiques" className="card doc">
          <h2>Rapports dynamiques <span className="badge done">interactif</span></h2>
          <p className="lead">
            Des rapports comptables interactifs, consultables à l'écran et exportables, en complément
            des états de synthèse réglementaires.
          </p>
          <p>
            Depuis <span className="pill">Comptabilité → Rapports dynamiques</span> : Grand livre, Balance
            générale, Bilan, Compte de résultat (CPC), Grand livre auxiliaire, livres de banque et de caisse,
            balances âgées clients et fournisseurs, et rapport de TVA — avec filtres de période, dépliage des
            écritures jusqu'à la pièce, et export.
          </p>
        </section>

        {/* ---------- TVA ---------- */}
        <section id="tva" className="card doc">
          <h2>Déclaration de TVA <span className="badge done">éditable</span></h2>
          <p className="lead">Déclaration périodique (mensuelle ou trimestrielle) + relevé des déductions.</p>
          <p>
            La déclaration agrège les écritures de la période : <strong>TVA exigible par taux</strong>
            (chiffre d'affaires taxable), <strong>TVA déductible</strong> ventilée entre immobilisations et
            charges, et le solde <strong>TVA due / crédit de TVA</strong>. Le <strong>relevé des déductions</strong>
            liste les factures d'achat (fournisseur, IF/ICE, montants HT/TVA/TTC).
          </p>
          <Figure src="/docs/tva.png" caption="Déclaration de TVA — exigible par taux, déductible immobilisations/charges, TVA due, relevé des déductions." />
          <div className="callout">
            Les chiffres de cette déclaration (CA ventilé, TVA exigible / déductible, TVA due) sont ceux à
            reporter dans le <strong>formulaire CA3 en ligne</strong> de SIMPL-TVA ; les relevés détaillés s'y
            joignent via les <strong>exports EDI</strong> — voir <a href="#edi">Télédéclaration EDI</a> ci-dessous.
          </div>
        </section>

        {/* ---------- EDI / SIMPL-TVA ---------- */}
        <section id="edi" className="card doc">
          <h2>Télédéclaration EDI — SIMPL-TVA <span className="badge done">exports prêts</span></h2>
          <p className="lead">
            Génération des fichiers EDI de la DGI (téléprocédure SIMPL-TVA, mode EDI), chacun emballé dans
            le <strong>.zip</strong> attendu par le portail.
          </p>
          <p>
            Depuis <span className="pill">États fiscaux (Maroc) → Déclaration de TVA (Maroc)</span>, après
            avoir choisi la période, six relevés EDI sont téléchargeables :
          </p>
          <table>
            <thead><tr><th>Relevé EDI</th><th>Contenu</th><th>Quand</th></tr></thead>
            <tbody>
              <tr><td className="name">Relevé des déductions</td><td>Factures d'achat à TVA déductible</td><td>Avec chaque déclaration</td></tr>
              <tr><td className="name">Retenue à la source — versement</td><td>TVA retenue à la source reversée au Trésor</td><td>Si retenue à la source</td></tr>
              <tr><td className="name">Retenue à la source — relevé détaillé</td><td>Détail des opérations avec retenue (ventes)</td><td>Si retenue à la source</td></tr>
              <tr><td className="name">Auto-liquidation</td><td>Opérations en auto-liquidation</td><td>Si auto-liquidation</td></tr>
              <tr><td className="name">Clients débiteurs</td><td>Créances clients impayées en fin d'année + TVA</td><td>Annuel (régime d'encaissement)</td></tr>
              <tr><td className="name">Non-résidents</td><td>Fournisseurs étrangers avec TVA (+ redevances)</td><td>Si opérations avec non-résidents</td></tr>
            </tbody>
          </table>
          <div className="callout">
            Les fichiers respectent les <strong>cahiers des charges EDI officiels de la DGI</strong> (SIMPL-TVA).
            <strong> Conformité auditée le 23/06/2026</strong> contre les pièces officielles : la retenue à la
            source (versement et relevé détaillé) et l'auto-liquidation sont <strong>validées contre le schéma
            XSD</strong> de la DGI ; le relevé des déductions, les clients débiteurs et les non-résidents sont
            conformes à la structure de l'<strong>exemple XML officiel</strong> (la DGI ne publie pas de XSD pour
            ces trois). Relevé des déductions, clients débiteurs et non-résidents se calculent automatiquement ;
            retenue à la source et auto-liquidation lisent les écritures dont la taxe est <strong>marquée</strong>
            en conséquence (régimes que la comptabilité standard ne modélise pas).
          </div>
          <div className="callout warn">
            <strong>Dépôt sur le portail SIMPL-TVA.</strong> Créez d'abord la déclaration de la période
            <em> à l'état brouillon</em>, puis déposez le <strong>.zip</strong> via <em>Envoi EDI</em>.
            L'identifiant fiscal contenu dans le fichier doit être <strong>identique à celui de l'adhérent</strong> :
            l'IF de la fiche société doit donc être correctement renseigné, sinon le portail rejette le dépôt.
          </div>
          <div className="callout warn">
            Reste à valider côté DGI : un <strong>compte SIMPL de test</strong> pour confirmer un dépôt réel de
            bout en bout. Les fichiers générés sont conformes aux cahiers des charges publiés.
          </div>
        </section>

        {/* ---------- Factures ---------- */}
        <section id="factures" className="card doc">
          <h2>Factures — mentions légales <span className="badge done">en place</span></h2>
          <p>
            Les factures portent les <strong>identifiants légaux des deux parties</strong> exigés au Maroc :
            Identifiant Fiscal (IF), ICE, Registre de Commerce (RC), Patente et CNSS. Ils sont renseignés
            depuis la fiche société et la fiche client/fournisseur.
          </p>
          <Figure src="/docs/facture.png" caption="Facture client avec le bloc des identifiants légaux (IF / ICE / RC / Patente / CNSS)." />
        </section>

        {/* ---------- Profils ---------- */}
        <section id="profils" className="card doc">
          <h2>Profils &amp; accès</h2>
          <p className="lead">L'accès comptable suit automatiquement le profil Connecteo du collaborateur.</p>
          <table>
            <thead><tr><th>Profil Connecteo</th><th>Rôle comptable</th><th>Droits</th></tr></thead>
            <tbody>
              <tr><td className="name">Direction</td><td>Responsable comptable</td><td>Comptabilité complète + paramétrage</td></tr>
              <tr><td className="name">Gestion</td><td>Comptable</td><td>Saisie quotidienne + facturation</td></tr>
              <tr><td className="name">Consultation</td><td>Auditeur</td><td>Lecture seule (édition des états incluse)</td></tr>
            </tbody>
          </table>
        </section>

        {/* ---------- Clôture ---------- */}
        <section id="cloture" className="card doc">
          <h2>Clôture &amp; exercices <span className="badge done">en place</span></h2>
          <ul>
            <li><strong>Exercice comptable</strong> créé automatiquement à la création du client (année civile).</li>
            <li><strong>Dates de verrouillage</strong> : la clôture fige les écritures jusqu'à une date donnée (exercice + TVA), les rendant inaltérables — exigence légale CGNC.</li>
            <li><strong>Numérotation séquentielle</strong> des pièces (ex. FAC/2026/00001), chronologique et sans rupture.</li>
          </ul>
          <div className="callout warn">
            La <strong>conservation légale de 10 ans</strong> relève de la politique de sauvegarde
            (infrastructure), au-delà des sauvegardes courantes.
          </div>
        </section>

        {/* ---------- Comment l'utiliser ---------- */}
        <section id="utiliser" className="card doc">
          <h2>Comment l'utiliser</h2>
          <h3>Éditer un état de synthèse</h3>
          <p>
            Ouvrez l'application <strong>Comptabilité</strong>, puis le menu
            <span className="pill">États fiscaux (Maroc) → États de synthèse (Maroc)</span>.
            Choisissez la période (et la comparaison N-1 si besoin), puis cliquez sur l'état voulu
            (Bilan, CPC, ESG, Tableau de financement, ETIC). Le PDF est généré immédiatement.
          </p>
          <h3>Éditer la déclaration de TVA</h3>
          <p>
            Menu <span className="pill">États fiscaux (Maroc) → Déclaration de TVA (Maroc)</span> :
            choisissez l'année, la périodicité (mensuelle / trimestrielle) et la période, puis éditez
            la déclaration.
          </p>
          <h3>Exporter un relevé EDI (SIMPL-TVA)</h3>
          <p>
            Sur le même écran <span className="pill">Déclaration de TVA (Maroc)</span>, dans la section
            <em> Exports EDI</em>, cliquez sur le relevé voulu (relevé des déductions, retenue à la source,
            auto-liquidation, clients débiteurs, non-résidents). Un fichier <strong>.zip</strong> conforme
            au format DGI est téléchargé, prêt à déposer sur le portail SIMPL-TVA (mode EDI).
          </p>
          <p>
            Côté portail : créez la déclaration de la période <strong>en brouillon</strong>, puis ouvrez
            <span className="pill">Envoi EDI</span> pour téléverser le <strong>.zip</strong>. Le suivi est
            visible dans <em>Suivi Envoi EDI</em> (état « Traité » ou « Rejeté »). En cas de rejet « identifiant
            fiscal incorrect », vérifiez l'IF de la fiche société : il doit correspondre exactement à celui de
            l'adhérent SIMPL.
          </p>
        </section>

        {/* ---------- Roadmap ---------- */}
        <section id="roadmap" className="card doc">
          <h2>Feuille de route</h2>
          <table className="kv">
            <tbody>
              <tr><td><span className="badge done">Fait</span></td><td>Liasse CGNC complète (Bilan 3 colonnes, CPC, ESG, Tableau de financement, ETIC), déclaration de TVA, rapports dynamiques, mentions légales, clôture / exercices.</td></tr>
              <tr><td><span className="badge done">Fait</span></td><td>Exports <strong>EDI SIMPL-TVA</strong> : relevé des déductions, retenue à la source (versement + relevé détaillé), auto-liquidation, clients débiteurs, non-résidents — conformes aux cahiers des charges DGI (audit du 23/06/2026 : 3 validés contre le schéma XSD, 3 conformes à l'exemple XML officiel).</td></tr>
              <tr><td><span className="badge block">DGI requis</span></td><td>Dépôt réel sur <strong>SIMPL-TVA</strong> — nécessite un compte SIMPL de test pour valider la transmission.</td></tr>
              <tr><td><span className="badge soon">~2027</span></td><td><strong>Facture électronique</strong> — format publié (UBL 2.1 / CII, plateforme nationale <strong>xHub</strong>, bac à sable disponible) ; reste l'onboarding xHub. Obligation progressive (grandes entreprises 2026, PME/TPE ~2027-2028).</td></tr>
            </tbody>
          </table>
        </section>

        <p className="muted" style={{ textAlign: 'center', margin: '24px 0' }}>
          Connecteo One — documentation interne. <Link href="/">Retour à la console</Link>
        </p>
      </main>
    </>
  );
}
