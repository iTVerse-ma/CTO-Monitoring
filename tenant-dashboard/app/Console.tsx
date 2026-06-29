'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

// Read a File into base64 (stripped of the data:...;base64, prefix) for the logo.
function fileToBase64(file) {
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

const money = (n) => `${Number(n || 0).toLocaleString('fr-FR')} Dh`;
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
};

// Catalog-id lookup helpers (catalog comes from /api/packs; safe to use on client).
const byId = (catalog) => Object.fromEntries((catalog || []).map((c) => [c.id, c]));
// Comptabilité (l10n_ma) ships in the base on every tenant, so it's always present:
// billed when it isn't part of the chosen pack (Start), free when it is (Pro/Max).
// These add-ons are the ones a pack does NOT already include and that aren't the
// always-on Comptabilité — i.e. the genuinely optional toggles for that pack.
function optionalAddons(catalog, pack) {
  const inPack = new Set(pack?.modules || []);
  return (catalog || []).filter((c) => c.kind === 'module' && c.module !== 'l10n_ma' && !inPack.has(c.module));
}

// Client-side mirror of lib/packs.computeBilling for live wizard/editor previews.
function previewBilling(catalog, pack, selectedIds, extraUsers, extraDepots) {
  const map = byId(catalog);
  const inPack = new Set(pack?.modules || []);
  const feats = new Set(pack?.features || []);
  const lines = [{ label: `Pack ${pack?.name || ''}`, total: pack?.basePrice || 0 }];
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

// A masked, copyable secret field (hidden by default, reveal + copy buttons).
function SecretRow({ label, value, secret, mono, copy }: any) {
  const [show, setShow] = useState(false);
  const has = !!value;
  return (
    <div className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}>
      <div className="field">
        <label>{label}</label>
        <input type={secret && !show ? 'password' : 'text'} value={value || ''} readOnly aria-label={label}
          style={{ minWidth: 300, fontFamily: mono || secret ? 'monospace' : 'inherit' }} />
      </div>
      {secret && <button type="button" onClick={() => setShow((v) => !v)} disabled={!has}>{show ? 'Masquer' : 'Révéler'}</button>}
      <button type="button" onClick={() => copy(value, label)} disabled={!has}>Copier</button>
    </div>
  );
}

// The three pack cards (with price + included apps). Used in the wizard + read-only.
function PackCards({ catalog, packs, selected, onPick }: any) {
  const map = byId(catalog);
  const label = (m) => (map[m] ? map[m].label : m);
  return (
    <div className="pack-grid">
      {packs.map((p) => (
        <div key={p.id} className={`pack-card${p.id === selected ? ' sel' : ''}`}
          onClick={onPick ? () => onPick(p.id) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
          <div className="pack-head">
            <span className="pack-name">{p.name}</span>
            <span className="pack-users">{p.users} util.</span>
          </div>
          <div className="pack-price">{money(p.basePrice)} <span className="muted">HT / mois</span></div>
          <ul className="pack-feats">
            {p.modules.map((m) => <li key={m} className="new">{label(m)}</li>)}
            {(p.features || []).includes('teledeclaration') && <li className="new">Télédéclaration</li>}
            {!p.modules.includes('l10n_ma') && <li className="opt">Comptabilité — en option (+199)</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Add-on picker — toggle the optional modules, set extra users/dépôts. Reused by
// the create wizard and the per-tenant module editor. `disabledIds` = modules that
// can't be unchecked here (e.g. already installed in the editor when removing is off).
function AddonPicker({ catalog, pack, selected, setSelected, extraUsers, setExtraUsers, extraDepots, setExtraDepots, stockAvailable }: any) {
  const opts = optionalAddons(catalog, pack);
  const soon = (catalog || []).filter((c) => c.kind === 'soon');
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const depotOk = stockAvailable || selected.includes('stock') || (pack?.modules || []).includes('stock');
  return (
    <>
      <div className="addon-grid">
        {opts.map((c) => (
          <label key={c.id} className={`addon${selected.includes(c.id) ? ' on' : ''}`}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span className="addon-name">{c.label}</span>
            <span className="addon-price">+{money(c.sub)}/mois</span>
          </label>
        ))}
        {soon.map((c) => (
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
          <input type="text" inputMode="numeric" value={extraUsers}
            onChange={(e) => setExtraUsers(e.target.value.replace(/[^0-9]/g, ''))} style={{ minWidth: 90 }} />
        </div>
        <div className="field">
          <label>Dépôts supplémentaires (+49/mois){depotOk ? '' : ' — nécessite Stock'}</label>
          <input type="text" inputMode="numeric" value={extraDepots} disabled={!depotOk}
            onChange={(e) => setExtraDepots(e.target.value.replace(/[^0-9]/g, ''))} style={{ minWidth: 90 }} />
        </div>
      </div>
    </>
  );
}

// Cost summary box (live total + per-line breakdown).
function CostBox({ catalog, pack, selected, extraUsers, extraDepots }: any) {
  const { lines, monthly } = previewBilling(catalog, pack, selected, extraUsers, extraDepots);
  return (
    <div className="cost-box">
      <table className="cost-table">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}><td>{l.label}</td><td className="amt">{l.total ? money(l.total) : 'inclus'}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td><strong>Total mensuel HT</strong></td><td className="amt"><strong>{money(monthly)}</strong></td></tr></tfoot>
      </table>
    </div>
  );
}

export default function Console({ instances }: any) {
  const [instanceId, setInstanceId] = useState(instances[0]?.id || '');
  const inst = instances.find((i: any) => i.id === instanceId) || instances[0];

  const [dbs, setDbs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<any>(null);
  const [result, setResult] = useState<any>(null);

  const [packs, setPacks] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [packDraft, setPackDraft] = useState<any>(null);

  // Create wizard
  const [wizard, setWizard] = useState<any>(null); // null = closed; else { step, ... }

  // Per-tenant fiche + modules editors
  const [editDb, setEditDb] = useState<any>(null);
  const [editVals, setEditVals] = useState<any>(null);
  const [editLogoFile, setEditLogoFile] = useState<any>(null);
  const [modDb, setModDb] = useState<any>(null);   // tenant whose modules we're editing

  const [restoreName, setRestoreName] = useState('');
  const [restoreFile, setRestoreFile] = useState<any>(null);
  const [restoreCopy, setRestoreCopy] = useState(true);

  const [adminCred, setAdminCred] = useState<any>(null);

  const load = useCallback(async (id) => {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/databases?instance=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setDbs(j.databases);
    } catch (e) {
      setMsg({ kind: 'ko', text: `Could not list databases: ${e.message}` });
      setDbs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPacks = useCallback(async () => {
    try {
      const r = await fetch('/api/packs', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setPacks(j.packs || []);
      setCatalog(j.catalog || []);
    } catch (e) {
      setMsg({ kind: 'ko', text: `Could not load packs: ${e.message}` });
    }
  }, []);

  useEffect(() => { if (instanceId) load(instanceId); }, [instanceId, load]);
  useEffect(() => { loadPacks(); }, [loadPacks]);

  useEffect(() => {
    if (!instanceId) return;
    setAdminCred(null);
    fetch(`/api/admin-credential?instance=${encodeURIComponent(instanceId)}`, { cache: 'no-store' })
      .then((r) => r.json()).then((j) => { if (j.ok) setAdminCred(j); }).catch(() => {});
  }, [instanceId]);

  // ---- background creation queue (non-blocking) ----
  const [jobs, setJobs] = useState<any[]>([]);
  const refreshJobs = useCallback(async () => {
    try { const r = await fetch('/api/jobs', { cache: 'no-store' }); const j = await r.json(); if (j.ok) setJobs(j.jobs); } catch { /* transient */ }
  }, []);
  useEffect(() => { refreshJobs(); const t = setInterval(refreshJobs, 2500); return () => clearInterval(t); }, [refreshJobs]);
  const prevActive = useRef(0);
  useEffect(() => {
    const activeNow = jobs.filter((j: any) => j.status === 'queued' || j.status === 'running').length;
    if (prevActive.current > activeNow && instanceId) load(instanceId); // a creation just finished -> refresh the list
    prevActive.current = activeNow;
  }, [jobs, instanceId, load]);

  async function copyText(value, label) {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setMsg({ kind: 'ok', text: `${label} copié.` }); }
    catch { setMsg({ kind: 'ko', text: 'Copie impossible — révélez puis copiez manuellement.' }); }
  }

  async function api(path, body) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      return j;
    } finally {
      setBusy(false);
    }
  }

  // ---- create wizard ----
  function openWizard() {
    setResult(null);
    setWizard({ step: 1, name: '', companyName: '', logoFile: null, fiche: {}, showFiche: false, pack: packs[0]?.id || 'start', addons: [], extraUsers: '', extraDepots: '' });
  }
  const wset = (p) => setWizard((w) => ({ ...w, ...p }));
  const wizardPack = () => packs.find((p) => p.id === wizard?.pack) || packs[0];

  async function submitWizard() {
    const w = wizard;
    try {
      const logo = w.logoFile ? await fileToBase64(w.logoFile) : null;
      const j = await api('/api/create', {
        instance: instanceId, name: w.name.trim(), pack: w.pack,
        addons: w.addons, extraUsers: w.extraUsers, extraDepots: w.extraDepots,
        companyName: w.companyName.trim(), fiche: w.fiche, logo,
      });
      // Non-blocking: provisioning runs in the background queue; track it in the panel.
      setMsg({ kind: 'ok', text: `« ${j.name} » ajouté à la file — création en arrière-plan.` });
      setWizard(null);
      refreshJobs();
    } catch (e) {
      setMsg({ kind: 'ko', text: `Échec : ${e.message}` });
    }
  }

  // ---- per-tenant module editor ----
  function openModules(d) {
    const pack = packs.find((p) => p.id === d.packId) || packs[0];
    const installed = new Set(d.installedModules || []);
    const opts = optionalAddons(catalog, pack);
    const selected = opts.filter((c) => installed.has(c.module)).map((c) => c.id);
    const baseUsers = pack?.users || 0;
    setModDb({
      name: d.name, pack, packId: d.packId, packName: d.packName,
      initial: selected, selected,
      extraUsers: String(Math.max(0, (d.packUsers || 0) - baseUsers)),
      extraDepots: String(Math.max(0, (d.warehouses || 0) - 1)),
      stockAvailable: installed.has('stock'),
    });
  }
  const mset = (p) => setModDb((m) => ({ ...m, ...p }));

  async function saveModules() {
    const m = modDb;
    const initial = new Set(m.initial);
    const now = new Set(m.selected);
    const install = m.selected.filter((id) => !initial.has(id));
    const uninstall = m.initial.filter((id) => !now.has(id));
    if (uninstall.length) {
      const labels = uninstall.map((id) => (catalog.find((c) => c.id === id) || {}).label || id).join(', ');
      if (!window.confirm(`Retirer : ${labels}\n\nDésinstaller une app SUPPRIME ses données dans Odoo (irréversible). Continuer ?`)) return;
    }
    const baseUsers = m.pack?.users || 0;
    const packUsers = baseUsers + (Math.max(0, Number(m.extraUsers) || 0));
    try {
      await api('/api/modules', {
        instance: instanceId, db: m.name,
        install, uninstall, packUsers, extraDepots: Number(m.extraDepots) || 0,
      });
      setMsg({ kind: 'ok', text: `Abonnement de « ${m.name} » mis à jour.` });
      setModDb(null);
      await load(instanceId);
    } catch (e) {
      setMsg({ kind: 'ko', text: `Mise à jour échouée : ${e.message}` });
    }
  }

  async function configureMail(name) {
    if (!window.confirm(`Configurer l'email sortant (Mailjet) pour « ${name} » ?`)) return;
    try {
      const j = await api('/api/mail', { instance: instanceId, db: name });
      const r = (j.results || [])[0] || {};
      setMsg(r.configured
        ? { kind: 'ok', text: `Email configuré pour « ${name} » — envoi depuis ${r.defaultFrom}.` }
        : { kind: 'warn', text: `Email non configuré pour « ${name} » : ${r.error || r.reason || 'clés Mailjet absentes dans instances.json'}.` });
    } catch (e) {
      setMsg({ kind: 'ko', text: `Configuration email échouée : ${e.message}` });
    }
  }

  async function duplicate(name) {
    const target = window.prompt(`Duplicate '${name}' to a new tenant named:`);
    if (!target) return;
    try { await api('/api/duplicate', { instance: instanceId, name, newName: target.trim() }); setMsg({ kind: 'ok', text: `Duplicated '${name}' → '${target.trim()}'.` }); await load(instanceId); }
    catch (e) { setMsg({ kind: 'ko', text: `Duplicate failed: ${e.message}` }); }
  }

  async function resetAdmin(name) {
    if (!window.confirm(`Réinitialiser le mot de passe de l'administrateur du tenant '${name}' ?`)) return;
    setResult(null);
    try { const j = await api('/api/reset-admin', { instance: instanceId, db: name }); setResult({ reset: true, name, admin: { login: j.login, password: j.password }, url: `https://${name}.${inst.domain}` }); setMsg({ kind: 'ok', text: `Mot de passe de '${j.login}' réinitialisé.` }); }
    catch (e) { setMsg({ kind: 'ko', text: `Réinitialisation échouée: ${e.message}` }); }
  }

  async function drop(name) {
    const typed = window.prompt(`This permanently DROPS database '${name}'.\nType the name to confirm:`);
    if (typed !== name) { if (typed !== null) setMsg({ kind: 'ko', text: 'Name did not match — drop cancelled.' }); return; }
    try { await api('/api/drop', { instance: instanceId, name }); setMsg({ kind: 'ok', text: `Dropped '${name}'.` }); await load(instanceId); }
    catch (e) { setMsg({ kind: 'ko', text: `Drop failed: ${e.message}` }); }
  }

  async function openEdit(name) {
    setMsg(null); setEditDb(name); setEditVals(null); setEditLogoFile(null);
    try {
      const r = await fetch(`/api/profile?instance=${encodeURIComponent(instanceId)}&db=${encodeURIComponent(name)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      if (!j.installed) { setMsg({ kind: 'warn', text: `'${name}' has no Connecteo profile.` }); setEditDb(null); return; }
      setEditVals({ ...j.profile });
    } catch (e) { setMsg({ kind: 'ko', text: `Could not load profile: ${e.message}` }); setEditDb(null); }
  }
  const editField = (k) => (e) => setEditVals((v) => ({ ...v, [k]: e.target.value }));

  async function saveEdit(e) {
    e.preventDefault();
    const { id, ...vals } = editVals;
    try {
      if (editLogoFile) vals.logo = await fileToBase64(editLogoFile);
      const j = await api('/api/profile', { instance: instanceId, db: editDb, vals });
      setMsg({ kind: 'ok', text: `Fiche de '${editDb}' mise à jour.` });
      setEditDb(null); setEditVals(null); setEditLogoFile(null); await load(instanceId);
    } catch (e2) { setMsg({ kind: 'ko', text: `Update failed: ${e2.message}` }); }
  }

  async function savePacks() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/packs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packDraft) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setPacks(j.packs || []); setCatalog(j.catalog || []); setPackDraft(null);
      setMsg({ kind: 'ok', text: 'Packs enregistrés.' });
    } catch (e) { setMsg({ kind: 'ko', text: `Save packs failed: ${e.message}` }); }
    finally { setBusy(false); }
  }

  async function doRestore(e) {
    e.preventDefault();
    if (!restoreFile) { setMsg({ kind: 'ko', text: 'Choose a .zip backup file.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set('instance', instanceId); fd.set('name', restoreName.trim()); fd.set('copy', String(restoreCopy)); fd.set('file', restoreFile);
      const r = await fetch('/api/restore', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setMsg({ kind: 'ok', text: `Restored into '${restoreName.trim()}'.` });
      setRestoreName(''); setRestoreFile(null); e.target.reset(); await load(instanceId);
    } catch (e2) { setMsg({ kind: 'ko', text: `Restore failed: ${e2.message}` }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="bar">
        <label htmlFor="inst">Docker / Odoo instance</label>
        <select id="inst" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} disabled={busy}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
        <button onClick={() => load(instanceId)} disabled={busy || loading}>↻ Refresh</button>
        <button className="primary" onClick={openWizard} disabled={busy || packs.length === 0}>+ Créer un client</button>
        {busy && <span className="muted"><span className="spinner" style={{ borderTopColor: '#b71987', borderColor: '#b7198733' }} /> working…</span>}
      </div>

      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

      {result && (
        <div className="card" style={{ borderColor: '#b71987' }}>
          <h2>{result.reset ? 'Mot de passe réinitialisé — copiez-le maintenant' : 'Client créé — copiez les identifiants maintenant'}</h2>
          <p className="muted">Affichés une seule fois.</p>
          <table>
            <tbody>
              <tr><td>URL</td><td><a href={result.url} target="_blank" rel="noopener">{result.url}</a></td></tr>
              <tr><td>Login client</td><td><code>{result.admin?.login}</code></td></tr>
              <tr><td>Mot de passe client</td><td><code>{result.admin?.password}</code></td></tr>
              {result.pack && <tr><td>Pack</td><td><code>{result.packLabel || result.pack}</code></td></tr>}
              {!result.reset && <tr><td>Modules</td><td>{(result.installed || []).join(', ') || '—'}</td></tr>}
              {result.recovery && <tr><td className="muted">Recovery (Connecteo)</td><td className="muted"><code>{result.recovery.login}</code> / <code>{result.recovery.password}</code> — interne</td></tr>}
            </tbody>
          </table>
          <p><button onClick={() => setResult(null)}>Fermer</button></p>
        </div>
      )}

      <JobsPanel jobs={jobs} copy={copyText} />

      <div className="card">
        <h2>Identifiants Connecteo — toutes les bases</h2>
        <p className="muted">Secrets de récupération, identiques sur tous les tenants. <strong>Internes — ne jamais communiquer au client.</strong></p>
        <SecretRow label="Compte admin (login)" value={adminCred?.login} mono copy={copyText} />
        <SecretRow label="Mot de passe admin" value={adminCred?.password} secret copy={copyText} />
        <SecretRow label="Mot de passe maître (DB manager)" value={adminCred?.masterPassword} secret copy={copyText} />
      </div>

      <div className="card">
        <h2>Clients — {inst?.label}</h2>
        {loading ? <p className="muted">Chargement…</p> : (
          <table>
            <thead>
              <tr><th>Tenant / DB</th><th>Pack</th><th>Créé le</th><th>Renouvellement</th><th>Coût / mois</th><th>Taille</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {dbs.length === 0 && <tr><td colSpan={7} className="muted">Aucune base tenant.</td></tr>}
              {dbs.map((d) => (
                <tr key={d.name}>
                  <td className="name">{d.name}</td>
                  <td>{d.packName || '—'}</td>
                  <td>{fmtDate(d.created)}</td>
                  <td>{fmtDate(d.renewal)}</td>
                  <td title={(d.lines || []).map((l) => `${l.label}: ${l.total ? money(l.total) : 'inclus'}`).join('\n')}>
                    {d.monthly != null ? <strong>{money(d.monthly)} HT</strong> : '—'}
                  </td>
                  <td>{d.size || fmtBytes(d.bytes)}</td>
                  <td>
                    <div className="actions">
                      <a href={`https://${d.name}.${inst.domain}`} target="_blank" rel="noopener"><button>Ouvrir</button></a>
                      <button onClick={() => openModules(d)} disabled={busy || !d.packId}>Modules</button>
                      <button onClick={() => configureMail(d.name)} disabled={busy}>Email</button>
                      <a href={`/api/backup?instance=${encodeURIComponent(instanceId)}&db=${encodeURIComponent(d.name)}`}><button>Backup</button></a>
                      <button onClick={() => openEdit(d.name)} disabled={busy}>Fiche</button>
                      <button onClick={() => resetAdmin(d.name)} disabled={busy}>Réinit. MDP</button>
                      <button onClick={() => duplicate(d.name)} disabled={busy}>Duplicate</button>
                      <button className="danger" onClick={() => drop(d.name)} disabled={busy}>Drop</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- Create wizard (modal) ---- */}
      {wizard && (
        <div className="modal-backdrop" onClick={() => !busy && setWizard(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Créer un client — étape {wizard.step}/3</h2>
              <button onClick={() => !busy && setWizard(null)}>✕</button>
            </div>

            {wizard.step === 1 && (
              <div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <div className="field"><label>Nom (sous-domaine = adresse)</label><input type="text" value={wizard.name} onChange={(e) => wset({ name: e.target.value })} placeholder="acme" /></div>
                  <div className="field"><label>Nom de la société</label><input type="text" value={wizard.companyName} onChange={(e) => wset({ companyName: e.target.value })} placeholder="ACME SARL" /></div>
                  <div className="field"><label>Logo (optionnel)</label><input type="file" accept="image/*" onChange={(e) => wset({ logoFile: e.target.files[0] || null })} /></div>
                </div>
                <p className="muted" style={{ marginTop: 8 }}><button type="button" onClick={() => wset({ showFiche: !wizard.showFiche })}>{wizard.showFiche ? '− Masquer' : '+ Ajouter'} la fiche client (optionnel)</button></p>
                {wizard.showFiche && (
                  <>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <div className="field"><label>ICE</label><input type="text" value={wizard.fiche.cto_ice || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_ice: e.target.value } })} /></div>
                      <div className="field"><label>IF</label><input type="text" value={wizard.fiche.cto_if || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_if: e.target.value } })} /></div>
                      <div className="field"><label>RC</label><input type="text" value={wizard.fiche.cto_rc || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_rc: e.target.value } })} /></div>
                      <div className="field"><label>CNSS</label><input type="text" value={wizard.fiche.cto_cnss || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_cnss: e.target.value } })} /></div>
                      <div className="field"><label>Patente</label><input type="text" value={wizard.fiche.cto_patente || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_patente: e.target.value } })} /></div>
                    </div>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <div className="field"><label>Dirigeant / Contact</label><input type="text" value={wizard.fiche.cto_manager_name || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_manager_name: e.target.value } })} /></div>
                      <div className="field"><label>Fonction</label><input type="text" value={wizard.fiche.cto_manager_role || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_manager_role: e.target.value } })} /></div>
                      <div className="field"><label>Téléphone</label><input type="text" value={wizard.fiche.cto_manager_phone || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_manager_phone: e.target.value } })} /></div>
                      <div className="field"><label>Email (= identifiant du client)</label><input type="email" value={wizard.fiche.cto_manager_email || ''} onChange={(e) => wset({ fiche: { ...wizard.fiche, cto_manager_email: e.target.value } })} /></div>
                    </div>
                  </>
                )}
                <div className="modal-foot">
                  <button className="primary" disabled={!wizard.name.trim()} onClick={() => wset({ step: 2 })}>Suivant — choisir le pack</button>
                </div>
              </div>
            )}

            {wizard.step === 2 && (
              <div>
                <p className="muted">Choisissez le pack de base.</p>
                <PackCards catalog={catalog} packs={packs} selected={wizard.pack} onPick={(id) => wset({ pack: id })} />
                <div className="modal-foot">
                  <button onClick={() => wset({ step: 1 })}>← Retour</button>
                  <button className="primary" onClick={() => wset({ step: 3 })}>Suivant — options</button>
                </div>
              </div>
            )}

            {wizard.step === 3 && (
              <div>
                <p className="muted">Ajoutez des modules ou passez directement à la création.</p>
                <AddonPicker catalog={catalog} pack={wizardPack()} selected={wizard.addons} setSelected={(fn) => wset({ addons: typeof fn === 'function' ? fn(wizard.addons) : fn })}
                  extraUsers={wizard.extraUsers} setExtraUsers={(v) => wset({ extraUsers: v })} extraDepots={wizard.extraDepots} setExtraDepots={(v) => wset({ extraDepots: v })} />
                <CostBox catalog={catalog} pack={wizardPack()} selected={wizard.addons} extraUsers={wizard.extraUsers} extraDepots={wizard.extraDepots} />
                <div className="modal-foot">
                  <button onClick={() => wset({ step: 2 })}>← Retour</button>
                  <button onClick={submitWizard} disabled={busy}>Passer (sans option)</button>
                  <button className="primary" onClick={submitWizard} disabled={busy}>{busy ? <span className="spinner" /> : 'Créer le client'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- Per-tenant module editor (modal) ---- */}
      {modDb && (
        <div className="modal-backdrop" onClick={() => !busy && setModDb(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Modules & abonnement — {modDb.name}</h2>
              <button onClick={() => !busy && setModDb(null)}>✕</button>
            </div>
            <p className="muted">Pack <strong>{modDb.packName}</strong>. Cochez pour installer, décochez pour retirer (désinstaller supprime les données de l&apos;app).</p>
            <AddonPicker catalog={catalog} pack={modDb.pack} selected={modDb.selected} setSelected={(fn) => mset({ selected: typeof fn === 'function' ? fn(modDb.selected) : fn })}
              extraUsers={modDb.extraUsers} setExtraUsers={(v) => mset({ extraUsers: v })} extraDepots={modDb.extraDepots} setExtraDepots={(v) => mset({ extraDepots: v })} stockAvailable={modDb.stockAvailable} />
            <CostBox catalog={catalog} pack={modDb.pack} selected={modDb.selected} extraUsers={modDb.extraUsers} extraDepots={modDb.extraDepots} />
            <div className="modal-foot">
              <button onClick={() => setModDb(null)} disabled={busy}>Annuler</button>
              <button className="primary" onClick={saveModules} disabled={busy}>{busy ? <span className="spinner" /> : 'Appliquer'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Fiche editor (modal) ---- */}
      {editDb && editVals && (
        <div className="modal-backdrop" onClick={() => !busy && setEditDb(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>Fiche société — {editDb}</h2><button onClick={() => !busy && setEditDb(null)}>✕</button></div>
            <form onSubmit={saveEdit}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <div className="field"><label>Nom de la société</label><input type="text" value={editVals.name || ''} onChange={editField('name')} /></div>
                <div className="field"><label>Logo (remplacer)</label><input type="file" accept="image/*" onChange={(e) => setEditLogoFile(e.target.files[0] || null)} /></div>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>Identité légale (Maroc)</p>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <div className="field"><label>ICE</label><input type="text" value={editVals.cto_ice || ''} onChange={editField('cto_ice')} /></div>
                <div className="field"><label>IF</label><input type="text" value={editVals.cto_if || ''} onChange={editField('cto_if')} /></div>
                <div className="field"><label>RC</label><input type="text" value={editVals.cto_rc || ''} onChange={editField('cto_rc')} /></div>
                <div className="field"><label>CNSS</label><input type="text" value={editVals.cto_cnss || ''} onChange={editField('cto_cnss')} /></div>
                <div className="field"><label>Patente</label><input type="text" value={editVals.cto_patente || ''} onChange={editField('cto_patente')} /></div>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <div className="field"><label>Dirigeant / Contact</label><input type="text" value={editVals.cto_manager_name || ''} onChange={editField('cto_manager_name')} /></div>
                <div className="field"><label>Fonction</label><input type="text" value={editVals.cto_manager_role || ''} onChange={editField('cto_manager_role')} /></div>
                <div className="field"><label>Téléphone</label><input type="text" value={editVals.cto_manager_phone || ''} onChange={editField('cto_manager_phone')} /></div>
                <div className="field"><label>Email</label><input type="text" value={editVals.cto_manager_email || ''} onChange={editField('cto_manager_email')} /></div>
              </div>
              <div className="modal-foot">
                <button type="button" onClick={() => { setEditDb(null); setEditVals(null); setEditLogoFile(null); }} disabled={busy}>Annuler</button>
                <button className="primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---- Packs (read-only view + editor) ---- */}
      <div className="card">
        <h2>Packs &amp; tarifs</h2>
        <p className="muted">Trois packs (Start / Pro / Max). Les noms et tarifs sont fixes (grille officielle) ; le contenu de chaque pack est modifiable.</p>
        {packDraft ? <p className="muted">Édition en cours…</p> : (
          <>
            <PackCards catalog={catalog} packs={packs} selected={null} />
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => setPackDraft(JSON.parse(JSON.stringify({ packs })))} disabled={busy || packs.length === 0}>Modifier le contenu des packs</button>
            </div>
          </>
        )}
      </div>

      {packDraft && (
        <PacksEditor catalog={catalog} draft={packDraft} setDraft={setPackDraft} onSave={savePacks} onCancel={() => setPackDraft(null)} busy={busy} />
      )}

      <div className="card">
        <h2>Restaurer depuis une sauvegarde</h2>
        <form onSubmit={doRestore}>
          <div className="row">
            <div className="field"><label>Restaurer dans (nouveau nom)</label><input type="text" value={restoreName} onChange={(e) => setRestoreName(e.target.value)} placeholder="acme-restored" required /></div>
            <div className="field"><label>Sauvegarde .zip</label><input type="file" accept=".zip" onChange={(e) => setRestoreFile(e.target.files[0] || null)} required /></div>
            <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={restoreCopy} onChange={(e) => setRestoreCopy(e.target.checked)} /> neutraliser (copie sûre)</label>
            <button className="primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : 'Restaurer'}</button>
          </div>
        </form>
      </div>
    </>
  );
}

// Packs editor — exactly the three packs. Name + price are fixed; included modules
// (from the catalog), included users and the Télédéclaration feature are editable.
function PacksEditor({ catalog, draft, setDraft, onSave, onCancel, busy }: any) {
  const modules = (catalog || []).filter((c) => c.kind === 'module' || c.kind === 'base');
  const patch = (idx, p) => setDraft((d) => ({ ...d, packs: d.packs.map((x, i) => (i === idx ? { ...x, ...p } : x)) }));
  const toggleMod = (idx, module) => setDraft((d) => ({
    ...d,
    packs: d.packs.map((x, i) => {
      if (i !== idx) return x;
      const has = x.modules.includes(module);
      return { ...x, modules: has ? x.modules.filter((m) => m !== module) : [...x.modules, module] };
    }),
  }));
  const toggleFeat = (idx, feat) => setDraft((d) => ({
    ...d,
    packs: d.packs.map((x, i) => {
      if (i !== idx) return x;
      const f = x.features || [];
      return { ...x, features: f.includes(feat) ? f.filter((m) => m !== feat) : [...f, feat] };
    }),
  }));
  return (
    <div className="card" style={{ borderColor: '#b71987' }}>
      <h2>Contenu des packs</h2>
      <p className="muted">Coche les apps incluses dans chaque pack et le nombre d&apos;utilisateurs inclus. Les changements s&apos;appliquent aux <strong>nouveaux</strong> clients.</p>
      {draft.packs.map((p, idx) => (
        <div key={p.id} className="pack-edit">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field"><label>Pack</label><input type="text" value={p.id} disabled style={{ minWidth: 120, textTransform: 'capitalize' }} /></div>
            <div className="field"><label>Utilisateurs inclus</label><input type="text" inputMode="numeric" value={p.users} disabled={busy} onChange={(e) => patch(idx, { users: e.target.value.replace(/[^0-9]/g, '') })} style={{ minWidth: 90 }} /></div>
            <label className="app-check-item" style={{ marginBottom: 6 }}>
              <input type="checkbox" checked={(p.features || []).includes('teledeclaration')} disabled={busy} onChange={() => toggleFeat(idx, 'teledeclaration')} /> Télédéclaration incluse
            </label>
          </div>
          <div className="app-check">
            {modules.map((c) => (
              <label key={c.module} className="app-check-item">
                <input type="checkbox" checked={p.modules.includes(c.module)} disabled={busy} onChange={() => toggleMod(idx, c.module)} />
                {c.label} {c.sub ? <span className="muted">(+{c.sub})</span> : null}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="primary" onClick={onSave} disabled={busy}>{busy ? <span className="spinner" /> : 'Enregistrer les packs'}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Annuler</button>
      </div>
    </div>
  );
}

const JOB_BADGE: any = {
  queued: { t: 'En file', c: '#8a6d00', bg: '#fff6d6' },
  running: { t: 'En cours', c: '#0b5cad', bg: '#e3f0ff' },
  done: { t: 'Terminé', c: '#0a7a3f', bg: '#e3fbe9' },
  error: { t: 'Échec', c: '#b00020', bg: '#ffe3e6' },
};

// Live tracker for background tenant creations (non-blocking queue).
function JobsPanel({ jobs, copy }: any) {
  const list = jobs || [];
  const active = list.filter((j: any) => j.status === 'queued' || j.status === 'running');
  const recent = list.filter((j: any) => j.status === 'done' || j.status === 'error').slice(0, 8);
  if (!active.length && !recent.length) return null;
  const row = (j: any) => {
    const b = JOB_BADGE[j.status] || JOB_BADGE.queued;
    return (
      <div key={j.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: '10px 12px', margin: '8px 0' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{j.name}</strong>
          <span style={{ color: b.c, background: b.bg, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{b.t}</span>
          <span className="muted" style={{ fontSize: 12 }}>{j.label}</span>
        </div>
        {(j.status === 'queued' || j.status === 'running') && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 6, background: '#eee', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${j.pct || 0}%`, background: '#b71987', transition: 'width .5s' }} /></div>
            <span className="muted" style={{ fontSize: 12 }}>{j.step}</span>
          </div>
        )}
        {j.status === 'done' && j.result && (
          <table style={{ marginTop: 8 }}><tbody>
            <tr><td>URL</td><td><a href={j.result.url} target="_blank" rel="noopener">{j.result.url}</a></td></tr>
            <tr><td>Login client</td><td><code>{j.result.admin?.login}</code> <button type="button" onClick={() => copy(j.result.admin?.login, 'Login')}>Copier</button></td></tr>
            <tr><td>Mot de passe</td><td><code>{j.result.admin?.password}</code> <button type="button" onClick={() => copy(j.result.admin?.password, 'Mot de passe')}>Copier</button></td></tr>
            {j.result.recovery && <tr><td className="muted">Recovery (interne)</td><td className="muted"><code>{j.result.recovery.login}</code> / <code>{j.result.recovery.password}</code></td></tr>}
          </tbody></table>
        )}
        {j.status === 'error' && <p className="msg ko" style={{ marginTop: 8 }}>{j.error}</p>}
      </div>
    );
  };
  return (
    <div className="card" style={{ borderColor: '#b71987' }}>
      <h2>Créations {active.length ? `en cours (${active.length})` : 'récentes'}</h2>
      <p className="muted">La création se poursuit en arrière-plan — vous pouvez en lancer d&apos;autres sans attendre.</p>
      {active.map(row)}{recent.map(row)}
    </div>
  );
}
