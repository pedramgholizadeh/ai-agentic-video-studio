/* editor.mjs — the simple video editor: an edit decision list (EDL) rendered
 * by plain ffmpeg. Cuts, concat, multi-video overlays and burned-in
 * subtitles with a chosen font and position — through the same ≤ 50 % CPU
 * budget and the same ≤ 200 MB size guard as every other studio render.
 *
 * The EDL (all times in seconds, positions as fractions of the canvas):
 * {
 *   base:     { src, segments: [{ start, end }] },            // ≥ 1 cut
 *   overlays: [{ src, start, duration, x, y, scale, opacity, srcStart? }],
 *   subtitles: {
 *     segments: [{ start, end, text }],                        // editable copy
 *     style:    { font: 'Vazirmatn', size: 0.055, color: '#ffffff', bold: true, outline: true },
 *     position: { place: 'bottom' | 'middle' | 'top', margin: 0.08 },
 *   },
 *   output: { quality: 'draft' | 'delivery', maxMb: 200 },
 * }
 *
 * Burned-in subtitles are an ASS file rendered by libass — which needs real
 * TTF faces, so the editor pulls the TTF packs from the asset store
 * (`ensureAssetsFor`) and points `fontsdir` at them. The woff2 set the panel
 * uses cannot be burned in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { run, ffprobeJson } from './ffmpeg.mjs';
import { powerBudget, withPower } from './cool.mjs';
import { runSrt } from './compose.mjs';
import { ensureAssetsFor, packDir, packById } from './assets.mjs';
import { HYPERFRAMES_VERSION, MOTION_TEMPLATE, STUDIO_ROOT } from './paths.mjs';

const MOTION_TEMPLATE_ASSETS = path.join(MOTION_TEMPLATE, 'assets');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const QUALITY = {
  draft: { crf: 26, preset: 'veryfast' },
  delivery: { crf: 20, preset: 'medium' },
};

const ALIGN = { bottom: 2, middle: 5, top: 8 };

/** Media meta for the timeline: dimensions, duration, audio presence. */
export async function probeMedia(file) {
  const info = await ffprobeJson(file, 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate');
  const v = (info.streams || []).find((s) => s.codec_type === 'video') || {};
  const a = (info.streams || []).find((s) => s.codec_type === 'audio') || {};
  return {
    file: path.resolve(file),
    duration: Math.round((Number(info.format?.duration) || 0) * 100) / 100,
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    fps: Number(v.r_frame_rate?.split('/')[0]) || 30,
    hasAudio: Boolean(a),
  };
}

/** n small frames for the timeline's filmstrip, as file paths in dir. */
export async function filmstrip(file, { n = 10, dir } = {}) {
  const meta = await probeMedia(file);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = Math.min(meta.duration - 0.1, ((i + 0.5) / n) * meta.duration);
    if (at <= 0) break;
    const f = path.join(dir, `strip-${String(i).padStart(2, '0')}.jpg`);
    try {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', 'scale=200:-2', '-q:v', '6', f]);
      out.push(f);
    } catch {
      break;
    }
  }
  return out;
}

/** Audio peaks for the timeline's waveform: n values in [0, 1]. */
export async function peaks(file, { n = 600 } = {}) {
  const raw = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000',
    '-f', 's16le', '-threads', '1', '-',
  ], { binary: true });
  const samples = raw.stdout.length / 2;
  if (!samples) return new Array(n).fill(0);
  const per = Math.max(1, Math.floor(samples / n));
  const peaks = [];
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let p = 0; p < per; p++) {
      const v = Math.abs(raw.stdout.readInt16LE((i * per + p) * 2)) / 32768;
      if (v > peak) peak = v;
    }
    peaks.push(Math.round(peak * 100) / 100);
  }
  return peaks;
}

/** Whisper transcription through HyperFrames → editable segments. */
export async function transcribeToSegments(file, { model = 'small', language = 'fa', outDir, onLog = () => {} } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const srt = path.join(outDir, 'transcript.fa.srt');
  onLog(`transcribing with whisper ${model} (${language}) — this can take a while`);
  await run('npx', [
    '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'transcribe', file,
    '--dir', outDir, '--engine', 'whisper', '--model', model, '--language', language,
    '--to', 'srt', '--output', srt,
  ]);
  const tl = path.join(outDir, 'timeline.json');
  runSrt(['parse', srt, '--out', tl], outDir);
  const parsed = JSON.parse(fs.readFileSync(tl, 'utf8'));
  return (parsed.cues || []).map((c) => ({ start: c.start, end: c.end, text: c.text || '' }));
}

/** An ASS subtitle file: the whole style system the panel exposes. */
export function buildAss(subtitles, canvas) {
  const { segments = [], style = {}, position = {} } = subtitles;
  const W = canvas.width;
  const H = canvas.height;
  const font = style.font || 'Vazirmatn';
  const size = Math.max(12, Math.round((style.size || 0.055) * H));
  const colour = style.color || '#ffffff';
  const rgb = colour.replace('#', '');
  const assColor = `&H00${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toUpperCase();
  const place = position.place || 'bottom';
  const marginV = Math.round((position.margin ?? 0.08) * H);
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${font},${size},${assColor},&H00FFFFFF,&H00000000,&H7F000000,${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,${style.outline === false ? 0 : 3},2,${ALIGN[place] ?? 2},60,60,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const stamp = (t) => {
    const h = Math.floor(t / 3600);
    const mnt = Math.floor((t % 3600) / 60);
    const sec = t % 60;
    return `${h}:${String(mnt).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
  };
  const events = segments
    .filter((s) => s.text && s.text.trim())
    .map(
      (s) =>
        `Dialogue: 0,${stamp(Math.max(0, s.start))},${stamp(Math.max(0.01, s.end))},Sub,,0,0,0,,${String(s.text).replace(/\n/g, '\\N')}`,
    );
  return header.join('\n') + '\n' + events.join('\n') + '\n';
}

/** The editor needs its subtitle TTFs — fetch them from the store when gone. */
function ensureSubtitleFonts(log) {
  try {
    ensureAssetsFor({ background: 'none' }, null, log);
    /* the packs the editor wires in are not background-driven; ask directly */
    for (const id of ['font-vazirmatn-ttf', 'font-jetbrains-mono']) {
      const pack = packById(id);
      if (pack && !packStatusQuiet(pack)) {
        const script = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), 'scripts', 'fetch-assets.mjs');
        log(`asset store: fetching ${id}`);
        execFileSync(process.execPath, [script, '--only', id], { stdio: 'pipe', timeout: 240000 });
      }
    }
  } catch (err) {
    log(`asset store: fonts unavailable — subtitles fall back to system faces (${String(err.message).slice(0, 80)})`);
  }
}

function packStatusQuiet(pack) {
  const dir = packDir(pack);
  return Object.values(pack.extract || {}).every((f) => fs.existsSync(path.join(dir, f)));
}

let nativeSubsCache = null;
/** libass is an optional ffmpeg build flag; probe once. */
async function hasNativeSubs() {
  if (nativeSubsCache !== null) return nativeSubsCache;
  try {
    const r = await run('ffmpeg', ['-hide_banner', '-filters']);
    nativeSubsCache = /\bsubtitles\b/.test(r.stdout);
  } catch {
    nativeSubsCache = false;
  }
  return nativeSubsCache;
}

/**
 * The studio's own subtitle burn: a minimal HyperFrames project — one text
 * host, one timed cue per segment — rendered to a transparent WebM layer at
 * the base's exact canvas. Better Persian shaping than libass, and it works
 * on every ffmpeg build.
 */
async function renderSubtitlesLayer(subs, canvas, { dir, film, power, onLog }) {
  const W = canvas.width;
  const H = canvas.height;
  const st = subs.style || {};
  const pos = subs.position || {};
  const px = Math.max(12, Math.round((st.size || 0.055) * H));
  const margin = Math.round((pos.margin ?? 0.08) * H);
  const place = pos.place || 'bottom';
  const posCss =
    place === 'top'
      ? `top:${margin}px;`
      : place === 'middle'
        ? `top:50%;transform:translateY(-50%);`
        : `bottom:${margin}px;`;
  const fontFamily = st.font === 'JetBrains Mono' ? "'JetBrains Mono', ui-monospace, Menlo, monospace" : "Vazirmatn, sans-serif";

  fs.mkdirSync(dir, { recursive: true });
  const project = dir;
  /* fonts + gsap + hypermotion ride along from the committed template */
  fs.cpSync(path.join(MOTION_TEMPLATE_ASSETS, 'fonts'), path.join(project, 'assets', 'fonts'), { recursive: true });
  const gsapCandidates = [
    path.join(MOTION_TEMPLATE_ASSETS, 'vendor', 'gsap.min.js'),
    path.join(STUDIO_ROOT, 'templates', 'video-2x1', 'assets', 'vendor', 'gsap.min.js'),
  ];
  const gsap = gsapCandidates.find((f) => fs.existsSync(f));
  if (gsap) {
    fs.mkdirSync(path.join(project, 'assets', 'vendor'), { recursive: true });
    fs.copyFileSync(gsap, path.join(project, 'assets', 'vendor', 'gsap.min.js'));
  }
  const hm = path.join(MOTION_TEMPLATE_ASSETS, 'hypermotion.js');
  if (fs.existsSync(hm)) fs.copyFileSync(hm, path.join(project, 'assets', 'hypermotion.js'));

  const cues = (subs.segments || []).filter((s) => s.text && s.text.trim());
  const cueHtml = cues
    .map(
      (s, i) =>
        `<div class="cue" id="cue-${i}" style="opacity:0">${esc(s.text).replace(/\n/g, '<br/>')}</div>`,
    )
    .join('\n      ');
  const weight = { '400': 400, '500': 500, '700': 700, '800': 800 }[String(st.weight || '700')] || 700;

  const index = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>subs-layer</title>
  <link rel="stylesheet" href="assets/fonts/vazirmatn.css" />
  <script src="assets/vendor/gsap.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: transparent; }
    #root { position: relative; width: ${W}px; height: ${H}px; }
    #subhost { position: absolute; inset: 0; pointer-events: none;
      font-family: ${fontFamily}; font-weight: ${weight}; }
    .cue { position: absolute; left: 6%; right: 6%; text-align: center;
      font-size: ${px}px; line-height: 1.65; color: ${st.color || '#ffffff'};
      text-shadow: 0 2px 8px rgba(0,0,0,.9), 0 0 3px rgba(0,0,0,.9);
      ${posCss} will-change: opacity; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${film}" data-width="${W}" data-height="${H}" data-fps="30">
    <div id="subhost" data-layout-allow-overflow>
      ${cueHtml}
    </div>
  </div>
  <script>
    var tl = gsap.timeline({ paused: true });
    tl.to({}, { duration: ${film}, ease: "none" }, 0);
${cues
  .map(
    (s, i) => `    tl.fromTo("#cue-${i}", { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power2.out" }, ${Math.max(0, s.start).toFixed(2)});
    tl.to("#cue-${i}", { opacity: 0, duration: 0.15, ease: "power2.in" }, ${Math.max(0, s.end).toFixed(2)});`,
  )
  .join('\n')}
    window.__timelines["main"] = tl;
    tl.seek(0);
  </script>
</body>
</html>`;
  fs.writeFileSync(path.join(project, 'index.html'), index, 'utf8');
  fs.writeFileSync(
    path.join(project, 'hyperframes.json'),
    JSON.stringify({
      $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
      registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
      paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
      media: { autoProxy: true },
    }, null, 2) + '\n',
  );

  const layerOut = path.join(path.dirname(dir), 'subs-layer.webm');
  const power2 = powerBudget(power);
  const { cmd, args: poweredArgs, env } = withPower('npx', [
    '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'render', '.', '-o', layerOut,
    '--format', 'webm', '--fps', '30', '--workers', String(power2.threads),
  ], power2);
  onLog('burning subtitles through the studio renderer (transparent layer)');
  await new Promise((resolve, reject) => {
    const proc = spawn(cmd, poweredArgs, { cwd: project, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (b) => (err += b));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 && fs.existsSync(layerOut) ? resolve() : reject(new Error(`subtitle layer render exited ${code}: ${err.trim().slice(-500)}`))));
  });
  return layerOut;
}

/**
 * Render the EDL. Everything runs inside jobDir with relative paths, so the
 * ffmpeg filtergraph never needs URL escaping. Returns the output info.
 */
export async function render(edl, { jobDir, power = 50, onLog = () => {} } = {}) {
  const p = {
    root: path.resolve(jobDir),
    out: path.join(path.resolve(jobDir), 'out'),
  };
  fs.mkdirSync(p.out, { recursive: true });
  const rel = (f) => path.relative(p.root, f).split(path.sep).join('/');

  ensureSubtitleFonts(onLog);

  const base = edl.base || {};
  if (!base.src || !fs.existsSync(base.src)) throw new Error('editor: the base video is missing');
  const meta = await probeMedia(base.src);
  const W = meta.width;
  const H = meta.height;
  const segments = (base.segments || []).filter((s) => s.end > s.start);
  if (!segments.length) throw new Error('editor: the base has no segments — cut something first');

  const quality = QUALITY[edl.output?.quality] || QUALITY.draft;
  const maxMb = edl.output?.maxMb || 200;
  const output = path.join(p.out, 'edit.mp4');

  /* the fonts the ASS will name, copied where fontsdir can see them */
  const fontsDirRel = 'assets/store/editor-fonts';
  const fontsDir = path.join(p.root, fontsDirRel);
  fs.mkdirSync(fontsDir, { recursive: true });
  for (const id of ['font-vazirmatn-ttf', 'font-jetbrains-mono']) {
    const pack = packById(id);
    if (!pack || !packStatusQuiet(pack)) continue;
    for (const f of Object.values(pack.extract)) {
      const src = path.join(packDir(pack), f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(fontsDir, f));
    }
  }

  const subs = edl.subtitles?.segments?.length ? edl.subtitles : null;
  const nativeSubs = subs ? await hasNativeSubs() : false;
  if (subs && nativeSubs) {
    const ass = buildAss(subs, { width: W, height: H });
    fs.writeFileSync(path.join(p.root, 'subs.ass'), ass, 'utf8');
  }

  const args = ['-y', '-loglevel', 'error', '-stats'];
  /* the base, once per cut */
  for (const s of segments) {
    args.push('-ss', String(Math.max(0, s.start)), '-t', String(s.end - s.start), '-i', rel(base.src));
  }
  const webmDecoder = (f) => (/\.webm$/i.test(f) ? ['-c:v', 'libvpx-vp9'] : []);
  /* overlays, one input per clip — webm inputs may be studio alpha layers,
   * so they decode through libvpx (the native decoder drops the alpha) */
  const overlays = (edl.overlays || []).filter((o) => o.duration > 0 && fs.existsSync(o.src));
  for (const o of overlays) {
    args.push('-ss', String(Math.max(0, o.srcStart || 0)), '-t', String(o.duration), ...webmDecoder(o.src), '-i', rel(o.src));
  }

  /* without libass the subtitles burn through the studio's own engine: a
   * transparent WebM layer at the exact canvas size, overlaid last — the same
   * Persian typography the motion films use, shaped by the browser. */
  let subsLayerRel = null;
  if (subs && !nativeSubs) {
    const film = segments.reduce((n, s) => n + (s.end - s.start), 0);
    const layer = await renderSubtitlesLayer(subs, { width: W, height: H }, {
      dir: path.join(p.root, 'subs-layer'),
      film,
      power,
      onLog,
    });
    if (layer) {
      args.push('-c:v', 'libvpx-vp9', '-i', rel(layer));
      subsLayerRel = rel(layer);
    } else {
      onLog('subtitle layer failed to render — the edit continues without burned text');
    }
  }

  const fc = [];
  segments.forEach((_, i) => {
    fc.push(`[${i}:v]fps=30,setsar=1[v${i}]`);
    if (meta.hasAudio) fc.push(`[${i}:a]aresample=48000[a${i}]`);
  });
  /* concat's input pads are interleaved per segment: [v0][a0][v1][a1]… */
  const concatLabels = segments.map((_, i) => (meta.hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
  if (meta.hasAudio) fc.push(`${concatLabels}concat=n=${segments.length}:v=1:a=1[cv][ca]`);
  else fc.push(`${concatLabels}concat=n=${segments.length}:v=1:a=0[cv]`);

  let last = '[cv]';
  overlays.forEach((o, k) => {
    const input = segments.length + k;
    const scale = Math.max(0.05, Math.min(2, o.scale ?? 0.35));
    const op = Math.max(0.05, Math.min(1, o.opacity ?? 1));
    fc.push(
      `[${input}:v]scale=${Math.round(W * scale)}:-2,format=yuva420p,colorchannelmixer=aa=${op}[ov${k}]`,
    );
    const x = `(main_w-overlay_w)*${Math.max(0, Math.min(1, o.x ?? 0.5))}`;
    const y = `(main_h-overlay_h)*${Math.max(0, Math.min(1, o.y ?? 0.75))}`;
    fc.push(
      `${last}[ov${k}]overlay=x=${x}:y=${y}:enable='between(t,${(o.start ?? 0).toFixed(2)},${((o.start ?? 0) + o.duration).toFixed(2)})'[c${k}]`,
    );
    last = `[c${k}]`;
  });
  const subsInput = segments.length + overlays.length;
  if (subs && nativeSubs) {
    fc.push(`${last}subtitles=filename=subs.ass:fontsdir='${fontsDirRel}'[vout]`);
  } else if (subs && subsLayerRel) {
    fc.push(`[${subsInput}:v]format=yuva420p[ovS]`);
    fc.push(`${last}[ovS]overlay=0:0[vout]`);
  } else {
    fc.push(`${last}null[vout]`);
  }

  args.push('-filter_complex', fc.join(';'), '-map', '[vout]');
  if (meta.hasAudio) args.push('-map', '[ca]', '-c:a', 'aac', '-b:a', '160k');
  args.push(
    '-c:v', 'libx264', '-crf', String(quality.crf), '-preset', quality.preset,
    '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart',
    'out/edit.mp4',
  );

  const power2 = powerBudget(power);
  const { cmd, args: poweredArgs, env } = withPower('ffmpeg', args, power2);
  fs.writeFileSync(path.join(p.root, 'ffmpeg-args.json'), JSON.stringify({ cmd, args: poweredArgs, cwd: p.root }, null, 2) + '\n');
  onLog(`rendering the edit — ${segments.length} cut(s), ${overlays.length} overlay(s), ${subs ? 'burned-in subtitles' : 'no subtitles'}`);
  const started = Date.now();
  /* cwd = job root keeps every filter path relative (no URL escaping) */
  await new Promise((resolve, reject) => {
    const proc = spawn(cmd, poweredArgs, { cwd: p.root, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (b) => (err += b));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().slice(-2500)}`))));
  });

  /* the size guard: re-encode harder when the delivery is over budget */
  let st = fs.statSync(output);
  let crf = quality.crf;
  let tries = 0;
  while (st.size > maxMb * 1000000 && tries < 3) {
    crf += 8;
    tries++;
    onLog(`over budget (${(st.size / 1000000).toFixed(1)} MB) — re-encoding at CRF ${crf}`);
    const tighter = args.map((a) => (a === String(quality.crf) ? String(crf) : a));
    const { cmd: c2, args: a2, env: e2 } = withPower('ffmpeg', tighter, power2);
    await new Promise((resolve, reject) => {
      const proc = spawn(c2, a2, { cwd: p.root, env: { ...process.env, ...e2 }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      proc.stderr.on('data', (b) => (err += b));
      proc.on('error', reject);
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().slice(-2500)}`))));
    });
    st = fs.statSync(output);
  }

  const info = await ffprobeJson(output, 'format=duration:stream=codec_type,width,height,r_frame_rate');
  const v = (info.streams || []).find((s) => s.codec_type === 'video') || {};
  const result = {
    file: output,
    rel: rel(output),
    mb: Math.round((st.size / 1000000) * 100) / 100,
    withinBudget: st.size <= maxMb * 1000000,
    width: Number(v.width) || W,
    height: Number(v.height) || H,
    fps: Math.round(Number(v.r_frame_rate?.split('/')[0]) || 30),
    duration: Math.round((Number(info.format?.duration) || 0) * 100) / 100,
    crf,
    ms: Date.now() - started,
  };
  onLog(`edit ready — ${result.mb} MB, ${result.width}×${result.height}, ${result.duration} s${tries ? ` (re-encoded at CRF ${crf})` : ''}`);
  return result;
}
