// Platform adapter.
// The same renderer bundle runs in two places:
//   - Electron desktop pet: `window.live3d` bridge is injected by main/preload.js
//   - Plain browser (mobile web page, future roaming feature): no bridge,
//     every desktop-only capability degrades gracefully.
const bridge = typeof window !== 'undefined' ? window.live3d : undefined;

export const platform = {
  isDesktop: !!bridge,

  async listModels() {
    if (bridge) return bridge.listModels();
    return [];
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

  // Mouse pass-through only applies to the frameless transparent desktop window.
  setInteractive(interactive) {
    if (bridge) bridge.setInteractive(interactive);
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

  async getAppVersion() {
    if (bridge) return bridge.getAppVersion();
    return 'web';
  },

  toggleDevTools() {
    if (bridge) bridge.toggleDevTools();
  },
};
