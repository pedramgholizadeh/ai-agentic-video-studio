#!/usr/bin/env node
/**
 * make-icon.mjs — paint the app icon as raw RGBA on stdout, so ffmpeg turns
 * it into desktop/build/icon.png. Reproducible by design: the mark is the
 * panel's own brand (graphite rounded square, mint play button with a glow),
 * computed per pixel — no image library involved.
 *
 *   node scripts/make-icon.mjs | ffmpeg -y -f rawvideo -pix_fmt rgba \
 *     -s 1024x1024 -r 1 -i - -frames:v 1 desktop/build/icon.png
 */
const S = 1024;
const buf = Buffer.alloc(S * S * 4);

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// rounded-square signed distance: <0 inside
const sdRoundRect = (x, y, cx, cy, hx, hy, r) => {
  const qx = Math.abs(x - cx) - (hx - r);
  const qy = Math.abs(y - cy) - (hy - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
};
// point-in-triangle with a barycentric test, slightly softened by distance
const triDist = (px, py, a, b, c) => {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b), d2 = sign([px, py], b, c), d3 = sign([px, py], c, a);
  const inside = (d1 <= 0 && d2 <= 0 && d3 <= 0) || (d1 >= 0 && d2 >= 0 && d3 >= 0);
  if (inside) return 0;
  const seg = (p, q) => {
    const vx = q[0] - p[0], vy = q[1] - p[1];
    const t = clamp01(((px - p[0]) * vx + (py - p[1]) * vy) / (vx * vx + vy * vy || 1));
    return Math.hypot(px - (p[0] + t * vx), py - (p[1] + t * vy));
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
};

// the mark: a play triangle pointing right, optically centred
const A = [330, 250], B = [330, 774], C = [790, 512];
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    // graphite ground with a subtle top-lit gradient
    const t = y / S;
    let r = lerp(24, 12, t), g = lerp(26, 14, t), b = lerp(27, 15, t), a = 255;
    const d = sdRoundRect(x, y, S / 2, S / 2, S / 2 - 24, S / 2 - 24, 190);
    if (d > 1) { a = 0; } // transparent outside the rounded square
    else if (d > -1) { a = Math.round(255 * (1 - (d + 1) / 2)); } // AA edge
    // mint glow behind the mark
    const gDist = Math.hypot(x - S / 2, y - S / 2);
    const glow = Math.max(0, 1 - gDist / 620) ** 2 * 0.18;
    r = lerp(r, 85, glow); g = lerp(g, 230, glow); b = lerp(b, 165, glow);
    // the mint play button, gradient top-left → bottom-right
    const td = triDist(x, y, A, B, C);
    if (td <= 1.5) {
      const tt = clamp01((x + y) / (S * 1.1));
      const pr = lerp(85, 47, tt), pg = lerp(230, 184, tt), pb = lerp(165, 126, tt);
      const edge = td <= 0 ? 1 : 1 - td / 1.5;
      const cover = a / 255 * edge;
      r = lerp(r, pr, cover); g = lerp(g, pg, cover); b = lerp(b, pb, cover);
      a = Math.max(a, Math.round(255 * edge));
    }
    buf[i] = Math.round(r); buf[i + 1] = Math.round(g); buf[i + 2] = Math.round(b); buf[i + 3] = a;
  }
}
process.stdout.write(buf);
