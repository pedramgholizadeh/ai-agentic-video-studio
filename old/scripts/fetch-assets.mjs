#!/usr/bin/env node
/**
 * fetch-assets.mjs — the asset store's download service.
 *
 *   npm run assets                       # fetch every missing fetched-pack
 *   npm run assets -- --check            # exit 0 when everything is already in the store
 *   npm run assets -- --only tex-metal043a
 *   npm run assets -- --auto --for-job <id>   # the curator: fetch what THAT film needs
 *
 * Downloads are pinned (bytes + SHA-256) and extracted only for the files the
 * studio actually wires in. A mismatched archive is discarded, never installed.
 * What the store holds and why it is licensed the way it is: lib/assets.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PACKS, packById, packDir, packStatus, needsOf, storeReport, GENERATED_PACK } from '../lib/assets.mjs';

const args = process.argv.slice(2);
const flag = (name, fb) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fb;
};
const has = (name) => args.includes(`--${name}`);
const check = has('check');
const auto = has('auto');
const jobId = flag('for-job', null);
const only = flag('only', null);
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function unzip(src, pack) {
  const dir = packDir(pack);
  fs.mkdirSync(dir, { recursive: true });
  for (const [inZip, outName] of Object.entries(pack.extract)) {
    const out = path.join(dir, outName);
    try {
      execFileSync('unzip', ['-o', src, inZip, '-d', dir], { stdio: 'pipe' });
      const landed = path.join(dir, inZip);
      fs.renameSync(landed, out);
    } catch (err) {
      console.error(`  unzip failed for ${inZip} — is unzip installed? (${err.message})`);
      process.exitCode = 1;
      return false;
    }
  }
  return true;
}

async function fetchPack(pack) {
  const { present } = packStatus(pack);
  if (present) {
    console.log(`ok — ${pack.id} already in the store`);
    return true;
  }
  console.log(`fetching ${pack.id} — ${pack.fa}`);
  console.log(`  ${pack.source}`);
  console.log(`  ${mb(pack.bytes)}, ${pack.licence}, sha256 ${pack.sha256.slice(0, 16)}…`);
  const tmp = path.join(packDir(pack), '.part.zip');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.rmSync(tmp, { force: true });
  try {
    execFileSync('curl', ['-fL', '--retry', '3', '-C', '-', '-o', tmp, pack.source], { stdio: 'inherit' });
  } catch (err) {
    console.error(`  download failed (${err.message}). Re-run npm run assets.`);
    process.exitCode = 1;
    return false;
  }
  const st = fs.statSync(tmp);
  const digest = sha256(tmp);
  if (st.size !== pack.bytes || digest !== pack.sha256) {
    fs.rmSync(tmp, { force: true });
    console.error(`  checksum mismatch — discarded. size ${st.size}/${pack.bytes}`);
    process.exitCode = 1;
    return false;
  }
  const ok = unzip(tmp, pack);
  fs.rmSync(tmp, { force: true });
  if (ok) console.log(`  ok — installed into ${packDir(pack)}`);
  return ok;
}

function wantedPackIds() {
  if (only) return [only];
  if (auto && jobId) {
    /* the curator: read that job's plan and beat sheet, fetch what it needs */
    const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
    const root = path.resolve('workspace', 'jobs', jobId);
    const plan = read(path.join(root, 'plan.json'));
    const sheet = read(path.join(root, 'beats.json'));
    if (!plan && !sheet) {
      console.error(`job ${jobId} has no plan.json/beats.json yet`);
      process.exitCode = 1;
      return [];
    }
    const needed = needsOf(plan || {}, sheet || {});
    const missing = needed.filter((id) => !packStatus(packById(id)).present);
    console.log(`curator: ${jobId} needs [${needed.join(', ') || 'nothing'}] — fetching [${missing.join(', ') || 'nothing'}]`);
    return missing;
  }
  return PACKS.map((p) => p.id).filter((id) => !packStatus(packById(id)).present);
}

const ids = wantedPackIds();
if (check) {
  const report = storeReport();
  const missing = report.packs.filter((p) => !p.status.present);
  const gen = report.generated.status.present ? 'ok' : `run ${GENERATED_PACK.script}`;
  console.log(`store ${report.root}`);
  console.log(`  generated: ${gen}`);
  for (const p of report.packs) console.log(`  ${p.status.present ? 'ok  ' : 'miss'} ${p.id} (${p.licence}, ${mb(p.bytes)})`);
  process.exit(missing.length ? 1 : 0);
}

let bad = 0;
for (const id of ids) {
  const pack = packById(id);
  if (!pack) {
    console.error(`unknown pack "${id}"`);
    bad++;
    continue;
  }
  if (!(await fetchPack(pack))) bad++;
}
if (bad) {
  console.error(`\n${bad} pack(s) failed — everything else is in the store.`);
  process.exit(1);
}
console.log(`\nasset store ready — ${ids.length} pack(s) processed this run`);
