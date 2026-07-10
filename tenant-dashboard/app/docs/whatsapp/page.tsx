import Link from 'next/link';
import { headers } from 'next/headers';

export const metadata = {
  title: 'Documentation — WhatsApp | Connecteo One',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

function Code({ children }: { children: string }) {
  return (
    <pre className="doc-code">
      <code>{children}</code>
    </pre>
  );
}

export default async function WhatsappDocsPage() {
  const h = await headers();
  const user = h.get('x-authentik-username') || h.get('x-authentik-email') || 'propriétaire';

  const toc: [string, string][] = [
    ['emplacement', 'Où sont les modèles'],
    ['principe', 'Message + pièce jointe'],
    ['creer', 'Créer un modèle (en-tête document)'],
    ['envoi', "Envoi d'un message"],
    ['supprimer', 'Supprimer un modèle'],
    ['odoo', 'Réglages côté Odoo'],
    ['pieges', 'Pièges à connaître'],
  ];

  return (
    <>
      <header className="top">
        <h1>Connecteo One — Documentation WhatsApp</h1>
        <div className="nav">
          <Link href="/">← Console</Link>
          <Link href="/docs">📘 Comptabilité</Link>
          <span className="who">{user}</span>
        </div>
      </header>

      <main className="doc">
        <div className="doc-hero">
          <h2>Les modèles de message WhatsApp</h2>
          <p>
            Connecteo One envoie des messages WhatsApp <strong>via l'API officielle Meta (Cloud API)</strong>,
            en <strong>émission seule</strong> : confirmation de commande et facture prête, avec le
            <strong> PDF joint</strong>. Tout envoi à l'initiative de l'entreprise passe par un
            <strong> modèle pré-approuvé</strong> par Meta. Cette page explique où vivent ces modèles et
            comment les créer, les envoyer et les supprimer — <strong>par l'API Graph</strong>, car sur le
            numéro de test le WABA est masqué dans l'interface Meta.
          </p>
          <nav className="doc-toc">
            {toc.map(([id, label]) => (
              <a key={id} href={`#${id}`}>{label}</a>
            ))}
          </nav>
        </div>

        {/* ---------- Emplacement ---------- */}
        <section id="emplacement" className="card doc">
          <h2>Où sont les modèles <span className="badge block">API uniquement (test)</span></h2>
          <p className="lead">
            Les modèles que le module envoie vivent sur un <strong>WABA app-scoped</strong> — donc
            <strong> invisible dans le Gestionnaire WhatsApp / Business Suite</strong> (cette interface ouvre un
            <em> autre</em> WABA). On les gère par l'API Graph.
          </p>
          <table className="kv">
            <tbody>
              <tr><td>Application Meta</td><td><strong>WhaTest</strong> — <code>1497669001640339</code></td></tr>
              <tr><td>WABA (test, app-scoped)</td><td><code>1204731505116845</code></td></tr>
              <tr><td>Numéro</td><td>+1 555-166-4142 — <code>phone_number_id</code> = <code>1179334308601528</code></td></tr>
              <tr><td>Version Graph</td><td><code>v23.0</code></td></tr>
              <tr><td>Modèles en service</td><td><code>commande_prete_doc</code> (commande + PDF), <code>facture_prete_doc</code> (facture + PDF)</td></tr>
            </tbody>
          </table>
          <div className="callout warn">
            <strong>Deux WABA, mêmes noms.</strong> Le WABA <em>business</em> peut porter ses propres
            <code>commande_prete</code>/<code>facture_prete</code> (souvent classés <em>Marketing</em>, exigeant
            un moyen de paiement) — <strong>ce ne sont PAS</strong> ceux qu'envoie le module. Odoo est épinglé au
            WABA de <code>cto_whatsapp.waba_id</code>. En production, un vrai WABA business + numéro rendra les
            modèles visibles dans l'interface Meta ; cette recette reste valable et scriptable.
          </div>
        </section>

        {/* ---------- Principe ---------- */}
        <section id="principe" className="card doc">
          <h2>Message + pièce jointe = modèle à en-tête « Document »</h2>
          <p>
            Sur la Cloud API, un envoi à l'initiative de l'entreprise ne peut porter un fichier que si le
            <strong> modèle possède un en-tête de type DOCUMENT</strong>. Le message libre avec pièce jointe
            (<code>type:document</code>) n'est possible que dans la <strong>fenêtre de service de 24 h</strong>
            après que le client a écrit — inutilisable en émission seule. D'où des modèles
            <strong> <code>*_doc</code></strong> avec en-tête document : le PDF s'affiche en haut, le texte en dessous.
          </p>
          <ul>
            <li><strong>Corps</strong> à 3 variables : <code>{'{{1}}'}</code> = client, <code>{'{{2}}'}</code> = référence (BC / facture), <code>{'{{3}}'}</code> = montant.</li>
            <li><strong>Catégorie UTILITY</strong> (transactionnel) : approuvée en minutes, <strong>sans moyen de paiement</strong> (MARKETING en exigerait un).</li>
            <li>La pièce du modèle a besoin d'un <strong>exemple</strong> de document (un <code>header_handle</code>) obtenu par un upload résumable.</li>
          </ul>
        </section>

        {/* ---------- Créer ---------- */}
        <section id="creer" className="card doc">
          <h2>Créer un modèle à en-tête document</h2>
          <p className="lead">Variables shell utilisées ci-dessous :</p>
          <Code>{String.raw`TOKEN='<jeton-utilisateur-systeme>'   # perms whatsapp_business_messaging + _management
V=v23.0
APP_ID=1497669001640339
WABA=1204731505116845
PHONE_NUMBER_ID=1179334308601528`}</Code>

          <h3><span className="stepnum">1</span>Upload résumable d'un PDF exemple → <code>header_handle</code></h3>
          <Code>{String.raw`PDF=./exemple.pdf

# a) ouvrir une session d'upload  ->  {"id":"upload:..."}
SID=$(curl -s -X POST \
  "https://graph.facebook.com/$V/$APP_ID/uploads?file_name=exemple.pdf&file_length=$(wc -c < "$PDF")&file_type=application%2Fpdf&access_token=$TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# b) téléverser les octets  ->  {"h":"<handle>"}   (Authorization: OAuth, pas Bearer)
HANDLE=$(curl -s -X POST "https://graph.facebook.com/$V/$SID" \
  -H "Authorization: OAuth $TOKEN" -H "file_offset: 0" \
  --data-binary "@$PDF" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["h"])')`}</Code>

          <h3><span className="stepnum">2</span>Créer le modèle (utilise <code>$HANDLE</code>)</h3>
          <p><strong><code>commande_prete_doc</code></strong> — commandes :</p>
          <Code>{String.raw`curl -s -X POST "https://graph.facebook.com/$V/$WABA/message_templates" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- <<JSON
{
  "name": "commande_prete_doc",
  "language": "fr",
  "category": "UTILITY",
  "components": [
    { "type": "HEADER", "format": "DOCUMENT", "example": { "header_handle": ["$HANDLE"] } },
    { "type": "BODY",
      "text": "Bonjour {{1}}, votre commande {{2}} d'un montant de {{3}} est prête.",
      "example": { "body_text": [["Agence Voyage Sahara Tours","S00005","5 700,00 DH"]] } }
  ]
}
JSON`}</Code>
          <p><strong><code>facture_prete_doc</code></strong> — factures (même forme, texte facture) :</p>
          <Code>{String.raw`curl -s -X POST "https://graph.facebook.com/$V/$WABA/message_templates" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- <<JSON
{
  "name": "facture_prete_doc",
  "language": "fr",
  "category": "UTILITY",
  "components": [
    { "type": "HEADER", "format": "DOCUMENT", "example": { "header_handle": ["$HANDLE"] } },
    { "type": "BODY",
      "text": "Bonjour {{1}}, votre facture {{2}} d'un montant de {{3}} est disponible.",
      "example": { "body_text": [["Agence Voyage Sahara Tours","FAC/2026/00095","1 234,00 DH"]] } }
  ]
}
JSON`}</Code>
          <p>
            Réponse : <code>{'{"id":…, "status":"PENDING", "category":"UTILITY"}'}</code>. Suivre l'approbation :
          </p>
          <Code>{String.raw`curl -s "https://graph.facebook.com/$V/$WABA/message_templates?fields=name,status,category&access_token=$TOKEN" \
  | python3 -m json.tool`}</Code>
          <div className="callout">
            Le corps du <code>&lt;&lt;JSON</code> est un <em>heredoc non quoté</em> : <code>$HANDLE</code> est
            substitué, tandis que <code>{'{{1}}'}</code> et l'apostrophe de <code>d'un</code> restent littéraux —
            pas d'échappement pénible.
          </div>
        </section>

        {/* ---------- Envoi ---------- */}
        <section id="envoi" className="card doc">
          <h2>Envoi d'un message (ce que fait le module)</h2>
          <p>
            À l'envoi, <code>cto_whatsapp</code> téléverse le vrai PDF puis place son <code>media_id</code> dans
            l'en-tête document du modèle. Manuellement :
          </p>
          <Code>{String.raw`# téléverser le vrai document  ->  media_id (valable ~30 j, réutilisable)
MEDIA_ID=$(curl -s -X POST "https://graph.facebook.com/$V/$PHONE_NUMBER_ID/media" \
  -H "Authorization: Bearer $TOKEN" \
  -F messaging_product=whatsapp -F type=application/pdf \
  -F file=@./Commande_S00005.pdf \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# envoyer le modèle avec l'en-tête document
curl -s -X POST "https://graph.facebook.com/$V/$PHONE_NUMBER_ID/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- <<JSON
{
  "messaging_product": "whatsapp",
  "to": "212706863487",
  "type": "template",
  "template": {
    "name": "commande_prete_doc",
    "language": { "code": "fr" },
    "components": [
      { "type": "header", "parameters": [
          { "type": "document", "document": { "id": "$MEDIA_ID", "filename": "Commande S00005.pdf" } } ] },
      { "type": "body", "parameters": [
          { "type": "text", "text": "Agence Voyage Sahara Tours" },
          { "type": "text", "text": "S00005" },
          { "type": "text", "text": "5 700,00 DH" } ] }
    ]
  }
}
JSON`}</Code>
          <p>
            Succès → <code>{'{"messages":[{"id":"wamid…"}]}'}</code>. Sur le numéro de <strong>test</strong>, le
            destinataire doit être <strong>whitelisté</strong> (Gestionnaire WhatsApp → numéro de test → ajouter
            un destinataire).
          </p>
        </section>

        {/* ---------- Supprimer ---------- */}
        <section id="supprimer" className="card doc">
          <h2>Supprimer un modèle</h2>
          <Code>{String.raw`curl -s -X DELETE "https://graph.facebook.com/$V/$WABA/message_templates?name=commande_prete&access_token=$TOKEN"
curl -s -X DELETE "https://graph.facebook.com/$V/$WABA/message_templates?name=facture_prete&access_token=$TOKEN"`}</Code>
          <div className="callout warn">
            Ne supprimer un modèle texte <strong>qu'après</strong> que son remplaçant <code>*_doc</code> est
            APPROVED <em>et</em> que <code>tmpl_sale</code> / <code>tmpl_invoice</code> pointe dessus.
          </div>
        </section>

        {/* ---------- Odoo ---------- */}
        <section id="odoo" className="card doc">
          <h2>Réglages côté Odoo</h2>
          <p>
            Le module ne stocke <strong>pas</strong> les modèles (Meta les détient) — seulement les
            <em> noms</em> à envoyer, dans <code>ir.config_parameter</code>. À poser dans
            <span className="pill">Paramètres → WhatsApp</span> (ou par shell + redémarrage d'Odoo).
          </p>
          <table>
            <thead><tr><th>Paramètre</th><th>Valeur (dev)</th></tr></thead>
            <tbody>
              <tr><td className="name">cto_whatsapp.enabled</td><td>True</td></tr>
              <tr><td className="name">cto_whatsapp.phone_number_id</td><td>1179334308601528</td></tr>
              <tr><td className="name">cto_whatsapp.waba_id</td><td>1204731505116845</td></tr>
              <tr><td className="name">cto_whatsapp.tmpl_sale</td><td>commande_prete_doc</td></tr>
              <tr><td className="name">cto_whatsapp.tmpl_invoice</td><td>facture_prete_doc</td></tr>
              <tr><td className="name">cto_whatsapp.access_token</td><td>jeton (voir Pièges)</td></tr>
            </tbody>
          </table>
        </section>

        {/* ---------- Pièges ---------- */}
        <section id="pieges" className="card doc">
          <h2>Pièges à connaître</h2>
          <table className="kv">
            <tbody>
              <tr><td>Jeton</td><td>Utiliser un <strong>jeton « Utilisateur système » à expiration « Jamais »</strong> (Business Settings → Utilisateurs système, app WhaTest, WABA assigné). Les jetons temporaires (API-Setup / Graph Explorer) meurent en ~1–24 h → <strong>erreur 190</strong> en plein envoi.</td></tr>
              <tr><td>WABA de test invisible</td><td>App-scoped → absent du Gestionnaire WhatsApp. Gérer par l'API Graph uniquement.</td></tr>
              <tr><td>Dérive de catégorie</td><td>Meta peut reclasser un modèle en <strong>MARKETING</strong> (exige un moyen de paiement). Nos modèles commande/facture sont transactionnels → garder <strong>UTILITY</strong>.</td></tr>
              <tr><td>Cache config</td><td>Écrire un <code>cto_whatsapp.*</code> depuis un <code>odoo shell</code> externe n'invalide pas le cache <code>get_param</code> du serveur → poser via l'UI Paramètres, ou <code>docker&nbsp;compose&nbsp;restart&nbsp;cto_one_dev</code> après.</td></tr>
              <tr><td>Ordre des variables</td><td>Figé par les passerelles : <code>[nom&nbsp;client, référence, montant]</code> → <code>{'{{1}}/{{2}}/{{3}}'}</code>. Le corps du modèle doit suivre le même ordre.</td></tr>
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
