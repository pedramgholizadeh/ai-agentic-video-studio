---
name: studio-queue
description: Take the ai-agentic-video-studio queue as the engine — claim the next queued re-edit job, follow its HANDOFF.md to build the film (two inputs: the user's video + a reference video), keep the browser alive with log/progress, park the job at its review gates, and hand the deliverable back with cli.mjs done. Use whenever the user asks to work the video studio queue, edit a queued video job, or finish a studio render.
---

# Studio queue — the re-edit pipeline

1. **Claim**: `node cli.mjs next` from the repo root. It claims the oldest
   queued job and prints `HANDOFF.md` — the per-job brief with the real
   commands and paths. No queued job? Say so; do not invent one.
2. **Power first**: `node cli.mjs power <job's cpu.pct>` — read the thread and
   worker budget out loud in your plan. Every render goes through the vendored
   wrapper (`$COOL`, shown in the handoff) and the worker count is never `auto`.
   The panel default is 50% CPU; do not exceed the job's configured share.
3. **Follow HANDOFF.md exactly** — stages run in order:
   `prepare transcribe review understand reference assets strategy scaffold
   preview final verify`. Key rules inside:
   - transcription uses the configured whisper model (default `large-v3`,
     language `fa`) — never downgrade for speed;
   - the **review gates park the job** (`node cli.mjs wait <id> transcript` /
     `preview`); poll `node cli.mjs show <id>` until the status leaves
     `review`. Never approve on the user's behalf. At the preview gate read
     `workspace/jobs/<id>/chat.jsonl` every time it opens — the user's edits
     land there in Persian;
   - the reference profile comes from `node scripts/motion.mjs refprofile`
     (SHA-1 keyed in `workspace/references/` — a repeat reference returns
     instantly). The profile is the pixel-perfect contract: rhythm, energy,
     density, transitions, palette;
   - on-screen copy is only the SRT's own words or the user's direction —
     facts are sacred; one brand token set (`brand.json`) for the whole film;
     every Persian word renders in Vazirmatn;
   - WebM alpha rules: `slim` not `fit-size`, no `--max-bitrate` on WebM,
     `-c:v libvpx-vp9` before the layer's `-i` when compositing by hand,
     `ALPHA_MODE=1` is the alpha criterion (not pix_fmt);
   - teaser ratios (9:16/16:9): word-by-word burned subtitles locked inside
     `lib/safe.mjs` safe rect.
4. **Keep the browser alive**: `node cli.mjs log <id> <level> <text>` and
   `node cli.mjs progress <id> <stage> <0-100>` as you go — the panel tails
   these files.
5. **Watch it before done**: stills at the beat sheet's own timestamps
   (`motion.mjs stills` + `hyperframes snapshot`), audit them against the
   brand's banned list, `motion.mjs inspect --file <layer>` → `hasAlpha: true`,
   then `node cli.mjs done <id> <final.mp4>` (or `fail <id> "why"`).

Engine reference: `AGENTS.md` at the repo root. The previous motion-overlay
studio lives frozen in `old/` — do not mix its workflow into these jobs.
