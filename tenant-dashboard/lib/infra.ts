// Observability backend for the Infra view. Reads from infrastructure already on the
// box: a READ-ONLY docker-socket-proxy (container list / inspect / logs — GET-only,
// POST blocked) and Prometheus (cAdvisor per-container + node-exporter host metrics).
// SCOPE: only our platform stacks are surfaced — the user's other host projects
// (o19_*, odoo11, n8n, vpn) are filtered out, mirroring the backup/scope boundary.
const PROM = process.env.PROM_URL || 'http://monitoring_prometheus:9090';
const PROXY = process.env.DOCKER_PROXY_URL || 'http://cto_docker_proxy:2375';

const IN_SCOPE = (name: string) => /^(cto_|authentik|monitoring_|traefik$)/.test(name);

function stackOf(name: string): string {
  if (name.startsWith('cto_one_prod')) return 'cto_one_prod';
  if (name.startsWith('cto_one_dev')) return 'cto_one_dev';
  if (name === 'cto_postfix') return 'mail';
  if (name === 'cto_tenant_dashboard' || name === 'cto_sales_dashboard' || name === 'cto_docker_proxy') return 'dashboards';
  if (name.startsWith('authentik')) return 'authentik';
  if (name.startsWith('monitoring_')) return 'monitoring';
  if (name === 'traefik') return 'traefik';
  return 'other';
}

async function proxyGet(path: string): Promise<Response> {
  const r = await fetch(`${PROXY}${path}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`docker proxy ${path} -> ${r.status}`);
  return r;
}
async function promQuery(q: string): Promise<any[]> {
  try {
    const r = await fetch(`${PROM}/api/v1/query?query=${encodeURIComponent(q)}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    return j?.data?.result || [];
  } catch { return []; }
}
function byName(result: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of result) { const k = s.metric?.name; if (k) out[k] = Number(s.value?.[1]); }
  return out;
}
const HEALTH_RE = /\((healthy|unhealthy|health: starting)\)/;

export async function listContainers() {
  const [raw, cpu, mem, lim] = await Promise.all([
    proxyGet('/containers/json?all=1').then((r) => r.json()),
    promQuery('sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[2m]))'),
    promQuery('sum by (name) (container_memory_working_set_bytes{name!=""})'),
    promQuery('sum by (name) (container_spec_memory_limit_bytes{name!=""} > 0)'),
  ]);
  const cpuM = byName(cpu), memM = byName(mem), limM = byName(lim);
  return (raw as any[])
    .map((c) => {
      const name = (c.Names?.[0] || '').replace(/^\//, '');
      return {
        id: c.Id, name, stack: stackOf(name),
        state: c.State, status: c.Status, image: c.Image,
        created: c.Created ? c.Created * 1000 : null,
        health: (c.Status?.match(HEALTH_RE)?.[1]) || null,
        ports: (c.Ports || []).filter((p: any) => p.PublicPort).map((p: any) => `${p.PublicPort}→${p.PrivatePort}/${p.Type}`),
        cpuPct: cpuM[name] != null ? Math.round(cpuM[name] * 1000) / 10 : null, // cores → % (100% = 1 core)
        memBytes: memM[name] ?? null,
        memLimit: limM[name] ?? null,
      };
    })
    .filter((c) => IN_SCOPE(c.name))
    .sort((a, b) => a.stack.localeCompare(b.stack) || a.name.localeCompare(b.name));
}

export async function inspectContainer(id: string) {
  if (!/^[a-fA-F0-9]{12,64}$/.test(id)) throw new Error('bad container id');
  const j = await proxyGet(`/containers/${id}/json`).then((r) => r.json());
  const name = (j.Name || '').replace(/^\//, '');
  if (!IN_SCOPE(name)) throw new Error('out of scope');
  const env = (j.Config?.Env || []).map((e: string) => {
    const i = e.indexOf('=');
    const k = i >= 0 ? e.slice(0, i) : e;
    return /(PASS|SECRET|TOKEN|KEY|PWD|CREDENTIAL)/i.test(k) ? `${k}=••••••` : e;
  });
  return {
    name, id: j.Id, image: j.Config?.Image, state: j.State?.Status,
    started: j.State?.StartedAt, restartCount: j.RestartCount,
    health: j.State?.Health?.Status || null,
    restartPolicy: j.HostConfig?.RestartPolicy?.Name || null,
    cmd: j.Config?.Cmd || null, entrypoint: j.Config?.Entrypoint || null,
    networks: Object.keys(j.NetworkSettings?.Networks || {}),
    mounts: (j.Mounts || []).map((m: any) => ({ src: m.Source, dst: m.Destination, rw: m.RW, type: m.Type })),
    ports: j.HostConfig?.PortBindings || {},
    env,
  };
}

// Docker logs for a non-TTY container are a multiplexed stream: each chunk is an
// 8-byte header [streamType,0,0,0, len(uint32 BE)] followed by `len` payload bytes.
// Demux into clean text. (TTY containers send raw text — detect & pass through.)
export async function containerLogs(id: string, tail = 200): Promise<string> {
  if (!/^[a-fA-F0-9]{12,64}$/.test(id)) throw new Error('bad container id');
  const t = Math.min(2000, Math.max(1, tail | 0));
  const r = await proxyGet(`/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&tail=${t}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const strip = (s: string) => s.replace(/\[[0-9;]*m/g, ''); // drop ANSI color codes
  const framed = buf.length >= 8 && buf[0] <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!framed) return strip(buf.toString('utf8'));
  const out: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    const start = i + 8;
    const end = Math.min(start + len, buf.length);
    out.push(buf.toString('utf8', start, end));
    i = end;
  }
  return strip(out.join(''));
}

export async function hostMetrics() {
  const [idle, memTotal, memAvail, fsAvail, fsSize, load1, uptime] = await Promise.all([
    promQuery('avg(rate(node_cpu_seconds_total{mode="idle"}[2m]))'),
    promQuery('node_memory_MemTotal_bytes'),
    promQuery('node_memory_MemAvailable_bytes'),
    promQuery('node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}'),
    promQuery('node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}'),
    promQuery('node_load1'),
    promQuery('node_time_seconds - node_boot_time_seconds'),
  ]);
  const v = (a: any[]) => (a[0] ? Number(a[0].value[1]) : null);
  const id = v(idle);
  return {
    cpuPct: id != null ? Math.round((1 - id) * 1000) / 10 : null,
    memTotal: v(memTotal), memAvail: v(memAvail),
    diskAvail: v(fsAvail), diskSize: v(fsSize),
    load1: v(load1), uptimeSec: v(uptime),
  };
}
