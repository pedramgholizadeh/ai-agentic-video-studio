import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { npxHyperframes, SFX_DIR, STUDIO_ROOT } from './paths.mjs';
import { powerBudget, withPower, freeDiskGb } from './cool.mjs';
import { buildPlan, probe } from './plan.mjs';
import { runSrt } from './compose.mjs';
import { buildBeats, validate as validateSheet, stillTimes as beatStillTimes } from './beats.mjs';
import { writeMotionProject } from './motion-project.mjs';
import * as sfx from './sfx.mjs';
import { collagePreview, inspectLayer } from './composite.mjs';
import { loudness } from './ffmpeg.mjs';
import { resolveProvider, askBrief } from './providers.mjs';
import { resolveBrand, readStudioBrand, describeBrand } from './brand.mjs';
import { buildBrief, mergeBrief, validateBrief, describeBrief } from './brief.mjs';
import { ensureAssetsFor } from './assets.mjs';
import * as references from './references.mjs';
import * as subtitles from './subtitles.mjs';
import * as chat from './chat.mjs';
import { composeFinalArgs, nextCrf, withinBudget } from './finalcut.mjs';
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
            const sub = subFrom + subSpan * Math.max(0, Math.min(1, Number(p.pct ?? (p.done / Math.max(1, p.total))) / 100));
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

const round3 = (v) => Math.round(v * 1000) / 1000;

export function runJob(id) {
  const run = () => runInner(id);
  queue = queue.then(run, run);
  return queue;
}

/**
 * The whole pipeline for one job, in the order the panel's stages expect:
 * prepare → transcribe → (review gate) → understand → reference → assets →
 * strategy → scaffold → preview → (preview gate + chat loop) → final → verify.
 *
 * Every run resumes from artifacts: a stage whose file already exists is
 * skipped, which is what makes the chat-edit loop cheap — an edit only
 * invalidates the artifacts downstream of it.
 */
async function runInner(id) {
  const job = jobs.get(id);
  if (!job) throw new Error(`جاب ${id} پیدا نشد`);
  const p = jobs.paths(id);
  const power = powerBudget(job.config.cpu?.pct ?? 50);
  const npx = (...args) => npxHyperframes(args);
  const cfg = job.config;

  try {
    jobs.closeGate(id);
    jobs.appendLog(id, 'stage', `توان دستگاه: ${power.pct}% → ${power.threads} رشته، ${power.workers} ورکر`);
    const disk = freeDiskGb(STUDIO_ROOT);
    if (disk < 3) jobs.appendLog(id, 'warn', `فقط ${round3(disk)} گیگ فضای دیسک آزاد است — رندر ممکن است وسط کار کم بیاورد.`);

    // 1. prepare — what the video really is, from ffprobe
    jobs.setProgress(id, 'prepare', { sub: 0.3 });
    const plan = buildPlan(job);
    fs.writeFileSync(p.plan, JSON.stringify(plan, null, 2) + '\n', 'utf8');
    jobs.setProgress(id, 'prepare', { sub: 1 });
    jobs.appendLog(
      id,
      'info',
      `منبع ${plan.source.kind} — ${Math.round(plan.source.duration || 0)} ثانیه، ${plan.source.width || '—'}×${plan.source.height || '—'}، بوم ${plan.g.w}×${plan.g.h}`,
    );

    // 2. transcribe — the accuracy floor is the model, the safety net is the user
    let cues;
    if (fs.existsSync(p.transcript)) {
      cues = subtitles.readSrt(p.transcript);
      jobs.setProgress(id, 'transcribe', { sub: 1, label: 'ترنسکریپت موجود است' });
    } else {
      const model = cfg.transcribe?.model || 'large-v3';
      const language = cfg.transcribe?.language || 'fa';
      jobs.setProgress(id, 'transcribe', { sub: 0.05 });
      jobs.appendLog(id, 'stage', `پیاده‌سازی گفتار با whisper (${model}، زبان ${language}) — مدل بزرگ دقیق‌تر و کندتر است`);
      const t = npx(
        'transcribe',
        plan.source.video,
        '--dir',
        p.project,
        '--engine',
        'whisper',
        '--model',
        model,
        '--language',
        language,
        '--to',
        'srt',
        '--output',
        p.transcript,
      );
      await exec(id, t.cmd, t.args, { cwd: p.root, power, stage: 'transcribe', subFrom: 0.05, subSpan: 0.95 });
      if (!fs.existsSync(p.transcript)) throw new Error('پیاده‌سازی گفتار فایلی نساخت؛ مدل یا زبان را در تنظیمات عوض کن.');
      cues = subtitles.readSrt(p.transcript);
    }
    if (!cues.length) throw new Error('ترنسکریپت خالی است — صدایی در ویدیو تشخیص داده نشد.');
    jobs.appendLog(id, 'info', `${cues.length} خط گفتار بیرون آمد`);

    // 3. the transcript review gate — the user reads every line once
    if (!job.approved?.transcript) {
      jobs.openGate(id, 'transcript', 'ترنسکریپت آمادهٔ بازبینی است — غلط‌ها را در جدول اصلاح کن و تایید بزن');
      jobs.appendLog(id, 'stage', 'دروازهٔ بازبینی: ترنسکریپت منتظر تایید توست');
      return { gate: 'transcript' };
    }

    // 4. understand — read the film, write the brief (facts stay sacred)
    let brief;
    if (fs.existsSync(p.brief)) {
      brief = JSON.parse(fs.readFileSync(p.brief, 'utf8'));
      jobs.setProgress(id, 'understand', { sub: 1, label: 'بریف موجود است' });
    } else {
      jobs.setProgress(id, 'understand', { sub: 0.2 });
      const srtText = subtitles.srtText(cues);
      const directionText = cfg.direction?.text || '';
      brief = buildBrief({ srtText, directionText });
      let briefNote = 'برداشت آماری موتور';
      if (cfg.engine?.mode === 'provider' && cfg.engine?.provider) {
        try {
          const { provider, model } = resolveProvider(cfg.engine.provider);
          jobs.appendLog(id, 'stage', `درک محتوا با ${provider} / ${cfg.engine.model || model || '—'}`);
          const asked = await askBrief({ provider, model: cfg.engine.model, direction: directionText, transcript: subtitles.srtText(cues, 3500) });
          brief = mergeBrief(brief, asked.brief, srtText, directionText);
          briefNote = `برداشت مدل ${asked.model}`;
        } catch (err) {
          jobs.appendLog(id, 'warn', `مدل بریف نداد؛ برداشت آماری جای آن را می‌گیرد: ${err.message}`);
        }
      }
      for (const problem of validateBrief(brief, srtText, directionText)) jobs.appendLog(id, 'warn', `brief: ${problem}`);
      fs.writeFileSync(p.brief, JSON.stringify(brief, null, 2) + '\n', 'utf8');
      for (const line of describeBrief(brief).slice(0, 3)) jobs.appendLog(id, 'info', line);
      jobs.setProgress(id, 'understand', { sub: 1, label: `درک محتوا: ${briefNote}` });
    }

    // 5. reference — studied once, remembered forever (lib/references.mjs)
    let style;
    if (fs.existsSync(p.style)) {
      style = JSON.parse(fs.readFileSync(p.style, 'utf8'));
      jobs.setProgress(id, 'reference', { sub: 1, label: 'پروفایل رفرنس موجود است' });
    } else if (plan.reference) {
      jobs.setProgress(id, 'reference', { sub: 0.05 });
      jobs.appendLog(id, 'stage', `تحلیل رفرنس: ${path.basename(plan.reference)}`);
      let done = 0;
      const { sha, profile } = await references.ensureProfile(plan.reference, {
        log: (line) => jobs.appendLog(id, 'info', line),
        onStage: (name) => {
          done++;
          jobs.setProgress(id, 'reference', { sub: Math.min(0.95, done / 5) });
          jobs.appendLog(id, 'info', `تحلیل رفرنس: ${name}`);
        },
      });
      // the ensure call has its own progress when analysing fresh; replay ticks
      style = profile;
      fs.writeFileSync(p.style, JSON.stringify(style, null, 2) + '\n', 'utf8');
      references.attachJob(sha, id);
      const d = style.derived || {};
      jobs.appendLog(
        id,
        'info',
        `ریتم ${d.beatLen ?? '—'} ثانیه، انرژی ${d.energy ?? '—'}، چگالی ${d.density ?? '—'}${d.look ? `، ${d.look}` : ''}`,
      );
      jobs.setProgress(id, 'reference', { sub: 1 });
    } else {
      style = null;
      jobs.setProgress(id, 'reference', { sub: 1, label: 'بدون رفرنس — سلیقهٔ خانه' });
      jobs.appendLog(id, 'warn', 'ویدیوی رفرنس ثبت نشده است؛ سبک از برند خانه ساخته می‌شود.');
    }

    // 6. assets — the SFX kit, the typefaces the beats need, the logo slot
    if (fs.existsSync(path.join(p.root, 'assets.json'))) {
      jobs.setProgress(id, 'assets', { sub: 1, label: 'اسِت‌ها از قبل جمع شده‌اند' });
    } else {
      jobs.setProgress(id, 'assets', { sub: 0.2 });
      ensureAssetsFor(plan, null, (line) => jobs.appendLog(id, 'info', line));
      if (cfg.sound.sfx && !fs.existsSync(SFX_DIR)) {
        jobs.appendLog(id, 'stage', 'کیت افکت صدا ساخته می‌شود (npm run sfx)');
        await exec(id, process.execPath, [path.join(STUDIO_ROOT, 'scripts', 'build-sfx.mjs')], {
          cwd: STUDIO_ROOT,
          power,
          stage: 'assets',
          subFrom: 0.3,
          subSpan: 0.6,
        });
      }
      const logo = cfg.source?.logo && fs.existsSync(cfg.source.logo) ? cfg.source.logo : null;
      if (cfg.source?.logo && !logo) jobs.appendLog(id, 'warn', 'لوگوی ثبت‌شده پیدا نشد؛ بدون لوگو ادامه می‌دهیم.');
      fs.writeFileSync(
        path.join(p.root, 'assets.json'),
        JSON.stringify({ sfxKit: cfg.sound.sfx ? fs.existsSync(SFX_DIR) : false, logo, fonts: 'vazirmatn (woff2 + ttf)', textures: true }, null, 2) + '\n',
        'utf8',
      );
      jobs.setProgress(id, 'assets', { sub: 1, label: 'اسِت‌ها آماده‌اند' });
    }

    // 7. strategy — one brand token set, the beat sheet, the scenario
    let sheet;
    if (fs.existsSync(p.beats)) {
      sheet = JSON.parse(fs.readFileSync(p.beats, 'utf8'));
      jobs.setProgress(id, 'strategy', { sub: 1, label: 'سناریو موجود است' });
    } else {
      jobs.setProgress(id, 'strategy', { sub: 0.15 });
      const brand = resolveBrand({ jobConfig: jobs.get(id).config, studioBrand: readStudioBrand(), style, template: null });
      fs.writeFileSync(p.brand, JSON.stringify(brand, null, 2) + '\n', 'utf8');
      jobs.appendLog(id, 'info', describeBrand(brand));
      const edit = cfg.edit || {};
      const tlFile = path.join(p.root, 'timeline.json');
      runSrt(['parse', p.transcript, '--out', tlFile], p.root);
      runSrt(['plan', tlFile, '--out', tlFile], p.root);
      const timeline = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
      sheet = buildBeats(timeline, style, {
        brief,
        brand,
        deliver: 'overlay',
        density: cfg.motion?.density || 'auto',
        material: cfg.motion?.material || 'glass',
        ratio: plan.ratio,
        energyScale: edit.energyScale,
        beatLenScale: edit.beatLenScale,
        captionSide: edit.captionSide,
      });
      fs.writeFileSync(p.beats, JSON.stringify(sheet, null, 2) + '\n', 'utf8');
      for (const problem of validateSheet(sheet)) jobs.appendLog(id, 'warn', problem);
      const film = round3(Math.max(...sheet.beats.map((b) => b.end)));
      for (const line of sheet.report.lines) jobs.appendLog(id, 'info', line);
      jobs.appendLog(id, 'info', `سناریو: ${sheet.beats.length} بیت روی ${film} ثانیه فیلم`);
      writeScenario(p, sheet);
      jobs.setProgress(id, 'strategy', { sub: 1 });
    }
    const film = round3(Math.max(...sheet.beats.map((b) => b.end)));

    // 8. scaffold — SFX mix, the HyperFrames project, its health check
    jobs.setProgress(id, 'scaffold', { sub: 0.1 });
    let sfxFile = null;
    if (cfg.sound.sfx) {
      let voiceLufs = null;
      try {
        voiceLufs = (await loudness(plan.source.video)).lufs;
      } catch {
        /* targets fall back to the absolute table */
      }
      let sfxCues = await sfx.planCues(sheet.beats, { level: cfg.sound.level, voiceLufs });
      sfxFile = path.join(p.out, `${id}_sfx.wav`);
      const mixed = await sfx.mixAndVerify({
        cues: sfxCues,
        sfxOut: sfxFile,
        duration: film,
        level: cfg.sound.level,
        onPass: (pass, a, buried) => jobs.appendLog(id, 'info', `پاس ${pass}: ${a.length} صدا، ${buried.length} پنهان`),
      });
      sfxCues = mixed.cues;
      fs.writeFileSync(
        path.join(p.root, 'sound.json'),
        JSON.stringify({ level: cfg.sound.level, voiceLufs, cues: sfxCues, audit: mixed.audit }, null, 2) + '\n',
        'utf8',
      );
      jobs.appendLog(id, 'stage', `${sfxCues.length} صدای افکت میکس شد — سطح ${sfx.SOUND_LEVELS[cfg.sound.level]?.fa || cfg.sound.level}`);
    }
    jobs.setProgress(id, 'scaffold', { sub: 0.4 });

    const edit = cfg.edit || {};
    const previewFps = Math.max(10, Math.min(15, plan.fps || 30));
    const previewMp4 = path.join(p.review, `${id}_preview.mp4`);
    const wantPreview = !(fs.existsSync(previewMp4) && job.approved?.preview);
    const buildFps = wantPreview ? previewFps : plan.fps;

    const rebuildProject = async (fps) => {
      fs.rmSync(p.project, { recursive: true, force: true });
      const built = writeMotionProject({
        dir: p.project,
        sheet,
        canvas: { width: plan.g.w, height: plan.g.h, fps, ratio: plan.ratio },
        deliver: 'overlay',
        background: plan.background,
        brand: fs.existsSync(p.brand) ? JSON.parse(fs.readFileSync(p.brand, 'utf8')) : null,
        captionSide: edit.captionSide,
        fetchIcons: false,
        audio: [],
      });
      for (const name of built.icons?.unresolved || []) jobs.appendLog(id, 'warn', `آیکون در کیت نیست: ${name}`);
      jobs.appendLog(id, 'info', `${built.beats} بیت چیده شد — بوم ${built.canvas.width}×${built.canvas.height} در ${fps} فریم`);
      return built;
    };
    await rebuildProject(buildFps);
    jobs.setProgress(id, 'scaffold', { sub: 0.7 });

    // the health check runs once per build — errors fail the job
    const c = npx('check', '--json');
    let checkOut = '';
    try {
      await exec(id, c.cmd, c.args, { cwd: p.project, power, stage: 'scaffold', subFrom: 0.7, subSpan: 0.3, onLine: (line) => (checkOut += line + '\n') });
      for (const f of checkFindings(checkOut).filter((x) => x.severity !== 'error')) jobs.appendLog(id, 'warn', f.message);
    } catch (err) {
      const errors = checkFindings(checkOut).filter((x) => x.severity === 'error');
      for (const f of errors) jobs.appendLog(id, 'error', f.message);
      throw new Error(errors.length ? `اعتبارسنجی ترکیب رد شد (${errors.length} خطا): ${errors[0].message}` : `اعتبارسنجی ترکیب رد شد: ${err.message}`);
    }

    // review stills at the beat sheet's own timestamps — look at them, always
    jobs.setProgress(id, 'scaffold', { sub: 0.95 });
    const s = npx('snapshot', '--at', beatStillTimes(sheet), '--out', path.join(p.review, 'stills'));
    await exec(id, s.cmd, s.args, { cwd: p.project, power, stage: 'scaffold', subFrom: 0.95, subSpan: 0.05 });
    jobs.setProgress(id, 'scaffold', { sub: 1 });

    // 9. preview — the cheap draft the user judges the edit by
    if (wantPreview) {
      const previewWebm = path.join(p.out, `${id}-preview.webm`);
      jobs.setProgress(id, 'preview', { sub: 0 });
      jobs.appendLog(id, 'stage', `دموی کم‌حجم: ${previewFps} فریم، کیفیت draft`);
      const r = npx('render', '.', '-o', previewWebm, '--format', 'webm', '--fps', String(previewFps), '--quality', 'draft', '--workers', String(power.workers));
      await exec(id, r.cmd, r.args, { cwd: p.project, power, stage: 'preview', subFrom: 0, subSpan: 0.8 });
      if (!fs.existsSync(previewWebm)) throw new Error('رندر پیش‌نمایش تمام شد فایلی نیست.');
      jobs.setProgress(id, 'preview', { sub: 0.85 });
      await collagePreview({
        base: plan.source.video,
        layer: previewWebm,
        out: previewMp4,
        width: plan.g.w,
        height: plan.g.h,
        fps: previewFps,
        bed: sfxFile,
        maxSide: 640,
        crf: 30,
      });
      fs.rmSync(previewWebm, { force: true }); // the draft webm has no value once the collage exists
      jobs.appendLog(id, 'info', `دمو آماده است: review/${id}_preview.mp4`);
      jobs.setProgress(id, 'preview', { sub: 1 });
      if (!job.approved?.preview) {
        jobs.openGate(id, 'preview', 'دمو آماده است — ادیت‌ها را در چت‌باکس بگو یا تایید کن تا خروجی نهایی ساخته شود');
        jobs.appendLog(id, 'stage', 'دروازهٔ بازبینی: دمو منتظر نظر توست');
        return { gate: 'preview' };
      }
    }

    return await runFinal(id, { plan, sheet, sfxFile, edit, power, npx });
  } catch (err) {
    const status = err.cancelled ? 'cancelled' : 'failed';
    jobs.setStatus(id, status, { error: String(err.message || err).slice(0, 2000), finishedAt: new Date().toISOString() });
    jobs.appendLog(id, 'error', String(err.message || err).slice(0, 500));
    throw err;
  }
}

/** The approved film: full-fps render, composite, size guard, verify. */
async function runFinal(id, { plan, sheet, sfxFile, edit, power, npx }) {
  const p = jobs.paths(id);
  const cfg = jobs.get(id).config;
  jobs.setProgress(id, 'final', { sub: 0 });

  // the project was built for the preview (15 fps); the final render needs the real one
  fs.rmSync(p.project, { recursive: true, force: true });
  writeMotionProject({
    dir: p.project,
    sheet,
    canvas: { width: plan.g.w, height: plan.g.h, fps: plan.fps, ratio: plan.ratio },
    deliver: 'overlay',
    background: plan.background,
    brand: fs.existsSync(p.brand) ? JSON.parse(fs.readFileSync(p.brand, 'utf8')) : null,
    captionSide: edit.captionSide,
    fetchIcons: false,
    audio: [],
  });

  const layerOut = path.join(p.out, `${id}.webm`);
  jobs.appendLog(id, 'stage', `رندر لایهٔ شفاف WebM با آلفا (${cfg.output.quality || 'delivery'})`);
  // A layer renders without any bitrate cap: `--max-bitrate` is MP4-only and
  // aborts the WebM mux. The alpha plane survives; the `ALPHA_MODE=1` tag proves it.
  const r = npx('render', '.', '-o', layerOut, '--format', 'webm', '--fps', String(plan.fps), '--quality', cfg.output.quality || 'delivery', '--workers', String(power.workers));
  await exec(id, r.cmd, r.args, { cwd: p.project, power, stage: 'final', subFrom: 0, subSpan: 0.55 });
  if (!fs.existsSync(layerOut)) throw new Error('رندر تمام شد فایلی نیست.');
  const layerInfo = await inspectLayer(layerOut);
  if (!layerInfo.hasAlpha) throw new Error('لایه آلفا ندارد؛ روی ویدیوی تو رنگی می‌افتد. رندر باید WebM با برچسب `ALPHA_MODE=1` باشد.');
  if (layerInfo.fps !== plan.fps) throw new Error(`نرخ فریم لایه ${layerInfo.fps} است، نه ${plan.fps}.`);

  // composite + the size guard (an MP4 tool, on the MP4)
  const out = path.join(p.out, `${id}.mp4`);
  const maxMb = cfg.output.maxMb || 200;
  let crf = 20;
  for (let pass = 0; pass < 4; pass++) {
    const args = composeFinalArgs({
      base: plan.source.video,
      layer: layerOut,
      sfx: sfxFile,
      logo: cfg.source?.logo || null,
      out,
      width: plan.g.w,
      height: plan.g.h,
      fps: plan.fps,
      crf,
    });
    jobs.setProgress(id, 'final', { sub: 0.6 + pass * 0.08 });
    jobs.appendLog(id, 'run', `ffmpeg (کامپوزیت نهایی، crf ${crf})`);
    await exec(id, 'ffmpeg', args, { cwd: p.out, power, stage: 'final', subFrom: 0.6, subSpan: 0.3 });
    const mb = fs.statSync(out).size / 1000000;
    if (withinBudget(out, maxMb)) break;
    const next = nextCrf(crf, mb, maxMb);
    if (!next) break;
    jobs.appendLog(id, 'info', `${round3(mb)} مگ از سقف ${maxMb} بیشتر است؛ با crf ${next} دوباره کد می‌شود`);
    crf = next;
  }
  jobs.setProgress(id, 'final', { sub: 1 });

  // verify — the numbers the panel will show must be true
  jobs.setProgress(id, 'verify', { sub: 0.5 });
  const info = probe(out);
  const bytes = fs.statSync(out).size;
  const [wantW, wantH] = [plan.g.w, plan.g.h];
  const dimsOk = Math.abs(info.width - wantW) <= 2 && Math.abs(info.height - wantH) <= 2;
  const fpsOk = info.fps === plan.fps;
  if (!dimsOk) throw new Error(`ابعاد خروجی ${info.width}×${info.height} است، نه ${wantW}×${wantH}.`);
  if (!fpsOk) throw new Error(`نرخ فریم خروجی ${info.fps} است، نه ${plan.fps}.`);
  const output = {
    engine: 'reedit',
    deliver: 'final-mp4',
    file: out,
    rel: path.relative(path.join(p.root, '..'), out),
    bytes,
    mb: round3(bytes / 1000000),
    width: info.width,
    height: info.height,
    fps: info.fps,
    duration: round3(info.duration),
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    withinBudget: bytes <= maxMb * 1000000,
    is30fps: info.fps === 30,
    hasAlphaLayer: true,
    layer: path.relative(path.join(p.root, '..'), layerOut),
    beats: sheet.beats.length,
    density: sheet.config?.density,
    styleFrom: fs.existsSync(p.style) ? 'reference-profile' : null,
    sound: sfxFile ? { file: path.relative(path.join(p.root, '..'), sfxFile), level: cfg.sound.level } : null,
    preview: fs.existsSync(path.join(p.review, `${id}_preview.mp4`)) ? path.join(p.review, `${id}_preview.mp4`) : null,
    handoff: { beats: p.beats, style: fs.existsSync(p.style) ? p.style : null, brief: p.brief },
  };
  jobs.setStatus(id, 'succeeded', { output, error: null, finishedAt: new Date().toISOString() });
  jobs.setProgress(id, 'verify', { sub: 1 });
  jobs.appendLog(
    id,
    'done',
    `آماده: ${output.mb} مگابایت، ${output.width}×${output.height}، ${output.fps} فریم — ${output.withinBudget ? 'زیر سقف' : 'بیش از سقف!'}`,
  );
  return output;
}

/** The scenario as a readable table — the artifact both the panel and an agent read. */
function writeScenario(p, sheet) {
  const rows = sheet.beats
    .map(
      (b) =>
        `| ${b.n} | ${round3(b.start)}–${round3(b.end)} | ${b.recipe} | ${b.content.headline || '—'}${b.content.sub ? ` — ${b.content.sub}` : ''} | ${b.zone?.id || '—'} |`,
    )
    .join('\n');
  const md = [
    '# سناریوی تدوین',
    '',
    `- بیت‌ها: ${sheet.beats.length}`,
    `- چگالی: ${sheet.config?.density}`,
    `- کپشن: ${sheet.captions?.length || 0} خط کلمه‌به‌کلمه`,
    '',
    '| # | زمان | دستور | متن | محل |',
    '|---|---|---|---|---|',
    rows,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(p.root, 'scenario.md'), md, 'utf8');
}
