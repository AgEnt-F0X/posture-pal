// Posture Pal — Electron desktop shell.
// Serves the web app on loopback (camera requires http), runs in the tray,
// keeps posture checks alive in the background, shows native notifications.

const { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.join(__dirname, 'web');
const ICON = path.join(__dirname, 'assets', 'icon.png');
const APP_ID = 'com.posturepal.desktop';

let win = null;
let tray = null;
let server = null;
let quitting = false;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

// The camera API needs a http(s) origin, so we serve the static files on
// 127.0.0.1 (loopback only — nothing outside this machine can reach it).
function startServer() {
  server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.normalize(path.join(WEB_ROOT, urlPath));
      if (!file.startsWith(WEB_ROOT)) { res.writeHead(403); res.end(); return; }
      if (urlPath === '/' || urlPath === '') file = path.join(WEB_ROOT, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    } catch {
      res.writeHead(400); res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    icon: ICON,
    title: 'Posture Pal',
    webPreferences: {
      // keep timers/rAF running while the window is hidden to the tray —
      // this is what makes background posture checks reliable
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
  // closing the window hides it to the tray; Quit lives in the tray menu
  win.on('close', e => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const img = nativeImage.createFromPath(ICON);
  tray = new Tray(img);
  tray.setToolTip('Posture Pal — posture coach');  const menu = Menu.buildFromTemplate([
    { label: 'Show Posture Pal', click: () => { win?.show(); win?.focus(); } },
    { type: 'separator' },
    {
      label: 'Run at Windows startup',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { quitting = true; app.quit(); },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { win?.show(); win?.focus(); });
}

// Toast notifications for a portable (non-installed) exe: Windows drops web
// toasts from apps without a Start Menu shortcut, so we show them as tray
// balloons — Windows 10/11 renders those as native toasts.
ipcMain.on('show-notification', (event, { title, body }) => {
  if (process.platform !== 'win32' || !tray) return;
  try {
    tray.displayBalloon({
      icon: nativeImage.createFromPath(ICON),
      title: title || 'Posture Pal',
      content: body || '',
    });
  } catch { /* balloon unavailable — silent */ }
});

// A Start Menu shortcut with our App User Model ID both enables standard web
// notifications as a fallback and gives the app a Start Menu entry.
function ensureStartMenuShortcut() {
  if (!app.isPackaged) return;
  try {
    const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const link = path.join(programs, 'Posture Pal.lnk');
    if (!fs.existsSync(link)) {
      shell.writeShortcutLink(link, 'create', {
        target: process.execPath,
        cwd: path.dirname(process.execPath),
        description: 'Posture Pal — webcam posture coach',
        appId: APP_ID,
      });
    }
  } catch { /* cosmetic only */ }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID); // needed for native notifications on Windows
    // allow the camera and the notification permission prompts (the default
    // handler would deny notifications and silently kill background popups)
    const allowed = p => p === 'media' || p === 'notifications';
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed(permission));

    ensureStartMenuShortcut();
    const port = await startServer();
    createWindow(port);
    createTray();

    if (process.argv.includes('--smoke')) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          console.log('SMOKE OK — page loaded');
          win.webContents.executeJavaScript(
            "window.posturepalDesktop ? window.posturepalDesktop.notify('Smoke', 'balloon test') : 'NO BRIDGE'",
          ).then(r => { if (r === 'NO BRIDGE') console.log('IPC BRIDGE MISSING'); });
          setTimeout(() => { quitting = true; app.quit(); }, 1500);
        }, 1500);
      });
    }
  });

  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('before-quit', () => { quitting = true; });
}
