const { app, BrowserWindow, ipcMain, dialog, screen, protocol, net, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createTray } = require('./tray');
const { APP_VERSION } = require('./version');

const MODELS_DIR = path.join(__dirname, '..', 'models');
const ANIM_DIR = path.join(__dirname, '..', 'animations');

// Shared log file (also written from createWindow's console-message hook).
const LOG_FILE = path.join(__dirname, '..', 'ai-live3d.log');
const appendLog = (line) => {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // logging must never break the app
  }
};
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
let currentAnimationPath = null;

/** Switch the active model and remember it (right-click menu shows a checkmark). */
function setModel(entry) {
  currentModelPath = entry.path;
  if (win) win.webContents.send('models:changed', entry);
}

/** Switch the active idle animation (null = hand-written idle pose). */
function setAnimation(entry) {
  currentAnimationPath = entry ? entry.path : null;
  if (win) win.webContents.send('animations:changed', entry ?? null);
}

/** Command the pet to turn (degrees, 0 = front). */
function setFacing(deg) {
  if (win) win.webContents.send('facing:set', deg);
}

function listAnimations() {
  try {
    return fs
      .readdirSync(ANIM_DIR)
      .filter((f) => /\.vrma$/i.test(f))
      .map((f) => toModelEntry(path.join(ANIM_DIR, f)));
  } catch {
    return [];
  }
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

  // Renderer logs land in a file so failures are diagnosable no matter how
  // the app was started (double-clicked bat has no visible stdout).
  win.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
    appendLog(`[renderer] ${message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    appendLog(`[render-process-gone] ${JSON.stringify(details)}`);
  });
  win.webContents.on('unresponsive', () => {
    appendLog('[unresponsive] renderer became unresponsive');
  });
  win.on('closed', () => {
    win = null;
  });
}

function registerIpc() {
  ipcMain.handle('models:list', () => listModels());
  ipcMain.handle('animations:list', () => listAnimations());

  ipcMain.on('animations:current', (_event, animPath) => {
    currentAnimationPath = animPath;
  });

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

    // Animation section (VRMA clips; "(None)" = hand-written idle pose).
    // 100+ files are grouped into submenus so the popup stays usable.
    template.push({ label: 'Animation', enabled: false });
    template.push({
      label: '(None)',
      type: 'checkbox',
      checked: currentAnimationPath === null,
      click: () => setAnimation(null),
    });

    const prettyName = (p) =>
      path.basename(p).replace(/\.vrma$/i, '').replace(/[_-]+/g, ' ').trim();
    const groups = { Actions: [], Dances: [], 'Idle & Sit': [], 'Emotions & Others': [] };
    for (const a of listAnimations()) {
      const name = path.basename(a.path).toLowerCase();
      if (name.startsWith('action_')) groups.Actions.push(a);
      else if (name.startsWith('dance_')) groups.Dances.push(a);
      else if (name.startsWith('sit_') || name.startsWith('idle')) groups['Idle & Sit'].push(a);
      else groups['Emotions & Others'].push(a);
    }
    for (const [label, entries] of Object.entries(groups)) {
      if (entries.length === 0) continue;
      template.push({
        label: `${label} (${entries.length})`,
        submenu: entries.map((a) => ({
          label: prettyName(a.path),
          type: 'checkbox',
          checked: a.path === currentAnimationPath,
          click: () => setAnimation(a),
        })),
      });
    }
    template.push({ type: 'separator' });

    // Turntable facing (scroll wheel also steps these).
    template.push({ label: 'Facing', enabled: false });
    for (const [label, deg] of [
      ['Front', 0],
      ['Three-quarter', 45],
      ['Side', 90],
      ['Back three-quarter', 135],
      ['Back', 180],
    ]) {
      template.push({ label, click: () => setFacing(deg) });
    }
    template.push({ type: 'separator' });

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

  // Renderer finished startup (IPC listeners registered): deliver any CLI
  // commands that arrived before it was ready.
  ipcMain.on('app:ready', () => {
    rendererReady = true;
    while (queuedCli.length > 0) sendCliToRenderer(queuedCli.shift());
  });
}

// --- external control channel ---------------------------------------------
// The app is single-instance: launching `electron . <args>` again while it is
// running delivers argv through the 'second-instance' event. We reuse that as
// a remote-control channel for start-pet.bat / the Claude Code skill:
//   --show | --hide | --quit | --devtools
//   --model <name-or-path>     switch model (name matched inside models/)
//   --animation <name|none>    switch idle animation ("none" = hand-written)
//   --play <name>              play a clip from animations/ once, then idle
//   --facing <deg>             turn the pet (0 = front, 180 = back)
const PLAY_ALIASES = {
  poke: 'surprise',
  poked: 'surprise',
  surprise: 'surprise',
  startled: 'surprise',
  hello: 'hello',
  hi: 'hello',
  wave: 'hello',
  happy: 'hello',
  cheer: 'hello',
  greet: 'hello',
  greeting: 'hello',
};

// Match a user-typed name against a directory listing: basename without
// extension, case-insensitive; exact match wins, first substring match next.
function resolveEntry(list, name) {
  const q = String(name).toLowerCase().replace(/\.(vrm|glb|vrma)$/i, '');
  let partial = null;
  for (const e of list) {
    const base = path.basename(e.path).toLowerCase().replace(/\.(vrm|glb|vrma)$/i, '');
    if (base === q) return e;
    if (!partial && q && base.includes(q)) partial = e;
  }
  return partial;
}

// Chromium re-serializes the command line of relaunched processes (the scheme
// switches from registerSchemesAsPrivileged force a re-exec), demoting switch
// VALUES to positional args and inserting its own switches:
//   [exe, --play, --allow-file-access-from-files, --secure-scheme=..., ., surprise]
// So parsing is reorder-tolerant: unknown "--switches" are skipped as noise,
// the exe/app path is skipped, and orphan positional values are handed to
// value-expecting flags in FIFO order (chromium preserves relative order on
// both sides, so the pairing reconstructs exactly).
function parseCliArgs(argv) {
  const cmds = {
    model: null,
    animation: undefined,
    play: null,
    facing: null,
    hide: false,
    devtools: false,
    quit: false,
  };
  const appRoot = path.resolve(__dirname, '..');
  const waiting = []; // value-expecting flags still needing their argument
  const boolFlags = {
    '--hide': 'hide',
    '--devtools': 'devtools',
    '--quit': 'quit',
    '--exit': 'quit',
  };
  const valueFlags = {
    '--model': 'model',
    '--animation': 'animation',
    '--idle': 'animation',
    '--play': 'play',
    '--reaction': 'play',
    '--facing': 'facing',
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (i === 0 || tok === '.' || (path.isAbsolute(tok) && tok.toLowerCase() === appRoot.toLowerCase())) {
      continue; // electron exe / app directory positional
    }
    if (boolFlags[tok]) {
      cmds[boolFlags[tok]] = true;
      continue;
    }
    if (valueFlags[tok]) {
      waiting.push(valueFlags[tok]);
      continue;
    }
    if (tok.startsWith('--') || tok.startsWith('-')) {
      continue; // chromium noise (--secure-scheme=..., --allow-file-...)
    }
    // Positional value: assign to the oldest flag still waiting for one.
    const slot = waiting.shift();
    if (slot) cmds[slot] = tok;
  }
  if (cmds.facing != null) cmds.facing = Number(cmds.facing);
  return cmds;
}

let rendererReady = false;
const queuedCli = [];

function dispatchCli(argv, source) {
  const cmds = parseCliArgs(argv);
  appendLog(`[cmd] ${source} raw argv: ${JSON.stringify(argv)}`);
  appendLog(`[cmd] ${source}: ${JSON.stringify(cmds)}`);
  if (cmds.quit) {
    app.quit();
    return;
  }
  if (cmds.devtools) win?.webContents.toggleDevTools();
  // Any invocation shows the pet (legacy double-click-bat behavior); only an
  // explicit --hide keeps it hidden. Focus only for plain no-command wakes.
  const hasCmds =
    cmds.model != null ||
    cmds.animation !== undefined ||
    cmds.play != null ||
    cmds.facing != null ||
    cmds.devtools ||
    cmds.hide;
  if (cmds.hide) win?.hide();
  else {
    win?.show();
    if (!hasCmds) win?.focus();
  }
  // Model/animation/play/facing reach the renderer via IPC; queue them until
  // it has registered its listeners (first launch races renderer startup).
  if (!rendererReady) {
    queuedCli.push(cmds);
    return;
  }
  sendCliToRenderer(cmds);
}

function sendCliToRenderer(cmds) {
  if (cmds.model != null) {
    const entry =
      path.isAbsolute(cmds.model) && fs.existsSync(cmds.model)
        ? toModelEntry(path.resolve(cmds.model))
        : resolveEntry(listModels(), cmds.model);
    if (entry) setModel(entry);
    else appendLog(`[cmd] model not found: ${cmds.model}`);
  }
  if (cmds.animation !== undefined) {
    if (/^(none|null|off|-)$/i.test(cmds.animation)) {
      setAnimation(null);
    } else {
      const entry = resolveEntry(listAnimations(), cmds.animation);
      if (entry) setAnimation(entry);
      else appendLog(`[cmd] animation not found: ${cmds.animation}`);
    }
  }
  if (Number.isFinite(cmds.facing)) setFacing(cmds.facing);
  if (cmds.play != null) {
    const alias = PLAY_ALIASES[String(cmds.play).toLowerCase()];
    const entry = resolveEntry(listAnimations(), alias ?? cmds.play);
    if (entry) win?.webContents.send('animations:playOnce', entry);
    else appendLog(`[cmd] play: animation not found: ${cmds.play}`);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    dispatchCli(argv, 'second-instance');
  });

  app.whenReady().then(() => {
    protocol.handle(MODEL_SCHEME, (request) => {
      const absPath = decodeURIComponent(request.url.slice(`${MODEL_SCHEME}://`.length));
      return net.fetch(pathToFileURL(absPath).toString());
    });

    registerIpc();
    createWindow();
    startCursorPoll();
    // Command-line args of THIS (first) instance, e.g. a cold
    // `start-pet.bat --play hello` launch; queued until the renderer is ready.
    dispatchCli(process.argv, 'launch');

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
