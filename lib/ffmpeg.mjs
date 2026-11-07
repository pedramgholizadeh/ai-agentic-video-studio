import { spawn } from 'node:child_process';

/* ffmpeg.mjs — the only external binary the studio shells out to.
 *
 * Every call is async: the studio server runs jobs in-process, so a blocking
 * ffprobe would freeze the log stream and the whole panel. `-threads 1` keeps
 * an analysis pass off the CPU budget that the render needs.
 */

export function run(cmd, args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => err.push(b));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = binary ? Buffer.concat(out) : Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        const e = new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 400)}`);
        e.code = code;
        e.stderr = stderr;
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}

/** ffmpeg that must succeed; returns stdout+stderr as text (error verbosity). */
export async function ffText(args) {
  const r = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-threads', '1', ...args]);
  return r.stdout + r.stderr;
}

/** ffmpeg filters that print their report at info level (loudnorm, scene…). */
export async function ffReport(args) {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-threads', '1', ...args]);
  return r.stdout + r.stderr;
}

/** Raw video frames, so the palette can be read in Node without any library. */
export async function ffRaw(args) {
  const r = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-threads', '1', ...args], { binary: true });
  return r.stdout;
}

export async function ffprobeJson(file, entries = 'format:stream') {
  const r = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', entries,
    '-of', 'json',
    file,
  ]);
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { format: {}, streams: [] };
  }
}

/** Integrated loudness + true peak of a file. */
export async function loudness(file) {
  const out = await ffReport(['-i', file, '-vn', '-af', 'loudnorm=print_format=summary', '-f', 'null', '-']);
  const i = /Input Integrated:\s*(-?[0-9.]+| *-inf)/.exec(out);
  const tp = /Input True Peak:\s*(-?[0-9.]+| *-inf)/.exec(out);
  return {
    lufs: i && i[1] !== '-inf' ? Number(i[1]) : null,
    truePeak: tp && tp[1] !== '-inf' ? Number(tp[1]) : null,
  };
}

/**
 * Rolling RMS curve: `window` seconds per sample. This is how both the accent
 * time of a one-shot and the audibility of a cue are measured — never by
 * trusting the volume that was asked for.
 */
export async function rmsCurve(file, window = 0.06) {
  const out = await ffText([
    '-i', file,
    '-vn',
    '-af',
    `aresample=48000,asetnsamples=${Math.round(48000 * window)}:p=0,astats=metadata=1:reset=1,` +
      'ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-',
  ]);
  const rows = [];
  let pts = null;
  for (const line of out.split('\n')) {
    const p = /pts_time:([0-9.]+)/.exec(line);
    if (p) pts = Number(p[1]);
    const v = /RMS_level=(-?[0-9.]+|-inf)/.exec(line);
    if (v && pts !== null) rows.push({ t: pts, db: v[1] === '-inf' ? -75 : Number(v[1]) });
  }
  return rows;
}
