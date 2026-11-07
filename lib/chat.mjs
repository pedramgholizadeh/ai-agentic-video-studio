import fs from 'node:fs';
import path from 'node:path';
import { jobDir } from './paths.mjs';

/*
 * chat.mjs — the edit loop's voice.
 *
 * Every review gate shows one chat box. Messages land in <job>/chat.jsonl so
 * the history survives restarts and is readable by a code agent (the HANDOFF
 * contract tells it to read this file before acting). Recognised Persian edit
 * intents are applied by the studio itself; anything else is kept for the
 * agent — never dropped, never silently ignored.
 */

export function chatFile(id) {
  return path.join(jobDir(id), 'chat.jsonl');
}

export function appendMessage(id, { role, text, meta = null }) {
  const entry = {
    ts: new Date().toISOString(),
    role,
    text: String(text || '').slice(0, 4000),
    ...(meta ? { meta } : {}),
  };
  fs.mkdirSync(path.dirname(chatFile(id)), { recursive: true });
  fs.appendFileSync(chatFile(id), JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

export function readMessages(id) {
  try {
    return fs
      .readFileSync(chatFile(id), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/*
 * Edit intents. Each returns { kind, fa, patch, invalidate } — the stages that
 * must run again for the edit to be visible in the next preview. `patch` is
 * applied to job.config by the caller; `styleEdit` tweaks the learned profile.
 */
const has = (t, re) => re.test(t);

export function parseEditIntent(rawText) {
  // Persian digits → Latin, so «خط ۳» and «۹:۱۶» match the same way «خط 3» does
  const text = String(rawText || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (!text) return null;

  // an approval just to move on — no \b: JS word boundaries are ASCII-only and
  // would never match after a Persian letter
  if (/^(تایید|تأیید|اوکی|اوکِی|برو|ادامه|خوبه|درسته|قبول)/.test(text) || /^(ok|okay|go|approve|continue)\b/i.test(text))
    return { kind: 'approve', fa: 'تایید — ادامه به مرحلهٔ بعد', patch: {}, invalidate: [] };

  // subtitle placement
  if (has(text, /زیرنویس|کپشن|caption/i)) {
    if (has(text, /بالا|بالاتر|top/i)) return { kind: 'captions-top', fa: 'زیرنویس به بالای کادر رفت', patch: { edit: { captionSide: 'top' } }, invalidate: ['strategy', 'scaffold', 'preview'] };
    if (has(text, /پایین|پایین.?تر|bottom/i)) return { kind: 'captions-bottom', fa: 'زیرنویس به پایین کادر برگشت', patch: { edit: { captionSide: 'bottom' } }, invalidate: ['strategy', 'scaffold', 'preview'] };
  }

  // density — how busy the layer is
  if (has(text, /شلوغ.?تر|جزئیات.?بیشتر|تراکم.?بیشتر|تراکم.?بالا|rich|density.*rich/i))
    return { kind: 'density', fa: 'چگالی بیشتر شد (rich)', patch: { motion: { density: 'rich' } }, invalidate: ['strategy', 'scaffold', 'preview'] };
  if (has(text, /ساده.?تر|خلوت.?تر|کم.?کار|تراکم.?کمتر|تراکم.?کم|sparse/i))
    return { kind: 'density', fa: 'چگالی کمتر شد (sparse)', patch: { motion: { density: 'sparse' } }, invalidate: ['strategy', 'scaffold', 'preview'] };
  if (has(text, /متعادل|balanced/i))
    return { kind: 'density', fa: 'چگالی متعادل شد', patch: { motion: { density: 'balanced' } }, invalidate: ['strategy', 'scaffold', 'preview'] };

  // energy of the learned style
  if (has(text, /انرژی|پویا|energy/i)) {
    if (has(text, /بیشتر|بالا|قوی.?تر|زیاد/)) return { kind: 'energy', fa: 'انرژی لایه بیشتر شد', patch: { edit: { energyScale: 1.25 } }, invalidate: ['strategy', 'scaffold', 'preview'] };
    if (has(text, /کمتر|کم|آرام|نرم/)) return { kind: 'energy', fa: 'انرژی لایه کمتر شد', patch: { edit: { energyScale: 0.75 } }, invalidate: ['strategy', 'scaffold', 'preview'] };
  }

  // pacing of the beat grid
  if (has(text, /سریع.?تر|تند.?تر|ریتم.?بیشتر|پر?شتاب/))
    return { kind: 'pacing', fa: 'ریتم تندتر شد', patch: { edit: { beatLenScale: 0.8 } }, invalidate: ['strategy', 'scaffold', 'preview'] };
  if (has(text, /آهسته.?تر|کند.?تر|آرام.?تر|ریتم.?کمتر/))
    return { kind: 'pacing', fa: 'ریتم آرام‌تر شد', patch: { edit: { beatLenScale: 1.25 } }, invalidate: ['strategy', 'scaffold', 'preview'] };

  // accent colour — an explicit hex wins, otherwise the job is for the agent
  const hex = text.match(/#([0-9a-f]{6})\b/i);
  if (hex && has(text, /رنگ|اکسنت|accent|color|colour/i))
    return { kind: 'accent', fa: `رنگ اکسنت ${hex[0]} شد`, patch: { brand: { palette: { accent: `#${hex[1].toUpperCase()}` } } }, invalidate: ['strategy', 'scaffold', 'preview'] };

  // sound design
  if (has(text, /افکت|ساند.?افکت|sfx/i)) {
    if (has(text, /حذف|بی.?صدا|بدون|نه|کامل.?کم/)) return { kind: 'sfx', fa: 'صدای افکت حذف شد', patch: { sound: { sfx: false } }, invalidate: ['scaffold', 'preview'] };
    if (has(text, /بلند|بیشتر|قوی|bold/)) return { kind: 'sfx', fa: 'سطح افکت‌ها bold شد', patch: { sound: { level: 'bold' } }, invalidate: ['scaffold', 'preview'] };
    if (has(text, /ملایم|کم|آرام|gentle/)) return { kind: 'sfx', fa: 'سطح افکت‌ها ملایم شد', patch: { sound: { level: 'gentle' } }, invalidate: ['scaffold', 'preview'] };
    if (has(text, /متعادل|balanced/)) return { kind: 'sfx', fa: 'سطح افکت‌ها متعادل شد', patch: { sound: { level: 'balanced' } }, invalidate: ['scaffold', 'preview'] };
  }

  // output ratio
  if (has(text, /عمودی|۹:?۱۶|9:?16/i)) return { kind: 'ratio', fa: 'نسبت خروجی ۹:۱۶ شد', patch: { output: { ratio: '9:16' } }, invalidate: ['prepare', 'strategy', 'scaffold', 'preview'] };
  if (has(text, /افقی|۱۶:?۹|16:?9/i)) return { kind: 'ratio', fa: 'نسبت خروجی ۱۶:۹ شد', patch: { output: { ratio: '16:9' } }, invalidate: ['prepare', 'strategy', 'scaffold', 'preview'] };

  // a numbered transcript fix: "خط ۴: متن درست"
  const line = text.match(/^(?:خط|line)\s*(\d{1,3})\s*[:،:]\s*(.+)$/i);
  if (line)
    return {
      kind: 'transcript-line',
      fa: `متن خط ${line[1]} اصلاح شد`,
      meta: { line: Number(line[1]), text: line[2].trim() },
      patch: {},
      invalidate: ['understand', 'strategy', 'scaffold', 'preview'],
    };

  return null;
}

/** Which artifacts a re-run may no longer trust. */
export function invalidateArtifacts(id, stages) {
  const root = jobDir(id);
  const map = {
    prepare: [],
    understand: ['brief.json'],
    strategy: ['brand.json', 'beats.json'],
    scaffold: ['beats.json'],
    preview: [],
  };
  for (const stage of stages) {
    for (const name of map[stage] || []) {
      try {
        fs.rmSync(path.join(root, name), { force: true });
      } catch {
        /* already gone */
      }
    }
  }
}
