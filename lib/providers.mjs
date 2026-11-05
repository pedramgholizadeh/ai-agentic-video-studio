import { PROVIDER_PRESETS, readConfig } from './config.mjs';

export function preset(id) {
  return PROVIDER_PRESETS.find((p) => p.id === id) || PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

/** Base URL, key and model, resolved from the preset plus the stored config. */
export function resolveProvider(id) {
  const cfg = readConfig();
  const p = preset(id);
  const stored = cfg.providers?.[id] || {};
  const base = (id === 'custom' ? stored.base || p.base : p.base) || '';
  return {
    id,
    fa: p.fa,
    base: base.replace(/\/+$/, ''),
    apiKey: stored.apiKey || '',
    model: stored.model || '',
    note: p.note,
    modelsUrl: base ? `${base.replace(/\/+$/, '')}${p.modelsPath || '/models'}` : null,
    chatUrl: base ? `${base.replace(/\/+$/, '')}${p.chatPath || '/chat/completions'}` : null,
  };
}

async function jsonFetch(url, { apiKey, headers = {}, ...rest }) {
  const res = await fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(rest.timeoutMs || 30000),
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 240)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`پاسخ JSON نبود: ${text.slice(0, 200)}`);
  }
}

export async function listModels(id) {
  const p = resolveProvider(id);
  if (!p.modelsUrl) return { models: [], note: p.note, provider: p.id, local: true };
  const body = await jsonFetch(p.modelsUrl, { apiKey: p.apiKey });
  const list = Array.isArray(body) ? body : body.data || body.models || [];
  return {
    provider: p.id,
    models: list
      .map((m) => (typeof m === 'string' ? { id: m, name: m } : { id: m.id, name: m.name || m.id }))
      .filter((m) => m.id)
      .slice(0, 400),
  };
}

const SYSTEM = `You are the edit director for a Persian (RTL, Vazirmatn) video rendered by HyperFrames.
Rules:
- Facts are sacred. Never invent a headline, number, claim, name or CTA. Reuse only words that appear in the transcript or in the user's own brief.
- Reply with ONE JSON object and nothing else. No markdown fences, no commentary.
- Shape:
{"title":{"kicker":"","headline":"","accentWord":"","sub":""},
 "endcard":{"name":"","site":""},
 "layout":"cover|contain|split|auto",
 "captions":{"hotWords":[""]},
 "beats":[{"at":0,"action":""}],
 "notes":""}
- headline: 2 to 5 words, taken from the strongest line of the transcript. accentWord: exactly one word inside the headline.
- hotWords: at most 4 transcript words that deserve the mint highlight.
- layout: "split" only for a 9:16 or 3:4 canvas with a talking head; "cover" when the picture already matches the canvas ratio; otherwise "contain".
- beats: at most 8 suggestions, each a whole second with a one-line motion idea in Persian.`;

/**
 * Ask a model for the direction of the edit. It decides presentation only —
 * the deterministic composer still renders everything, so a wrong or missing
 * answer degrades to the brand defaults instead of failing the job.
 */
export async function askDirection({ provider, model, brief, transcript, canvas, background }) {
  const p = resolveProvider(provider);
  const chosen = model || p.model;
  if (!p.chatUrl) throw new Error(`سرویس ${p.fa} آدرس API ندارد؛ در تنظیمات وارد کنید.`);
  if (!chosen) throw new Error('مدل انتخاب نشده است.');

  const user = [
    `Canvas: ${canvas.w}×${canvas.h} (${canvas.id}), 30 fps, Persian RTL.`,
    `Background design: ${background}.`,
    `User's brief (verbatim): ${brief || '(nothing written)'}`,
    `Transcript (SRT text, verbatim):\n${transcript || '(no transcript)'}`,
    'Return the JSON object now.',
  ].join('\n\n');

  const body = await jsonFetch(p.chatUrl, {
    apiKey: p.apiKey,
    timeoutMs: 90000,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: chosen,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    }),
  });

  const content = body?.choices?.[0]?.message?.content ?? body?.message?.content ?? body?.content ?? '';
  const plan = parseJsonLoose(String(content));
  if (!plan) throw new Error(`خروجی ${p.fa} JSON قابل‌فهم نبود: ${String(content).slice(0, 180)}`);
  return { plan, raw: String(content).slice(0, 4000), provider: p.id, model: chosen };
}

function parseJsonLoose(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** A short text preview of what a direction plan changes, for the log. */
export function describePlan(plan) {
  if (!plan) return 'بدون تغییر';
  const bits = [];
  if (plan.layout) bits.push(`چیدمان ${plan.layout}`);
  if (plan.title?.headline) bits.push(`تیتر «${plan.title.headline}»`);
  if (plan.captions?.hotWords?.length) bits.push(`تأکید: ${plan.captions.hotWords.join('، ')}`);
  if (plan.beats?.length) bits.push(`${plan.beats.length} پیشنهاد حرکت`);
  return bits.join(' — ') || 'هیچ فیلدی برگشت نیامد';
}
