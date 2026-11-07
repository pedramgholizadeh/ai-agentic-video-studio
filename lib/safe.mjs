/* safe.mjs — platform safe areas, treated as data (not guesswork).

 A 9:16 teaser is watched inside Instagram's Reels chrome: the camera/username
 row owns the top, the caption + audio + CTA stack owns the bottom, and the
 action rail owns the right edge. Text that lands there is unreadable in the
 one place the film actually plays. The same applies, milder, to 16:9.

 A job in one of the TEASER_RATIOS therefore:
   - keeps every motion card inside the safe rect (`zonesFor` clamps to it),
   - never places a card in the caption band,
   - burns the SRT itself in as subtitles, inside the safe rect too
     (`motion-project` renders the captions track).

 Numbers for 9:16 are fractions of 1080×1920: top 240 px (username/camera),
 bottom 460 px (caption/audio/CTA stack), right 145 px (action rail),
 left 65 px. 16:9 keeps a plain 5 % action-safe box with the caption band
 lifted above the bottom 10 %.

 Everything downstream derives from `safeFor(ratio)`; nothing else hardcodes
 an Instagram number.
 */

export const TEASER_RATIOS = ['9:16', '16:9'];

const SAFE = {
  // Instagram Reels chrome: username+camera top, caption+audio+CTA bottom,
  // like/comment/share rail right
  '9:16': { top: 0.125, bottom: 0.24, left: 0.06, right: 0.135, band: 0.13 },
  // landscape teasers: plain action-safe, caption band above the bottom 10 %
  '16:9': { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05, band: 0.15 },
};

/**
 * The safe rect for one ratio, in canvas fractions, plus the caption band.
 * `captionSide` = 'bottom' (default) or 'top' — template 001 puts the headline
 * band at the top like the reference reel, so cards must sit *below* it.
 * Returns null for non-teaser ratios.
 */
export function safeFor(ratioId, captionSide = 'bottom') {
  const s = SAFE[ratioId];
  if (!s) return null;
  const top = s.top;
  const bottom = 1 - s.bottom;
  const bandTop = captionSide === 'top' ? top : Math.round((bottom - s.band) * 1000) / 1000;
  const bandBottom = captionSide === 'top' ? Math.round((top + s.band) * 1000) / 1000 : bottom;
  return {
    teaser: true,
    captionSide,
    top,
    bottom: s.bottom,
    left: s.left,
    right: s.right,
    band: s.band,
    bandTop,
    bandBottom,
    captionTop: bandBottom, // compat: the lowest y the caption band reaches
  };
}

export const isTeaserRatio = (ratioId) => TEASER_RATIOS.includes(ratioId);

/** One honest Persian line for logs and the handoff. */
export function describeSafe(safe, g) {
  if (!safe) return null;
  const px = (f, axis) => Math.round(f * (axis === 'w' ? g.w : g.h));
  return `حاشیهٔ امن: بالا ${px(safe.top, 'h')}px، پایین ${px(safe.bottom, 'h')}px، راست ${px(safe.right, 'w')}px، چپ ${px(safe.left, 'w')}px — همهٔ متن‌ها داخل این کادر می‌نشینند`;
}
