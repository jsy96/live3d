// Platform adapter.
// The same renderer bundle runs in two places:
//   - Electron desktop pet: `window.live3d` bridge is injected by main/preload.js
//   - Plain browser (mobile web page, future roaming feature): no bridge,
//     every desktop-only capability degrades gracefully.
const bridge = typeof window !== 'undefined' ? window.live3d : undefined;

// LAN web mode (phone browser): listings come from the desktop host's HTTP API
// (main/lan.js). In a plain local page (file:// or offline) fetch fails and we
// degrade to an empty list — the file-picker setup panel still works there.
async function webList(endpoint) {
  try {
    const r = await fetch(endpoint);
    if (!r.ok) return [];
    const arr = await r.json();
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
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

  // Desktop only: the user picked a model from the tray menu.
  onModelChanged(cb) {
    if (bridge) bridge.onModelChanged(cb);
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
  },
  onFacingChanged(cb) {
    if (bridge) bridge.onFacingChanged(cb);
  },

  // Desktop only: one-shot clip from the CLI channel (--play).
  onPlayOnce(cb) {
    if (bridge) bridge.onPlayOnce(cb);
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
    return 'web';
  },

  toggleDevTools() {
    if (bridge) bridge.toggleDevTools();
  },
};
