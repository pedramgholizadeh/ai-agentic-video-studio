#!/usr/bin/env node
/**
 * Check this machine against what the studio actually needs, and say so in
 * plain words. Run it before the first job and after anything stops working:
 *
 *   npm run doctor
 *
 * Required: Node 20+, ffmpeg + ffprobe (every measurement is made with them).
 * Needed for a render: HyperFrames, which comes down through npx on first use.
 * Needed for the sound design: the synthesised kit (`npm run sfx`).
 * Needed to keep the machine cool: the cool-render wrapper (`tools/cool-render`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  COOL_RUN,
  HYPERFRAMES_VERSION,
  JOBS_ROOT,
  SFX_DIR,
  WORKSPACE,
  missingKit,
} from '../lib/paths.mjs';

const rows = [];
const add = (label, ok, detail, kind = 'required') => rows.push({ label, ok, detail, kind });

function has(bin, versionArgs = ['-version']) {
  const p = spawnSync(bin, versionArgs, { encoding: 'utf8', timeout: 20000 });
  if (p.status !== 0) return null;
  const line = `${p.stdout || ''}${p.stderr || ''}`.split('\n')[0] || '';
  return line.trim().slice(0, 60) || 'present';
}

const node = process.versions.node;
add('node', Number(node.split('.')[0]) >= 20, `v${node}`);
const ff = has('ffmpeg');
add('ffmpeg', !!ff, ff ?? 'not found — every measurement and render needs it');
const fp = has('ffprobe');
add('ffprobe', !!fp, fp ?? 'not found');
const np = has('npx', ['--version']);
add('npx', !!np, np ? `${np} — HyperFrames ${HYPERFRAMES_VERSION} is fetched on first render` : 'not found');

const gb = (bytes) => Math.round((bytes / 1073741824) * 10) / 10;
add('cpu cores', os.cpus().length >= 2, `${os.cpus().length} × ${os.cpus()[0]?.model ?? ''}`.trim(), 'info');
add('memory', os.totalmem() >= 6 * 1073741824, `${gb(os.totalmem())} GB — HyperFrames self-limits below 8 GB`, 'info');

let diskFree = null;
try {
  const probe = fs.existsSync(WORKSPACE) ? WORKSPACE : path.dirname(WORKSPACE);
  const st = fs.statfsSync ? fs.statfsSync(probe) : null;
  if (st) diskFree = gb(st.bavail * st.bsize);
} catch {
  diskFree = null;
}
add('free disk', diskFree === null || diskFree >= 4, diskFree === null ? 'unknown' : `${diskFree} GB for renders`);

add('workspace', fs.existsSync(JOBS_ROOT) || mkdirs(), WORKSPACE, 'info');
const kit = fs.existsSync(SFX_DIR) ? fs.readdirSync(SFX_DIR).filter((d) => fs.statSync(path.join(SFX_DIR, d)).isDirectory()).length : 0;
add('sound-effect kit', kit > 0, kit ? `${kit} categories in ${SFX_DIR}` : 'run npm run sfx', 'optional');

/* Offline transcription: the whisper model the studio runs when a job arrives
 * without captions. Present → a job works with the network unplugged. */
const modelPath = (() => {
  const root = process.env.HYPERFRAMES_CACHE_DIR
    ? path.resolve(process.env.HYPERFRAMES_CACHE_DIR)
    : path.join(os.homedir(), '.cache', 'hyperframes');
  return path.join(root, 'whisper', 'models', 'ggml-small.bin');
})();
const modelOk = fs.existsSync(modelPath) && fs.statSync(modelPath).size > 100 * 1024 * 1024;
add(
  'whisper model (offline)',
  modelOk,
  modelOk ? `${modelPath}` : 'missing — jobs without captions need the network; run npm run models',
  'optional',
);

add('cool-render wrapper', !!COOL_RUN, COOL_RUN ?? 'renders would run at full CPU — see tools/cool-render', 'optional');

for (const m of missingKit()) add('setup step', false, m, 'optional');

function mkdirs() {
  try {
    fs.mkdirSync(JOBS_ROOT, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

const icon = (r) => (r.ok ? ' ok  ' : r.kind === 'optional' || r.kind === 'info' ? ' warn ' : ' FAIL ');
const width = Math.max(...rows.map((r) => r.label.length));
for (const r of rows) console.log(`${icon(r)} ${r.label.padEnd(width)}  ${r.detail}`);

const failing = rows.filter((r) => !r.ok && r.kind === 'required');
console.log(
  failing.length
    ? `\n${failing.length} required item(s) missing — the studio will not render until they are installed.`
    : '\nRequired tools are present. Optional gaps cost features, not correctness.',
);
process.exitCode = failing.length ? 1 : 0;
