import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI, MOTION_SCRIPT, COOL_RUN, SRT_TOOL, TEMPLATE_DIR, HYPERFRAMES_VERSION } from './paths.mjs';
import * as jobs from './jobs.mjs';

/**
 * The handoff an agent reads. `queued` jobs are not run by the panel; a worker
 * (any code agent opened on this repository) claims them and writes progress
 * back through the same files, so the browser keeps streaming.
 *
 * The contract is deliberately narrow: claim once, append to log.txt, rewrite
 * progress.json, finish with job.json. The document itself is English because
 * every code agent reads English instructions well; the *video* it builds stays
 * Persian and right-to-left.
 */
export function handoffDocument(job) {
  const p = jobs.paths(job.id);
  const c = job.config;
  const motion = (c.motion?.mode ?? 'motion') !== 'captions';
  const deliver = c.motion?.deliver === 'standalone' ? 'standalone' : 'overlay';
  const layerFile = `${p.out}/${job.id}.${motion && deliver === 'overlay' ? 'webm' : 'mp4'}`;

  const rows = [
    `| Source | ${c.source?.video || c.source?.audio || c.source?.srt || '—'} |`,
    motion ? `| Reference video (style) | ${c.source?.reference || '(none — house taste)'}` + ' |' : null,
    `| Aspect ratio | ${c.output?.ratio} |`,
    motion
      ? `| Output kind | ${deliver === 'overlay' ? 'transparent motion-graphics layer to collage over the user\'s footage' : 'standalone motion film'}` + ' |'
      : `| Output kind | caption film |`,
    motion
      ? `| Density / material | ${c.motion?.density || 'auto'} / ${c.motion?.material || 'glass'} |`
      : `| Background | ${c.output?.background} |\n| Layout | ${c.output?.layout || 'auto'} |`,
    motion
      ? `| Sound effects | ${c.sound?.sfx === false ? 'off' : `on — ${c.sound?.level || 'balanced'} level`} |`
      : null,
    `| Quality | ${c.output?.quality} · size budget ${c.output?.maxMb} MB |`,
    `| Machine power | ${c.cpu?.pct ?? 50}% CPU |`,
    `| Engine | ${c.engine?.mode}${c.engine?.model ? ` · ${c.engine.provider}/${c.engine.model}` : ''} |`,
  ].filter(Boolean);

  return `# Handoff — ${job.id}

**Read \`AGENTS.md\` (the operator manual — every CLI agent reads it), \`README.md\` and \`node ${MOTION_SCRIPT} --help\` before you start, and keep the power limits in the steps below in force throughout.** This job was registered from the studio panel and its owner expects the ${motion && deliver === 'overlay' ? 'transparent WebM in the same folder' : 'MP4 in the same folder'}.

## Request

| item | value |
|---|---|
${rows.join('\n')}

## Edit direction (verbatim from the user)

${c.direction?.text || '(nothing written)'}

The direction is written in the user's own language. Carry it out; the copy that lands on screen stays Persian and RTL unless they asked otherwise.

## Paths

- Job folder: \`${p.root}\`
- Input: \`${p.input}\`
- Final output: \`${layerFile}\`
- Log: \`${p.log}\`
- Progress: \`${p.progress}\`
${motion ? `- Beat sheet (editable): \`${path.join(p.root, 'beats.json')}\`\n- Style profile (learned from the reference): \`${path.join(p.root, 'style.json')}\`\n- Layer placement guide: \`${path.join(p.out, 'DROP-IN.md')}\`\n` : ''}
## Keeping the panel live

The panel tails these files. Until you write them, the user sees nothing.

\`\`\`bash
S=${CLI}
node $S claim ${job.id} --by agent
node $S log ${job.id} stage "starting"
node $S progress ${job.id} ${motion ? 'beats' : 'scaffold'} 40
node $S progress ${job.id} render 70
node $S done ${job.id} ${layerFile}
# or, if it breaks: node $S fail ${job.id} "why"
\`\`\`

Stage keys: \`${motion ? STAGES_MOTION : STAGES_CAPTIONS}\`.

## What to do

${motion ? motionSteps(job, p, { deliver, c }) : captionsSteps(job, p, c)}

If you make a creative call of your own (a cut, an emphasis, a rhythm change), write it in \`notes/decisions.md\` and leave one line in the log.
`;
}

const STAGES_MOTION = 'prepare transcribe reference direction beats sfx scaffold check stills render composite fit verify';
const STAGES_CAPTIONS = 'prepare transcribe direction scaffold check stills render fit verify';

function motionSteps(job, p, { deliver, c }) {
  const M = MOTION_SCRIPT;
  const COOL = COOL_RUN ?? path.join(os.homedir(), '.qoder/skills/cool-render/scripts/cool-run');
  const ratio = c.output?.ratio || '9:16';
  const overlay = deliver === 'overlay';
  return `Every stage of the motion engine is reachable from one script: \`node ${M} <command> …\` (analyze · beats · sfx · write · stills · slim · collage · inspect).

First set the job folder and read the machine budget — \`$COOL\` below is the same command capped at 50% CPU, and the worker count is never \`auto\`:
\`\`\`bash
COOL=${COOL}
node ${CLI} power ${c.cpu?.pct ?? 50}   # workers / bitrate
\`\`\`

1. Build or take the transcript (the clock, not the text, is the source of truth):
   \`\`\`
   npx --yes hyperframes@${HYPERFRAMES_VERSION} transcribe <src> --dir <project> --engine whisper --model small --language fa --to srt --output ${p.input}/script.fa.srt
   \`\`\`
2. If a reference video came with the job, learn the style from it:
   \`node ${M} analyze --video <reference> --out ${p.root}/style.json\`
3. Build the beat sheet:
   \`\`\`
   node ${M} beats --srt ${p.input}/script.fa.srt --style ${p.root}/style.json --out ${p.root}/beats.json --ratio ${ratio} --deliver ${deliver} --density ${c.motion?.density || 'auto'} --material ${c.motion?.material || 'glass'}
   \`\`\`
   **Open beats.json and edit it if needed** — card copy has to be the words actually spoken. No number, claim or name that is not in the SRT.
4. Sound effects (only if they are on): \`node ${M} sfx --beats ${p.root}/beats.json --out ${p.out} --level ${c.sound?.level || 'balanced'} --voice <master.mp4>\` — every level is confirmed by measurement, not guesswork.
5. Write the layer: \`node ${M} write --beats ${p.root}/beats.json --dir ${p.project} --ratio ${ratio} --deliver ${deliver}\`
6. \`$COOL npx --yes hyperframes@${HYPERFRAMES_VERSION} check --json\` must report zero errors. Then take the still timestamps from the beat sheet itself (not from an even split of the duration — that lands frames between cards) and review them:
   \`\`\`
   node ${M} stills --beats ${p.root}/beats.json
   $COOL npx --yes hyperframes@${HYPERFRAMES_VERSION} snapshot --at <at> --out ${p.root}/review/stills
   \`\`\`
7. ${
    overlay
      ? `The layer renders in one pass: \`--format webm --fps 30\`. **Do not pass \`--max-bitrate\`** — it is MP4-only and it breaks the WebM mux:
   \`\`\`
   $COOL npx --yes hyperframes@${HYPERFRAMES_VERSION} render . -o ${layerFile(job, deliver)} --format webm --fps 30 --quality ${c.output?.quality || 'delivery'} --workers <n>
   node ${M} inspect --file ${layerFile(job, deliver)}
   \`\`\`
   It must answer \`hasAlpha: true\` and \`fps: 30\`. \`pix_fmt\` reports \`yuv420p\` on an alpha VP9 stream and that is not a failure; the criterion is the \`ALPHA_MODE=1\` container tag. **Never run \`fit-size\` on the layer**: its only encoder is libx264/\`yuv420p\` and it throws the alpha away. Over the size budget? \`node ${M} slim --file <layer> --out <layer> --crf 30\` (raise the crf and repeat).`
      : `Render MP4 with \`--video-bitrate\` and \`--max-bitrate\`, then \`fit-size\`; take the worker count and bitrate from \`node ${CLI} power ${c.cpu?.pct ?? 50}\`.`
  }
8. Collage preview and edit guide (show this preview to the owner — a real composite is the decision-grade artefact):
   \`node ${M} collage --base <user video> --layer <layer> --out ${p.root}/review/collage-preview.mp4${c.sound?.sfx === false ? '' : ` --sfx <wav>`} --note ${p.out} --beats <beat count>\`
   If you composite with ffmpeg yourself, **put \`-c:v libvpx-vp9\` before the layer's \`-i\`**: ffmpeg's built-in vp9 decoder drops the WebM alpha plane, so the layer would read as a black box instead of transparent.
9. Facts are sacred: add no number, claim or name. The beat engine puts the words of the speech on the cards and nothing else.`;
}

/** The delivery file name the panel expects for this job and mode. */
function layerFile(job, deliver) {
  return path.join(jobs.paths(job.id).out, `${job.id}.${deliver === 'overlay' ? 'webm' : 'mp4'}`);
}

function captionsSteps(job, p, c) {
  return `1. Use \`node ${SRT_TOOL} all <project>\` for the captions; if there is no transcript, run the approved command (\`--to\` is the format, not a path; the file goes to \`--output\`):
   \`\`\`
   npx --yes hyperframes@${HYPERFRAMES_VERSION} transcribe <src> --dir <project> --engine whisper --model small --language fa --to srt --output <input>/script.fa.srt
   \`\`\`
2. Build the project from \`${TEMPLATE_DIR}\` and move the canvas to ${c.output?.ratio}.
3. Write the requested background "${c.output?.background}" and layout into \`index.html\`.
4. \`npx hyperframes check --json\` must pass with no errors, then \`snapshot\` and review the stills.
5. Render only through \`${COOL_RUN ?? path.join(os.homedir(), '.qoder/skills/cool-render/scripts/cool-run')}\`; take the worker count and bitrate from \`node ${CLI} power ${c.cpu?.pct ?? 50}\` (on an 8 GB machine HyperFrames caps itself at 1 worker). Finish with \`fit-size\` and \`ffprobe\`.
6. Facts are sacred: add no number, claim or name.`;
}

/** Mark the job queued and drop the brief an agent will pick up. */
export function enqueue(job) {
  const p = jobs.paths(job.id);
  fs.writeFileSync(p.handoff, handoffDocument(job), 'utf8');
  jobs.appendLog(job.id, 'queue', 'queued for the agent — waiting for a worker to claim it');
  return jobs.setStatus(job.id, 'queued', { handoffAt: new Date().toISOString() });
}

export function pendingCount() {
  return jobs.list().filter((j) => j.status === 'queued').length;
}
