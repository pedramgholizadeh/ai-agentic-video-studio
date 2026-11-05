import fs from 'node:fs';
import path from 'node:path';
import { JOBS_ROOT, jobDir } from './paths.mjs';

export const STATES = ['draft', 'queued', 'running', 'succeeded', 'failed', 'cancelled'];

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function newId(name) {
  return `${stamp()}-${slugify(name) || 'job'}`;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function paths(id) {
  const root = jobDir(id);
  return {
    root,
    job: path.join(root, 'job.json'),
    log: path.join(root, 'log.txt'),
    progress: path.join(root, 'progress.json'),
    input: path.join(root, 'input'),
    project: path.join(root, 'project'),
    out: path.join(root, 'out'),
    handoff: path.join(root, 'HANDOFF.md'),
    plan: path.join(root, 'plan.json'),
  };
}

export function create(config) {
  const id = newId(config.name);
  const p = paths(id);
  const job = {
    id,
    createdAt: new Date().toISOString(),
    status: 'draft',
    engine: config.engine?.mode || 'agent',
    config,
    progress: { pct: 0, stage: 'draft', label: 'در انتظار شروع', steps: [] },
    output: null,
    error: null,
  };
  fs.mkdirSync(p.input, { recursive: true });
  fs.mkdirSync(p.out, { recursive: true });
  writeJson(p.job, job);
  appendLog(id, 'created', `شغل ${id} ساخته شد`);
  return job;
}

export function get(id) {
  const job = readJson(paths(id).job);
  if (!job) return null;
  // progress.json is written on its own hot path; the record always shows the
  // latest bar, so a reader never needs two calls.
  const progress = readJson(paths(id).progress);
  return progress ? { ...job, progress } : job;
}

export function save(job) {
  writeJson(paths(job.id).job, job);
  return job;
}

export function patch(id, changes) {
  const job = get(id);
  if (!job) return null;
  const next = { ...job, ...changes, updatedAt: new Date().toISOString() };
  return save(next);
}

export function list() {
  fs.mkdirSync(JOBS_ROOT, { recursive: true });
  return fs
    .readdirSync(JOBS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => get(d.name))
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/*
 * Stages drive the percentage bar. `pct` is absolute, so a step can jump
 * backwards only if it really is a different attempt.
 *
 * The two engines share the bar: the captions path simply never enters
 * `reference`, `beats`, `sfx` and `composite`.
 */
export const STAGES = [
  { key: 'prepare', label: 'آماده‌سازی و سنجش منبع', from: 0, to: 5 },
  { key: 'transcribe', label: 'پیاده‌سازی گفتار به متن', from: 5, to: 14 },
  { key: 'reference', label: 'آموزش سبک از ویدیوی رفرنس', from: 14, to: 20 },
  { key: 'direction', label: 'جهت‌دهی ادیت', from: 20, to: 24 },
  { key: 'beats', label: 'چیدن بیت‌های موشن گرافیک', from: 24, to: 34 },
  { key: 'sfx', label: 'طراحی و میکس صداهای افکت', from: 34, to: 40 },
  { key: 'scaffold', label: 'چینش صحنه و لایهٔ موشن', from: 40, to: 50 },
  { key: 'check', label: 'اعتبارسنجی ترکیب', from: 50, to: 56 },
  { key: 'stills', label: 'تصاویر بازبینی', from: 56, to: 62 },
  { key: 'render', label: 'رندر فریم‌به‌فریم', from: 62, to: 90 },
  { key: 'composite', label: 'کلاژ روی ویدیوی اصلی', from: 90, to: 95 },
  { key: 'fit', label: 'پایبندی به سقف حجم', from: 95, to: 98 },
  { key: 'verify', label: 'راستی‌آزمایی فایل نهایی', from: 98, to: 100 },
];

export function setProgress(id, stageKey, { sub = 0, label = null, eta = null } = {}) {
  const stage = STAGES.find((s) => s.key === stageKey) || STAGES[0];
  const span = stage.to - stage.from;
  const pct = Math.max(
    0,
    Math.min(100, Math.round(stage.from + span * Math.max(0, Math.min(1, sub)))),
  );
  const p = paths(id);
  const prev = readJson(p.progress, { steps: [] });
  const steps = upsertStep(prev.steps || [], stage, pct);
  const progress = {
    pct,
    stage: stageKey,
    label: label || stage.label,
    steps,
    eta,
    startedAt: prev.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeJson(p.progress, progress);
  return progress;
}

function upsertStep(steps, stage, pct) {
  const i = steps.findIndex((s) => s.key === stage.key);
  const entry = {
    key: stage.key,
    label: stage.label,
    state: pct >= stage.to ? 'done' : pct > stage.from ? 'active' : 'pending',
    pct: Math.min(100, Math.round(((pct - stage.from) / Math.max(1, stage.to - stage.from)) * 100)),
  };
  if (i >= 0) steps[i] = entry;
  else steps.push(entry);
  for (const s of steps) if (s.state === 'active' && s.key !== stage.key) s.state = 'done';
  return steps;
}

export function appendLog(id, level, line) {
  const p = paths(id);
  fs.mkdirSync(path.dirname(p.log), { recursive: true });
  fs.appendFileSync(p.log, `${new Date().toISOString()} [${level}] ${line}\n`, 'utf8');
  return p.log;
}

export function readLog(id, { fromByte = 0 } = {}) {
  const p = paths(id);
  if (!fs.existsSync(p.log)) return { text: '', next: 0 };
  const fd = fs.openSync(p.log, 'r');
  const size = fs.fstatSync(fd).size;
  const start = Math.max(0, Math.min(fromByte, size));
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return { text: buf.toString('utf8'), next: size };
}

/**
 * The queue contract between the panel and an agent. A queued job is claimed
 * exactly once; whoever holds the claim owns the log until it finishes.
 */
export function claim(id, by) {
  const job = get(id);
  if (!job || job.status !== 'queued') return null;
  return patch(id, { status: 'running', claimedBy: by, claimedAt: new Date().toISOString() });
}

export function claimNextQueued(by) {
  const queued = list().filter((j) => j.status === 'queued');
  if (!queued.length) return null;
  const oldest = queued[queued.length - 1];
  return claim(oldest.id, by);
}

export function setStatus(id, status, extra = {}) {
  return patch(id, { status, ...extra });
}
