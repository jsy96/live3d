// Platform adapter.
// The same renderer bundle runs in two places:
//   - Electron desktop pet: `window.live3d` bridge is injected by main/preload.js
//   - Plain browser (mobile web page on the LAN host): no bridge; listings come
//     from the HTTP API and live sync rides the roaming WebSocket.
const bridge = typeof window !== 'undefined' ? window.live3d : undefined;
// CDN mode (assets on Tencent CloudBase; set by cdn-config.js on the staged
// page): listings come from assets.json and the live PC address is discovered
// via the pet-hub cloud function.
const CDN = typeof window !== 'undefined' ? window.__LIVE3D_CDN__ : undefined;

import { RoamingClient, ROAMING_EVENTS } from './sync/roaming.js';

// LAN web mode (phone browser): listings come from the desktop host's HTTP API
// (main/lan.js). In a plain local page (file:// or offline) fetch fails and we
// degrade to an empty list — the file-picker setup panel still works there.
// CDN mode falls back to the static assets.json catalog shipped with the page.
const cdnJson = { loaded: null };
async function getCdnJson() {
  if (!cdnJson.loaded) {
    try {
      const r = await fetch('/assets.json');
      cdnJson.loaded = r.ok ? await r.json() : {};
    } catch {
      cdnJson.loaded = {};
    }
  }
  return cdnJson.loaded;
}

async function webList(endpoint) {
  try {
    const r = await fetch(endpoint);
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* fall through to the CDN catalog */
  }
  if (CDN) {
    const key = endpoint === '/api/models' ? 'models' : 'animations';
    const j = await getCdnJson();
    return Array.isArray(j[key]) ? j[key] : [];
  }
  return [];
}

// Lazy WebSocket link to the desktop host (web mode only). Created when the
// first subscriber registers; multiplexes 'state'/'play'/'roam' messages onto
// the on*Changed callbacks below. In CDN mode the live PC address is asked
// from the pet-hub cloud function first (tunnel URL, else LAN candidates).
let webSync = null;
async function webWsUrl() {
  const hub = CDN?.hubUrl;
  if (hub) {
    try {
      const r = await fetch(hub, { signal: AbortSignal.timeout(3000) });
      const j = await r.json();
      const base = j.tunnelUrl || (Array.isArray(j.lanUrls) && j.lanUrls[0]);
      if (base) return `${base.replace(/^http/, 'ws')}/ws`;
    } catch {
      /* hub unreachable: standalone mode, try same-origin */
    }
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function ensureWebSync() {
  if (webSync) return webSync;
  const client = new RoamingClient();
  const cbs = { model: [], animation: [], facing: [], play: [], roam: [] };
  client._cbs = cbs;
  client.on(ROAMING_EVENTS.STATE, (msg) => {
    if (msg.model) for (const cb of cbs.model) cb(msg.model);
    if (msg.animation !== undefined) for (const cb of cbs.animation) cb(msg.animation);
    if (typeof msg.facing === 'number') for (const cb of cbs.facing) cb(msg.facing);
  });
  client.on(ROAMING_EVENTS.PLAY, (msg) => {
    if (msg.entry) for (const cb of cbs.play) cb(msg.entry);
  });
  client.on(ROAMING_EVENTS.ROAM, (msg) => {
    for (const cb of cbs.roam) cb(msg.cmd);
  });
  webWsUrl().then((url) => client.connect(url)); // reconnects on its own
  webSync = client;
  return client;
}

export const platform = {
  isDesktop: !!bridge,

  async listModels() {
    if (bridge) return bridge.listModels();
    return webList('/api/models');
  },

  async pickModel() {
    if (bridge) return bridge.pickModel();
    return null;
  },

  async loadModelBlob() {
    if (bridge) return null;
    // Browser fallback: file picker via <input type="file"> is handled by the UI layer.
    return null;
  },

  // Window-relative bounding rect of the interactive area (pet model or
  // setup panel), or null. Main process polls the cursor against it to
  // toggle click-through; no-op in the browser.
  updateRegion(region) {
    if (bridge) bridge.updateRegion(region);
  },

  // Desktop: dragging the pet body moves the whole window.
  // Browser: no-op (the model itself is dragged inside the viewport instead).
  moveWindowBy(dx, dy) {
    if (bridge) bridge.moveWindowBy(dx, dy);
  },

  // Desktop: tray/menu picker events. Web: the same events arrive over the
  // roaming WebSocket (desktop switches model -> every phone follows).
  onModelChanged(cb) {
    if (bridge) bridge.onModelChanged(cb);
    else ensureWebSync()._cbs.model.push(cb);
  },

  // Desktop only: right-click -> native model picker popup at that point.
  showModelPicker(x, y) {
    if (bridge) bridge.showModelPicker(x, y);
  },

  // Report the actually-loaded model path so the picker can checkmark it.
  reportCurrentModel(modelPath) {
    if (bridge) bridge.reportCurrentModel(modelPath);
  },

  // Idle animation (VRMA) handling; browser mode fetches the LAN host's list.
  async listAnimations() {
    if (bridge) return bridge.listAnimations();
    return webList('/api/animations');
  },
  reportCurrentAnimation(animPath) {
    if (bridge) bridge.reportCurrentAnimation(animPath);
  },
  onAnimationChanged(cb) {
    if (bridge) bridge.onAnimationChanged(cb);
    else ensureWebSync()._cbs.animation.push(cb);
  },
  onFacingChanged(cb) {
    if (bridge) bridge.onFacingChanged(cb);
    else ensureWebSync()._cbs.facing.push(cb);
  },

  // Desktop: one-shot clip from the CLI channel (--play). Web: same broadcast.
  onPlayOnce(cb) {
    if (bridge) bridge.onPlayOnce(cb);
    else ensureWebSync()._cbs.play.push(cb);
  },

  // Roaming hand-off commands ('exit' = run off screen, 'enter' = run in).
  onRoam(cb) {
    if (bridge) bridge.onRoam(cb);
    else ensureWebSync()._cbs.roam.push(cb);
  },

  // Desktop renderer finished its exit animation; the main process hides the
  // window and tells the phones to play their enter animation.
  roamExited() {
    if (bridge) bridge.roamExited();
  },

  // Web (phone) -> desktop: apply a selection made in the phone picker.
  setModelRemote(name) {
    if (!bridge) ensureWebSync().send(ROAMING_EVENTS.PICK, { what: 'model', value: name });
  },
  setAnimationRemote(name) {
    if (!bridge) ensureWebSync().send(ROAMING_EVENTS.PICK, { what: 'animation', value: name });
  },
  setFacingRemote(deg) {
    if (!bridge) ensureWebSync().send(ROAMING_EVENTS.PICK, { what: 'facing', value: deg });
  },

  // Either side: hand the pet to the other device ('phone' | 'desktop').
  roamTo(target) {
    if (bridge) return false;
    ensureWebSync().send(ROAMING_EVENTS.PICK, { what: 'roam', value: target });
    return true;
  },

  // Desktop renderer: wheel-turn facing should sync to phones.
  reportFacing(deg) {
    if (bridge) bridge.reportFacing(deg);
  },

  // Renderer startup finished; lets the main process flush queued CLI commands.
  ready() {
    if (bridge) bridge.ready();
  },

  async getAppVersion() {
    if (bridge) return bridge.getAppVersion();
    try {
      const r = await fetch('/api/version');
      if (r.ok) {
        const { version } = await r.json();
        if (version) return `${version} web`;
      }
    } catch {
      /* not served by the LAN host */
    }
    if (CDN) {
      const j = await getCdnJson();
      if (j.version) return `${j.version} cdn`;
    }
    return 'web';
  },

  toggleDevTools() {
    if (bridge) bridge.toggleDevTools();
  },
};
