import fs from 'node:fs';

/*
 * subtitles.mjs — the smallest honest SRT reader/writer.
 *
 * The transcript is the one artifact the user edits by hand (the review gate),
 * so its file format is kept boring: plain SRT in and out, no markup. The
 * caption engine (engine/srt.mjs) does the clever planning later; this module
 * only moves the text.
 */

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function formatTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(
    Math.floor((ms % 60000) / 1000),
  )},${pad(ms % 1000, 3)}`;
}

export function parseTime(raw) {
  const m = String(raw).trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(String(m[4]).padEnd(3, '0')) / 1000;
}

/** Read an SRT into plain cues: [{ index, start, end, text }] (seconds kept float). */
export function readSrt(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const cues = [];
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;
    const m = (lines[i] || '').match(
      /(\d[\d:,.]*)\s*-->\s*(\d[\d:,.]*)/,
    );
    if (!m) continue;
    const body = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<\/?[^>]+>/g, '')
      .trim();
    if (!body) continue;
    cues.push({
      index: cues.length + 1,
      start: parseTime(m[1]),
      end: parseTime(m[2]),
      text: body,
    });
  }
  return cues;
}

/** Write cues back out as SRT, renumbered and time-ordered. */
export function writeSrt(file, cues) {
  const clean = [...cues]
    .filter((c) => String(c.text || '').trim())
    .sort((a, b) => a.start - b.start)
    .map((c, i) => ({ ...c, index: i + 1 }));
  const body = clean
    .map(
      (c) =>
        `${c.index}\n${formatTime(c.start)} --> ${formatTime(c.end)}\n${String(c.text).trim()}`,
    )
    .join('\n\n');
  fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(file, body + '\n', 'utf8');
  return clean;
}

/** The transcript as one plain string — what the understanding stage reads. */
export function srtText(cues, max = 12000) {
  return cues
    .map((c) => c.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, max);
}
