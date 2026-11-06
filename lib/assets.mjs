/* assets.mjs — the studio's asset store.
 *
 * Two kinds of packs:
 *   • generated — synthesised on the machine (`npm run textures`), CC0-clean by
 *     construction, same philosophy as the SFX kit;
 *   • fetched — pinned upstream downloads (URL + bytes + SHA-256), only from
 *     sources whose licence lets us store them locally (CC0 textures, OFL
 *     fonts). Nothing licensed-for-redistribution is committed.
 *
 * Every pack declares `wire` tags; `needsOf` maps a job's plan and beat sheet
 * onto those tags, so the runner fetches exactly what the film needs before
 * the project is written — the auto part of "one click".
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { STUDIO_ROOT } from './paths.mjs';

export const STORE_ROOT = path.join(STUDIO_ROOT, 'assets', 'store');
export const GENERATED_DIR = path.join(STORE_ROOT, 'generated');

export const PACKS = [
  {
    id: 'font-jetbrains-mono',
    kind: 'fetched',
    fa: 'قلم مونوی ترمینال',
    what: 'JetBrains Mono — the terminal card’s typeface, identical on every OS instead of a per-machine fallback',
    licence: 'OFL-1.1',
    upstream: 'https://www.jetbrains.com/lp/mono/',
    source: 'https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip',
    bytes: 5622857,
    sha256: '6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf',
    extract: {
      'fonts/webfonts/JetBrainsMono-Regular.woff2': 'JetBrainsMono-Regular.woff2',
      'fonts/webfonts/JetBrainsMono-Medium.woff2': 'JetBrainsMono-Medium.woff2',
      'fonts/webfonts/JetBrainsMono-Bold.woff2': 'JetBrainsMono-Bold.woff2',
    },
    wire: ['terminal'],
  },
  {
    id: 'tex-metal043a',
    kind: 'fetched',
    fa: 'بافت فلز مات',
    what: 'brushed dark metal 1K texture — the product-closeup ground (house rule Q7)',
    licence: 'CC0-1.0',
    upstream: 'https://ambientcg.com/view?id=Metal043A',
    source: 'https://ambientcg.com/get?file=Metal043A_1K-JPG.zip',
    bytes: 4876952,
    sha256: '78c9c68dd032f250d9aa000e498fb1facbeb4f993cb18bde2bc676258d57b55f',
    extract: { 'Metal043A_1K-JPG_Color.jpg': 'metal043a.jpg' },
    wire: ['bg-metal'],
  },
  {
    id: 'tex-concrete034',
    kind: 'fetched',
    fa: 'بافت بتن',
    what: 'raw concrete 1K texture — an honest industrial ground',
    licence: 'CC0-1.0',
    upstream: 'https://ambientcg.com/view?id=Concrete034',
    source: 'https://ambientcg.com/get?file=Concrete034_1K-JPG.zip',
    bytes: 3657575,
    sha256: '5839d284d94ffb8d2a56df742ec522b13dd311c52dbd42b8fd33f0409ceedb81',
    extract: { 'Concrete034_1K-JPG_Color.jpg': 'concrete034.jpg' },
    wire: ['bg-concrete'],
  },
  {
    id: 'tex-fabric066',
    kind: 'fetched',
    fa: 'بافت پارچه',
    what: 'woven fabric 1K texture — soft tactile ground for low-energy films',
    licence: 'CC0-1.0',
    upstream: 'https://ambientcg.com/view?id=Fabric066',
    source: 'https://ambientcg.com/get?file=Fabric066_1K-JPG.zip',
    bytes: 9676056,
    sha256: 'bcd274190979010b2056cab1b10d0420da6e2f58a8e1cf37bc527d8a67772684',
    extract: { 'Fabric066_1K-JPG_Color.jpg': 'fabric066.jpg' },
    wire: ['bg-fabric'],
  },
];

/** The generated pack is built, not downloaded; its files are checked for. */
export const GENERATED_PACK = {
  id: 'tex-generated',
  kind: 'generated',
  fa: 'گرین و بافت‌های سینتزی',
  what: 'tileable film grain + fine noise, rendered by ffmpeg — no licence to worry about',
  licence: 'generated (CC0-equivalent)',
  files: ['grain.png'],
  wire: ['bg-grain', 'grain-overlay'],
  script: 'npm run textures',
};

export function packById(id) {
  return PACKS.find((p) => p.id === id);
}

export function packDir(pack) {
  return path.join(STORE_ROOT, pack.id);
}

/** A fetched pack is present when every extracted file exists at its pinned size. */
export function packStatus(pack) {
  const dir = packDir(pack);
  const files = Object.values(pack.extract || {});
  const missing = files.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) return { present: false, missing };
  return { present: true, missing: [] };
}

export function generatedStatus() {
  return {
    present: GENERATED_PACK.files.every((f) => fs.existsSync(path.join(GENERATED_DIR, f))),
    files: GENERATED_PACK.files.map((f) => path.join(GENERATED_DIR, f)),
  };
}

/**
 * Which packs a film needs. `plan` is the job plan (background, motion), and
 * `sheet` — when the beat sheet already exists — tells us whether a terminal
 * card will be drawn.
 */
export function needsOf(plan = {}, sheet = null) {
  const need = new Set();
  const bg = plan.background || plan.output?.background;
  if (bg === 'metal' || bg === 'metal-texture') need.add('bg-metal');
  if (bg === 'concrete') need.add('bg-concrete');
  if (bg === 'fabric') need.add('bg-fabric');
  if (bg === 'grain' || bg === 'grain-film') need.add('grain-overlay');
  if (sheet) {
    for (const b of sheet.beats || []) {
      if (b.draw === 'terminal') need.add('terminal');
    }
  }
  return PACKS.filter((p) => (p.wire || []).some((w) => need.has(w))).map((p) => p.id);
}

/** Status of everything the store can hold, for the panel, doctor and page. */
export function storeReport() {
  return {
    root: STORE_ROOT,
    generated: { ...GENERATED_PACK, status: generatedStatus() },
    packs: PACKS.map((p) => ({ ...p, status: packStatus(p) })),
  };
}

/* ------------------------------------------------------- render wiring ---- */

const BACKGROUND_TEXTURE = {
  metal: { pack: 'tex-metal043a', file: 'metal043a.jpg' },
  concrete: { pack: 'tex-concrete034', file: 'concrete034.jpg' },
  fabric: { pack: 'tex-fabric066', file: 'fabric066.jpg' },
};

/** The store files a film's stage wants, as {name, src} to copy into the
 * project's assets/store/ — the grain plate and, when the background asks for
 * it, its texture. */
export function projectStoreFiles(plan = {}) {
  const out = [];
  const grain = path.join(GENERATED_DIR, 'grain.png');
  if (fs.existsSync(grain)) out.push({ name: 'grain.png', src: grain });
  const tex = BACKGROUND_TEXTURE[plan.background];
  if (tex) {
    const src = path.join(packDir(packById(tex.pack)), tex.file);
    if (fs.existsSync(src)) out.push({ name: tex.file, src });
  }
  return out;
}

/** The terminal typeface, when the store has it — the writer adds the
 * @font-face and points --mono-terminal at it. */
export function terminalFonts() {
  const dir = path.join(packDir(packById('font-jetbrains-mono')));
  const weights = ['Regular', 'Medium', 'Bold'];
  const out = [];
  for (const w of weights) {
    const src = path.join(dir, `JetBrainsMono-${w}.woff2`);
    if (fs.existsSync(src)) out.push({ weight: w, name: `JetBrainsMono-${w}.woff2`, src });
  }
  return out;
}

/**
 * The runner's curator: make sure every pack this film needs is in the store
 * before the project is written. Network is allowed here — the transcription
 * stage already assumes it — and a failure is only a warning: every wired-in
 * asset has a code-drawn fallback.
 */
export function ensureAssetsFor(plan = {}, sheet = null, log = () => {}) {
  const ids = needsOf(plan, sheet).filter((id) => !packStatus(packById(id)).present);
  if (!ids.length) return;
  const script = path.join(STUDIO_ROOT, 'scripts', 'fetch-assets.mjs');
  for (const id of ids) {
    log(`asset store: fetching ${id}`);
    try {
      execFileSync(process.execPath, [script, '--only', id], { stdio: 'pipe', timeout: 240000 });
      log(`asset store: ${id} ready`);
    } catch (err) {
      log(`asset store: ${id} could not be fetched — the code-drawn fallback takes over (${String(err.message).slice(0, 80)})`);
    }
  }
}
