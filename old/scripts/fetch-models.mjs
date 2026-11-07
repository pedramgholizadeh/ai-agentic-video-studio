#!/usr/bin/env node
/**
 * fetch-models.mjs — pre-download the offline transcription model so a job
 * that arrives without captions still works when the network is gone.
 *
 *   node scripts/fetch-models.mjs                 # the studio default: whisper "small" (fa-capable, ~465 MB)
 *   node scripts/fetch-models.mjs --model base    # any model hyperframes pins
 *   node scripts/fetch-models.mjs --check         # exit 0 when the model is already cached
 *
 * The model lands in the exact cache hyperframes reads at render time:
 *   ~/.cache/hyperframes/whisper/models/ggml-<model>.bin
 * (override the root with HYPERFRAMES_CACHE_DIR, same as hyperframes).
 *
 * Sizes and SHA-256 pins are copied verbatim from hyperframes@0.9.8's own
 * model table; a file that does not match both is discarded and re-fetched.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { HYPERFRAMES_VERSION } from '../lib/paths.mjs';

/* The pins hyperframes itself enforces (ggerganov/whisper.cpp @ 5359861c). */
const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
const MODELS = new Map(
  [
    ['tiny', 77691713, 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21'],
    ['tiny.en', 77704715, '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f'],
    ['base', 147951465, '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'],
    ['base.en', 147964211, 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'],
    ['small', 487601967, '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'],
    ['small.en', 487614201, 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d'],
    ['medium', 1533763059, '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208'],
    ['medium.en', 1533774781, 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356'],
    ['large-v1', 3094623691, '7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d'],
    ['large-v2', 3094623691, '9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487'],
    ['large-v3', 3095033483, '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'],
    ['large-v3-turbo', 1624555275, '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69'],
  ].map(([name, bytes, sha256]) => [name, { name: `ggml-${name}.bin`, bytes, sha256 }]),
);

const STUDIO_DEFAULT = 'small'; /* smallest multilingual pin — a Persian track still transcribes */

const args = process.argv.slice(2);
const flag = (name, fb) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fb;
};
const model = flag('model', STUDIO_DEFAULT);
const check = args.includes('--check');

const pin = MODELS.get(model);
if (!pin) {
  console.error(`unknown model "${model}". hyperframes@${HYPERFRAMES_VERSION} pins: ${[...MODELS.keys()].join(', ')}`);
  process.exit(2);
}

const cacheRoot = process.env.HYPERFRAMES_CACHE_DIR
  ? path.resolve(process.env.HYPERFRAMES_CACHE_DIR)
  : path.join(os.homedir(), '.cache', 'hyperframes');
const modelsDir = path.join(cacheRoot, 'whisper', 'models');
const target = path.join(modelsDir, pin.name);

const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/${pin.name}`;
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function ok(file) {
  try {
    const st = fs.statSync(file);
    if (st.size !== pin.bytes) return false;
    return !check || sha256(file) === pin.sha256;
  } catch {
    return false;
  }
}

if (ok(target)) {
  const st = fs.statSync(target);
  console.log(`ok — ${pin.name} is cached (${mb(st.size)}) at ${target}`);
  process.exit(0);
}

if (check) {
  console.log(`missing — ${model} is not cached. Run: npm run models`);
  process.exit(1);
}

console.log(`fetching whisper "${model}" → ${target}`);
console.log(`  ${url}`);
console.log(`  ${mb(pin.bytes)}, sha256 ${pin.sha256.slice(0, 16)}…`);

fs.mkdirSync(modelsDir, { recursive: true });
const partial = target + '.part';
fs.rmSync(partial, { force: true });

/* Node fetch has timed out on this box where curl worked; curl also gives a
 * native progress meter and -C - resumes a half-fetched model for free. */
try {
  execFileSync('curl', ['-fL', '--retry', '3', '-C', '-', '-o', partial, url], { stdio: 'inherit' });
} catch (err) {
  if (err?.status !== undefined) {
    console.error(`\ncurl failed (exit ${err.status}). Check the network, then re-run npm run models.`);
    process.exit(1);
  }
  /* no curl on the machine — fall back to Node's own fetch, no progress bar */
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const out = fs.createWriteStream(partial);
  await new Promise((resolve, reject) => {
    res.body.pipe(out);
    res.body.on('error', reject);
    out.on('finish', resolve);
  });
}

const st = fs.statSync(partial);
const digest = sha256(partial);
if (st.size !== pin.bytes || digest !== pin.sha256) {
  fs.rmSync(partial, { force: true });
  console.error(`\nchecksum mismatch — the fetched file was discarded.`);
  console.error(`  size: ${st.size} (expected ${pin.bytes})`);
  console.error(`  sha256: ${digest}`);
  console.error('Check the network/proxy and re-run npm run models.');
  process.exit(1);
}
fs.renameSync(partial, target);
console.log(`ok — ${pin.name} verified (${mb(st.size)}) at ${target}`);
console.log('offline transcription is ready; hyperframes builds its whisper.cpp runtime on first use');
