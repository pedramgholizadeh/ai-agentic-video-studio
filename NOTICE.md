# Third-party assets and services

Everything in this repository is either original code (MIT — see `LICENSE`) or
generated at setup time. The items below are the exceptions.

## Sound effects — none shipped, all synthesised

`assets/sfx/` and `assets/sfx-index.json` are **not committed**. They are
produced on your machine by `scripts/build-sfx.mjs` (or `npm run setup`), which
synthesises all 33 one-shots in 10 categories (`counter`, `data`, `fluid`,
`glass`, `impact`, `light`, `riser`, `text`, `transition`, `ui`) from ffmpeg
`lavfi` sources — noise chirps, decaying sines, click trains, `aecho`,
`tremolo`, `vibrato`, `afade` — and peak-scales each to −6 dBFS. No third-party
recording is downloaded or distributed; the kit is CC0-clean by construction.

## GSAP 3.15.1 — fetched at setup, not redistributed

GreenSock's GSAP is **not** a free-software licence and is not committed here.
`scripts/vendor.mjs` downloads `dist/gsap.min.js` for the pinned version
(3.15.1) at setup time into the three template locations
(`templates/video-2x1/assets/vendor/gsap.min.js`,
`templates/overlay-2x1/assets/vendor/gsap.min.js`,
`assets/overlay-template/assets/vendor/gsap.min.js`) and refuses to write
anything whose SHA-256 does not match:

```
3d1bea374ab1b703cc5c4105358eec63c4465efdc573931dc116e34a0a190c1b
```

GSAP is used under GreenSock's standard licence ("Standard No Charge"
license for GSAP 3). Do not commit the fetched file; `.gitignore` excludes it.

## Vazirmatn — SIL Open Font License 1.1

The panel's typeface, Vazirmatn, is redistributed as three WOFF2 subsets plus
a CSS file in `ui/assets/fonts/` (Arabic, Latin, Latin-Ext). Its licence text
is kept beside the fonts in `ui/assets/fonts/OFL.txt`. Copyright for Vazirmatn
belongs to the Vazirmatn project authors.

## Material Symbols — Apache License 2.0

The SVG icons under `templates/overlay-2x1/icons/` and the module
`assets/overlay-template/modules/icons.js` (the Persian→icon keyword map ships
with them) come from Google's Material Symbols, licensed under the Apache
License 2.0.

## Rendered through npx at runtime

- **HyperFrames** (renderer, `npx --yes hyperframes@0.9.8`) — fetched into the
  npx cache on first render; not part of this repository.
- **Whisper** (speech transcription, via HyperFrames) — only needed when you
  provide audio without captions.
- **ffmpeg / ffprobe** — installed on your machine; this repository only
  shells out to them.
