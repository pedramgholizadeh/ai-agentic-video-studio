import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, CONFIG_FILE } from './paths.mjs';

/**
 * Provider presets. Only endpoints that are documented and verifiable are
 * pinned here; anything else (a regional gateway such as پاستا) is entered by
 * the user as a base URL, and the studio speaks the OpenAI-compatible shape it
 * already knows.
 */
export const PROVIDER_PRESETS = [
  {
    id: 'agent',
    fa: 'خودم (عامل هوشمند)',
    base: null,
    models: [],
    note: 'پنل فقط درخواست را ثبت و لاگ را نشان می‌دهد؛ HANDOFF.md را یک عامل هوشمند (Claude Code یا هر CLI) از صف برمی‌دارد و می‌سازد.',
  },
  {
    id: 'studio',
    fa: 'بدون مدل — قوانین خانه',
    base: null,
    models: [],
    note: 'توضیح تو به‌صورت گزینه‌های قطعی (چیدمان، کیفیت، زیرنویس) اعمال می‌شود؛ هیچ درخواست شبکه‌ای زده نمی‌شود.',
  },
  {
    id: 'openrouter',
    fa: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    authHeader: 'Authorization',
    authScheme: 'Bearer ',
    note: 'کتابخانهٔ مدل‌ها از /v1/models خوانده می‌شود.',
  },
  {
    id: '9router',
    fa: '۹روتر (لوکال)',
    base: 'http://127.0.0.1:20128/v1',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    authHeader: 'Authorization',
    authScheme: 'Bearer ',
    note: 'با دستور 9router بالا می‌آید؛ داشبوردش روی همان پورت است.',
  },
  {
    id: 'custom',
    fa: 'سرویس سفارشی (پاستا و…)',
    base: '',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    authHeader: 'Authorization',
    authScheme: 'Bearer ',
    note: 'آدرس پایه و کلید هر سرویس سازگار با OpenAI را خودت وارد کن.',
  },
];

export const DEFAULTS = {
  port: 8790,
  engine: { mode: 'agent', provider: 'agent', model: null },
  output: { ratio: '2:1', background: 'site', layout: 'auto', quality: 'delivery', format: 'mp4', maxMb: 200, fps: 30 },
  motion: { mode: 'motion', deliver: 'overlay', density: 'auto', material: 'glass' },
  sound: { sfx: true, level: 'balanced' },
  cpu: { pct: 50 },
  providers: {
    openrouter: { apiKey: '', model: '' },
    '9router': { apiKey: '', model: '', port: 20128 },
    custom: { apiKey: '', model: '', base: '' },
  },
};

export function readConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    stored = {};
  }
  return deepMerge(structuredClone(DEFAULTS), stored);
}

export function writeConfig(patch) {
  const next = deepMerge(readConfig(), patch);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

/** What the browser may see: the API keys never leave the server. */
export function publicConfig() {
  const cfg = readConfig();
  const providers = {};
  for (const [id, p] of Object.entries(cfg.providers || {})) {
    providers[id] = { ...p, apiKey: undefined, hasKey: Boolean(p.apiKey) };
  }
  return { ...cfg, providers, presets: PROVIDER_PRESETS.map(({ id, fa, base, note }) => ({ id, fa, base, note })) };
}

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = deepMerge(a[k] || {}, v);
    else if (v !== undefined) a[k] = v;
  }
  return a;
}
