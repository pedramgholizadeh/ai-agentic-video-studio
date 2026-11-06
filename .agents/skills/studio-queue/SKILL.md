---
name: studio-queue
description: Take the ai-agentic-video-studio queue as the engine — claim the next queued video job, follow its HANDOFF.md to build the motion layer or film, keep the browser alive with log/progress, and hand the deliverable back with cli.mjs done. Use whenever the user says “take the studio queue”, “صف استودیو را بگیر”, asks to build a queued studio job, or when a HANDOFF.md sits unclaimed in workspace/jobs/.
---

# Studio queue — be the engine

The studio queues video jobs and waits for a code agent. You are that agent.
Work only inside this repository; the browser panel is already watching.

## The loop

1. **Claim**:
   ```sh
   node cli.mjs next        # claims the next queued job and prints HANDOFF.md
   ```
   If it prints “صف خالی است” the queue is empty — report that and stop.
2. **Read `HANDOFF.md`** in `workspace/jobs/<id>/` — it is generated from the
   job's real configuration and holds the exact commands, paths and pipeline
   order. It overrides anything generic.
3. **Budget**: `node cli.mjs power <pct>` from the handoff (default 50). The
   worker count is never `auto`.
4. **Execute the handoff's numbered steps**, in order. Between steps keep the
   browser alive:
   ```sh
   node cli.mjs log <id> info "beats sheet built — 4 cards"
   node cli.mjs progress <id> render 40
   ```
5. **Facts are sacred**: card copy is the SRT's own words. No number, claim
   or name that is not spoken.
6. **Watch before done**: review the stills at the beat sheet's timestamps;
   `node scripts/motion.mjs inspect --file <layer>` must answer
   `hasAlpha: true` and `fps: 30` for an overlay.
7. **Deliver**:
   ```sh
   node cli.mjs done <id> <output file>
   ```
   It ffprobes the file, checks the size budget, and flips the browser to the
   result. On failure: `node cli.mjs fail <id> "why"`.

## Hard rules

- Every render goes through the vendored wrapper and stays **≤ 50 % CPU**;
  the worker count is never `auto`.
- WebM alpha layers: never `fit-size` (use `motion.mjs slim`), never
  `--max-bitrate`, and `-c:v libvpx-vp9` goes **before** the layer's `-i`
  when compositing by hand.
- Never raise the power budget to speed anything up, and never run two heavy
  jobs at once.

The full operator manual lives in [AGENTS.md](../../../AGENTS.md) at the
repository root.
