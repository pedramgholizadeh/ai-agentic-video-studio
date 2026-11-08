#!/usr/bin/env node
/**
 * download-model.mjs <url> <dest> [expectedBytes]
 *
 * A stubborn little downloader: resumes from <dest>.part, retries with
 * backoff until it gives up (the app's button restarts it — progress is
 * never thrown away), and reports one progress line per 2 MiB so a log
 * tail shows life. Cross-platform on purpose: the desktop app calls it on
 * macOS and Windows alike.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const [url, dest, expectedArg] = process.argv.slice(2);
if (!url || !dest) {
  console.error('usage: download-model.mjs <url> <dest> [expectedBytes]');
  process.exit(2);
}
const part = `${dest}.part`;
const expected = Number(expectedArg) || null;
let lastReported = 0;

async function once() {
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (expected && have >= expected) return true;
  const res = await fetch(url, have > 0 ? { headers: { Range: `bytes=${have}-` } } : {});
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) + have || expected || 0;
  let written = have;
  let lastYield = 0;
  const out = fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
  for await (const chunk of res.body) {
    written += chunk.length;
    if (written - lastYield > 2 * 1024 * 1024) {
      lastYield = written;
      console.log(`progress ${written}${total ? `/${total}` : ''}`);
    }
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((r) => out.end(r));
  if (expected && fs.statSync(part).size < expected) throw new Error(`truncated (${fs.statSync(part).size}/${expected})`);
  return true;
}

for (let attempt = 1; attempt <= 40; attempt++) {
  try {
    await once();
    fs.renameSync(part, dest);
    console.log(`done ${fs.statSync(dest).size}`);
    process.exit(0);
  } catch (err) {
    console.error(`attempt ${attempt} failed: ${String(err.message || err).slice(0, 160)}`);
    await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * attempt)));
  }
}
console.error('gave up — progress kept; press download again to resume');
process.exit(1);
