/* beats.mjs — the motion beat sheet.

 The SRT is the *clock*, not the script. Caption cards are grouped into spans and
 every span becomes one or two graphic beats: the copy is the salient material
 inside it (a number and its unit, a tool name, the one word the voice stressed,
 a real enumeration) — never the sentence itself, because the viewer is already
 hearing the sentence under the graphics.

 Everything the reference analysis knows is used here: how long a beat holds
 (`beatLen`), how many per minute (`density`), which screen zones the reference
 fills, how strong the transitions are (`energy`), and where its audio accents
 sit so a card can land on a real accent instead of an arbitrary frame.

 Output shape is exactly what `sfx.planCues()` consumes, so the sound stage needs
 no adapter: `beats[].cues = [{role, at}]`.
 */

import { DENSITY, RECIPES, RECIPE_BY_ID, transitionsFor, zonesFor, pickZone } from './motions.mjs';
import { safeFor } from './safe.mjs';
import { templateById } from './templates.mjs';
import { pickIcon, resolveIcon } from './icons.mjs';

/** Preference order when two recipes score the same. */
const PRIORITY = ['stat', 'terminal', 'steps', 'compare', 'meter', 'scan', 'waveform', 'badge', 'question', 'tags', 'brand', 'keyword', 'quote'];

/** Neutral icon per recipe when the words match no tag. */
const ICON_FOR = {
  keyword: 'animation', stat: 'trending_up', terminal: 'terminal', steps: 'checklist',
  compare: 'expand', meter: 'speed', waveform: 'graphic_eq', badge: 'verified',
  question: 'all_inclusive', brand: 'brands', tags: 'touch_app', scan: 'neurology',
  quote: 'subtitles',
};

/**
 * Function words and the colloquial verb forms an ASR transcript is full of.
 * Nothing here is content; a headline made of them is noise over the footage.
 */
const STOP = new Set(
  `به از که این آن را با و یا در برای است هست می ی یک من تو شما ما ایشان خود هر چند اما ولی اگر هنگام وقتی بعد قبل تا حتی هم نیز بود باشد شد شه
دوشده شده شود میشه میشدم بشه خواستم می‌خوام بخوام خوای می‌تونم تونه می‌تونه میتونه باید لازمه لازم دارم دارد داریم دارید داشتم دارند دارن داره داشتی
کنه کنن کنی کنید کرد کردم کردی کردید کردیم کردن بکن بریم بره بینیم ببینیم بگم بگه بگی گفت گفتم گویا مثل نوع چیز خیلی بیشتر کمتر همه هیچ کسی کسایی رو
همون همين اینجا جایی الان حالا سپس تنها فقط اینه اونم اینم هستم هستیم هستید نیس نیست نبود میان وسط بین روی زیر چون اگه گاه ضمن regarding توجه مجبوره
اینقدر اونقدر جوری طوری انگار معلومه مشخصه خب آره بله همونه کلا فعلا واقعا درمورد همچنین بعلاوه ضمنا داشه شد انجام توسط خواهیم خواهد بالا احتمالا حتما
تقریبا کاملا قطعا مثلا بلکه لیکن آقا میجده الانش بخواد بخواید بخوادش گذاشتم گذاشتیم گذاشت گذاشتن میخواد می‌خواد نمیخواد کلها کجاها کجا یعنی
چیکار چیزای اینا اونا هون الکی همین بهتر بدترین بذارم بذار بذاریم بذارید میذارم بالاش خوردش بگیرم بگیره برمیگرده برمی‌گرده اتفاق مشخص بخوای بخواید
`.split(/\s+/).filter(Boolean),
);

/** A word that ends in a derivational suffix is almost always a real noun. */
const NOUN_SUFFIX =
  /(سازی|پذیری|شوندگی|گر|گری|مند|انه|وار|کار|نامه|شناس|سنجی|دهی|بند|ستان|ساز|پرداز|آوری|رسانی|گاه|ها|های)$/;

/** `می…` words that are nouns, not verbs — the two prefixes are otherwise verbal. */
const ME_NOUNS = new Set(['میزان', 'میوه', 'میلاد', 'میز', 'میم']);

export const NUM_UNIT =
  /((?:[۰-۹٠-٩0-9]+)(?:[.,][۰-۹٠-٩0-9]+)?)\s*(٪|درصد|ثانیه|دقیقه|ساعت|روز|هفته|ماه|سال|نفر|بار|مرتبه|هزار|میلیون|میلیارد|گیگ|مگ|GB|MB|TB|fps|کادر|تومان|ریال|دلار|یورو)/i;
export const LATIN_RUN =
  /((?:https?:\/\/|www\.)[^\s،]+|[a-zA-Z][a-zA-Z0-9+._-]{2,}(?:\/[a-zA-Z0-9._-]+)*)/g;
/** Words worth typing into a terminal card; ASR latin noise is not. */
const TECH =
  /(ffmpeg|ffprobe|hyperframes|hypermotion|gsap|node|npm|npx|python|docker|git|api|sdk|json|mp4|webm|mov|mkv|srt|png|jpg|jpeg|svg|html|css|javascript|typescript|mp3|wav|cpu|gpu|ram|url|cli|claude|gpt|llm|ai|fps|vazirmatn|uniscribe)/i;

/** Punctuation, ZWNJ and harakat stripped for matching only — display keeps the raw token. */
function bare(w) {
  return String(w)
    .replace(/[.،؛:?!؟"'()\[\]{}«»…]+/g, '')
    .replace(/[\u200c\u200e\u200f\u064B-\u0652\u0670]/g, '')
    .trim();
}

/**
 * ASR glues a spoken adverb onto the next word («کاملاًرندر»). The adverb is
 * filler; the noun after it is the card.
 */
const GLUED = /^(کاملا|حتما|احتمالا|تقریبا|کلا|بلکه|لیکن|فعلا|قطعا)(.{3,})$/;
function unscheme(w) {
  const m = GLUED.exec(w);
  return m ? m[2] : w;
}

/**
 * Colloquial Persian hangs a clitic on the end of a noun («ویدیوه»، «مدلی»).
 * If the shorter form is itself used in this film, it is the real word.
 */
function lighten(w, freq) {
  if (w.length < 5) return w;
  // «ثانیهی», «زمینهی»: the ezafe ی is a connector glued to a ه-final noun
  if (/هی$/.test(w)) return w.slice(0, -1);
  for (const cut of ['ه', 'ی', 'س']) {
    if (w.endsWith(cut)) {
      const stem = w.slice(0, -1);
      if ((freq.get(stem) || 0) >= 2) return stem;
    }
  }
  if (/های$/.test(w) && (freq.get(w.slice(0, -3)) || 0) >= 2) return w.slice(0, -3);
  // «ایدیتش»: an object clitic on a stem the film already uses on its own
  if (w.endsWith('ش') && (freq.get(w.slice(0, -1)) || 0) >= 1) return w.slice(0, -1);
  return w;
}

/** Word count over the whole film — the topical words rise to the top. */
export function wordFrequency(cards) {
  const freq = new Map();
  for (const c of cards) {
    for (const raw of String(c.text || '').split(/\s+/)) {
      const w = unscheme(bare(raw));
      if (w.length < 3 || STOP.has(w) || /^[۰-۹0-9]/.test(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return freq;
}

/**
 * Is this token fit to be the word a graphic card carries? Returns null for
 * function words, verbal `می…` forms, bare numbers and ASR latin noise.
 */
export function candidate(raw, freq = new Map()) {
  const w = unscheme(bare(raw));
  if (w.length < 4) return null;
  if (/^[۰-۹0-9]/.test(w)) return null;
  if (STOP.has(w)) return null;
  if (/^(نمی|می)(ت|د|خ|ک|ش|گ|ر|ز|ب|پ|ف|ی|و|ا)/.test(w) && !ME_NOUNS.has(w)) return null;
  // a bare superlative ("the most important…") dangles; the noun it modifies carries the card
  if (/ترین$/.test(w)) return null;
  // colloquial 3rd-person possessive ("…its", بالاش/خوردش) is never a topic noun
  if (/(?:اش|یش)$/.test(w)) return null;
  // imperative 2nd-person plural ("بدونید", "بذارید") reads as an instruction, not a topic
  if (/ید$/.test(w)) return null;
  const word = lighten(w, freq);
  let s = Math.min(6, word.length - 2);
  if (NOUN_SUFFIX.test(word)) s += 3;
  s += Math.min(4, freq.get(word) || freq.get(w) || 0);
  if (/[A-Za-z]/.test(word)) s += TECH.test(word) ? 3 : -2;
  return { raw: String(raw).trim(), word, s };
}

/** Persian/Arabic digits to a number; the original string stays for display. */
function toNumber(s) {
  const latin = String(s)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/,/g, '.');
  const n = Number(latin);
  return Number.isFinite(n) ? n : null;
}

/**
 * Everything a recipe can be chosen by, read out of one span of text.
 * `words[]` is the card word list (it carries the `hot` emphasis flags) and
 * `freq` is the film-wide word count, so the words the film is *about* outrank
 * the accidental ones.
 */
export function signalsFor(text, words = [], freq = new Map()) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const num = NUM_UNIT.exec(clean);
  const latinAll = [...new Set([...clean.matchAll(LATIN_RUN)].map((m) => m[1]).filter((s) => s.length >= 3))];
  const list = words.length ? words.map((w) => w.word || w.text) : clean.split(/\s+/).filter(Boolean);
  const hot = words.filter((w) => w.hot).map((w) => w.word || w.text).filter(Boolean);
  return {
    text: clean,
    parts: clean.split(/\s+/).filter(Boolean),
    words: list,
    hot,
    freq,
    top: topWords(list, freq, hot),
    value: num ? toNumber(num[1]) : null,
    rawValue: num ? num[1] : null,
    unit: num ? num[2] : null,
    percent: num ? /٪|درصد/.test(num[2]) : false,
    latin: bestLatin(latinAll),
    latinAll,
    items: splitItems(clean),
    contrast:
      /(^|\s)(اما|ولی|درحالی‌که|در حالی که|در صورتی که|به‌جای|به جای|در مقابل|برعکس|برعکسِ|قبلاً|پیش‌تر|تا قبل)/.test(clean) &&
      clean.length >= 18,
    question: /(^|\s)(چرا|چطور|چگونه|آیا|کدام|چی|چیه)(\s|$)/.test(clean) || /[؟?]\s*$/.test(clean),
    done: /(انجام شد|حل شد|تمام شد|نهایی شد|ثبت شد|درست شد|کار رفت|آماده شد|تأیید|موفق|تمام شد)/.test(clean),
    soundish: /(^|\s)(صدا|صدای|صوتی|موسیقی|موزیک|ووکال|فرکانس|اکولایزر|نویز|ریتم|بیت)(\s|$)/.test(clean),
    looking: /(بررسی|اسکن|تشخیص|پیدا|جستجو|تحلیل|پردازش|دقت|فیلتر|شناسایی)/.test(clean),
    ordered: /(^|\s)(اول|دوم|سوم|چهارم|پنجم|مرحله|گام|قدم|سپس|نهایت|بعد از آن)/.test(clean),
    enumerated: splitItems(clean).length >= 2,
  };
}

/** A latin fragment is only card material when it names something. */
function bestLatin(runs) {
  if (!runs.length) return null;
  const url = runs.find((r) => /(?:https?:\/\/|www\.|\/|\.)/.test(r) && r.length >= 6);
  if (url) return url;
  const tech = runs.find((r) => TECH.test(r));
  if (tech) return tech;
  const long = runs.filter((r) => r.length >= 6).sort((a, b) => b.length - a.length)[0];
  return long || null;
}

/** Candidate copy words, best first. */
function topWords(list, freq, hot) {
  const seen = new Set();
  const out = [];
  list.forEach((raw, i) => {
    const c = candidate(raw, freq);
    if (!c || seen.has(c.word)) return;
    seen.add(c.word);
    out.push({ ...c, i, hot: hot.includes(raw) || hot.includes(c.word) });
  });
  return out
    .map((c) => ({ ...c, s: c.s + (c.hot ? 4 : 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 6);
}

/** A real enumeration only: two or more separated clauses, each a few words. */
function splitItems(text) {
  const chunks = text
    .split(/[،,]|(?:\s+و\s+)|(?:\s+یا\s+)/)
    .map((s) => s.replace(/[.؛:?!؟]+/g, '').trim())
    .filter((s) => s.length >= 3 && s.length <= 22 && s.split(/\s+/).length <= 4);
  const uniq = [...new Set(chunks)];
  return uniq.length >= 2 ? uniq.slice(0, 5) : [];
}

/** Word-level needs map to these content keys. */
function has(sig, need) {
  switch (need) {
    case 'headline':
      return Boolean(salient(sig));
    case 'value':
      return sig.value !== null;
    case 'unit':
      return Boolean(sig.unit);
    case 'latin':
      return Boolean(sig.latin);
    case 'items':
      return sig.items.length >= 2;
    case 'contrast':
      return sig.contrast;
    case 'text':
      return sig.text.length >= 8;
    default:
      return false;
  }
}

/** The word the graphics should carry. */
export function salient(sig) {
  const best = sig.top.find((c) => c.s >= 3);
  return best ? best.word : null;
}

/**
 * The card copy: the strongest candidate word, plus its neighbour only when the
 * two are actually adjacent in the sentence. Two strong words from different
 * clauses would read as a scrambled quote.
 */
function headlineOf(sig) {
  const best = salient(sig);
  if (!best) return '';
  const lead = sig.top.find((c) => c.word === best);
  const partner = sig.top.find((c) => c !== lead && c.s >= 4 && Math.abs(c.i - lead.i) === 1);
  if (!partner) return best;
  const pair = [lead, partner].sort((a, b) => a.i - b.i).map((c) => c.word);
  const joined = pair.join(' ');
  return joined.length <= 26 ? joined : best;
}

function subOf(sig, headline) {
  // the muted second line is decoration; only a clearly topical word belongs there
  const next = sig.top.find((c) => c.s >= 4 && !headline.includes(c.word));
  return next ? next.word.slice(0, 22) : null;
}

/**
 * The specialised shapes only fire when the span really is that shape — a card
 * that invents a comparison or a completion the voice never said is a lie over
 * someone's footage, so these are gates, not bonuses.
 */
const GATE = {
  stat: (s) => s.value !== null && s.unit,
  terminal: (s) => Boolean(s.latin),
  steps: (s) => s.ordered || s.items.length >= 3,
  compare: (s) => s.contrast,
  meter: (s) => s.percent || (s.value !== null && s.value <= 100),
  waveform: (s) => s.soundish,
  badge: (s) => s.done,
  question: (s) => s.question,
  scan: (s) => s.looking,
  tags: (s) => s.items.length >= 3,
  // a brand pill only ever shows an address that was actually said
  brand: (s) => Boolean(s.latin && /[.\/]/.test(s.latin)),
};

/** Recipe score: gates decide participation, needs decide feasibility. */
export function scoreRecipe(recipe, sig, deliver) {
  if (recipe.id === 'quote' && deliver === 'overlay') return 0;
  if (!recipe.needs.every((n) => has(sig, n))) return 0;
  const gate = GATE[recipe.id];
  if (gate && !gate(sig)) return 0;
  if (recipe.id === 'keyword') return 2 + (sig.hot.length ? 1 : 0);
  // the whole sentence is the last resort, not the default: a graphic says a word
  if (recipe.id === 'quote') return 1;
  return 4 + recipe.needs.length + (gate ? 3 : 0);
}

/** All recipes that fit this span, best first. */
export function rankRecipes(sig, { density = 'balanced', deliver = 'overlay' } = {}) {
  const allow = new Set((DENSITY[density] || DENSITY.balanced).allow);
  return RECIPES.filter((r) => allow.has(r.id))
    .map((r) => ({ recipe: r, score: scoreRecipe(r, sig, deliver) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        PRIORITY.indexOf(a.recipe.id) - PRIORITY.indexOf(b.recipe.id) ||
        a.recipe.id.localeCompare(b.recipe.id),
    );
}

/** Group caption cards into spans of about one beat, honouring real silences. */
export function clusterCards(cards, target) {
  const out = [];
  let cur = null;
  const close = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const c of cards) {
    if (!cur) {
      cur = { start: c.start, end: c.end, cards: [c] };
    } else {
      if (c.start - cur.end > 1.5) {
        close();
        cur = { start: c.start, end: c.end, cards: [c] };
        continue;
      }
      cur.cards.push(c);
      cur.end = Math.max(cur.end, c.end);
    }
    if (cur.end - cur.start >= target || cur.cards.length >= 3) close();
  }
  close();
  // a tail shorter than half a beat belongs to the previous span
  if (out.length > 1 && out[out.length - 1].end - out[out.length - 1].start < Math.min(2, target * 0.45)) {
    const last = out.pop();
    out[out.length - 1].cards.push(...last.cards);
    out[out.length - 1].end = last.end;
  }
  return out;
}

/** Not enough beats for the density? Merge neighbours. */
function mergeTo(clusters, maxCount) {
  if (clusters.length <= maxCount || maxCount < 2) return clusters;
  const per = Math.ceil(clusters.length / maxCount);
  const out = [];
  for (let i = 0; i < clusters.length; i += per) {
    const group = clusters.slice(i, i + per);
    out.push({
      start: group[0].start,
      end: group[group.length - 1].end,
      cards: group.flatMap((g) => g.cards),
    });
  }
  return out;
}

function textOf(cluster) {
  return cluster.cards.map((c) => c.text).join(' ');
}
function wordsOf(cluster) {
  const seen = new Set();
  const out = [];
  for (const c of cluster.cards) for (const w of c.words || []) if (!seen.has(w.text + w.start)) out.push(w);
  return out;
}

/** Snap a beat start to the reference's own accent, when one is near. */
function snapToGrid(start, grid, window = 0.4) {
  if (!grid || grid.length < 6) return start;
  let best = null;
  let bestD = window;
  for (const t of grid) {
    const d = Math.abs(t - start);
    if (d <= bestD) {
      bestD = d;
      best = t;
    }
  }
  return best === null ? start : round3(best);
}

/**
 * The arc the brief names is a real force on the sheet: the opening beat wants a
 * hook shape (question for explainers, keyword/stat for promos) and the closing
 * one wants a landing (brand/badge). The boost only re-orders recipes that
 * already passed their gates — the arc can never force a shape the span does
 * not support, and the copy still comes from the words actually spoken.
 */
function arcBoost(recipeId, pos, arc) {
  if (pos <= 0.01) {
    if (arc === 'explainer') return recipeId === 'question' ? 3 : recipeId === 'keyword' ? 1 : 0;
    return recipeId === 'keyword' || recipeId === 'stat' ? 1.5 : 0;
  }
  if (pos >= 0.92) {
    if (recipeId === 'brand') return 4;
    if (recipeId === 'badge') return 2;
  }
  return 0;
}

const rankSort = (a, b) =>
  b.score - a.score ||
  PRIORITY.indexOf(a.recipe.id) - PRIORITY.indexOf(b.recipe.id) ||
  a.recipe.id.localeCompare(b.recipe.id);

/**
 * The beat sheet.
 *
 * @param timeline parsed `timeline.json` (needs `cards[]`, `report`, `meta`)
 * @param style    reference `style.json` from `reference.analyze()`, or null
 * @param o        `{deliver, density, ratio, maxBeats, material, brief, brand}`
 */
export function buildBeats(timeline, style = null, o = {}) {
  const deliver = o.deliver === 'standalone' ? 'standalone' : 'overlay';
  const cards = (timeline.cards || []).filter((c) => c.end > c.start);
  if (!cards.length) throw new Error('beats: timeline has no caption cards');

  const derived = style?.derived || {};
  const brandMotion = o.brand?.motion || {};
  const brief = o.brief || null;
  // the reference, when one exists, is the truth about rhythm; the brand preset
  // sets the energy only when there is nothing measured to trust
  const energy = style ? (derived.energy ?? 0.4) : (brandMotion.energy ?? 0.4);
  const density =
    o.density && o.density !== 'auto' ? o.density : derived.density || 'balanced';
  const pol = DENSITY[density] || DENSITY.balanced;
  const ratio = o.ratio || derived.ratio || ratioOf(timeline);
  const total = timeline.report?.duration || cards[cards.length - 1].end;

  const minBeat = round3(60 / pol.maxBeatsPerMinute);
  const target = clamp(derived.beatLen || 5, minBeat, 11);
  const clusters = mergeTo(
    clusterCards(cards, target),
    o.maxBeats || Math.max(4, Math.floor((total / 60) * pol.maxBeatsPerMinute)),
  );

  const zones = zonesFor({
    ratio,
    deliver,
    anchor: derived.anchor,
    sideBias: derived.sideBias,
    captionSide: (o.template && templateById(o.template)?.captionSide) || 'bottom',
  });
  let tList = transitionsFor(energy);
  // the personality biases the transition set, it does not invent new ones
  if (brandMotion.transitionBias === 'subtle') tList = tList.filter((t) => t !== 'slam');
  else if (brandMotion.transitionBias === 'strong' && !tList.includes('slam'))
    tList = ['pop', 'slam', 'wipe', 'soft'];
  const grid = derived.hasBeatGrid ? derived.beatGrid : null;
  const freq = wordFrequency(cards);
  /** Words already shown on a card: repeating them makes a film of one word. */
  const used = new Map();
  const freshen = (sig) => {
    sig.top = sig.top
      .map((c) => ({ ...c, s: c.s - 3 * (used.get(c.word) || 0) }))
      .filter((c) => c.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, 6);
    return sig;
  };
  const consume = (beat) => {
    for (const w of `${beat.content.headline} ${beat.content.sub || ''}`.split(/\s+/))
      if (w) used.set(w, (used.get(w) || 0) + 1);
  };

  const beats = [];
  let prevZone = null;
  let zi = 0;
  let paired = 0;

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const next = clusters[i + 1];
    const sig = freshen(signalsFor(textOf(cluster), wordsOf(cluster), freq));
    const pos = clusters.length > 1 ? i / (clusters.length - 1) : 0;
    const ranked = rankRecipes(sig, { density, deliver })
      .map((x) => ({ ...x, score: x.score + arcBoost(x.recipe.id, pos, brief?.arc) }))
      .sort(rankSort);
    if (!ranked.length) continue;

    const span = round3(cluster.end - cluster.start);
    const start = snapToGrid(round3(cluster.start), grid);
    const free = round3((next ? next.start : total) - start - 0.05);

    // a collage reads best when a second, *different* idea shares the same span
    const shareRoom =
      density !== 'sparse' &&
      free >= Math.max(4.6, target) &&
      paired < Math.max(2, Math.round(clusters.length * 0.35));
    const head = shareRoom ? headlineOf(sig) : '';
    const other = shareRoom ? { ...sig, top: sig.top.filter((c) => !head.includes(c.word)) } : sig;
    const second = shareRoom
      ? rankRecipes(other, { density, deliver }).find((x) => x.recipe.id !== ranked[0].recipe.id)
      : null;

    const primary = place(beats, ranked[0], sig, cluster, {
      n: beats.length + 1,
      start,
      room: second
        ? round3(free * 0.6)
        : deliver === 'overlay' && density === 'rich' && clusters.length - i > 2
          ? round3(free * 0.85)
          : free,
      span,
      zones,
      zi: zi++,
      prevZone,
      tList,
      deliver,
      holdMult: brandMotion.holdMult || 1,
      primary: true,
    });
    prevZone = primary.zone.id;
    consume(primary);

    if (second) {
      const b2 = place(beats, second, other, cluster, {
        n: beats.length + 1,
        start: round3(start + 0.45),
        room: round3(free - 0.45),
        span,
        zones,
        zi: zi++,
        prevZone,
        tList,
        deliver,
        holdMult: brandMotion.holdMult || 1,
        primary: false,
      });
      if (b2.zone.id !== primary.zone.id && b2.content.headline !== primary.content.headline) {
        paired++;
        consume(b2);
        prevZone = b2.zone.id;
      } else beats.pop();
    }
  }

  dropStills(beats);
  tighten(beats, round3(total));
  const report = summarise(beats, { density, pol, target, total, clusters, deliver, derived, paired });
  const safe = safeFor(ratio);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: { cards: cards.length, duration: round3(total), fps: timeline.meta?.fps || 30 },
    config: {
      deliver,
      density,
      ratio,
      beatLen: round3(target),
      minBeat,
      material: o.material || 'glass',
      teaser: Boolean(safe),
      template: o.template || null,
    },
    style: {
      from: style?.source ? String(style.source).split('/').pop() : null,
      energy: derived.energy ?? null,
      anchor: derived.anchor || null,
      sideBias: derived.sideBias || null,
      paletteMode: derived.paletteMode || 'brand',
      look: derived.look || null,
      preset: o.brand?.preset || null,
      brandFrom: o.brand?.source || null,
    },
    brief: brief
      ? {
          topic: brief.topic || null,
          arc: brief.arc || null,
          mood: brief.mood || null,
          mustShow: brief.mustShow || [],
        }
      : null,
    // a teaser ratio burns the SRT in as subtitles — word timings ride on the
    // sheet so the writer needs no second source. A UI-skin template (001)
    // needs its signature selection box on every cue: when the transcript has
    // no emphasis word, the cue's longest content word carries the style flag
    // (styling only — the copy stays exactly what was spoken).
    captions: safe
      ? cards.map((c) => {
          const words = (c.words || []).map((w) => ({
            text: w.text,
            hot: Boolean(w.hot),
            uline: Boolean(w.uline),
            start: round3(w.start ?? c.start),
            end: round3(w.end ?? c.end),
          }));
          const uiSkin = templateById(o.template)?.material === 'ui';
          if (uiSkin && words.length && !words.some((w) => w.hot || w.uline)) {
            const pick = words
              .filter((w) => w.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 4)
              .sort((a, b) => b.text.length - a.text.length)[0];
            if (pick) pick.hot = true;
          }
          return { start: round3(c.start), end: round3(c.end), text: c.text, words };
        })
      : null,
    beats,
    report,
  };
}

/** A card with nothing to show is a rectangle of glass over the user's face. */
function dropStills(beats) {
  for (let i = beats.length - 1; i >= 0; i--) {
    const c = beats[i].content;
    const empty =
      !c.headline && !c.latin && !c.text && !c.glyph && c.value === null && !(c.items || []).length;
    if (empty) beats.splice(i, 1);
  }
}

/**
 * Close the dead air: the SRT clock is untouched, but a card that stops a whole
 * second before the next idea begins reads as a frozen frame. Every beat is
 * grown into the silence in front of it — up to its recipe's own maximum — and
 * the film opens on frame 0 instead of an empty canvas.
 */
function tighten(beats, total) {
  if (!beats.length) return;
  const byStart = [...beats].sort((a, b) => a.start - b.start);
  if (byStart[0].start <= 0.6) shiftStart(byStart[0], -byStart[0].start);
  for (const b of byStart) {
    const after = byStart.find((x) => x !== b && x.start > b.end - 0.5);
    const nextStart = after ? after.start : total;
    const hi = RECIPE_BY_ID.get(b.recipe)?.len?.[1] ?? 8;
    const grow = Math.min(nextStart - b.end - 1, hi - b.duration);
    if (grow > 0.1) {
      b.duration = round3(b.duration + grow);
      b.end = round3(b.start + b.duration);
    }
  }
  // the last idea is the one people leave with: it must be readable for 2 s
  const tail = byStart[byStart.length - 1];
  if (tail.duration < 3) {
    tail.duration = 3;
    tail.end = round3(tail.start + tail.duration);
  }
}

function shiftStart(b, delta) {
  b.start = round3(b.start + delta);
  b.end = round3(b.start + b.duration);
  for (const c of b.cues) c.at = round3(Math.max(0, c.at + delta));
}

function place(beats, ranked, sig, cluster, ctx) {
  const recipe = ranked.recipe;
  const len = clampDuration(ctx.room, ctx.span, recipe, ctx.deliver, sig, ctx.holdMult || 1);
  const start = ctx.start;
  const beat = {
    n: ctx.n,
    card: cluster.cards[0].id,
    start,
    duration: len,
    end: round3(start + len),
    recipe: recipe.id,
    draw: recipe.draw,
    fa: recipe.fa,
    score: ranked.score,
    primary: ctx.primary,
    transition: ctx.tList[ctx.zi % ctx.tList.length],
    zone: null,
    track: 0,
    content: contentFor(recipe.id, sig, cluster),
    cues: [],
    why: why(recipe.id, sig),
    sig: snapshot(sig),
  };
  const zone = pickZone(ctx.zones, ctx.zi, ctx.prevZone);
  beat.zone = { ...zone };
  beat.track = ctx.zones.findIndex((z) => z.id === zone.id) + 1;
  beat.cues = cuesFor(recipe, beat);
  beats.push(beat);
  return beat;
}

/** A recipe's cue times, clamped inside the beat so no sound fires on nothing. */
function cuesFor(recipe, beat) {
  const raw = recipe.cues ? recipe.cues(beat) : [{ role: 'cardIn', at: beat.start + 0.08 }];
  return raw
    .map((c) => ({ role: c.role, at: round3(Math.max(beat.start + 0.05, c.at)) }))
    .filter((c) => c.at < beat.end - 0.15);
}

/** Every shape this span could have been drawn as — the panel's edit menu. */
export function optionsFor(beat, { density = 'balanced', deliver = 'overlay' } = {}) {
  const allow = new Set((DENSITY[density] || DENSITY.balanced).allow);
  return RECIPES.filter((r) => allow.has(r.id)).map((r) => ({
    id: r.id,
    fa: r.fa,
    score: scoreRecipe(r, beat.sig, deliver),
    ok: scoreRecipe(r, beat.sig, deliver) > 0,
  }));
}

/**
 * Swap a beat's recipe by hand. Copy, cues and the honest `why` are rebuilt from
 * the evidence stored on the beat, so an edit never invents new text.
 */
export function setRecipe(sheet, n, recipeId) {
  const beat = sheet.beats.find((b) => b.n === n);
  const recipe = RECIPE_BY_ID.get(recipeId);
  if (!beat || !recipe) throw new Error(`beats: بیت ${n} یا دستور پخت ${recipeId} نیست`);
  beat.recipe = recipe.id;
  beat.draw = recipe.draw;
  beat.fa = recipe.fa;
  beat.content = contentFor(recipe.id, beat.sig, null);
  beat.why = why(recipe.id, beat.sig);
  const room = round3(beat.end - beat.start);
  beat.duration = clampDuration(room, room, recipe, sheet.config.deliver, beat.sig);
  beat.end = round3(beat.start + beat.duration);
  beat.cues = cuesFor(recipe, beat);
  return beat;
}

/** Length: long enough to read, short enough to keep the rhythm, inside the recipe. */
function clampDuration(room, span, recipe, deliver, sig, holdMult = 1) {
  const [lo, hi] = recipe.len;
  const head = headlineOf(sig) || '';
  // the personality stretches how long a card stays readable (shotcraft hold budget)
  const readable = (0.5 + 0.3 * head.split(/\s+/).filter(Boolean).length) * holdMult;
  const wanted = clamp(Math.max(span + 0.35, readable, lo), lo, hi);
  // leave a breath between collage cards so the footage can be seen
  const cap = room * (deliver === 'standalone' ? 0.95 : 0.9);
  return round3(Math.max(1.4, Math.min(wanted, cap, hi)));
}

/** Copy for the writer: only what the span actually says. */
function contentFor(recipeId, sig, cluster) {
  const head = headlineOf(sig);
  const c = {
    headline: head || '',
    sub: subOf(sig, head),
    value: sig.value,
    display: sig.rawValue,
    unit: sig.unit,
    percent: sig.percent,
    latin: sig.latin,
    items: (sig.items || []).slice(0, 5),
    icon: null,
    glyph: sig.question ? '؟' : null,
  };
  if (recipeId === 'quote') c.text = cluster ? textOf(cluster) : sig.text;
  if (recipeId === 'brand' && !c.latin) c.latin = (sig.latinAll || [])[0] || null;
  const words = [...new Set([head, c.sub, ...c.items, ...(sig.latinAll || [])].filter(Boolean))];
  c.icon = resolveIcon(pickIcon(words) || ICON_FOR[recipeId] || 'auto_awesome');
  return c;
}

/**
 * The evidence a beat was built from, kept on the sheet so the panel can swap a
 * recipe later without re-reading the transcript.
 */
function snapshot(sig) {
  return {
    text: sig.text,
    top: sig.top.slice(0, 5).map((c) => ({ word: c.word, i: c.i, s: c.s })),
    value: sig.value,
    rawValue: sig.rawValue,
    unit: sig.unit,
    percent: sig.percent,
    latin: sig.latin,
    latinAll: sig.latinAll,
    items: sig.items,
    question: sig.question,
    contrast: sig.contrast,
    done: sig.done,
    soundish: sig.soundish,
    looking: sig.looking,
    ordered: sig.ordered,
    enumerated: sig.enumerated,
    hot: sig.hot,
  };
}

/** One honest line telling the editor *why* this card exists. */
function why(recipeId, sig) {
  if (recipeId === 'stat') return `عدد «${sig.rawValue} ${sig.unit || ''}» در متن`;
  if (recipeId === 'terminal') return `نام لاتین «${sig.latin}» در متن`;
  if (recipeId === 'steps') return 'شمردن مراحل';
  if (recipeId === 'tags') return `${sig.items.length} مورد کنار هم`;
  if (recipeId === 'compare') return 'تقابل دو حالت';
  if (recipeId === 'meter') return 'درصد/میزان در متن';
  if (recipeId === 'waveform') return 'حرف دربارهٔ صدا';
  if (recipeId === 'badge') return 'پایان یک ایده';
  if (recipeId === 'question') return 'پرسش';
  if (recipeId === 'scan') return 'بررسی و تشخیص';
  if (recipeId === 'brand') return 'نام/آدرس';
  if (recipeId === 'quote') return 'متن کامل (تحویل مستقل)';
  return sig.hot.length ? 'واژهٔ تأکیدشده در زیرنویس' : 'کلیدواژهٔ برجستهٔ بازه';
}

function summarise(beats, { density, pol, target, total, clusters, deliver, derived, paired }) {
  const byRecipe = {};
  for (const b of beats) byRecipe[b.recipe] = (byRecipe[b.recipe] || 0) + 1;
  const perMinute = Math.round((beats.length / Math.max(1, total)) * 60 * 10) / 10;
  const lines = [
    `${beats.length} بیت موشن از ${clusters.length} بازهٔ گفتار (مدت ${Math.round(total)} ثانیه)`,
    `نرخ ${pol.fa}: هر ${round3(target)} ثانیه یک کارت، ${perMinute} بیت در دقیقه (سقف ${pol.maxBeatsPerMinute})`,
    `${paired} بازه دو کارت هم‌زمان دارد؛ ${beats.filter((b) => b.content.icon).length} بیت آیکون دارد`,
    Object.entries(byRecipe)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${RECIPE_BY_ID.get(k)?.fa || k}: ${v}`)
      .join('، '),
    deliver === 'overlay'
      ? 'کلاژ روی تصویر: هیچ کارتی متن کامل گروه را تکرار نمی‌کند و وسط کادر آزاد می‌ماند'
      : 'تحویل مستقل: کارت‌ها روی پس‌زمینهٔ گرافیتی خودشان می‌نشینند',
  ];
  if (derived.density) lines.push(`از رفرنس: چگالی ${derived.density}، انرژی ${derived.energy}, ترنزیشن ${derived.transitions}`);
  return { perMinute, byRecipe, paired, lines };
}

function ratioOf(timeline) {
  const w = timeline.meta?.width || 1920;
  const h = timeline.meta?.height || 960;
  const g = (a, b) => (b ? g(b, a % b) : a);
  const d = g(w, h) || 1;
  const r = `${Math.round(w / d)}:${Math.round(h / d)}`;
  return ['2:1', '16:9', '1:1', '9:16', '4:5', '4:3'].includes(r) ? r : '2:1';
}

/** Same zone twice in a row would look like one long card: never allow it. */
export function validate(sheet) {
  const problems = [];
  const byZone = new Map();
  const safe = sheet.config?.teaser
    ? safeFor(sheet.config.ratio, (sheet.config.template && templateById(sheet.config.template)?.captionSide) || 'bottom')
    : null;
  for (const b of sheet.beats) {
    if (!b.content.headline && b.recipe !== 'quote') problems.push(`بیت ${b.n} (${b.recipe}) بدون متن`);
    if (b.duration < 1.2) problems.push(`بیت ${b.n} خیلی کوتاه است (${b.duration})`);
    if (!RECIPE_BY_ID.has(b.recipe)) problems.push(`بیت ${b.n} دستور پخت ناشناخته دارد`);
    if (b.start + b.duration > b.end + 0.001) problems.push(`بیت ${b.n} زمانش نمی‌خواند`);
    if (safe) {
      const z = b.zone || {};
      if (z.x < safe.left - 0.01 || z.x > 1 - safe.right + 0.01)
        problems.push(`بیت ${b.n} بیرون حاشیهٔ امن است (${z.id}: x=${z.x}, y=${z.y})`);
      if (z.y > safe.bandTop - 0.01 && z.y < safe.bandBottom + 0.01)
        problems.push(`بیت ${b.n} وارد نوار زیرنویس شده (${z.id}: y=${z.y})`);
    }
    const seen = byZone.get(b.zone.id) || [];
    for (const p of seen) if (b.start < p.end - 0.01) problems.push(`بیت ${b.n} روی بیت ${p.n} در zone ${b.zone.id} افتاده`);
    seen.push({ n: b.n, end: b.end });
    byZone.set(b.zone.id, seen);
    for (const c of b.cues) if (c.at < b.start || c.at > b.end) problems.push(`بیت ${b.n} صدای ${c.role} بیرون از بازه‌اش است`);
  }
  return problems;
}

/**
 * Review frames must land *inside* a beat, after its entrance has settled.
 * Sampling the film at even times catches the gaps between cards and returns
 * blank stills, which reads as a broken render.
 */
export function stillTimes(sheet, max = 9) {
  const film = Math.max(...sheet.beats.map((b) => b.end));
  const mid = sheet.beats.map((b) => round3(b.start + Math.min(b.duration * 0.6, 1.1)));
  const step = Math.max(1, mid.length / max);
  const keep = [];
  for (let i = 0; i < max && Math.floor(i * step) < mid.length; i++) keep.push(mid[Math.floor(i * step)]);
  keep.push(mid[mid.length - 1]);
  return [...new Set(keep.filter((t) => t > 0 && t < film))].join(',');
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round3 = (v) => Math.round(v * 1000) / 1000;
