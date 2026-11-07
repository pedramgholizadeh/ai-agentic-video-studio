# AGENTS.md — operating this studio as a code agent

This repository is a **local re-edit studio**: a web panel queues video jobs,
and a code agent — you — builds them. The browser shows live progress; you do
the work. This file is the operator manual for any coding agent (Codex, Claude
Code, ZCode, Qoder, Antigravity, anything that reads AGENTS.md).

## What a job is

A job takes **exactly two files** and nothing else:

1. **the user's video** — the film to be edited;
2. **a reference video** — the style target: rhythm, transitions, palette,
   subtitle placement.

The pipeline, in order:

```
prepare transcribe review understand reference assets strategy scaffold preview final verify
```

- `transcribe` runs whisper (default `large-v3`, language `fa`) — accuracy is
  the product; never downgrade the model to save time.
- `review` is a **gate**: the job parks as `review` and the user edits every
  transcript line in the panel. Wait for it (`node cli.mjs show <id>` until the
  status leaves `review`) — never approve on their behalf.
- `understand` writes `brief.json` (topic/thesis/arc/facts); facts are sacred —
  only words, numbers and names that appear in the SRT.
- `reference` is the reference memory (`lib/references.mjs`): a profile is
  analysed once per file (SHA-1 keyed under `workspace/references/`) and
  replayed forever after. The profile **is** the pixel-perfect contract.
- `strategy` turns the profile + brief into the beat sheet (`beats.json`) —
  edit it like an editor, copy only spoken words.
- `preview` renders a cheap 15 fps demo and parks the job at the second gate;
  the user replies in the chat box (`chat.jsonl` — read it every time the gate
  opens) and you re-render until they approve.
- `final` renders the alpha layer at full fps, composites it over the user's
  footage with the SFX bed, and guards the size budget.

## Setup (once per machine)

```sh
npm run setup      # synthesised SFX kit + GSAP (SHA-256 pinned)
npm run models     # offline whisper model (default: large-v3, ~2.9 GB)
npm run doctor     # must end with "Required tools are present"
```

## The queue contract

When the panel runs in agent mode, a queued job writes `HANDOFF.md` into
`workspace/jobs/<id>/` and waits. The whole interface is `cli.mjs`:

```sh
node cli.mjs list                        # queued/running jobs
node cli.mjs next                        # claim the next queued job; prints HANDOFF.md
node cli.mjs claim <id>                  # claim a specific job
node cli.mjs wait <id> <transcript|preview>   # park the job at a review gate
node cli.mjs log <id> <level> <text>     # append to the browser log (info|warn|error|stage)
node cli.mjs progress <id> <stage> <0-100>   # move the browser progress bar
node cli.mjs show <id>                   # full job record
node cli.mjs done <id> <file>            # ffprobe + mark succeeded (budget-checked)
node cli.mjs fail <id> <why>             # report a failure
node cli.mjs power <pct>                 # what a render at this % means on this machine
```

`HANDOFF.md` is the per-job brief: exact commands, file paths, gate rules. The
engine CLI for the craft stages is `node scripts/motion.mjs` (`refprofile`,
`brief`, `brand`, `beats`, `write`, `sfx`, `final`, `stills`, `slim`,
`collage`, `inspect`, `assets`). Follow the handoff; it is generated from the
job's real configuration.

## Hard rules

- **Power**: every render goes through the vendored wrapper and stays at the
  configured CPU share (the panel default is **50 %**); the worker count comes
  from `node cli.mjs power <pct>` and is **never `auto`**. Slow is the
  requirement.
- **Facts are sacred**: on-screen copy is the SRT's own words or the user's
  direction. Add no number, claim or name — the brief's `facts[]` obeys the
  same rule and is validated against the transcript.
- **One brand token set**: `brand.json` (house ← studio ← job ← reference
  palette) governs every colour, duration, easing and stagger in the film.
  Change it once at the start if the personality mismatches; never mix a
  second set into the tweens.
- **Persian type**: every Persian word on screen is **Vazirmatn** — no other
  face, no fallback fonts mixed in.
- **WebM alpha**: never `fit-size` an alpha layer (`slim` instead), never pass
  `--max-bitrate` to a WebM render, and put `-c:v libvpx-vp9` **before** the
  layer's `-i` when compositing by hand. `yuv420p` on a VP9 alpha stream is
  not a failure — `ALPHA_MODE=1` is the criterion.
- **Teaser safe rect (9:16 / 16:9)**: subtitles are burned in word-by-word and
  every text sits inside the platform safe rect (`lib/safe.mjs`). The
  validator rejects a card outside it; do not loosen it.
- **Watch it before `done`**: take the stills at the beat sheet's own
  timestamps, look at them, and run `node scripts/motion.mjs inspect --file
  <layer>` (`hasAlpha: true`) before handing over.
- **Keep the browser alive**: the panel tails `log.txt` and `progress.json` —
  write to them as you go (`cli.mjs log` / `cli.mjs progress`), not in one
  burst at the end.
- **Chat is a contract**: `workspace/jobs/<id>/chat.jsonl` carries the user's
  edits in Persian. Recognised intents are already applied to the job config;
  anything else is yours to carry out.

## Where things live

| Path | What |
|---|---|
| `workspace/jobs/<id>/` | the job: `input/`, `project/`, `out/`, `review/`, `chat.jsonl`, `log.txt`, `progress.json`, `HANDOFF.md` |
| `workspace/references/<sha1>/` | the reference memory: `profile.json` + sample frames + which jobs used it |
| `workspace/.studio/config.json` | panel settings — port, CPU pct, whisper model, providers |
| `workspace/.studio/brand.json` | the studio-wide brand tokens every job inherits |
| `scripts/motion.mjs` | the engine CLI (`refprofile`, `brief`, `brand`, `beats`, `write`, `sfx`, `final`, `collage`, `inspect`, …) |
| `tools/cool-render/cool-run` | the CPU-capped wrapper every render goes through |
| `lib/runner.mjs` | the studio pipeline (used in studio/provider mode); `lib/agents.mjs` spawns CLIs |
| `old/` | the previous (motion-overlay) studio, frozen but runnable |

More craft context: [README.md](README.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
· [SECURITY.md](SECURITY.md).
