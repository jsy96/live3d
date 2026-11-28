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
import { CloudPetSync } from './sync/cloud.js';

// LAN web mode (phone browser): listings come from the desktop host's HTTP API
// (main/lan.js). In a plain local page (file:// or offline) fetch fails and we
// degrade to an empty list — the file-picker setup panel still works there.
// CDN mode falls back to the static assets.json catalog shipped with the page.
const cdnJson = { loaded: null };
async function getCdnJson() {
  if (!cdnJson.loaded) {
    // CDN copies live under a sub-path (CDN.base, e.g. /pet/). Static hosting
    // sets its own cache TTL — bust it so catalog changes show immediately.
    try {
      const r = await fetch(`${CDN?.base ?? ''}/assets.json?t=${Date.now()}`);
      cdnJson.loaded = r.ok ? await r.json() : {};
    } catch {
      cdnJson.loaded = {};
    }
    // Rewrite catalog URLs to the fast TCB origin (China edge ~1.7s for a
    // 15MB model vs 20-45s through the CF front). fallbackUrl keeps the
    // same-origin CDN path for the loadModel retry path.
    if (CDN?.assetOrigin) {
      for (const key of ['models', 'animations']) {
        const arr = cdnJson.loaded[key];
        if (!Array.isArray(arr)) continue;
        cdnJson.loaded[key] = arr.map((e) =>
          typeof e?.url === 'string' && e.url.startsWith(CDN.base)
            ? { ...e, fallbackUrl: e.url, url: CDN.assetOrigin + e.url }
            : e
        );
      }
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

// Web-mode sync runs over up to two lanes fanned into the same callbacks:
//   WS lane   — the desktop host's roaming WebSocket (fast, PC must be on);
//   cloud lane— CloudBase realtime database (always on, no PC needed). CDN
// mode gets both; a LAN page only has the WS lane; the desktop has neither.
let webCbs = null;
let webSync = null; // WS lane (RoamingClient), null while the PC is offline
let cloudSync = null; // cloud lane (CloudPetSync), CDN mode only
async function webWsUrl() {
  const hub = CDN?.hubUrl;
  if (hub) {
    try {
      // Cache-bust: live.json changes whenever the PC's address does.
      const r = await fetch(`${hub}?t=${Date.now()}`, { signal: AbortSignal.timeout(3000) });
      const j = await r.json();
      const candidates = [j.tunnelUrl, ...(Array.isArray(j.lanUrls) ? j.lanUrls : [])];
      // An https CDN page cannot open insecure ws:// (mixed content) — only
      // the tunnel (wss) works remotely; same-Wi-Fi phones should use the
      // PC's own LAN page instead of the CDN copy.
      const secureOnly = location.protocol === 'https:';
      for (const c of candidates) {
        if (!c) continue;
        if (secureOnly && !/^https:/i.test(c)) continue;
        return `${c.replace(/^http/i, 'ws')}/ws`;
      }
      return null; // PC offline: the static host has no /ws to fall back to
    } catch {
      return null; // hub unreachable: cloud-only mode
    }
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

// Entries from the PC carry root-relative URLs (/models/..) meant for its
// own origin; CDN copies live under a sub-path — rewrite them there, riding
// the fast TCB origin for the big binaries with a same-origin fallback.
function cdnEntry(entry, kind) {
  if (!entry || !CDN) return entry;
  const file = encodeURIComponent(String(entry.path ?? '').split(/[\\/]/).pop() ?? '');
  const rel = `${CDN.base}${kind}/${file}`;
  return CDN.assetOrigin ? { ...entry, url: CDN.assetOrigin + rel, fallbackUrl: rel } : { ...entry, url: rel };
}

function ensureWebBus() {
  if (webCbs) return webCbs;
  webCbs = { model: [], animation: [], facing: [], play: [], roam: [] };

  // Shared fan-in: both lanes speak the same 'state'/'play' vocabulary.
  const dispatch = (msg) => {
    if (msg.model) for (const cb of webCbs.model) cb(cdnEntry(msg.model, 'models'));
    if (msg.animation) for (const cb of webCbs.animation) cb(cdnEntry(msg.animation, 'animations'));
    if (msg.animation === null) for (const cb of webCbs.animation) cb(null);
    if (typeof msg.facing === 'number') for (const cb of webCbs.facing) cb(msg.facing);
  };

  // WS lane. Started only when the PC advertises a reachable address; a slow
  // re-poll of live.json picks the PC up when it comes online later (and
  // follows tunnel restarts, which always change the URL).
  const startWsLane = (url) => {
    const client = new RoamingClient();
    client.on(ROAMING_EVENTS.STATE, dispatch);
    client.on(ROAMING_EVENTS.PLAY, (msg) => {
      if (msg.entry) for (const cb of webCbs.play) cb(cdnEntry(msg.entry, 'animations'));
      // Relay PC-side one-shots to the cloud lane so pages that only have
      // the cloud lane (PC reachable for nobody) still play them.
      cloudSync?.send(ROAMING_EVENTS.PLAY, msg);
    });
    client.on(ROAMING_EVENTS.ROAM, (msg) => {
      for (const cb of webCbs.roam) cb(msg.cmd);
    });
    client.connect(url); // reconnects on its own
    webSync = client;
  };
  webWsUrl().then((url) => {
    if (url) startWsLane(url);
  });
  setInterval(async () => {
    if (webCbs === null) return; // torn down
    const url = await webWsUrl();
    if (!url) return;
    if (!webSync) startWsLane(url);
    else if (url !== webSync.url) {
      webSync.close();
      webSync = null;
      startWsLane(url);
    }
  }, 30000);

  // Cloud lane: the always-on backbone (CDN mode only). Needs nothing from
  // the PC — anonymous login + realtime watch on the shared pet document.
  if (CDN?.envId) {
    cloudSync = new CloudPetSync();
    cloudSync.on(ROAMING_EVENTS.STATE, dispatch);
    cloudSync.on(ROAMING_EVENTS.PLAY, (msg) => {
      if (msg.entry) for (const cb of webCbs.play) cb(cdnEntry(msg.entry, 'animations'));
    });
    cloudSync.start(CDN.envId);
    // The first snapshot can beat the app's subscriber registrations; replay
    // the shared state once they've had a chance to run.
    setTimeout(() => cloudSync?.replay(), 300);
  }
  return webCbs;
}

/** Selection made on this device: fan out to every upstream lane. */
function sendPick(what, value) {
  webSync?.send(ROAMING_EVENTS.PICK, { what, value });
  cloudSync?.send(ROAMING_EVENTS.PICK, { what, value });
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
    else ensureWebBus().model.push(cb);
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
    else ensureWebBus().animation.push(cb);
  },
  onFacingChanged(cb) {
    if (bridge) bridge.onFacingChanged(cb);
    else ensureWebBus().facing.push(cb);
  },

  // Desktop: one-shot clip from the CLI channel (--play). Web: same broadcast.
  onPlayOnce(cb) {
    if (bridge) bridge.onPlayOnce(cb);
    else ensureWebBus().play.push(cb);
  },

  // Roaming hand-off commands ('exit' = run off screen, 'enter' = run in).
  onRoam(cb) {
    if (bridge) bridge.onRoam(cb);
    else ensureWebBus().roam.push(cb);
  },

  // Desktop renderer finished its exit animation; the main process hides the
  // window and tells the phones to play their enter animation.
  roamExited() {
    if (bridge) bridge.roamExited();
  },

  // Web (phone) -> desktop: apply a selection made in the phone picker.
  setModelRemote(name) {
    if (!bridge) sendPick("model", name);
  },
  setAnimationRemote(name) {
    if (!bridge) sendPick("animation", name);
  },
  setFacingRemote(deg) {
    if (!bridge) sendPick("facing", deg);
  },

  // Either side: hand the pet to the other device ('phone' | 'desktop').
  roamTo(target) {
    if (bridge) return false;
    webSync?.send(ROAMING_EVENTS.PICK, { what: "roam", value: target });
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
