import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { npxHyperframes, FIT_SIZE } from './paths.mjs';
import { powerBudget, videoBitrateKbps, withPower } from './cool.mjs';
import { buildPlan } from './plan.mjs';
import { writeProject, runSrt } from './compose.mjs';
import { buildBeats, validate as validateSheet, stillTimes as beatStillTimes } from './beats.mjs';
import { writeMotionProject } from './motion-project.mjs';
import { analyze as analyzeReference } from './reference.mjs';
import * as sfx from './sfx.mjs';
import { collagePreview, inspectLayer, dropInNote } from './composite.mjs';
import { vp9AlphaReEncode } from './alpha.mjs';
import { loudness } from './ffmpeg.mjs';
import { askDirection, describePlan, resolveProvider } from './providers.mjs';
import * as jobs from './jobs.mjs';

const running = new Map(); // id -> { kill() }
let queue = Promise.resolve(); // one heavy job at a time (cool-render rule)

export function isBusy() {
  return running.size > 0;
}
export function activeIds() {
  return [...running.keys()];
}

export function cancel(id) {
  const h = running.get(id);
  if (!h) return false;
  h.kill();
  return true;
}

const LAYOUT_FA = { none: 'بدون تصویر', cover: 'پُرکردن', contain: 'جای‌گرفتن', split: 'تقسیم' };

/** Flatten a `check --json` report into log-ready lines. */
function checkFindings(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let j;
  try {
    j = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const out = [];
  for (const s of Object.values(j)) {
    if (!s || !Array.isArray(s.findings)) continue;
    for (const f of s.findings) {
      const where = f.sourceFile ? ` (${path.basename(f.sourceFile)})` : '';
      out.push({ severity: f.severity || 'info', message: `${f.message}${where}${f.fixHint ? ` — ${f.fixHint}` : ''}` });
    }
  }
  return out;
}

/**
 * Spawn under the machine's power budget, stream every line into the job log
 * and translate the child's own counters into the progress bar.
 */
function exec(id, cmd, args, { cwd, env, power, onLine, stage, subFrom = 0, subSpan = 1 } = {}) {
  const wrapped = withPower(cmd, args, power);
  return new Promise((resolve, reject) => {
    jobs.appendLog(id, 'run', `${wrapped.cmd} ${wrapped.args.join(' ')}`);
    // A missing cwd surfaces from spawn as ENOENT on the *command*, which reads
    // like a missing binary — so say which one is actually absent.
    if (cwd && !fs.existsSync(cwd)) {
      reject(new Error(`مسیر کاری وجود ندارد: ${cwd}`));
      return;
    }
    const child = spawn(wrapped.cmd, wrapped.args, {
      cwd,
      env: { ...process.env, ...env, ...(wrapped.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let lastPct = -1;
    let settled = false;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const sub = Math.min(0.95, subFrom + subSpan * (1 - Math.exp(-(Date.now() - startedAt) / 240000)));
      if (Math.round(sub * 100) !== lastPct) {
        lastPct = Math.round(sub * 100);
        jobs.setProgress(id, stage, { sub });
      }
    }, 4000);

    const handle = (buf) => {
      const text = buf.toString('utf8');
      for (const raw of text.split(/[\r\n]+/)) {
        const line = raw.trim();
        if (!line) continue;

        // HyperFrames emits a machine-readable progress record per frame batch.
        if (line.startsWith('@hf-progress')) {
          try {
            const p = JSON.parse(line.slice('@hf-progress'.length).trim());
            const sub = subFrom + subSpan * Math.max(0, Math.min(1, Number(p.pct ?? p.done / Math.max(1, p.total)) / 100));
            if (Math.round(sub * 100) !== lastPct) {
              lastPct = Math.round(sub * 100);
              jobs.setProgress(id, stage, { sub });
            }
          } catch {
            /* ignore a torn line */
          }
          continue;
        }
        if (/Streaming frame|░|█/.test(line)) continue; // the same signal, as a bar

        onLine?.(line);
        const m =
          line.match(/(\d+(?:\.\d+)?)\s*%/) ||
          line.match(/(?:frame|frames?|f)\D*(\d+)\D+(\d+)/i) ||
          line.match(/(\d+)\s*\/\s*(\d+)/);
        let sub = null;
        if (m) {
          if (m[2]) sub = Math.min(1, Number(m[1]) / Math.max(1, Number(m[2])));
          else sub = Math.min(1, Number(m[1]) / 100);
          sub = subFrom + subSpan * Math.max(0, sub);
          clearInterval(timer);
        }
        if (sub !== null && Math.round(sub * 100) !== lastPct) {
          lastPct = Math.round(sub * 100);
          jobs.setProgress(id, stage, { sub });
        }
        // Render chatter is useful but voluminous: only noteworthy lines go to the log.
        if (/\b(error|fail|warn|wrote|saved|done|✓|✗|render(ed)?\b)/i.test(line)) {
          jobs.appendLog(id, 'out', line.slice(0, 300));
        }
      }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) => {
      clearInterval(timer);
      if (settled) return;
      settled = true;
      running.delete(id);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearInterval(timer);
      if (settled) return;
      settled = true;
      running.delete(id);
      if (signal === 'SIGKILL' || signal === 'SIGTERM') {
        const e = new Error('رندر لغو شد.');
        e.cancelled = true;
        return reject(e);
      }
      if (code !== 0) return reject(new Error(`خروج با کد ${code}: ${path.basename(cmd)}`));
      resolve();
    });
    running.set(id, {
      kill() {
        try {
          child.kill('SIGKILL');
        } catch {}
      },
    });
  });
}

const readTranscript = (srtPath, max = 3500) => {
  if (!srtPath || !fs.existsSync(srtPath)) return '';
  return fs
    .readFileSync(srtPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->'))
    .join(' ')
    .slice(0, max);
};

function stillTimes(film) {
  const t = [0.5, 1.2];
  for (let i = 1; i <= 4; i++) t.push(Math.round(((film - 3.4) * (i / 5) + 0.4) * 10) / 10);
  t.push(Math.max(0.1, film - 1.2));
  return [...new Set(t.filter((x) => x > 0 && x < film))].slice(0, 8).join(',');
}

/** The whole pipeline for one job, in the order the panel's stages expect. */
export async function runJob(id) {
  const run = () => runInner(id);
  queue = queue.then(run, run);
  return queue;
}

async function runInner(id) {
  const job = jobs.get(id);
  if (!job) throw new Error(`شغل ${id} پیدا نشد`);
  const p = jobs.paths(id);
  const power = powerBudget(job.config.cpu?.pct ?? 50);
  const npx = (...args) => npxHyperframes(args);

  try {
    jobs.setStatus(id, 'running', { startedAt: new Date().toISOString() });
    jobs.appendLog(id, 'stage', `توان دستگاه: ${power.pct}% → ${power.threads} رشته، ${power.workers} ورکر`);

    jobs.setProgress(id, 'prepare', { sub: 0.3 });
    const plan = buildPlan(job);
    jobs.setProgress(id, 'prepare', { sub: 1 });
    jobs.appendLog(
      id,
      'info',
      `منبع ${plan.source.kind} — ${Math.round(plan.source.duration || 0)} ثانیه، ${plan.source.width || '—'}×${plan.source.height || '—'}، پیکسل‌بوم ${plan.g.w}×${plan.g.h}`,
    );

    // 2. transcript — only when captions are wanted and no SRT was supplied.
    let srtFile = plan.source.srt;
    if (plan.captions.enabled && !srtFile && (plan.source.audio || plan.source.video)) {
      jobs.setProgress(id, 'transcribe', { sub: 0.1 });
      jobs.appendLog(id, 'stage', 'پیاده‌سازی گفتار با whisper (مدل چندزبانه)');
      const srtOut = path.join(p.input, 'script.fa.srt');
      const t = npx(
        'transcribe',
        plan.source.audio || plan.source.video,
        '--dir',
        p.project,
        '--engine',
        'whisper',
        // HyperFrames only offers these whisper models; `small` is the smallest
        // multilingual one, so a Persian track still transcribes.
        '--model',
        job.config.transcribe?.model || 'small',
        '--language',
        job.config.transcribe?.language || 'fa',
        '--to',
        'srt',
        '--output',
        srtOut,
      );
      await exec(id, t.cmd, t.args, {
        // The project dir is still a scaffold away, so the job root is the only
        // safe cwd here; the workspace is passed to HyperFrames as --dir.
        cwd: p.root,
        power,
        stage: 'transcribe',
        subFrom: 0.1,
        subSpan: 0.9,
      });
      srtFile = srtOut;
      if (!fs.existsSync(srtFile)) throw new Error('پیاده‌سازی گفتار فایلی نساخت؛ مدل یا زبان را در تنظیمات عوض کن.');
      const n = (fs.readFileSync(srtFile, 'utf8').match(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/g) || []).length;
      jobs.appendLog(id, 'info', `${n} کارت زمانی از گفتار بیرون آمد`);
      plan.source.srt = srtFile;
    } else {
      jobs.setProgress(id, 'transcribe', { sub: 1, label: 'زیرنویس از قبل موجود است' });
    }

    // The motion engine takes the job from here: a beat sheet, not a caption film.
    if (plan.motion?.mode === 'motion') return await runMotion(id, job, p, plan, power, npx, srtFile);

    // 3. direction — a model decides presentation, never facts.
    if (job.config.engine?.mode === 'provider') {
      jobs.setProgress(id, 'direction', { sub: 0.4 });
      const prov = resolveProvider(job.config.engine.provider);
      jobs.appendLog(id, 'stage', `جهت‌دهی با ${prov.fa} / ${job.config.engine.model || prov.model || '—'}`);
      try {
        const { plan: dp, raw } = await askDirection({
          provider: job.config.engine.provider,
          model: job.config.engine.model,
          brief: plan.direction,
          transcript: readTranscript(srtFile),
          canvas: { id: plan.ratio, ...plan.g },
          background: plan.background,
        });
        jobs.patch(id, { config: { ...job.config, direction: { ...job.config.direction, plan: dp, raw } } });
        jobs.appendLog(id, 'info', `مدل گفت: ${describePlan(dp)}`);
        Object.assign(plan, applyDirectionToPlan(buildPlan(jobs.get(id)), plan));
      } catch (err) {
        jobs.appendLog(id, 'warn', `جهت‌دهی مدل ناموفق بود؛ با پیش‌فرض برند ادامه می‌دهیم: ${err.message}`);
      }
    } else if (job.config.engine?.mode === 'agent') {
      jobs.setProgress(id, 'direction', { sub: 1, label: 'جهت‌دهی: خودم (عامل هوشمند)' });
    } else {
      jobs.setProgress(id, 'direction', { sub: 1, label: 'جهت‌دهی: قوانین خانه' });
    }

    // 4. scaffold
    jobs.setProgress(id, 'scaffold', { sub: 0.2 });
    const built = writeProject({ jobDir: p.root, plan });
    for (const w of built.warnings) jobs.appendLog(id, 'info', w);
    jobs.setProgress(id, 'scaffold', { sub: 1 });
    jobs.appendLog(id, 'info', `فیلم ${built.film} ثانیه، چیدمان ${LAYOUT_FA[built.layout.layout] || built.layout.layout}`);

    // 5. check
    jobs.setProgress(id, 'check', { sub: 0.5 });
    const c = npx('check', '--json');
    let checkOut = '';
    try {
      await exec(id, c.cmd, c.args, {
        cwd: built.projectDir,
        power,
        stage: 'check',
        subFrom: 0.5,
        subSpan: 0.5,
        onLine: (line) => (checkOut += line + '\n'),
      });
      for (const f of checkFindings(checkOut).filter((x) => x.severity !== 'error'))
        jobs.appendLog(id, 'warn', f.message);
    } catch (err) {
      const errors = checkFindings(checkOut).filter((x) => x.severity === 'error');
      for (const f of errors) jobs.appendLog(id, 'error', f.message);
      throw new Error(
        errors.length
          ? `اعتبارسنجی ترکیب رد شد (${errors.length} خطا): ${errors[0].message}`
          : `اعتبارسنجی ترکیب رد شد: ${err.message}`,
      );
    }
    jobs.setProgress(id, 'check', { sub: 1 });

    // 6. stills for review
    jobs.setProgress(id, 'stills', { sub: 0.2 });
    const s = npx('snapshot', '--at', stillTimes(built.film), '--out', path.join(p.root, 'review/stills'));
    await exec(id, s.cmd, s.args, { cwd: built.projectDir, power, stage: 'stills', subFrom: 0.2, subSpan: 0.8 });
    jobs.setProgress(id, 'stills', { sub: 1 });

    // 7. render
    const budget = videoBitrateKbps(built.film, job.config.output.maxMb || 200);
    const out = path.join(p.out, `${id}.mp4`);
    jobs.setProgress(id, 'render', { sub: 0 });
    jobs.appendLog(id, 'stage', `رندر ${job.config.output.quality || 'delivery'} با سقف ${budget} kbit/s`);
    const r = npx(
      'render',
      '.',
      '-o',
      out,
      '--format',
      job.config.output.format || 'mp4',
      '--fps',
      String(job.config.output.fps || 30),
      '--quality',
      job.config.output.quality || 'delivery',
      '--workers',
      String(power.workers),
      '--video-bitrate',
      `${budget}k`,
      '--max-bitrate',
      `${Math.min(14000, budget + 2000)}k`,
    );
    await exec(id, r.cmd, r.args, { cwd: built.projectDir, power, stage: 'render', subFrom: 0, subSpan: 1 });
    if (!fs.existsSync(out)) throw new Error('رندر تمام شد فایلی نیست.');
    jobs.setProgress(id, 'render', { sub: 1 });

    // 8. stay inside the file-size budget
    jobs.setProgress(id, 'fit', { sub: 0.4 });
    if (FIT_SIZE) {
      try {
        await exec(id, FIT_SIZE, [out, String(job.config.output.maxMb || 200)], {
          cwd: p.out,
          power,
          stage: 'fit',
          subFrom: 0.4,
          subSpan: 0.6,
        });
      } catch (err) {
        jobs.appendLog(id, 'warn', ` guard حجم: ${err.message}`);
      }
    } else {
      jobs.appendLog(id, 'warn', 'اسکیل cool-render نیست؛ حجم را خودم کنترل نمی‌کنم.');
    }
    jobs.setProgress(id, 'fit', { sub: 1 });

    // 9. verify
    jobs.setProgress(id, 'verify', { sub: 0.5 });
    const { probe } = await import('./plan.mjs');
    const info = probe(out);
    const bytes = fs.statSync(out).size;
    const output = {
      file: out,
      rel: path.relative(path.join(p.root, '..'), out),
      bytes,
      mb: Math.round((bytes / 1000000) * 100) / 100,
      width: info.width,
      height: info.height,
      fps: info.fps,
      duration: Math.round(info.duration * 100) / 100,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
      withinBudget: bytes <= (job.config.output.maxMb || 200) * 1000000,
      is30fps: info.fps === 30,
    };
    jobs.setStatus(id, 'succeeded', { output, finishedAt: new Date().toISOString() });
    jobs.setProgress(id, 'verify', { sub: 1 });
    jobs.appendLog(
      id,
      'done',
      `آماده: ${output.mb} مگابایت، ${output.width}×${output.height}، ${output.fps} فریم — ${output.withinBudget ? 'زیر سقف' : 'بیش از سقف!'}`,
    );
    return output;
  } catch (err) {
    const status = err.cancelled ? 'cancelled' : 'failed';
    jobs.setStatus(id, status, { error: String(err.message || err).slice(0, 2000), finishedAt: new Date().toISOString() });
    jobs.appendLog(id, 'error', String(err.message || err).slice(0, 500));
    throw err;
  }
}

/** Fields a model may override stay presentation-only. */
function applyDirectionToPlan(fresh, before) {
  for (const k of ['layout', 'title', 'endcard', 'captions', 'beats', 'providerNotes']) {
    if (fresh[k]) before[k] = fresh[k];
  }
  return before;
}

const DELIVER_FA = { overlay: 'کلاژ روی ویدیوی خودت', standalone: 'فیلم مستقل' };
const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * The motion engine, end to end: reference → beat sheet → sound design →
 * transparent layer → the collage proof.
 *
 * The SRT stays the clock. Nothing here writes a caption track: the talk tells
 * the engine *when* to change the picture, and the words on screen are the
 * salient ones the beat engine pulled out of it.
 */
async function runMotion(id, job, p, plan, power, npx, srtFile) {
  const projDir = p.project;

  // 3a. reference — the look is learned from a file, not guessed.
  let style = null;
  if (plan.reference) {
    jobs.setProgress(id, 'reference', { sub: 0.05 });
    jobs.appendLog(id, 'stage', `سبک از ویدیوی رفرنس: ${path.basename(plan.reference)}`);
    let done = 0;
    try {
      style = await analyzeReference(plan.reference, {
        out: path.join(p.root, 'style.json'),
        onStage: (name) => {
          done++;
          jobs.setProgress(id, 'reference', { sub: Math.min(0.95, done / 5) });
          jobs.appendLog(id, 'info', `تحلیل رفرنس: ${name}`);
        },
      });
      const d = style.derived || {};
      jobs.appendLog(
        id,
        'info',
        `ریتم ${d.beatLen ?? '—'} ثانیه، انرژی ${d.energy ?? '—'}، چگالی ${d.density ?? '—'}${d.look ? `، ${d.look}` : ''}`,
      );
    } catch (err) {
      jobs.appendLog(id, 'warn', `تحلیل رفرنس نشد؛ سلیقهٔ خانه جای آن را می‌گیرد: ${err.message}`);
    }
  } else {
    jobs.setProgress(id, 'reference', { sub: 1, label: 'بدون رفرنس — سلیقهٔ خانه' });
  }
  jobs.setProgress(id, 'direction', {
    sub: 1,
    label: job.config.engine?.mode === 'agent' ? 'کارگردانی: عامل هوشمند روی ورقهٔ بیت' : 'کارگردانی: موتور بیت',
  });

  // 4. beats — the SRT is parsed the same way the caption engine parses it.
  jobs.setProgress(id, 'beats', { sub: 0.15 });
  const tlFile = path.join(p.root, 'timeline.json');
  runSrt(['parse', srtFile, '--out', tlFile], p.root);
  runSrt(['plan', tlFile, '--out', tlFile], p.root);
  const timeline = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
  const sheet = buildBeats(timeline, style, {
    deliver: plan.motion.deliver,
    density: plan.motion.density,
    material: plan.motion.material,
    ratio: plan.ratio,
    maxBeats: plan.motion.maxBeats || undefined,
  });
  fs.writeFileSync(path.join(p.root, 'beats.json'), JSON.stringify(sheet, null, 2) + '\n');
  jobs.setProgress(id, 'beats', { sub: 0.8 });
  for (const problem of validateSheet(sheet)) jobs.appendLog(id, 'warn', problem);
  const film = round3(Math.max(...sheet.beats.map((b) => b.end)));
  for (const line of sheet.report.lines) jobs.appendLog(id, 'info', line);
  jobs.appendLog(id, 'info', `فیلم ${film} ثانیه — ${DELIVER_FA[plan.motion.deliver]}`);
  jobs.setProgress(id, 'beats', { sub: 1 });

  // 5. sound design — planned against the beats, then measured against the mix.
  const voiceFile = plan.source.audio || (plan.source.hasAudio ? plan.source.video : null);
  let cues = [];
  let audit = null;
  let sfxFile = null;
  if (plan.sound.sfx) {
    jobs.setProgress(id, 'sfx', { sub: 0.1 });
    let voiceLufs = null;
    if (voiceFile) {
      try {
        voiceLufs = (await loudness(voiceFile)).lufs;
      } catch {
        /* targets fall back to the absolute table */
      }
    }
    cues = await sfx.planCues(sheet.beats, { level: plan.sound.level, voiceLufs });
    sfxFile = path.join(p.out, `${id}_sfx.wav`);
    jobs.appendLog(
      id,
      'stage',
      `${cues.length} صدای افکت در ${film} ثانیه — سطح ${sfx.SOUND_LEVELS[plan.sound.level]?.fa || plan.sound.level}`,
    );
    jobs.setProgress(id, 'sfx', { sub: 0.4 });
    const mixed = await sfx.mixAndVerify({
      cues,
      sfxOut: sfxFile,
      duration: film,
      level: plan.sound.level,
      onPass: (pass, a, buried) => jobs.appendLog(id, 'info', `پاس ${pass}: ${a.length} صدا، ${buried.length} پنهان`),
    });
    cues = mixed.cues;
    audit = mixed.audit;
    const buried = audit.filter((c) => !c.audible);
    jobs.appendLog(
      id,
      buried.length ? 'warn' : 'info',
      buried.length
        ? `${buried.length} صدا هنوز زیر گفتار است: ${[...new Set(buried.map((c) => c.role))].join('، ')}`
        : 'همهٔ صداها بالای گفتار شنیده می‌شوند',
    );
    fs.writeFileSync(
      path.join(p.root, 'sound.json'),
      JSON.stringify({ level: plan.sound.level, voiceLufs, cues, audit }, null, 2) + '\n',
    );
    jobs.setProgress(id, 'sfx', { sub: 1 });
  } else {
    jobs.setProgress(id, 'sfx', { sub: 1, label: 'بدون صدای افکت' });
  }

  // 6. the layer itself
  jobs.setProgress(id, 'scaffold', { sub: 0.2 });
  fs.rmSync(projDir, { recursive: true, force: true });
  const audioClips = [];
  if (sfxFile && plan.motion.deliver === 'standalone') {
    // a standalone film carries its design inside the render; a layer never does
    fs.mkdirSync(path.join(projDir, 'media'), { recursive: true });
    fs.copyFileSync(sfxFile, path.join(projDir, 'media/sfx.wav'));
    audioClips.push({ id: 'sfx', src: 'media/sfx.wav', start: 0, duration: film, volume: 1, track: 40 });
  }
  const built = writeMotionProject({
    dir: projDir,
    sheet,
    canvas: { width: plan.g.w, height: plan.g.h, fps: plan.fps, ratio: plan.ratio },
    deliver: plan.motion.deliver,
    background: plan.background,
    fetchIcons: false,
    audio: audioClips,
  });
  for (const name of built.icons?.unresolved || []) jobs.appendLog(id, 'warn', `آیکون در کیت نیست: ${name}`);
  for (const swap of built.icons?.dropped || []) jobs.appendLog(id, 'info', `آیکون جانشین شد: ${swap}`);
  jobs.appendLog(id, 'info', `${built.beats} بیت، ${built.cues} صدای درخواستی، بوم ${built.canvas.width}×${built.canvas.height}`);
  jobs.setProgress(id, 'scaffold', { sub: 1 });

  // 7. check
  jobs.setProgress(id, 'check', { sub: 0.5 });
  const c = npx('check', '--json');
  let checkOut = '';
  try {
    await exec(id, c.cmd, c.args, {
      cwd: projDir,
      power,
      stage: 'check',
      subFrom: 0.5,
      subSpan: 0.5,
      onLine: (line) => (checkOut += line + '\n'),
    });
    for (const f of checkFindings(checkOut).filter((x) => x.severity !== 'error')) jobs.appendLog(id, 'warn', f.message);
  } catch (err) {
    const errors = checkFindings(checkOut).filter((x) => x.severity === 'error');
    for (const f of errors) jobs.appendLog(id, 'error', f.message);
    throw new Error(
      errors.length
        ? `اعتبارسنجی لایه رد شد (${errors.length} خطا): ${errors[0].message}`
        : `اعتبارسنجی لایه رد شد: ${err.message}`,
    );
  }
  jobs.setProgress(id, 'check', { sub: 1 });

  // 8. stills for review
  jobs.setProgress(id, 'stills', { sub: 0.2 });
  const s = npx('snapshot', '--at', beatStillTimes(sheet), '--out', path.join(p.root, 'review/stills'));
  await exec(id, s.cmd, s.args, { cwd: projDir, power, stage: 'stills', subFrom: 0.2, subSpan: 0.8 });
  jobs.setProgress(id, 'stills', { sub: 1 });

  // 9. render
  const isOverlay = plan.motion.deliver === 'overlay';
  const ext = isOverlay ? 'webm' : 'mp4';
  const layerOut = path.join(p.out, `${id}.${ext}`);
  const quality = job.config.output.quality || 'delivery';
  const budget = videoBitrateKbps(built.film, job.config.output.maxMb || 200);
  jobs.setProgress(id, 'render', { sub: 0 });
  // A layer renders without any bitrate cap: `--max-bitrate` is MP4-only and
  // aborts the WebM mux (exit 2). The alpha plane survives the render — the
  // `ALPHA_MODE=1` container tag is the proof — and what *looks* like a lost
  // alpha is the reading side: ffmpeg's native vp9 decoder drops the alpha
  // plane, so every composite forces `-c:v libvpx-vp9` (see composite.mjs).
  const rargs = ['render', '.', '-o', layerOut, '--format', ext, '--fps', String(plan.fps), '--quality', quality, '--workers', String(power.workers)];
  if (isOverlay) jobs.appendLog(id, 'stage', 'رندر لایهٔ شفاف WebM با آلفا');
  else {
    jobs.appendLog(id, 'stage', `رندر فیلم مستقل با سقف ${budget} kbit/s`);
    rargs.push('--video-bitrate', `${budget}k`, '--max-bitrate', `${Math.min(14000, budget + 2000)}k`);
  }
  const r = npx(...rargs);
  await exec(id, r.cmd, r.args, { cwd: projDir, power, stage: 'render', subFrom: 0, subSpan: 1 });
  if (!fs.existsSync(layerOut)) throw new Error('رندر تمام شد فایلی نیست.');
  jobs.setProgress(id, 'render', { sub: 1 });

  // 10. the collage proof: the layer seen on the user's own footage
  let preview = null;
  const base = isOverlay && plan.source.video ? plan.source.video : null;
  if (base) {
    jobs.setProgress(id, 'composite', { sub: 0.3 });
    preview = path.join(p.root, 'review', `${id}_collage-preview.mp4`);
    try {
      await collagePreview({
        base,
        layer: layerOut,
        out: preview,
        width: plan.g.w,
        height: plan.g.h,
        fps: plan.fps,
        bed: sfxFile,
      });
      jobs.appendLog(id, 'info', `پیش‌نمایش کلاژ: ${path.relative(p.root, preview)}`);
    } catch (err) {
      jobs.appendLog(id, 'warn', `پیش‌نمایش کلاژ ساخته نشد: ${err.message}`);
      preview = null;
    }
  } else {
    jobs.setProgress(id, 'composite', { sub: 0.6, label: 'ویدیوی اصلی برای کلاژ ثبت نشده' });
  }
  dropInNote({
    dir: p.out,
    layer: path.relative(p.root, layerOut),
    base: base ? path.relative(p.root, base) : '(ویدیوی خودت)',
    ratio: plan.ratio,
    bed: sfxFile ? path.relative(p.root, sfxFile) : null,
    beats: sheet.beats.length,
    fps: plan.fps,
  });
  jobs.setProgress(id, 'composite', { sub: 1 });

  // 11. stay inside the file-size budget
  jobs.setProgress(id, 'fit', { sub: 0.4 });
  const maxMb = job.config.output.maxMb || 200;
  if (isOverlay) {
    // `fit-size`'s only encoder is libx264/yuv420p: it would flatten the very
    // plane this deliverable is made of. A layer is slimmed by re-encoding the
    // VP9 at a higher CRF instead.
    let mb = fs.statSync(layerOut).size / 1000000;
    let crf = 28;
    for (let pass = 0; mb > maxMb && pass < 3; pass++) {
      jobs.appendLog(id, 'info', `لایه ${round3(mb)} مگ است؛ با crf ${crf} دوباره کد می‌شود (آلفا می‌ماند)`);
      const tmp = `${layerOut}.slim.webm`;
      const re = vp9AlphaReEncode({
        file: layerOut,
        out: tmp,
        fps: plan.fps,
        crf,
        threads: Math.max(1, Math.min(4, power.threads)),
      });
      await exec(id, re.cmd, re.args, { cwd: p.out, power, stage: 'fit', subFrom: 0.4, subSpan: 0.5 });
      fs.renameSync(tmp, layerOut);
      mb = fs.statSync(layerOut).size / 1000000;
      crf += 5;
    }
    if (mb > maxMb) jobs.appendLog(id, 'warn', `لایه همچنان ${round3(mb)} مگ است — سقف حجم با کیفیتِ آلفا جا نشد`);
  } else if (FIT_SIZE) {
    try {
      await exec(id, FIT_SIZE, [layerOut, String(maxMb)], {
        cwd: p.out,
        power,
        stage: 'fit',
        subFrom: 0.4,
        subSpan: 0.6,
      });
    } catch (err) {
      jobs.appendLog(id, 'warn', `پایبندی به حجم نشد: ${err.message}`);
    }
  } else {
    jobs.appendLog(id, 'warn', 'اسکیل cool-render نیست؛ حجم را خودم کنترل نمی‌کنم.');
  }
  jobs.setProgress(id, 'fit', { sub: 1 });

  // 12. verify — for a layer, the pixel format is the deliverable
  jobs.setProgress(id, 'verify', { sub: 0.5 });
  const info = await inspectLayer(layerOut);
  const bytes = fs.statSync(layerOut).size;
  if (isOverlay && !info.hasAlpha)
    throw new Error('لایه آلفا ندارد؛ روی ویدیوی تو رنگی می‌افتد. رندر باید WebM با برچسب `ALPHA_MODE=1` باشد.');
  if (isOverlay && info.fps !== plan.fps)
    throw new Error(`نرخ فریم لایه ${info.fps} است، نه ${plan.fps}؛ کلاژ با ویدیوی تو ناهم‌زمان می‌شود.`);
  const output = {
    engine: 'motion',
    deliver: plan.motion.deliver,
    file: layerOut,
    rel: path.relative(path.join(p.root, '..'), layerOut),
    bytes,
    mb: Math.round((bytes / 1000000) * 100) / 100,
    width: info.width,
    height: info.height,
    fps: info.fps,
    duration: Math.round(info.duration * 100) / 100,
    videoCodec: info.codec,
    pixFmt: info.pixFmt,
    hasAlpha: info.hasAlpha,
    audioCodec: null,
    withinBudget: bytes <= maxMb * 1000000,
    is30fps: info.fps === 30,
    beats: sheet.beats.length,
    density: sheet.config.density,
    styleFrom: style?.source ? path.basename(style.source) : null,
    sound: plan.sound.sfx
      ? {
          level: plan.sound.level,
          cues: cues.length,
          buried: audit ? audit.filter((c) => !c.audible).length : null,
          file: sfxFile,
        }
      : null,
    preview,
    dropIn: path.join(p.out, 'DROP-IN.md'),
    handoff: { beats: path.join(p.root, 'beats.json'), style: style ? path.join(p.root, 'style.json') : null },
  };
  jobs.setStatus(id, 'succeeded', { output, finishedAt: new Date().toISOString() });
  jobs.setProgress(id, 'verify', { sub: 1 });
  jobs.appendLog(
    id,
    'done',
    `آماده: ${output.mb} مگابایت، ${output.width}×${output.height}، ${output.fps} فریم، ${output.hasAlpha ? 'با آلفا' : 'بدون آلفا'} — ${output.withinBudget ? 'زیر سقف' : 'بیش از سقف!'}`,
  );
  return output;
}
