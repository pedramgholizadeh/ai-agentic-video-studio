import fs from 'node:fs';
import path from 'node:path';
import { SFX_DIR, SFX_INDEX } from './paths.mjs';
import { ffText, ffprobeJson, loudness, rmsCurve } from './ffmpeg.mjs';

/* sfx.mjs — the studio's own sound-effect engine.
 *
 * The kit lives in assets/sfx/<category>/<name>.mp3 and is synthesised on this
 * machine by scripts/build-sfx.mjs, so it carries no third-party licence. Three
 * rules make the difference between a sound design and silence:
 *
 * 1. A file's *accent* is measured, never assumed. These one-shots carry up to
 *    4 s of dead air in front of the hit, so a cue scheduled on the visual beat
 *    must be delayed by (beat − accent) or the frame lands on nothing.
 * 2. Gains come from measured loudness, not from a volume guess.
 * 3. The result is audited: at each hit, how much does the cue actually lift the
 *    bed above what is already there? A cue that lifts it by less than a few dB
 *    is not present, however correctly placed its clip is. Buried cues are
 *    raised and re-measured.
 */

const WINDOW = 0.06; // 60 ms rolling RMS window

/** Length, accent (loudest 60 ms) and integrated loudness of one file. */
async function measureOne(file) {
  const info = await ffprobeJson(file, 'format=duration');
  const duration = Number(info?.format?.duration) || 0;
  const rows = await rmsCurve(file, WINDOW);
  let peak = { t: 0, db: -Infinity };
  for (const r of rows) if (r.db > peak.db) peak = r;
  const loud = await loudness(file);
  return {
    duration: Math.round(duration * 1000) / 1000,
    onset: Math.round(peak.t * 1000) / 1000,
    accentDb: Number.isFinite(peak.db) ? Math.round(peak.db * 10) / 10 : null,
    lufs: loud.lufs === null ? null : Math.round(loud.lufs * 10) / 10,
    truePeak: loud.truePeak === null ? null : Math.round(loud.truePeak * 10) / 10,
  };
}

/** Every kit file id (`category/name`). */
export function kit() {
  if (!fs.existsSync(SFX_DIR)) return [];
  const rows = [];
  for (const cat of fs.readdirSync(SFX_DIR, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(SFX_DIR, cat.name)).filter((n) => n.endsWith('.mp3')).sort()) {
      const name = f.replace(/\.mp3$/, '');
      rows.push({ category: cat.name, name, id: `${cat.name}/${name}` });
    }
  }
  return rows;
}

/** Measured index, cached in assets/sfx-index.json and rebuilt when files change. */
export async function loadIndex({ refresh = false, onProgress } = {}) {
  const entries = kit();
  const cache = readJson(SFX_INDEX);
  const map = new Map((cache?.files || []).map((f) => [f.id, f]));
  let changed = false;
  let i = 0;
  for (const e of entries) {
    i++;
    const abs = path.join(SFX_DIR, e.category, `${e.name}.mp3`);
    const mtime = fs.statSync(abs).mtimeMs;
    const prev = map.get(e.id);
    if (!refresh && prev && prev.mtime === mtime) {
      delete prev.abs;
      continue;
    }
    const stats = await measureOne(abs);
    // Nothing absolute is stored: the index gets committed and shared, and a
    // machine's home directory is nobody's business.
    map.set(e.id, { ...e, file: `${e.category}/${e.name}.mp3`, mtime, ...stats });
    changed = true;
    if (onProgress) onProgress(i, entries.length, e.id);
  }
  const files = entries.map((e) => map.get(e.id)).filter(Boolean);
  if (changed || !cache) {
    fs.mkdirSync(path.dirname(SFX_INDEX), { recursive: true });
    fs.writeFileSync(
      SFX_INDEX,
      JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2) + '\n',
      'utf8',
    );
  }
  return { files, byId: new Map(files.map((f) => [f.id, f])) };
}

/** The same data straight from the cache — for the panel's kit browser. */
export function kitCatalog() {
  const cache = readJson(SFX_INDEX);
  const byId = new Map((cache?.files || []).map((f) => [f.id, f]));
  return kit().map((e) => {
    const m = byId.get(e.id) || {};
    return {
      ...e,
      duration: m.duration ?? null,
      onset: m.onset ?? null,
      lufs: m.lufs ?? null,
      measured: m.lufs !== undefined,
    };
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * What each motion action sounds like, ordered by preference. The planner takes
 * the first entry that exists in the kit, so this map doubles as documentation.
 */
export const CUE_MAP = {
  cardIn: ['transition/whoosh-fast', 'transition/sweep-fast', 'transition/transition-soft'],
  cardLand: ['glass/glass-hit-cine', 'impact/hit-weak', 'impact/bass-hit-short'],
  iconPop: ['ui/pop', 'ui/ui-message-pop', 'ui/switch-tap'],
  chipOn: ['ui/ui-click-tone', 'ui/ui-select-modern', 'ui/switch-tap'],
  typing: ['text/typewriter-digital', 'text/write-fast', 'text/keyboard'],
  count: ['counter/clock-tick-single', 'counter/clock-knob-spin'],
  scan: ['data/data-scan', 'data/data-compute', 'data/sweep-digital'],
  progress: ['fluid/water-bubble', 'fluid/liquid-bubble'],
  success: ['ui/chime-crystal', 'ui/ui-success-soft', 'light/sparkle-touch'],
  signature: ['light/sparkle-touch', 'ui/chime-crystal'],
  sceneChange: ['transition/swoosh-quick', 'transition/air-woosh-quick', 'transition/warp-slide'],
  emphasis: ['impact/hit-fast-exciting', 'impact/impact-zoom-quick'],
  riser: ['riser/riser-cine', 'data/power-up-electronic'],
  build: ['data/data-load-os', 'ui/ui-notify-tech'],
};

/**
 * How loud the design wants to be, and how much a hit must lift the bed to be
 * counted as present. `offset` is the starting target against the measured voice
 * loudness; `lift` is the audibility bar in dB of mix increase.
 */
export const SOUND_LEVELS = {
  gentle: { fa: 'ملایم', offset: -6, lift: 3, floor: -26, ceil: -13 },
  balanced: { fa: 'متعادل', offset: 0, lift: 4.5, floor: -22, ceil: -11 },
  bold: { fa: 'بلند و پرکوبش', offset: 5, lift: 6, floor: -19, ceil: -9 },
};

const ROLE_BOOST = { emphasis: 2, success: 1.5, cardLand: 1, scan: -1, typing: -3, progress: -3, chipOn: -1 };
const ABSOLUTE = {
  cardIn: -23, cardLand: -19, iconPop: -18, chipOn: -21, typing: -24, count: -22,
  scan: -22, progress: -25, success: -17, signature: -18, sceneChange: -25,
  emphasis: -16, riser: -23, build: -24,
};

function cueFor(role, index, byId) {
  const options = (CUE_MAP[role] || []).filter((id) => byId.has(id));
  if (!options.length) return null;
  return byId.get(options[index % options.length]);
}

/**
 * Cues for a beat sheet: `beats[].cues = [{role, at}]` where `at` is the video
 * second the sound should be *heard*. `start` is pushed back by the measured
 * accent so the hit lands exactly on `at`; two hits closer than `minGap` slide
 * apart because they would mask each other.
 */
export async function planCues(beats, { level = 'balanced', voiceLufs = null, maxPerBeat = 3, minGap = 0.55 } = {}) {
  const { byId } = await loadIndex();
  const band = SOUND_LEVELS[level] || SOUND_LEVELS.balanced;
  const counters = new Map();
  const cues = [];
  let lastAt = -Infinity;
  for (const beat of beats) {
    for (const c of beat.cues || []) {
      if (cues.filter((x) => x.beat === beat.n).length >= maxPerBeat) break;
      const at = round3(Math.max(c.at, lastAt + minGap));
      if (beat.duration && at > beat.start + beat.duration - 0.1) continue;
      const n = (counters.get(c.role) || 0) + 1;
      const file = cueFor(c.role, n - 1, byId);
      if (!file) continue;
      counters.set(c.role, n);
      lastAt = at;
      const start = Math.max(0, round3(at - (file.onset || 0)));
      const clip = round3(Math.min(file.duration, Math.max(0.12, file.duration - (file.onset || 0))));
      const target =
        voiceLufs !== null
          ? clamp(voiceLufs + band.offset + (ROLE_BOOST[c.role] || 0), band.floor, band.ceil)
          : (ABSOLUTE[c.role] ?? -22);
      // R128 needs ~400 ms to gate, so a short click has no integrated loudness;
      // its measured 60 ms peak is the next best estimate of what the ear gets.
      const basis = file.lufs !== null ? file.lufs : round1((file.accentDb ?? -20) - 6);
      const gain = round4(10 ** ((target - basis) / 20));
      cues.push({
        role: c.role,
        id: file.id,
        file: file.file,
        at,
        start,
        duration: clip,
        targetLufs: Math.round(target * 10) / 10,
        gain: clamp(gain, 0.02, 6),
        beat: beat.n,
      });
    }
  }
  return cues;
}

/**
 * One offline pass: every cue at its measured gain, delayed to its start, summed
 * *without* normalisation (amix otherwise divides by the input count and the
 * whole design vanishes) and limited. `voice` optional — with it the result is
 * the finished bed, without it the standalone SFX layer an editor can mix.
 */
export async function renderMix({ cues, out, duration, voice = null, voiceVolume = 1 }) {
  const seconds =
    Number(duration) > 0
      ? Number(duration)
      : Math.max(1, ...cues.map((c) => c.start + c.duration), voice ? 1 : 0);
  const args = ['-v', 'error', '-y'];
  const chains = [];
  const labels = [];
  if (voice) {
    args.push('-i', voice);
    chains.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${voiceVolume}[voice]`);
    labels.push('[voice]');
  }
  cues.forEach((c, i) => {
    args.push('-i', path.join(SFX_DIR, c.file));
    const ms = Math.round(c.start * 1000);
    chains.push(
      `[${voice ? i + 1 : i}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${c.gain},` +
        `adelay=${ms}:all=1[c${i}]`,
    );
    labels.push(`[c${i}]`);
  });
  if (!labels.length) throw new Error('renderMix: nothing to mix');
  const head =
    labels.length > 1
      ? `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0:dropout_transition=0`
      : `${labels.join('')}anull`;
  chains.push(`${head},apad,atrim=0:${seconds},alimiter=limit=0.89:level=false[aout]`);
  args.push(
    '-filter_complex', chains.join(';'),
    '-map', '[aout]', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le',
    '-t', String(seconds),
    out,
  );
  await ffText(args);
  return out;
}

/** Loudest window level at `t` from a pre-read RMS curve. */
function levelAt(rows, t, span = 0.5, step = WINDOW) {
  let best = -Infinity;
  for (let x = t; x <= t + span; x += step) {
    const i = rows.findIndex((r) => r.t >= x - 1e-6);
    if (i >= 0) best = Math.max(best, rows[i].db);
  }
  return Number.isFinite(best) ? best : -75;
}

/** Mix lift in dB when a cue at level `c` joins a bed at level `b`. */
const liftDb = (b, c) => 10 * Math.log10(1 + 10 ** ((c - b) / 10));

/**
 * Audit: for every cue, how much does it lift the bed at its own timestamp,
 * measured against the voice alone (or against silence when there is none)?
 * A cue under the band's `lift` bar — or under -32 dBFS in an empty bed — is
 * reported buried, whatever its volume said.
 */
export async function auditCues({ sfxFile, cues, voiceFile = null, level = 'balanced' }) {
  const band = SOUND_LEVELS[level] || SOUND_LEVELS.balanced;
  const sfxRows = await rmsCurve(sfxFile, WINDOW);
  const voiceRows = voiceFile ? await rmsCurve(voiceFile, WINDOW) : [];
  return cues.map((c) => {
    const hit = levelAt(sfxRows, c.at, Math.min(0.5, c.duration || 0.3));
    const bed = voiceRows.length ? levelAt(voiceRows, c.at, 0.08) : -75;
    const lift = Math.round(liftDb(bed, hit) * 10) / 10;
    return {
      ...c,
      hitDb: Math.round(hit * 10) / 10,
      bedDb: Math.round(bed * 10) / 10,
      lift,
      needed: band.lift,
      audible: lift >= band.lift && (voiceRows.length || hit >= -32),
    };
  });
}

/**
 * Render, audit, correct, render again. A buried cue is raised by the missing
 * decibels (bounded), because the sound design has to be a measured fact rather
 * than a table of optimistic volumes. Returns the final cues plus their audit.
 */
export async function mixAndVerify({
  cues,
  sfxOut,
  bedOut = null,
  duration,
  voiceFile = null,
  voiceVolume = 1,
  level = 'balanced',
  passes = 2,
  maxLift = 12,
  onPass,
}) {
  let working = cues.map((c) => ({ ...c }));
  let audit = [];
  for (let pass = 1; pass <= passes; pass++) {
    await renderMix({ cues: working, out: sfxOut, duration });
    audit = await auditCues({ sfxFile: sfxOut, cues: working, voiceFile, level });
    const buried = audit.filter((c) => !c.audible);
    if (onPass) await onPass(pass, audit, buried);
    if (!buried.length || pass === passes) break;
    working = working.map((c) => {
      const m = audit.find((x) => x.role === c.role && x.at === c.at);
      if (!m || m.audible) return c;
      // the cue must sit (lift bar) dB above the bed, so raise it by the shortfall
      const want = m.bedDb + 10 * Math.log10(10 ** (m.needed / 10) - 1);
      const lift = clamp(Math.max(m.needed - m.lift, want - m.hitDb), 0, maxLift);
      return { ...c, gain: round4(clamp(c.gain * 10 ** (lift / 20), 0.02, 14)), liftDb: round3(lift) };
    });
  }
  if (bedOut) await renderMix({ cues: working, out: bedOut, duration, voice: voiceFile, voiceVolume });
  return { cues: working, audit, sfxOut, bedOut };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;
