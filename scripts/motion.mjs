#!/usr/bin/env node
/**
 * The motion engine as a command, for the agent handoff and for the panel:
 * the same library the built-in runner uses, one call at a time.
 *
 *   node scripts/motion.mjs analyze --video ref.mp4 --out style.json
 *   node scripts/motion.mjs beats   --srt script.fa.srt [--style style.json] --out beats.json [--ratio 9:16] [--deliver overlay] [--density auto] [--material glass]
 *   node scripts/motion.mjs write   --beats beats.json --dir project [--ratio 9:16] [--audio sfx.wav]
 *   node scripts/motion.mjs sfx     --beats beats.json --out outdir [--level balanced] [--voice master.mp4]
 *   node scripts/motion.mjs stills  --beats beats.json          # review times, one per beat
 *   node scripts/motion.mjs slim    --file layer.webm --out layer.webm [--crf 30] [--threads 2]
 *   node scripts/motion.mjs collage --base master.mp4 --layer layer.webm --out preview.mp4 [--sfx sfx.wav] [--note outdir]
 *   node scripts/motion.mjs inspect --file layer.webm
 *
 * Every render-heavy step goes through the cool-render budget (ffmpeg runs with
 * `-threads 1` here); nothing touches the network.
 */
import fs from 'node:fs';
import path from 'node:path';

import { ratioById } from '../lib/ratios.mjs';
import { analyze } from '../lib/reference.mjs';
import { buildBeats, validate, stillTimes } from '../lib/beats.mjs';
import { writeMotionProject } from '../lib/motion-project.mjs';
import { planCues, mixAndVerify, SOUND_LEVELS } from '../lib/sfx.mjs';
import { collagePreview, inspectLayer, dropInNote } from '../lib/composite.mjs';
import { vp9AlphaReEncode } from '../lib/alpha.mjs';
import { loudness, ffprobeJson, run } from '../lib/ffmpeg.mjs';
import { runSrt } from '../lib/compose.mjs';

const [cmd, ...argv] = process.argv.slice(2);
/* Agents hand the CLI relative paths (they run from the repo root); some
 * commands shift the working directory internally (the beats stage parses the
 * SRT from a temp dir), so every file-like flag is pinned to an absolute path
 * the moment it is read. */
const PATH_FLAGS = new Set([
  'srt', 'style', 'out', 'beats', 'dir', 'video', 'file', 'base', 'layer',
  'voice', 'sfx', 'note', 'input', 'output',
]);
const opt = (name, fb = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fb;
  const v = argv[i + 1];
  return PATH_FLAGS.has(name) && v && !path.isAbsolute(v) ? path.resolve(v) : v;
};
const say = (o) => console.log(JSON.stringify(o, null, 2));
const tmp = fs.mkdtempSync(path.join('/tmp', 'hf-motion-'));

if (cmd === 'analyze') {
  const video = opt('video');
  if (!video) throw new Error('--video لازم است');
  const style = await analyze(video, { out: opt('out'), onStage: (n) => console.error(`… ${n}`) });
  say({ source: style.source, derived: style.derived, notes: style.notes });
} else if (cmd === 'beats') {
  const srt = opt('srt');
  if (!srt) throw new Error('--srt لازم است');
  const tl = path.join(tmp, 'timeline.json');
  runSrt(['parse', srt, '--out', tl], tmp);
  runSrt(['plan', tl, '--out', tl], tmp);
  const timeline = JSON.parse(fs.readFileSync(tl, 'utf8'));
  const styleFile = opt('style');
  const sheet = buildBeats(
    timeline,
    styleFile && fs.existsSync(styleFile) ? JSON.parse(fs.readFileSync(styleFile, 'utf8')) : null,
    {
      deliver: opt('deliver', 'overlay'),
      density: opt('density', 'auto'),
      material: opt('material', 'glass'),
      ratio: opt('ratio', '9:16'),
      maxBeats: Number(opt('max-beats', '0')) || undefined,
    },
  );
  const problems = validate(sheet);
  const out = opt('out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(sheet, null, 2) + '\n', 'utf8');
  }
  say({ file: out || null, beats: sheet.beats.length, duration: sheet.beats.at(-1).end, problems, lines: sheet.report.lines });
} else if (cmd === 'write') {
  const beatsFile = opt('beats');
  const dir = opt('dir');
  if (!beatsFile || !dir) throw new Error('--beats و --dir لازم‌اند');
  const sheet = JSON.parse(fs.readFileSync(beatsFile, 'utf8'));
  const r = ratioById(opt('ratio', sheet.config?.ratio || '9:16'));
  const audio = opt('audio');
  const built = writeMotionProject({
    dir,
    sheet,
    canvas: { width: r.w, height: r.h, fps: Number(opt('fps', 30)), ratio: r.id },
    deliver: sheet.config?.deliver || opt('deliver', 'overlay'),
    background: opt('background', 'site'),
    fetchIcons: false,
    audio: audio ? [{ id: 'sfx', src: stageFile(audio, dir, 'media/sfx.wav'), start: 0, duration: sheet.beats.at(-1).end, volume: 1, track: 40 }] : [],
  });
  say({ dir: built.dir, film: built.film, beats: built.beats, cues: built.cues, canvas: built.canvas, files: built.files });
} else if (cmd === 'sfx') {
  const beatsFile = opt('beats');
  const outDir = opt('out');
  if (!beatsFile || !outDir) throw new Error('--beats و --out لازم‌اند');
  const sheet = JSON.parse(fs.readFileSync(beatsFile, 'utf8'));
  const level = opt('level', 'balanced');
  const voice = opt('voice');
  let voiceLufs = null;
  if (voice) {
    const has = (await ffprobeJson(voice, 'stream=codec_type')).streams?.some((s) => s.codec_type === 'audio');
    if (has) voiceLufs = (await loudness(voice)).lufs;
  }
  const duration = Math.max(...sheet.beats.map((b) => b.end));
  const cues = await planCues(sheet.beats, { level, voiceLufs });
  fs.mkdirSync(outDir, { recursive: true });
  const sfxOut = path.join(outDir, `${opt('name', 'sfx')}.wav`);
  const mixed = await mixAndVerify({
    cues,
    sfxOut,
    duration,
    level,
    onPass: (pass, a, buried) => console.error(`پاس ${pass}: ${a.length} صدا، ${buried.length} پنهان`),
  });
  fs.writeFileSync(
    path.join(outDir, 'sound.json'),
    JSON.stringify({ level, voiceLufs, duration, cues: mixed.cues, audit: mixed.audit }, null, 2) + '\n',
    'utf8',
  );
  say({
    file: sfxOut,
    level: SOUND_LEVELS[level]?.fa || level,
    voiceLufs,
    cues: mixed.cues.length,
    buried: mixed.audit.filter((c) => !c.audible).map((c) => c.role),
  });
} else if (cmd === 'collage') {
  const base = opt('base');
  const layer = opt('layer');
  const out = opt('out');
  if (!base || !layer || !out) throw new Error('--base --layer --out لازم‌اند');
  const info = await inspectLayer(layer);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await collagePreview({
    base,
    layer,
    out,
    width: Number(opt('width', info.width || 1080)),
    height: Number(opt('height', info.height || 1920)),
    fps: Number(opt('fps', 30)),
    seconds: Number(opt('seconds', '0')) || null,
    bed: opt('sfx'),
    maxSide: Number(opt('max-side', 720)),
  });
  const note = opt('note');
  if (note)
    dropInNote({
      dir: note,
      layer,
      base,
      ratio: opt('ratio', `${info.width || 1080}:${info.height || 1920}`),
      bed: opt('sfx'),
      beats: Number(opt('beats', 0)),
      fps: Number(opt('fps', 30)),
    });
  say({ preview: out, dropIn: note ? path.join(note, 'DROP-IN.md') : null, layer: info });
} else if (cmd === 'stills') {
  const sheetFile = opt('beats');
  if (!sheetFile) throw new Error('--beats لازم است');
  const sheet = JSON.parse(fs.readFileSync(sheetFile, 'utf8'));
  say({ at: stillTimes(sheet), film: Math.max(...sheet.beats.map((b) => b.end)) });
} else if (cmd === 'slim') {
  // the size guard for a layer: fit-size would flatten the alpha plane, so the
  // same VP9 stream is re-encoded at a higher CRF.
  const file = opt('file');
  const out = opt('out');
  if (!file || !out) throw new Error('--file --out لازم‌اند');
  const enc = vp9AlphaReEncode({
    file,
    out: `${out}.slim.webm`,
    fps: Number(opt('fps', 30)),
    crf: Number(opt('crf', 30)),
    threads: Number(opt('threads', 2)),
  });
  await run('ffmpeg', enc.args);
  const before = Math.round((fs.statSync(file).size / 1e6) * 100) / 100;
  fs.renameSync(enc.args.at(-1), out);
  say({ out, before_mb: before, ...(await inspectLayer(out)) });
} else if (cmd === 'inspect') {
  const file = opt('file');
  if (!file) throw new Error('--file لازم است');
  const info = await inspectLayer(file);
  say({ ...info, ok: info.fps === 30 && (info.hasAlpha || file.endsWith('.mp4')) });
} else {
  console.log(
    'usage: motion.mjs analyze|beats|write|sfx|stills|slim|collage|inspect …  (see the file header for the flags)',
  );
  process.exitCode = cmd ? 2 : 0;
}

/** HyperFrames reads audio relative to the project, so the file has to live inside it. */
function stageFile(src, dir, rel) {
  const dest = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return rel;
}
