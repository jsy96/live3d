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

  // Idle animation (VRMA) handling; all no-ops in the browser.
  async listAnimations() {
    if (bridge) return bridge.listAnimations();
    return [];
  },
  reportCurrentAnimation(animPath) {
    if (bridge) bridge.reportCurrentAnimation(animPath);
  },
  onAnimationChanged(cb) {
    if (bridge) bridge.onAnimationChanged(cb);
  },

  async getAppVersion() {
    if (bridge) return bridge.getAppVersion();
    return 'web';
  },

  toggleDevTools() {
    if (bridge) bridge.toggleDevTools();
  },
};
