import fs from 'node:fs';
import path from 'node:path';
import { JOBS_ROOT, jobDir } from './paths.mjs';

export const STATES = ['draft', 'queued', 'running', 'review', 'succeeded', 'failed', 'cancelled'];

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
    review: path.join(root, 'review'),
    handoff: path.join(root, 'HANDOFF.md'),
    plan: path.join(root, 'plan.json'),
    brief: path.join(root, 'brief.json'),
    brand: path.join(root, 'brand.json'),
    beats: path.join(root, 'beats.json'),
    style: path.join(root, 'style.json'),
    transcript: path.join(root, 'input', 'script.fa.srt'),
    chat: path.join(root, 'chat.jsonl'),
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
    gate: null,
    output: null,
    error: null,
  };
  for (const dir of [p.input, p.out, p.review]) fs.mkdirSync(dir, { recursive: true });
  writeJson(p.job, job);
  appendLog(id, 'created', `جاب ${id} ساخته شد`);
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
 * backwards only if it really is a different attempt. The two `review` gates
 * (transcript and preview) hold the job at a low pct while the user reads.
 */
export const STAGES = [
  { key: 'prepare', label: 'آماده‌سازی و سنجش ویدیو', from: 0, to: 4 },
  { key: 'transcribe', label: 'پیاده‌سازی گفتار به متن (whisper)', from: 4, to: 16 },
  { key: 'review', label: 'بازبینی و ویرایش ترنسکریپت', from: 16, to: 18 },
  { key: 'understand', label: 'درک محتوا و نوشتن بریف', from: 18, to: 26 },
  { key: 'reference', label: 'تحلیل پیکسل‌پرفکت رفرنس', from: 26, to: 36 },
  { key: 'assets', label: 'جمع‌آوری اسِت‌ها (لوگو، افکت، فونت)', from: 36, to: 42 },
  { key: 'strategy', label: 'سناریو و استراتژی تدوین', from: 42, to: 52 },
  { key: 'scaffold', label: 'چینش صحنه و لایهٔ موشن', from: 52, to: 62 },
  { key: 'preview', label: 'دموی اولیهٔ کم‌حجم', from: 62, to: 72 },
  { key: 'final', label: 'رندر و کامپوزیت نهایی', from: 72, to: 94 },
  { key: 'verify', label: 'راستی‌آزمایی خروجی', from: 94, to: 100 },
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

/*
 * The queue contract between the panel and an agent. A queued job is claimed
 * exactly once; whoever holds the claim owns the log until it finishes.
 */
export function claim(id, by) {
  const job = get(id);
  if (!job || job.status !== 'queued') return null;
  return patch(id, { status: 'running', gate: null, claimedBy: by, claimedAt: new Date().toISOString() });
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

/**
 * A review gate parks the job: the pipeline stops, the panel shows the edit
 * surface, and the bar sits still until the user (or the agent, via the
 * contract) approves. `gate` = { kind: 'transcript' | 'preview', at }.
 */
export function openGate(id, kind, label) {
  const job = get(id);
  if (!job) return null;
  setProgress(id, kind === 'transcript' ? 'review' : 'preview', { sub: kind === 'transcript' ? 0.5 : 1, label });
  return patch(id, { status: 'review', gate: { kind, at: new Date().toISOString() } });
}

export function closeGate(id) {
  return patch(id, { status: 'running', gate: null });
}

export function gate(id) {
  return get(id)?.gate || null;
}
