# AGENTS.md — operating this studio as a code agent

This repository is a **local motion-graphics studio**: a web panel queues
video jobs, and a code agent — you — builds them. The browser shows live
progress; you do the work. This file is the operator manual for any coding
agent (Codex, Claude Code, ZCode, Qoder, Antigravity, anything that reads
AGENTS.md).

## Setup (once per machine)

```sh
npm run setup      # synthesised SFX kit + GSAP (SHA-256 pinned) + grain plate
npm run assets     # optional asset packs (textures, terminal font)
npm run models     # optional offline Whisper model
npm run doctor     # must end with “Required tools are present”
```

## The queue contract

When the panel runs in agent mode, a queued job writes `HANDOFF.md` into
`workspace/jobs/<id>/` and waits. The whole interface is `cli.mjs`:

```sh
node cli.mjs list                        # queued/running jobs
node cli.mjs next                        # claim the next queued job; prints HANDOFF.md
node cli.mjs claim <id>                  # claim a specific job
node cli.mjs log <id> <level> <text>     # append to the browser log (info|warn|error|stage)
node cli.mjs progress <id> <stage> <0-100>   # move the browser progress bar
node cli.mjs show <id>                   # full job record
node cli.mjs done <id> <file>            # ffprobe + mark succeeded (budget-checked)
node cli.mjs fail <id> <why>             # report a failure
node cli.mjs power <pct>                 # the CPU budget for every render
```

`HANDOFF.md` is the per-job brief: exact commands, file paths, and the
pipeline order (`prepare transcribe reference direction beats sfx scaffold
check stills render composite fit verify`). Follow it; it is generated from
the job's real configuration.

## Hard rules

- **Power**: every render goes through the vendored wrapper and stays
  **≤ 50 % CPU** regardless of duration; the worker count comes from
  `node cli.mjs power <pct>` and is **never `auto`**. Slow is the requirement.
- **Facts are sacred**: on-screen copy is the SRT's own words or the user's
  direction. Add no number, claim or name.
- **WebM alpha**: never `fit-size` an alpha layer (`slim` instead), never pass
  `--max-bitrate` to a WebM render, and put `-c:v libvpx-vp9` **before** the
  layer's `-i` when compositing by hand. `yuv420p` on a VP9 alpha stream is
  not a failure — `ALPHA_MODE=1` is the criterion.
- **Watch it before `done`**: take the stills at the beat sheet's own
  timestamps, look at them, and run `node scripts/motion.mjs inspect --file
  <layer>` (`hasAlpha: true`, `fps: 30`) before handing over.
- **Keep the browser alive**: the panel tails `log.txt` and `progress.json` —
  write to them as you go (`cli.mjs log` / `cli.mjs progress`), not in one
  burst at the end.

## Where things live

| Path | What |
|---|---|
| `workspace/jobs/<id>/` | the job: `input/`, `project/`, `out/`, `review/`, `log.txt`, `progress.json`, `HANDOFF.md` |
| `scripts/motion.mjs` | the engine CLI (`beats`, `sfx`, `write`, `stills`, `inspect`, `slim`, `collage`, …) |
| `tools/cool-render/cool-run` | the ≤ 50 % CPU wrapper every render goes through |
| `lib/beats.mjs`, `lib/motions.mjs` | beat planning and the motion-recipe catalogue |
| `docs/` / `README.md` | the human-facing manual |

More craft context: [README.md](README.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
· [SECURITY.md](SECURITY.md).
