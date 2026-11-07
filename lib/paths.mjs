import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/*
 * Every absolute location the studio knows about is defined once, here.
 * Nothing else in the codebase walks up out of the repo or hard-codes a home
 * directory, so the project runs from any checkout on any machine.
 */

/** The repository itself: code, templates and the generated kit live inside it. */
export const STUDIO_ROOT = path.resolve(here, '..');
export const CLI = path.join(STUDIO_ROOT, 'cli.mjs');
export const MOTION_SCRIPT = path.join(STUDIO_ROOT, 'scripts', 'motion.mjs');

/** Starter HyperFrames projects the panel copies for each job. */
export const TEMPLATE_DIR = path.join(STUDIO_ROOT, 'templates', 'video-2x1');
export const OVERLAY_TEMPLATE_DIR = path.join(STUDIO_ROOT, 'templates', 'overlay-2x1');

/** The caption engine (parse / plan / build an SRT) and the icon tool. */
export const SRT_TOOL = path.join(STUDIO_ROOT, 'engine', 'srt.mjs');
export const FETCH_ICONS_TOOL = path.join(STUDIO_ROOT, 'engine', 'fetch-icons.mjs');

/**
 * The studio's own sound and motion kit. The MP3 kit and GSAP are not committed
 * (see NOTICE.md): `npm run setup` synthesises the sound effects and fetches
 * the animation library.
 */
export const STUDIO_ASSETS = path.join(STUDIO_ROOT, 'assets');
export const SFX_DIR = path.join(STUDIO_ASSETS, 'sfx');
export const SFX_INDEX = path.join(STUDIO_ASSETS, 'sfx-index.json');
export const MOTION_TEMPLATE = path.join(STUDIO_ASSETS, 'overlay-template');
export const ICON_MODULE = path.join(MOTION_TEMPLATE, 'modules', 'icons.js');

/**
 * Everything a user produces — source videos, HyperFrames projects, renders —
 * lives in one writable directory that is never committed. Override with
 * `VIDEO_STUDIO_HOME` to keep renders on another volume.
 */
export const WORKSPACE = process.env.VIDEO_STUDIO_HOME
  ? path.resolve(process.env.VIDEO_STUDIO_HOME)
  : path.join(STUDIO_ROOT, 'workspace');
export const JOBS_ROOT = path.join(WORKSPACE, 'jobs');
export const CONFIG_DIR = path.join(WORKSPACE, '.studio');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
/** The studio-wide brand tokens — one token set governs the whole film. */
export const BRAND_FILE = path.join(CONFIG_DIR, 'brand.json');
/** Raw uploads land here; jobs reference them by absolute path. */
export const UPLOADS_DIR = path.join(CONFIG_DIR, 'uploads');
/**
 * The reference memory: every analysed reference video gets one folder keyed by
 * its content hash, so the studio can suggest it again on any later job
 * (lib/references.mjs).
 */
export const REFERENCES_ROOT = path.join(WORKSPACE, 'references');

const coolCandidates = [
  process.env.COOL_RUN,
  path.join(STUDIO_ROOT, 'tools', 'cool-render', 'cool-run'),
  path.join(os.homedir(), '.qoder', 'skills', 'cool-render', 'scripts', 'cool-run'),
].filter(Boolean);

/**
 * The cool-render wrapper that caps every media job at the configured CPU
 * share, or null when it is missing — the studio then warns instead of
 * silently overheating.
 */
export const COOL_RUN = coolCandidates.find((p) => fs.existsSync(p)) ?? null;
export const FIT_SIZE = COOL_RUN ? path.join(path.dirname(COOL_RUN), 'fit-size') : null;

/** HyperFrames is used through npx so the repo carries no dependency of its own. */
export const HYPERFRAMES_VERSION = process.env.HYPERFRAMES_VERSION || '0.9.8';

export function npxHyperframes(args, { version = HYPERFRAMES_VERSION } = {}) {
  return { cmd: 'npx', args: ['--yes', `hyperframes@${version}`, ...args] };
}

export function jobDir(id) {
  return path.join(JOBS_ROOT, id);
}

/** What a fresh checkout is still missing, in plain words, for `npm run doctor`. */
export function missingKit() {
  const missing = [];
  if (!fs.existsSync(SFX_DIR)) missing.push('sound-effect kit (npm run sfx)');
  if (!fs.existsSync(path.join(MOTION_TEMPLATE, 'assets', 'vendor', 'gsap.min.js')))
    missing.push('GSAP animation library (npm run vendor)');
  if (!COOL_RUN) missing.push('cool-render power wrapper (tools/cool-render)');
  return missing;
}
