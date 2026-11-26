const { contextBridge, ipcRenderer } = require('electron');

// Bridge between the sandboxed renderer and the main process.
// The renderer code checks `window.live3d` to detect the desktop shell;
// in a plain browser (mobile web page, future roaming feature) it is absent
// and the platform adapter in src/platform.js degrades gracefully.
contextBridge.exposeInMainWorld('live3d', {
  isDesktop: true,
  listModels: () => ipcRenderer.invoke('models:list'),
  pickModel: () => ipcRenderer.invoke('models:pick'),
  // Window-relative bounding rect of the pet (or null); the main process
  // polls the cursor against it to toggle click-through.
  updateRegion: (region) => ipcRenderer.send('hit:updateRegion', region),
  showModelPicker: (x, y) => ipcRenderer.send('menu:modelPicker', x, y),
  reportCurrentModel: (modelPath) => ipcRenderer.send('models:current', modelPath),
  listAnimations: () => ipcRenderer.invoke('animations:list'),
  reportCurrentAnimation: (animPath) => ipcRenderer.send('animations:current', animPath),
  onAnimationChanged: (cb) => {
    ipcRenderer.on('animations:changed', (_event, entry) => cb(entry));
  },
  onFacingChanged: (cb) => {
    ipcRenderer.on('facing:set', (_event, deg) => cb(deg));
  },
  // One-shot clip chosen via the CLI channel (--play): play once, then the
  // idle loop resumes.
  onPlayOnce: (cb) => {
    ipcRenderer.on('animations:playOnce', (_event, entry) => cb(entry));
  },
  // Camera motion capture (webcam pose tracking drives the model).
  // Main process is the single source of truth for the REQUESTED state
  // (menu / CLI / badge all send requests); the renderer reports the ACTUAL
  // state back (camera start can fail).
  onMocapChanged: (cb) => {
    ipcRenderer.on('mocap:set', (_event, enabled) => cb(enabled));
  },
  onMocapMirror: (cb) => {
    ipcRenderer.on('mocap:mirror', (_event, on) => cb(on));
  },
  requestMocap: (enabled) => ipcRenderer.send('mocap:request', enabled),
  reportMocapState: (active) => ipcRenderer.send('mocap:state', active),
  // Renderer startup finished; the main process flushes queued CLI commands.
  ready: () => ipcRenderer.send('app:ready'),
  moveWindowBy: (dx, dy) => ipcRenderer.send('win:moveBy', dx, dy),
  onModelChanged: (cb) => {
    ipcRenderer.on('models:changed', (_event, entry) => cb(entry));
  },
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  toggleDevTools: () => ipcRenderer.send('app:toggleDevTools'),
  quit: () => ipcRenderer.send('app:quit'),
});
