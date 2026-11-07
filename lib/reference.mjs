import fs from 'node:fs';
import path from 'node:path';
import { ffRaw, ffReport, ffprobeJson, loudness, rmsCurve } from './ffmpeg.mjs';

/* reference.mjs — "how was that video made?", answered with ffmpeg only.

 An uploaded reference film is measured, not watched:

   geometry   duration, fps, aspect            → what canvas to build
   cuts       scene-change timestamps          → how often a new beat enters
   motion     per-frame YDIF                   → how strong the transitions are
   audio      loudness + RMS peaks             → where the accents already live
   picture    sampled frames in Node           → palette, flat-vs-photo look,
                                                  and which screen zones hold the
                                                  graphics (so the collage layer
                                                  lands where their layer lands)

 The result is style.json: numbers a beat planner can consume and a human can
 read. Every stage is independent — a probe that fails is recorded and the rest
 still returns.
 */

const MAX_ANALYSIS_SECONDS = 300;
const FRAME_SAMPLING = 2; // one sampled frame every N seconds

export async function analyze(file, { out = null, maxSeconds = MAX_ANALYSIS_SECONDS, onStage } = {}) {
  const abs = path.resolve(file);
  const style = { source: abs, analyzedAt: new Date().toISOString(), notes: [] };
  const stage = async (name, fn) => {
    if (onStage) onStage(name);
    try {
      Object.assign(style, await fn());
    } catch (err) {
      style.notes.push(`${name}: ${String(err.message).slice(0, 140)}`);
    }
  };

  await stage('meta', () => probe(abs));
  const dur = Math.min(style.meta?.duration || 0, maxSeconds);
  style.analysisWindow = Math.round(dur * 10) / 10;

  await stage('cuts', () => cuts(abs, dur));
  await stage('motion', () => motion(abs, dur));
  if (style.meta?.hasAudio) await stage('audio', () => audio(abs, dur));
  await stage('picture', () => picture(abs, dur));

  style.derived = derive(style);
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(style, null, 2) + '\n', 'utf8');
  }
  return style;
}

async function probe(file) {
  const info = await ffprobeJson(file, 'format=duration:stream=codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames');
  const v = (info.streams || []).find((s) => s.codec_type === 'video') || {};
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  const [num, den] = String(v.r_frame_rate || '30/1').split('/').map(Number);
  const fps = den ? Math.round((num / den) * 100) / 100 : 30;
  const width = Number(v.width) || 0;
  const height = Number(v.height) || 0;
  const duration = Number(info.format?.duration) || 0;
  const ratio = width && height ? simplify(width, height) : null;
  return {
    meta: {
      duration: Math.round(duration * 100) / 100,
      fps,
      width,
      height,
      ratio,
      aspect: width && height ? Math.round((width / height) * 1000) / 1000 : null,
      orientation: width && height ? (width > height * 1.2 ? 'landscape' : height > width * 1.2 ? 'portrait' : 'square') : 'unknown',
      hasAudio: Boolean(a),
    },
  };
}

/**
 * Scene changes. The score of every candidate frame is kept, so a video with no
 * hard cut (a caption film over a static background still *changes*, it just does
 * not slam) is measured by its softer content changes instead of reporting zero.
 */
async function cuts(file, dur) {
  const out = await ffReport([
    '-i', file, '-t', String(dur), '-an',
    '-vf', `scale=240:-2,select='gt(scene\\,0.04)',metadata=print:file=-`,
    '-f', 'null', '-',
  ]);
  const rows = [];
  let pts = null;
  for (const line of out.split('\n')) {
    const p = /pts_time:([0-9.]+)/.exec(line);
    if (p) pts = Number(p[1]);
    const s = /scene_score=([0-9.]+)/.exec(line);
    if (s && pts !== null) rows.push({ t: pts, score: Number(s[1]) });
  }
  const hard = rows.filter((r) => r.score >= 0.2).map((r) => r.t);
  const soft = rows.filter((r) => r.score >= 0.08).map((r) => r.t);
  const pick = hard.length >= 3 ? hard : soft.length >= 3 ? soft : hard;
  const which = pick === hard ? 'hard' : 'soft';
  const gaps = pick.slice(1).map((t, i) => t - pick[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    cuts: {
      kind: which,
      count: pick.length,
      hardCount: hard.length,
      softCount: soft.length,
      times: pick.map((t) => Math.round(t * 100) / 100).slice(0, 240),
      medianGap: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100 : null,
      fastCutShare: gaps.length
        ? Math.round((100 * gaps.filter((g) => g < 1.2).length) / gaps.length)
        : 0,
      perMinute: dur > 0 ? Math.round((pick.length / dur) * 600) / 10 : 0,
      peakScore: rows.length ? Math.round(Math.max(...rows.map((r) => r.score)) * 100) / 100 : 0,
    },
  };
}

/** Frame-to-frame luma difference: how much is actually moving. */
async function motion(file, dur) {
  const out = await ffReport([
    '-i', file, '-t', String(dur), '-an',
    '-vf', 'scale=160:-2,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-',
    '-f', 'null', '-',
  ]);
  const vals = [...out.matchAll(/YDIF=([0-9.]+)/g)].map((m) => Number(m[1]));
  if (!vals.length) return { motion: { level: 0, samples: 0 } };
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  // YDIF is a per-frame luma delta; 8 is already busy motion graphics
  const level = Math.min(1, Math.round((mean / 8) * 100) / 100);
  const peaks = [];
  const step = Math.max(1, Math.floor(vals.length / 60));
  for (let i = 0; i < vals.length; i += step) {
    const slice = vals.slice(i, i + step);
    const mx = Math.max(...slice);
    if (mx > sorted[Math.floor(sorted.length * 0.9)]) {
      peaks.push(Math.round((i / (vals.length || 1)) * dur * 100) / 100);
    }
  }
  return {
    motion: {
      level,
      meanYdif: Math.round(mean * 100) / 100,
      p90Ydif: Math.round(sorted[Math.floor(sorted.length * 0.9)] * 100) / 100,
      stillShare: Math.round((100 * vals.filter((v) => v < 1).length) / vals.length),
      samples: vals.length,
      peaks: peaks.slice(0, 60),
    },
  };
}

/** Loudness, plus the times the audio already accents. */
async function audio(file, dur) {
  const loud = await loudness(file);
  const rows = await rmsCurve(file, 0.1);
  const used = rows.filter((r) => r.t <= dur);
  if (!used.length) return { audio: { lufs: loud.lufs, peaks: [] } };
  const dbs = used.map((r) => r.db).sort((a, b) => a - b);
  const floor = dbs[Math.floor(dbs.length * 0.3)];
  const ceil = dbs[Math.floor(dbs.length * 0.97)];
  const peaks = [];
  for (let i = 1; i < used.length - 1; i++) {
    const r = used[i];
    if (r.db >= floor + 6 && r.db >= ceil - 3 && r.db > used[i - 1].db && r.db >= used[i + 1].db) {
      if (!peaks.length || r.t - peaks[peaks.length - 1] > 0.4) peaks.push(Math.round(r.t * 100) / 100);
    }
  }
  return {
    audio: {
      lufs: loud.lufs,
      truePeak: loud.truePeak,
      dynamicRange: Math.round((ceil - floor) * 10) / 10,
      floorDb: Math.round(floor * 10) / 10,
      ceilDb: Math.round(ceil * 10) / 10,
      peaks: peaks.slice(0, 120),
    },
  };
}

/**
 * Palette, look and layout from a handful of small frames. Everything is read as
 * raw RGB in Node so the studio needs no image library.
 */
async function picture(file, dur) {
  const interval = Math.max(1, Math.min(FRAME_SAMPLING, Math.floor(dur / 24) || 1));
  const side = 48;
  const raw = await ffRaw([
    '-i', file, '-t', String(dur), '-an',
    '-vf', `fps=1/${interval},scale=${side}:${side}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  const per = side * side * 3;
  const frames = Math.floor(raw.length / per);
  if (!frames) return { picture: { frames: 0 } };

  const buckets = new Map();
  const rows = { top: 0, middle: 0, bottom: 0 };
  const cols = { left: 0, centre: 0, right: 0 };
  let graphicsPixels = 0;
  let totalPixels = 0;
  let diversity = 0;
  let satSum = 0;
  let lumSum = 0;

  for (let f = 0; f < frames; f++) {
    const off = f * per;
    // the dominant colour of a frame is its background; anything far from it is
    // a graphic element sitting on top
    const local = new Map();
    for (let p = 0; p < side * side; p++) {
      const r = raw[off + p * 3];
      const g = raw[off + p * 3 + 1];
      const b = raw[off + p * 3 + 2];
      const key = quantize(r, g, b);
      local.set(key, (local.get(key) || 0) + 1);
      const { s, l } = hsl(r, g, b);
      satSum += s;
      lumSum += l;
      totalPixels++;
      // palette buckets are quantised, otherwise every scaled pixel is unique
      const idx = key.join(',');
      const bucket = buckets.get(idx) || { r: 0, g: 0, b: 0, n: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.n++;
      buckets.set(idx, bucket);
    }
    let bgKey = null;
    let bgN = 0;
    for (const [k, n] of local) {
      if (n > bgN) {
        bgKey = k;
        bgN = n;
      }
    }
    diversity += local.size;
    const bg = [bgKey[0] * 16 + 8, bgKey[1] * 16 + 8, bgKey[2] * 16 + 8];
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const p = y * side + x;
        if (colorDistance([raw[off + p * 3], raw[off + p * 3 + 1], raw[off + p * 3 + 2]], bg) < 40) continue;
        graphicsPixels++;
        rows[y < side / 3 ? 'top' : y < (2 * side) / 3 ? 'middle' : 'bottom']++;
        cols[x < side / 3 ? 'left' : x < (2 * side) / 3 ? 'centre' : 'right']++;
      }
    }
  }

  const ranked = [...buckets.values()]
    .map((b) => ({
      r: Math.round(b.r / b.n),
      g: Math.round(b.g / b.n),
      b: Math.round(b.b / b.n),
      n: b.n,
    }))
    .sort((x, y) => y.n - x.n);
  const px = frames * side * side;
  const share = (c) => c.n / px;
  const light = (c) => hsl(c.r, c.g, c.b).l;
  const sat = (c) => hsl(c.r, c.g, c.b).s;
  // ranked is ordered by pixel count, so "first that matches" is the dominant one
  const common = ranked.filter((c) => share(c) > 0.004);
  const surface = common.find((c) => light(c) < 0.5) || ranked[ranked.length - 1];
  const ink =
    common.find((c) => light(c) > Math.max(0.62, light(surface) + 0.25)) ||
    [...ranked].sort((a, b) => light(b) - light(a))[0];
  const accent =
    common.filter((c) => sat(c) > 0.38).sort((a, b) => sat(b) * b.n - sat(a) * a.n)[0] ||
    common.filter((c) => sat(c) > 0.25).sort((a, b) => sat(b) * b.n - sat(a) * a.n)[0] ||
    ranked.filter((c) => sat(c) > 0.2).sort((a, b) => sat(b) - sat(a))[0] ||
    ranked[0];

  const flatness = Math.round((1 - Math.min(1, diversity / frames / 900)) * 100) / 100;
  const graphics = Math.round((100 * graphicsPixels) / totalPixels);
  const look =
    graphics < 6 && flatness < 0.35 ? 'live-action' : graphics > 24 || flatness > 0.7 ? 'motion-graphics' : 'mixed';
  const gp = graphicsPixels || 1;

  return {
    picture: {
      frames,
      samplingInterval: interval,
      palette: {
        surface: hex(surface),
        ink: hex(ink),
        accent: hex(accent),
        accentSaturation: Math.round(sat(accent) * 100),
        top: ranked.slice(0, 6).map((c) => ({ hex: hex(c), share: Math.round(share(c) * 100) / 100 })),
      },
      brightness: Math.round((lumSum / px) * 100) / 100,
      saturation: Math.round((satSum / px) * 100) / 100,
      flatness,
      graphicsShare: graphics,
      look,
      rows: {
        top: Math.round((100 * rows.top) / gp),
        middle: Math.round((100 * rows.middle) / gp),
        bottom: Math.round((100 * rows.bottom) / gp),
      },
      cols: {
        left: Math.round((100 * cols.left) / gp),
        centre: Math.round((100 * cols.centre) / gp),
        right: Math.round((100 * cols.right) / gp),
      },
    },
  };
}

/* ---------- helpers ---------- */

function quantize(r, g, b) {
  return [r >> 4, g >> 4, b >> 4];
}

function colorDistance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function hsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

const hex = (c) =>
  `#${[c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

function simplify(w, h) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const d = gcd(w, h) || 1;
  const rw = Math.round(w / d);
  const rh = Math.round(h / d);
  const known = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['2:1', 2],
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['4:3', 4 / 3],
  ];
  const hit = known.find(([, v]) => Math.abs(w / h - v) < 0.04);
  if (hit) return hit[0];
  return rw <= 40 && rh <= 40 ? `${rw}:${rh}` : `${(Math.round((w / h) * 100) / 100).toString()}:1`;
}

/** What the measurements mean for the build. */
function derive(style) {
  const cuts = style.cuts || {};
  const motion = style.motion || {};
  const picture = style.picture || {};
  const audio = style.audio || {};
  const dur = style.analysisWindow || style.meta?.duration || 0;

  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const peakGaps = median((audio.peaks || []).slice(1).map((t, i) => t - audio.peaks[i]));
  const shot = cuts.medianGap ?? peakGaps ?? clamp(dur / 14, 3, 10);
  const accentEvery = clamp(
    Math.round((peakGaps ?? shot) * 10) / 10,
    1.2,
    8,
  );
  // in a collage piece the *graphics* change far more often than the camera cuts,
  // so the rhythm is the tighter of the two signals
  const rhythm = Math.min(shot, accentEvery * 3);
  const density = rhythm < 3.6 || cuts.perMinute > 26 ? 'rich' : rhythm > 8 || cuts.perMinute < 9 ? 'sparse' : 'balanced';
  const energy = clamp01(
    0.45 * (motion.level || 0) +
      0.3 * Math.min(1, (cuts.perMinute || 0) / 30) +
      0.25 * Math.min(1, (audio.dynamicRange || 0) / 18),
  );
  const beatLen = clamp(rhythm * (density === 'rich' ? 1.1 : 1.3), 3.4, 11);
  const rows = picture.rows || {};
  const cols = picture.cols || {};

  const derived = {
    density,
    energy: Math.round(energy * 100) / 100,
    beatLen: Math.round(beatLen * 10) / 10,
    shot: Math.round(shot * 10) / 10,
    rhythm: Math.round(rhythm * 100) / 100,
    accentEvery,
    anchor:
      (rows.top || 0) > (rows.bottom || 0) + 15
        ? 'top-first'
        : (rows.bottom || 0) > (rows.top || 0) + 15
          ? 'bottom-first'
          : 'both',
    sideBias:
      (cols.left || 0) > (cols.right || 0) + 15
        ? 'left'
        : (cols.right || 0) > (cols.left || 0) + 15
          ? 'right'
          : 'mixed',
    centreBias: (rows.middle || 0) > 45 ? 'busy-centre' : 'free-centre',
    transitions: energy > 0.66 ? 'strong' : energy > 0.33 ? 'medium' : 'subtle',
    paletteMode: picture.look === 'motion-graphics' ? 'match' : 'brand',
    look: picture.look || 'unknown',
    hasBeatGrid: (audio.peaks || []).length >= 6,
    beatGrid: (audio.peaks || []).slice(0, 60),
    cutTimes: (cuts.times || []).slice(0, 120),
    motionPeaks: (motion.peaks || []).slice(0, 60),
    fps: style.meta?.fps || 30,
    ratio: style.meta?.ratio || null,
    palette: picture.palette || null,
  };
  derived.summary = summarise(style, derived);
  return derived;
}

function summarise(style, d) {
  const m = style.meta || {};
  const p = style.picture || {};
  const c = style.cuts || {};
  const mo = style.motion || {};
  const lines = [];
  if (m.duration) lines.push(`مدت ${Math.round(m.duration)} ثانیه، ${m.ratio || '?'}، ${m.fps} فریم`);
  if (c.count)
    lines.push(
      `${c.count} ${c.kind === 'soft' ? 'تغییر تصویر' : 'برش'} ⇒ هر ${(c.medianGap ?? 0).toFixed(1)} ثانیه یک صحنه (نرخ ${d.density})`,
    );
  if (mo.samples) lines.push(`تحرک تصویر ${Math.round((mo.level || 0) * 100)}٪ و ${mo.stillShare ?? 0}٪ فریم‌ها ثابت`);
  if (p.palette?.accent) lines.push(`پالت: سطح ${p.palette.surface}، جوهر ${p.palette.ink}، تأکید ${p.palette.accent}`);
  if (p.look)
    lines.push(
      `نگاه ${
        p.look === 'motion-graphics' ? 'موشن‌گرافیک' : p.look === 'live-action' ? 'تصویر واقعی' : 'ترکیبی'
      } — گرافیک ${p.graphicsShare ?? 0}٪ سطح تصویر`,
    );
  if (p.rows)
    lines.push(
      `جای گرافیک‌ها: بالا ${p.rows.top}٪، وسط ${p.rows.middle}٪، پایین ${p.rows.bottom}٪ — چپ ${p.cols?.left}٪، راست ${p.cols?.right}٪`,
    );
  if (typeof style.audio?.lufs === 'number')
    lines.push(`صدا ${style.audio.lufs} LUFS با ${style.audio.peaks?.length ?? 0} اوج`);
  lines.push(`نتیجه: ضرب ${d.beatLen} ثانیه، ترنزیشن ${d.transitions}، لنگر ${d.anchor}`);
  return lines;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
