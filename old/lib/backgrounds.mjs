/**
 * Background designs. One source of truth: the same `css` + `html` that paints
 * a stage in the render also paints the thumbnail in the panel, so what the
 * user picks is exactly what ships.
 *
 * Every design is deterministic: a fixed `seed`, bounded drift tweens tied to
 * the film length, no `repeat: -1`, no live blur on a video layer.
 */

const MINT = '#55e6a5';
const GROUND = '#1d1d1d';
const GROUND_DEEP = '#181818';
const SURFACE = '#232323';

/** The brand accent for this stage; the house mint is only the fallback. */
const accentOf = (ctx) => ctx?.brand?.palette?.accent || MINT;
const groundOf = (ctx) => ctx?.brand?.palette?.ground || GROUND;

/** `g` is the geometry from ratios.mjs. */
function dots(g, { opacity = 0.35, pitch = 34, size = 1.6 } = {}) {
  const drift = pitch * 2;
  return {
    css: `
      .st-dots {
        position: absolute;
        inset: -${drift}px;
        background-image: radial-gradient(rgba(255,255,255,0.2) ${size}px, transparent ${size + 0.1}px);
        background-size: ${pitch}px ${pitch}px;
        -webkit-mask-image: radial-gradient(ellipse at 50% 45%, #000 0%, transparent 72%);
        mask-image: radial-gradient(ellipse at 50% 45%, #000 0%, transparent 72%);
        opacity: ${opacity};
        will-change: transform;
        z-index: 0;
      }`,
    html: `<div id="st-dots" class="st-dots" data-layout-ignore></div>`,
    motion: (film) =>
      `tl.fromTo("#st-dots", { x: 0, y: 0 }, { x: -${pitch}, y: -${Math.round(pitch / 2)}, duration: ${film}, ease: "none" }, 0);`,
  };
}

function glows(g, accent = MINT) {
  return {
    css: `
      .st-glow { position: absolute; inset: -25%; z-index: 0; pointer-events: none; }
      .st-glow-a { background: radial-gradient(circle at 82% 8%, ${hexRgba(accent, 0.18)} 0%, ${hexRgba(accent, 0)} 42%); }
      .st-glow-b { background: radial-gradient(circle at 12% 96%, ${hexRgba(accent, 0.12)} 0%, ${hexRgba(accent, 0)} 48%); }`,
    html: `<div id="st-glow-a" class="st-glow st-glow-a" data-layout-ignore></div>
      <div id="st-glow-b" class="st-glow st-glow-b" data-layout-ignore></div>`,
  };
}

/** `#55e6a5` + alpha → `rgba(85,230,165,a)`; local helper so this file stays dependency-free. */
function hexRgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return `rgba(85,230,165,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function waves(g, { opacity = [0.18, 0.1, 0.06], heightFrac = 0.46, accent = MINT } = {}) {
  const w = g.w + 400;
  const h = Math.round(g.h * heightFrac);
  const period = 48;
  const y = (f) => Math.round(h * f);
  const path = (base, amp) =>
    `M-120 ${y(base)} C ${w * 0.1} ${y(base - amp)}, ${w * 0.19} ${y(base + amp)}, ${w * 0.34} ${y(base)} S ${w * 0.57} ${y(base - amp)}, ${w * 0.73} ${y(base)} S ${w * 0.91} ${y(base + amp)}, ${w + 120} ${y(base)}`;
  return {
    css: `
      .st-waves {
        position: absolute;
        left: -200px;
        bottom: -60px;
        width: ${w}px;
        height: ${h}px;
        will-change: transform;
        z-index: 1;
        pointer-events: none;
      }`,
    html: `<svg id="st-waves" class="st-waves" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" fill="none" data-layout-ignore aria-hidden="true">
        <path d="${path(0.68, 0.2)}" stroke="${accent}" stroke-opacity="${opacity[0]}" stroke-width="2"/>
        <path d="${path(0.78, 0.17)}" stroke="${accent}" stroke-opacity="${opacity[1]}" stroke-width="2"/>
        <path d="${path(0.88, 0.13)}" stroke="${accent}" stroke-opacity="${opacity[2]}" stroke-width="2"/>
      </svg>`,
    motion: (film) =>
      `tl.fromTo("#st-waves", { x: 0 }, { x: -${period}, duration: ${film}, ease: "none" }, 0);`,
  };
}

/**
 * Each design: fa/hint for the picker, `needs` to gate it on the source kind,
 * `stage(g)` → { css, html, motion[] }, plus the flat colour the letterbox and
 * title/endcard compositions sit on so the whole film stays coherent.
 */
/* Textured grounds (asset store): the plate is copied into the project only
 * when it exists, and every stage here draws a code-only fallback when it is
 * not — a missing pack degrades the look, never the render. */
function texturedStage(id, g, ctx, { file, base, wash }) {
  const rel = 'assets/store/' + file;
  const have = !!ctx.assets?.includes(rel);
  const photo = have
    ? `.st-tex { position: absolute; inset: 0; z-index: 0; background: url('${rel}') center/cover; filter: brightness(0.34) contrast(1.06) saturate(0.6); }
       .st-texwash { position: absolute; inset: 0; z-index: 1; background: ${wash}; }`
    : `.st-tex { position: absolute; inset: 0; z-index: 0; background: ${base}; }
       .st-texwash { position: absolute; inset: 0; z-index: 1; background: ${wash}; }`;
  const w = waves(g, { opacity: [0.22, 0.13, 0.07], heightFrac: 0.55, accent: accentOf(ctx) });
  return {
    css: `${photo}${w.css}`,
    html: `<div class="st-tex" data-layout-ignore></div><div class="st-texwash" data-layout-ignore></div>${w.html}`,
    motion: [w.motion],
  };
}

export const BACKGROUNDS = [
  {
    id: 'paper-grid',
    fa: 'کاغذ شطرنجی (قالب ۰۰۱)',
    hint: 'سفید با شبکهٔ مویی خاکستری و وینیت ملایم — قالب کارتون UI',
    ground: '#FFFFFF',
    stage(g, ctx) {
      const cell = Math.max(56, Math.round(g.base * 0.08)); // ≈86 px @1080 — the reel's grid pitch
      const line = hexRgba('#111111', 0.13);
      return {
        css: `
          .st-paper { position: absolute; inset: 0; background: ${ctx?.brand?.palette?.ground || '#FFFFFF'}; z-index: 0; }
          .st-grid {
            position: absolute; inset: 0; z-index: 0;
            background-image:
              linear-gradient(to right, ${line} 1px, transparent 1px),
              linear-gradient(to bottom, ${line} 1px, transparent 1px);
            background-size: ${cell}px ${cell}px;
            background-position: center top;
          }
          .st-paperwash { position: absolute; inset: 0; z-index: 1; pointer-events: none;
            background:
              radial-gradient(130% 100% at 50% 46%, rgba(210,208,204,0) 55%, rgba(200,198,194,0.4) 100%),
              linear-gradient(180deg, rgba(243,236,225,0.55) 0%, rgba(255,255,255,0) 20%, rgba(255,255,255,0) 80%, rgba(243,236,225,0.55) 100%);
          }`,
        html: `<div class="st-paper" data-layout-ignore></div><div class="st-grid" data-layout-ignore></div>
      <div class="st-paperwash" data-layout-ignore></div>`,
        motion: [],
      };
    },
  },
  {
    id: 'black',
    fa: 'مشکی خالص',
    hint: 'تاریکی کامل، بدون هیچ بافتی',
    ground: '#000000',
    stage(g) {
      return {
        css: `.st-black { position: absolute; inset: 0; background: #000; z-index: 0; }`,
        html: `<div class="st-black" data-layout-ignore></div>`,
        motion: [],
      };
    },
  },
  {
    id: 'site',
    fa: 'متناسب با سایتم',
    hint: 'گرافیت برند + هاله‌های مینت + نقاط و موج',
    ground: GROUND,
    stage(g, ctx) {
      const A = accentOf(ctx);
      const d = dots(g), gl = glows(g, A), w = waves(g, { accent: A });
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${groundOf(ctx)}; z-index: 0; }
          ${gl.css}
          ${d.css}
          ${w.css}`,
        html: `<div class="st-ground" data-layout-ignore></div>${gl.html}${d.html}${w.html}`,
        motion: [d.motion, w.motion],
      };
    },
  },
  {
    id: 'zigzag',
    fa: 'زیگزاگ',
    hint: 'دندانه‌های مورب، آرام و تکرارشونده',
    ground: GROUND_DEEP,
    stage(g, ctx) {
      const period = 120;
      const rows = Math.ceil(g.h / 96) + 2;
      const A = accentOf(ctx);
      const paths = [];
      for (let i = 0; i < rows; i++) {
        const y = 40 + i * 96;
        const segs = [];
        for (let x = -period; x < g.w + period * 2; x += period / 2) {
          const up = (x / (period / 2)) % 2 === 0;
          segs.push(`L${x} ${y + (up ? 0 : 26)}`);
        }
        paths.push(
          `<path d="M${-period} ${y} ${segs.join(' ')}" stroke="${i % 3 === 1 ? A : '#ffffff'}" stroke-opacity="${i % 3 === 1 ? 0.14 : 0.05}" stroke-width="2" fill="none"/>`,
        );
      }
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${GROUND_DEEP}; z-index: 0; }
          .st-zig { position: absolute; top: -40px; left: -${period}px; width: ${g.w + period * 2}px; height: ${g.h + 80}px; will-change: transform; z-index: 1; pointer-events: none; }`,
        html: `<div class="st-ground" data-layout-ignore></div>
      <svg id="st-zig" class="st-zig" viewBox="0 0 ${g.w + period * 2} ${g.h + 80}" preserveAspectRatio="none" data-layout-ignore aria-hidden="true">${paths.join('\n      ')}</svg>`,
        motion: [
          (film) =>
            `tl.fromTo("#st-zig", { x: 0 }, { x: -${period}, duration: ${film}, ease: "none" }, 0);`,
        ],
      };
    },
  },
  {
    id: 'grid',
    fa: 'شبکهٔ فنی',
    hint: 'خط‌های مویی با مرکز روشن',
    ground: GROUND,
    stage(g, ctx) {
      const pitch = 72;
      const A = accentOf(ctx);
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${groundOf(ctx)}; z-index: 0; }
          .st-grid {
            position: absolute; inset: -${pitch}px;
            background-image:
              linear-gradient(to right, rgba(255,255,255,0.075) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.075) 1px, transparent 1px);
            background-size: ${pitch}px ${pitch}px;
            -webkit-mask-image: radial-gradient(ellipse at 50% 50%, #000 0%, rgba(0,0,0,0.35) 62%, transparent 88%);
            mask-image: radial-gradient(ellipse at 50% 50%, #000 0%, rgba(0,0,0,0.35) 62%, transparent 88%);
            will-change: transform; z-index: 0; pointer-events: none;
          }
          .st-grid-glow { position: absolute; inset: -30%; background: radial-gradient(circle at 50% 50%, ${hexRgba(A, 0.14)} 0%, ${hexRgba(A, 0)} 45%); z-index: 0; pointer-events: none; }`,
        html: `<div class="st-ground" data-layout-ignore></div>
      <div id="st-grid" class="st-grid" data-layout-ignore></div>
      <div class="st-grid-glow" data-layout-ignore></div>`,
        motion: [
          (film) => `tl.fromTo("#st-grid", { x: 0 }, { x: -${pitch}, duration: ${film}, ease: "none" }, 0);`,
        ],
      };
    },
  },
  {
    id: 'dots',
    fa: 'میدان نقطه‌ای',
    hint: 'نقاط خانهٔ برند روی گرافیت، بدون موج',
    ground: GROUND,
    stage(g, ctx) {
      const d = dots(g, { opacity: 0.5 });
      return {
        css: `.st-ground { position: absolute; inset: 0; background: ${groundOf(ctx)}; z-index: 0; }${d.css}`,
        html: `<div class="st-ground" data-layout-ignore></div>${d.html}`,
        motion: [d.motion],
      };
    },
  },
  {
    id: 'diagonal',
    fa: 'برش مورب',
    hint: 'دو سطح با درز مینت',
    ground: GROUND,
    stage(g, ctx) {
      const A = accentOf(ctx);
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${groundOf(ctx)}; z-index: 0; }
          .st-diag {
            position: absolute; inset: 0; background: ${SURFACE}; z-index: 0;
            clip-path: polygon(0 100%, 0 ${Math.round(g.h * 0.42)}%, 100% 100%);
          }
          .st-seam {
            position: absolute; left: -10%; top: ${Math.round(g.h * 0.4)}%; width: 130%; height: 2px;
            background: linear-gradient(to right, ${hexRgba(A, 0)} 0%, ${A} 45%, ${hexRgba(A, 0)} 100%);
            transform-origin: left center; opacity: .8; z-index: 1; pointer-events: none;
          }`,
        html: `<div class="st-ground" data-layout-ignore></div>
      <div class="st-diag" data-layout-ignore></div>
      <div id="st-seam" class="st-seam" data-layout-ignore></div>`,
        motion: [
          (film) =>
            `tl.fromTo("#st-seam", { scaleX: 0.82, opacity: 0.5 }, { scaleX: 1, opacity: 0.9, duration: ${film}, ease: "sine.inOut" }, 0);`,
        ],
      };
    },
  },
  {
    id: 'waves',
    fa: 'موج‌های مینت',
    hint: 'سه موج بزرگ در ثلث پایین',
    ground: GROUND_DEEP,
    stage(g, ctx) {
      const w = waves(g, { opacity: [0.3, 0.18, 0.1], heightFrac: 0.62, accent: accentOf(ctx) });
      return {
        css: `.st-ground { position: absolute; inset: 0; background: ${GROUND_DEEP}; z-index: 0; }${w.css}`,
        html: `<div class="st-ground" data-layout-ignore></div>${w.html}`,
        motion: [w.motion],
      };
    },
  },
  {
    id: 'grain',
    fa: 'گرین فیلمی',
    hint: 'تاریکی با نویز سینمایی و وینیت',
    ground: '#0d0d0d',
    stage(g, ctx) {
      /* The store's grain plate (one pre-rendered PNG) replaces the per-frame
       * SVG turbulence filter — same look, far cheaper at 30 fps. */
      const plate = !!ctx.assets?.includes('assets/store/grain.png');
      const grainCss = plate
        ? `.st-grain { position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0.09;
             background: url('assets/store/grain.png') repeat; background-size: 540px 540px; mix-blend-mode: overlay; }`
        : `.st-grain { position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0.07; }`;
      const grainHtml = plate
        ? `<div class="st-grain" data-layout-ignore aria-hidden="true"></div>`
        : `<svg class="st-grain" data-layout-ignore aria-hidden="true">
        <filter id="st-grainf">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="7" stitchTiles="stitch"/>
          <feColorMatrix type="saturate" values="0"/>
        </filter>
        <rect width="${g.w}" height="${g.h}" filter="url(#st-grainf)"/>
      </svg>`;
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: #0d0d0d; z-index: 0; }
          .st-vig { position: absolute; inset: 0; z-index: 2; pointer-events: none;
            background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 100%); }
          ${grainCss}`,
        html: `<div class="st-ground" data-layout-ignore></div>
      ${grainHtml}
      <div class="st-vig" data-layout-ignore></div>`,
        motion: [],
      };
    },
  },
  {
    id: 'metal',
    fa: 'فلز مات',
    hint: 'بافت فلز تیره — زمینِ نمای نزدیک محصول (نیازمند asset store)',
    ground: '#101010',
    stage(g, ctx) {
      return texturedStage('metal', g, ctx, {
        file: 'metal043a.jpg',
        base: 'linear-gradient(165deg, #1a1a1a, #0e0e0e)',
        wash: `radial-gradient(ellipse at 50% 30%, ${hexRgba(accentOf(ctx), 0.05)}, rgba(0,0,0,0.4) 75%)`,
      });
    },
  },
  {
    id: 'concrete',
    fa: 'بتن خام',
    hint: 'بتن خامِ صنعتی، بی‌ادعا (نیازمند asset store)',
    ground: '#121212',
    stage(g, ctx) {
      return texturedStage('concrete', g, ctx, {
        file: 'concrete034.jpg',
        base: 'linear-gradient(180deg, #161616, #0f0f0f)',
        wash: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.45))',
      });
    },
  },
  {
    id: 'fabric',
    fa: 'پارچهٔ بافته',
    hint: 'بافت پارچه‌ای نرم برای فیلم‌های کم‌انرژی (نیازمند asset store)',
    ground: '#141210',
    stage(g, ctx) {
      return texturedStage('fabric', g, ctx, {
        file: 'fabric066.jpg',
        base: 'linear-gradient(160deg, #1b1815, #121110)',
        wash: 'linear-gradient(180deg, rgba(20,18,14,0.25), rgba(0,0,0,0.5))',
      });
    },
  },
  {
    id: 'mint-edge',
    fa: 'لبهٔ مینت',
    hint: 'قاب مویی با نوار روشن پایین',
    ground: GROUND,
    stage(g, ctx) {
      const A = accentOf(ctx);
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${groundOf(ctx)}; z-index: 0; }
          .st-frame { position: absolute; inset: ${Math.round(g.base * 0.03)}px; border: 1px solid rgba(255,255,255,0.12); z-index: 1; pointer-events: none; }
          .st-edge { position: absolute; left: 0; right: 0; bottom: 0; height: ${Math.round(g.h * 0.16)}px; z-index: 1; pointer-events: none;
            background: linear-gradient(to top, ${hexRgba(A, 0.16)} 0%, ${hexRgba(A, 0)} 100%); }`,
        html: `<div class="st-ground" data-layout-ignore></div>
      <div id="st-edge" class="st-edge" data-layout-ignore></div>
      <div id="st-frame" class="st-frame" data-layout-ignore></div>`,
        motion: [
          (film) =>
            `tl.fromTo("#st-frame", { opacity: 0.55 }, { opacity: 1, duration: ${Math.min(film, 2.4)}, ease: "sine.inOut", yoyo: true, repeat: ${Math.max(1, Math.floor(film / 4.8)) - 1} }, 0);`,
        ],
      };
    },
  },
  {
    id: 'source-blur',
    fa: 'ویدیوی محوِ خودت',
    hint: 'فقط وقتی فایل ویدیویی داده‌ای: پس‌زمینه از همان منبع',
    needs: 'video',
    ground: '#000000',
    stage(g, ctx) {
      if (!ctx?.videoSrc) {
        return {
          css: `.st-ground { position: absolute; inset: 0; background: #000; z-index: 0; }`,
          html: `<div class="st-ground" data-layout-ignore></div>`,
          motion: [],
        };
      }
      const scale = 1.25;
      return {
        css: `
          .st-blur-wrap { position: absolute; inset: 0; overflow: hidden; z-index: 0; background: #000; }
          .st-blur { position: absolute; inset: -8%; width: ${Math.round(g.w * scale)}px; height: ${Math.round(g.h * scale)}px;
            left: ${Math.round(-g.w * (scale - 1) / 2)}px; top: ${Math.round(-g.h * (scale - 1) / 2)}px;
            object-fit: cover; filter: blur(${Math.round(g.base * 0.022)}px) saturate(0.85) brightness(0.55); }
          .st-blur-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.35); z-index: 1; }`,
        html: `<div class="st-blur-wrap" data-layout-ignore>
          <video id="st-blur" class="st-blur" src="${ctx.videoSrc}" muted data-start="0" data-duration="${ctx.film}" data-track-index="1" data-track-kind="video" data-layout-ignore></video>
        </div>
        <div class="st-blur-dim" data-layout-ignore></div>`,
        motion: [
          (film) => `tl.fromTo("#st-blur", { scale: 1 }, { scale: 1.06, duration: ${film}, ease: "none" }, 0);`,
        ],
      };
    },
  },
];

export const BACKGROUND_IDS = BACKGROUNDS.map((b) => b.id);
export const DEFAULT_BACKGROUND = 'site';

export function backgroundById(id) {
  return BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS.find((b) => b.id === DEFAULT_BACKGROUND);
}

/** Everything the stage needs: flat css/html plus the bounded drift tweens. */
export function buildStage(id, g, ctx = {}) {
  const bg = backgroundById(id);
  const stage = bg.stage(g, ctx);
  return { bg, css: stage.css, html: stage.html, motion: stage.motion };
}
