import fs from 'node:fs';
import path from 'node:path';
import { MOTION_TEMPLATE } from './paths.mjs';
import { writeModule } from './icons.mjs';
import { geometry } from './ratios.mjs';
import { buildStage } from './backgrounds.mjs';
import { TRANSITIONS } from './motions.mjs';
import { safeFor } from './safe.mjs';
import { templateById } from './templates.mjs';
import { brandTokens, resolveBrand, mutedInk, rgba } from './brand.mjs';
import { projectStoreFiles, terminalFonts } from './assets.mjs';

/* motion-project.mjs — the writer: a beat sheet in, a renderable project out.

 The layer is authored at exactly the size the user asked for and is *transparent*
 by default, because it is meant to sit collage-style above their own footage.
 Every beat is one `class="clip"` element with `data-start`/`data-duration` on the
 SRT clock, every box is liquid glass with a 5 px radius, every icon is an inline
 Material symbol, and all motion is driven from one generated timeline script —
 the same transition table the planner picked from, so what was planned is what
 renders.

 Nothing here reaches the network at render time: fonts, GSAP, HyperMotion and the
 icon module are copied into the project.
 */

const TEMPLATE_ASSETS = [
  'assets/fonts/vazirmatn.css',
  'assets/fonts/vazirmatn-arabic-100-900.woff2',
  'assets/fonts/vazirmatn-latin-100-900.woff2',
  'assets/fonts/vazirmatn-latin-ext-100-900.woff2',
  'assets/hypermotion.js',
  'assets/vendor/gsap.min.js',
];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faNum = (v) => String(v).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const json = (v) => JSON.stringify(v);

/**
 * @param o.dir        project directory (created)
 * @param o.sheet      beats from `beats.buildBeats()`
 * @param o.canvas     `{width, height, fps, ratio}`
 * @param o.deliver    'overlay' | 'standalone'
 * @param o.background stage id, standalone only
 * @param o.audio      [{id, src, start, duration, volume, track}] — SFX/voice clips, standalone only
 * @param o.teaserCaptions  set false to skip the burned-in subtitles a teaser ratio adds
 */
export function writeMotionProject(o) {
  const dir = path.resolve(o.dir);
  const sheet = o.sheet;
  if (!sheet?.beats?.length) throw new Error('motion-project: ورقهٔ بیت خالی است');
  const deliver = o.deliver === 'standalone' ? 'standalone' : 'overlay';
  const width = o.canvas?.width || 1920;
  const height = o.canvas?.height || 960;
  const fps = o.canvas?.fps || 30;
  const g = geometry(width, height);
  // teaser ratios (9:16, 16:9): every text sits inside the platform safe rect,
  // and the SRT rides the film as burned-in, word-synced subtitles.
  // a template (lib/templates.mjs) may flip the caption band to the top and
  // swap the glass skin for flat white UI cards.
  const tpl = templateById(sheet.config?.template || o.template);
  const captionSide = tpl?.captionSide || 'bottom';
  const safe = safeFor(o.canvas?.ratio || sheet.config?.ratio, captionSide);
  const uiSkin = tpl?.material === 'ui' || sheet.config?.material === 'ui';
  /* one token set governs the whole film — colours from the resolved brand,
   * timing from its personality; nothing below reads a hardcoded colour again */
  const tok = o.brand
    ? brandTokens(o.brand)
    : tpl
      ? resolveBrand({ template: tpl.id })
      : brandTokens(null);
  const glowK = tok.motion.glow === 'restrained' ? 0.6 : tok.motion.glow === 'bold' ? 1.4 : 1;
  const captionsOn = Boolean(safe && sheet.captions?.length && o.teaserCaptions !== false);
  const lastEnd = Math.max(...sheet.beats.map((b) => b.end));
  const film = round3(o.duration || lastEnd);

  fs.mkdirSync(dir, { recursive: true });
  // a re-plan must not leave last run's compositions behind in the project
  fs.rmSync(path.join(dir, 'compositions'), { recursive: true, force: true });
  const copied = copyTemplate(dir);
  const icons = resolveIcons(dir, sheet, o.fetchIcons !== false);

  /* asset store — the terminal typeface and the ground plate ride along only
   * when they exist; without them the code-drawn look stands. */
  const fonts = terminalFonts();
  for (const f of fonts) {
    const dest = path.join(dir, 'assets', 'store', 'fonts', f.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.src, dest);
  }
  const storeAssets = projectStoreFiles({ background: o.background }).map((f) => {
    const dest = path.join(dir, 'assets', 'store', f.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.src, dest);
    return `assets/store/${f.name}`;
  });
  const weightOf = { Regular: 400, Medium: 500, Bold: 700 };
  const storeCss = fonts.length
    ? fonts
        .map(
          (f) =>
            `@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: ${weightOf[f.name.match(/-(\w+)\.woff2$/)[1]] ?? 400}; src: url('assets/store/fonts/${f.name}') format('woff2'); font-display: block; }`,
        )
        .join('\n') +
      `\n.d-terminal .bt, .d-terminal .line, .d-terminal .prompt, .d-terminal .typed { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; }`
    : '';

  const stage = deliver === 'standalone' ? buildStage(o.background || 'site', g, { film, ink: tok.palette.ink, assets: storeAssets, brand: tok }) : null;
  const parts = sheet.beats.map((b, i) => beatMarkup(b, i, g, deliver, sheet.config.material));

  // six beats per file: a track with a dozen clips in it stops being reviewable
  const groups = [];
  for (let i = 0; i < sheet.beats.length; i += 6) {
    groups.push({
      id: `beats-${String(groups.length + 1).padStart(2, '0')}`,
      file: `compositions/beats-${String(groups.length + 1).padStart(2, '0')}.html`,
      beats: sheet.beats.slice(i, i + 6),
      parts: parts.slice(i, i + 6),
    });
  }
  const css = partsCss(g, deliver, sheet.config.material, tok, glowK, safe, uiSkin);  for (const grp of groups) {
    writeComposition(path.join(dir, grp.file), {
      id: grp.id,
      beats: grp.beats,
      parts: grp.parts,
      first: grp === groups[0],
      last: grp === groups[groups.length - 1],
      width,
      height,
      g,
      tok,
      safe,
      css: css + (storeCss ? '\n' + storeCss : ''),
      film,
    });
  }
  if (captionsOn) {
    writeCaptions(path.join(dir, 'compositions', 'captions.html'), {
      captions: sheet.captions,
      width,
      height,
      g,
      tok,
      safe,
      uiSkin,
      film,
    });
  }
  writeIndex(path.join(dir, 'index.html'), {
    sheet,
    width,
    height,
    fps,
    film,
    deliver,
    tok,
    safe,
    captions: captionsOn,
    stage,
    groups,
    audio: o.audio || [],
    storeCss,
  });
  writeSpec(path.join(dir, 'notes/motion-spec.md'), sheet, { deliver, width, height, fps, film, icons, tok, safe, captions: captionsOn });
  writeJson(path.join(dir, 'hyperframes.json'), {
    $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
    registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
    paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
    media: { autoProxy: true },
  });
  writeJson(path.join(dir, 'brand.json'), tok);
  writeJson(path.join(dir, 'beats.json'), sheet);

  return {
    dir,
    deliver,
    film,
    canvas: { width, height, fps },
    beats: sheet.beats.length,
    cues: sheet.beats.reduce((n, b) => n + b.cues.length, 0),
    captions: captionsOn ? sheet.captions.length : 0,
    safe: safe ? { top: safe.top, bottom: safe.bottom, left: safe.left, right: safe.right } : null,
    icons,
    copied,
    files: [
      'index.html',
      ...groups.map((x) => x.file),
      ...(captionsOn ? ['compositions/captions.html'] : []),
      'beats.json',
      'brand.json',
      'notes/motion-spec.md',
      'modules/icons.js',
    ],
  };
}

function copyTemplate(dir) {
  const copied = [];
  for (const rel of TEMPLATE_ASSETS) {
    const src = path.join(MOTION_TEMPLATE, rel);
    const dest = path.join(dir, rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(rel);
  }
  if (!copied.length) throw new Error(`motion-project: no motion template at ${MOTION_TEMPLATE} — run npm run setup`);
  return copied;
}

/** Only the icons the sheet actually uses; unresolved ones fall back and are reported. */
function resolveIcons(dir, sheet, fetch) {
  const wanted = [...new Set(sheet.beats.map((b) => b.content.icon).filter(Boolean))];
  const { icons, unresolved } = writeModule(dir, wanted, { fetch });
  const dropped = [];
  for (const b of sheet.beats) {
    if (b.content.icon && !icons.includes(b.content.icon)) {
      const alt = icons.includes('auto_awesome') ? 'auto_awesome' : icons[0];
      if (alt) {
        dropped.push(`${b.content.icon}→${alt}`);
        b.content.icon = alt;
      } else dropped.push(`${b.content.icon}✗`);
    }
  }
  return { written: icons, unresolved, dropped };
}

/* ---------------------------------------------------------------- markup ---- */

function beatMarkup(b, index, g, deliver, material) {
  const zone = b.zone || { x: 0.88, y: 0.16, align: 'end' };
  // Over footage in portrait, a bottom-anchored card grows *up* from its anchor
  // line and ends up over the subject's face. There the anchor line becomes the
  // card's top edge instead, and never higher than 0.72 of the frame.
  const guard = deliver === 'overlay' && g.h > g.w * 1.2;
  const top = zone.y < 0.5 || guard;
  const yEdge = top ? Math.min(zone.y, 0.72) : 1 - zone.y;
  const style = [
    zone.align === 'end' ? `padding-right:${Math.round((1 - zone.x) * g.w)}px` : '',
    zone.align === 'start' ? `padding-left:${Math.round(zone.x * g.w)}px` : '',
    top ? `padding-top:${Math.round(yEdge * g.h)}px` : `padding-bottom:${Math.round(yEdge * g.h)}px`,
  ]
    .filter(Boolean)
    .join(';');
  const cls = [
    'clip',
    'ov',
    `d-${b.draw}`,
    `al-${zone.align}`,
    top ? 'vw-top' : 'vw-bottom',
    `tr-${b.transition}`,
    material === 'flat' ? 'mat-flat' : material === 'ui' ? 'mat-ui' : 'mat-glass',
    b.primary ? '' : 'is-pair',
  ]
    .filter(Boolean)
    .join(' ');
  const id = `beat-${b.n}`;
  const inner = DRAW[b.draw] ? DRAW[b.draw](b, g, deliver) : DRAW.card(b, g, deliver);
  // only the glass skin carries the light layers; flat and UI cards stay clean
  const skin = material === 'glass' ? '<div class="caustic"></div><div class="noise"></div><div class="sheen"></div>' : '';
  return {
    id,
    html: `<div id="${id}" class="${cls}" data-start="${b.start}" data-duration="${b.duration}" data-track-index="${b.track}" data-hold style="${style}">
      <div class="frame">${skin}<div class="content">${inner}</div></div>
    </div>`,
  };
}

const ico = (name) => `<span class="ico" data-icon="${esc(name)}"></span>`;

const DRAW = {
  card: (b) => {
    const c = b.content;
    return `${c.icon ? `<span class="tile">${ico(c.icon)}</span>` : ''}
      <span class="stack"><span class="name">${esc(c.headline)}</span>${
        c.sub ? `<span class="meta"><i class="dot"></i>${esc(c.sub)}</span>` : ''
      }</span>`;
  },

  stat: (b) => {
    const c = b.content;
    return `<span class="figure"><span class="num" data-to="${c.value ?? 0}" data-suffix="${esc(c.percent ? '٪' : '')}">۰</span>${
      c.unit && !c.percent ? `<span class="unit">${esc(c.unit)}</span>` : ''
    }</span><span class="rule"></span><span class="lab">${esc(c.headline)}</span>`;
  },

  terminal: (b) => {
    const c = b.content;
    return `<span class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="bt">${esc(c.headline || c.latin)}</span></span>
      <span class="tbody">
        <span class="line cmd"><span class="prompt">$</span><span class="typed" data-text="${esc(c.latin)}"></span><span class="caret" data-layout-allow-occlusion></span></span>${
          c.sub ? `<span class="line out"><span class="prompt">→</span>${esc(c.sub)}</span>` : ''
        }
      </span>`;
  },

  steps: (b) => {
    const items = b.content.items.slice(0, 5);
    return `<span class="lab">${esc(b.content.headline)}</span><ol class="list">${items
      .map((s, i) => `<li class="step"><span class="no">${faNum(i + 1)}</span><span class="w">${esc(s)}</span></li>`)
      .join('')}</ol>`;
  },

  compare: (b) => {
    const c = b.content;
    return `<span class="pane before"><span class="pl">${esc(c.sub || c.headline)}</span></span>
      <span class="sep"></span>
      <span class="pane after"><span class="pl">${esc(c.headline)}</span>${c.icon ? `<span class="tile sm">${ico(c.icon)}</span>` : ''}</span>`;
  },

  meter: (b) => {
    const c = b.content;
    const pct = c.value === null ? 60 : Math.max(4, Math.min(100, Math.round(c.value)));
    return `<span class="lab">${esc(c.headline)}</span>
      <span class="mtrack"><span class="mfill" data-pct="${pct}"></span></span>
      <span class="mval"><span class="mnum" data-to="${pct}" data-suffix="٪">۰</span></span>`;
  },

  waveform: (b, g, deliver, seed = 1) => {
    const rnd = seeded(b.n * 977 + 13);
    const bars = Math.max(9, Math.min(23, Math.round(g.base / 62)) | 1);
    const cells = [];
    for (let i = 0; i < bars; i++) {
      const centre = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
      cells.push(`<i style="--h:${(0.18 + 0.72 * centre * (0.55 + 0.45 * rnd())).toFixed(3)}"></i>`);
    }
    return `<span class="wv">${cells.join('')}</span>${b.content.headline ? `<span class="lab">${esc(b.content.headline)}</span>` : ''}`;
  },

  badge: (b) =>
    `<span class="ring">${ico(b.content.icon || 'verified')}</span><span class="lab">${esc(b.content.headline)}</span>`,

  question: (b) =>
    `<span class="corners"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i></span>
      <span class="glyph">${esc(b.content.glyph || '؟')}</span>
      ${b.content.headline ? `<span class="lab">${esc(b.content.headline)}</span>` : ''}`,

  brand: (b) =>
    `${ico(b.content.icon || 'brands')}<span class="addr" dir="ltr">${esc(b.content.latin || b.content.headline)}</span>`,

  tags: (b) =>
    `<span class="hub">${esc(b.content.headline)}</span><span class="chips">${b.content.items
      .slice(0, 5)
      .map((s) => `<span class="chip">${esc(s)}</span>`)
      .join('')}</span>`,

  scan: (b) => {
    const c = b.content;
    return `<span class="srow">${c.icon ? `<span class="tile">${ico(c.icon)}</span>` : ''}<span class="lab">${esc(c.headline)}</span></span>
      <span class="scan"></span>${c.sub ? `<span class="found"><i class="dot"></i>${esc(c.sub)}</span>` : ''}`;
  },

  quote: (b) => `<span class="qtext">${esc(b.content.text || b.content.headline)}</span>`,
};

/* ------------------------------------------------------------------- css ---- */

function partsCss(g, deliver, material, tok, glowK = 1, safe = null, uiSkin = false) {
  // A tall canvas is read at arm's length on a phone. The same fraction of the
  // short side covers far less of the eye there, so the layer grows on portrait
  // boards only — the 2:1 house numbers stay exactly as brand-look writes them.
  const A = tok.palette.accent;
  const W = tok.palette.warm;
  const acc = (a) => rgba(A, a);
  const inkShadow = rgba(tok.palette.ink, 0.1);
  const k = g.h > g.w * 1.2 ? 1.3 : 1;
  const px = (f) => Math.round(f * g.base * k);
  // a phone stops reading below ~28 px, and every ratio is authored from `base`
  const ts = (f) => Math.max(Math.round(30 * k), px(f));
  // a card may take more of the inline axis when the canvas is portrait
  const fw = (f) => Math.round(g.w * (k > 1 ? Math.min(0.86, f * 1.35) : f));
  // a teaser card may never be wider than the platform's safe rect
  const safeMax = safe ? Math.round((1 - safe.left - safe.right) * g.w) : Infinity;
  const cardMax = Math.min(fw(0.46), safeMax);
  const quoteMax = Math.min(fw(0.72), safeMax);
  // template 001's cards are flat white UI surfaces: hairline border, big soft
  // shadow, generous radius — the reel's own card anatomy
  const radius = uiSkin || material === 'ui' ? Math.round(g.base * 0.03) : 5;
  const surface =
    material === 'ui'
      ? `background: var(--color-surface); border: 1px solid ${rgba(tok.palette.ink, 0.08)};
        box-shadow: 0 18px 44px ${inkShadow}, 0 4px 12px ${rgba(tok.palette.ink, 0.06)};`
      : material === 'flat'
        ? `background: rgba(18,20,20,0.78); border: 1px solid rgba(255,255,255,0.14);`
        : `background:
          linear-gradient(135deg, rgba(19,22,22,0.62) 0%, rgba(14,16,16,0.48) 46%, rgba(21,25,24,0.58) 100%),
          linear-gradient(135deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0.12) 100%);
        border: 1px solid rgba(255,255,255,0.26);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.62),
          inset 0 0 0 1px rgba(255,255,255,0.05),
          inset 0 -24px 44px rgba(0,0,0,0.12),
          0 24px 60px rgba(0,0,0,0.42),
          0 4px 12px rgba(0,0,0,0.22);`;
  return `
    #root { position: absolute; inset: 0; overflow: hidden; background: transparent; font-family: var(--font-fa); }

    .ov { position: absolute; inset: 0; display: flex; direction: ltr; pointer-events: none;
          padding-inline: ${g.padInline}px; }
    .al-start { justify-content: flex-start; }
    .al-end { justify-content: flex-end; }
    .al-middle { justify-content: center; }
    .vw-top { align-items: flex-start; }
    .vw-bottom { align-items: flex-end; }

    .frame { direction: rtl; text-align: start; position: relative; border-radius: ${radius}px; overflow: hidden;
             isolation: isolate; max-width: ${cardMax}px; ${surface} }
    .mat-flat .frame { box-shadow: 0 18px 44px rgba(0,0,0,0.34); }

    .caustic { position: absolute; inset: -30%; pointer-events: none;
      background:
        radial-gradient(42% 58% at 28% 24%, ${acc(0.3 * glowK)}, ${acc(0)} 70%),
        radial-gradient(46% 62% at 76% 80%, ${rgba(W, 0.2)}, ${rgba(W, 0)} 72%),
        radial-gradient(60% 80% at 55% 45%, rgba(255,255,255,0.10), rgba(255,255,255,0) 70%);
      filter: blur(16px); }
    .noise { position: absolute; inset: 0; pointer-events: none; opacity: 0.055; mix-blend-mode: overlay;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>"); }
    .sheen { position: absolute; top: -30%; bottom: -30%; width: 46%; pointer-events: none;
      background: linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.10) 34%,
                  rgba(255,255,255,0.30) 50%, rgba(255,255,255,0.10) 66%, rgba(255,255,255,0) 100%);
      transform: skewX(-14deg); }
    .content { position: relative; z-index: 2; display: flex; flex-direction: column; gap: ${px(0.014)}px;
               padding: ${px(0.028)}px ${px(0.032)}px; }

    .mi { width: 1em; height: 1em; display: block; fill: currentColor; }
    .ico { display: inline-flex; align-items: center; justify-content: center; color: var(--color-accent); }
    .tile { font-size: ${ts(0.05)}px; line-height: 0; }
    .tile.sm { font-size: ${ts(0.04)}px; }
    .stack { display: flex; flex-direction: column; gap: ${px(0.007)}px; }
    .name { font-size: ${ts(0.045)}px; font-weight: 700; color: var(--color-ink); line-height: 1.25; white-space: nowrap; }
    .lab { font-size: ${ts(0.031)}px; font-weight: 600; color: var(--color-ink); line-height: 1.3; }
    .meta { display: flex; align-items: center; gap: ${px(0.011)}px; font-size: ${ts(0.026)}px; color: var(--color-ink-muted); }
    .dot { width: ${px(0.009)}px; height: ${px(0.009)}px; border-radius: 50%; background: var(--color-accent);
           box-shadow: 0 0 12px ${acc(0.8 * glowK)}; display: block; }

    /* stat */
    .d-stat .content { align-items: flex-start; gap: ${px(0.012)}px; }
    .figure { display: flex; align-items: baseline; gap: ${px(0.01)}px; }
    .num { font-size: ${ts(0.125)}px; font-weight: 800; line-height: 1; color: var(--color-accent);
           font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .unit { font-size: ${ts(0.045)}px; font-weight: 700; color: var(--color-ink); }
    .rule { display: block; width: ${px(0.19)}px; height: 3px; background: var(--color-micro); transform-origin: right center; }

    /* terminal */
    .d-terminal .frame { max-width: ${fw(0.44)}px; }
    .bar { display: flex; align-items: center; gap: ${px(0.011)}px; height: ${px(0.05)}px; padding: 0 ${px(0.018)}px;
           border-bottom: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.05); }
    .dots { display: flex; gap: ${px(0.008)}px; }
    .dots i { width: ${px(0.011)}px; height: ${px(0.011)}px; border-radius: 50%; background: rgba(255,255,255,0.3); display: block; }
    .dots i:first-child { background: ${rgba(W, 0.85)}; }
    .dots i:nth-child(2) { background: rgba(232,254,81,0.7); }
    .dots i:nth-child(3) { background: ${acc(0.8)}; }
    .bt { font-size: ${ts(0.026)}px; color: var(--color-ink-muted); direction: ltr; letter-spacing: 0.06em; }
    .tbody { display: flex; flex-direction: column; gap: ${px(0.006)}px; padding: ${px(0.018)}px ${px(0.024)}px ${px(0.022)}px;
             direction: ltr; text-align: left; }
    .line { font-size: ${ts(0.033)}px; line-height: 1.7; color: var(--color-ink); white-space: pre; direction: ltr; }
    .line.out { color: var(--color-accent); }
    .prompt { color: var(--color-micro); margin-right: ${px(0.01)}px; }
    .caret { display: inline-block; width: 3px; height: 1.1em; background: var(--color-accent); vertical-align: -0.16em; }
    .ch { display: inline-block; white-space: pre; }

    /* steps */
    .list { list-style: none; display: flex; flex-direction: column; gap: ${px(0.011)}px; }
    .step { display: flex; align-items: center; gap: ${px(0.014)}px; font-size: ${ts(0.03)}px; color: var(--color-ink); }
    .no { flex: none; width: ${px(0.044)}px; height: ${px(0.044)}px; border-radius: 50%; display: inline-flex;
          align-items: center; justify-content: center; font-size: ${ts(0.021)}px; font-weight: 700;
          background: ${acc(0.16)}; color: var(--color-accent); border: 1px solid ${acc(0.42)}; }

    /* compare */
    .d-compare .content { flex-direction: row; align-items: stretch; gap: 0; padding: 0; }
    .pane { display: flex; flex-direction: column; justify-content: center; gap: ${px(0.008)}px;
            padding: ${px(0.026)}px ${px(0.022)}px; min-width: ${px(0.15)}px; }
    .pane.before { opacity: 0.55; }
    .pane .pl { font-size: ${ts(0.033)}px; font-weight: 700; color: var(--color-ink); }
    .sep { width: 2px; background: linear-gradient(${acc(0)}, ${acc(0.85)}, ${acc(0)}); }

    /* meter */
    .mtrack { display: block; width: ${px(0.25)}px; height: ${px(0.017)}px; border-radius: 5px;
              background: rgba(255,255,255,0.16); overflow: hidden; }
    .mfill { display: block; height: 100%; width: 0; border-radius: 5px;
             background: linear-gradient(90deg, ${acc(0.7)}, var(--color-accent)); }
    .mval { font-size: ${ts(0.052)}px; font-weight: 800; color: var(--color-accent); font-variant-numeric: tabular-nums; }

    /* waveform */
    .d-waveform .content { flex-direction: row; align-items: center; gap: ${px(0.018)}px; }
    .wv { display: flex; align-items: center; gap: ${px(0.006)}px; height: ${px(0.075)}px; }
    .wv i { display: block; width: ${Math.max(4, px(0.006))}px; height: calc(var(--h) * 100%); border-radius: 3px;
            background: var(--color-accent); opacity: 0.85; transform-origin: center; }

    /* badge */
    .d-badge .content { flex-direction: row; align-items: center; gap: ${px(0.018)}px; }
    .ring { display: inline-flex; align-items: center; justify-content: center; font-size: ${ts(0.062)}px;
            width: ${px(0.1)}px; height: ${px(0.1)}px; border-radius: 50%; line-height: 0;
            border: 2px solid ${acc(0.55)}; box-shadow: 0 0 26px ${acc(0.35 * glowK)}; }

    /* question */
    .d-question .content { align-items: center; gap: ${px(0.01)}px; padding: ${px(0.03)}px ${px(0.04)}px; }
    .corners { position: absolute; inset: ${px(0.012)}px; pointer-events: none; }
    .c { position: absolute; width: ${px(0.032)}px; height: ${px(0.032)}px; border: 2px solid var(--color-accent); }
    .c.tl { top: 0; left: 0; border-right: 0; border-bottom: 0; }
    .c.tr { top: 0; right: 0; border-left: 0; border-bottom: 0; }
    .c.bl { bottom: 0; left: 0; border-right: 0; border-top: 0; }
    .c.br { bottom: 0; right: 0; border-left: 0; border-top: 0; }
    .glyph { font-size: ${ts(0.1)}px; font-weight: 800; color: var(--color-micro); line-height: 1; }

    /* brand */
    .d-brand .content { flex-direction: row; align-items: center; gap: ${px(0.014)}px; }
    .addr { font-size: ${ts(0.036)}px; font-weight: 700; color: var(--color-ink); letter-spacing: 0.02em; }

    /* tags */
    .d-tags .content { gap: ${px(0.016)}px; }
    .hub { font-size: ${ts(0.034)}px; font-weight: 700; color: var(--color-accent); }
    .chips { display: flex; flex-wrap: wrap; gap: ${px(0.011)}px; max-width: ${px(0.3)}px; }
    .chip { display: inline-flex; align-items: center; gap: ${px(0.008)}px; font-size: ${ts(0.026)}px;
            padding: ${px(0.009)}px ${px(0.016)}px; border-radius: 5px; color: var(--color-ink);
            background: rgba(255,255,255,0.09); border: 1px solid rgba(255,255,255,0.2); }

    /* scan */
    .d-scan .content { gap: ${px(0.014)}px; }
    .srow { display: flex; align-items: center; gap: ${px(0.014)}px; }
    .scan { display: block; height: 2px; width: 100%; min-width: ${px(0.16)}px;
            background: linear-gradient(90deg, ${acc(0)}, ${acc(0.9)}, ${acc(0)}); }
    .found { display: inline-flex; align-items: center; gap: ${px(0.009)}px; font-size: ${ts(0.025)}px; color: var(--color-ink-muted); }

    /* quote (standalone only) */
    .d-quote .frame { max-width: ${quoteMax}px; }
    .qtext { font-size: ${ts(0.055)}px; font-weight: 700; line-height: 1.5; color: var(--color-ink); }
  `;
}

/* ---------------------------------------------------------------- captions --- */

/** A caption word: latin runs stay LTR-isolated, hot/uline words take the accent.
 *  In the template-001 skin a hot word becomes the reel's signature: italic
 *  serif inside a Figma-style selection box (blue border, 4 corner handles). */
function capWordHtml(w, uiSkin = false) {
  const isLatin = /[A-Za-z]/.test(w.text) && !/[\u0600-\u06FF]/.test(w.text);
  const sel = uiSkin && w.hot;
  const cls = ['w', w.hot ? 'hot' : '', w.uline ? 'uline' : '', sel ? 'sel' : ''].filter(Boolean).join(' ');
  const inner = esc(w.text);
  const handles = sel ? '<b class="h a"></b><b class="h b"></b><b class="h c"></b><b class="h d"></b>' : '';
  return `<span class="${cls}">${isLatin ? `<span dir="ltr" style="display:inline-block">${inner}</span>` : inner}${handles}</span>`;
}

/**
 * The teaser subtitle track: the SRT's own words, burned in, word-synced, and
 * locked inside the platform safe rect (lib/safe.mjs). Each word brightens at
 * its spoken time — karaoke-style — and hot words take the brand accent.
 * Template 001 flips the band to the TOP of the frame (the reference reel's
 * headline lives up there) and styles it as the two-tier headline: spoken
 * words bold ink, upcoming words faded, key words in a selection box.
 * Copy is never rewritten here: whatever the transcript says is what shows.
 */
function writeCaptions(file, c) {
  const safe = c.safe;
  const uiSkin = Boolean(c.uiSkin);
  const topBand = safe.captionSide === 'top';
  const portrait = c.g.h > c.g.w;
  // the eye on a phone needs big type: template 001's headline is larger
  // (~7.5% of width portrait, like the reel), plain teaser captions sit lower
  const fz = portrait
    ? Math.max(28, Math.round(c.g.w * (uiSkin ? 0.075 : 0.062)))
    : Math.max(28, Math.round(c.g.h * 0.052));
  const cues = c.captions
    .filter((cue) => cue.end > cue.start && (cue.words || []).length)
    .map((cue, i) => ({
      id: `cap-${i}`,
      s: cue.start,
      e: cue.end,
      words: cue.words.map((w) => ({ text: w.text, hot: w.hot, uline: w.uline, t: w.start })),
    }));
  const data = cues.map((cue) => ({
    id: cue.id,
    s: cue.s,
    e: cue.e,
    words: cue.words.map((w) => Math.round(w.t * 100) / 100),
  }));
  const dim = uiSkin ? 0.3 : 0.22;
  const html = `<template>
  <style>
    #root { position: absolute; inset: 0; overflow: hidden; background: transparent; font-family: var(--font-fa); }

    /* the safe rect: platform chrome owns everything outside this box; the
     * caption band sits where the template puts it — top (reel headline) or
     * bottom (plain teaser captions) */
    .cue {
      position: absolute;
      ${topBand
        ? `top: ${Math.round(safe.bandTop * c.g.h) + Math.round(c.g.h * 0.012)}px;`
        : `bottom: ${Math.round((1 - safe.bandBottom) * c.g.h)}px;`}
      left: ${Math.round(safe.left * c.g.w)}px;
      right: ${Math.round(safe.right * c.g.w)}px;
      display: flex; flex-wrap: wrap; justify-content: center;
      column-gap: 0.3em; row-gap: 0.1em;
      direction: rtl; text-align: center;
      font-size: ${fz}px; font-weight: 800; line-height: 1.4;
      color: var(--color-ink);
      text-shadow: ${uiSkin
        ? `0 1px 0 rgba(255,255,255,0.6), 0 6px 20px rgba(255,255,255,0.55), 0 0 3px rgba(255,255,255,0.9)`
        : `0 2px 0 rgba(0,0,0,0.4), 0 8px 28px rgba(0,0,0,0.55), 0 0 4px rgba(0,0,0,0.85), 0 0 14px rgba(0,0,0,0.5)`};
      opacity: 0; will-change: transform, opacity; pointer-events: none;
    }
    .cue .w { display: inline-block; opacity: ${dim}; will-change: transform, opacity; }
    .cue .w.hot { color: var(--color-accent); }
    .cue .w.uline { color: var(--color-accent); border-bottom: 4px solid var(--color-accent); padding-bottom: 2px; }

    /* template 001: the Figma selection box — italic serif + blue rect + handles */
    .cue .w.sel {
      position: relative; color: var(--color-ink); font-style: italic;
      font-family: Georgia, 'Times New Roman', serif;
      padding: 0 0.14em; border: 1.5px solid var(--color-accent); border-radius: 2px;
      background: ${rgba(c.tok.palette.accent, 0.07)};
      text-shadow: none;
    }
    .cue .w.sel .h { position: absolute; width: 6px; height: 6px; background: #fff;
      border: 1.5px solid var(--color-accent); border-radius: 1px; z-index: 2; }
    .cue .w.sel .h.a { top: -4px; left: -4px; }
    .cue .w.sel .h.b { top: -4px; right: -4px; }
    .cue .w.sel .h.c { bottom: -4px; left: -4px; }
    .cue .w.sel .h.d { bottom: -4px; right: -4px; }
  </style>

  <div id="root" data-composition-id="captions" data-width="${c.width}" data-height="${c.height}">
${cues.map((cue) => `    <div class="cue" id="${cue.id}">${cue.words.map((w) => capWordHtml(w, uiSkin)).join('')}</div>`).join('\n')}
  </div>

  <script>
    (function () {
      "use strict";
      var D = ${json(data)};
      var film = ${c.film};

      var tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: film, ease: "none" }, 0);

      /* each word lights at its own spoken time — the transcript's own clock */
      D.forEach(function (cue) {
        var el = "#" + cue.id;
        tl.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }, cue.s);
        var words = document.querySelectorAll(el + " .w");
        cue.words.forEach(function (t, i) {
          if (!words[i]) return;
          tl.fromTo(words[i], { opacity: 0.22, scale: 0.94 },
            { opacity: 1, scale: 1, duration: 0.16, ease: "back.out(1.6)" }, Math.max(cue.s, t));
        });
        tl.to(el, { opacity: 0, y: -8, duration: 0.12, ease: "power1.in" }, Math.max(cue.s + 0.15, cue.e - 0.12));
      });

      window.__timelines["captions"] = tl;
      tl.seek(0);
    })();
  </script>
</template>
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
  return html;
}

/* ------------------------------------------------------------ composition ---- */

function writeComposition(file, c) {
  const tok = brandTokens(c.tok);
  const m = tok.motion;
  /* personality timing: entrances scale by the preset, exits stay the shortest
   * move in the film (HyperFrames rule), back-ease kicks follow the overshoot,
   * word staggers breathe at the preset's rate */
  const glowK = m.glow === 'restrained' ? 0.6 : m.glow === 'bold' ? 1.4 : 1;
  const st = (m.staggerMs / 1000).toFixed(3);
  const bo = (k) => `back.out(${(k * m.overshoot).toFixed(2)})`;
  const scaleBack = (ease) => String(ease).replace(/back\.out\(([\d.]+)\)/, (_, x) => `back.out(${(Number(x) * m.overshoot).toFixed(2)})`);
  const data = c.beats.map((b, i) => ({
    s: `#beat-${b.n}`,
    t: b.start,
    d: b.duration,
    tr: b.transition,
    draw: b.draw,
    value: b.content.value,
    percent: b.content.percent,
    pair: !b.primary,
    first: !!c.first && i === 0,
    last: !!c.last && i === c.beats.length - 1,
  }));
  const tr = {};
  for (const [k, v] of Object.entries(TRANSITIONS)) {
    tr[k] = {
      ease: scaleBack(v.enter.ease),
      dur: round3(v.enter.dur * m.durationScale),
      y: v.enter.y || 0,
      blur: v.enter.blur || 0,
      scale: v.enter.scale || 0,
      clip: !!v.enter.clip,
      lease: scaleBack(v.leave.ease),
      ldur: round3(v.leave.dur * m.exitScale),
      ly: v.leave.y || -14,
    };
  }
  const html = `<template>
  <style>
${c.css}
  </style>

  <div id="root" data-composition-id="${c.id}" data-width="${c.width}" data-height="${c.height}" data-layout-allow-overflow>
${c.parts.map((p) => '    ' + p.html.replace(/\n/g, '\n')).join('\n')}
  </div>

  <script>
    (function () {
      "use strict";
      var TR = ${json(tr)};
      var B = ${json(data)};
      var film = ${c.film};

      document.querySelectorAll("[data-icon]").forEach(function (n) {
        n.innerHTML = window.icon(n.getAttribute("data-icon"));
      });
      document.querySelectorAll("[data-text]").forEach(function (n) {
        var text = n.getAttribute("data-text") || "";
        n.textContent = "";
        for (var i = 0; i < text.length; i++) {
          var s = document.createElement("span");
          s.className = "ch";
          s.textContent = text[i] === " " ? "\\u00A0" : text[i];
          n.appendChild(s);
        }
      });

      var tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: film, ease: "none" }, 0);

      /* A beat sheet is planned copy; not every card carries every part, so each
         tween is taken only when its element exists — GSAP warns per missing
         target and 300 warnings drown the real findings. */
      function has(sel) { return !!document.querySelector(sel); }
      function ft(sel, from, vars, at) { if (has(sel)) tl.fromTo(sel, from, vars, at); }
      function tv(sel, vars, at) { if (has(sel)) tl.to(sel, vars, at); }
      function rv(sel, o) { if (has(sel)) HM.revealWords(tl, sel, o); }
      function wm(sel, o) { if (has(sel)) HM.wipeMask(tl, sel, o); }
      function cu(sel, o) { if (has(sel)) HM.countUp(tl, sel, o); }
      function dr(sel, o) { if (has(sel)) HM.drawRule(tl, sel, o); }
      function dl(sel, o) { if (has(sel)) HM.deal(tl, sel, o); }

      /* The card starts its entrance so the settle tail crosses the beat —
       * the pop lands ON the music, with the wind-up in front of it. */
      function enter(b) {
        var t = TR[b.tr] || TR.soft;
        var sel = b.s + " .frame";
        var at = b.first ? b.t : b.t - Math.max(0, t.dur - 0.12);
        var from = { opacity: b.first ? 1 : 0, filter: "blur(" + (b.first ? 0 : t.blur || 0) + "px)" };
        if (t.clip && !b.first) from.clipPath = "inset(0 0 0 100%)";
        if (t.y && !b.first) from.y = t.y;
        if (b.first) from.scale = 1.05;
        else if (t.scale) from.scale = t.scale;
        var to = { opacity: 1, filter: "blur(0px)", duration: t.dur, ease: t.ease };
        if (t.clip) to.clipPath = "inset(0 0 0 0%)";
        if (t.y) to.y = 0;
        to.scale = 1;
        ft(sel, from, to, at);
        /* one settling pulse where the entrance meets the beat — the card
         * answers the music; the frame itself never pulses (house rule R4) */
        if (!b.first && (t.ease || "").indexOf("back") >= 0) {
          var s = document.querySelector(sel);
          if (s) s.style.transformOrigin = "50% 62%";
          tv(sel, { scale: 1.018, duration: 0.1, ease: "power2.out" }, b.t + 0.02);
          tv(sel, { scale: 1, duration: 0.3, ease: "power2.inOut" }, b.t + 0.12);
        }
      }

      function leave(b) {
        if (b.last) return;
        var t = TR[b.tr] || TR.soft;
        var at = b.t + b.d - (t.ldur || 0.4);
        tv(b.s + " .frame", { opacity: 0, y: t.ly || -14, filter: "blur(6px)", duration: t.ldur || 0.4, ease: t.lease || "power2.in" }, at);
      }

      /** Light moving inside the glass and a slow breath: a held card stays alive. */
      function alive(b) {
        ft(b.s + " .sheen", { x: -340 }, { x: 760, duration: 1.1, ease: "power2.inOut" }, b.t + 0.3);
        var t = TR[b.tr] || TR.soft;
        var at = b.t + (t.dur || 0.5) + 0.15;
        var room = b.d - (at - b.t) - 0.4;
        if (room < 0.9) return;
        var period = 2.2, reps = Math.max(0, Math.floor(room / period) - 1);
        tv(b.s + " .frame", { scale: 1.022, duration: period / 2, ease: "sine.inOut", repeat: reps, yoyo: true }, at);
        tv(b.s + " .caustic", { x: 26, y: 14, duration: period, ease: "sine.inOut", repeat: reps, yoyo: true }, at);
        tv(b.s + " .dot", { opacity: 0.4, scale: 0.72, duration: 0.7, ease: "sine.inOut",
          repeat: Math.max(0, Math.floor(room / 1.4) - 1), yoyo: true }, at + 0.3);
      }

      function draw(b) {
        /* the first frame is the social thumbnail: the first card is born in
         * its final state (its hidden "from" lives only in the entrance tweens,
         * so skipping draw leaves it on screen at 0 s); later cards draw in */
        if (b.first) return;
        var at = b.t + 0.28;
        switch (b.draw) {
          case "card":
            ft(b.s + " .tile", { scale: 0.4, rotate: -90, opacity: 0 },
              { scale: 1, rotate: 0, opacity: 1, duration: 0.55, ease: "${bo(2)}" }, at + 0.1);
            wm(b.s + " .name", { at: at + 0.16, duration: 0.6 });
            ft(b.s + " .meta", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, at + 0.42);
            break;
          case "stat": {
            var to = b.value == null ? 100 : b.value;
            cu(b.s + " .num", { to: to, at: at + 0.12, duration: Math.min(1.1, Math.max(0.5, b.d * 0.28)) });
            dr(b.s + " .rule", { at: at + 0.2, duration: 0.5 });
            rv(b.s + " .lab", { at: at + 0.3, stagger: ${st}, fromY: "0.35em", blur: 12, accel: 0.3 });
            ft(b.s + " .unit", { opacity: 0, y: 8, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: "${bo(1.8)}" }, at + 0.5);
            break;
          }
          case "terminal": {
            var chars = document.querySelectorAll(b.s + " .typed .ch").length || 1;
            var step = Math.max(0.02, Math.min(0.09, (b.d - 2.2) / chars));
            ft(b.s + " .bar", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.32, ease: "expo.out" }, at);
            ft(b.s + " .typed .ch", { opacity: 0 },
              { opacity: 1, duration: 0.001, ease: "none", stagger: step }, at + 0.3);
            ft(b.s + " .line.out", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: "expo.out" }, b.t + b.d - 1.5);
            // the caret stops with the typing: a line that keeps flickering never
            // counts as readable, and the last thing typed is the point of the card
            blink(b.s + " .caret", at + 0.3, at + 0.3 + chars * step + 0.4, 0.28);
            break;
          }
          case "steps":
            rv(b.s + " .lab", { at: at, stagger: ${st}, fromY: "0.35em", blur: 12 });
            dl(b.s + " .step", { at: at + 0.24, each: 0.34, accel: 0.5, fromScale: 0.9, fromY: 16, duration: 0.5 });
            break;
          case "compare":
            ft(b.s + " .pane.before", { opacity: 0, x: 18 }, { opacity: 0.55, x: 0, duration: 0.4, ease: "expo.out" }, at);
            ft(b.s + " .sep", { scaleY: 0 }, { scaleY: 1, duration: 0.35, ease: "power2.out" }, at + 0.25);
            ft(b.s + " .pane.after", { clipPath: "inset(0 0 0 100%)" },
              { clipPath: "inset(0 0 0 0%)", duration: 0.55, ease: "power2.inOut" }, b.t + b.d * 0.42);
            break;
          case "meter": {
            var fill = document.querySelector(b.s + " .mfill");
            var pct = fill ? Number(fill.getAttribute("data-pct")) : 60;
            rv(b.s + " .lab", { at: at, stagger: ${st}, fromY: "0.3em", blur: 10 });
            tv(b.s + " .mfill", { width: pct + "%", duration: Math.min(1.2, b.d * 0.4), ease: "power2.out" }, at + 0.2);
            cu(b.s + " .mnum", { to: pct, at: at + 0.2, duration: Math.min(1.2, b.d * 0.4) });
            break;
          }
          case "waveform": {
            var pulses = Math.max(1, Math.floor((b.d - 0.4) / 0.7) - 1);
            ft(b.s + " .wv i", { scaleY: 0.1 },
              { scaleY: 1, duration: 0.28, ease: "power2.out", stagger: { each: 0.05, from: "center" } }, at);
            tv(b.s + " .wv i", { scaleY: 0.45, duration: 0.34, ease: "sine.inOut", stagger: { each: 0.05, from: "random", repeat: pulses, yoyo: true } }, at + 0.45);
            rv(b.s + " .lab", { at: at + 0.2, stagger: ${st}, fromY: "0.3em", blur: 10 });
            break;
          }
          case "badge":
            ft(b.s + " .ring", { scale: 0.3, rotate: -120, opacity: 0 },
              { scale: 1, rotate: 0, opacity: 1, duration: 0.6, ease: "${bo(2.2)}" }, at);
            ft(b.s + " .ring", { boxShadow: "0 0 0px ${rgba(tok.palette.accent, 0)}" },
              { boxShadow: "0 0 40px ${rgba(tok.palette.accent, (0.55 * glowK).toFixed(2))}", duration: 0.4, ease: "power2.out" }, at + 0.3);
            rv(b.s + " .lab", { at: at + 0.34, stagger: ${st}, fromY: "0.3em", blur: 10 });
            break;
          case "question":
            ft(b.s + " .c.tl", { x: 22, y: 22, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, at);
            ft(b.s + " .c.tr", { x: -22, y: 22, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, at);
            ft(b.s + " .c.bl", { x: 22, y: -22, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, at + 0.08);
            ft(b.s + " .c.br", { x: -22, y: -22, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, at + 0.08);
            ft(b.s + " .glyph", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "${bo(1.8)}" }, at + 0.2);
            rv(b.s + " .lab", { at: at + 0.4, stagger: ${st}, fromY: "0.3em", blur: 10 });
            break;
          case "brand":
            ft(b.s + " .ico", { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "${bo(2)}" }, at);
            wm(b.s + " .addr", { at: at + 0.16, duration: 0.5 });
            break;
          case "tags":
            rv(b.s + " .hub", { at: at, stagger: ${st}, fromY: "0.35em", blur: 12 });
            dl(b.s + " .chip", { at: at + 0.22, each: 0.24, accel: 0.5, fromScale: 0.7, fromY: 12 });
            break;
          case "scan":
            rv(b.s + " .lab", { at: at, stagger: ${st}, fromY: "0.3em", blur: 10 });
            ft(b.s + " .scan", { x: 120, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power2.out" }, at + 0.15);
            ft(b.s + " .scan", { y: -18 }, { y: 18, duration: Math.max(0.8, (b.d - 1.4) / 2), ease: "sine.inOut", repeat: 1, yoyo: true }, at + 0.5);
            ft(b.s + " .found", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35, ease: "expo.out" }, b.t + b.d - 1.8);
            break;
          case "quote":
            rv(b.s + " .qtext", { at: at, stagger: ${st}, fromY: "0.3em", blur: 12, accel: 0.25 });
            break;
        }
      }

      function blink(sel, at, until, period) {
        if (!has(sel) || until <= at) return;
        var n = Math.max(1, Math.floor((until - at) / (period * 2)));
        var kf = [];
        for (var i = 0; i < n; i++) { kf.push({ opacity: 1, duration: period }); kf.push({ opacity: 0, duration: period }); }
        kf.push({ opacity: 1, duration: period });
        tl.fromTo(sel, { opacity: 1 }, { keyframes: kf, duration: (until - at), ease: "none" }, at);
      }

      B.forEach(function (b) { enter(b); alive(b); draw(b); leave(b); });

      window.__timelines[${json(c.id)}] = tl;
      tl.seek(0);
    })();
  </script>
</template>
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
  return html;
}

/* ------------------------------------------------------------------ index ---- */

function writeIndex(file, c) {
  const overlay = c.deliver === 'overlay';
  const tok = brandTokens(c.tok);
  const tokens = `
      --color-ink: ${tok.palette.ink};
      --color-ink-muted: ${mutedInk(tok.palette)};
      --color-accent: ${tok.palette.accent};
      --color-micro: ${tok.palette.micro};
      --font-fa: "${tok.type.fa}";`;
  const banned = (tok.banned || []).map((b) => `- ${b}`).join('\n      ');
  const teaserNote = c.safe
    ? `\n      teaser: subtitles burned in, safe rect enforced (top ${c.safe.top}, bottom ${c.safe.bottom}, right ${c.safe.right}) — nothing readable may sit outside it`
    : '';
  const stageHtml = c.stage ? c.stage.html : '';
  const stageCss = c.stage ? c.stage.css : '';
  const stageMotion = c.stage ? c.stage.motion.map((fn) => `      ${fn('film')}`).join('\n') : '';
  const audio = c.audio
    .map(
      (a, i) =>
        `      <audio id="${esc(a.id || `audio-${i}`)}" class="clip" data-start="${a.start}" data-duration="${a.duration}" data-volume="${a.volume ?? 1}" data-track-index="${a.track || 40 + i}" src="${esc(a.src)}"></audio>`,
    )
    .join('\n');

  const hosts = c.groups
    .map(
      (grp, k) =>
        `      <div id="${esc(grp.id)}-host" class="scene-host" data-composition-id="${esc(grp.id)}"
           data-composition-src="${esc(grp.file)}" data-start="0" data-duration="${c.film}"
           data-width="${c.width}" data-height="${c.height}" data-track-index="${10 + k}"
           style="background: transparent"></div>`,
    )
    .join('\n');
  const capHost = c.captions
    ? `\n      <div id="captions-host" class="scene-host" data-composition-id="captions"
           data-composition-src="compositions/captions.html" data-start="0" data-duration="${c.film}"
           data-width="${c.width}" data-height="${c.height}" data-track-index="30" data-track-kind="captions"
           style="background: transparent"></div>`
    : '';

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${c.width}, height=${c.height}" />
    <title>${overlay ? 'لایهٔ موشن گرافیک' : 'ویدیوی موشن گرافیک'}</title>
    <!-- brand: ${tok.preset} (${tok.source}) — accent ${tok.palette.accent}
      one token set governs all motion; this film must never become:
      ${banned}${teaserNote}
    -->
    <link rel="preload" href="assets/fonts/vazirmatn-arabic-100-900.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="assets/fonts/vazirmatn.css" />
    <script src="assets/vendor/gsap.min.js"></script>
    <script src="assets/hypermotion.js"></script>
    <script src="modules/icons.js"></script>
    <style>
      :root {${tokens}
      }
      ${c.storeCss || ''}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${c.width}px; height: ${c.height}px; overflow: hidden;
        background: ${overlay ? 'transparent' : tok.palette.ground};
        color: var(--color-ink); font-family: var(--font-fa), sans-serif;
        -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision;
      }
      #root { position: relative; width: ${c.width}px; height: ${c.height}px; overflow: hidden;
              background: ${overlay ? 'transparent' : tok.palette.ground}; }
      .scene-host { position: absolute; inset: 0; }
      ${stageCss}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${c.film}" data-width="${c.width}" data-height="${c.height}" data-fps="${c.fps}">
${stageHtml ? `      ${stageHtml}\n` : ''}${hosts}
${capHost}
${audio}
    </div>

    <script>
      var film = Number(document.getElementById("root").dataset.duration) || ${c.film};
      var tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: film, ease: "none" }, 0);
${stageMotion}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
  fs.writeFileSync(file, html, 'utf8');
  return html;
}

function writeSpec(file, sheet, info) {
  const tok = info.tok || null;
  const lines = [
    `# مشخصات موشن گرافیک`,
    ``,
    `- تحویل: ${info.deliver === 'overlay' ? 'لایهٔ شفاف بالای ویدیوی کاربر' : 'ویدیوی مستقل'}`,
    `- بوم: ${info.width}×${info.height} در ${info.fps} فریم، مدت ${info.film} ثانیه`,
    `- چگالی ${sheet.config.density}، ضرب هر ${sheet.config.beatLen} ثانیه، جنس ${sheet.config.material}`,
    ...(tok ? [`- برند: شخصیت «${tok.presetFa || tok.preset}» (منبع ${tok.source})، اکسنت ${tok.palette.accent}، انرژی ${tok.motion.energy}`] : []),
    ...(sheet.config?.template ? [`- قالب ${sheet.config.template}: ${sheet.config.material === 'ui' ? 'کارت‌های UI سفید' : 'پوستهٔ قالب'} روی زمینهٔ قالب`] : []),
    ...(sheet.brief?.topic ? [`- موضوع: ${sheet.brief.topic} — قوس ${sheet.brief.arc || '—'}`] : []),
    ...(sheet.brief?.mustShow?.length ? [`- باید دیده شود: ${sheet.brief.mustShow.join('، ')}`] : []),
    ...(info.safe
      ? [
          `- حالت تیزر (${sheet.config.ratio}): حاشیهٔ امن رعایت شد — بالا ${Math.round(info.safe.top * 100)}٪، پایین ${Math.round(info.safe.bottom * 100)}٪، راست ${Math.round(info.safe.right * 100)}٪، چپ ${Math.round(info.safe.left * 100)}٪`,
          ...(info.captions ? [`- ${info.captions} زیرنویس کلمه‌به‌کلمه داخل حاشیهٔ امن می‌سوزد`] : []),
        ]
      : []),
    `- ${sheet.beats.length} بیت، ${sheet.beats.reduce((n, b) => n + b.cues.length, 0)} صدای پیشنهادی`,
    ...(sheet.style?.from ? [`- رفرنس: ${sheet.style.from} (انرژی ${sheet.style.energy}، لنگر ${sheet.style.anchor})`] : []),
    ``,
    `| # | زمان | مدت | شکل | مکان | متن کارت | دلیل |`,
    `|---|---|---|---|---|---|---|`,
    ...sheet.beats.map(
      (b) =>
        `| ${b.n} | ${b.start.toFixed(2)} | ${b.duration} | ${b.fa} | ${b.zone.id} | ${b.content.headline || b.content.latin || '—'} | ${b.why} |`,
    ),
    ``,
    `## حذف‌شده‌ها`,
    ...(info.icons.dropped.length ? info.icons.dropped.map((d) => `- آیکون: ${d}`) : ['- چیزی حذف نشد.']),
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const round3 = (v) => Math.round(v * 1000) / 1000;
