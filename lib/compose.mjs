import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TEMPLATE_DIR, SRT_TOOL } from './paths.mjs';
import { buildStage } from './backgrounds.mjs';
import { projectStoreFiles, terminalFonts } from './assets.mjs';
import { geometry, ratioById } from './ratios.mjs';

/** Fractions of a split frame: the graphics panel and the face video. */
const PANEL_FRAC = 1 / 3;

/**
 * Where the picture and the words sit for one layout. `cover` fills the frame,
 * `contain` letterboxes it into the brand ground, `split` keeps the house
 * collage rule for vertical reels: nothing critical inside the top safe band,
 * graphics in a flat panel, the face video below it.
 */
export function layoutGeometry(plan) {
  const g = plan.g;
  const src = plan.source.video || plan.source.audio ? plan.source : {};
  const portrait = g.h > g.w;
  let layout = plan.layout;
  if (layout === 'auto') {
    if (!plan.source.video) layout = 'none';
    else {
      const sr = (plan.source.width || 0) / (plan.source.height || 1);
      layout = Math.abs(sr - g.w / g.h) < 0.06 ? 'cover' : 'contain';
    }
  }

  const out = { layout, videoBox: null, panelBox: null, capBottom: g.capBottom, capPad: g.capPaddingInline, capMax: g.capMaxWidth, capSize: g.caption };

  if (layout === 'cover') {
    out.videoBox = { left: 0, top: 0, width: g.w, height: g.h, fit: 'cover', radius: 0 };
    out.capBottom = Math.round(g.h * 0.08);
  } else if (layout === 'contain') {
    const pad = Math.round(Math.min(g.w, g.h) * 0.07);
    out.videoBox = {
      left: pad,
      top: Math.round(g.h * 0.14),
      width: g.w - pad * 2,
      height: Math.round(g.h * 0.6),
      fit: 'contain',
      radius: Math.round(g.base * 0.021),
    };
    out.capBottom = Math.round(g.h * 0.075);
    out.capSize = Math.round(g.caption * 0.86);
  } else if (layout === 'split') {
    if (portrait) {
      const panelH = Math.round(g.h * PANEL_FRAC);
      out.panelBox = { left: 0, top: 0, width: g.w, height: panelH };
      out.videoBox = {
        left: 0,
        top: panelH,
        width: g.w,
        height: g.h - panelH,
        fit: 'cover',
        radius: 0,
        position: '50% 26%',
      };
      out.capBottom = Math.round(g.h - panelH + (g.h - panelH) * 0.04);
      out.capSize = Math.round(g.caption * 0.74);
      out.capPad = Math.round(g.w * 0.07);
      out.capMax = Math.round(g.w * 0.86);
    } else {
      const panelW = Math.round(g.w * PANEL_FRAC);
      out.panelBox = { left: g.w - panelW, top: 0, width: panelW, height: g.h };
      out.videoBox = { left: 0, top: 0, width: g.w - panelW, height: g.h, fit: 'cover', radius: 0 };
      out.capBottom = Math.round(g.h * 0.07);
      out.capSize = Math.round(g.caption * 0.66);
      out.capPad = Math.round((g.w - panelW) * 0.06);
      out.capMax = Math.round((g.w - panelW) * 0.88);
    }
  }
  return out;
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Persian copy never gets split into letters; an accent word is wrapped, not sized. */
function accentSpan(text, word) {
  const safe = esc(text);
  if (!word) return safe;
  const w = esc(word);
  const i = safe.indexOf(w);
  if (i < 0) return safe;
  return `${safe.slice(0, i)}<span class="title-accent">${w}</span>${safe.slice(i + w.length)}`;
}

function titleComposition(plan, layout) {
  const g = plan.g;
  const box = layout.panelBox || { left: 0, top: 0, width: g.w, height: g.h };
  const t = plan.title;
  const pad = Math.round(box.width * 0.09);
  return `<template>
  <style>
    #root { position: absolute; inset: 0; overflow: hidden; }
    .title-wrap {
      position: absolute;
      left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px;
      display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
      padding-inline: ${pad}px;
    }
    .title-kicker-row { display: flex; align-items: center; gap: ${Math.round(g.base * 0.019)}px; margin-bottom: ${Math.round(g.base * 0.035)}px; }
    .title-kicker { color: var(--color-accent); font-size: ${g.kicker}px; font-weight: 500; line-height: 1.2; }
    .title-rule { display: block; width: ${Math.round(g.base * 0.096)}px; height: 2px; background: var(--color-accent); opacity: .9; }
    .title-headline { color: var(--color-ink); font-size: ${Math.round(g.headline * (layout.panelBox ? 0.62 : 1))}px; font-weight: 800; line-height: 1.28; max-width: ${box.width - pad * 2}px; text-align: right; }
    .title-headline .hm-word { opacity: 0; will-change: transform, opacity, filter; }
    .title-accent { color: var(--color-accent); display: inline-block; }
    .title-sub { margin-top: ${Math.round(g.base * 0.04)}px; color: var(--color-ink-muted); font-size: ${Math.round(g.sub * (layout.panelBox ? 0.8 : 1))}px; font-weight: 400; line-height: 1.5; text-align: right; opacity: 0; max-width: ${box.width - pad * 2}px; }
  </style>

  <div id="root" data-composition-id="title" data-width="${g.w}" data-height="${g.h}">
    <div id="title-wrap" class="title-wrap" data-layout-allow-overflow>
      <div id="title-kicker-row" class="title-kicker-row">
        <span id="title-kicker" class="title-kicker">${esc(t.kicker)}</span>
        <span id="title-rule" class="title-rule"></span>
      </div>
      <h1 id="title-headline" class="title-headline">${accentSpan(t.headline, t.accentWord)}</h1>
      <p id="title-sub" class="title-sub">${esc(t.sub)}</p>
    </div>
  </div>

  <script>
    const tl = gsap.timeline({ paused: true });
    /* blur-slide craft: the sub enters while the headline is still settling —
     * overlap reads as one sentence, queuing reads as two beats. */
    HM.revealLine(tl, "#title-kicker", { at: 0.16, duration: 0.3 });
    HM.drawRule(tl, "#title-rule", { at: 0.3, duration: 0.35 });
    HM.revealWords(tl, "#title-headline", { at: 0.44, stagger: 0.115, duration: 0.7 });
    HM.revealLine(tl, "#title-sub", { at: 1.18, duration: 0.4 });
    /* the accent word answers last: a settling zoom with one mint glow pulse —
     * the protagonist's single light moment, then the sheet stays quiet */
    tl.fromTo("#title-headline .title-accent", { scale: 1.14 }, { scale: 1, duration: 0.5, ease: "power3.inOut" }, 1.24);
    tl.fromTo(
      "#title-headline .title-accent",
      { textShadow: "0 0 0px rgba(85,230,165,0)" },
      { textShadow: "0 0 26px rgba(85,230,165,0.55)", duration: 0.32, ease: "power2.out" },
      1.3,
    );
    tl.to("#title-headline .title-accent", { textShadow: "0 0 0px rgba(85,230,165,0)", duration: 0.5, ease: "power2.inOut" }, 1.62);
    tl.fromTo("#title-wrap", { scale: 1 }, { scale: 1.025, duration: 3.0, ease: "power2.inOut" }, 0.2);
    tl.to("#title-wrap", { opacity: 0, y: -12, filter: "blur(6px)", duration: 0.25, ease: "power3.in" }, 3.15);
    window.__timelines["title"] = tl;
    tl.seek(0);
  </script>
</template>
`;
}

function endcardComposition(plan) {
  const g = plan.g;
  const e = plan.endcard;
  return `<template>
  <style>
    #root { position: absolute; inset: 0; overflow: hidden; }
    .end-wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: ${Math.round(g.base * 0.027)}px; text-align: center; padding-inline: ${Math.round(g.w * 0.06)}px; }
    .end-name { display: flex; align-items: center; gap: ${Math.round(g.base * 0.021)}px; color: var(--color-ink); font-size: ${g.endName}px; font-weight: 700; line-height: 1.3; }
    .end-name .hm-word { opacity: 0; will-change: transform, opacity, filter; }
    .end-dot { display: block; width: ${Math.round(g.base * 0.0146)}px; height: ${Math.round(g.base * 0.0146)}px; border-radius: 50%; background: var(--color-accent); transform: scale(0); }
    .end-rule { display: block; width: ${Math.min(g.endRule, Math.round(g.w * 0.7))}px; height: 2px; background: var(--color-accent); opacity: .55; transform-origin: right center; }
    .end-site { color: var(--color-ink-muted); font-size: ${g.endSite}px; font-weight: 500; line-height: 1.4; opacity: 0; }
    .end-site span { direction: ltr; unicode-bidi: isolate; }
  </style>

  <div id="root" data-composition-id="endcard" data-width="${g.w}" data-height="${g.h}">
    <div id="end-wrap" class="end-wrap">
      <div class="end-name"><span id="end-name-text">${esc(e.name)}</span><span id="end-dot" class="end-dot"></span></div>
      <span id="end-rule" class="end-rule"></span>
      <div id="end-site" class="end-site">${e.site ? `<span>${esc(e.site)}</span>` : ''}</div>
    </div>
  </div>

  <script>
    const tl = gsap.timeline({ paused: true });
    HM.revealWords(tl, "#end-name-text", { at: 0.15, stagger: 0.09, fromY: "0.3em", push: true, duration: 0.42 });
    tl.fromTo("#end-dot", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.32, ease: "back.out(1.8)" }, 0.5);
    HM.drawRule(tl, "#end-rule", { at: 0.56, duration: 0.4 });
    HM.revealLine(tl, "#end-site", { at: 0.82, duration: 0.28 });
    /* closing signature: one mint sweep across the address, then rest */
    HM.sweep(tl, "#end-site span", { at: 1.35, duration: 1.0 });
    window.__timelines["endcard"] = tl;
    tl.seek(0);
  </script>
</template>
`;
}

/** The picture layer: the user's footage, framed by the layout, never cropped blindly. */
function mediaLayers(plan, layout, film, srcRel) {
  const out = [];
  if (layout.videoBox && plan.source.video && srcRel.video) {
    const b = layout.videoBox;
    const dur = Math.min(film, plan.source.duration || film);
    out.push(`      <div id="media-frame" class="media-frame" data-layout-allow-overflow>
        <video id="cam" class="clip media-el" data-start="0" data-duration="${dur.toFixed(2)}" data-volume="${plan.media.volume}" data-has-audio="true" playsinline src="${srcRel.video}"></video>
      </div>`);
    out.push(
      `      <style>.media-frame { position: absolute; left: ${b.left}px; top: ${b.top}px; width: ${b.width}px; height: ${b.height}px; overflow: hidden; border-radius: ${b.radius}px; ${b.radius ? 'box-shadow: 0 18px 60px rgba(0,0,0,.35); border: 1px solid var(--color-hairline);' : ''} } .media-el { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: ${b.fit}; object-position: ${b.position || '50% 50%'}; }</style>`,
    );
    // The soundtrack of the picture is the film's soundtrack; no extra audio tag.
  } else if (plan.source.audio && srcRel.audio) {
    const dur = Math.min(film, plan.source.duration || film);
    out.push(`      <audio id="vo" class="clip" data-start="0" data-duration="${dur.toFixed(2)}" data-volume="${plan.media.volume}" data-track-index="5" data-track-kind="audio" data-has-audio="true" src="${srcRel.audio}"></audio>`);
  }
  return out.join('\n');
}

function indexHtml(plan, layout, stage) {
  const g = plan.g;
  const motions = stage.motion.map((fn) => `      ${fn('film')}`).join('\n');
  const panelStyle = layout.panelBox
    ? `.panel-bg { position: absolute; left: ${layout.panelBox.left}px; top: ${layout.panelBox.top}px; width: ${layout.panelBox.width}px; height: ${layout.panelBox.height}px; background: ${plan.bgGround}; z-index: 2; }`
    : '';
  const panelHtml = layout.panelBox ? `<div class="panel-bg" data-layout-ignore></div>` : '';
  return `<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${g.w}, height=${g.h}" />
    <title>${esc(plan.name)} — ${g.w}×${g.h}</title>
    <link rel="preload" href="assets/fonts/vazirmatn-arabic-100-900.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="assets/fonts/vazirmatn.css" />
    <script src="assets/vendor/gsap.min.js"></script>
    <script src="assets/hypermotion.js"></script>
    <style>
      :root {
        --color-ground: ${plan.bgGround};
        --color-ground-deep: #181818;
        --color-surface: #232323;
        --color-ink: #ffffff;
        --color-ink-muted: rgba(255, 255, 255, 0.55);
        --color-ink-faint: rgba(255, 255, 255, 0.32);
        --color-hairline: rgba(255, 255, 255, 0.12);
        --color-accent: #55e6a5;
        --color-accent-deep: #2fb87e;
        --color-accent-wash: rgba(85, 230, 165, 0.16);
        --color-micro: #e8fe51;
        --font-fa: "Vazirmatn";
        --cap-size: ${layout.capSize}px;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${g.w}px; height: ${g.h}px; overflow: hidden; background: ${plan.bgGround}; }
      body { color: var(--color-ink); font-family: var(--font-fa), sans-serif; font-weight: 400; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
      #root { position: relative; width: ${g.w}px; height: ${g.h}px; overflow: hidden; background: ${plan.bgGround}; }
      .scene-host { position: absolute; inset: 0; }
      #title-host { z-index: 10; }
      #captions-host, .captions-host { z-index: 20; }
      #endcard-host { z-index: 30; }
      ${stage.css}
      ${panelStyle}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${plan.filmGuess}" data-width="${g.w}" data-height="${g.h}" data-fps="${plan.fps}">
      ${stage.html}
      ${panelHtml}
      <!-- media:start -->
      <!-- media:end -->
      <div
        id="title-host"
        class="scene-host"
        data-composition-id="title"
        data-composition-src="compositions/title.html"
        data-start="0"
        data-duration="3.6"
        data-width="${g.w}"
        data-height="${g.h}"
        data-track-index="10"
        data-track-kind="graphics"
      ></div>

      <!-- captions:start -->
      <div
        id="captions-host"
        class="scene-host captions-host"
        data-composition-id="captions"
        data-composition-src="compositions/captions.html"
        data-start="0"
        data-duration="${plan.filmGuess}"
        data-width="${g.w}"
        data-height="${g.h}"
        data-track-index="20"
        data-track-kind="captions"
      ></div>
      <!-- captions:end -->

      <div
        id="endcard-host"
        class="scene-host"
        data-composition-id="endcard"
        data-composition-src="compositions/endcard.html"
        data-start="${Math.max(0, plan.filmGuess - 3)}"
        data-duration="3"
        data-width="${g.w}"
        data-height="${g.h}"
        data-track-index="30"
        data-track-kind="graphics"
      ></div>
    </div>

    <script>
      const tl = gsap.timeline({ paused: true });
      const film = Number(document.getElementById("root").dataset.duration) || ${plan.filmGuess};
${motions}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

/** Hardlink when possible: this box has little free disk and a copy doubles it. */
function linkOrCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.linkSync(src, dest);
    return 'link';
  } catch {
    fs.copyFileSync(src, dest);
    return 'copy';
  }
}

export function runSrt(args, cwd) {
  return execFileSync(process.execPath, [SRT_TOOL, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Write a renderable HyperFrames project for one job. Returns the resolved film
 * length, the media layout and every warning the source raised.
 */
export function writeProject({ jobDir, plan }) {
  const warnings = [];
  const projectDir = path.join(jobDir, 'project');
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });

  fs.cpSync(path.join(TEMPLATE_DIR, 'assets'), path.join(projectDir, 'assets'), { recursive: true });
  for (const f of ['hyperframes.json']) {
    const p = path.join(TEMPLATE_DIR, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(projectDir, f));
  }
  fs.mkdirSync(path.join(projectDir, 'compositions'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'input'), { recursive: true });

  const layout = layoutGeometry(plan);
  const srcRel = { video: null, audio: null, srt: null };
  for (const kind of ['video', 'audio']) {
    const file = plan.source[kind];
    if (!file) continue;
    const name = path.basename(file);
    srcRel[kind] = `input/${name}`;
    const how = linkOrCopy(file, path.join(projectDir, 'input', name)) === 'link' ? 'پیوند سخت، بی‌کپی' : 'کپی شد';
    warnings.push(`منبع ${kind === 'video' ? 'ویدیویی' : 'صوتی'}: ${name} — ${how}`);
  }
  if (plan.source.srt) {
    const dest = path.join(projectDir, 'input', 'script.fa.srt');
    fs.copyFileSync(plan.source.srt, dest);
    srcRel.srt = dest;
  }

  /* The store's plates ride along only when the film uses them: the grain
   * plate, and the ground texture when the background asks for one. */
  const storeFiles = projectStoreFiles(plan);
  for (const f of storeFiles) {
    const dest = path.join(projectDir, 'assets', 'store', f.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.src, dest);
  }
  const storeRel = storeFiles.map((f) => `assets/store/${f.name}`);

  const stage = buildStage(plan.background, plan.g, {
    videoSrc: srcRel.video,
    film: plan.filmGuess,
    assets: storeRel,
  });

  fs.writeFileSync(path.join(projectDir, 'compositions', 'title.html'), titleComposition(plan, layout), 'utf8');
  fs.writeFileSync(path.join(projectDir, 'compositions', 'endcard.html'), endcardComposition(plan), 'utf8');
  fs.writeFileSync(path.join(projectDir, 'index.html'), indexHtml(plan, layout, stage), 'utf8');

  let film = plan.filmGuess;
  if (srcRel.srt) {
    runSrt(['parse', 'input/script.fa.srt', '--out', 'timeline.json'], projectDir);
    runSrt(['plan', 'timeline.json', '--out', 'timeline.json'], projectDir);
    const built = runSrt(['build', '.'], projectDir).trim();
    warnings.push(...built.split('\n'));
    // The caption engine writes 2:1 numbers; retarget them to this canvas.
    retargetCanvas(projectDir, plan.g);
    retuneCaptionBand(projectDir, layout);
    film = readRootDuration(projectDir);
  } else if (plan.captions.enabled && (plan.source.audio || plan.source.video)) {
    warnings.push('زیرنویسی در کار نیست؛ گفتار بدون متن روی صحنه می‌ماند.');
  }

  // Media layers land with the real film length.
  const idx = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  const layers = mediaLayers(plan, layout, film, srcRel);
  fs.writeFileSync(
    path.join(projectDir, 'index.html'),
    idx
      .replace('<!-- media:start -->\n      <!-- media:end -->', layers)
      .replace(/(<div id="root"[\s\S]*?data-duration=")[\d.]+(")/, `$1${film}$2`)
      .replace(/(id="captions-host"[\s\S]*?data-duration=")[\d.]+(")/, `$1${Math.max(0.1, film - 3)}$2`)
      .replace(/(id="endcard-host"[^>]*?data-start=")[\d.]+(")/, `$1${Math.max(0, film - 3)}$2`),
    'utf8',
  );

  fs.writeFileSync(
    path.join(jobDir, 'plan.json'),
    JSON.stringify({ ...plan, film, layout, warnings }, null, 2) + '\n',
    'utf8',
  );

  return { projectDir, film, layout, warnings };
}

function readRootDuration(projectDir) {
  const html = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  const m = html.match(/<div\s+id="root"[\s\S]*?data-duration="([\d.]+)"/);
  return m ? Number(m[1]) : 8;
}

function retargetCanvas(projectDir, g) {
  const files = ['index.html', ...fs.readdirSync(path.join(projectDir, 'compositions')).map((f) => path.join('compositions', f))];
  for (const rel of files) {
    const p = path.join(projectDir, rel);
    const src = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(
      p,
      src.replaceAll(`data-width="1920"`, `data-width="${g.w}"`).replaceAll(`data-height="960"`, `data-height="${g.h}"`),
      'utf8',
    );
  }
}

/** The caption band moves with the layout, so words never sit on a face. */
function retuneCaptionBand(projectDir, layout) {
  const compDir = path.join(projectDir, 'compositions');
  for (const f of fs.readdirSync(compDir)) {
    if (!/^captions(-\d+)?\.html$/.test(f)) continue;
    const p = path.join(compDir, f);
    const src = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(
      p,
      src
        .replace('bottom: 88px;', `bottom: ${layout.capBottom}px;`)
        .replace('padding-inline: 220px;', `padding-inline: ${layout.capPad}px;`)
        .replace('max-width: 1480px;', `max-width: ${layout.capMax}px;`),
      'utf8',
    );
  }
}

/** Defaults a job can override, all traceable to the brand sheet. */
export function defaultPlan({ ratio = '2:1', background = 'site', layout = 'auto', fps = 30, name = 'studio' }) {
  const r = ratioById(ratio);
  const g = geometry(r.w, r.h);
  return {
    name,
    ratio: r.id,
    background,
    layout,
    fps,
    g,
    bgGround: '#1d1d1d',
    filmGuess: 8,
    source: {},
    media: { volume: 1 },
    captions: { enabled: true },
    motion: { mode: 'motion', density: 'auto', material: 'glass', deliver: 'overlay', maxBeats: null },
    sound: { sfx: true, level: 'balanced' },
    reference: null,
    title: {
      kicker: 'موضوع ویدیو',
      headline: 'تیتر کوتاه ویدیو',
      accentWord: 'ویدیو',
      sub: 'توضیح یک‌خطی زیر تیتر',
    },
    endcard: { name: 'نام شما', site: 'example.com' },
  };
}
