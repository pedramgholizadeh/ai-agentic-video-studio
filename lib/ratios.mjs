/**
 * Output ratios the studio can render. Every entry carries the canvas the
 * HyperFrames composition is authored at, so a job's ratio is decided once,
 * here, and everything else (type scale, safe margins, caption band) derives
 * from it.
 */
export const RATIOS = [
  { id: '1:1', fa: 'مربع', hint: 'فید اینستاگرام', w: 1080, h: 1080 },
  { id: '3:4', fa: 'عمودی ۳:۴', hint: 'پوستر، ریلز کات‌خورده', w: 1080, h: 1440 },
  { id: '4:3', fa: 'افقی ۴:۳', hint: 'ارائه، تلویزیون', w: 1440, h: 1080 },
  { id: '16:9', fa: 'افقی ۱۶:۹', hint: 'یوتیوب، وب', w: 1920, h: 1080 },
  { id: '9:16', fa: 'عمودی ۹:۱۶', hint: 'ریلز، استوری، تیک‌تاک', w: 1080, h: 1920 },
  { id: '2:1', fa: 'برند ۲:۱', hint: 'نسبت خانه', w: 1920, h: 960 },
];

export const RATIO_IDS = RATIOS.map((r) => r.id);

export function ratioById(id) {
  return RATIOS.find((r) => r.id === id) || RATIOS.find((r) => r.id === '2:1');
}

/**
 * Geometry for one canvas. Sizes are fractions of the short side so the house
 * look survives every ratio; the 2:1 numbers reproduce brand-look.md.
 */
export function geometry(w, h) {
  const base = Math.min(w, h);
  const px = (f) => Math.round(f * base);
  return {
    w,
    h,
    base,
    /** title-safe padding on the inline (RTL: horizontal) axis */
    padInline: Math.max(48, Math.round(w * 0.085)),
    padBlock: Math.max(40, Math.round(h * 0.06)),
    kicker: px(0.0333),
    headline: px(0.1375),
    sub: px(0.0479),
    caption: px(0.0792),
    capBottom: px(0.0917),
    capPaddingInline: Math.round(w * 0.11),
    capMaxWidth: Math.round(w * 0.77),
    endName: px(0.1167),
    endRule: px(0.5417),
    endSite: px(0.0396),
    /** Instagram hides the top ~180px of a 1080-wide reel on upload. */
    topSafe: h > w ? Math.round(h * 0.095) : Math.round(h * 0.04),
    bottomSafe: h > w ? Math.round(h * 0.12) : Math.round(h * 0.04),
  };
}
