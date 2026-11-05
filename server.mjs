#!/usr/bin/env node
/**
 * Video Studio — the local panel for the video skills.
 *
 *   node server.mjs [--port 8790]
 *
 * Binds 127.0.0.1 only. No dependencies: the repo stays a static site and the
 * panel is a tool, not an app with a build step.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STUDIO_ROOT, JOBS_ROOT, CONFIG_FILE, CONFIG_DIR } from './lib/paths.mjs';
import { RATIOS, ratioById, geometry } from './lib/ratios.mjs';
import { BACKGROUNDS, buildStage, DEFAULT_BACKGROUND } from './lib/backgrounds.mjs';
import { publicConfig, readConfig, writeConfig, PROVIDER_PRESETS } from './lib/config.mjs';
import { listModels, resolveProvider } from './lib/providers.mjs';
import { preflight, powerBudget } from './lib/cool.mjs';
import { recipeList, DENSITY, MATERIALS, TRANSITIONS } from './lib/motions.mjs';
import { kitCatalog, SOUND_LEVELS } from './lib/sfx.mjs';
import { ICON_META, bundledNames } from './lib/icons.mjs';
import { analyze as analyzeReference } from './lib/reference.mjs';
import * as jobs from './lib/jobs.mjs';
import { probe } from './lib/plan.mjs';
import { enqueue, handoffDocument } from './lib/agent.mjs';
import { runJob, cancel, isBusy, activeIds } from './lib/runner.mjs';
import { json, text, readBody, sendFile, sse, pipeToFile, safeName } from './lib/http.mjs';
import { MARKER, corsHeaders, hasMarker, isMutating, isSelf, parseAllowed } from './lib/cors.mjs';

const UI = path.join(STUDIO_ROOT, 'ui');
const UPLOADS = path.join(CONFIG_DIR, 'uploads');
const MEDIA_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg', '.srt', '.vtt']);

const arg = (name, fb) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fb;
};
const PORT = Number(arg('port', readConfig().port || 8790));
/* Cross-origin bridge for the hosted panel. Empty by default: the engine only
 * answers another website when it was told to, with --allow-origin. */
const ALLOWED = parseAllowed(arg('allow-origin', readConfig().allowOrigin || ''));
if (ALLOWED) console.log(`cors: allowing ${ALLOWED.join('  ')}`);

/** The picker needs the real stage markup, at a canvas the browser can scale. */
function backgroundCards(ratioId) {
  const r = ratioById(ratioId);
  const g = geometry(r.w, r.h);
  return BACKGROUNDS.map((b) => {
    const stage = buildStage(b.id, g, { videoSrc: null, film: 8 });
    return {
      id: b.id,
      fa: b.fa,
      hint: b.hint,
      needs: b.needs || null,
      ground: b.ground,
      w: r.w,
      h: r.h,
      css: stage.css,
      html: stage.html,
    };
  });
}

function manifest() {
  const cfg = publicConfig();
  return {
    ratios: RATIOS.map((r) => ({ ...r, px: `${r.w}×${r.h}` })),
    backgrounds: backgroundCards(cfg.output.ratio),
    defaults: cfg,
    presets: PROVIDER_PRESETS.map(({ id, fa, base, note }) => ({ id, fa, base, note })),
    engines: [
      { id: 'agent', fa: 'خودم (عامل هوشمند)', note: 'پنل کار را در صف می‌گذارد؛ یک عامل هوشمند روی همین دستگاه HANDOFF.md را برمی‌دارد و می‌سازد.' },
      { id: 'studio', fa: 'استودیو — بدون مدل', note: 'همه‌چیز قطعی و محلی، بدون هیچ درخواست شبکه‌ای.' },
      { id: 'provider', fa: 'سرویس مدل', note: 'جهت ادیت را یک مدل (اوپن‌روتِری/۹روتر/پاستا) می‌چیند؛ رندر محلی می‌ماند.' },
    ],
    modes: [
      {
        id: 'motion',
        fa: 'موشن گرافیک',
        note: 'از محتوای گفتار کارت‌های متحرک می‌سازد: آیکون، باکس شیشه‌ای، شمارنده، موج صدا — با ترنزیشن روی ضرب.',
      },
      {
        id: 'captions',
        fa: 'فیلم زیرنویسی',
        note: 'مسیر قدیمی: متن گفتار را کارت‌به‌کارت روی پس‌زمینه می‌نوازد.',
      },
    ],
    delivers: [
      {
        id: 'overlay',
        fa: 'کلاژ روی ویدیوی خودت',
        note: 'لایهٔ شفاف (WebM + آلفا) هم‌اندازهٔ ویدیو؛ وسط کادر برای چهره آزاد می‌ماند.',
      },
      { id: 'standalone', fa: 'فیلم مستقل', note: 'خودش ویدیو می‌شود، با پس‌زمینه و صدای خودش.' },
    ],
    densities: Object.entries(DENSITY).map(([id, d]) => ({ id, fa: d.fa, perMinute: d.maxBeatsPerMinute })),
    materials: Object.entries(MATERIALS).map(([id, m]) => ({ id, fa: m.fa })),
    soundLevels: Object.entries(SOUND_LEVELS).map(([id, l]) => ({ id, fa: l.fa })),
    transitions: Object.entries(TRANSITIONS).map(([id, t]) => ({ id, fa: t.fa })),
    qualities: [
      { id: 'draft', fa: 'پیش‌نویس (سریع)' },
      { id: 'looks', fa: 'محلی (CRF 16)' },
      { id: 'delivery', fa: 'تحویلی (باکیفیت‌ترین)' },
    ],
    layouts: [
      { id: 'auto', fa: 'خودکار', note: 'اگر نسبت منبع با بوم یکی بود پوششی، وگرنه قاب‌دار' },
      { id: 'cover', fa: 'پوششی', note: 'ویدیو کل کادر را می‌گیرد' },
      { id: 'contain', fa: 'قاب‌دار', note: 'ویدیو کامل، پس‌زمینه اطرافش' },
      { id: 'split', fa: 'کلاژ (پنل + تصویر)', note: 'قانون ریلز: ثلث بالا گرافیک، پایین چهره' },
    ],
    transcribeModels: ['tiny', 'base', 'small', 'medium', 'large-v3'],
    version: 2,
  };
}

const reviewFiles = (p) => (fs.existsSync(path.join(p.root, 'review')) ? fs.readdirSync(path.join(p.root, 'review')) : []);

function jobSummary(j) {
  const p = jobs.paths(j.id);
  const motion = (j.config?.motion?.mode ?? 'motion') !== 'captions';
  return {
    id: j.id,
    name: j.config?.name || j.id,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt || j.createdAt,
    status: j.status,
    engine: j.engine,
    mode: motion ? 'motion' : 'captions',
    deliver: motion ? j.config?.motion?.deliver || 'overlay' : null,
    density: motion ? j.config?.motion?.density || 'auto' : null,
    sfx: motion ? j.config?.sound?.sfx !== false : false,
    ratio: j.config?.output?.ratio,
    background: j.config?.output?.background,
    sourceKind: j.config?.source?.video ? 'video' : j.config?.source?.audio ? 'audio' : 'srt',
    reference: j.config?.source?.reference || null,
    progress: j.progress,
    output: j.output,
    error: j.error,
    handoff: fs.existsSync(p.handoff),
    artifacts: [
      ['beats', path.join(p.root, 'beats.json')],
      ['style', path.join(p.root, 'style.json')],
      ['sound', path.join(p.root, 'sound.json')],
      ['dropIn', path.join(p.out, 'DROP-IN.md')],
      ['sfx', path.join(p.out, `${j.id}_sfx.wav`)],
    ]
      .filter(([, f]) => fs.existsSync(f))
      .map(([k]) => k),
    preview: reviewFiles(p).find((f) => f.endsWith('_collage-preview.mp4')) || null,
    stills: fs.existsSync(path.join(p.root, 'review/stills'))
      ? fs.readdirSync(path.join(p.root, 'review/stills')).filter((f) => /\.(png|jpg)$/.test(f))
      : [],
  };
}

/**
 * CORS, the preflight and the write marker, in one place. Returns false when
 * the request was answered here and routing should stop.
 */
function guardApi(req, res) {
  const origin = req.headers.origin;
  if (!origin || isSelf(origin, req.headers.host)) return true; // this engine's own panel, curl, another CLI
  const headers = corsHeaders(origin, ALLOWED);
  if (!headers) {
    json(res, 403, { error: `origin not allowed: ${origin} — start the engine with --allow-origin` });
    return false;
  }
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (code, hdrs, statusMessage) =>
    hdrs && !Array.isArray(hdrs) && typeof hdrs === 'object'
      ? writeHead(code, { ...hdrs, ...headers }, statusMessage)
      : writeHead(code, hdrs, statusMessage);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') {
    // Chrome asks this when a public page reaches into loopback; without the
    // answer the preflight fails and the panel sees a opaque network error.
    if (req.headers['access-control-request-private-network'] === 'true')
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.statusCode = 204;
    res.setHeader('Content-Length', '0');
    res.end();
    return false;
  }
  if (isMutating(req) && !hasMarker(req)) {
    json(res, 403, { error: `cross-origin writes need the ${MARKER}: 1 header` });
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const seg = (i) => parts[i];

  try {
    if (parts[0] === 'api' && !guardApi(req, res)) return;
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
      return sendFile(req, res, path.join(UI, 'index.html'));

    // UI statics: /app.css and /app.js sit beside index.html, fonts under /assets.
    if (req.method === 'GET' && parts[0] !== 'api')
      return sendFile(req, res, path.join(UI, ...parts), { root: UI });

    if (req.method === 'GET' && url.pathname === '/api/manifest') return json(res, 200, manifest());

    if (req.method === 'GET' && url.pathname === '/api/backgrounds')
      return json(res, 200, backgroundCards(url.searchParams.get('ratio') || '2:1'));

    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, publicConfig());

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await readBody(req);
      writeConfig(body || {});
      return json(res, 200, publicConfig());
    }

    if (req.method === 'GET' && url.pathname === '/api/preflight') {
      const pct = Number(url.searchParams.get('cpu') || 50);
      const power = powerBudget(pct);
      return json(res, 200, { power, ...preflight(power), busy: isBusy(), running: activeIds() });
    }

    if (req.method === 'GET' && url.pathname === '/api/probe') {
      const f = url.searchParams.get('path') || '';
      if (!fs.existsSync(f)) return json(res, 404, { error: 'فایل پیدا نشد' });
      return json(res, 200, { path: f, ...probe(f) });
    }

    if (req.method === 'GET' && url.pathname === '/api/providers/models') {
      const id = url.searchParams.get('provider') || 'openrouter';
      try {
        return json(res, 200, await listModels(id));
      } catch (err) {
        return json(res, 502, { error: String(err.message || err).slice(0, 400), provider: id });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/providers/test') {
      const id = url.searchParams.get('provider') || 'custom';
      const p = resolveProvider(id);
      const started = Date.now();
      try {
        const r = await listModels(id);
        return json(res, 200, { ok: true, provider: p.id, base: p.base, count: r.models.length, ms: Date.now() - started });
      } catch (err) {
        return json(res, 200, { ok: false, provider: p.id, base: p.base, error: String(err.message || err).slice(0, 300), ms: Date.now() - started });
      }
    }

    // What the motion engine can draw with, and what it sounds like.
    if (req.method === 'GET' && url.pathname === '/api/recipes')
      return json(
        res,
        200,
        {
          recipes: recipeList(),
          densities: manifest().densities,
          materials: manifest().materials,
          transitions: manifest().transitions,
        },
      );

    if (req.method === 'GET' && url.pathname === '/api/icons')
      return json(res, 200, { bundled: [...bundledNames()], meta: ICON_META });

    if (req.method === 'GET' && url.pathname === '/api/sfx')
      return json(res, 200, { levels: manifest().soundLevels, kit: kitCatalog() });

    // Teach the studio a look: the reference is analysed, never copied.
    if (req.method === 'POST' && url.pathname === '/api/reference/analyze') {
      const body = await readBody(req);
      const file = body?.path;
      if (!file || !fs.existsSync(file)) return json(res, 400, { error: 'فایل رفرنس پیدا نشد.' });
      const started = Date.now();
      const style = await analyzeReference(file, { out: body.out || null });
      return json(res, 200, { ...style, ms: Date.now() - started });
    }

    // Local file picker: the panel reads paths instead of uploading 4 GB.
    if (req.method === 'GET' && url.pathname === '/api/fs') {
      const dir = url.searchParams.get('dir') || os.homedir();
      const abs = path.resolve(dir);
      let entries = [];
      try {
        entries = fs
          .readdirSync(abs, { withFileTypes: true })
          .filter((d) => !d.name.startsWith('.'))
          .map((d) => {
            const full = path.join(abs, d.name);
            let size = 0;
            try {
              size = d.isFile() ? fs.statSync(full).size : 0;
            } catch {}
            return {
              name: d.name,
              path: full,
              kind: d.isDirectory() ? 'dir' : MEDIA_EXT.has(path.extname(d.name).toLowerCase()) ? 'media' : 'other',
              size,
            };
          });
      } catch (err) {
        return json(res, 400, { error: String(err.message || err).slice(0, 200) });
      }
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'fa') : a.kind === 'dir' ? -1 : 1));
      return json(res, 200, {
        dir: abs,
        parent: path.dirname(abs) !== abs ? path.dirname(abs) : null,
        quick: [os.homedir(), path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Movies'), JOBS_ROOT].filter((q) => fs.existsSync(q)),
        entries: entries.filter((e) => e.kind !== 'other'),
      });
    }

    // Drag and drop: raw bytes straight to disk, no multipart parser.
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const name = safeName(url.searchParams.get('name'), 'source.bin');
      const dest = path.join(UPLOADS, `${Date.now()}-${name}`);
      const { bytes } = await pipeToFile(req, dest);
      const info = /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name) || /\.(mp3|m4a|wav|aac|flac|ogg)$/i.test(name) ? probe(dest) : {};
      return json(res, 200, { path: dest, name, bytes, ...info });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs') return json(res, 200, jobs.list().map(jobSummary));

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const body = await readBody(req);
      if (!body?.source || !(body.source.video || body.source.audio || body.source.srt))
        return json(res, 400, { error: 'یک منبع لازم است: ویدیو، صدا یا زیرنویس.' });
      for (const key of ['video', 'audio', 'srt', 'reference'])
        if (body.source[key] && !fs.existsSync(body.source[key]))
          return json(res, 400, { error: `${key === 'reference' ? 'ویدیوی رفرنس' : 'منبع'} پیدا نشد: ${body.source[key]}` });
      const job = jobs.create(body);
      return json(res, 201, jobSummary(job));
    }

    const id = seg(0) === 'api' && seg(1) === 'jobs' ? seg(2) : null;
    if (id) {
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: 'شغلی با این شناسه نیست' });
      const p = jobs.paths(id);
      const action = seg(3);

      if (req.method === 'GET' && !action)
        return json(res, 200, {
          ...jobSummary(job),
          config: job.config,
          handoffPath: p.handoff,
          handoff: fs.existsSync(p.handoff) ? handoffDocument(job) : null,
        });

      if (req.method === 'POST' && action === 'start') {
        if (['running', 'succeeded'].includes(job.status)) return json(res, 409, { error: `شغل ${job.status} است` });
        const mode = job.config?.engine?.mode || 'agent';
        if (mode === 'agent') {
          const q = enqueue(job);
          return json(res, 202, { ...jobSummary(q), queued: true, handoff: p.handoff, wake: 'به عاملی که این پوشه را باز کرده بگو: «صف استودیو را بگیر» — یا خودت: node cli.mjs next' });
        }
        jobs.appendLog(id, 'queue', `شروع موتور ${mode}${isBusy() ? ' — بعد از کار جاری' : ''}`);
        runJob(id).catch((err) => {
          if (!err?.cancelled) console.error(`job ${id}:`, err.message);
        });
        return json(res, 202, jobSummary(jobs.get(id)));
      }

      if (req.method === 'POST' && action === 'cancel') {
        const killed = cancel(id);
        if (!killed) jobs.setStatus(id, 'cancelled', { error: 'لغو شد' });
        return json(res, 200, jobSummary(jobs.get(id)));
      }

      if (req.method === 'POST' && action === 'clone') {
        const copy = jobs.create(job.config);
        return json(res, 201, jobSummary(copy));
      }

      if (req.method === 'DELETE' && !action) {
        if (job.status === 'running') return json(res, 409, { error: 'در حال اجراست' });
        fs.rmSync(p.root, { recursive: true, force: true });
        return json(res, 200, { removed: id });
      }

      if (action === 'events') {
        const out = sse(res);
        let byte = 0;
        const tick = setInterval(() => {
          const j = jobs.get(id);
          const prog = j?.progress;
          if (prog) out.send('progress', prog);
          const { text: chunk, next } = jobs.readLog(id, { fromByte: byte });
          if (chunk) {
            byte = next;
            out.send('log', { chunk });
          }
          if (j && ['succeeded', 'failed', 'cancelled'].includes(j.status)) {
            out.send('state', { status: j.status, output: j.output, error: j.error });
            clearInterval(tick);
            setTimeout(() => res.end(), 300);
          }
        }, 700);
        req.on('close', () => clearInterval(tick));
        return;
      }

      if (req.method === 'GET' && action === 'media') return sendFile(req, res, job.output?.file || path.join(p.out, `${id}.mp4`));
      if (req.method === 'GET' && action === 'download') {
        const f = job.output?.file || path.join(p.out, `${id}.mp4`);
        return sendFile(req, res, f, { download: `${id}${path.extname(f) || '.mp4'}` });
      }
      if (req.method === 'GET' && ['beats', 'style', 'sound'].includes(action)) {
        const f = path.join(p.root, `${action}.json`);
        if (!fs.existsSync(f)) return json(res, 404, { error: 'هنوز این فایل ساخته نشده است' });
        return json(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
      }
      if (req.method === 'GET' && action === 'dropin') {
        const f = path.join(p.out, 'DROP-IN.md');
        if (!fs.existsSync(f)) return json(res, 404, { error: 'راهنما هنوز نوشته نشده' });
        return text(res, 200, fs.readFileSync(f, 'utf8'), 'text/markdown; charset=utf-8');
      }
      if (req.method === 'GET' && action === 'preview') {
        const dir = path.join(p.root, 'review');
        const name =
          url.searchParams.get('name') || reviewFiles(p).find((f) => f.endsWith('_collage-preview.mp4'));
        return sendFile(req, res, path.join(dir, safeName(name || '')), { root: dir });
      }
      if (req.method === 'GET' && action === 'sfx') return sendFile(req, res, path.join(p.out, `${id}_sfx.wav`));
      if (req.method === 'GET' && action === 'stills') {
        const dir = path.join(p.root, 'review/stills');
        return json(res, 200, fs.existsSync(dir) ? fs.readdirSync(dir) : []);
      }
      if (req.method === 'GET' && action === 'still') {
        const name = safeName(url.searchParams.get('name'));
        return sendFile(req, res, path.join(p.root, 'review/stills', name), { root: path.join(p.root, 'review/stills') });
      }
      if (req.method === 'GET' && action === 'log') return sendFile(req, res, p.log, { download: `${id}.log.txt` });
    }

    return text(res, 404, 'یافت نشد');
  } catch (err) {
    console.error(url.pathname, err);
    if (!res.headersSent) json(res, 500, { error: String(err.message || err).slice(0, 500) });
    else res.end();
  }
});

fs.mkdirSync(JOBS_ROOT, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Video Studio → http://127.0.0.1:${PORT}`);
  console.log(`jobs: ${JOBS_ROOT}`);
  console.log(`config: ${CONFIG_FILE}`);
});
