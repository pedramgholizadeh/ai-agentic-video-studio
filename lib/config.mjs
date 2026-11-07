import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, CONFIG_FILE } from './paths.mjs';

/**
 * API-brain presets — used for the understanding and strategy stages when the
 * user picks a provider instead of a code agent at stage zero. Only endpoints
 * that speak the OpenAI-compatible shape are listed; anything else is entered
 * by the user as a base URL.
 */
export const PROVIDER_PRESETS = [
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
    id: 'zai',
    fa: 'Z.ai (GLM)',
    base: 'https://api.z.ai/api/paas/v4',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    authHeader: 'Authorization',
    authScheme: 'Bearer ',
    note: 'نقطهٔ پایهٔ GLM؛ کلید را از z.ai می‌گیری.',
  },
  {
    id: 'paasta',
    fa: 'پاستا (Paasta.cloud)',
    base: 'https://api.paasta.cloud/api/v1',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    authHeader: 'Authorization',
    authScheme: 'Bearer ',
    note: 'دروازهٔ ایرانی؛ اگر آدرس پایه فرق داشت، خودت واردش کن.',
  },
  {
    id: 'custom',
    fa: 'سرویس سفارشی',
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
  engine: { mode: 'agent', agent: 'opencode', provider: 'openrouter', model: null },
  output: { ratio: '16:9', quality: 'delivery', maxMb: 200, fps: 30, captions: true },
  motion: { density: 'auto', material: 'glass' },
  sound: { sfx: true, level: 'balanced' },
  transcribe: { model: 'large-v3', language: 'fa' },
  cpu: { pct: 50 },
  providers: {
    openrouter: { apiKey: '', model: '' },
    zai: { apiKey: '', model: '' },
    paasta: { apiKey: '', model: '', base: '' },
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
