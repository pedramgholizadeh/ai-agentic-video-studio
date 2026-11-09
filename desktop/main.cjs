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
const { app, BrowserWindow, Menu, dialog, shell, nativeTheme, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
const resources = isDev ? __dirname : process.resourcesPath;
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
    const attempt = (n) => {
      const req = http.get(url, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : retry(n);
      });
      req.on('error', () => retry(n));
      const retry = (n) => (n > 0 ? setTimeout(() => attempt(n - 1), 500) : reject(new Error('server never became healthy')));
      attempt(tries);
    };
    attempt(tries);
  });
}

let server = null;
let mainWindow = null;

/** Kill the server AND its whole process tree — renders and ffmpeg children
 * must never outlive the app. POSIX: a detached process group; Windows: taskkill /T. */
function killServer() {
  if (!server) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
      setTimeout(() => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} }, 1500);
    }
  } catch {}
  server = null;
}

function startServer(port) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.openSync(LOG_FILE, 'a');
  fs.writeSync(log, `\n=== ${new Date().toISOString()} — studio boot (app ${app.getVersion()}) ===\n`);
  // the Electron binary runs plain-Node when ELECTRON_RUN_AS_NODE is set —
  // the studio needs nothing but itself
  server = spawn(process.execPath, [path.join(STUDIO_DIR, 'server.mjs')], {
    detached: process.platform !== 'win32', // its own process group, so the tree dies with the app
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      VIDEO_STUDIO_APP_VERSION: app.getVersion(),
      // user data out of the app bundle: writable, survives updates
      VIDEO_STUDIO_HOME: USER_WORKSPACE,
      PATH: [BIN_DIR, NODE_BIN_DIR, NODE_DIR, process.env.PATH].filter(Boolean).join(path.delimiter),
    },
    stdio: ['ignore', log, log],
  });
  server.on('exit', (code) => {
    server = null;
    if (!app.isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'موتور استودیو خاموش شد',
        message: 'موتور استودیو به‌طور غیرمنتظره بسته شد.',
        detail: `کد خروج: ${code ?? '—'}\nلاگ کامل:\n${LOG_FILE}`,
        buttons: ['راه‌اندازی دوباره', 'بستن'],
        defaultId: 0,
      }).then(({ response }) => (response === 0 ? relaunch() : app.quit()));
    }
  });
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
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
      const port = await pickPort();
      startServer(port);
      await waitHealthy(port);
      createWindow(port);
      if (!isDev) wireUpdater();
    } catch (err) {
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
    if (server) { try { server.kill(); } catch {} }
  });
}
