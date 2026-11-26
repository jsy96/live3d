import { createViewer, loadVRM } from './core/viewer.js';
import { ExpressionMixer } from './core/expression.js';
import { Animator } from './core/animator.js';
import { VRMAPlayer } from './core/vrma.js';
import { HitTester } from './interaction/hit-test.js';
import { MouseInteractor } from './interaction/mouse.js';
import { platform } from './platform.js';

// Uncaught errors land in the log with full stacks (console-message hook in
// the main process writes them to ai-live3d.log).
window.addEventListener('error', (ev) => {
  console.error(`[ai-live3d] uncaught: ${ev.message}\n${ev.error?.stack ?? '(no stack)'}`);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error(`[ai-live3d] unhandled rejection: ${ev.reason?.stack || ev.reason}`);
});

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
  let vrmaPlayer = null;
  let currentVrm = null;
  let pendingAnimation; // undefined = not initialized; null = none; entry = waiting for model

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
        onWheelRotate: (step) => viewer.setFacing(viewer.facingTarget + step),
      });
      panel.classList.add('hidden');
      if (typeof entry === 'object' && entry.path) {
        platform.reportCurrentModel(entry.path);
      }
      // Re-bind the VRMA clip to the new model if one was already chosen.
      currentVrm = vrm;
      if (vrmaPlayer?.ready) vrmaPlayer.rebind(vrm);
      console.log('[ai-live3d] model loaded');
      if (pendingAnimation !== undefined) {
        const e = pendingAnimation;
        pendingAnimation = undefined;
        await loadAnimation(e);
      }
    } catch (err) {
      console.error(`[ai-live3d] model load failed: ${err.message}`);
      showPanel(`模型加载失败: ${err.message}`);
    }
  }

  // Idle animation (VRMA): default to the first file; applied once a model is loaded.
  // Interaction reactions map to VRMA clips by file name when present.
  const REACTION_CLIPS = { poked: 'surprise.vrma', happy: 'hello.vrma' };
  let animMap = new Map();

  async function loadReactionClips() {
    if (!currentVrm || !vrmaPlayer?.ready) return;
    for (const [kind, file] of Object.entries(REACTION_CLIPS)) {
      const entry = animMap.get(file.toLowerCase());
      if (!entry) {
        console.log(`[ai-live3d] reaction clip not in animations/: ${file} (hand-written fallback)`);
        continue;
      }
      try {
        await vrmaPlayer.loadReaction(kind, entry.url, currentVrm);
        console.log(`[ai-live3d] reaction clip loaded: ${kind} <- ${file}`);
      } catch (err) {
        console.error(`[ai-live3d] reaction ${kind} load failed: ${err.message}`);
      }
    }
  }

  async function loadAnimation(entry) {
    if (!entry) {
      vrmaPlayer?.clear();
      animator?.setVRMA(null);
      platform.reportCurrentAnimation(null);
      return;
    }
    if (!currentVrm) {
      pendingAnimation = entry;
      return;
    }
    // Interrupt any playing reaction first: replacing the mixer mid-play
    // would leave the animator stuck in the REACTION state forever.
    animator?.setState('idle');
    try {
      if (!vrmaPlayer) vrmaPlayer = new VRMAPlayer();
      await vrmaPlayer.load(entry.url, currentVrm);
      animator.setVRMA(vrmaPlayer);
      platform.reportCurrentAnimation(entry.path);
      console.log('[ai-live3d] animation loaded');
      await loadReactionClips();
    } catch (err) {
      console.error(`[ai-live3d] animation load failed: ${err.message}`);
      animator?.setVRMA(null);
    }
  }

  // Pick the first model in models/ (alphabetical), else show the setup panel.
  const anims = await platform.listAnimations();
  animMap = new Map(
    anims.map((a) => [a.path.split(/[\\/]/).pop().toLowerCase(), a])
  );
  pendingAnimation = anims.length > 0 ? anims[0] : null;
  const models = await platform.listModels();
  if (models.length > 0) {
    await loadModel(models[0]);
  } else {
    showPanel('');
  }

  // Model picked from the tray menu arrives via IPC event.
  platform.onModelChanged((entry) => loadModel(entry));
  platform.onAnimationChanged((entry) => loadAnimation(entry));
  platform.onFacingChanged((deg) => viewer.setFacing(deg));

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

  // Right-click anywhere on the pet or the setup panel -> model picker menu.
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    platform.showModelPicker(e.clientX, e.clientY);
  });

  // Frame loop.
  // Every step is guarded: one broken animation clip must never kill the
  // rAF loop (the pet is a transparent window — a frozen canvas looks like
  // the pet vanished). On animator errors we drop VRMA entirely and let the
  // hand-written idle pose take over.
  let last = performance.now();
  let fpsAcc = 0;
  let fpsCount = 0;
  function frame(nowMs) {
    const dt = Math.min((nowMs - last) / 1000, 0.1);
    last = nowMs;
    try {
      viewer.updateFacing(dt);
      animator?.update(dt);
    } catch (err) {
      console.error(`[ai-live3d] animator error (${animator?.state ?? '-'}): ${err?.message}`);
      vrmaPlayer?.clear();
      animator?.setVRMA(null);
      animator?.forceIdle();
    }
    try {
      hitTester?.update(viewer.canvas, viewer.camera);
      viewer.render();
      updateInteractiveRegion();
    } catch (err) {
      console.error(`[ai-live3d] render error: ${err?.message}`);
    }
    updateDebugBadge(dt);
    requestAnimationFrame(frame);
  }

  function updateDebugBadge(dt) {
    if (!isDebug) return;
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

main().catch((err) => {
  console.error(`[ai-live3d] fatal: ${err?.stack || err}`);
  document.getElementById('panel-error').textContent = String(err?.stack || err);
  document.getElementById('panel').classList.remove('hidden');
});
