import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ICON_MODULE, OVERLAY_TEMPLATE_DIR, FETCH_ICONS_TOOL } from './paths.mjs';

/* icons.mjs — the studio's icon layer.
 *
 * Material Symbols Outlined, inlined as path data so a render never touches the
 * network. The bundled set lives with the overlay template; a project gets its
 * own `icons/*.svg` plus a generated `modules/icons.js` holding exactly the
 * icons it uses. Names are snake_case Material names, never emoji, never mixed
 * with another family.
 */

/** Persian label + the words that should pull this icon into a beat. */
export const ICON_META = {
  account_tree: { fa: 'ساختار و انتخاب', tags: ['ساختار', 'درخت', 'انتخاب', 'مسیر', 'منابع'] },
  all_inclusive: { fa: 'همه‌چیز', tags: ['همه', 'کل', 'بی‌نهایت'] },
  animation: { fa: 'انیمیشن', tags: ['انیمیشن', 'موشن', 'فریم', 'سازنده'] },
  auto_awesome: { fa: 'ایدهٔ درخشان', tags: ['ایده', 'جادو', 'ویژه'] },
  bolt: { fa: 'سرعت و قدرت', tags: ['تیز', 'سریع', 'قدرت', 'برند', 'ولت'] },
  content_cut: { fa: 'برش', tags: ['برش', 'کات', 'قصه', 'قچی'] },
  graphic_eq: { fa: 'صدا و موج', tags: ['صدا', 'موج', 'صوت', 'موزیک', 'اکولایزر'] },
  hd: { fa: 'کیفیت بالا', tags: ['کیفیت', 'hd', 'وضوح', 'رزولوشن'] },
  monitor: { fa: 'نمایشگر و خروجی', tags: ['نمایشگر', 'خروجی', 'صفحه', 'مانیتور', 'پلتفرم'] },
  movie_edit: { fa: 'تدوین ویدیو', tags: ['تدوین', 'ویدیو', 'کات', 'سازنده'] },
  neurology: { fa: 'پردازش', tags: ['پردازش', 'شبکه', 'مغز'] },
  psychology: { fa: 'هوش مصنوعی', tags: ['هوش', 'مدل', 'یادگیری', 'ai', 'مصنوعی'] },
  rocket_launch: { fa: 'راه‌اندازی', tags: ['راه‌اندازی', 'استارت', 'لانچ', 'شروع', 'انتشار'] },
  smart_toy: { fa: 'ربات', tags: ['ربات', 'دستیار', 'هوش', 'bot', 'ربات'] },
  speed: { fa: 'سرعت', tags: ['سرعت', 'fast', 'شتاب', 'زمان', 'میانگین'] },
  subtitles: { fa: 'زیرنویس', tags: ['زیرنویس', 'srt', 'متن', 'ترجمه'] },
  terminal: { fa: 'ترمینال و کد', tags: ['کد', 'ترمینال', 'دستور', 'اسکریپت', 'فایل', 'cmd'] },
  tune: { fa: 'تنظیمات', tags: ['تنظیم', 'پیکربندی', 'کنترل', 'پارامتر'] },
  verified: { fa: 'تأیید و پایان', tags: ['تأیید', 'درست', 'پایان', 'موفق', 'تمام'] },
  videocam: { fa: 'دوربین و فیلم', tags: ['دوربین', 'فیلم', 'ضبط', 'فیلمبرداری'] },
  checklist: { fa: 'چک‌لیست', tags: ['لیست', 'چک', 'کارها', 'مراحل'] },
  brands: { fa: 'برند', tags: ['برند', 'شبکه', 'لوگو'] },
  currency_exchange: { fa: 'مبادله', tags: ['قیمت', 'تعویض', 'پول'] },
  download: { fa: 'دانلود', tags: ['دانلود', 'دریافت', 'خروجی'] },
  expand: { fa: 'باز شدن', tags: ['باز', 'گسترش', 'افزایش'] },
  timer: { fa: 'زمان‌سنج', tags: ['زمان', 'تایمر', 'ثانیه', 'دقیقه'] },
  trending_up: { fa: 'رشد', tags: ['رشد', 'افزایش', 'بهبود', 'آمار'] },
  touch_app: { fa: 'لمس', tags: ['لمس', 'کلیک', 'تعامل', 'کاربر'] },
  insights: { fa: 'بینش و آمار', tags: ['آمار', 'داده', 'بینش', 'گزارش'] },
  code: { fa: 'کد', tags: ['کد', 'برنامه', 'اسکریپت'] },
};

const MODULE_RE = /ICON\[("([^"]+)"|'([^']+)')\]\s*=\s*\[/g;

/** Names available in the bundled module, with metadata. */
export function bundledNames() {
  if (!fs.existsSync(ICON_MODULE)) return [];
  const src = fs.readFileSync(ICON_MODULE, 'utf8');
  const names = [];
  for (const m of src.matchAll(MODULE_RE)) names.push(m[2] || m[3]);
  return [...new Set(names)];
}

export function catalog() {
  const bundled = new Set(bundledNames());
  const set = new Set([...bundled, ...Object.keys(ICON_META)]);
  return [...set]
    .sort()
    .map((name) => ({
      name,
      fa: ICON_META[name]?.fa || name,
      tags: ICON_META[name]?.tags || [],
      bundled: bundled.has(name),
    }));
}

/**
 * The kit only carries twenty Material symbols and this machine has no network,
 * so a name the recipes like may simply not exist. Each unavailable name maps to
 * the closest available one; `resolveIcon` returns the original as soon as the
 * SVG is present, so the aliases retire themselves when the kit grows.
 */
export const ICON_ALIAS = {
  checklist: 'account_tree',
  brands: 'bolt',
  currency_exchange: 'bolt',
  download: 'monitor',
  expand: 'all_inclusive',
  timer: 'speed',
  trending_up: 'speed',
  touch_app: 'animation',
  insights: 'neurology',
  code: 'terminal',
};

let bundledCache = null;
function availableSet() {
  if (!bundledCache) bundledCache = new Set(bundledNames());
  return bundledCache;
}

/** The symbol that will actually render for this name. */
export function resolveIcon(name) {
  if (!name) return null;
  const have = availableSet();
  if (have.has(name)) return name;
  const alt = ICON_ALIAS[name];
  if (alt && have.has(alt)) return alt;
  return have.has('auto_awesome') ? 'auto_awesome' : null;
}

/** Best icon for a set of keywords; only ever returns an icon the kit has. */
export function pickIcon(words, exclude = []) {
  const have = availableSet();
  const lowered = words.map((w) => String(w).toLowerCase()).filter((w) => w.length >= 3);
  let best = null;
  let bestScore = 0;
  for (const [name, meta] of Object.entries(ICON_META)) {
    if (!have.has(name) || exclude.includes(name)) continue;
    let score = 0;
    for (const tag of meta.tags) {
      const t = tag.toLowerCase();
      // a longer tag is a more specific meaning, so it must outweigh 'کل'
      if (lowered.some((w) => w.includes(t) || t.includes(w))) score += 2 + Math.min(4, t.length / 2);
    }
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

function svgSources() {
  return [path.join(OVERLAY_TEMPLATE_DIR, 'icons')];
}

function ensureSvg(projectDir, name) {
  const dest = path.join(projectDir, 'icons', `${name}.svg`);
  if (fs.existsSync(dest)) return true;
  for (const root of svgSources()) {
    const src = path.join(root, `${name}.svg`);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      return true;
    }
  }
  return false;
}

/** Pull missing Material symbols from the upstream set into the project. */
function fetchMissing(projectDir, names) {
  if (!names.length || !fs.existsSync(FETCH_ICONS_TOOL)) return;
  const clean = names.filter((n) => /^[a-z0-9_]+$/.test(n));
  if (!clean.length) return;
  spawnSync('node', [FETCH_ICONS_TOOL, '--project', projectDir, ...clean], { stdio: 'ignore' });
}

/**
 * Write `<project>/modules/icons.js` with exactly these icons. Missing from the
 * bundle and `fetch` allowed → downloaded; otherwise the icon is dropped and
 * reported so the beat can fall back to another one.
 */
export function writeModule(projectDir, names, { fetch = false } = {}) {
  const wanted = [...new Set(names.filter(Boolean))];
  const missing = wanted.filter((n) => !ensureSvg(projectDir, n));
  if (fetch && missing.length) {
    fetchMissing(projectDir, missing);
  }
  const iconRoot = path.join(projectDir, 'icons');
  const have = fs.existsSync(iconRoot)
    ? fs.readdirSync(iconRoot).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, '')).sort()
    : [];
  let out = '/* Material Symbols Outlined (Apache-2.0) — inlined paths, no network at render time. */\n';
  out += '(function (g) {\n  var ICON = {};\n';
  for (const name of have) {
    const raw = fs.readFileSync(path.join(iconRoot, `${name}.svg`), 'utf8');
    const paths = [...raw.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
    out += `  ICON[${JSON.stringify(name)}] = [${paths.map((d) => JSON.stringify(d)).join(',')}];\n`;
  }
  out += `  g.ICON = ICON;
  g.icon = function(name, cls){ var p = ICON[name] || []; return '<svg class="mi ' + (cls||"") + '" viewBox="0 -960 960 960" aria-hidden="true">' + p.map(function(d){ return '<path d="' + d+'"/>'; }).join("") + '</svg>'; };
})(window);
`;
  fs.mkdirSync(path.join(projectDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'modules/icons.js'), out, 'utf8');
  const unresolved = wanted.filter((n) => !have.includes(n));
  return { icons: have, unresolved };
}
