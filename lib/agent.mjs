import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI, MOTION_SCRIPT, COOL_RUN, HYPERFRAMES_VERSION } from './paths.mjs';
import { safeFor } from './safe.mjs';
import * as jobs from './jobs.mjs';

/**
 * The handoff an agent reads. `queued` jobs are not run by the panel; the agent
 * the user chose at stage zero claims them and writes progress back through
 * the same files, so the browser keeps streaming.
 *
 * The contract is deliberately narrow: claim once, append to log.txt, rewrite
 * progress.json, park the job at the review gates, finish with job.json. The
 * document itself is English because every code agent reads English
 * instructions well; the *video* it builds stays Persian and right-to-left.
 */
export function handoffDocument(job) {
  const p = jobs.paths(job.id);
  const c = job.config;
  const layerFile = `${p.out}/${job.id}.webm`;
  const finalFile = `${p.out}/${job.id}.mp4`;
  const safe = safeFor(c.output?.ratio);

  const rows = [
    `| User video | ${c.source?.video || '—'} |`,
    `| Reference video (style) | ${c.source?.reference || '(none — house taste)'}`,
    `| Output ratio | ${c.output?.ratio} · ${c.output?.fps || 30} fps |`,
    safe ? `| Teaser safe rect | top ${safe.top * 100}% · bottom ${safe.bottom * 100}% · right ${safe.right * 100}% · left ${safe.left * 100}% — every text must sit inside it |` : null,
    `| Subtitles | word-by-word, burned into the layer (karaoke) — Vazirmatn only |`,
    `| Density / material | ${c.motion?.density || 'auto'} / ${c.motion?.material || 'glass'} |`,
    `| Sound effects | ${c.sound?.sfx === false ? 'off' : `on — ${c.sound?.level || 'balanced'} level`} |`,
    `| Quality / size budget | ${c.output?.quality || 'delivery'} · ${c.output?.maxMb || 200} MB |`,
    `| Machine power | ${c.cpu?.pct ?? 50}% CPU — never more |`,
    `| Transcription | whisper ${c.transcribe?.model || 'large-v3'} · language ${c.transcribe?.language || 'fa'} |`,
    `| Review gates | transcript + preview — park the job, wait for the user |`,
  ].filter(Boolean);

  return `# Handoff — ${job.id}

**Read \`AGENTS.md\` (the operator manual), \`README.md\` and \`node ${MOTION_SCRIPT} --help\` before you start.** This job was registered from the studio panel; its owner expects the final MP4 at \`${finalFile}\`.

## Request

| item | value |
|---|---|
${rows.join('\n')}

## Paths

- Job folder: \`${p.root}\`
- Transcript (SRT): \`${p.transcript}\`
- Brief: \`${p.brief}\` · Brand tokens: \`${p.brand}\` · Beat sheet: \`${p.beats}\` · Style profile: \`${p.style}\`
- Preview (the demo the user judges): \`${p.review}/${job.id}_preview.mp4\`
- Final deliverable: \`${finalFile}\` (alpha layer kept at \`${layerFile}\`)
- Chat edits from the user: \`${p.chat}\` (JSONL — read it at every gate)

## Keeping the panel live

The panel tails these files. Until you write them, the user sees nothing.

\`\`\`bash
S=${CLI}
node $S claim ${job.id} --by ${job.engine?.agent || 'agent'}
node $S log ${job.id} stage "starting"
node $S progress ${job.id} transcribe 30
node $S done ${job.id} ${finalFile}
# or, if it breaks: node $S fail ${job.id} "why"
\`\`\`

Stage keys: \`prepare transcribe review understand reference assets strategy scaffold preview final verify\`.

## What to do

Every stage of the engine is reachable from one script: \`node ${MOTION_SCRIPT} <command> …\`. \`$COOL\` below is the power-capped wrapper — **every render goes through it**, and the worker count comes from \`node ${CLI} power ${c.cpu?.pct ?? 50}\`, never \`auto\`:
\`\`\`bash
COOL=${COOL_RUN ?? path.join(os.homedir(), '.qoder/skills/cool-render/scripts/cool-run')}
\`\`\`

1. **prepare** — \`ffprobe\` the user video; log duration, size, fps.
2. **transcribe** — accuracy is the product, use the configured model:
   \`\`\`bash
   $COOL npx --yes hyperframes@${HYPERFRAMES_VERSION} transcribe "${c.source?.video}" --dir ${p.project} --engine whisper --model ${c.transcribe?.model || 'large-v3'} --language ${c.transcribe?.language || 'fa'} --to srt --output ${p.transcript}
   \`\`\`
3. **review (gate 1)** — park the job and wait for the user's corrections:
   \`\`\`bash
   node $S wait ${job.id} transcript
   \`\`\`
   Poll \`node $S show ${job.id}\` until \`status\` leaves \`review\`. The user edits lines in the panel; re-read the SRT after the gate opens.
4. **understand** — read the whole transcript until you genuinely know what the film is about, then:
   \`node ${MOTION_SCRIPT} brief --srt ${p.transcript} --out ${p.brief}\` — then open the file and fill what the command could not know (thesis, audience, goal): every field a judgment **plus its basis**. Facts are sacred: \`facts[]\` carries only numbers/units/names that appear in the SRT.
5. **reference** — the style profile is remembered, not re-analysed:
   \`node ${MOTION_SCRIPT} refprofile --video "${c.source?.reference || ''}" --job ${job.id}\` — a cached profile returns instantly. Read \`derived\` (rhythm, energy, density, transitions, palette) carefully: **this is the pixel-perfect contract the edit must match.**
6. **assets** — \`node ${MOTION_SCRIPT} assets --job ${job.id}\` fetches exactly what the film needs (fonts, textures). SFX kit: \`npm run sfx\` if \`assets/sfx\` is missing. Logo (if configured) is composited at final.
7. **strategy** — resolve one brand token set, then the beat sheet:
   \`\`\`bash
   node ${MOTION_SCRIPT} brand --job ${job.id} --out ${p.brand}
   node ${MOTION_SCRIPT} beats --srt ${p.transcript} --style ${p.style} --brief ${p.brief} --brand ${p.brand} --out ${p.beats} --ratio ${c.output?.ratio} --density ${c.motion?.density || 'auto'} --material ${c.motion?.material || 'glass'}
   \`\`\`
   **Open beats.json and edit it like an editor** — card copy is only words actually spoken; no number, claim or name that is not in the SRT. One brand token set governs every tween; change it once at the start if the personality mismatches, never per beat.
8. **scaffold** — \`node ${MOTION_SCRIPT} write --beats ${p.beats} --dir ${p.project} --ratio ${c.output?.ratio} --fps 15 --brand ${p.brand}\` (the preview build is 15 fps), then \`$COOL npx --yes hyperframes@${HYPERFRAMES_VERSION} check --json\` must report zero errors. Mix the SFX bed: \`node ${MOTION_SCRIPT} sfx --beats ${p.beats} --out ${p.out} --level ${c.sound?.level || 'balanced'} --voice "${c.source?.video || ''}" --name ${job.id}_sfx\`. Take stills at the beat sheet's own timestamps and **audit them against the banned list** before any render.
9. **preview** — the cheap demo:
   \`\`\`bash
   $COOL npx --yes hyperframes@${HYPERFRAMES_VERSION} render . -o ${p.out}/${job.id}-preview.webm --format webm --fps 15 --quality draft --workers <n>
   node ${MOTION_SCRIPT} collage --base "${c.source?.video || ''}" --layer ${p.out}/${job.id}-preview.webm --out ${p.review}/${job.id}_preview.mp4 --sfx ${p.out}/${job.id}_sfx.wav --max-side 640 --fps 15
   rm ${p.out}/${job.id}-preview.webm
   \`\`\`
   Then park the job: \`node $S wait ${job.id} preview\`. The user answers in the chat box — read \`${p.chat}\` **every time the gate opens** and apply each request (transcript fixes, density, energy, colours, pacing) to the artifacts, re-render the preview, and wait again. Repeat until they approve.
10. **final** — rebuild at full fps (\`--fps ${c.output?.fps || 30}\`), render the alpha layer (WebM, **no \`--max-bitrate\`** — MP4-only, breaks the mux), \`node ${MOTION_SCRIPT} inspect --file <layer>\` must answer \`hasAlpha: true\`; \`pix_fmt: yuv420p\` on a VP9 alpha stream is not a failure (the criterion is the \`ALPHA_MODE=1\` tag). Then the deliverable:
    \`node ${MOTION_SCRIPT} final --job ${job.id}\` — composite + size guard, inside the power budget.
11. **verify** — \`node $S done ${job.id} ${finalFile}\` (it ffprobes and flags the budget). If you made a creative call of your own, leave one line in the log and \`notes/decisions.md\`.`;
}

/** Mark the job queued and drop the brief an agent will pick up. */
export function enqueue(job) {
  const p = jobs.paths(job.id);
  fs.writeFileSync(p.handoff, handoffDocument(job), 'utf8');
  jobs.appendLog(job.id, 'queue', 'جاب در صف ایجنت است — منتظر برداشته‌شدن');
  return jobs.setStatus(job.id, 'queued', { handoffAt: new Date().toISOString() });
}

export function pendingCount() {
  return jobs.list().filter((j) => j.status === 'queued').length;
}
