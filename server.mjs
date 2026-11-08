#!/usr/bin/env node
/**
 * server.mjs — the studio panel + queue, bound to 127.0.0.1 only.
 *
 * Static files come from ui/; everything under /api is JSON. Jobs live in
 * workspace/jobs/<id>/ and their state is plain files (job.json, log.txt,
 * progress.json) — the panel tails them over SSE, an agent edits them through
 * cli.mjs, and both see the same truth.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { UPLOADS_DIR, REFERENCES_ROOT, STUDIO_ROOT } from './lib/paths.mjs';
import { readConfig, writeConfig, publicConfig, DEFAULTS } from './lib/config.mjs';
import { powerBudget, preflight } from './lib/cool.mjs';
import { RATIOS } from './lib/ratios.mjs';
import { SOUND_LEVELS, kitCatalog } from './lib/sfx.mjs';
import { readStudioBrand, writeStudioBrand } from './lib/brand.mjs';
import { probe } from './lib/plan.mjs';
import * as jobs from './lib/jobs.mjs';
import * as runner from './lib/runner.mjs';
import * as agent from './lib/agent.mjs';
import * as agents from './lib/agents.mjs';
import * as references from './lib/references.mjs';
import * as chat from './lib/chat.mjs';
import * as subtitles from './lib/subtitles.mjs';
import { corsHeaders, parseAllowed, isSelf, isMutating, hasMarker } from './lib/cors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const UI = path.join(here, 'ui');
/** Whisper models currently being fetched (in-memory; a restart clears it). */
const modelDownloads = new Set();
const PORT = Number(process.env.PORT) || readConfig().port || 8790;
const originArg = process.argv.find((a) => a.startsWith('--allow-origin'));
const allowed = parseAllowed(
  originArg ? (originArg.includes('=') ? originArg.split('=')[1] : process.argv[process.argv.indexOf(originArg) + 1]) : null,
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.srt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
};

const json = (res, code, data) => {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const fail = (res, code, message) => json(res, code, { error: message });

function readBody(req, { limit = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('bad json');
  }
}

const safeName = (s) => String(s || '').replace(/[^\w.\- \u0600-\u06FF]+/g, '_').slice(0, 120) || 'file';

function streamFile(req, res, file, { download = false } = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, 'not found');
  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const headers = {
    'content-type': type,
    'cache-control': 'no-store',
    ...(download ? { 'content-disposition': `attachment; filename="${path.basename(file)}"` } : {}),
  };
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : stat.size - 1;
    start = Math.max(0, Math.min(start, stat.size - 1));
    end = Math.max(start, Math.min(end, stat.size - 1));
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'content-length': stat.size, 'accept-ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }
}

/** Resolve inside a base directory or null — the sandbox for every media read. */
function inside(base, rel) {
  const abs = path.resolve(base, rel || '.');
  return abs.startsWith(path.resolve(base) + path.sep) || abs === path.resolve(base) ? abs : null;
}

/* ---------- config-driven job defaults ---------- */

function mergeDefaults(body = {}) {
  const cfg = readConfig();
  const d = structuredClone(DEFAULTS);
  return {
    name: body.name || 'job',
    source: {
      video: body.source?.video || null,
      reference: body.source?.reference || null,
      logo: body.source?.logo || null,
    },
    output: {
      ratio: body.output?.ratio || d.output.ratio,
      quality: body.output?.quality || d.output.quality,
      maxMb: Number(body.output?.maxMb) || d.output.maxMb,
      fps: Number(body.output?.fps) || d.output.fps,
      captions: body.output?.captions !== false,
    },
    motion: {
      density: body.motion?.density || d.motion.density,
      material: body.motion?.material || d.motion.material,
    },
    sound: {
      sfx: body.sound?.sfx !== false,
      level: body.sound?.level || d.sound.level,
    },
    transcribe: {
      model: body.transcribe?.model || cfg.transcribe?.model || d.transcribe.model,
      language: body.transcribe?.language || cfg.transcribe?.language || d.transcribe.language,
    },
    engine: {
      mode: body.engine?.mode || cfg.engine?.mode || 'agent',
      agent: body.engine?.agent || cfg.engine?.agent || 'opencode',
      provider: body.engine?.provider || cfg.engine?.provider || 'openrouter',
      model: body.engine?.model ?? cfg.engine?.model ?? null,
    },
    direction: { text: body.direction?.text || '' },
    cpu: { pct: Number(body.cpu?.pct) || cfg.cpu?.pct || 50 },
    edit: {},
  };
}

/* ---------- routes ---------- */

async function api(req, res, url) {
  const q = url.searchParams;
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // -- studio metadata -----------------------------------------------------
  if (url.pathname === '/api/manifest') {
    return json(res, 200, {
      studio: 'video-studio',
      version: '2.0.0',
      // set by the desktop shell; null when the panel runs from the terminal
      appVersion: process.env.VIDEO_STUDIO_APP_VERSION || null,
      updateFeed: process.env.VIDEO_STUDIO_UPDATE_FEED || null,
      ratios: RATIOS.filter((r) => r.id === '16:9' || r.id === '9:16').map((r) => ({ id: r.id, w: r.w, h: r.h })),
      qualities: ['draft', 'looks', 'delivery'],
      densities: ['auto', 'sparse', 'balanced', 'rich'],
      materials: ['glass', 'flat', 'ui'],
      soundLevels: Object.keys(SOUND_LEVELS),
      transcribeModels: ['small', 'medium', 'large-v3', 'large-v3-turbo'],
      stages: jobs.STAGES,
    });
  }

  if (url.pathname === '/api/machine') {
    const cfg = readConfig();
    return json(res, 200, preflight(powerBudget(cfg.cpu?.pct ?? 50)));
  }

  if (url.pathname === '/api/config') {
    if (req.method === 'GET') return json(res, 200, publicConfig());
    const patch = await readJson(req);
    return json(res, 200, publicConfig(writeConfig(patch)));
  }

  if (url.pathname === '/api/brand') {
    if (req.method === 'GET') return json(res, 200, readStudioBrand() || {});
    const patch = await readJson(req);
    return json(res, 200, writeStudioBrand(patch));
  }

  if (url.pathname === '/api/preflight') {
    return json(res, 200, preflight(powerBudget(Number(q.get('cpu')) || readConfig().cpu?.pct || 50)));
  }

  if (url.pathname === '/api/probe') {
    const file = q.get('path');
    if (!file || !fs.existsSync(file)) return fail(res, 404, 'فایل پیدا نشد');
    return json(res, 200, { ...probe(file), size: fs.statSync(file).size, name: path.basename(file) });
  }

  if (url.pathname === '/api/fs') {
    const dir = path.resolve(q.get('dir') || os.homedir());
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .slice(0, 600)
      .map((e) => {
        const full = path.join(dir, e.name);
        let size = null;
        try {
          size = e.isDirectory() ? null : fs.statSync(full).size;
        } catch {}
        return { name: e.name, dir: e.isDirectory(), size };
      })
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return json(res, 200, {
      dir,
      up: path.dirname(dir),
      shortcuts: [os.homedir(), path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Movies'), UPLOADS_DIR],
      entries,
    });
  }

  if (url.pathname === '/api/upload' && req.method === 'POST') {
    // videos are big: stream straight to disk, never through the heap
    const name = safeName(q.get('name') || 'upload.bin');
    const unique = `${Date.now()}-${name}`;
    const dest = path.join(UPLOADS_DIR, unique);
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(dest);
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    });
    return json(res, 200, { path: dest, name: unique, size: fs.statSync(dest).size });
  }

  // -- stage zero: who edits ------------------------------------------------
  if (url.pathname === '/api/agents') {
    return json(res, 200, agents.agentManifest());
  }

  if (url.pathname === '/api/agents/spawn' && req.method === 'POST') {
    const { id, agent: agentId } = await readJson(req);
    const job = jobs.get(id);
    if (!job) return fail(res, 404, 'جاب پیدا نشد');
    try {
      const { pid, bin } = agents.spawnAgent(job, agentId);
      jobs.appendLog(id, 'stage', `${bin} headless روی این جاب اجرا شد (pid ${pid})`);
      return json(res, 200, { spawned: true, pid, bin });
    } catch (err) {
      return json(res, 200, { spawned: false, error: err.message, wake: agents.wakeCommand(id, agentId) });
    }
  }

  // -- the reference memory -------------------------------------------------
  if (url.pathname === '/api/references' && req.method === 'GET') {
    return json(res, 200, { references: references.listLibrary() });
  }

  if (url.pathname === '/api/references/suggest' && req.method === 'POST') {
    const { path: file } = await readJson(req);
    return json(res, 200, await references.suggestFor(file));
  }

  if (seg[0] === 'api' && seg[1] === 'references' && seg[3] === 'frames' && req.method === 'GET') {
    const [_, __, sha, ___, frame] = seg;
    if (!/^frame-\d\.jpg$/.test(frame || '')) return fail(res, 400, 'bad frame');
    const file = inside(path.join(REFERENCES_ROOT, sha.slice(0, 12), 'frames'), frame);
    if (!file) return fail(res, 400, 'bad path');
    return streamFile(req, res, file);
  }

  // -- whisper models ---------------------------------------------------------
  if (url.pathname === '/api/whisper') {
    const cache = process.env.HYPERFRAMES_CACHE_DIR || path.join(os.homedir(), '.cache', 'hyperframes');
    const dir = path.join(cache, 'whisper', 'models');
    const models = ['small', 'medium', 'large-v3', 'large-v3-turbo'].map((m) => {
      const file = path.join(dir, `ggml-${m}.bin`);
      return { id: m, present: fs.existsSync(file), size: fs.existsSync(file) ? fs.statSync(file).size : null };
    });
    return json(res, 200, { dir, models, default: readConfig().transcribe?.model || 'large-v3', downloading: [...modelDownloads] });
  }

  if (url.pathname === '/api/whisper/download' && req.method === 'POST') {
    // fetch the pinned offline model on demand — one download at a time,
    // checksum-verified by scripts/fetch-models.mjs itself
    const { model } = await readJson(req);
    const known = ['tiny', 'base', 'small', 'medium', 'large-v1', 'large-v2', 'large-v3', 'large-v3-turbo'];
    if (!known.includes(model)) return fail(res, 400, `مدل ناشناخته: ${model}`);
    if (modelDownloads.has(model)) return json(res, 200, { started: false, reason: 'already downloading', model });
    const cache = process.env.HYPERFRAMES_CACHE_DIR || path.join(os.homedir(), '.cache', 'hyperframes');
    if (fs.existsSync(path.join(cache, 'whisper', 'models', `ggml-${model}.bin`)))
      return json(res, 200, { started: false, reason: 'already present', model });
    modelDownloads.add(model);
    const logFile = path.join(UPLOADS_DIR, '..', 'whisper-download.log');
    const child = spawn(process.execPath, [path.join(here, 'scripts', 'fetch-models.mjs'), '--model', model], {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
    });
    child.on('close', () => modelDownloads.delete(model));
    child.unref();
    return json(res, 200, { started: true, model, log: logFile });
  }

  if (url.pathname === '/api/sfx') {
    return json(res, 200, { catalog: kitCatalog() });
  }

  // -- jobs -------------------------------------------------------------------
  if (url.pathname === '/api/jobs' && req.method === 'POST') {
    const body = await readJson(req);
    const config = mergeDefaults(body);
    if (!config.source.video || !fs.existsSync(config.source.video)) return fail(res, 400, 'ویدیوی خودت ثبت نشده یا پیدا نشد.');
    if (!config.source.reference) return fail(res, 400, 'ویدیوی رفرنس لازم است — این استودیو با یک رفرنس یاد می‌گیرد.');
    if (!fs.existsSync(config.source.reference)) return fail(res, 400, 'فایل رفرنس پیدا نشد.');
    const job = jobs.create(config);
    jobs.appendLog(job.id, 'info', `منبع: ${config.source.video}`);
    jobs.appendLog(job.id, 'info', `رفرنس: ${config.source.reference}`);
    return json(res, 200, job);
  }

  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    return json(res, 200, { jobs: jobs.list() });
  }

  if (seg[0] === 'api' && seg[1] === 'jobs' && seg.length === 3 && req.method === 'GET') {
    const job = jobs.get(seg[2]);
    return job ? json(res, 200, job) : fail(res, 404, 'جاب پیدا نشد');
  }

  if (seg[0] === 'api' && seg[1] === 'jobs' && seg.length === 3 && req.method === 'DELETE') {
    const id = seg[2];
    const job = jobs.get(id);
    if (!job) return fail(res, 404, 'جاب پیدا نشد');
    if (job.status === 'running') runner.cancel(id);
    fs.rmSync(jobs.paths(id).root, { recursive: true, force: true });
    return json(res, 200, { deleted: id });
  }

  if (seg[1] === 'jobs' && seg[2] && seg[3]) {
    const id = seg[2];
    const action = seg[3];
    const job = jobs.get(id);
    if (!job && action !== 'events') return fail(res, 404, 'جاب پیدا نشد');

    if (action === 'start' && req.method === 'POST') {
      if (['running', 'review'].includes(job.status)) return fail(res, 409, 'جاب همین حالا در جریان است.');
      if (job.config.engine.mode === 'agent') {
        const enqueued = agent.enqueue(job);
        let spawned = null;
        if (agents.installed(agents.AGENT_CLIS.find((a) => a.id === job.config.engine.agent)?.bin || '')) {
          try {
            spawned = agents.spawnAgent(enqueued, job.config.engine.agent);
            jobs.appendLog(id, 'stage', `${spawned.bin} headless اجرا شد (pid ${spawned.pid})`);
          } catch (err) {
            jobs.appendLog(id, 'warn', `اسپاون خودکار نشد: ${err.message}`);
          }
        }
        return json(res, 200, {
          queued: true,
          handoffPath: jobs.paths(id).handoff,
          wake: agents.wakeCommand(id, job.config.engine.agent),
          spawned,
        });
      }
      jobs.appendLog(id, 'stage', 'شروع پایپ‌لاین استودیو');
      runner.runJob(id).catch(() => {}); // the runner records its own failure
      return json(res, 200, { running: true });
    }

    if (action === 'cancel' && req.method === 'POST') {
      const ok = runner.cancel(id);
      jobs.setStatus(id, 'cancelled', { finishedAt: new Date().toISOString() });
      jobs.appendLog(id, 'warn', 'لغو شد');
      return json(res, 200, { cancelled: true, killed: ok });
    }

    if (action === 'approve' && req.method === 'POST') {
      const { gate } = await readJson(req);
      const kind = gate || job.gate?.kind;
      if (!['transcript', 'preview'].includes(kind)) return fail(res, 400, 'دروازهٔ نامعتبر است');
      const approved = { ...(job.approved || {}), [kind]: new Date().toISOString() };
      jobs.closeGate(id);
      jobs.patch(id, { approved, pendingRerun: false });
      jobs.appendLog(id, 'stage', kind === 'transcript' ? 'ترنسکریپت تایید شد' : 'دمو تایید شد — خروجی نهایی می‌سازد');
      if (job.config.engine.mode !== 'agent') runner.runJob(id).catch(() => {});
      return json(res, 200, { approved: kind });
    }

    if (action === 'chat' && req.method === 'POST') {
      const { text } = await readJson(req);
      if (!String(text || '').trim()) return fail(res, 400, 'متن خالی است');
      const entry = chat.appendMessage(id, { role: 'user', text });
      const intent = chat.parseEditIntent(text);
      if (!intent) {
        chat.appendMessage(id, {
          role: 'studio',
          text:
            job.config.engine.mode === 'agent'
              ? 'ثبت شد — ایجنت موقع باز شدن دروازهٔ بعدی این پیام را می‌خواند.'
              : 'این درخواست را خودکار نشناختم؛ دقیق‌تر بگو (مثلاً «تراکم بیشتر» یا «زیرنویس بالاتر») یا پیام برای ایجنت ذخیره شد.',
          meta: { intent: null },
        });
        return json(res, 200, { ok: true, intent: null });
      }
      if (intent.kind === 'approve') {
        chat.appendMessage(id, { role: 'studio', text: intent.fa, meta: { intent: intent.kind } });
        const current = jobs.get(id);
        if (current.gate?.kind && current.config.engine.mode !== 'agent') {
          const approved = { ...(current.approved || {}), [current.gate.kind]: new Date().toISOString() };
          jobs.closeGate(id);
          jobs.patch(id, { approved, pendingRerun: false });
          runner.runJob(id).catch(() => {});
        }
        return json(res, 200, { ok: true, intent: intent });
      }
      if (intent.kind === 'transcript-line') {
        const cues = subtitles.readSrt(jobs.paths(id).transcript);
        const i = Number(intent.meta.line) - 1;
        if (i < 0 || i >= cues.length) {
          chat.appendMessage(id, { role: 'studio', text: `خط ${intent.meta.line} در ترنسکریپت نیست (${cues.length} خط داریم).`, meta: { intent: intent.kind } });
          return json(res, 200, { ok: false, error: 'line out of range' });
        }
        cues[i].text = intent.meta.text;
        subtitles.writeSrt(jobs.paths(id).transcript, cues);
        chat.invalidateArtifacts(id, intent.invalidate);
        chat.appendMessage(id, { role: 'studio', text: intent.fa, meta: { intent: intent.kind, line: i + 1 } });
        const cur = jobs.get(id);
        // agent-mode jobs belong to the claiming agent — the panel never
        // starts the built-in runner behind its back; it reads chat.jsonl
        if (cur.status === 'review' && cur.config.engine.mode !== 'agent') runner.runJob(id).catch(() => {});
        return json(res, 200, { ok: true, intent: intent });
      }
      // a config patch — applied at once; artifacts downstream are invalidated
      jobs.patch(id, { config: deepMergeConfig(job.config, intent.patch), pendingRerun: true });
      chat.invalidateArtifacts(id, intent.invalidate);
      chat.appendMessage(id, { role: 'studio', text: intent.fa, meta: { intent: intent.kind, applied: true } });
      jobs.appendLog(id, 'info', `ادیت چت اعمال شد: ${intent.fa}`);
      const current = jobs.get(id);
      if (current.status === 'review' && current.config.engine.mode !== 'agent') runner.runJob(id).catch(() => {});
      return json(res, 200, { ok: true, intent: intent });
    }

    if (action === 'chat' && req.method === 'GET') {
      return json(res, 200, { messages: chat.readMessages(id) });
    }

    if (action === 'transcript' && req.method === 'GET') {
      if (!fs.existsSync(jobs.paths(id).transcript)) return fail(res, 404, 'ترنسکریپت هنوز ساخته نشده');
      return json(res, 200, { cues: subtitles.readSrt(jobs.paths(id).transcript) });
    }

    if (action === 'transcript' && req.method === 'PUT') {
      const { cues } = await readJson(req);
      if (!Array.isArray(cues) || !cues.length) return fail(res, 400, 'خط‌ها نامعتبرند');
      const clean = cues.map((c, i) => ({ start: Number(c.start) || 0, end: Number(c.end) || 0, text: String(c.text || '').trim(), index: i + 1 })).filter((c) => c.text && c.end > c.start);
      if (!clean.length) return fail(res, 400, 'هیچ خط معتبری نیست');
      subtitles.writeSrt(jobs.paths(id).transcript, clean);
      jobs.appendLog(id, 'info', `ترنسکریپت ویرایش شد — ${clean.length} خط ذخیه شد`);
      return json(res, 200, { cues: subtitles.readSrt(jobs.paths(id).transcript) });
    }

    if (action === 'events' && req.method === 'GET') {
      return sse(req, res, id);
    }

    if (action === 'source' && req.method === 'GET') {
      // the user's own video, streamed for the transcript editor's seek player
      const file = job.config?.source?.video;
      if (!file || !fs.existsSync(file)) return fail(res, 404, 'ویدیوی منبع در دسترس نیست');
      return streamFile(req, res, file);
    }

    if (action === 'media' && req.method === 'GET') {
      const rel = q.get('file');
      const file = inside(jobs.paths(id).root, rel);
      if (!file) return fail(res, 400, 'bad path');
      return streamFile(req, res, file);
    }

    if (action === 'preview' && req.method === 'GET') {
      const current = jobs.get(id);
      const file =
        current.output?.file && current.status === 'succeeded'
          ? current.output.file
          : path.join(jobs.paths(id).review, `${id}_preview.mp4`);
      if (!fs.existsSync(file)) return fail(res, 404, 'پیش‌نمایشی نیست');
      return streamFile(req, res, file);
    }

    if (action === 'download' && req.method === 'GET') {
      const current = jobs.get(id);
      if (!current.output?.file || !fs.existsSync(current.output.file)) return fail(res, 404, 'خروجی نهایی هنوز نیست');
      return streamFile(req, res, current.output.file, { download: true });
    }

    if (action === 'stills' && req.method === 'GET') {
      const dir = path.join(jobs.paths(id).review, 'stills');
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
      return json(res, 200, { stills: files });
    }

    if (action === 'still' && req.method === 'GET') {
      const name = q.get('name') || '';
      if (!/^[\w.-]+\.png$/.test(name)) return fail(res, 400, 'bad name');
      const file = inside(path.join(jobs.paths(id).review, 'stills'), name);
      if (!file) return fail(res, 400, 'bad path');
      return streamFile(req, res, file);
    }

    if (action === 'artifacts' && req.method === 'GET') {
      const p = jobs.paths(id);
      const pick = (f) => (fs.existsSync(f) ? { file: f, size: fs.statSync(f).size } : null);
      return json(res, 200, {
        brief: pick(p.brief),
        brand: pick(p.brand),
        beats: pick(p.beats),
        style: pick(p.style),
        scenario: pick(path.join(p.root, 'scenario.md')),
        timeline: pick(path.join(p.root, 'timeline.json')),
        sound: pick(path.join(p.root, 'sound.json')),
        assets: pick(path.join(p.root, 'assets.json')),
        handoff: pick(p.handoff),
        chat: pick(p.chat),
        agentOut: pick(path.join(p.root, 'agent-out.txt')),
      });
    }
  }

  return fail(res, 404, `unknown api: ${url.pathname}`);
}

function deepMergeConfig(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = deepMergeConfig(a[k] || {}, v);
    else if (v !== undefined) a[k] = v;
  }
  return a;
}

/** The live wire: progress + log tail + terminal state, every 700 ms. */
function sse(req, res, id) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  let fromByte = 0;
  let closed = false;
  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const tick = () => {
    if (closed) return;
    const job = jobs.get(id);
    if (!job) {
      send('state', { status: 'deleted' });
      cleanup();
      return;
    }
    const prog = fs.existsSync(jobs.paths(id).progress) ? JSON.parse(fs.readFileSync(jobs.paths(id).progress, 'utf8')) : null;
    if (prog) send('progress', prog);
    const { text, next } = jobs.readLog(id, { fromByte });
    if (text) send('log', { chunk: text });
    fromByte = next;
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) {
      send('state', { status: job.status, output: job.output, error: job.error, gate: null });
      cleanup();
      return;
    }
    send('state', { status: job.status, gate: job.gate, approved: job.approved || null });
  };
  const timer = setInterval(tick, 700);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    try {
      res.end();
    } catch {}
  };
  req.on('close', cleanup);
  tick();
}

/* ---------- static files ---------- */

function serveStatic(req, res, url) {
  // strip the leading slash BEFORE resolving: path.resolve would treat an
  // absolute rel as a filesystem-root path and escape the ui/ sandbox
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const file = inside(UI, rel);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // a panel route that does not exist falls back to the app itself
    if (!rel.includes('.')) return streamFile(req, res, path.join(UI, 'index.html'));
    return fail(res, 404, 'not found');
  }
  streamFile(req, res, file);
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname.startsWith('/api')) {
      const cors = corsHeaders(req.headers.origin, allowed);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors || {});
        return res.end();
      }
      // a stranger may read, but only this panel (or a marked, allowed origin)
      // may change anything. No Origin header at all = curl or the CLI on this
      // machine — they are the studio's own hands, not a browser.
      if (
        isMutating(req) &&
        req.headers.origin &&
        !isSelf(req.headers.origin, req.headers.host) &&
        !(cors && hasMarker(req))
      ) {
        return fail(res, 403, 'cross-origin write rejected');
      }
      if (cors) for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
      return await api(req, res, url);
    }
    return serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) return fail(res, 500, String(err.message || err));
    res.end();
  }
});

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`video-studio → http://127.0.0.1:${PORT}  (فقط لوکال)`);
});
