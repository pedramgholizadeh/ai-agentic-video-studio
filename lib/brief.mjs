/* brief.mjs — the director's brief: a purposeful reading of what the film is about.

 Before this module nothing in the pipeline interpreted the job: the SRT became
 beats by salience alone and `direction.text` was quoted verbatim into the
 handoff and then ignored. The `direction` stage now writes `brief.json` — the
 shotcraft-style intake where every row is a judgment plus its basis, and the
 HyperFrames rule that a film is planned against one provable sentence.

 Facts are sacred twice over here: `facts[]` is extracted from the transcript
 and the user's own direction, never invented, and `validateBrief()` rejects a
 brief (hand-edited or model-written) whose numbers do not appear in those
 texts. When the input leaves something genuinely unknowable — audience, goal —
 the field stays null with `inferred: true` instead of being filled with
 plausible-sounding noise.

 The LLM path (`providers.askBrief`) fills the same shape; this module is the
 deterministic floor every job falls back to.
 */

import { NUM_UNIT, LATIN_RUN, wordFrequency, signalsFor, salient } from './beats.mjs';

/** Named beat sequences a film is planned against (HyperFrames arcs + wshuyi shares). */
export const ARCS = {
  promo: { id: 'promo', fa: 'قلاب → محتوا → فرود', steps: ['hook', 'substance', 'landing'] },
  explainer: {
    id: 'explainer',
    fa: 'پرسش → شهود → گام‌به‌گام → جمع‌بندی',
    steps: ['hook', 'intuition', 'steps', 'recap'],
  },
};

/** Mood words the direction may carry, so the brief can name the film's energy. */
const MOOD_WORDS = [
  ['آرام', 'آرام و ملایم'], ['ملایم', 'آرام و ملایم'], ['آرامش', 'آرام و ملایم'],
  ['شاد', 'شاد و پرانرژی'], ['پرانرژی', 'شاد و پرانرژی'], ['هیجان', 'شاد و پرانرژی'],
  ['جدی', 'جدی و رسمی'], ['رسمی', 'جدی و رسمی'], ['حرفه‌ای', 'جدی و حرفه‌ای'],
  ['صمیمی', 'صمیمی و خودی'], ['خودی', 'صمیمی و خودی'], ['لاکچری', 'شیک و لاکچری'],
  ['لوکس', 'شیک و لاکچری'], ['تند', 'تیز و سریع'], ['سریع', 'تیز و سریع'],
];

const srtToText = (srt) =>
  String(srt || '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\d+\s*$/.test(l) && !l.includes('-->'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Persian/Arabic digits and separators to one comparable latin string. */
function normalize(s) {
  return String(s || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\u200c]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Facts = numbers with units + latin names, straight from the two allowed sources. */
export function extractFacts(srtText, directionText) {
  const seen = new Set();
  const facts = [];
  for (const [text, kind] of [[srtText, 'transcript'], [directionText, 'direction']]) {
    const clean = String(text || '');
    for (const m of clean.matchAll(new RegExp(NUM_UNIT.source, 'gi'))) {
      const key = `n:${m[1]}:${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ kind, type: 'number', text: `${m[1]} ${m[2]}`, value: m[1], unit: m[2] });
    }
    for (const m of clean.matchAll(LATIN_RUN)) {
      const run = m[1];
      if (run.length < 4 || seen.has(`l:${run}`)) continue;
      seen.add(`l:${run}`);
      facts.push({ kind, type: 'latin', text: run });
    }
  }
  return facts.slice(0, 14);
}

/** The things the user explicitly quoted — these must land on screen. */
export function extractMustShow(directionText) {
  const out = [];
  for (const m of String(directionText || '').matchAll(/«([^»]{2,40})»|"([^"]{2,40})"/g)) {
    const phrase = (m[1] || m[2] || '').trim();
    if (phrase) out.push(phrase);
  }
  return [...new Set(out)].slice(0, 6);
}

function moodOf(directionText) {
  const clean = String(directionText || '');
  for (const [word, mood] of MOOD_WORDS) if (clean.includes(word)) return mood;
  return null;
}

function topicOf(sig, directionText, freq) {
  const firstLine = String(directionText || '')
    .split(/[.\n،؛]/)
    .map((s) => s.trim())
    .find((s) => s.length >= 8);
  if (firstLine && firstLine.length <= 90) return { topic: firstLine, inferred: false, source: 'direction' };
  const word = salient(sig);
  if (word) {
    const value = sig.value !== null ? ` (${sig.rawValue} ${sig.unit || ''})` : '';
    return { topic: `${word}${value}`.trim(), inferred: true, source: 'transcript' };
  }
  return { topic: null, inferred: true, source: null };
}

/**
 * The deterministic brief. `srtText` and `directionText` are the only sources;
 * everything the inputs cannot answer stays null and flagged.
 */
export function buildBrief({ srtText = '', directionText = '' } = {}) {
  const text = srtToText(srtText);
  const dir = String(directionText || '').trim();
  const windows = [];
  const words = text.split(' ');
  for (let i = 0; i < words.length; i += 8) windows.push({ text: words.slice(i, i + 8).join(' ') });
  const freq = wordFrequency(windows);
  const sig = signalsFor(text, [], freq);

  const { topic, inferred, source } = topicOf(sig, dir, freq);
  const explainer = sig.question || sig.ordered || words.length > 140;
  const arc = (explainer ? ARCS.explainer : ARCS.promo).id;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    topic,
    topicSource: source,
    thesis: null,
    audience: null,
    goal: null,
    mood: moodOf(dir),
    arc,
    arcFa: ARCS[arc].fa,
    arcInferred: true,
    facts: extractFacts(text, dir),
    mustShow: extractMustShow(dir),
    banned: [],
    basis: [text && 'srt', dir && 'direction'].filter(Boolean).join('+') || 'none',
    inferred: { topic: inferred, thesis: true, audience: true, goal: true },
    direction: dir.slice(0, 400),
  };
}

/**
 * The facts-sacred gate: every number in the brief must exist in the transcript
 * or the user's direction. A model or a hand may rewrite the prose — never the numbers.
 */
export function validateBrief(brief, srtText = '', directionText = '') {
  const problems = [];
  if (!brief || typeof brief !== 'object') return ['brief خالی است'];
  const haystack = normalize(`${srtToText(srtText)} ${directionText}`);
  for (const f of brief.facts || []) {
    if (f.type !== 'number') continue;
    if (!haystack.includes(normalize(f.value)))
      problems.push(`عدد «${f.value}» در ترنسکرپت/جهت‌دهی نیست — facts are sacred`);
  }
  for (const f of brief.facts || []) {
    if (f.type !== 'latin' || f.kind !== 'direction') continue;
    if (!haystack.includes(normalize(f.text)))
      problems.push(`نام لاتین «${f.text}» در متن‌های مجاز نیست`);
  }
  if (brief.topic && brief.topic.length > 120) problems.push('topic بیش از ۱۲۰ نویسه است');
  if (brief.arc && !ARCS[brief.arc]) problems.push(`قوس «${brief.arc}» شناخته‌شده نیست`);
  if (brief.basis === 'none') problems.push('نه ترنسکرپتی هست و نه جهت‌دهی — brief بی‌پایه است');
  return problems;
}

/** Merge a model-written brief over the statistical one, keeping only sane fields. */
export function mergeBrief(base, patch, srtText, directionText) {
  const next = structuredClone(base);
  if (!patch || typeof patch !== 'object') return next;
  for (const k of ['topic', 'thesis', 'audience', 'goal', 'mood']) {
    const v = patch[k];
    if (typeof v === 'string' && v.trim()) {
      next[k] = v.trim().slice(0, k === 'topic' ? 120 : 200);
      next.inferred[k] = false;
    }
  }
  if (ARCS[patch.arc]) {
    next.arc = patch.arc;
    next.arcFa = ARCS[patch.arc].fa;
    next.arcInferred = false;
  }
  if (Array.isArray(patch.mustShow))
    next.mustShow = [...new Set([...next.mustShow, ...patch.mustShow.map((s) => String(s).slice(0, 40))])].slice(0, 8);
  if (Array.isArray(patch.banned))
    next.banned = [...new Set([...next.banned, ...patch.banned.map((s) => String(s).slice(0, 60))])].slice(0, 10);
  next.basis += (next.basis ? '+' : '') + 'model';
  next.valid = validateBrief(next, srtText, directionText);
  return next;
}

/** Persian lines for the job log. */
export function describeBrief(brief) {
  if (!brief) return [];
  const lines = [];
  if (brief.topic) lines.push(`موضوع: ${brief.topic}${brief.topicSource ? ` (از ${brief.topicSource === 'direction' ? 'جهت‌دهی شما' : 'گفتار ویدیو'})` : ''}`);
  if (brief.arc) lines.push(`قوس روایت: ${brief.arcFa}`);
  if (brief.mood) lines.push(`حال‌وهوا: ${brief.mood}`);
  const nums = (brief.facts || []).filter((f) => f.type === 'number').map((f) => f.text);
  if (nums.length) lines.push(`${nums.length} عدد واقعی در متن: ${nums.slice(0, 4).join('، ')}${nums.length > 4 ? '…' : ''}`);
  if (brief.mustShow?.length) lines.push(`باید دیده شود: ${brief.mustShow.join('، ')}`);
  return lines;
}
