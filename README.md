# AI Agentic Video Studio

A local web studio that turns **one video** into a finished motion deliverable.
You give it your footage (and an optional Persian subtitle file), and it returns
a transparent **WebM/VP9 layer** of glass cards, icons, counters and
beat-synced transitions that sits over your own edit — or a standalone MP4
film, or a captions film.

No accounts, no cloud. The engine runs on your machine, binds to `127.0.0.1`
only, and has zero runtime npm dependencies.

## What it produces

| Type | Output | How |
|---|---|---|
| **Motion overlay** (default) | transparent **WebM VP9 + alpha** layer, collaged over your own footage | liquid-glass cards, Material icons, typing effects, counters, sound waves, transitions on the beat |
| **Standalone motion film** | MP4 | the same beat engine over a generated background, with its own soundtrack |
| **Captions film** | MP4 | the SRT-driven subtitle pipeline |

## Why it is built this way

- **The SRT is the source of truth.** Timing, card text, scene rhythm and film
  length all come from the subtitle file. The engine never invents a number, a
  claim or a name — on-screen copy is the speech's own words.
- **Sound design is measured, not guessed.** Every one-shot's accent (its
  loudest 60 ms window) is measured, so a cue scheduled on a beat is delayed by
  `beat − accent`. Gains come from measured loudness; after the mix, an audit
  re-measures the *lift in dB* each cue adds to the bed and raises buried cues,
  then re-renders. `beats.json`, `sound.json`, `style.json` and `sfx.wav` are
  downloadable artifacts of every job.
- **A code agent can be the engine.** With `engine.mode = "agent"` a job is
  queued and a `HANDOFF.md` is written into the job folder; any CLI coding
  agent opened on the repository claims it with `node cli.mjs next` and drives
  `log.txt` / `progress.json` so the browser stays live.
- **Power limits are the requirement, not the risk.** Every media job runs at
  ≤ 50 % CPU regardless of duration, output ≤ 200 MB, 30 fps constant, through
  the vendored `tools/cool-render/cool-run` wrapper. The worker count comes
  from `node cli.mjs power <pct>` and is never `auto`.
- **HyperFrames is the renderer** (`npx --yes hyperframes@0.9.8`). Compositions
  are authored in HTML; motion is deterministic GSAP driven by
  `assets/*/hypermotion.js`.

## Requirements

- Node ≥ 20
- `ffmpeg` and `ffprobe` on `PATH`
- ~2 GB free disk for renders and the frame cache
- Network access on first render (HyperFrames is fetched via `npx` and cached);
  the transcription engine (Whisper) is only needed when you give audio
  without captions

## Quickstart

```sh
npm run setup     # build the 33 synthesised SFX + fetch GSAP (checksum-verified)
npm run doctor    # prints a required/optional table; exits 1 if something required is missing
npm start         # binds http://127.0.0.1:8790
```

Then open <http://127.0.0.1:8790>. The panel is bilingual (فارسی/English) and
picks your browser's language; the videos it renders stay Persian and
right-to-left.

### The four wizard steps

1. **Source** — video file, audio file, captions file, and optionally a
   reference video. Files are not copied; the studio reads their paths.
2. **Output** — aspect ratio (1:1, 3:4, 4:3, 16:9, 9:16, 2:1), density,
   quality draft (fast) / delivery (best), WebM transparency for overlays.
3. **Background** — for the standalone/captions films: brand graphite, mint
   waves, dot fields, film grain, or your own blurred footage. Previews use
   the same code that renders.
4. **Direction and settings** — free-text notes, title/end-card copy, SFX on
   or off, CPU cap, and who does the work: the deterministic studio pipeline,
   an OpenAI-compatible model for edit direction, or a code agent via the
   queue.

## Using it from a code agent

Set *Direction → کار را چه کسی انجام دهد؟* to the agent mode (or send
`engine.mode: "agent"` to the API). The job is queued, `HANDOFF.md` appears in
the job folder, and any CLI agent opened on the repository takes it from
there:

```sh
node cli.mjs list                    # what is in the queue
node cli.mjs next                    # claim the next queued job; prints HANDOFF.md
node cli.mjs log <id>                # tail the job log
node cli.mjs progress <id>           # machine-readable progress
node cli.mjs done <id> --note "..."  # hand the result back to the browser
node cli.mjs fail <id> --error "..." # or report a failure
node cli.mjs power 50                # set the CPU budget for every render
node cli.mjs show <id>               # artifact paths
```

The agent contract in one line: read `HANDOFF.md`, keep the power limits, and
write `log.txt` / `progress.json` as you go — the browser bar is tailing them.

## WebM alpha rules (they cost hours to learn; read before touching ffmpeg)

| Rule | Why |
|---|---|
| `ffprobe` always reports `yuv420p` for VP9 with alpha — that is not a failure | the criterion is the container tag `ALPHA_MODE=1`; check it with `node scripts/motion.mjs inspect --file <layer>` (prints `hasAlpha`) |
| When compositing by hand, put `-c:v libvpx-vp9` **before** the layer's `-i` | ffmpeg's native VP9 decoder silently discards the alpha plane and the layer drops black over the video |
| Never pass `--max-bitrate` to a WebM render | it is MP4-only and breaks the VP9/alpha mux |
| Never run `fit-size` on an alpha layer | its only encoder is libx264/`yuv420p`, which flattens the alpha; to shrink: `node scripts/motion.mjs slim --file <layer> --out <layer> --crf 30` |

## The hosted panel (GitHub Pages) and the loopback bridge

<https://pedramgholizadeh.github.io/ai-agentic-video-studio/> serves the static
panel only — Pages cannot render video, and the studio does not upload your
footage anywhere. Instead, the hosted panel talks to **your own engine**:

1. start the engine with an explicit opt-in:
   `npm start -- --allow-origin pages` (`pages` allows any
   `https://<name>.github.io` origin; you can pass an exact origin instead),
2. the hosted panel re-points every request at `http://127.0.0.1:8790`.

Two rules make that safe, both enforced by the engine (`lib/cors.mjs`):

- it ignores every origin until started with `--allow-origin`, and
- anything that changes state must carry the `x-video-studio: 1` header, which
  forces a CORS preflight a random webpage cannot pass.

Browser reality: Chrome treats loopback as potentially trustworthy and asks
one private-network question, which the engine answers; **Safari may refuse
`https → http://127.0.0.1`** — in that case open
<http://127.0.0.1:8790> directly and use the panel there.

## How the bilingual panel works

The engine speaks Persian; the interface translates to English in the browser.
`ui/i18n.js` (generated by `npm run i18n` from `ui/i18n.*.json`) walks the DOM
and translates, in order: exact phrases → maximal Persian runs inside
interpolated strings → word-level terms for dynamic readouts. Input values,
`[data-no-i18n]` regions (the beat preview shows real card text) and code
blocks are never touched. `npm run i18n:check` reports every Persian string in
the sources that the dictionaries do not yet cover — keep it at zero.

## Facts are sacred

The engine does not write copy. Card text is the SRT's own words; numbers on
counters exist only because they appear in the speech; the reference video
teaches *style* (card cadence, motion energy, framing) and no frame is copied.
If a card needs a different headline, you write it in *Direction*.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `403 origin not allowed: …` in the browser console | the engine only answers websites it was told to answer: start it with `npm start -- --allow-origin pages` (or an exact origin) |
| `cross-origin writes need the x-video-studio: 1 header` | a script is POSTing cross-origin without the marker; the panel adds it automatically, a hand-rolled script must add it too |
| the layer drops **black** over the video | the decoder flattened the alpha: put `-c:v libvpx-vp9` before the layer's `-i` (see the alpha rules above) |
| layer is over the size budget | do **not** run `fit-size` (it kills alpha); run `node scripts/motion.mjs slim --file <layer> --out <layer> --crf 30`, repeat with a higher CRF |
| `lufs: null` on a short sound cue | R128 loudness cannot gate clips under ~400 ms; the gain then falls back to `accentDb − 6`, which is expected |
| `GSAP checksum mismatch` during `npm run setup` | the fetched file does not match the pinned SHA-256; check your network/proxy and re-run, or pin a new hash deliberately in `scripts/vendor.mjs` |
| the hosted panel says *No engine found on this machine* | the engine is not running, not on port 8790, or not started with `--allow-origin`; the banner's retry field can switch ports |

## Contributing

PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the
`npm run` table, where to add beat recipes / SFX cues / icons, and the render
rules a change must not break. Security notes live in
[SECURITY.md](SECURITY.md); third-party asset licences are listed in
[NOTICE.md](NOTICE.md).

## Licence

[MIT](LICENSE) for the code. Fonts, icons and fetched libraries are covered
separately — see [NOTICE.md](NOTICE.md).
