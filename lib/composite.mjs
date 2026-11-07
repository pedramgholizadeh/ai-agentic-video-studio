import fs from 'node:fs';
import path from 'node:path';
import { ffText, ffprobeJson } from './ffmpeg.mjs';

/* composite.mjs — the collage step.

 The motion layer is authored on a transparent canvas at the size the user
 asked for, so it is only half of the picture: it has to be seen *on their
 footage*. This module renders that proof (a small H.264 file the panel can
 play) and writes the drop-in note an editor needs to do the same in their own
 timeline.

 Nothing here is a deliverable by itself — the deliverable is the alpha layer;
 this is how the user judges it before committing to a full render.
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const fa = (v) => String(v).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);

/**
 * Preview of the layer over the base footage.
 *
 * `base` is scaled to *cover* the layer canvas so the two line up exactly. The
 * `bed` is the **SFX-only** mix: a preview that mutes the user's own voice tells
 * them nothing about the finished collage, so the design is summed onto the
 * footage rather than swapped for it.
 */
export async function collagePreview({
  base,
  layer,
  out,
  width,
  height,
  fps = 30,
  seconds = null,
  bed = null,
  crf = 30,
  maxSide = 720,
}) {
  if (!fs.existsSync(base)) throw new Error(`composite: ویدیوی اصلی پیدا نشد (${base})`);
  if (!fs.existsSync(layer)) throw new Error(`composite: لایهٔ موشن پیدا نشد (${layer})`);

  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.round((scale * width) / 2) * 2;
  const h = Math.round((scale * height) / 2) * 2;

  const args = ['-y', '-i', base];
  // ffmpeg's *native* vp9 decoder throws the alpha plane away, and a layer
  // decoded without it is a black box over the user's footage. libvpx-vp9 is the
  // decoder that reads WebM block-additional-content alpha.
  if (/\.(webm|mkv)$/i.test(layer)) args.push('-c:v', 'libvpx-vp9');
  args.push('-i', layer);
  if (bed) args.push('-i', bed);
  const filters = [
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${fps}[bg]`,
    `[1:v]scale=${w}:${h},format=yuva420p[ov]`,
    `[bg][ov]overlay=0:0:format=auto,format=yuv420p[v]`,
  ];

  let audioMap = '0:a?';
  const audioCodec = ['-c:a', 'aac', '-b:a', '160k']; // the base may hold opus; a preview must play anywhere
  if (bed) {
    const hasVoice = (await ffprobeJson(base, 'stream=codec_type')).streams?.some((s) => s.codec_type === 'audio');
    if (hasVoice) {
      filters.push(
        '[0:a]aformat=sample_rates=48000:channel_layouts=stereo[va]',
        '[2:a]aformat=sample_rates=48000:channel_layouts=stereo[vb]',
        '[va][vb]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.89[a]',
      );
      audioMap = '[a]';
    } else audioMap = '2:a';
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
    'fast',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-video_track_timescale',
    '30000',
    ...audioCodec,
  );
  if (seconds) args.push('-t', String(seconds));
  args.push('-shortest', out);

  await ffText(args);
  return out;
}

/** What the alpha layer really is: codec, pixel format, fps, size. */
export async function inspectLayer(file) {
  // `codec_type` must be requested: without it the video stream is never found
  // and every field below silently reads as zero.
  const info = await ffprobeJson(
    file,
    'format=duration,size:stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate:stream_tags=ALPHA_MODE'
  );
  const v = (info.streams || []).find((s) => s.codec_type === 'video') || {};
  const [num, den] = String(v.r_frame_rate || '0/1').split('/');
  const pix = String(v.pix_fmt || '');
  // VP9 alpha is block-additional content: ffprobe still reports the base plane
  // as `yuv420p`, so the container's ALPHA_MODE tag is the honest signal.
  const tagged = String(v.tags?.ALPHA_MODE ?? '') === '1';
  return {
    file,
    codec: v.codec_name || null,
    pixFmt: pix || null,
    hasAlpha: tagged || /yuva|rgba|bgra|gbrap|argb/.test(pix),
    width: v.width || 0,
    height: v.height || 0,
    fps: den && Number(den) ? Math.round(Number(num) / Number(den)) : 0,
    duration: Number(info.format?.duration) || 0,
    mb: Math.round(((Number(info.format?.size) || 0) / 1000000) * 100) / 100,
  };
}

/**
 * The editor's instruction sheet, next to the rendered layer: where the file
 * goes, what it does to the picture below it, and the one ffmpeg line that
 * burns it in when no NLE is open.
 */
export function dropInNote({ dir, layer, base, ratio, bed = null, beats = 0, fps = 30 }) {
  // The native vp9 decoder throws the alpha plane away, so a copy-pasted
  // one-liner without `-c:v libvpx-vp9` burns a black box into the footage.
  const alphaDecode = /\.(webm|mkv)$/i.test(layer) ? '-c:v libvpx-vp9 ' : '';
  const lines = [
    `# لایهٔ موشن گرافیک — راهنمای گذاشتن روی ویدیو`,
    ``,
    `- فایل لایه: \`${layer}\` — ${fa(ratio)}، ${fa(fps)} فریم، پیش‌زمینهٔ کاملاً شفاف`,
    `- ویدیوی خودت: \`${base}\``,
    `- ${fa(beats)} کارت موشن روی این زمان‌بندی ساخته شده${bed ? ` و صداهایش در \`${bed}\` است` : ''}.`,
    ``,
    `## در تدوینگر (پریمیر / داورنسی / فینال‌کات)`,
    ``,
    `1. ویدیوی خودت را در لایهٔ پایین بگذار.`,
    `2. فایل لایه را دقیقاً بالای آن در همان اندازهٔ کادر قرار بده (Fit to frame).`,
    `3. لایه آلفای داخلی دارد؛ هیچ افکت Keying یا Blend لازم نیست.`,
    bed ? `4. صدای \`${bed}\` را روی شیار صدا بگذار و هم‌تراز با ویدیو است.` : `4. این لایه صدا ندارد؛ صدای خودت سر جایش می‌ماند.`,
    ``,
    `## سوختن لایه داخل ویدیو با یک خط`,
    ``,
    '```sh',
    `ffmpeg -i "${base}" ${alphaDecode}-i "${layer}" \\`,
    `  -filter_complex "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]" \\`,
    `  -map "[v]" -map 0:a? -c:v libx264 -crf 18 -preset slow -r ${fps} final.mp4`,
    '```',
    ``,
    alphaDecode
      ? `آن \`-c:v libvpx-vp9\` قبل از فایل لایه حذف‌کردنی نیست: کدگذار پیش‌فرضِ ffmpeg صفحهٔ آلفای WebM را دور می‌ریزد و لایه سیاه روی ویدیو می‌افتد. اگر جایی لایه را سیاه دیدی، مشکل از فایل نیست، از همین خط است.`
      : ``,
    ``,
    `اگر اندازهٔ ویدیو با لایه فرق داشت، اول ویدیو را به همان ابعاد ببر:`,
    `در پریمیر \`Scale to Frame Size\` و در ffmpeg گزینهٔ \`scale=${ratio === '9:16' ? '1080:1920' : 'W:H'}\`.`,
  ];
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'DROP-IN.md');
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}
