/* templates.mjs — the studio's visual-style templates: a whole look, one code.

 A template is a complete, code-drawn visual language distilled from a real
 reference film: the ground painter, the card material, where the headline
 lives, the palette, and the motion personality — locked together so a job
 that picks template `001` gets *that film's* look, not an approximation.

 Template 001 («کارتون UI روشن») is vectorised from the user's own reference
 (`assets/templates/001/reference.jpg`, a 720×1280 30 fps teaser). Its
 signature elements, measured from the source pixels:
   - white ground with a light-gray sketch grid and a soft gray vignette
   - flat white UI cards (hairline border, big soft shadow, ~3% radius)
   - a two-tier headline: spoken words in near-black bold, upcoming words
     faded, key words in italic serif inside a Figma-style selection box
     (blue border + 4 corner handles) — the reel's signature metaphor
   - royal blue #2E67FF (badges/buttons/selection), gold #F9C24F, terracotta
   - springy pop motion (the `lively-joyful` personality)

 Nothing here renders; a template only *steers* the existing pipeline:
 `background` → backgrounds.mjs, `material` → motions.mjs/writer,
 `brand` → brand.resolveBrand, `captionSide` → safe.mjs/writer.
 */

export const TEMPLATES = {
  '001': {
    id: '001',
    fa: 'قالب ۰۰۱ — کارتون UI روشن',
    hint: 'کاغذ شطرنجی سفید، کارت‌های UI تخت با سایهٔ نرم، تیتر با کادر انتخاب فیگما، آبی سلطنتی و طلایی',
    source: 'assets/templates/001/reference.jpg',
    sourceNote: 'فریم مرجع از ویدیوی کاربر (1405-08-16 04.07.15.mp4، تیزر «AI Video Editor»، ۷۲۰×۱۲۸۰ @۳۰fps)',
    background: 'paper-grid',
    material: 'ui',
    captionSide: 'top', // the reel's headline lives at the top, cards below
    brand: {
      preset: 'lively-joyful',
      palette: {
        ground: '#FFFFFF',
        groundDeep: '#F3F1EC',
        surface: '#FFFFFF',
        ink: '#111111',
        accent: '#2E67FF',
        accentDeep: '#1E50D8',
        micro: '#F9C24F',
        warm: '#E56743',
      },
    },
    banned: [
      'زمینهٔ تیره یا شیشهٔ دودی روی قالب روشن',
      'گلو و کاستیک روی کارت‌های UI سفید',
    ],
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export function templateById(id) {
  return (id && TEMPLATES[String(id).trim()]) || null;
}

/** Small shape the wizard and the API can show. */
export function templateList() {
  return Object.values(TEMPLATES).map(({ id, fa, hint, background, material, source }) => ({
    id,
    fa,
    hint,
    background,
    material,
    source,
  }));
}

/** Guard for untrusted config input. */
export function sanitizeTemplateInput(raw) {
  if (raw === null || raw === undefined || raw === '' || raw === 'house') return null;
  const tpl = templateById(raw);
  return tpl ? tpl.id : null;
}
