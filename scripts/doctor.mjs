#!/usr/bin/env node
/**
 * doctor.mjs — the honest pre-flight. Every row is one thing the studio needs;
 * a FAIL in the required block means a render will die mid-way, so say it now.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { STUDIO_ROOT, WORKSPACE, SFX_DIR, COOL_RUN, missingKit } from '../lib/paths.mjs';
import { powerBudget } from '../lib/cool.mjs';
import { readConfig } from '../lib/config.mjs';

let bad = 0;
const row = (ok, label, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? ' ok ' : 'FAIL'} ${label.padEnd(24)} ${detail}`);
};

const version = (cmd, args, re) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).match(re)?.[0] || 'ok';
  } catch {
    return null;
  }
};

const node = process.versions.node;
row(Number(node.split('.')[0]) >= 20, 'node', `v${node} — needs >= 20`);
row(Boolean(version('ffmpeg', ['-version', '-loglevel', 'error'], /ffmpeg version \S+/)), 'ffmpeg', version('ffmpeg', ['-version', '-loglevel', 'error'], /ffmpeg version \S+/) || 'not on PATH');
row(Boolean(version('ffprobe', ['-version', '-loglevel', 'error'], /ffprobe version \S+/)), 'ffprobe', version('ffprobe', ['-version', '-loglevel', 'error'], /ffprobe version \S+/) || 'not on PATH');
row(Boolean(version('npx', ['--version'], /[\d.]+/)), 'npx', `${version('npx', ['--version'], /[\d.]+/) || '—'} — HyperFrames is fetched on first render`);

const power = powerBudget(readConfig().cpu?.pct ?? 50);
row(power.cores > 0, 'cpu cores', `${power.cores} — at ${power.pct}%: ${power.threads} threads, ${power.workers} render worker(s)`);
row(os.totalmem() / 1024 ** 3 >= 4, 'memory', `${Math.round(os.totalmem() / 1024 ** 3)} GB${os.totalmem() / 1024 ** 3 <= 8 ? ' — renders self-limit to one worker' : ''}`);

let freeGb = 0;
try {
  const out = execFileSync('df', ['-g', STUDIO_ROOT], { encoding: 'utf8' }).trim().split('\n');
  freeGb = Number(out[out.length - 1].split(/\s+/)[3]) || 0;
} catch {}
row(freeGb >= 6, 'free disk', `${freeGb} GB for renders and whisper output${freeGb < 6 ? ' — free more space; a 1080p render needs several' : ''}`);
row(fs.existsSync(WORKSPACE) || true, 'workspace', WORKSPACE);

// the render kit — synthesised/fetched on this machine, never committed
const missing = missingKit();
row(missing.length === 0, 'render kit', missing.length ? `missing: ${missing.join(' · ')}` : `sfx kit, GSAP, cool-run wrapper (${COOL_RUN})`);

// the offline model the transcription stage will actually use
const model = readConfig().transcribe?.model || 'large-v3';
const cache = process.env.HYPERFRAMES_CACHE_DIR || path.join(os.homedir(), '.cache', 'hyperframes');
const modelFile = path.join(cache, 'whisper', 'models', `ggml-${model}.bin`);
row(
  fs.existsSync(modelFile),
  `whisper model (${model})`,
  fs.existsSync(modelFile) ? `${(fs.statSync(modelFile).size / 1e9).toFixed(1)} GB in ${path.dirname(modelFile)}` : `not downloaded — run: npm run models -- --model ${model}`,
);

console.log(bad ? `\n${bad} required item(s) missing — the studio will not render until they are fixed.` : '\nRequired tools are present — the studio can render.');
process.exit(bad ? 1 : 0);
