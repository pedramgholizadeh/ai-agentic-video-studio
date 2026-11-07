#!/usr/bin/env node
/**
 * Fetch the one runtime dependency the compositions need: GSAP.
 *
 * It is not committed to git. GreenSock's standard licence allows free use in
 * your own projects but is not a redistribution grant, so a fresh clone pulls
 * the pinned build at setup time and checks its SHA-256 before installing it.
 * See NOTICE.md.
 *
 *   node scripts/vendor.mjs            # install where missing
 *   node scripts/vendor.mjs --force    # re-download and overwrite
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STUDIO_ROOT } from '../lib/paths.mjs';

const VERSION = process.env.GSAP_VERSION || '3.15.1';
/* sha256 of dist/gsap.min.js for that version — the file is immutable, so a
 * mismatch means the CDN served something else and must not be installed. */
const SHA256 = process.env.GSAP_SHA256 || '3d1bea374ab1b703cc5c4105358eec63c4465efdc573931dc116e34a0a190c1b';
const SOURCES = [
  `https://cdn.jsdelivr.net/npm/gsap@${VERSION}/dist/gsap.min.js`,
  `https://unpkg.com/gsap@${VERSION}/dist/gsap.min.js`,
];

/* Each HyperFrames project the studio builds from carries its own copy, because
 * the renderer loads composition scripts over file:// with no module resolution. */
const TARGETS = [
  'templates/video-2x1/assets/vendor/gsap.min.js',
  'templates/overlay-2x1/assets/vendor/gsap.min.js',
  'assets/overlay-template/assets/vendor/gsap.min.js',
].map((rel) => path.join(STUDIO_ROOT, rel));

const force = process.argv.includes('--force');

/**
 * node:fetch is tried first, then curl and wget. Behind a proxy that only the
 * system curl is configured for — the common case on a managed machine — the
 * fallback is the difference between a working setup and a stack trace.
 */
function viaShell(url) {
  for (const [cmd, args] of [
    ['curl', ['-fsSL', '--max-time', '90', url]],
    ['wget', ['-qO-', '--timeout=90', url]],
  ]) {
    const p = spawnSync(cmd, args, { encoding: 'buffer' });
    if (p.status === 0 && p.stdout && p.stdout.length) return p.stdout;
  }
  return null;
}

async function download() {
  let err;
  for (const url of SOURCES) {
    try {
      let body = null;
      try {
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        body = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        body = viaShell(url);
        if (!body) throw e;
      }
      if (!body.length) throw new Error('empty response');
      const sum = crypto.createHash('sha256').update(body).digest('hex');
      if (sum !== SHA256)
        throw new Error(`checksum mismatch — got ${sum}, expected ${SHA256} (gsap@${VERSION})`);
      return { body, url };
    } catch (e) {
      err = e;
      console.warn(`  ${url} failed: ${e.message}`);
    }
  }
  throw err ?? new Error('no source reachable');
}

const present = TARGETS.filter((t) => fs.existsSync(t));
if (present.length === TARGETS.length && !force) {
  console.log(`gsap@${VERSION} already vendored in ${present.length} places (use --force to refetch)`);
  process.exit(0);
}

console.log(`fetching gsap@${VERSION} …`);
const { body, url } = await download();
for (const t of TARGETS) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, body);
  console.log(`  ${path.relative(STUDIO_ROOT, t)}  ${Math.round(body.length / 1024)} kB`);
}
console.log(`ok — gsap@${VERSION} sha256 verified from ${new URL(url).host}`);
console.log('licence: GreenSock standard licence — see NOTICE.md before redistributing this file.');
