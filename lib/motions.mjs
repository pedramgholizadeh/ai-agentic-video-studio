/* motions.mjs — the studio's motion-graphics vocabulary.

 A recipe is one graphic idea the writer knows how to draw and animate: what it
 needs from the content, how long it holds, where it may sit, which sounds it
 fires, and which words select it. This catalogue is the distilled form of the
 shot library that already lives on this machine
 (`…/video-shotcraft/references/shots/*.md`, 125 cards) plus the liquid-glass
 pattern proven in `videos/overlay-claude` and `videos/reel-clean`; each entry
 names the cards it came from so the provenance stays checkable.

 Every recipe renders as liquid glass with a 5 px radius on a transparent canvas,
 so it can sit above the user's own footage.
 */

export const RECIPES = [
  {
    id: 'keyword',
    fa: 'کارت کلیدواژه',
    draw: 'card',
    needs: ['headline'],
    len: [3.4, 7],
    energy: 'mid',
    cues: (b) => [{ role: 'cardIn', at: b.start + 0.08 }, { role: 'iconPop', at: b.start + 0.42 }],
    signals: [],
    from: ['effects/icon-performance-moves', 'ui-entrance/*'],
    about: 'یک کارت شیشه‌ای با آیکون و کلیدواژهٔ برجستهٔ گروه؛ پیش‌فرض امن برای هر محتوایی.',
  },
  {
    id: 'stat',
    fa: 'آمار شمارشی',
    draw: 'stat',
    needs: ['value', 'unit', 'headline'],
    len: [3.2, 6.5],
    energy: 'high',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'count', at: b.start + 0.55 },
      { role: 'emphasis', at: b.start + 0.55 + countDur(b.duration) },
    ],
    signals: [/([۰-۹0-9]+([.,][۰-۹0-9]+)?)\s*(٪|درصد|ثانیه|دقیقه|ساعت|روز|ماه|سال|نفر|بار|مرتبه|میلیون|میلیارد|هزار|GB|MB|TB|fps|تومان|دلار|یورو)/i],
    from: ['data/chart-live-moves', 'data/gauge-readout-moves'],
    about: 'عدد واقعیِ همان گروه، با شمارش تا مقدار و خط زیرش. فقط وقتی عدد در متن هست.',
  },
  {
    id: 'terminal',
    fa: 'ترمینال / تایپ لاتین',
    draw: 'terminal',
    needs: ['latin'],
    len: [3.6, 7],
    energy: 'mid',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'typing', at: b.start + 0.6 },
    ],
    signals: [/((?:https?:\/\/|www\.)[\w.-]+)|\b(ffmpeg|hyperframes|gsap|node|npm|npx|python|docker|git|api|sdk|json|mp4|webm|mov|srt|png|jpg|svg|html|css|js|ts|mp3|wav|cpu|gpu|ram|url|cli)\b/i],
    from: ['camera/terminal-3d', 'effects/assemble-then-type-flyin'],
    about: 'پنجرهٔ ترمینال شیشه‌ای که نام ابزار/آدرس را کاراکتر‌به‌کاراکتر تایپ می‌کند.',
  },
  {
    id: 'steps',
    fa: 'مراحل شمارش‌شده',
    draw: 'steps',
    needs: ['items'],
    len: [4.5, 9],
    energy: 'mid',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'chipOn', at: b.start + 0.7 },
      { role: 'chipOn', at: b.start + 1.35 },
    ],
    signals: [/(اول|دوم|سوم|چهارم|پنجم|۱[.):]|۲[.):]|۳[.):]|مرحله|گام|قدم|بعد از آن|سپس|در نهایت)/],
    from: ['interaction/chip-grid-single-select-blackout', 'data/timeline-travel'],
    about: 'سه تا پنج چیپ ترتیبی که یکی‌یکی روی هم می‌نشینند.',
  },
  {
    id: 'compare',
    fa: 'قبل و بعد',
    draw: 'compare',
    needs: ['headline', 'contrast'],
    len: [4, 8],
    energy: 'high',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'sceneChange', at: b.start + b.duration * 0.45 },
    ],
    signals: [/(اما|ولی|درحالی‌که|در صورتی که|قبلاً|الان|از this|به that|قبل|بعد|به‌جای|جاش)/],
    from: ['data/before-after-slider-scrub'],
    about: 'دو پنل رو‌به‌هم با خط جداساز که روی اسلاید حرکت می‌کند.',
  },
  {
    id: 'meter',
    fa: 'نوار پیشرفت',
    draw: 'meter',
    needs: ['value'],
    len: [3.4, 6],
    energy: 'mid',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'progress', at: b.start + 0.6 },
    ],
    signals: [/(٪|درصد|تا|حد|حداکثر|پر|کم)/],
    from: ['data/gauge-readout-moves', 'data/chart-live-moves'],
    about: 'نوار شیشه‌ای که تا درصدِ گفته‌شده پر می‌شود و عددش را نشان می‌دهد.',
  },
  {
    id: 'waveform',
    fa: 'موج صوتی',
    draw: 'waveform',
    needs: ['headline'],
    len: [3.2, 7],
    energy: 'mid',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'progress', at: b.start + 0.5 },
    ],
    signals: [/(صدا|موسیقی|موزیک|ووکال|صدای|فرکانس|اکولایزر|نویز|بیت|ریتم)/],
    from: ['interaction/voice-waveform-live', 'interaction/glass-pill-dictation-typing'],
    about: 'نوارهای موج که از وسط باز می‌شوند؛ برای هر حرف دربارهٔ صدا.',
  },
  {
    id: 'badge',
    fa: 'مُهر تأیید',
    draw: 'badge',
    needs: ['headline'],
    len: [3, 5.5],
    energy: 'high',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'success', at: b.start + 0.55 },
    ],
    signals: [/(تمام|شد|آماده|تأیید|موفق|نهایی|انجام شد|حل شد|درست|کار رفت|ثبت)/],
    from: ['effects/impact-feedback', 'outro/logo-shrink-wordmark-lockup'],
    about: 'مُهر چرخان verified با کیک‌بک؛ برای پایان یک ایده.',
  },
  {
    id: 'question',
    fa: 'پرسش',
    draw: 'question',
    needs: ['headline'],
    len: [3.2, 6],
    energy: 'low',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'scan', at: b.start + 0.5 },
    ],
    signals: [/[؟?]|(چرا|چطور|چگونه|آیا|Which|What|کدام)/],
    from: ['effects/scan-bracket-sweep', 'effects/fui-hud-moves'],
    about: 'کروشه‌های اسکن که دور یک علامت سؤال قفل می‌شوند.',
  },
  {
    id: 'brand',
    fa: 'پیامک برند',
    draw: 'brand',
    needs: ['latin'],
    len: [2.6, 6],
    energy: 'low',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'signature', at: b.start + 0.6 },
    ],
    signals: [],
    from: ['opening/brand-ink-open', 'outro/logo-shrink-wordmark-lockup'],
    about: 'پیل شیشه‌ای با نام برند یا آدرس، برای کارت آخر و امضا.',
  },
  {
    id: 'tags',
    fa: 'خوشه برچسب',
    draw: 'tags',
    needs: ['items'],
    len: [4, 8],
    energy: 'high',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'chipOn', at: b.start + 0.65 },
    ],
    signals: [/(و|،).*(و|،)/],
    from: ['interaction/hashtag-to-pill-materialize', 'effects/radial-ripple-phone-chips'],
    about: 'سه تا پنج چیپ که از یک نقطه به بیرون پخش می‌شوند.',
  },
  {
    id: 'scan',
    fa: 'اسکن و تشخیص',
    draw: 'scan',
    needs: ['headline'],
    len: [3.4, 6.5],
    energy: 'mid',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'scan', at: b.start + 0.55 },
      { role: 'chipOn', at: b.start + b.duration - 1.1 },
    ],
    signals: [/(بررسی|اسکن|تشخیص|پیدا|جستجو|تحلیل|پردازش|دقت|فیلتر)/],
    from: ['effects/scanline-annotate-focus', 'effects/fui-hud-moves'],
    about: 'خط اسکن که روی آیتم می‌لغزد و چیپ «یافت شد» را روشن می‌کند.',
  },
  {
    id: 'quote',
    fa: 'نقل‌قول',
    draw: 'quote',
    needs: ['text'],
    len: [3.6, 7],
    energy: 'low',
    cues: (b) => [
      { role: 'cardIn', at: b.start + 0.08 },
      { role: 'cardLand', at: b.start + 0.5 },
    ],
    signals: [],
    from: ['typography/*', 'effects/text-as-mask'],
    about: 'متن کامل گروه با ماسک راست‌به‌چپ؛ فقط برای تحویل مستقل، نه کلاژ.',
  },
];

const countDur = (len) => Math.min(1.1, Math.max(0.5, len * 0.28));

export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

/** Density → which recipes are allowed, and how many beats per minute. */
export const DENSITY = {
  sparse: { fa: 'کم و بزرگ', maxBeatsPerMinute: 8, allow: ['keyword', 'stat', 'quote', 'badge', 'brand', 'meter', 'waveform', 'question'] },
  balanced: { fa: 'متعادل', maxBeatsPerMinute: 13, allow: RECIPES.map((r) => r.id).filter((x) => x !== 'quote') },
  rich: { fa: 'پرحرکت', maxBeatsPerMinute: 19, allow: RECIPES.map((r) => r.id).filter((x) => x !== 'quote') },
};

/**
 * Anchor grid, in fractions of the canvas so one recipe set serves 2:1, 1:1 and
 * 9:16. Collage work keeps the centre band free: the subject's face is there.
 */
export function zonesFor({ ratio, deliver, anchor = 'both', sideBias = 'mixed', index = 0, total = 1 }) {
  const portrait = ratio === '9:16' || ratio === '4:5';
  const corners = portrait
    ? [
        { id: 'rt', x: 0.88, y: 0.16, align: 'end' },
        { id: 'lt', x: 0.12, y: 0.16, align: 'start' },
        { id: 'rb', x: 0.88, y: 0.7, align: 'end' },
        { id: 'lb', x: 0.12, y: 0.7, align: 'start' },
        { id: 'tc', x: 0.5, y: 0.12, align: 'middle' },
        { id: 'bc', x: 0.5, y: 0.84, align: 'middle' },
      ]
    : [
        { id: 'rt', x: 0.9, y: 0.14, align: 'end' },
        { id: 'lt', x: 0.1, y: 0.14, align: 'start' },
        { id: 'rb', x: 0.9, y: 0.8, align: 'end' },
        { id: 'lb', x: 0.1, y: 0.8, align: 'start' },
        { id: 'bc', x: 0.5, y: 0.88, align: 'middle' },
        { id: 'tc', x: 0.5, y: 0.1, align: 'middle' },
      ];
  if (deliver !== 'overlay') return corners;
  // overlay over footage: the middle band belongs to the subject
  const free = corners.filter((z) => !portrait || (z.y < 0.3 || z.y > 0.62));
  const pool = free.length >= 4 ? free : corners;
  const bySide =
    sideBias === 'left'
      ? [...pool].sort((a, b) => a.x - b.x)
      : sideBias === 'right'
        ? [...pool].sort((a, b) => b.x - a.x)
        : pool;
  const first = anchor === 'bottom-first' ? [...bySide].sort((a, b) => b.y - a.y) : bySide;
  return first.length ? first : corners;
}

/** Alternate corners so consecutive beats never stack on the same spot. */
export function pickZone(zones, index, previousId) {
  if (!zones.length) return { id: 'rt', x: 0.88, y: 0.16, align: 'end' };
  let pool = zones.filter((z) => z.id !== previousId);
  if (!pool.length) pool = zones;
  return pool[index % pool.length];
}

/** The panel's transition vocabulary; mapped to easings in the writer. */
export const TRANSITIONS = {
  soft: { fa: 'نرم', enter: { ease: 'expo.out', dur: 0.55, y: 22, blur: 10 }, leave: { ease: 'power2.in', dur: 0.42, y: -14 } },
  pop: { fa: 'پلاک', enter: { ease: 'back.out(1.9)', dur: 0.45, scale: 0.86, blur: 6 }, leave: { ease: 'power3.in', dur: 0.32, scale: 1.06 } },
  wipe: { fa: 'وایپ', enter: { ease: 'power3.out', dur: 0.5, clip: true }, leave: { ease: 'power2.in', dur: 0.36, clip: true } },
  slam: { fa: 'کوبش', enter: { ease: 'expo.inOut', dur: 0.34, scale: 1.35, blur: 16 }, leave: { ease: 'power2.in', dur: 0.28, y: -20 } },
  rise: { fa: 'بالاآینده', enter: { ease: 'power3.out', dur: 0.6, y: 46 }, leave: { ease: 'power1.in', dur: 0.4, y: -26 } },
};

/** Energy of the reference decides which transitions are on the table. */
export function transitionsFor(energy) {
  if (energy > 0.66) return ['slam', 'pop', 'wipe', 'soft'];
  if (energy > 0.33) return ['pop', 'wipe', 'soft', 'rise'];
  return ['soft', 'rise', 'wipe'];
}

export const MATERIALS = {
  glass: { fa: 'شیشه دود (خانگی)', radius: 5 },
  flat: { fa: 'مات بدون شیشه', radius: 5 },
};

export function recipeList() {
  return RECIPES.map((r) => ({
    id: r.id,
    fa: r.fa,
    about: r.about,
    len: r.len,
    energy: r.energy,
    needs: r.needs,
    cues: r.cues ? 'yes' : 'no',
    from: r.from,
  }));
}
