// In-process tenant-provisioning queue. Next standalone runs a single Node process,
// so this module singleton is shared across all requests. NON-BLOCKING: the create
// route enqueues a job and returns immediately; a background pump runs the long
// (~1 min) Odoo provisioning. Jobs are SERIALIZED PER INSTANCE (one createdb at a
// time per Odoo deployment) to avoid Postgres CREATE DATABASE contention; different
// instances drain in parallel. In-memory only — a container restart drops queued /
// in-flight jobs (acceptable: creates are quick and rare relative to restarts).
import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface Job {
  id: string;
  instance: string;
  name: string;
  label: string;
  payload: any;        // SERVER-SIDE ONLY, never projected to clients
  status: JobStatus;
  step: string;
  pct: number;
  result: any;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export type Runner = (job: Job, onStep: (step: string, pct: number) => void) => Promise<any>;

const jobs = new Map<string, Job>();
const queues = new Map<string, string[]>();
const active = new Set<string>();
let runner: Runner | null = null;
const MAX_JOBS = 200;

export function setRunner(r: Runner) { runner = r; }

export function hasActiveJob(instance: string, name: string): boolean {
  for (const j of jobs.values()) {
    if (j.instance === instance && j.name === name && (j.status === 'queued' || j.status === 'running')) return true;
  }
  return false;
}

export function enqueue(input: { instance: string; name: string; label: string; payload: any }): Job {
  const job: Job = {
    id: randomUUID(),
    instance: input.instance,
    name: input.name,
    label: input.label,
    payload: input.payload,
    status: 'queued',
    step: 'En file d’attente',
    pct: 0,
    result: null,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  jobs.set(job.id, job);
  prune();
  const q = queues.get(job.instance) || [];
  q.push(job.id);
  queues.set(job.instance, q);
  void drain(job.instance);
  return job;
}

async function drain(instance: string) {
  if (active.has(instance)) return;
  active.add(instance);
  try {
    const q = queues.get(instance) || [];
    while (q.length) {
      const id = q.shift() as string;
      const job = jobs.get(id);
      if (!job) continue;
      job.status = 'running';
      job.startedAt = Date.now();
      job.step = 'Démarrage…';
      job.pct = 5;
      try {
        if (!runner) throw new Error('queue runner not configured');
        job.result = await runner(job, (step, pct) => { job.step = step; job.pct = pct; });
        job.status = 'done';
        job.step = 'Terminé';
        job.pct = 100;
      } catch (e: any) {
        job.status = 'error';
        job.error = String(e?.message || e);
        job.step = 'Échec';
      } finally {
        job.finishedAt = Date.now();
      }
    }
  } finally {
    active.delete(instance);
    const q = queues.get(instance) || [];
    if (q.length) void drain(instance);
  }
}

function prune() {
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.values()]
    .filter((j) => j.status === 'done' || j.status === 'error')
    .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  for (const j of finished) {
    if (jobs.size <= MAX_JOBS) break;
    jobs.delete(j.id);
  }
}

export function publicJob(j: Job) {
  return {
    id: j.id, instance: j.instance, name: j.name, label: j.label,
    status: j.status, step: j.step, pct: j.pct,
    error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt,
    result: j.status === 'done' ? j.result : null,
  };
}

export function listJobs(limit = 60) {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(publicJob);
}
