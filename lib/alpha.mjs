/* alpha.mjs — the one size guard that is safe for a transparent layer.

 HyperFrames renders a genuine alpha WebM (`ALPHA_MODE=1` in the container).
 `fit-size` from cool-render must never run on it: its only encoder is
 libx264 at `yuv420p`, which paints the user's footage under a black matte.
 Slimming a layer means re-encoding the same VP9 + alpha at a higher CRF.
 */

/** Re-encode an alpha WebM at a higher CRF, keeping the alpha plane. */
export function vp9AlphaReEncode({ file, out, fps = 30, crf = 30, threads = 2 }) {
  return {
    cmd: 'ffmpeg',
    args: [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i',
      file,
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuva420p',
      '-b:v',
      '0',
      '-crf',
      String(crf),
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-row-mt',
      '1',
      '-auto-alt-ref',
      '0',
      '-metadata:s:v:0',
      'alpha_mode=1',
      '-threads',
      String(threads),
      '-an',
      '-r',
      String(fps),
      out,
    ],
  };
}
