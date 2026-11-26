import { createViewer, loadVRM } from './core/viewer.js';
import { ExpressionMixer } from './core/expression.js';
import { Animator } from './core/animator.js';
import { HitTester } from './interaction/hit-test.js';
import { MouseInteractor } from './interaction/mouse.js';
import { platform } from './platform.js';

const canvas = document.getElementById('stage');
const panel = document.getElementById('panel');
const panelError = document.getElementById('panel-error');
const badge = document.getElementById('debug-badge');
const isDebug = new URLSearchParams(location.search).has('debug');

async function main() {
  const version = await platform.getAppVersion();
  console.log(`[ai-live3d] ${version} platform=${platform.isDesktop ? 'desktop' : 'web'}`);
  if (isDebug) {
    badge.classList.remove('hidden');
    badge.textContent = `${version} · ${platform.isDesktop ? 'desktop' : 'web'}`;
  }

  const viewer = createViewer(canvas);
  let animator = null;
  let hitTester = null;
  let interactor = null;

  function showPanel(message) {
    panelError.textContent = message || '';
    panel.classList.remove('hidden');
  }

  async function loadModel(entry) {
    try {
      const url = typeof entry === 'string' ? entry : entry.url;
      const vrm = await loadVRM(viewer, url);
      const mixer = new ExpressionMixer(vrm);
      animator = new Animator(vrm, mixer);
      hitTester = new HitTester(vrm);
      if (interactor) interactor.dispose();
      interactor = new MouseInteractor(viewer, hitTester, animator, {
        onPointerNDC: (x, y) => viewer.setLookFromPointer(x, y),
      });
      panel.classList.add('hidden');
      console.log('[ai-live3d] model loaded');
    } catch (err) {
      console.error(`[ai-live3d] model load failed: ${err.message}`);
      showPanel(`模型加载失败: ${err.message}`);
    }
  }

  // Pick the first model in models/ (alphabetical), else show the setup panel.
  const models = await platform.listModels();
  if (models.length > 0) {
    await loadModel(models[0]);
  } else {
    showPanel('');
  }

  // Model picked from the tray menu arrives via IPC event.
  platform.onModelChanged((entry) => loadModel(entry));

  document.getElementById('pick-btn').addEventListener('click', async () => {
    const entry = await platform.pickModel();
    if (entry) await loadModel(entry);
  });

  // Browser (mobile web) fallback: plain file input.
  const fileInput = document.getElementById('file-input');
  document.getElementById('pick-file-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (f) loadModel(URL.createObjectURL(f));
  });

  // While the setup panel is visible (no model), its rect keeps the window
  // interactive so the buttons can be clicked (main-process cursor poll).
  let lastRegion = null;
  function regionEquals(a, b) {
    if (!a || !b) return a === b;
    return (
      Math.abs(a.x - b.x) <= 2 &&
      Math.abs(a.y - b.y) <= 2 &&
      Math.abs(a.w - b.w) <= 2 &&
      Math.abs(a.h - b.h) <= 2
    );
  }
  function sendRegion(region) {
    if (!regionEquals(region, lastRegion)) {
      lastRegion = region;
      platform.updateRegion(region);
    }
  }
  function updateInteractiveRegion() {
    let region = hitTester ? hitTester.getRegion() : null;
    if (!region && !panel.classList.contains('hidden')) {
      const r = panel.getBoundingClientRect();
      region = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    sendRegion(region);
  }

  // Frame loop.
  let last = performance.now();
  let fpsAcc = 0;
  let fpsCount = 0;
  function frame(nowMs) {
    const dt = Math.min((nowMs - last) / 1000, 0.1);
    last = nowMs;
    animator?.update(dt);
    hitTester?.update(viewer.canvas, viewer.camera);
    viewer.render();
    updateInteractiveRegion();
    if (isDebug) {
      fpsAcc += dt;
      fpsCount++;
      if (fpsAcc >= 0.5) {
        const fps = Math.round(fpsCount / fpsAcc);
        fpsAcc = 0;
        fpsCount = 0;
        badge.textContent = `${version} · ${platform.isDesktop ? 'desktop' : 'web'} · ${fps} fps · ${animator ? animator.state : 'none'}`;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(`[ai-live3d] fatal: ${err?.stack || err}`);
  document.getElementById('panel-error').textContent = String(err?.stack || err);
  document.getElementById('panel').classList.remove('hidden');
});
