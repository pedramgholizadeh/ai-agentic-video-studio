#!/usr/bin/env node
/**
 * Inventory every Persian string a user can end up seeing, so the panel's
 * English dictionary is generated from the code instead of from memory.
 *
 *   node scripts/extract-i18n.mjs            # write workspace/i18n-phrases.json
 *   node scripts/extract-i18n.mjs --coverage # report what ui/i18n.js still misses
 *
 * Sources are the panel (markup and its JS) and the strings the engine writes
 * into the job log, the stage manifest and the error banners, because those
 * reach the browser too. Comments are stripped first: they are for contributors,
 * not for the interface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STUDIO_ROOT, WORKSPACE } from '../lib/paths.mjs';

const HAS_FA = /[؀-ۿ]/;
/* Text a reader could see: everything that is not a quote, a brace, a tag or an
 * expression marker. `${fa(n)} ثانیه` therefore yields "ثانیه" as its own run,
 * which is exactly the granularity the runtime translator has to match. */
const TEXT_RUN = /[^"'`;{}()<>|$\\&=+*/\n\r]+/g;

const UI_FILES = ['ui/index.html', 'ui/download.html', 'ui/app.js', 'ui/engine.js'];
/* SEO meta descriptions are for crawlers, not for the interface — they carry
 * mixed-script sentences the panel never renders as chrome. */
const STRIP_META = /<meta\s+name="description"[^>]*>/gi;
const ENGINE_FILES = ['server.mjs', 'cli.mjs'];
/* These files speak Persian *about data*, not about the interface: the filler
 * word list that keeps a card from reading like a slogan, the Persian→icon
 * keyword map, the caption engine's orthography rules. Their strings never
 * reach the panel as chrome, and translating them would corrupt the logic. */
const EXCLUDED = new Set([
  /* this tool and its template contain Persian character *ranges*, which are
   * regex source, not interface text. */
  'scripts/extract-i18n.mjs',
  'scripts/i18n-template.js',
  'scripts/build-i18n.mjs',
  /* these speak Persian *about data*, not about the interface: the filler-word
   * list, the keyword→icon map, the caption engine's orthography rules */
  'lib/beats.mjs',
  'lib/icons.mjs',
  'engine/srt.mjs',
  'engine/fetch-icons.mjs',
  'engine/measure-onsets.mjs',
]);

const args = process.argv.slice(2);
const coverage = args.includes('--coverage');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(STUDIO_ROOT, rel), 'utf8'));

function stripComments(src) {
  /* Comments may not be stripped with regexes alone: a string such as
   * 'ui-entrance/*' contains a literal `/*` and a naive block-comment regex
   * swallows the rest of the file (which silently hid half of lib/motions.mjs
   * from the inventory). Scan with a small state machine instead. HTML
   * comments go first — the machine below is for code. */
  let out = src.replace(/<!--[\s\S]*?-->/g, ' ');
  let mode = 'code'; // code | line | block | sq | dq | bt
  let i = 0;
  let clean = '';
  while (i < out.length) {
    const c = out[i];
    const d = out[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; clean += ' '; i += 2; continue; }
      if (c === '/' && d === '*') { mode = 'block'; clean += ' '; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { mode = c === "'" ? 'sq' : c === '"' ? 'dq' : 'bt'; clean += c; i++; continue; }
      clean += c;
      i++;
      continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; clean += c; }
      i++;
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; clean += ' '; i += 2; continue; }
      if (c === '\n') clean += c;
      i++;
      continue;
    }
    /* inside a string: keep everything, honour escapes, close on the quote */
    if (c === '\\') { clean += out.slice(i, i + 2); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'bt' && c === '`')) mode = 'code';
    clean += c;
    i++;
  }
  return clean;
}

function phrasesFromSource(src) {
  const found = new Set();
  for (const raw of stripComments(src).match(TEXT_RUN) || []) {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (s.length > 1 && HAS_FA.test(s)) {
      /* Regex source (recipe signals like /([۰-۹0-9]+)…/) is logic, not copy:
       * square brackets never appear in interface text, but they do appear in
       * every character class. Skipping those runs keeps the dictionary free
       * of patterns no reader will ever see. */
      if (/[[\]]/.test(s)) continue;
      found.add(s);
    }
  }
  return [...found];
}

function listFiles(rel) {
  const abs = path.join(STUDIO_ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isDirectory())
    return fs
      .readdirSync(abs)
      .filter((f) => f.endsWith('.mjs'))
      .sort()
      .map((f) => path.join(rel, f));
  return [rel];
}

const files = [
  ...UI_FILES,
  ...ENGINE_FILES,
  ...listFiles('lib'),
  ...listFiles('scripts'),
  ...listFiles('engine'),
].filter((rel) => !EXCLUDED.has(rel));

const phrases = new Map();
for (const rel of files) {
  let src = fs.readFileSync(path.join(STUDIO_ROOT, rel), 'utf8');
  if (rel.endsWith('.html')) src = src.replace(STRIP_META, '<meta>');
  for (const p of phrasesFromSource(src)) {
    if (!phrases.has(p)) phrases.set(p, []);
    if (!phrases.get(p).includes(rel)) phrases.get(p).push(rel);
  }
}

const out = [...phrases.entries()]
  .sort((a, b) => a[0].localeCompare(b[0], 'fa'))
  .map(([fa, sources]) => ({ fa, sources }));

fs.mkdirSync(WORKSPACE, { recursive: true });

if (coverage) {
  const dict = read('ui/i18n.en.json');
  const words = { ...read('ui/i18n.words.json'), ...read('ui/i18n.connectors.json') };
  const covered = (fa) => {
    if (dict[fa] !== undefined) return true;
    const parts = fa.split(/[\s،؛:.!?()«»–—]+/).filter((p) => /[؀-ۿ]/.test(p));
    return parts.length > 0 && parts.every((p) => words[p] !== undefined || words[p.replace(/[ًٍَّ]/g, '')] !== undefined);
  };
  const missing = out.filter((r) => !covered(r.fa));
  const wordset = new Map();
  for (const r of missing) {
    for (const w of r.fa.split(/[\s،؛:.!?()«»–—]+/)) {
      if (!HAS_FA.test(w) || words[w] !== undefined) continue;
      wordset.set(w, (wordset.get(w) || 0) + 1);
    }
  }
  console.log(`${out.length} phrases, ${missing.length} not covered (${wordset.size} distinct words missing)`);
  fs.writeFileSync(path.join(WORKSPACE, 'i18n-missing.json'), JSON.stringify(missing, null, 2) + '\n');
  fs.writeFileSync(
    path.join(WORKSPACE, 'i18n-missing-words.json'),
    JSON.stringify([...wordset.entries()].sort((a, b) => b[1] - a[1]).map(([word, n]) => ({ word, n })), null, 2) + '\n',
  );
  console.log('wrote workspace/i18n-missing.json and i18n-missing-words.json');
  process.exitCode = missing.length ? 1 : 0;
} else {
  fs.writeFileSync(path.join(WORKSPACE, 'i18n-phrases.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`${out.length} Persian phrases across ${files.length} files → workspace/i18n-phrases.json`);
}

