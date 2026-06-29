'use client';

import { useState, useEffect } from 'react';

function fileToBase64(file: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const money = (n: any) => `${Number(n || 0).toLocaleString('fr-FR')} Dh`;
const byId = (catalog: any) => Object.fromEntries((catalog || []).map((c: any) => [c.id, c]));

function optionalAddons(catalog: any, pack: any) {
  const inPack = new Set(pack?.modules || []);
  return (catalog || []).filter((c: any) => c.kind === 'module' && c.module !== 'l10n_ma' && !inPack.has(c.module));
}

// Mirror of lib/packs.computeBilling for the live wizard preview.
function previewBilling(catalog: any, pack: any, selectedIds: any, extraUsers: any, extraDepots: any) {
  const map = byId(catalog);
  const inPack = new Set(pack?.modules || []);
  const feats = new Set(pack?.features || []);
  const lines: any[] = [{ label: `Pack ${pack?.name || ''}`, total: pack?.basePrice || 0 }];
  let monthly = pack?.basePrice || 0;
  const comptaBilled = !inPack.has('l10n_ma');
  if (comptaBilled && map.compta) {
    lines.push({ label: map.compta.label, total: map.compta.sub });
    monthly += map.compta.sub;
    if (!feats.has('teledeclaration') && map.teledeclaration) {
      lines.push({ label: map.teledeclaration.label, total: map.teledeclaration.sub });
      monthly += map.teledeclaration.sub;
    }
  }
  for (const id of selectedIds || []) {
    const c = map[id];
    if (!c || c.kind !== 'module' || !c.module || c.module === 'l10n_ma') continue;
    if (inPack.has(c.module)) continue;
    lines.push({ label: c.label, total: c.sub });
    monthly += c.sub;
  }
  const eu = Math.max(0, Number(extraUsers) || 0);
  if (eu > 0 && map.user) { lines.push({ label: `${map.user.label} ×${eu}`, total: map.user.sub * eu }); monthly += map.user.sub * eu; }
  const ed = Math.max(0, Number(extraDepots) || 0);
  if (ed > 0 && map.depot) { lines.push({ label: `${map.depot.label} ×${ed}`, total: map.depot.sub * ed }); monthly += map.depot.sub * ed; }
  return { lines, monthly };
}

function PackCards({ catalog, packs, selected, onPick }: any) {
  const map = byId(catalog);
  const label = (m: any) => (map[m] ? map[m].label : m);
  return (
    <div className="pack-grid">
      {packs.map((p: any) => (
        <div key={p.id} className={`pack-card${p.id === selected ? ' sel' : ''}`} onClick={onPick ? () => onPick(p.id) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
          <div className="pack-head"><span className="pack-name">{p.name}</span><span className="pack-users">{p.users} util.</span></div>
          <div className="pack-price">{money(p.basePrice)} <span className="muted">HT / mois</span></div>
          <ul className="pack-feats">
            {p.modules.map((m: any) => <li key={m} className="new">{label(m)}</li>)}
            {(p.features || []).includes('teledeclaration') && <li className="new">Télédéclaration</li>}
            {!p.modules.includes('l10n_ma') && <li className="opt">Comptabilité — en option (+199)</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AddonPicker({ catalog, pack, selected, setSelected, extraUsers, setExtraUsers, extraDepots, setExtraDepots }: any) {
  const opts = optionalAddons(catalog, pack);
  const soon = (catalog || []).filter((c: any) => c.kind === 'soon');
  const toggle = (id: any) => setSelected(selected.includes(id) ? selected.filter((x: any) => x !== id) : [...selected, id]);
  const depotOk = selected.includes('stock') || (pack?.modules || []).includes('stock');
  return (
    <>
      <div className="addon-grid">
        {opts.map((c: any) => (
          <label key={c.id} className={`addon${selected.includes(c.id) ? ' on' : ''}`}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span className="addon-name">{c.label}</span>
            <span className="addon-price">+{money(c.sub)}/mois</span>
          </label>
        ))}
        {soon.map((c: any) => (
          <label key={c.id} className="addon soon" title="Bientôt disponible">
            <input type="checkbox" disabled />
            <span className="addon-name">{c.label} <span className="muted">(à venir)</span></span>
            <span className="addon-price">+{money(c.sub)}/mois</span>
          </label>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
        <div className="field">
          <label>Utilisateurs supplémentaires (+99/mois)</label>
          <input type="text" inputMode="numeric" value={extraUsers} onChange={(e) => setExtraUsers(e.target.value.replace(/[^0-9]/g, ''))} style={{ minWidth: 90 }} />
        </div>
        <div className="field">
          <label>Dépôts supplémentaires (+49/mois){depotOk ? '' : ' — nécessite Stock'}</label>
          <input type="text" inputMode="numeric" value={extraDepots} disabled={!depotOk} onChange={(e) => setExtraDepots(e.target.value.replace(/[^0-9]/g, ''))} style={{ minWidth: 90 }} />
        </div>
      </div>
    </>
  );
}

function CostBox({ catalog, pack, selected, extraUsers, extraDepots }: any) {
  const { lines, monthly } = previewBilling(catalog, pack, selected, extraUsers, extraDepots);
  return (
    <div className="cost-box">
      <table className="cost-table">
        <tbody>{lines.map((l: any, i: number) => <tr key={i}><td>{l.label}</td><td className="amt">{l.total ? money(l.total) : 'inclus'}</td></tr>)}</tbody>
        <tfoot><tr><td><strong>Total mensuel HT</strong></td><td className="amt"><strong>{money(monthly)}</strong></td></tr></tfoot>
      </table>
    </div>
  );
}

// Read-only price reference for the commercials.
function PacksView({ catalog, packs }: any) {
  const addons = (catalog || []).filter((c: any) => c.kind === 'module' || c.kind === 'feature' || c.kind === 'quantity');
  const soon = (catalog || []).filter((c: any) => c.kind === 'soon');
  return (
    <div className="card">
      <h2>Nos packs &amp; tarifs</h2>
      <p className="muted">Grille officielle Connecteo One (HT). Trois packs, plus des options à la carte.</p>
      <PackCards catalog={catalog} packs={packs} selected={null} />
      <h3 style={{ fontSize: 14, color: 'var(--navy)', margin: '18px 0 6px' }}>Options à la carte</h3>
      <table>
        <thead><tr><th>Module / option</th><th>Abonnement</th><th>À l&apos;achat</th></tr></thead>
        <tbody>
          {addons.map((c: any) => (
            <tr key={c.id}><td className="name">{c.label}</td><td>{money(c.sub)} / mois</td><td>{c.acq ? money(c.acq) : '—'}</td></tr>
          ))}
          {soon.map((c: any) => (
            <tr key={c.id}><td>{c.label} <span className="muted">(à venir)</span></td><td className="muted">{money(c.sub)} / mois</td><td className="muted">{c.acq ? money(c.acq) : '—'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const JOB_BADGE: any = {
  queued: { t: 'En file', c: '#8a6d00', bg: '#fff6d6' },
  running: { t: 'En cours', c: '#0b5cad', bg: '#e3f0ff' },
  done: { t: 'Terminé', c: '#0a7a3f', bg: '#e3fbe9' },
  error: { t: 'Échec', c: '#b00020', bg: '#ffe3e6' },
};

// Live tracker for background creations. Polled every few seconds by the parent.
function JobsPanel({ jobs, copy }: any) {
  const list = jobs || [];
  const active = list.filter((j: any) => j.status === 'queued' || j.status === 'running');
  const recent = list.filter((j: any) => j.status === 'done' || j.status === 'error').slice(0, 8);
  if (!active.length && !recent.length) return null;

  const renderJob = (j: any) => {
    const b = JOB_BADGE[j.status] || JOB_BADGE.queued;
    return (
      <div key={j.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: '10px 12px', margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>{j.name}</strong>
          <span style={{ color: b.c, background: b.bg, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{b.t}</span>
          <span className="muted" style={{ fontSize: 12 }}>{j.label}</span>
        </div>
        {(j.status === 'queued' || j.status === 'running') && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 6, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${j.pct || 0}%`, background: '#b71987', transition: 'width .5s' }} />
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{j.step}</span>
          </div>
        )}
        {j.status === 'done' && j.result && (
          j.result.client ? (
            <table style={{ marginTop: 8 }}>
              <tbody>
                <tr><td>Adresse</td><td><a href={j.result.url} target="_blank" rel="noopener">{j.result.url}</a></td></tr>
                <tr><td>Identifiant</td><td><code>{j.result.client.login}</code> <button type="button" onClick={() => copy(j.result.client.login, 'Login')}>Copier</button></td></tr>
                <tr><td>Mot de passe</td><td><code>{j.result.client.password}</code> <button type="button" onClick={() => copy(j.result.client.password, 'Mot de passe')}>Copier</button></td></tr>
              </tbody>
            </table>
          ) : (
            <p className="msg warn" style={{ marginTop: 8 }}>Base créée, mais le compte client n&apos;a pas pu être généré — contactez l&apos;administrateur.</p>
          )
        )}
        {j.status === 'error' && <p className="msg ko" style={{ marginTop: 8 }}>{j.error}</p>}
      </div>
    );
  };

  return (
    <div className="card" style={{ borderColor: '#b71987' }}>
      <h2>Créations {active.length ? `en cours (${active.length})` : 'récentes'}</h2>
      <p className="muted">La création se poursuit en arrière-plan — vous pouvez en lancer d&apos;autres sans attendre. Le mot de passe ne s&apos;affiche qu&apos;une seule fois.</p>
      {active.map(renderJob)}
      {recent.map(renderJob)}
    </div>
  );
}

export default function Create({ instances, packs, catalog, user }: any) {
  const [instanceId, setInstanceId] = useState(instances[0]?.id || '');
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [pack, setPack] = useState(packs[0]?.id || 'start');
  const [addons, setAddons] = useState<any[]>([]);
  const [extraUsers, setExtraUsers] = useState('');
  const [extraDepots, setExtraDepots] = useState('');
  const [logoFile, setLogoFile] = useState<any>(null);
  const [showFiche, setShowFiche] = useState(false);
  const [fiche, setFiche] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);

  const ficheField = (k: string) => (e: any) => setFiche((f: any) => ({ ...f, [k]: e.target.value }));
  const currentPack = () => packs.find((p: any) => p.id === pack) || packs[0];

  async function refreshJobs() {
    try {
      const r = await fetch('/api/jobs', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) setJobs(j.jobs);
    } catch { /* transient — next tick retries */ }
  }
  useEffect(() => {
    refreshJobs();
    const t = setInterval(refreshJobs, 2500);
    return () => clearInterval(t);
  }, []);

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMsg({ kind: 'ok', text: `${label} copié.` }); }
    catch { setMsg({ kind: 'ko', text: 'Copie impossible — sélectionnez puis copiez manuellement.' }); }
  }

  function reset() {
    setStep(1); setName(''); setCompanyName(''); setPack(packs[0]?.id || 'start');
    setAddons([]); setExtraUsers(''); setExtraDepots(''); setFiche({}); setLogoFile(null); setShowFiche(false);
  }

  // Non-blocking: enqueue and return immediately, then reset the wizard so the next
  // client can be launched right away. Progress shows in the JobsPanel above.
  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const logo = logoFile ? await fileToBase64(logoFile) : null;
      const r = await fetch('/api/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: instanceId, name: name.trim(), pack, addons, extraUsers, extraDepots, companyName: companyName.trim(), fiche, logo }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setMsg({ kind: 'ok', text: `« ${j.name} » ajouté à la file — la création se poursuit en arrière-plan.` });
      reset();
      refreshJobs();
    } catch (err: any) {
      setMsg({ kind: 'ko', text: `Échec : ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="top">
        <h1>Connecteo One — Espace Commercial</h1>
        <div className="nav"><span className="who">{user}</span></div>
      </header>

      <main>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

        <JobsPanel jobs={jobs} copy={copy} />

        <div className="card">
          <h2>Créer un client — étape {step}/3</h2>

          {step === 1 && (
            <div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {instances.length > 1 && (
                  <div className="field"><label>Instance</label>
                    <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} disabled={busy}>
                      {instances.map((i: any) => <option key={i.id} value={i.id}>{i.label}</option>)}
                    </select>
                  </div>
                )}
                <div className="field"><label>Nom (sous-domaine = adresse)</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="acme" /></div>
                <div className="field"><label>Nom de la société</label><input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="ACME SARL" /></div>
                <div className="field"><label>Logo (optionnel)</label><input type="file" accept="image/*" onChange={(e: any) => setLogoFile(e.target.files[0] || null)} /></div>
              </div>
              <p className="muted" style={{ marginTop: 8 }}><button type="button" onClick={() => setShowFiche((v) => !v)}>{showFiche ? '− Masquer' : '+ Ajouter'} la fiche client (optionnel)</button></p>
              {showFiche && (
                <>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <div className="field"><label>ICE</label><input type="text" value={fiche.cto_ice || ''} onChange={ficheField('cto_ice')} /></div>
                    <div className="field"><label>IF</label><input type="text" value={fiche.cto_if || ''} onChange={ficheField('cto_if')} /></div>
                    <div className="field"><label>RC</label><input type="text" value={fiche.cto_rc || ''} onChange={ficheField('cto_rc')} /></div>
                    <div className="field"><label>CNSS</label><input type="text" value={fiche.cto_cnss || ''} onChange={ficheField('cto_cnss')} /></div>
                    <div className="field"><label>Patente</label><input type="text" value={fiche.cto_patente || ''} onChange={ficheField('cto_patente')} /></div>
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <div className="field"><label>Dirigeant / Contact</label><input type="text" value={fiche.cto_manager_name || ''} onChange={ficheField('cto_manager_name')} /></div>
                    <div className="field"><label>Fonction</label><input type="text" value={fiche.cto_manager_role || ''} onChange={ficheField('cto_manager_role')} /></div>
                    <div className="field"><label>Téléphone</label><input type="text" value={fiche.cto_manager_phone || ''} onChange={ficheField('cto_manager_phone')} /></div>
                    <div className="field"><label>Email (= identifiant du client)</label><input type="email" value={fiche.cto_manager_email || ''} onChange={ficheField('cto_manager_email')} /></div>
                  </div>
                </>
              )}
              <div className="modal-foot"><button className="primary" disabled={!name.trim()} onClick={() => setStep(2)}>Suivant — choisir le pack</button></div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="muted">Choisissez le pack de base.</p>
              <PackCards catalog={catalog} packs={packs} selected={pack} onPick={setPack} />
              <div className="modal-foot">
                <button onClick={() => setStep(1)}>← Retour</button>
                <button className="primary" onClick={() => setStep(3)}>Suivant — options</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="muted">Ajoutez des modules ou lancez directement la création.</p>
              <AddonPicker catalog={catalog} pack={currentPack()} selected={addons} setSelected={setAddons}
                extraUsers={extraUsers} setExtraUsers={setExtraUsers} extraDepots={extraDepots} setExtraDepots={setExtraDepots} />
              <CostBox catalog={catalog} pack={currentPack()} selected={addons} extraUsers={extraUsers} extraDepots={extraDepots} />
              <div className="modal-foot">
                <button onClick={() => setStep(2)} disabled={busy}>← Retour</button>
                <button onClick={submit} disabled={busy}>Lancer (sans option)</button>
                <button className="primary" onClick={submit} disabled={busy}>{busy ? 'Ajout…' : 'Créer le client'}</button>
              </div>
            </div>
          )}
        </div>
        <p className="muted" style={{ maxWidth: 760, margin: '0 auto 18px', padding: '0 16px' }}>
          La création installe la Comptabilité marocaine + les apps du pack et les options choisies, puis génère le mot de passe du client (~1 minute). Elle s&apos;exécute en arrière-plan : vous pouvez enchaîner plusieurs clients sans attendre — suivez-les dans «&nbsp;Créations en cours&nbsp;».
        </p>

        <PacksView catalog={catalog} packs={packs} />
      </main>
    </>
  );
}
