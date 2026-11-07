import fs from 'node:fs';

/*
 * finalcut.mjs — the deliverable.
 *
 * The motion layer is a transparent WebM; the film the user asked for is their
 * own footage with that layer, the SFX bed and (optionally) their logo burned
 * on top, encoded H.264 at the exact canvas they chose. The command is built
 * here and executed by the runner so the power wrapper still governs it.
 *
 * Invariants carried over from the old studio, still load-bearing:
 *  - `-c:v libvpx-vp9` must come BEFORE the layer's `-i` (the native VP9
 *    decoder silently drops the alpha plane),
 *  - fit-size / a bitrate cap never touch a WebM — they are MP4 tools, and
 *    here they apply only to the final MP4.
 */

export function composeFinalArgs({ base, layer, sfx = null, logo = null, out, width, height, fps = 30, crf = 20 }) {
  if (!fs.existsSync(base)) throw new Error(`finalcut: ویدیوی اصلی پیدا نشد (${base})`);
  if (!fs.existsSync(layer)) throw new Error(`finalcut: لایهٔ موشن پیدا نشد (${layer})`);

  const args = ['-y', '-i', base];
  if (/\.(webm|mkv)$/i.test(layer)) args.push('-c:v', 'libvpx-vp9');
  args.push('-i', layer);
  // input order: 0 base, 1 layer, 2 sfx (optional), 3 logo (optional)
  const sfxIndex = 2;
  const logoIndex = sfx ? 3 : 2;
  if (sfx) args.push('-i', sfx);
  if (logo) {
    if (!fs.existsSync(logo)) throw new Error(`finalcut: لوگو پیدا نشد (${logo})`);
    args.push('-i', logo);
  }

  const filters = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps}[bg]`,
    `[1:v]scale=${width}:${height},format=yuva420p[ov]`,
  ];
  let vout = '[bg][ov]overlay=0:0:format=auto';
  if (logo) {
    // the mark sits inside the top inline-end corner at 6% of canvas height
    filters.push(`[${logoIndex}:v]scale=-2:${Math.round(height * 0.06)}[lg]`);
    vout += '[lg]overlay=x=W-w-w*0.035:y=H*0.055:format=auto';
  }
  filters.push(`${vout},format=yuv420p[v]`);

  // the user's own voice stays the bed; the SFX ride on top, never replace it
  let audioMap = '0:a?';
  if (sfx) {
    filters.push(
      '[0:a]aformat=sample_rates=48000:channel_layouts=stereo[va]',
      `[${sfxIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo[vb]`,
      '[va][vb]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.89[a]',
    );
    audioMap = '[a]';
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    '-map',
    audioMap,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-video_track_timescale',
    '30000',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    out,
  );
  return args;
}

/** The size guard: same encode, higher CRF, at most three extra passes. */
export function nextCrf(crf, mb, maxMb) {
  return mb > maxMb && crf < 44 ? crf + 8 : null;
}

export function withinBudget(file, maxMb) {
  return fs.existsSync(file) && fs.statSync(file).size <= maxMb * 1000000;
}
