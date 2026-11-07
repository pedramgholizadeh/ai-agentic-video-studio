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

## Offline transcription

A job that arrives **without** a captions file is transcribed with Whisper
(via HyperFrames) — a ~465 MB multilingual model, fetched once and cached at
`~/.cache/hyperframes/whisper/models/`. To prepare a machine for offline use
(or a flaky connection), download it ahead of time:

```sh
npm run models            # whisper "small" — the studio default, Persian-capable
npm run models --check    # exit 0 when the model is already cached
npm run models -- --model large-v3   # any model hyperframes pins (up to ~3 GB)
```

`npm run doctor` reports the model's presence as *whisper model (offline)*.
Downloads are checksum-pinned against HyperFrames' own model table — a file
that does not match its SHA-256 is discarded. The machine the model lands on
is the machine that renders; `HYPERFRAMES_CACHE_DIR` moves the cache if you
keep models elsewhere.

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
4. **Direction and settings** — the video's topic, free-text notes, the brand
   personality (six presets + accent colour), title/end-card copy, SFX on or
   off, CPU cap, and who does the work: the deterministic studio pipeline, an
   OpenAI-compatible model for edit direction, or a code agent via the queue.

### Learning from a reference video

Drop a reference video in step 1 and the studio **measures** it — cuts,
motion energy, audio rhythm, palette — and shows what it learned as a style
profile: sample frames from the reference, an energy gauge, the learned card
cadence, and the suggested density with a one-click *apply* button. No frame
is ever copied; the numbers drive the beat engine so your film moves *like*
the reference. When the reference is itself a motion graphic, its measured
palette (ink, accent, ground) also becomes the film's colours.

### Teaser ratios: subtitles + platform safe zones (9:16, 16:9)

Pick **9:16** (Reels/TikTok size) or **16:9** and the film behaves like a
teaser, automatically:

- **Burned-in subtitles** — the SRT itself rides the film word-by-word
  (karaoke-style: each word lights at its spoken time, hot words take the
  brand accent). Copy is never rewritten — it is the transcript's own words.
- **Instagram Reels safe zones** — the chrome (username/camera row on top,
  caption/audio/CTA stack at the bottom, the action rail on the right) owns
  the edges of a 9:16 board. Every motion card *and* every subtitle sits
  inside the safe rect (`lib/safe.mjs` holds the numbers: top 12.5 %, bottom
  24 %, right 13.5 %, left 6 %), and no card may enter the caption band.
  16:9 keeps a plain 5 % action-safe box.

The beat validator refuses a card outside the safe rect, the writer clamps
card width to it, and the project's `notes/motion-spec.md` records the
enforced margins. Set `output.teaserCaptions: false` in the job config if you
want the teaser look without the burned-in subs.

## Visual templates: one code, one whole look

`lib/templates.mjs` packages a complete visual language distilled from a real
reference film into one code. Pick it in the wizard (the panel shows the
reference film's own frame while you choose) or send `"template": "001"` in
the job config.

**Template 001 — «کارتون UI روشن»** is vectorised from the studio owner's
reference teaser (frame kept at `assets/templates/001/reference.jpg`,
colours measured from its pixels): white sketch-grid ground with a soft
vignette, flat white UI cards (hairline border, soft shadow, 3 % radius),
the two-tier headline — spoken words bold ink, upcoming words faded, key
words in italic serif inside a Figma-style selection box — royal blue
`#2E67FF`, gold `#F9C24F`, and the springy `lively-joyful` motion
personality. A template locks the ground painter (`paper-grid`) and the card
material (`ui`), flips the caption band to the top of the frame, and appends
its own `banned` defaults (no dark ground, no glass/glow on the white cards).

Everything else — brief, beats, facts-sacred copy, safe zones, the ≤ 50 % CPU
render — runs exactly as before; the template only steers the look. List
what's installed with `node scripts/motion.mjs templates`, and plan a job
from the terminal with `beats … --template 001` / `write … --template 001`.

## Brand & brief: the `direction` stage

Every job passes through a real **direction** stage before any beat is
planned. It writes two artifacts into the job folder:

- **`brief.json`** — the purposeful read of the topic, shotcraft-style: the
  topic (from the user or the strongest spoken material), the one sentence the
  film has to prove, audience and goal, the narrative arc (`promo`:
  hook → substance → landing, or `explainer`: question → intuition → steps →
  recap), the mood, and `facts[]` — numbers, units and latin names extracted
  only from the transcript and the user's own direction. `validateBrief`
  rejects any brief whose numbers do not appear in those texts; a model may
  rewrite the prose, never the numbers.
- **`brand.json`** — one resolved token set for the whole film, merged
  `house ← studio brand ← job override ← reference palette`. The studio-wide
  file lives at `workspace/.studio/brand.json` (editable from the panel).

The brand token set carries two halves, after HyperFrames' `frame.md`
doctrine — colour and type are *strict* brand truth; motion is the
personality that executes it:

| Preset | Character | Motion numbers (energy · entrances · exits · overshoot · holds) |
|---|---|---|
| `professional-trust` | حرفه‌ای و مطمئن | 0.35 · ×0.92 · ×0.85 · soft kicks · +15% |
| `refined-premium` | شیک و لاکچری | 0.30 · ×1.35 · ×1.05 · minimal · +30% |
| `vibrant-bold` | پرانرژی و جسور | 0.75 · ×0.75 · ×0.70 · full overshoot · −10% |
| `lively-joyful` | شاد و سرزنده | 0.65 · ×0.95 · ×0.85 · springy · +0% |
| `calm-caring` | آرام و دلسوز | 0.25 · ×1.20 · ×1.10 · none · +35% |
| `friendly` | صمیمی و خودی | 0.50 · ×0.95 · ×0.90 · gentle spring · +5% |

One token set governs all motion — never mix a second set into a film. The
brief's arc also biases the beat engine: the opening beat wants a hook shape
(`question`/`keyword`), the closing one wants a landing (`brand`/`badge`), and
every boost can only re-order recipes whose gates already passed, so the arc
never forces a shape the speech does not support.

Each project ships with the brand's `banned` defaults list (everything
centred, everything fading in at once, text moving while read, three
identical cards in a row, meaningless glow, corner-docked logo) in
`index.html` and `notes/motion-spec.md` — after the first render, name every
default you still see, add it to the list, and fix the film. The list grows
with every film.

### The two commands

```sh
node scripts/motion.mjs brief --srt <job>/input/script.fa.srt --direction "…" --out <job>/brief.json
node scripts/motion.mjs brand --job <id> --out <job>/brand.json
```

`beats` takes `--brief` and `--brand`; `write` takes `--brand`. With no flags
the house look applies, exactly as before.

## Using it from a code agent

Set *Direction → کار را چه کسی انجام دهد؟* to the agent mode (or send
`engine.mode: "agent"` to the API). The job is queued, `HANDOFF.md` appears in
the job folder, and any CLI agent opened on the repository takes it from
there:

```sh
node cli.mjs list                        # what is in the queue
node cli.mjs next                        # claim the next queued job; prints HANDOFF.md
node cli.mjs log <id> <level> <text>     # tail into the browser log
node cli.mjs progress <id> <stage> <0-100>   # machine-readable progress
node cli.mjs done <id> <file>            # ffprobe + mark succeeded (budget-checked)
node cli.mjs fail <id> <why>             # or report a failure
node cli.mjs power 50                    # set the CPU budget for every render
node cli.mjs show <id>                   # artifact paths
```

The agent contract in one line: read `HANDOFF.md`, keep the power limits, and
write `log.txt` / `progress.json` as you go — the browser bar is tailing them.

### Works with the popular agents

| Agent | How it picks the studio up |
|---|---|
| **ZCode** | reads [`AGENTS.md`](AGENTS.md); the project skill `.agents/skills/studio-queue/` gives it the claim-and-deliver loop |
| **Codex CLI** | reads `AGENTS.md` natively |
| **Claude Code** | reads `CLAUDE.md` (a symlink to `AGENTS.md`) and the skill in `.claude/skills/studio-queue/` |
| **Qoder** | reads `AGENTS.md` (officially supported per Qoder's rules docs) |
| **Antigravity** | reads `AGENTS.md` and mounts the skill from `.agents/skills/` |

`AGENTS.md` is the single source of truth; the per-agent files point at it.
The per-job `HANDOFF.md` is agent-agnostic by design — exact commands, no
tool-specific vocabulary.

## WebM alpha rules (they cost hours to learn; read before touching ffmpeg)

| Rule | Why |
|---|---|
| `ffprobe` always reports `yuv420p` for VP9 with alpha — that is not a failure | the criterion is the container tag `ALPHA_MODE=1`; check it with `node scripts/motion.mjs inspect --file <layer>` (prints `hasAlpha`) |
| When compositing by hand, put `-c:v libvpx-vp9` **before** the layer's `-i` | ffmpeg's native VP9 decoder silently discards the alpha plane and the layer drops black over the video |
| Never pass `--max-bitrate` to a WebM render | it is MP4-only and breaks the VP9/alpha mux |
| Never run `fit-size` on an alpha layer | its only encoder is libx264/`yuv420p`, which flattens the alpha; to shrink: `node scripts/motion.mjs slim --file <layer> --out <layer> --crf 30` |

## The simple video editor

Separate from the wizard, the panel ships a small editor at
[`editor.html`](https://pedramgholizadeh.github.io/ai-agentic-video-studio/editor.html)
(linked from the top bar):

- **Timeline** with a filmstrip, an audio waveform and a playhead; **cut**
  splits a clip at the playhead, edges trim, segments delete.
- **Overlays**: stack one or more videos over the base with position, scale
  and opacity — dragged directly on the timeline.
- **Auto subtitles**: the editor transcribes the base video's audio (Whisper),
  shows every segment as editable text (fix recognition mistakes in place),
  and burns them in with your **font** (Vazirmatn / JetBrains Mono), size,
  weight, colour, outline and **position** (bottom / middle / top + margin).
- **Export** with the same power and size governance as every render:
  H.264 quality presets, and an automatic re-encode loop that keeps the
  output under your MB budget.

Subtitles burn through the studio's own renderer as a transparent WebM layer
(libass is used when the machine's ffmpeg ships it), so Persian shaping is
correct everywhere. Everything renders locally; nothing is uploaded.

## The asset store

Motion films need the same materials on repeat, so the studio keeps them in a
store with two shelves:

- **Generated** — `npm run textures` renders the film-grain plate with ffmpeg
  (fixed seed, deterministic, CC0-equivalent by construction). The *film
  grain* background prefers this plate over a per-frame SVG turbulence
  filter — the same look for far less CPU.
- **Fetched** — `npm run assets` downloads checksum-pinned packs: brushed
  metal / concrete / fabric grounds (CC0, ambientCG) and the JetBrains Mono
  typeface (OFL) for the terminal card. A file that does not match its pinned
  size and SHA-256 is discarded, never installed. The new **metal**,
  **concrete** and **fabric** backgrounds use them; when a pack is missing
  every background falls back to its code-drawn look — a missing asset never
  breaks a render.

The **curator** is the auto part: before a job's project is written, the
engine reads the chosen background and the beat sheet and downloads exactly
what that film needs (`npm run assets -- --auto --for-job <id>` does the same
by hand). The one-click view — every pack with licence, size and a direct
download link — lives at
[assets.html](https://pedramgholizadeh.github.io/ai-agentic-video-studio/assets.html)
(also `ui/assets.html` in the repo), linked from the panel's top bar.

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
<http://127.0.0.1:8790> directly and use the panel there. If your engine runs
on a different port, the hosted panel's banner takes any port in its retry
field, and the whole procedure is written up on the site's
[port guide](https://pedramgholizadeh.github.io/ai-agentic-video-studio/port.html)
(also in `ui/port.html`).

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
If a card needs a different headline, you write it in *Direction*. The brief
stage enforces the same rule harder: `validateBrief()` rejects a brief whose
numbers do not appear in the transcript or the user's direction.

## Future bridges (deliberately not wired)

Two more renderers were studied; both stay out of the pipeline for now, and
this is the record of why and how they could join later:

- **Manim (ManimCommunity)** — MIT, unbeatable for math/geometry/data segments
  (`TransformMatchingTex` equation morphs, `NumberPlane`, updaters), but it
  brings a Python + cairo/pango + LaTeX toolchain and renders at 2–4×
  realtime, and its scenes are Python-only (no declarative input). If a job
  ever genuinely needs a 5–15 s concept insert, the clean bridge is: render
  the section as a **transparent WebM or PNG sequence** (`manim -t
  --format=webm`, or `--save_sections` for per-section files + JSON index),
  inject brand colours/fonts via `manim.cfg` and a small Python template
  layer, then composite it in the existing ffmpeg path like any other alpha
  layer. Its *craft ideas* (semantic colour, build element-by-element,
  why-before-what) already live in the brief's explainer arc.
- **Remotion** — the frame-pure function idea and the spring/interpolate math
  informed this studio's deterministic writers, but adopting the framework
  itself means a source-available license that requires a paid company key
  beyond 3 employees; the studio renders through HyperFrames (Apache-2.0) and
  stays there.

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
