'use client';

import { useEffect, useState, useCallback } from 'react';

function fmtBytes(n: any) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let x = Number(n);
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function fmtDur(sec: any) {
  if (sec == null) return '—';
  const s = Math.floor(sec); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}j ${h}h`; if (h) return `${h}h ${m}m`; return `${m}m`;
}
const STATE = (s: string): any => (({
  running: { c: '#0a7a3f', bg: '#e3fbe9' }, restarting: { c: '#8a6d00', bg: '#fff6d6' },
  exited: { c: '#b00020', bg: '#ffe3e6' }, dead: { c: '#b00020', bg: '#ffe3e6' },
  paused: { c: '#8a6d00', bg: '#fff6d6' }, created: { c: '#555', bg: '#eee' },
} as any)[s] || { c: '#555', bg: '#eee' });

function Gauge({ label, pct, sub }: any) {
  const p = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const col = p > 90 ? '#b00020' : p > 75 ? '#d98300' : '#0a7a3f';
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{label}</strong><span className="muted">{pct == null ? '—' : `${pct}%`}</span></div>
      <div style={{ height: 8, background: '#eee', borderRadius: 5, overflow: 'hidden', margin: '6px 0' }}>
        <div style={{ height: '100%', width: `${p}%`, background: col, transition: 'width .6s' }} />
      </div>
      <span className="muted" style={{ fontSize: 12 }}>{sub}</span>
    </div>
  );
}

export default function Infra() {
  const [containers, setContainers] = useState<any[]>([]);
  const [host, setHost] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [info, setInfo] = useState<any>(null);
  const [logs, setLogs] = useState<string>('');
  const [tail, setTail] = useState(200);

  const refresh = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([
        fetch('/api/infra/containers', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/infra/host', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (c.ok) { setContainers(c.containers); setErr(null); } else setErr(c.error);
      if (h.ok) setHost(h.host);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);

  const loadLogs = useCallback(async (id: string, t: number) => {
    setLogs('Chargement…');
    const l = await fetch(`/api/infra/logs?id=${id}&tail=${t}`, { cache: 'no-store' }).then((r) => r.json());
    setLogs(l.ok ? (l.logs || '(vide)') : `Erreur: ${l.error}`);
  }, []);

  const openContainer = useCallback(async (c: any) => {
    setSel(c); setInfo(null); setLogs('Chargement…');
    const i = await fetch(`/api/infra/inspect?id=${c.id}`, { cache: 'no-store' }).then((r) => r.json());
    setInfo(i.ok ? i.info : { error: i.error });
    loadLogs(c.id, tail);
  }, [tail, loadLogs]);

  const groups: Record<string, any[]> = {};
  for (const c of containers) (groups[c.stack] ||= []).push(c);
  const stacks = Object.keys(groups).sort();
  const upCount = containers.filter((c) => c.state === 'running').length;

  return (
    <>
      <div className="bar">
        <strong>Conteneurs</strong>
        <span className="muted">{upCount}/{containers.length} en marche</span>
        <button onClick={refresh} style={{ marginLeft: 'auto' }}>↻ Rafraîchir</button>
      </div>

      {err && <div className="msg ko">Infra indisponible : {err}</div>}

      <div className="card">
        <h2>Hôte (VPS)</h2>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <Gauge label="CPU" pct={host?.cpuPct} sub={host?.load1 != null ? `load ${host.load1.toFixed(2)}` : ''} />
          <Gauge label="Mémoire" pct={host && host.memTotal ? Math.round((1 - host.memAvail / host.memTotal) * 1000) / 10 : null} sub={host ? `${fmtBytes(host.memTotal - host.memAvail)} / ${fmtBytes(host.memTotal)}` : ''} />
          <Gauge label="Disque /" pct={host && host.diskSize ? Math.round((1 - host.diskAvail / host.diskSize) * 1000) / 10 : null} sub={host ? `${fmtBytes(host.diskSize - host.diskAvail)} / ${fmtBytes(host.diskSize)}` : ''} />
          <div style={{ minWidth: 120 }}><strong>Uptime</strong><div className="muted">{fmtDur(host?.uptimeSec)}</div></div>
        </div>
      </div>

      {stacks.map((stack) => (
        <div className="card" key={stack}>
          <h2 style={{ textTransform: 'capitalize' }}>{stack.replace(/_/g, ' ')}</h2>
          <table>
            <thead><tr><th>Conteneur</th><th>État</th><th>CPU</th><th>RAM</th><th>Ports</th><th>Image</th><th></th></tr></thead>
            <tbody>
              {groups[stack].map((c) => { const st = STATE(c.state); return (
                <tr key={c.id}>
                  <td className="name">{c.name}</td>
                  <td>
                    <span style={{ color: st.c, background: st.bg, borderRadius: 20, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{c.state}</span>
                    {c.health && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{c.health}</span>}
                  </td>
                  <td>{c.cpuPct != null ? `${c.cpuPct}%` : '—'}</td>
                  <td title={c.memLimit ? `limite ${fmtBytes(c.memLimit)}` : ''}>{fmtBytes(c.memBytes)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{(c.ports || []).join(', ') || '—'}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{c.image}</td>
                  <td><button onClick={() => openContainer(c)}>Détails</button></td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      ))}

      {sel && (
        <div className="modal-backdrop" onClick={() => setSel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="modal-head"><h2>{sel.name}</h2><button onClick={() => setSel(null)}>✕</button></div>
            {info && !info.error && (
              <table><tbody>
                <tr><td>Image</td><td className="muted">{info.image}</td></tr>
                <tr><td>État</td><td>{info.state}{info.health ? ` (${info.health})` : ''} · {info.restartCount} redémarrages · policy {info.restartPolicy || '—'}</td></tr>
                <tr><td>Démarré</td><td className="muted">{info.started}</td></tr>
                <tr><td>Réseaux</td><td className="muted">{(info.networks || []).join(', ')}</td></tr>
                <tr><td>Montages</td><td className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{(info.mounts || []).map((m: any) => `${m.src} → ${m.dst}${m.rw ? '' : ' (ro)'}`).join('\n') || '—'}</td></tr>
                <tr><td>Commande</td><td className="muted" style={{ fontSize: 12 }}>{(info.cmd || []).join(' ') || '—'}</td></tr>
                <tr><td>Env</td><td><span className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto', display: 'block' }}>{(info.env || []).join('\n') || '—'}</span></td></tr>
              </tbody></table>
            )}
            {info?.error && <p className="msg ko">{info.error}</p>}
            <div className="row" style={{ alignItems: 'center', marginTop: 12 }}>
              <strong>Logs</strong>
              <span style={{ marginLeft: 'auto' }} />
              {[100, 200, 500].map((t) => <button key={t} className={tail === t ? 'primary' : ''} onClick={() => { setTail(t); loadLogs(sel.id, t); }}>{t}</button>)}
              <button onClick={() => loadLogs(sel.id, tail)}>↻</button>
            </div>
            <pre style={{ background: '#0d1117', color: '#c9d1d9', padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.4, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 8 }}>{logs}</pre>
          </div>
        </div>
      )}
    </>
  );
}
