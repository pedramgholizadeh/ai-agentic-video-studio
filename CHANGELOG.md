# Changelog

All notable changes to this project are documented here.
The format follows [keep-a-changelog](https://keepachangelog.com/en/1.1.0/);
the project does not track dates before 1.0.0 — it grew inside a private
working repository and this is its first public form.

## [1.0.0-beta] — 2026-11-08

### The studio becomes a desktop app (macOS + Windows)

- **Native installers from GitHub Actions**: a matrix workflow builds a macOS
  dmg (+ zip for the updater) and a Windows NSIS setup from every
  `v1.0.0-beta.*` tag; dispatch builds land as artifacts. The version stamp is
  `1.0.0-beta.<commit id>`.
- **Fully self-contained shell** (`desktop/main.cjs`): the bundled Node
  runtime (npm/npx included) and ffmpeg + ffprobe ship inside the app; the
  Electron binary itself runs the studio server in `ELECTRON_RUN_AS_NODE`
  mode, so a fresh machine installs nothing. HyperFrames' Chrome and the
  whisper runtime download on first use; whisper models download from the
  app's own settings.
- **In-app updates**: electron-updater against GitHub Releases — automatic
  check at boot and every six hours, auto-download, one-click install, plus a
  manual «بررسی به‌روزرسانی» in settings and a status row in the About card.
- **Bilingual About** (فارسی/English): builder credits (Pedram Gholizadeh —
  پدرام قلی‌زاده), engine version, app version from the release, repo link;
  mirrored in the native About panel and the menu.
- **Engine portability for Windows**: the power wrapper falls back to the
  worker/thread caps when `taskpolicy` is absent, disk checks use portable
  `fs.statfs`, and `npx` resolves as `npx.cmd`.
- Panel fixes carried in the same train: the live players no longer reload on
  every SSE tick, the transcript gate fails loud-but-kindly with a retry
  instead of «خط‌ها نامعتبرند», the wake command is copyable, agent-mode jobs
  never start the built-in runner behind the claiming agent's back.


All notable changes to this project are documented here.
The format follows [keep-a-changelog](https://keepachangelog.com/en/1.1.0/);
the project does not track dates before 1.0.0 — it grew inside a private
working repository and this is its first public form.

## [2.0.0] — 2026-11-07

### The studio becomes a re-edit studio

- **Two inputs, one film**: every job takes the user's video plus a reference
  video and delivers the user's footage re-edited in the reference's style —
  word-synced Persian subtitles (Vazirmatn), motion accents, sound design and
  the composite done for them at 30 fps in 1920×1080 (default) or 1080×1920.
- **The pipeline** `prepare → transcribe → review → understand → reference →
  assets → strategy → scaffold → preview → final → verify`, driven by
  `lib/runner.mjs` in studio/provider mode and by `HANDOFF.md` in agent mode,
  with `lib/agent.mjs` writing the new contract.
- **Accurate transcription**: whisper `large-v3` (offline, checksum-pinned) as
  the default model; the transcript review gate shows every cue as an editable
  row with click-to-seek video, saved back through the SRT.
- **The reference memory** (`lib/references.mjs`): each reference video is
  analysed once, keyed by content SHA-1 under `workspace/references/` with its
  style profile and sample frames; the panel suggests previously analysed
  references at input time and replays profiles instantly.
- **The preview gate + chat edits** (`lib/chat.mjs`): a cheap 15 fps, 640 px
  demo, a Persian chat box whose recognised intents (density, energy, pacing,
  accent colour, caption side, SFX level, ratio, numbered transcript fixes)
  patch the job and invalidate only the downstream artifacts, then re-render.
- **Stage zero** (`lib/agents.mjs`): the user picks who edits — opencode /
  zcode / claude code / codex (auto-spawned headless when installed, a wake
  command otherwise) or an API brain (openrouter / z.ai / paasta.cloud) or the
  deterministic house engine.
- **The panel, rebuilt in the same design language**: five views (new job,
  live job, jobs, reference memory, settings), SSE-driven progress and log,
  Persian default with full English coverage of the chrome
  (`npm run i18n:check`), and a settings view holding the CPU power dial
  (default 50 %), the whisper model and provider keys.
- **The final cut** (`lib/finalcut.mjs`): base footage + alpha layer + SFX bed
  (+ logo) composited to H.264 with a CRF size guard; `motion.mjs final` gives
  the same step to agents; verify demands the exact canvas, 30 fps and the
  size budget.
- The previous motion-overlay studio moved intact to [`old/`](old/) and still
  runs from there (`node old/server.mjs`).

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
