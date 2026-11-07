/* brand.mjs — the studio's brand token system: one resolved token set per job.

 Before this module the house look lived as constants scattered over three files
 (compose.mjs, motion-project.mjs, backgrounds.mjs), so every film had the same
 personality no matter whose brand it carried. Now the look is data:

   workspace/.studio/brand.json   studio-wide tokens (the "frame.md" of this repo)
   job.config.brand               per-job override the wizard writes
   style.json (reference)         a measured palette, applied when paletteMode='match'

 resolveBrand() merges them in that order of precedence — reference over job over
 studio over house — and always returns one complete token set, so a malformed
 file degrades to the house look instead of failing the job.

 The six motion personalities are the brand→motion presets of video-shotcraft
 (an energy axis and a tone axis, each preset a table of concrete numbers), and
 the timing numbers follow HyperFrames' motion grammar: exits shorter than
 entrances, spring overshoot by character, one token set governing all motion.

 Nothing here touches the network; the whole module is pure except readStudioBrand.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BRAND_FILE } from './paths.mjs';
import { templateById } from './templates.mjs';

/** The house look — the values the studio shipped with, in one place. */
export const HOUSE = {
  preset: 'house',
  palette: {
    ground: '#1d1d1d',
    groundDeep: '#181818',
    surface: '#232323',
    ink: '#ffffff',
    accent: '#55e6a5',
    accentDeep: '#2fb87e',
    micro: '#e8fe51',
    warm: '#f08f74',
  },
  type: { fa: 'Vazirmatn', mono: 'JetBrains Mono' },
  motion: {
    energy: 0.45,
    durationScale: 1,
    exitScale: 1,
    overshoot: 1,
    staggerMs: 55,
    transitionBias: 'medium',
    holdMult: 1,
    glow: 'normal',
  },
};

/**
 * Six personalities, each a table of numbers (never adjectives):
 * energy drives transition strength, durationScale scales entrances,
 * exitScale keeps exits the shortest move in the film, overshoot scales the
 * back-ease kicks, holdMult stretches how long a card stays readable.
 */
export const PERSONALITIES = [
  {
    id: 'professional-trust',
    fa: 'حرفه‌ای و مطمئن',
    hint: 'ورودهای تمیز بدون فنر، خروج‌های کوتاه، گلو محتاط — برای خدمات، فین‌تک، B2B',
    energy: 0.35, durationScale: 0.92, exitScale: 0.85, overshoot: 0.6, staggerMs: 50,
    transitionBias: 'subtle', holdMult: 1.15, glow: 'restrained',
  },
  {
    id: 'refined-premium',
    fa: 'شیک و لاکچری',
    hint: 'حرکت‌های بلند و مکث‌دار، استگرger گسترده، حداقل نور — برای لوکس، مد، املاک',
    energy: 0.3, durationScale: 1.35, exitScale: 1.05, overshoot: 0.45, staggerMs: 85,
    transitionBias: 'subtle', holdMult: 1.3, glow: 'restrained',
  },
  {
    id: 'vibrant-bold',
    fa: 'پرانرژی و جسور',
    hint: 'کوتاه و با ضربه، اورشوت کامل، کوبش‌های روی بیت — برای ورزش، گیمینگ، لانچ',
    energy: 0.75, durationScale: 0.75, exitScale: 0.7, overshoot: 1.5, staggerMs: 40,
    transitionBias: 'strong', holdMult: 0.9, glow: 'bold',
  },
  {
    id: 'lively-joyful',
    fa: 'شاد و سرزنده',
    hint: 'فنرهای بازیگوش روی جای‌گیری، ورودهای پلاک — برای خوراک، کودک، فروش',
    energy: 0.65, durationScale: 0.95, exitScale: 0.85, overshoot: 1.2, staggerMs: 55,
    transitionBias: 'medium', holdMult: 1, glow: 'normal',
  },
  {
    id: 'calm-caring',
    fa: 'آرام و دلسوز',
    hint: 'بلندترین ورودها، بلندترین مکث‌ها، بدون کوبش — برای سلامت، آموزش، خیریه',
    energy: 0.25, durationScale: 1.2, exitScale: 1.1, overshoot: 0.35, staggerMs: 95,
    transitionBias: 'subtle', holdMult: 1.35, glow: 'restrained',
  },
  {
    id: 'friendly',
    fa: 'صمیمی و خودی',
    hint: 'حد میانهٔ همه‌چیز با کمی فنر — برای استارتاپ، پادکست، شخصی',
    energy: 0.5, durationScale: 0.95, exitScale: 0.9, overshoot: 1.05, staggerMs: 60,
    transitionBias: 'medium', holdMult: 1.05, glow: 'normal',
  },
];

export const PERSONALITY_IDS = ['house', ...PERSONALITIES.map((p) => p.id)];
export const PERSONALITY_BY_ID = new Map(PERSONALITIES.map((p) => [p.id, p]));

/**
 * What this film must never become — the HyperFrames "BANNED defaults" doctrine,
 * translated to this studio's Persian marketing films. The list is a floor:
 * a job or the studio file may append, never shrink.
 */
export const BANNED_DEFAULTS = [
  'همه‌چیز وسط کادر',
  'همه‌چیز هم‌زمان فید شود',
  'متن در حال حرکت در حین خواندن',
  'سه کارت هم‌شکل در یک ردیف',
  'گلو و نئون بی‌دلیل',
  'لوگوی گوشه‌نشین بی‌کار',
  'ترنزیشن متفاوت برای هر بیت',
];

const HEX = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS = ['ground', 'groundDeep', 'surface', 'ink', 'accent', 'accentDeep', 'micro', 'warm'];

/** Problems in a brand object; anything listed as error is dropped before use. */
export function validateBrand(b) {
  const problems = [];
  if (!b || typeof b !== 'object') return problems;
  if (b.preset !== undefined && !PERSONALITY_IDS.includes(b.preset))
    problems.push(`پریست «${b.preset}» شناخته‌شده نیست (${PERSONALITY_IDS.join('، ')})`);
  for (const [k, v] of Object.entries(b.palette || {})) {
    if (!COLOR_KEYS.includes(k)) problems.push(`رنگ ناشناخته: ${k}`);
    else if (!HEX.test(v)) problems.push(`${k} باید hex شش‌رقمی باشد، نه «${v}»`);
  }
  const m = b.motion || {};
  for (const [k, v] of Object.entries(m)) {
    if (!HOUSE.motion[k]) problems.push(`کلید موشن ناشناخته: ${k}`);
    else if (typeof v !== 'number' || !Number.isFinite(v)) problems.push(`موشن.${k} باید عدد باشد`);
  }
  return problems;
}

const clamp = (v, a, b2) => Math.min(b2, Math.max(a, v));

/** Input from the wizard/panel is a small, forgiving shape. */
export function sanitizeBrandInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const problems = validateBrand(raw);
  if (problems.some((p) => p.includes('شناخته‌شده نیست') || p.includes('باید hex'))) {
    const ok = { palette: {} };
    if (PERSONALITY_IDS.includes(raw.preset)) ok.preset = raw.preset;
    for (const k of COLOR_KEYS) if (HEX.test(raw.palette?.[k])) ok.palette[k] = raw.palette[k];
    if (Number.isFinite(raw.motion?.energy)) ok.motion = { energy: clamp(raw.motion.energy, 0, 1) };
    // an input whose every field failed validation contributes nothing at all
    if (!ok.preset && !ok.motion && !Object.keys(ok.palette).length) return null;
    return ok;
  }
  return raw;
}

/**
 * One resolved token set for one job.
 * @param o.jobConfig     the job's `config` object (reads `.brand`)
 * @param o.studioBrand   the parsed workspace/.studio/brand.json (or null)
 * @param o.style         reference style.json (or null)
 * @param o.template      a visual template id from lib/templates.mjs (or null)
 */
export function resolveBrand({ jobConfig = null, studioBrand = null, style = null, template = null } = {}) {
  const source = [];
  let out = structuredClone(HOUSE);
  out.banned = [...BANNED_DEFAULTS];

  const tpl = templateById(template);
  if (tpl) {
    // the template paints first — studio and the job may still refine its colours
    source.push('template');
    out = mergeBrand(out, tpl.brand);
    out.banned.push(...(tpl.banned || []));
  }
  const studio = sanitizeBrandInput(studioBrand);
  if (studio && Object.keys(studio).length) {
    source.push('studio');
    out = mergeBrand(out, studio);
  }
  const job = sanitizeBrandInput(jobConfig?.brand);
  if (job && Object.keys(job).length) {
    source.push('job');
    out = mergeBrand(out, job);
  }

  // a motion-graphics reference carries a real palette — apply it, don't guess
  const pal = style?.picture?.palette;
  if (style && style.derived?.paletteMode === 'match' && pal?.accent && pal?.ink) {
    source.push('reference');
    out.palette.accent = pal.accent;
    out.palette.ink = pal.ink;
    if (pal.surface && HEX.test(pal.surface) && luminance(pal.surface) < 0.32) out.palette.ground = pal.surface;
  }

  const presetId = out.preset && out.preset !== 'house' ? out.preset : null;
  const preset = presetId ? PERSONALITY_BY_ID.get(presetId) : null;
  if (preset) {
    // preset numbers land under studio/job colours — a preset changes motion,
    // never the palette the brand owns (colour and type are brand truth)
    const templateMotion = tpl && tpl.brand?.motion ? tpl.brand.motion : null;
    out.motion = { ...out.motion, ...pick(preset, Object.keys(HOUSE.motion)), ...(templateMotion || {}) };
  }
  if (Number.isFinite(out.motion?.energy)) out.motion.energy = clamp(out.motion.energy, 0, 1);
  out.preset = presetId || 'house';
  out.presetFa = preset?.fa || 'سلیقهٔ خانه';
  out.presetHint = preset?.hint || 'اعداد خانهٔ استودیو، بدون شخصیت انتخاب‌شده';
  out.source = source.join('+') || 'house';
  out.banned = [...new Set([...BANNED_DEFAULTS, ...(out.banned || [])])];
  return out;
}

function mergeBrand(base, patch) {
  const next = structuredClone(base);
  if (patch.preset) next.preset = patch.preset;
  for (const k of COLOR_KEYS) if (HEX.test(patch.palette?.[k])) next.palette[k] = patch.palette[k];
  for (const k of Object.keys(HOUSE.type)) if (patch.type?.[k]) next.type[k] = String(patch.type[k]).slice(0, 40);
  if (patch.motion) for (const k of Object.keys(HOUSE.motion)) if (Number.isFinite(patch.motion[k])) next.motion[k] = patch.motion[k];
  if (Array.isArray(patch.banned)) next.banned = [...(next.banned || []), ...patch.banned.map(String).slice(0, 12)];
  return next;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Relative luminance 0..1 — dark surfaces only become a standalone ground. */
export function luminance(hex) {
  const n = hexToInt(hex);
  if (n === null) return 0;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexToInt(hex) {
  if (!HEX.test(hex)) return null;
  return parseInt(hex.slice(1), 16);
}

/** `#55e6a5` + alpha → `rgba(85,230,165,a)` for the generated CSS. */
export function rgba(hex, a) {
  const n = hexToInt(hex);
  if (n === null) return `rgba(85,230,165,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** The muted-text colour must follow the ground: white muted on a light ground
 *  is literally invisible (and fails contrast 1:1), so light grounds mute the
 *  ink instead. */
export function mutedInk(palette) {
  const p = palette || HOUSE.palette;
  return luminance(p.ground) > 0.5 ? rgba(p.ink, 0.55) : 'rgba(255,255,255,0.55)';
}

/** Tokens merged over the house defaults, for readers that get no resolved brand. */
export function brandTokens(brand) {
  const b = brand && typeof brand === 'object' ? brand : {};
  return {
    ...structuredClone(HOUSE),
    ...b,
    palette: { ...HOUSE.palette, ...(b.palette || {}) },
    type: { ...HOUSE.type, ...(b.type || {}) },
    motion: { ...HOUSE.motion, ...(b.motion || {}) },
  };
}

/** The studio-wide brand file — a missing or broken file is the house look. */
export function readStudioBrand() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BRAND_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStudioBrand(patch) {
  const problems = validateBrand(patch);
  if (problems.length) {
    const err = new Error(problems.join('؛ '));
    err.problems = problems;
    throw err;
  }
  const current = readStudioBrand() || {};
  const next = mergeBrand(brandTokens(current), patch);
  const clean = {
    name: String(patch.name || current.name || '').slice(0, 60),
    preset: next.preset,
    palette: next.palette,
    type: next.type,
    motion: next.motion,
    banned: next.banned,
  };
  fs.mkdirSync(path.dirname(BRAND_FILE), { recursive: true });
  fs.writeFileSync(BRAND_FILE, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  return clean;
}

/** One honest Persian line for the log. */
export function describeBrand(brand) {
  const b = brandTokens(brand);
  const from = brand?.source ? ` (منبع: ${brand.source})` : '';
  return `شخصیت «${b.presetFa || b.preset}» — اکسنت ${b.palette.accent}، انرژی ${b.motion.energy}، ترنزیشن ${b.motion.transitionBias}${from}`;
}
