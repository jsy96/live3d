const { app, BrowserWindow, ipcMain, dialog, screen, protocol, net, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createTray } = require('./tray');
const { APP_VERSION } = require('./version');

const MODELS_DIR = path.join(__dirname, '..', 'models');
// Custom protocol to serve model files: renderer fetch() cannot read file:// URLs.
const MODEL_SCHEME = 'live3d-model';

protocol.registerSchemesAsPrivileged([
  {
    scheme: MODEL_SCHEME,
    privileges: { secure: true, supportFetchAPI: true, stream: true },
  },
]);

function toModelEntry(absPath) {
  return { path: absPath, url: `${MODEL_SCHEME}://${encodeURIComponent(absPath)}` };
}

function listModels() {
  try {
    return fs
      .readdirSync(MODELS_DIR)
      .filter((f) => /\.(vrm|glb)$/i.test(f))
      .map((f) => toModelEntry(path.join(MODELS_DIR, f)));
  } catch {
    return [];
  }
}

// Click-through is decided HERE, not in the renderer: the main process polls
// the cursor position against the model's on-screen bounding rect reported
// via 'hit:updateRegion'. (forward:true mousemove forwarding is unreliable
// for transparent windows on some Windows builds — clicks were being lost.)
let petRegion = null; // {x, y, w, h} in window-relative CSS px, or null
let clickThrough = true;

function setClickThrough(v) {
  if (clickThrough === v) return;
  clickThrough = v;
  if (win) win.setIgnoreMouseEvents(v);
}

function startCursorPoll() {
  setInterval(() => {
    if (!win) return;
    if (!petRegion) {
      setClickThrough(true);
      return;
    }
    const p = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition(); // DIP, same units as renderer CSS px
    const inside =
      p.x >= wx + petRegion.x &&
      p.x <= wx + petRegion.x + petRegion.w &&
      p.y >= wy + petRegion.y &&
      p.y <= wy + petRegion.y + petRegion.h;
    setClickThrough(!inside);
  }, 40);
}

let win = null;
let currentModelPath = null;

/** Switch the active model and remember it (right-click menu shows a checkmark). */
function setModel(entry) {
  currentModelPath = entry.path;
  if (win) win.webContents.send('models:changed', entry);
}

function pickModelDialog() {
  return dialog.showOpenDialog(win, {
    title: 'Select a VRM model',
    defaultPath: MODELS_DIR,
    filters: [{ name: 'VRM / GLB model', extensions: ['vrm', 'glb'] }],
    properties: ['openFile'],
  });
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 380;
  const height = 600;

  win = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 40,
    y: workArea.y + workArea.height - height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Keep the pet alive (breathing / blinking) even when the window has no focus.
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  // Click-through by default; startCursorPoll() flips it based on cursor pos.
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  win.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
  });
  win.on('closed', () => {
    win = null;
  });
}

function registerIpc() {
  ipcMain.handle('models:list', () => listModels());

  ipcMain.handle('models:pick', async () => {
    if (!win) return null;
    const result = await pickModelDialog();
    return result.canceled ? null : toModelEntry(result.filePaths[0]);
  });

  ipcMain.on('hit:updateRegion', (_event, region) => {
    petRegion = region;
    if (!region) setClickThrough(true);
  });

  ipcMain.on('win:moveBy', (_event, dx, dy) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + Math.round(dx), y + Math.round(dy));
  });

  ipcMain.handle('app:version', () => APP_VERSION);
  ipcMain.on('app:toggleDevTools', () => win?.webContents.toggleDevTools());
  ipcMain.on('app:quit', () => app.quit());

  // Renderer reports which model it actually loaded (start-up picks models[0]).
  ipcMain.on('models:current', (_event, modelPath) => {
    currentModelPath = modelPath;
  });

  // Right-click on the pet / panel -> native model picker menu at that point.
  ipcMain.on('menu:modelPicker', (_event, x, y) => {
    if (!win) return;
    const template = listModels().map((m) => ({
      label: path.basename(m.path).replace(/\.(vrm|glb)$/i, ''),
      type: 'checkbox',
      checked: m.path === currentModelPath,
      click: () => setModel(m),
    }));
    if (template.length > 0) template.push({ type: 'separator' });
    template.push({
      label: 'Open file...',
      click: async () => {
        if (!win) return;
        const result = await pickModelDialog();
        if (!result.canceled) setModel(toModelEntry(result.filePaths[0]));
      },
    });
    Menu.buildFromTemplate(template).popup({
      window: win,
      x: Math.round(x),
      y: Math.round(y),
    });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle(MODEL_SCHEME, (request) => {
      const absPath = decodeURIComponent(request.url.slice(`${MODEL_SCHEME}://`.length));
      return net.fetch(pathToFileURL(absPath).toString());
    });

    registerIpc();
    createWindow();
    startCursorPoll();

    createTray(
      () => win,
      async () => {
        if (!win) return;
        const result = await pickModelDialog();
        if (!result.canceled) setModel(toModelEntry(result.filePaths[0]));
      }
    );
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
