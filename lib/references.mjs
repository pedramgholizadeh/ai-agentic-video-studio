import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REFERENCES_ROOT } from './paths.mjs';
import { analyze as analyzeReference } from './reference.mjs';
import { probe } from './plan.mjs';
import { ffText } from './ffmpeg.mjs';

/*
 * references.mjs — the reference memory.
 *
 * A reference video is expensive to study well, so the studio studies each one
 * exactly once. The folder key is the file's SHA-1: upload the same video on a
 * later job and the profile comes back instantly, with the frames the panel
 * shows as its "suggestions".
 */

export function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1');
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

const refDir = (sha) => path.join(REFERENCES_ROOT, sha.slice(0, 12));

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

async function extractFrames(file, dir, duration) {
  const at = [0.12, 0.5, 0.88].map((k) => Math.max(0.1, Math.min(duration - 0.2, duration * k)));
  const frames = [];
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < at.length; i++) {
    const out = path.join(dir, `frame-${i + 1}.jpg`);
    try {
      await ffText(['-y', '-ss', String(at[i]), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out]);
      if (fs.existsSync(out)) frames.push(`frame-${i + 1}.jpg`);
    } catch {
      /* a frame that refuses to exist is not fatal */
    }
  }
  return frames;
}

/**
 * The analysed profile for one reference file — analysed now or replayed from
 * the memory. Returns { sha, dir, profile, meta, cached }.
 */
export async function ensureProfile(file, { log = () => {}, onStage = null } = {}) {
  if (!fs.existsSync(file)) throw new Error(`رفرنس پیدا نشد: ${file}`);
  const sha = await sha1File(file);
  const dir = refDir(sha);
  const cached = fs.existsSync(path.join(dir, 'profile.json'));
  if (cached) {
    log(`رفرنس از قبل تحلیل شده بود — پروفایل موجود به‌کار گرفته شد (${sha.slice(0, 8)})`);
    return { sha, dir, profile: readJson(path.join(dir, 'profile.json')), meta: readJson(path.join(dir, 'meta.json'), {}), cached: true };
  }
  log(`تحلیل کامل رفرنس (اولین بار): ${path.basename(file)}`);
  const profile = await analyzeReference(file, { out: path.join(dir, 'profile.json'), ...(onStage ? { onStage } : {}) });
  const info = probe(file);
  const meta = {
    sha,
    originalName: path.basename(file),
    originalPath: file,
    size: fs.statSync(file).size,
    duration: Math.round((info.duration || 0) * 100) / 100,
    width: info.width,
    height: info.height,
    fps: info.fps,
    ratio: info.width && info.height ? `${info.width}:${info.height}` : null,
    analyzedAt: new Date().toISOString(),
    jobs: [],
  };
  meta.frames = await extractFrames(file, path.join(dir, 'frames'), info.duration || 1);
  writeJson(path.join(dir, 'meta.json'), meta);
  return { sha, dir, profile, meta, cached: false };
}

/** Every remembered reference, newest first, with a one-line summary. */
export function listLibrary() {
  if (!fs.existsSync(REFERENCES_ROOT)) return [];
  return fs
    .readdirSync(REFERENCES_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(REFERENCES_ROOT, d.name);
      const meta = readJson(path.join(dir, 'meta.json'));
      const profile = readJson(path.join(dir, 'profile.json'));
      if (!meta || !profile) return null;
      const dv = profile.derived || {};
      return {
        sha: meta.sha,
        dir,
        name: meta.originalName,
        path: meta.originalPath || null,
        duration: meta.duration,
        size: meta.size,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        frames: meta.frames || [],
        analyzedAt: meta.analyzedAt,
        jobs: meta.jobs || [],
        summary: { density: dv.density ?? null, energy: dv.energy ?? null, beatLen: dv.beatLen ?? null, look: dv.look ?? null, transitions: dv.transitions ?? null },
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.analyzedAt || '').localeCompare(a.analyzedAt || ''));
}

/**
 * What the panel suggests while the user picks a reference: an exact hit when
 * this very file was studied before, plus the recent library.
 */
export async function suggestFor(file) {
  const library = listLibrary();
  if (!file || !fs.existsSync(file)) return { exact: null, library };
  const sha = await sha1File(file);
  const exact = library.find((r) => r.sha === sha) || null;
  return { exact, library };
}

export function attachJob(sha, jobId) {
  const dir = refDir(sha);
  const meta = readJson(path.join(dir, 'meta.json'));
  if (!meta) return;
  meta.jobs = [...new Set([...(meta.jobs || []), jobId])].slice(-20);
  writeJson(path.join(dir, 'meta.json'), meta);
}
