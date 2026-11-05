#!/usr/bin/env node
/*
 * measure-onsets.mjs — where does each one-shot actually accent?
 *
 *   node scripts/measure-onsets.mjs assets/audio
 *
 * The CC0 kit ships files whose audible event sits anywhere inside them:
 * whoosh-fast.mp3 is 1.76 s with its accent at 0.61 s, glass-hit-cine.mp3 is
 * 4.72 s with 3.99 s of dead air in front of the hit. Scheduling a cue at the
 * visual beat therefore fires it a fraction of a second *early* and the frame
 * lands in silence. This prints the accent time of every file in the folder so
 * the mix can delay by (beat − accent) instead of by beat.
 *
 * The accent is the loudest 60 ms of the file, read from a rolling RMS over the
 * whole decode in a single pass.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node measure-onsets.mjs <folder of one-shots>   e.g. assets/audio");
  process.exit(1);
}
const dir = path.resolve(arg);
const WINDOW = 0.06;

const accent = (file) => {
  /* asetnsamples gives fixed 60 ms measurement frames, reset=1 recomputes per frame,
     and ametadata prints `frame:N pts:P pts_time:T` — the time lives in pts_time. */
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-af",
      `aresample=48000,asetnsamples=${Math.round(48000 * WINDOW)}:p=0,astats=metadata=1:reset=1,` +
        "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f", "null", "-"],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}`);

  let best = { t: 0, db: -Infinity };
  let pts = null;
  for (const line of String(r.stdout).split("\n")) {
    const p = /pts_time:([0-9.]+)/.exec(line);
    if (p) pts = Number(p[1]);
    const v = /RMS_level=(-?[0-9.]+|-inf)/.exec(line);
    if (v && pts !== null && v[1] !== "-inf") {
      const db = Number(v[1]);
      if (db > best.db) best = { t: pts, db };
    }
  }
  return best;
};

const files = readdirSync(dir).filter((f) => /\.(mp3|wav|ogg)$/i.test(f) && !/^(full_mix|_)/.test(f)).sort();
console.log("/* Accent time of each one-shot — node scripts/measure-onsets.mjs */");
console.log("const ONSET = {");
for (const f of files) {
  const { t, db } = accent(path.join(dir, f));
  console.log(`  ${JSON.stringify(f)}: ${Number(t.toFixed(3))}, /* ${db.toFixed(1)} dB */`);
}
console.log("};");
