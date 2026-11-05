import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { geometry, ratioById } from './ratios.mjs';
import { backgroundById } from './backgrounds.mjs';
import { defaultPlan } from './compose.mjs';

/** What a file really is, straight from ffprobe. */
export function probe(file) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  const j = JSON.parse(out || '{}');
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  const [num, den] = String(v?.r_frame_rate || '30/1').split('/');
  return {
    duration: Number(j.format?.duration) || Number(a?.duration) || 0,
    width: v?.width || 0,
    height: v?.height || 0,
    fps: den ? Math.round(Number(num) / Number(den)) : 30,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    videoCodec: v?.codec_name || null,
    audioCodec: a?.codec_name || null,
  };
}

/** Total length implied by an SRT, without re-implementing the cue parser. */
function srtEnd(file) {
  const text = fs.readFileSync(file, 'utf8');
  let max = 0;
  for (const m of text.matchAll(/(\d\d):(\d\d):(\d\d)[,.](\d\d\d)\s*-->/g)) {
    const end = text.slice(m.index).match(/--> (\d\d):(\d\d):(\d\d)[,.](\d\d\d)/);
    if (!end) continue;
    const t = Number(end[1]) * 3600 + Number(end[2]) * 60 + Number(end[3]) + Number(end[4]) / 1000;
    max = Math.max(max, t);
  }
  return max;
}

/**
 * Turn a wizard config into the one object the composer and the runner read.
 * `direction` is the edit brief; when a model produced a plan it arrives as
 * `job.config.direction.plan` and only overrides fields it really filled.
 */
export function buildPlan(job) {
  const c = job.config;
  const r = ratioById(c.output.ratio);
  const bg = backgroundById(c.output.background);
  const plan = defaultPlan({
    ratio: r.id,
    background: bg.id,
    layout: c.output.layout || 'auto',
    fps: c.output.fps || 30,
    name: c.name || job.id,
  });
  plan.bgGround = bg.ground || plan.bgGround;
  plan.g = geometry(r.w, r.h);
  plan.direction = c.direction?.text || '';
  plan.engine = c.engine || {};

  const src = c.source || {};
  if (src.video) {
    plan.source = { kind: 'video', video: src.video, ...probe(src.video) };
  } else if (src.audio) {
    plan.source = { kind: 'audio', audio: src.audio, ...probe(src.audio) };
  } else if (src.srt) {
    plan.source = { kind: 'srt', srt: src.srt, duration: srtEnd(src.srt) };
  } else {
    throw new Error('هیچ منبعی برای این شغل ثبت نشده است.');
  }

  plan.source.srt = src.srt || null;
  if (plan.source.srt) plan.source.duration = Math.max(plan.source.duration || 0, srtEnd(plan.source.srt));

  const m = c.motion || {};
  plan.motion = {
    // the motion engine is the house default; 'captions' keeps the old film-from-SRT path
    mode: m.mode === 'captions' ? 'captions' : 'motion',
    density: ['sparse', 'balanced', 'rich', 'auto'].includes(m.density) ? m.density : 'auto',
    material: m.material === 'flat' ? 'flat' : 'glass',
    deliver: m.deliver === 'standalone' ? 'standalone' : 'overlay',
    maxBeats: Number(m.maxBeats) > 0 ? Math.min(60, Number(m.maxBeats)) : null,
  };
  const s = c.sound || {};
  plan.sound = {
    sfx: s.sfx !== false,
    level: ['gentle', 'balanced', 'bold'].includes(s.level) ? s.level : 'balanced',
  };
  plan.reference = src.reference || null;

  const spoken = plan.source.duration || 8;
  // a caption film adds the 3 s end card; a motion layer runs exactly as long as
  // the talk, because it sits on top of the user's own footage
  plan.filmGuess = Math.round((spoken + (plan.motion.mode === 'motion' ? 0 : 3.4)) * 100) / 100;

  plan.captions = { enabled: c.output.captions !== false, srt: plan.source.srt };
  plan.media = { volume: Number(c.output.volume ?? 1) };

  const d = c.direction?.plan;
  if (d && typeof d === 'object') {
    if (d.layout && ['auto', 'cover', 'contain', 'split'].includes(d.layout)) plan.layout = d.layout;
    for (const k of ['kicker', 'headline', 'sub']) if (typeof d.title?.[k] === 'string' && d.title[k].trim()) plan.title[k] = d.title[k].trim();
    if (typeof d.title?.accentWord === 'string') plan.title.accentWord = d.title.accentWord.trim();
    for (const k of ['name', 'site']) if (typeof d.endcard?.[k] === 'string' && d.endcard[k].trim()) plan.endcard[k] = d.endcard[k].trim();
    if (Array.isArray(d.captions?.hotWords)) plan.captions.hotWords = d.captions.hotWords.slice(0, 12).map(String);
    plan.beats = Array.isArray(d.beats) ? d.beats.slice(0, 24) : [];
    plan.providerNotes = typeof d.notes === 'string' ? d.notes.slice(0, 600) : '';
  }
  plan.captions.hotWords = plan.captions.hotWords || (c.direction?.hotWords || []).slice(0, 12).map(String);
  return plan;
}
