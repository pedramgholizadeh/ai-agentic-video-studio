# Contributing

Thanks for wanting to make the studio better. The rules are short because the
architecture is opinionated; read the [README](README.md) first — especially
*Why it is built this way* and the WebM alpha rules.

## Setup

```sh
git clone https://github.com/pedramgholizadeh/ai-agentic-video-studio.git
cd ai-agentic-video-studio
npm run setup     # synthesise the SFX kit (33 cues) + fetch GSAP (SHA-256 pinned)
npm run doctor    # must end with “Required tools are present”
npm start         # http://127.0.0.1:8790
```

There are zero runtime npm dependencies on purpose. **Do not add any.** The
engine is Node stdlib + ffmpeg + HyperFrames via npx.

## The minimum gate for every PR

```sh
node --check server.mjs && node --check cli.mjs
for f in lib/*.mjs scripts/*.mjs engine/*.mjs ui/app.js ui/engine.js; do node --check "$f"; done
npm run doctor
npm run i18n:check   # must report 0 phrases not covered
```

`i18n:check` failing means you introduced user-visible Persian that the
dictionaries do not translate — see *UI copy* below.

## The `npm run` table

| Script | What it does |
|---|---|
| `start` | the engine + panel at `http://127.0.0.1:8790` |
| `doctor` | required/optional environment table |
| `setup` | `build-sfx` + `vendor` (run once per clone) |
| `sfx` | re-synthesise the 33 kit one-shots (`assets/sfx/`) |
| `vendor` | re-fetch GSAP 3.15.1 with checksum enforcement |
| `models` | pre-download the offline Whisper model (`--model`, `--check`) |
| `motion` | the engine CLI (`inspect`, `slim`, `fit-size`, …) |
| `i18n` | regenerate `ui/i18n.js` from the dictionaries |
| `i18n:extract` | inventory every user-visible Persian string |
| `i18n:check` | report dictionary gaps; must stay at 0 |

## Render rules a PR must not break

- **≤ 50 % CPU** for every media job, regardless of duration; worker count
  comes from `node cli.mjs power <pct>`, never `auto`.
- **Output ≤ 200 MB**, **30 fps** constant frame rate.
- **WebM + alpha** layers stay VP9 with `ALPHA_MODE=1` — never route them
  through libx264, never `fit-size` them (use `motion.mjs slim`).
- **Facts are sacred**: the engine never writes copy that is not in the SRT or
  the user's direction. If your feature wants new on-screen text, it must come
  from one of those two sources.

A PR that touches rendering should include the `ffprobe` line proving it:
30 fps, the expected size, and `ALPHA_MODE=1` when alpha is expected.

## Motion craft rules

The choreography in `assets/*/hypermotion.js` and the two writers encodes a
small set of rules distilled from the shotcraft craft cards; keep them when
you touch a `draw()` case:

- one shared ease drives every channel of a word's entrance (y, blur, opacity
  move as one progress) — split channels and the softness falls apart;
- group entrances **accelerate** (`HM.deal`), they never march in uniform
  steps;
- a card's entrance starts before its beat and lands on it (`enter()` in
  `lib/motion-project.mjs`) — the pop answers the music;
- beats move the element layer, never the whole frame — full-frame pulses are
  capped at three per film by house rule;
- light effects (glow, sweep) are protagonist-only, once per segment, and
  clipped to rounded bounds.

## How to add things

### A beat recipe (`lib/beats.mjs`)

Each recipe is one graphic idea: `cues` (deterministic timing on the beat
sheet), `signals` (regex over the SRT group's text — logic, not UI copy), and
`about` (a Persian sentence shown in the panel's recipe list — add its
translation to `ui/i18n.en.json`). Keep `cues` deterministic: same beat sheet
in, same timings out.

### An SFX cue (`lib/sfx.mjs` + `scripts/build-sfx.mjs`)

Add the recipe to `scripts/build-sfx.mjs` (a lavfi expression that must produce
non-silent audio — a silent result throws), add the mapping to `CUE_MAP` in
`lib/sfx.mjs`, then `npm run sfx`. The index rebuilds and peak-measures for
you; short clips (< ~400 ms) will report `lufs: null` and fall back to
`accentDb − 6` — that is expected.

### An icon (`engine/fetch-icons.mjs`)

Icons are Material Symbols SVGs (Apache-2.0). Add the Persian keyword mapping
and let the fetcher pull the SVG; do not hand-draw replacements.

### UI copy — and keeping the dictionaries in sync

Write interface copy in Persian first, then:

```sh
node scripts/extract-i18n.mjs --coverage   # lists every gap
# translate the gaps into ui/i18n.en.json (whole strings) or
# ui/i18n.words.json (word-level, for interpolated text)
npm run i18n && npm run i18n:check         # must report 0 gaps
```

`scripts/extract-i18n.mjs` scans the sources with a small state machine, so
regex literals like `'ui-entrance/*'` do not swallow the file — but keep
square brackets out of interface text anyway.

## Commit style

`add:` / `fix:` prefixes with a *why* subject, e.g.
`fix: keep vp9 decoder behind the encoder so alpha survives compositing`.
One logical change per commit.
