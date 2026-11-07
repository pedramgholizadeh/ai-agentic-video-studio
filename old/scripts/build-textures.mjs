#!/usr/bin/env node
/**
 * build-textures.mjs — the generated half of the asset store.
 *
 *   npm run textures          # (re)build the synthesised textures
 *   npm run textures -- --force
 *
 * A tileable film-grain plate is rendered with ffmpeg's noise source into
 * assets/store/generated/ — no licence to trace, nothing downloaded, and the
 * render is deterministic (fixed seed), so two machines build identical files.
 * The grain background prefers this plate over the per-frame SVG turbulence
 * filter, which costs real CPU at 30 fps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GENERATED_DIR } from '../lib/assets.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');

function has(bin, versionArgs = ['-version']) {
  try {
    execFileSync(bin, versionArgs, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

if (!has('ffmpeg')) {
  console.error('ffmpeg not found — the synthesised textures need it (npm run doctor).');
  process.exit(1);
}

fs.mkdirSync(GENERATED_DIR, { recursive: true });

/* Monochrome grain, 1080×1080, fixed seed — the classic noise-over-gray
 * recipe. One plate is re-used at every scale by the stage CSS
 * (background-repeat). */
const grain = path.join(GENERATED_DIR, 'grain.png');
if (fs.existsSync(grain) && !force) {
  console.log(`ok — ${grain} exists (force with --force)`);
  process.exit(0);
}
console.log('building grain plate (1080×1080, seeded noise)…');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'color=gray:s=1080x1080:r=1:d=1',
    '-vf', 'noise=alls=42:allf=t+u,eq=saturation=0',
    '-frames:v', '1',
    grain,
  ],
  { stdio: 'inherit' },
);
const st = fs.statSync(grain);
if (st.size < 10000) {
  fs.rmSync(grain, { force: true });
  console.error('grain plate came out empty — discarded');
  process.exit(1);
}
console.log(`ok — ${grain} (${Math.round(st.size / 1024)} KB)`);
