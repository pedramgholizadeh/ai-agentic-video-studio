/*
 * main.cjs — the desktop shell around the studio.
 *
 * The studio is already a local web app: server.mjs serves the panel and the
 * engine on 127.0.0.1. This shell runs that same server as a Node child (the
 * Electron binary itself, in RUN_AS_NODE mode — no separate runtime needed),
 * points a BrowserWindow at it, and adds the desktop chrome: a real About
 * panel, a native menu, and self-updating from GitHub Releases.
 *
 * Bundled so a fresh machine needs nothing installed:
 *   - node (npm/npx included) in resources/node
 *   - ffmpeg + ffprobe in resources/bin
 * Everything that arrives on first use (HyperFrames, its Chrome, the whisper
 * runtime, models) downloads into the user's cache — the panel shows progress.
 */
const DBG = (t) => { try { require('node:fs').appendFileSync('/tmp/vs-boot-debug.log', t + '\n'); } catch {} };
DBG('M0 top');
const { app, BrowserWindow, Menu, dialog, shell, nativeTheme, ipcMain } = require('electron');
DBG('M1 electron required');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
DBG('M2 before updater');
const { autoUpdater } = require('electron-updater');
const { pathToFileURL } = require('node:url');
DBG('M3 updater required');

/* isPackaged lies in a hand-assembled bundle (the executable is still named
 * Electron), so "dev" is detected by the engine's own presence instead. */
const isDev = !fs.existsSync(path.resolve(__dirname, '..', 'studio', 'server.mjs'));
const resources = isDev ? path.resolve(__dirname, '..') : path.dirname(__dirname);
const STUDIO_DIR = isDev ? path.resolve(__dirname, '..') : path.join(resources, 'studio');
const BIN_DIR = path.join(resources, 'bin');
const NODE_DIR = path.join(resources, 'node');
const NODE_BIN_DIR = path.join(NODE_DIR, process.platform === 'win32' ? '' : 'bin');
const LOG_DIR = isDev ? path.join(STUDIO_DIR, 'workspace', '.studio') : path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
/* All user data (jobs, renders, models, config) lives OUTSIDE the app bundle:
 * a packaged app's Resources directory can be read-only (App Translocation)
 * and is wiped by every update. */
const USER_WORKSPACE = path.join(app.getPath('userData'), 'workspace');

/** boot.log — one line per milestone, so a stalled boot tells us where. */
function bootLog(line) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'boot.log'), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
}

/** Read the tail of the server log so an error dialog can show real evidence. */
function serverLogTail(chars = 1200) {
  try {
    const s = fs.readFileSync(LOG_FILE, 'utf8');
    return s.length > chars ? '…' + s.slice(-chars) : s;
  } catch {
    return '(لاگ هنوز نوشته نشده)';
  }
}

/** A free loopback port, preferring the studio's own 8790. */
async function pickPort() {
  const probe = (port) =>
    new Promise((free) => {
      const s = http.createServer();
      s.once('error', () => free(false));
      s.once('listening', () => s.close(() => free(true)));
      s.listen(port, '127.0.0.1');
    });
  if (await probe(8790)) return 8790;
  for (let p = 8791; p <= 8799; p++) if (await probe(p)) return p;
  throw new Error('هیچ پورتی از ۸۷۹۰ تا ۸۷۹۹ آزاد نیست.');
}

function waitHealthy(port, tries = 120) {
  const url = `http://127.0.0.1:${port}/api/config`;
  return new Promise((resolve, reject) => {
    let left = tries;
    const schedule = () => {
      if (left-- <= 0) return reject(new Error('server never became healthy'));
      setTimeout(attempt, 500);
    };
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : schedule();
      });
      req.on('error', schedule);
    };
    attempt();
  });
}

let mainWindow = null;

/** Kill the server AND its whole process tree — renders and ffmpeg children
 * must never outlive the app. POSIX: a detached process group; Windows: taskkill /T. */
function killServer() {
  try { globalThis.__studioCancelAll?.(); } catch {}
  server = null;
}

/** The engine runs IN this process: one require, no child, no env juggling.
 * Renders still run as their own children and are killed on quit. */
async function startEngine(port) {
  process.env.PORT = String(port);
  process.env.VIDEO_STUDIO_APP_VERSION = app.getVersion();
  process.env.VIDEO_STUDIO_HOME = USER_WORKSPACE;
  const url = pathToFileURL(path.join(STUDIO_DIR, 'server.mjs')).href;
  DBG('M8.5 importing engine: ' + url);
  try {
    await import(url);
    DBG('M8.6 engine imported');
    bootLog(`engine started in-process on ${port}`);
  } catch (err) {
    DBG('ENGINE IMPORT FAILED: ' + String(err.stack || err).slice(0, 1200));
    throw err;
  }
}

function relaunch() {
  killServer();
  app.relaunch();
  app.exit(0);
}

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status);
}

function wireUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ status: 'checking' }));
  autoUpdater.on('update-available', (i) => sendUpdateStatus({ status: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ status: 'not-available' }));
  autoUpdater.on('error', (err) => sendUpdateStatus({ status: 'error', message: String(err.message || err).slice(0, 200) }));
  autoUpdater.on('update-downloaded', (i) => {
    sendUpdateStatus({ status: 'downloaded', version: i.version });
    dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
      type: 'info',
      title: 'به‌روزرسانی آماده است',
      message: `نسخهٔ ${i.version} دانلود شد.`,
      detail: 'با بستن برنامه نصب می‌شود؛ یا همین حالا نصب و راه‌اندازی دوباره کن.',
      buttons: ['نصب و راه‌اندازی دوباره', 'بعداً'],
      defaultId: 0,
    }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  });
  // quiet checks at boot and every six hours
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

function buildMenu() {
  const template = [
    {
      label: 'استودیو ویدیو',
      submenu: [
        { role: 'about', label: 'دربارهٔ استودیوی ادیت ویدیو با هوش مصنوعی' },
        { type: 'separator' },
        {
          label: 'بررسی به‌روزرسانی…',
          click: () => { autoUpdater.checkForUpdates().catch((e) => sendUpdateStatus({ status: 'error', message: String(e.message || e) })); },
        },
        { type: 'separator' },
        { role: 'hide', label: 'پنهان' },
        { role: 'quit', label: 'خروج' },
      ],
    },
    { label: 'ویرایش', submenu: [
      { role: 'undo', label: 'بازگردانی' }, { role: 'redo', label: 'انجام دوباره' }, { type: 'separator' },
      { role: 'cut', label: 'برش' }, { role: 'copy', label: 'کپی' }, { role: 'paste', label: 'چسباندن' },
      { role: 'selectAll', label: 'انتخاب همه' },
    ] },
    { label: 'نمایش', submenu: [
      { role: 'reload', label: 'بارگذاری دوباره' }, { role: 'toggleDevTools', label: 'ابزار توسعه (بتا)' },
      { type: 'separator' }, { role: 'resetZoom', label: 'اندازهٔ اصلی' }, { role: 'zoomIn', label: 'بزرگ‌تر' },
      { role: 'zoomOut', label: 'کوچک‌تر' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'تمام‌صفحه' },
    ] },
    { label: 'پنجره', submenu: [{ role: 'minimize', label: 'کوچک' }, { role: 'zoom', label: 'بزرگ' }, { role: 'close', label: 'بستن' }] },
    { role: 'help', submenu: [
      { label: 'راهنمای ریپو در گیت‌هاب', click: () => shell.openExternal('https://github.com/pedramgholizadeh/ai-agentic-video-studio') },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(port) {
  nativeTheme.themeSource = 'dark';
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#101111',
    title: 'استودیوی ادیت ویدیو با هوش مصنوعی — Video Studio',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); // external links open in the real browser
    return { action: 'deny' };
  });
  // a crashed renderer should never strand the user on a white screen
  mainWindow.webContents.on('render-process-gone', () => {
    dialog.showMessageBox({
      type: 'error',
      title: 'پنل ری‌استارت می‌شود',
      message: 'نمایشگر پنل خطا داد — دوباره بارگذاری می‌شود.',
      buttons: ['باشه'],
    }).catch(() => {});
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

DBG('M4 before lock');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    DBG('M5 ready');
    bootLog('electron ready');
    // the panel's update button works everywhere; the updater itself only in packaged builds
    ipcMain.handle('update:check', async () => {
      if (isDev) throw new Error('در حالت توسعه، به‌روزرسان غیرفعال است — بیلد منتشرشده را امتحان کن.');
      const r = await autoUpdater.checkForUpdates();
      return { version: r?.updateInfo?.version || null };
    });
    ipcMain.on('update:install', () => { if (!isDev) autoUpdater.quitAndInstall(); });
    app.setAboutPanelOptions({
      applicationName: 'استودیوی ادیت ویدیو با هوش مصنوعی — AI Video Editing Studio',
      applicationVersion: app.getVersion(),
      version: 'engine 2.0.0 · HyperFrames',
      credits:
        'استودیوی ادیت ویدیو با هوش مصنوعی\nAI Video Editing Studio\n\nساختهٔ پدرام قلی‌زاده — طراح و توسعه‌دهنده.\nBuilt by Pedram Gholizadeh — design & development.\n\nدو فایل بده، یه تدوین بگیر.\nTwo files in, one edit out.',
      authors: ['Pedram Gholizadeh'],
      website: 'https://github.com/pedramgholizadeh/ai-agentic-video-studio',
    });
    buildMenu();
    try {
      DBG('M6 port picking');
      const port = await pickPort();
      DBG('M7 port picked: ' + port);
      bootLog(`port ${port} picked`);
      await startEngine(port);
      await waitHealthy(port);
      DBG('M9 healthy');
      bootLog('engine healthy');
      createWindow(port);
      bootLog('window created');
      if (!isDev) wireUpdater();
    } catch (err) {
      bootLog(`BOOT FAILED: ${String(err.stack || err.message || err).slice(0, 1500)}`);
      // the dialog must carry the real evidence: the stack plus the server's own log
      dialog.showMessageBox({
        type: 'error',
        title: 'موتور استودیو بالا نیامد',
        message: 'موتور استودیو شروع نشد.',
        detail:
          `${String(err.message || err)}\n\n— stack —\n${String(err.stack || '').slice(0, 1400)}` +
          `\n\n— server log (tail) —\n${serverLogTail(800)}\n\n— فایل لاگ:\n${LOG_FILE}`,
        buttons: ['بستن'],
      });
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    app.isQuitting = true;
    app.quit(); // one window, one studio — closing it closes the engine too
  });
  app.on('before-quit', () => {
    app.isQuitting = true;
    killServer();
  });
}
