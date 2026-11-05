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

function glows(g) {
  return {
    css: `
      .st-glow { position: absolute; inset: -25%; z-index: 0; pointer-events: none; }
      .st-glow-a { background: radial-gradient(circle at 82% 8%, rgba(85,230,165,0.18) 0%, rgba(85,230,165,0) 42%); }
      .st-glow-b { background: radial-gradient(circle at 12% 96%, rgba(85,230,165,0.12) 0%, rgba(85,230,165,0) 48%); }`,
    html: `<div id="st-glow-a" class="st-glow st-glow-a" data-layout-ignore></div>
      <div id="st-glow-b" class="st-glow st-glow-b" data-layout-ignore></div>`,
  };
}

function waves(g, { opacity = [0.18, 0.1, 0.06], heightFrac = 0.46 } = {}) {
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
        <path d="${path(0.68, 0.2)}" stroke="${MINT}" stroke-opacity="${opacity[0]}" stroke-width="2"/>
        <path d="${path(0.78, 0.17)}" stroke="${MINT}" stroke-opacity="${opacity[1]}" stroke-width="2"/>
        <path d="${path(0.88, 0.13)}" stroke="${MINT}" stroke-opacity="${opacity[2]}" stroke-width="2"/>
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
export const BACKGROUNDS = [
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
    stage(g) {
      const d = dots(g), gl = glows(g), w = waves(g);
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${GROUND}; z-index: 0; }
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
    stage(g) {
      const period = 120;
      const rows = Math.ceil(g.h / 96) + 2;
      const paths = [];
      for (let i = 0; i < rows; i++) {
        const y = 40 + i * 96;
        const segs = [];
        for (let x = -period; x < g.w + period * 2; x += period / 2) {
          const up = (x / (period / 2)) % 2 === 0;
          segs.push(`L${x} ${y + (up ? 0 : 26)}`);
        }
        paths.push(
          `<path d="M${-period} ${y} ${segs.join(' ')}" stroke="${i % 3 === 1 ? MINT : '#ffffff'}" stroke-opacity="${i % 3 === 1 ? 0.14 : 0.05}" stroke-width="2" fill="none"/>`,
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
    stage(g) {
      const pitch = 72;
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${GROUND}; z-index: 0; }
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
          .st-grid-glow { position: absolute; inset: -30%; background: radial-gradient(circle at 50% 50%, rgba(85,230,165,0.14) 0%, rgba(85,230,165,0) 45%); z-index: 0; pointer-events: none; }`,
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
    stage(g) {
      const d = dots(g, { opacity: 0.5 });
      return {
        css: `.st-ground { position: absolute; inset: 0; background: ${GROUND}; z-index: 0; }${d.css}`,
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
    stage(g) {
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${GROUND}; z-index: 0; }
          .st-diag {
            position: absolute; inset: 0; background: ${SURFACE}; z-index: 0;
            clip-path: polygon(0 100%, 0 ${Math.round(g.h * 0.42)}%, 100% 100%);
          }
          .st-seam {
            position: absolute; left: -10%; top: ${Math.round(g.h * 0.4)}%; width: 130%; height: 2px;
            background: linear-gradient(to right, rgba(85,230,165,0) 0%, ${MINT} 45%, rgba(85,230,165,0) 100%);
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
    stage(g) {
      const w = waves(g, { opacity: [0.3, 0.18, 0.1], heightFrac: 0.62 });
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
    stage(g) {
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: #0d0d0d; z-index: 0; }
          .st-vig { position: absolute; inset: 0; z-index: 2; pointer-events: none;
            background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 100%); }
          .st-grain { position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0.07; }`,
        html: `<div class="st-ground" data-layout-ignore></div>
      <svg class="st-grain" data-layout-ignore aria-hidden="true">
        <filter id="st-grainf">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="7" stitchTiles="stitch"/>
          <feColorMatrix type="saturate" values="0"/>
        </filter>
        <rect width="${g.w}" height="${g.h}" filter="url(#st-grainf)"/>
      </svg>
      <div class="st-vig" data-layout-ignore></div>`,
        motion: [],
      };
    },
  },
  {
    id: 'mint-edge',
    fa: 'لبهٔ مینت',
    hint: 'قاب مویی با نوار روشن پایین',
    ground: GROUND,
    stage(g) {
      return {
        css: `
          .st-ground { position: absolute; inset: 0; background: ${GROUND}; z-index: 0; }
          .st-frame { position: absolute; inset: ${Math.round(g.base * 0.03)}px; border: 1px solid rgba(255,255,255,0.12); z-index: 1; pointer-events: none; }
          .st-edge { position: absolute; left: 0; right: 0; bottom: 0; height: ${Math.round(g.h * 0.16)}px; z-index: 1; pointer-events: none;
            background: linear-gradient(to top, rgba(85,230,165,0.16) 0%, rgba(85,230,165,0) 100%); }`,
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
