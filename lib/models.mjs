import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { WORKSPACE, STUDIO_ROOT } from './paths.mjs';
import { readConfig } from './config.mjs';

/*
 * models.mjs — the in-app model store.
 *
 * The user decides what lives on their machine: every model below can be
 * downloaded, deleted and (for the transcription ones) promoted to the
 * default — all from the app's settings, with live progress and resume.
 * Nothing here ever downloads on its own; downloads happen only when the
 * user presses the button.
 *
 * kinds:
 *   'whisper' — ggml binaries in the hyperframes cache, used by transcribe;
 *               downloaded through scripts/fetch-models.mjs (checksum + resume)
 *   'piper'   — self-contained sherpa-onnx voice bundles (tar.bz2), staged for
 *               the Persian text-to-speech feature; extracted with the system tar
 */

const WHISPER_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';

const WHISPER_MODELS = [
  { id: 'tiny', bytes: 77691713, sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21', fa: 'سبک‌ترین — برای تست و ماشین‌های ضعیف؛ دقت کم' },
  { id: 'base', bytes: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', fa: 'سبک و سریع — دقت متوسط رو به کم' },
  { id: 'small', bytes: 487601967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', fa: 'سریع با دقت قابل قبول' },
  { id: 'medium', bytes: 1533763059, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208', fa: 'دقت خوب — تعادل بین سرعت و کیفیت' },
  { id: 'large-v1', bytes: 3094623691, sha256: '7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d', fa: 'نسخهٔ اول سری بزرگ' },
  { id: 'large-v2', bytes: 3094623691, sha256: '9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487', fa: 'دقت بالا — هنوز محبوب برای فارسی' },
  { id: 'large-v3', bytes: 3095033483, sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2', fa: 'دقیق‌ترین برای فارسی — پیش‌فرض استودیو' },
  { id: 'large-v3-turbo', bytes: 1624555275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69', fa: 'تقریباً هم‌سنگ large-v3 با سرعت دو برابر' },
  { id: 'tiny.en', bytes: 77704715, sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f', fa: 'فقط انگلیسی', enOnly: true },
  { id: 'base.en', bytes: 147964211, sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', fa: 'فقط انگلیسی', enOnly: true },
  { id: 'small.en', bytes: 487614201, sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d', fa: 'فقط انگلیسی', enOnly: true },
  { id: 'medium.en', bytes: 1533774781, sha256: 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356', fa: 'فقط انگلیسی', enOnly: true },
];

const TTS_MODELS = [
  {
    id: 'piper-fa-amir',
    bytes: 67180373,
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-fa_IR-amir-medium.tar.bz2',
    fa: 'صدای مردانهٔ فارسی (امیر) — طبیعی و سبک، برای گویندهٔ فیلم',
  },
  {
    id: 'piper-fa-gyro',
    bytes: 67183308,
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-fa_IR-gyro-medium.tar.bz2',
    fa: 'صدای دوم فارسی (گیرو) — برای تنوع گوینده',
  },
];

export const CATALOG = [
  ...WHISPER_MODELS.map((m) => ({ ...m, category: 'stt', kind: 'whisper' })),
  ...TTS_MODELS.map((m) => ({ ...m, category: 'tts', kind: 'piper' })),
];

const MODELS_DIR = path.join(WORKSPACE, '.studio', 'models');
const WHISPER_DIR = process.env.HYPERFRAMES_CACHE_DIR
  ? path.resolve(process.env.HYPERFRAMES_CACHE_DIR)
  : path.join(os.homedir(), '.cache', 'hyperframes');
const WHISPER_MODELS_DIR = path.join(WHISPER_DIR, 'whisper', 'models');
const LOG_DIR = path.join(WORKSPACE, '.studio', 'model-logs');
const STATE_FILE = path.join(MODELS_DIR, 'state.json');

const byId = (id) => CATALOG.find((m) => m.id === id) || null;

/** Live state: presence is the filesystem's truth, downloads are in-memory. */
const active = new Map(); // id -> { startedAt, expected }

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

const sttFile = (id) => path.join(WHISPER_MODELS_DIR, `ggml-${id}.bin`);
const ttsDir = (id) => path.join(MODELS_DIR, 'tts', id);
const ttsPart = (id) => path.join(MODELS_DIR, 'tts', `${id}.tar.bz2.part`);

function presentBytes(m) {
  if (m.kind === 'whisper') {
    const f = sttFile(m.id);
    return fs.existsSync(f) ? fs.statSync(f).size : 0;
  }
  const dir = ttsDir(m.id);
  if (fs.existsSync(path.join(dir, 'espeak-ng-data')) && fs.readdirSync(dir).some((f) => f.endsWith('.onnx'))) {
    const sum = (d) =>
      fs.readdirSync(d, { withFileTypes: true }).reduce(
        (n, e) => n + (e.isDirectory() ? sum(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size),
        0,
      );
    return sum(dir);
  }
  return 0;
}

export function listModels() {
  const state = readState();
  const cfg = readConfig();
  const catalog = CATALOG.map((m) => {
    const bytes = presentBytes(m);
    const dl = active.get(m.id);
    const partBytes = m.kind === 'piper' && fs.existsSync(ttsPart(m.id)) ? fs.statSync(ttsPart(m.id)).size : 0;
    return {
      id: m.id,
      category: m.category,
      kind: m.kind,
      fa: m.fa,
      enOnly: Boolean(m.enOnly),
      bytes: m.bytes,
      present: bytes > 0,
      onDiskBytes: bytes,
      default: m.kind === 'whisper' && (cfg.transcribe?.model || 'large-v3') === m.id,
      downloading: Boolean(dl),
      progress: dl && dl.expected ? Math.min(99, Math.round((partBytes / dl.expected) * 100)) : null,
      partBytes,
    };
  });
  return {
    catalog,
    defaultStt: cfg.transcribe?.model || 'large-v3',
    downloading: [...active.keys()],
    dirs: { stt: WHISPER_MODELS_DIR, tts: MODELS_DIR },
  };
}

const logFile = (id) => path.join(LOG_DIR, `${id}.log`);
const appendLog = (id, line) => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(logFile(id), `${new Date().toISOString()} ${line}\n`, 'utf8');
};

/**
 * Start a model download — only ever on explicit user action. Whisper models
 * go through scripts/fetch-models.mjs (checksum-verified, resumable); voice
 * bundles download as tar.bz2 and extract with the system tar.
 */
export function startDownload(id) {
  const m = byId(id);
  if (!m) return { started: false, reason: 'unknown-model' };
  if (active.has(id)) return { started: false, reason: 'already-downloading' };
  if (presentBytes(m) > 0) return { started: false, reason: 'already-present' };

  fs.mkdirSync(LOG_DIR, { recursive: true });
  appendLog(id, `download started (${m.kind})`);
  active.set(id, { startedAt: Date.now(), expected: m.bytes });

  let child;
  if (m.kind === 'whisper') {
    fs.mkdirSync(WHISPER_MODELS_DIR, { recursive: true });
    child = spawn(process.execPath, [path.join(STUDIO_ROOT, 'scripts', 'fetch-models.mjs'), '--model', m.id], {
      cwd: STUDIO_ROOT,
      detached: true,
      stdio: ['ignore', fs.openSync(logFile(id), 'a'), fs.openSync(logFile(id), 'a')],
    });
  } else {
    fs.mkdirSync(path.dirname(ttsPart(id)), { recursive: true });
    // the stubborn cross-platform downloader: resumes, retries, keeps progress
    child = spawn(
      process.execPath,
      [path.join(STUDIO_ROOT, 'scripts', 'download-model.mjs'), m.url, ttsPart(id).replace('.part', ''), String(m.bytes)],
      {
        cwd: STUDIO_ROOT,
        detached: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || '' },
        stdio: ['ignore', fs.openSync(logFile(id), 'a'), fs.openSync(logFile(id), 'a')],
      },
    );
  }
  child.unref();
  child.on('exit', (code) => finish(id, m, code));
  return { started: true, kind: m.kind };
}

function finish(id, m, code) {
  const dl = active.get(id);
  active.delete(id);
  try {
    if (code === 0 && m.kind === 'piper') {
      fs.mkdirSync(ttsDir(id), { recursive: true });
      // the bundle extracts as vits-piper-fa_IR-*/… — flatten it into tts/<id>/
      const tmp = `${ttsDir(id)}.extract`;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      fs.renameSync(ttsPart(id), `${ttsPart(id)}.done`);
execFileSync('tar', ['-xjf', `${ttsPart(id)}.done`, '-C', tmp]);
      const inner = fs.readdirSync(tmp).find((d) => fs.statSync(path.join(tmp, d)).isDirectory());
      fs.cpSync(inner ? path.join(tmp, inner) : tmp, ttsDir(id), { recursive: true });
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(`${ttsPart(id)}.done`, { force: true });
      appendLog(id, 'installed ✓');
    } else if (code === 0) {
      appendLog(id, `installed ✓ (${presentBytes(m)} bytes)`);
    } else {
      appendLog(id, `download exited ${code} — resume from the app's button (progress is kept)`);
    }
  } catch (err) {
    appendLog(id, `install error: ${err.message}`);
  }
  const state = readState();
  state[id] = { lastResult: code === 0 ? 'ok' : `exit-${code}`, at: new Date().toISOString() };
  writeState(state);
}

export function deleteModel(id) {
  const m = byId(id);
  if (!m) return { deleted: false, reason: 'unknown-model' };
  if (active.has(id)) return { deleted: false, reason: 'downloading' };
  const cfg = readConfig();
  if (m.kind === 'whisper' && (cfg.transcribe?.model || 'large-v3') === id)
    return { deleted: false, reason: 'is-default' };
  if (m.kind === 'whisper') {
    fs.rmSync(sttFile(id), { force: true });
  } else {
    fs.rmSync(ttsDir(id), { recursive: true, force: true });
    fs.rmSync(`${ttsPart(id)}.done`, { force: true });
    fs.rmSync(ttsPart(id), { force: true });
  }
  const state = readState();
  delete state[id];
  writeState(state);
  return { deleted: true, id };
}

/** A watcher tick: report live bytes for the models being downloaded. */
export function downloadProgress() {
  const out = {};
  for (const [id, dl] of active) {
    const m = byId(id);
    let sofar = 0;
    if (m.kind === 'whisper') {
      const part = `${sttFile(id)}.part`;
      sofar = fs.existsSync(part) ? fs.statSync(part).size : presentBytes(m);
    } else {
      sofar = fs.existsSync(ttsPart(id)) ? fs.statSync(ttsPart(id)).size : 0;
    }
    out[id] = { bytes: sofar, expected: dl.expected, pct: Math.min(99, Math.round((sofar / Math.max(1, dl.expected)) * 100)) };
  }
  return out;
}
