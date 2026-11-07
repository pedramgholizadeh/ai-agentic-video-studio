#!/usr/bin/env node
/**
 * Build the studio's sound-effect kit with ffmpeg and nothing else.
 *
 * No sample library is downloaded and no file is copied from one: every cue the
 * beat planner can pick is synthesised here from noise and tone, so the kit
 * carries no third-party licence and works on a machine with no network. The
 * planner measures each file afterwards (accent time, loudness), so a recipe
 * only has to be *shaped* right — the level is corrected downstream.
 *
 *   node scripts/build-sfx.mjs          # write the files that are missing
 *   node scripts/build-sfx.mjs --force  # rebuild every one
 *   node scripts/build-sfx.mjs --role cardIn --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SFX_DIR } from '../lib/paths.mjs';
import { CUE_MAP } from '../lib/sfx.mjs';

/* One entry per kit id (`category/name`), so `npm run sfx` fills exactly the
 * names CUE_MAP already prefers. `src` is a lavfi source, `af` the shaping
 * chain, `t` the length in seconds. */
const SINE = (expr, t) => `aevalsrc=${expr}:d=${t}:s=48000`;

/* Each cue is scaled to this peak after synthesis, so the kit is one consistent
 * level rather than 33 accidents. -6 dBFS leaves the mix headroom the limiter
 * in lib/sfx.mjs expects. */
const TARGET_PEAK = -6;

/* Filter chains stay inside highpass/lowpass territory: ffmpeg's `bandpass` is a
 * narrow biquad that eats 40 dB and smears the transient, which is exactly the
 * part a UI click is made of. Level is corrected by the second pass, so no
 * recipe carries a guessed `volume=`. */
export const RECIPES = {
  // air and movement — card entrances, scene changes
  'transition/whoosh-fast': { t: 0.5, src: 'anoisesrc=color=pink:amplitude=0.7:duration=0.5:seed=11', af: 'highpass=f=180,lowpass=f=2600,afade=t=in:st=0:d=0.22,afade=t=out:st=0.26:d=0.24' },
  'transition/sweep-fast': { t: 0.45, src: SINE('0.4*sin(2*PI*(400*t+3000*t*t))', 0.45), af: 'lowpass=f=4200,afade=t=in:st=0:d=0.05,afade=t=out:st=0.28:d=0.17' },
  'transition/transition-soft': { t: 0.7, src: 'anoisesrc=color=brown:amplitude=0.8:duration=0.7:seed=5', af: 'lowpass=f=700,afade=t=in:st=0:d=0.3,afade=t=out:st=0.38:d=0.32' },
  'transition/swoosh-quick': { t: 0.32, src: 'anoisesrc=color=pink:amplitude=0.7:duration=0.32:seed=23', af: 'highpass=f=900,lowpass=f=5000,afade=t=in:st=0:d=0.1,afade=t=out:st=0.16:d=0.16' },
  'transition/air-woosh-quick': { t: 0.45, src: 'anoisesrc=color=pink:amplitude=0.7:duration=0.45:seed=41', af: 'highpass=f=400,lowpass=f=3800,tremolo=f=25:d=0.4,afade=t=in:st=0:d=0.14,afade=t=out:st=0.26:d=0.19' },
  'transition/warp-slide': { t: 0.5, src: SINE('0.4*sin(2*PI*(2000*t-2600*t*t))', 0.5), af: 'vibrato=f=9:d=0.6,lowpass=f=3000,afade=t=out:st=0.34:d=0.16' },

  // hard, short hits — cards landing
  'glass/glass-hit-cine': { t: 0.45, src: SINE('0.35*exp(-9*t)*(sin(2*PI*2700*t)+0.6*sin(2*PI*4100*t)+0.4*sin(2*PI*6300*t))+0.25*exp(-90*t)*sin(2*PI*800*t)', 0.45), af: 'aecho=0.6:0.85:12|23:0.45|0.22' },
  'impact/hit-weak': { t: 0.3, src: SINE('0.55*exp(-16*t)*sin(2*PI*(110*t-60*t*t))+0.15*exp(-120*t)*sin(2*PI*2400*t)', 0.3), af: 'lowpass=f=900' },
  'impact/bass-hit-short': { t: 0.4, src: SINE('0.6*exp(-10*t)*sin(2*PI*(85*t-55*t*t))', 0.4), af: 'lowpass=f=220' },
  'impact/hit-fast-exciting': { t: 0.28, src: 'anoisesrc=color=pink:amplitude=0.8:duration=0.28:seed=7', af: 'highpass=f=200,lowpass=f=1800,afade=t=in:st=0:d=0.01,afade=t=out:st=0.04:d=0.24' },
  'impact/impact-zoom-quick': { t: 0.5, src: SINE('0.5*exp(-7*t)*sin(2*PI*(1200*t-1400*t*t))+0.2*exp(-14*t)*sin(2*PI*(70*t-20*t*t))', 0.5), af: 'lowpass=f=1600' },

  // interface taps, blips and confirmations
  'ui/pop': { t: 0.12, src: SINE('0.5*sin(2*PI*(500*t+1400*t*t))*exp(-14*t)', 0.12), af: 'highpass=f=500,lowpass=f=3000' },
  'ui/ui-message-pop': { t: 0.16, src: SINE('0.45*sin(2*PI*(700*t+2200*t*t))*exp(-11*t)', 0.16), af: 'highpass=f=700,lowpass=f=4000' },
  'ui/switch-tap': { t: 0.1, src: SINE('0.4*exp(-60*t)*sin(2*PI*1500*t)', 0.1), af: 'highpass=f=700' },
  'ui/ui-click-tone': { t: 0.12, src: SINE('0.35*exp(-40*t)*(sin(2*PI*1900*t)+0.5*sin(2*PI*2850*t))', 0.12), af: 'highpass=f=900' },
  'ui/ui-select-modern': { t: 0.3, src: SINE('0.35*sin(2*PI*1180*t)*exp(-13*t)+0.3*sin(2*PI*1760*t)*exp(-6*t)', 0.3), af: 'highpass=f=800,lowpass=f=3600,afade=t=out:st=0.2:d=0.1' },
  'ui/chime-crystal': { t: 1.4, src: SINE('0.3*exp(-3.2*t)*(sin(2*PI*1318*t)+0.7*sin(2*PI*1976*t)+0.4*sin(2*PI*2637*t)+0.25*sin(2*PI*3520*t))', 1.4), af: 'aecho=0.7:0.8:29|47:0.4|0.25' },
  'ui/ui-success-soft': { t: 0.9, src: SINE('0.35*exp(-5*t)*sin(2*PI*880*t)+0.3*exp(-5*t)*sin(2*PI*1174*t)', 0.9), af: 'lowpass=f=3500,aecho=0.5:0.7:26:0.3' },
  'ui/ui-notify-tech': { t: 0.5, src: SINE('0.35*sin(2*PI*1560*t)*exp(-3*t)+0.25*sin(2*PI*2340*t)*exp(-8*t)', 0.5), af: 'tremolo=f=12:d=0.75,highpass=f=1000,lowpass=f=3200' },

  // text appearing
  'text/typewriter-digital': { t: 1.4, src: SINE('0.5*((1+sin(2*PI*13*t))/2)^50*(sin(2*PI*2700*t)+0.6*sin(2*PI*4200*t))', 1.4), af: 'highpass=f=1000' },
  'text/write-fast': { t: 1.2, src: 'anoisesrc=color=pink:amplitude=0.7:duration=1.2:seed=31', af: 'tremolo=f=17:d=0.95,highpass=f=1200,lowpass=f=5200' },
  'text/keyboard': { t: 1.0, src: SINE('0.45*((1+sin(2*PI*9*t+2))/2)^60*(sin(2*PI*1600*t)+0.5*sin(2*PI*3300*t))', 1.0), af: 'highpass=f=600' },

  // counters and dials
  'counter/clock-tick-single': { t: 0.08, src: SINE('0.4*exp(-120*t)*sin(2*PI*2200*t)', 0.08), af: 'highpass=f=800' },
  'counter/clock-knob-spin': { t: 0.55, src: SINE('0.4*((1+sin(2*PI*24*t))/2)^40*(sin(2*PI*1400*t)+sin(2*PI*2100*t))', 0.55), af: 'highpass=f=700' },

  // data, processing, loading
  'data/data-scan': { t: 1.0, src: SINE('0.35*sin(2*PI*(600*t+900*t*t))', 1.0), af: 'tremolo=f=18:d=0.5,highpass=f=800,lowpass=f=3600' },
  'data/data-compute': { t: 0.8, src: SINE('0.4*((1+sin(2*PI*30*t))/2)^30*sin(2*PI*900*t)', 0.8), af: 'highpass=f=400' },
  'data/sweep-digital': { t: 0.7, src: SINE('0.35*sin(2*PI*(1800*t-1500*t*t))', 0.7), af: 'tremolo=f=40:d=0.6,highpass=f=700,lowpass=f=3800' },
  'data/power-up-electronic': { t: 1.3, src: SINE('0.3*sin(2*PI*(120*t+900*t*t))', 1.3), af: 'tremolo=f=8:d=0.4,afade=t=in:st=0:d=1.1,afade=t=out:st=1.15:d=0.15' },
  'data/data-load-os': { t: 0.9, src: SINE('0.3*exp(-4*t)*(sin(2*PI*1046*t)+sin(2*PI*1318*t)+sin(2*PI*1568*t))', 0.9), af: 'tremolo=f=6:d=0.6,lowpass=f=4000' },

  // liquids, for progress that feels physical
  'fluid/water-bubble': { t: 0.35, src: SINE('0.4*sin(2*PI*(1600*t-1400*t*t))*exp(-10*t)', 0.35), af: 'lowpass=f=3000' },
  'fluid/liquid-bubble': { t: 0.5, src: SINE('0.35*sin(2*PI*(900*t-1200*t*t))*exp(-6*t)', 0.5), af: 'aecho=0.6:0.7:40:0.4,lowpass=f=2600' },

  // the finishing flourish
  'light/sparkle-touch': { t: 0.9, src: SINE('0.3*(sin(2*PI*4200*t)+0.6*sin(2*PI*6100*t)+0.4*sin(2*PI*8700*t))*exp(-3*t)', 0.9), af: 'tremolo=f=22:d=0.9,aecho=0.5:0.7:18:0.3,highpass=f=2000,lowpass=f=9000' },

  // tension that grows
  'riser/riser-cine': { t: 2.6, src: 'anoisesrc=color=pink:amplitude=0.7:duration=2.6:seed=3', af: 'highpass=f=200,lowpass=f=3000,afade=t=in:st=0:d=2.3,afade=t=out:st=2.35:d=0.25' },
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const onlyRole = (() => {
  const i = args.indexOf('--role');
  return i >= 0 ? args[i + 1] : null;
})();

/** Every kit id the planner may ever ask for. */
function wantedIds() {
  const ids = new Set(Object.values(CUE_MAP).flat());
  if (onlyRole) {
    const role = (CUE_MAP[onlyRole] || []).slice(0, 1);
    if (!role.length) throw new Error(`unknown role "${onlyRole}" — see CUE_MAP in lib/sfx.mjs`);
    return new Set(role);
  }
  return ids;
}

function run(cmd, args) {
  const p = spawnSync(cmd, args, { encoding: 'utf8' });
  if (p.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${(p.stderr || '').trim() || `exited ${p.status}`}`);
  // ffmpeg talks on stderr — astats lands there, not on stdout.
  return `${p.stdout || ''}${p.stderr || ''}`;
}

/** Peak in dBFS of a rendered file, from astats. */
function peakDb(file) {
  const out = run('ffmpeg', ['-v', 'info', '-i', file, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-']);
  const m = out.match(/Peak level dB:\s*(-?[\d.]+)/);
  if (!m) throw new Error(`peak level unreadable in ${file}`);
  return Number(m[1]);
}

/**
 * Two passes, because a filter chain's output level is not what it looks like on
 * paper: synthesise, measure the real peak, then re-encode scaled to TARGET_PEAK.
 * Every cue then enters the mix at a predictable level and the planner's gain
 * maths has one less guess in it.
 */
function make(file, r, label) {
  const tmp = `${file}.raw.wav`;
  run('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', r.src,
    '-af', r.af,
    '-ac', '2', '-ar', '48000',
    '-t', String(r.t),
    tmp,
  ]);
  const peak = peakDb(tmp);
  if (!Number.isFinite(peak) || peak < -60) throw new Error(`${file}: recipe produced silence (peak ${peak} dBFS)`);
  const scale = Math.min(10 ** ((TARGET_PEAK - peak) / 20), 80);
  if (Math.abs(TARGET_PEAK - peak) > 24)
    console.warn(`  note: ${label} sits ${Math.round(TARGET_PEAK - peak)} dB under target before scaling`);
  run('ffmpeg', [
    '-v', 'error', '-y', '-i', tmp,
    '-af', `volume=${scale.toFixed(4)}`,
    '-ac', '2', '-ar', '48000',
    '-c:a', 'libmp3lame', '-q:a', '3',
    file,
  ]);
  fs.rmSync(tmp, { force: true });
  return { peak: Math.round(peak * 10) / 10, scale: Math.round(scale * 1000) / 1000 };
}

const wanted = [...wantedIds()];
const missingRecipe = wanted.filter((id) => !RECIPES[id]);
if (missingRecipe.length) {
  console.warn(`No recipe for ${missingRecipe.length} kit id(s) the planner references: ${missingRecipe.join(', ')}`);
}

let built = 0;
let skipped = 0;
for (const id of wanted) {
  const r = RECIPES[id];
  if (!r) continue;
  const file = path.join(SFX_DIR, `${id}.mp3`);
  if (fs.existsSync(file) && !force) {
    skipped++;
    continue;
  }
  if (dryRun) {
    console.log(`would write ${file}`);
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  make(file, r, id);
  built++;
}

/* The measured index is rebuilt lazily by lib/sfx.mjs, but doing it here means a
 * fresh checkout has audible sound design before the first job, not after it. */
if (!dryRun && built) {
  const { loadIndex } = await import('../lib/sfx.mjs');
  const { files } = await loadIndex({ refresh: true });
  console.log(`kit: ${files.length} cues measured in ${SFX_DIR}`);
}
console.log(`built ${built}, already present ${skipped}`);
