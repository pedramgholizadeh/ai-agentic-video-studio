# Changelog

All notable changes to this project are documented here.
The format follows [keep-a-changelog](https://keepachangelog.com/en/1.1.0/);
the project does not track dates before 1.0.0 — it grew inside a private
working repository and this is its first public form.

## [1.0.0] — 2026-11-06

### Added

- The motion engine: SRT-driven beat sheets, liquid-glass card recipes,
  deterministic HyperFrames rendering, and the three deliverables — transparent
  WebM/VP9+alpha overlay, standalone MP4 film, captions film.
- Measured sound design: per-cue accent measurement (`beat − accent`
  scheduling), loudness-derived gains, and a post-mix audit that re-measures
  each cue's lift in dB and raises buried cues, then re-renders. `beats.json`,
  `sound.json`, `style.json`, `sfx.wav` ship with every job.
- A 33-cue synthesised sound kit (`scripts/build-sfx.mjs`, 10 categories,
  CC0-clean by construction) — no third-party recordings are shipped.
- The bilingual panel (فارسی/English) with automatic locale detection, a
  source-derived translation dictionary, and `npm run i18n:check` as the
  coverage gate. The rendered videos stay Persian and RTL in every locale.
- The hosted panel on GitHub Pages and the loopback bridge that lets it drive
  the visitor's own engine: opt-in `--allow-origin`, the `x-video-studio`
  marker header for writes, private-network preflight answers, and an
  engine-off banner with a live retry.
- The agent contract: `engine.mode = "agent"` queues a job and writes
  `HANDOFF.md`; `node cli.mjs list|next|claim|log|progress|done|fail|power|show`
  is the whole interface any CLI coding agent needs.
- Power governance through `tools/cool-render/cool-run`: ≤ 50 % CPU for every
  media job, ≤ 200 MB output, 30 fps CFR — never `auto`.
- `npm run doctor` (environment table), `npm run setup` (SFX + checksum-pinned
  GSAP fetch), `scripts/motion.mjs inspect|slim` for alpha validation and
  budget-safe shrinking.
- Documentation set: README, NOTICE, CONTRIBUTING, SECURITY, this changelog,
  and issue/PR templates.
