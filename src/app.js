import * as THREE from 'three';
import { createViewer, loadVRM } from './core/viewer.js';
import { ExpressionMixer } from './core/expression.js';
import { Animator } from './core/animator.js';
import { VRMAPlayer } from './core/vrma.js';
import { HitTester } from './interaction/hit-test.js';
import { MouseInteractor } from './interaction/mouse.js';
import { createWebPicker } from './web-picker.js';
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
  // Web mode (phone browser via the LAN server) gets its own backdrop; the
  // desktop transparent window must stay transparent.
  if (!platform.isDesktop) {
    document.body.classList.add('web');
    // PWA: register the (network-passthrough) service worker so "Add to Home
    // Screen" yields a standalone app. Failure is non-fatal — the page works
    // fine as a plain tab too.
    navigator.serviceWorker?.register('/sw.js').catch(() => {});
  }
  let animator = null;
  let hitTester = null;
  let interactor = null;
  let vrmaPlayer = null;
  let currentVrm = null;
  let pendingAnimation; // undefined = not initialized; null = none; entry = waiting for model
  // Currently-loaded selections (lowercase basenames) — dedupes sync pushes
  // and drives the phone console's checkmarks.
  let currentModelName = null;
  let currentAnimName = null;
  let webPicker = null; // phone console, web mode only

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
        onWheelRotate: (step) => {
          viewer.setFacing(viewer.facingTarget + step);
          // Wheel turns sync to the phones (main process relays).
          platform.reportFacing(viewer.facingTarget);
        },
      });
      panel.classList.add('hidden');
      if (typeof entry === 'object' && entry.path) {
        platform.reportCurrentModel(entry.path);
      }
      // Re-bind the VRMA clip to the new model if one was already chosen.
      currentVrm = vrm;
      if (typeof entry === 'object' && entry.path) {
        currentModelName = entry.path.split(/[\\/]/).pop().toLowerCase();
        webPicker?.select({ model: currentModelName });
      }
      vrmaPlayer?.rebind(vrm);
      console.log('[ai-live3d] model loaded');
      if (pendingAnimation !== undefined) {
        const e = pendingAnimation;
        pendingAnimation = undefined;
        await loadAnimation(e);
      }
      if (pendingPlay) {
        const e = pendingPlay;
        pendingPlay = null;
        playOnce(e);
      }
    } catch (err) {
      console.error(`[ai-live3d] model load failed: ${err.message}`);
      showPanel(`模型加载失败: ${err.message}`);
    }
  }

  // Idle animation (VRMA): default clip by file name (falls back to the first
  // file in animations/ when absent); applied once a model is loaded.
  // Interaction reactions map to VRMA clips by file name when present.
  const DEFAULT_ANIMATION = 'dance_2.vrma';
  const REACTION_CLIPS = { poked: 'surprise.vrma', happy: 'hello.vrma' };
  let animMap = new Map();
  let pendingPlay = null; // CLI --play that arrived before a model was ready

  /**
   * One-shot clip from the CLI channel (start-pet.bat --play / skill): load
   * it as a 'skill' reaction, play it once, then the idle loop resumes.
   * kind 'skill' overlays no forced facial expression.
   */
  async function playOnce(entry) {
    if (!currentVrm || !animator) {
      pendingPlay = entry;
      return;
    }
    pendingPlay = null;
    try {
      if (!vrmaPlayer) vrmaPlayer = new VRMAPlayer();
      await vrmaPlayer.loadReaction('skill', entry.url, currentVrm);
      // (Re)link: a model switch recreated the animator with vrma unset.
      animator.setVRMA(vrmaPlayer);
      animator.startReaction('skill');
      console.log(`[ai-live3d] play-once: ${entry.path}`);
    } catch (err) {
      console.error(`[ai-live3d] play-once failed: ${err.message}`);
    }
  }

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
      currentAnimName = null;
      webPicker?.select({ animation: null });
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
      currentAnimName = entry.path.split(/[\\/]/).pop().toLowerCase();
      webPicker?.select({ animation: currentAnimName });
      console.log('[ai-live3d] animation loaded');
      // One-shot diagnostics for the hips-height mystery:
      console.log(`[diag] vrm.scene has 'hips' node: ${!!currentVrm.scene.getObjectByName('hips')}`);
      const rawHipsName = currentVrm.humanoid.getRawBoneNode?.('hips')?.name
        ?? currentVrm.humanoid.rawHumanBones?.hips?.node?.name;
      console.log(`[diag] raw hips node name: ${rawHipsName}, in scene: ${rawHipsName ? !!currentVrm.scene.getObjectByName(rawHipsName) : '?'}`);
      const nRoot = currentVrm.humanoid.normalizedHumanBones?.root;
      console.log(`[diag] normalized root name: "${nRoot?.name}", parent in scene: ${nRoot?.parent ? 'YES' : 'no'}`);
      const nrp = currentVrm.humanoid.normalizedRestPose?.hips?.position;
      console.log(`[diag] normalizedRestPose hips y: ${nrp ? nrp[1] : 'undefined'}`);
      console.log(
        `[diag] idle VRMA restHipsPosition y: ${vrmaPlayer.idleAnimation?.restHipsPosition?.y}`
      );
      const idleTrack = vrmaPlayer.idleHipsTrack;
      if (idleTrack) {
        let mn = Infinity;
        let mx = -Infinity;
        for (let i = 1; i < idleTrack.values.length; i += 3) {
          mn = Math.min(mn, idleTrack.values[i]);
          mx = Math.max(mx, idleTrack.values[i]);
        }
        console.log(
          `[diag] idle hips track range: ${mn.toFixed(3)} ~ ${mx.toFixed(3)} (${idleTrack.times.length} keys)`
        );
      }
      const diagRangeValues = (values, label) => {
        if (!values || values.length === 0) {
          console.log(`[diag] ${label}: no values`);
          return;
        }
        let mn = Infinity;
        let mx = -Infinity;
        for (let i = 1; i < values.length; i += 3) {
          mn = Math.min(mn, values[i]);
          mx = Math.max(mx, values[i]);
        }
        console.log(`[diag] ${label} hips y range: ${mn.toFixed(3)} ~ ${mx.toFixed(3)}`);
      };
      diagRangeValues(
        vrmaPlayer.action?.getClip()?.tracks.find((x) => x.name.endsWith('hips.position'))?.values,
        'idle-clip'
      );
      for (const [kind, e] of vrmaPlayer.reactions) {
        const t = e.animation?.humanoidTracks?.translation?.get('hips');
        if (t) diagRangeValues(t.values, `reaction-${kind}-raw`);
      }
      console.log('[diag] done');
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
  pendingAnimation = anims.length > 0 ? (animMap.get(DEFAULT_ANIMATION) ?? anims[0]) : null;
  const models = await platform.listModels();
  if (models.length > 0) {
    await loadModel(models[0]);
  } else {
    showPanel('');
  }

  // Model picked from the tray menu (desktop) or roaming sync push (phone)
  // arrives here; same-basename pushes are no-ops.
  platform.onModelChanged((entry) => {
    const base = entry?.path ? entry.path.split(/[\\/]/).pop().toLowerCase() : null;
    if (base && base === currentModelName) return;
    loadModel(entry);
  });
  platform.onAnimationChanged((entry) => {
    const base = entry?.path ? entry.path.split(/[\\/]/).pop().toLowerCase() : null;
    if (!entry && currentAnimName == null) return;
    if (entry && base === currentAnimName) return;
    loadAnimation(entry);
  });
  platform.onFacingChanged((deg) => {
    viewer.setFacing(deg);
    webPicker?.select({ facing: deg });
  });
  platform.onPlayOnce(playOnce);

  // Roaming hand-off: 'exit' runs the pet off screen (desktop then hides the
  // window, phone stows the model), 'enter' runs it back in. Recalling on the
  // phone is the dock's 📱 button.
  platform.onRoam((cmd) => {
    if (cmd === 'exit') {
      viewer.startRoam('exit', () => {
        if (platform.isDesktop) platform.roamExited();
        else viewer.setPetVisible(false);
      });
    } else if (cmd === 'enter') {
      if (!platform.isDesktop && !viewer.petVisible) viewer.setPetVisible(true);
      viewer.startRoam('enter');
    }
  });

  // Phone console (web only): roam buttons + model/animation/facing picker.
  if (!platform.isDesktop) {
    webPicker = createWebPicker({ models, animations: [...animMap.values()] });
    // The initial model/animation loaded above predate the picker's creation.
    webPicker.select({ model: currentModelName, animation: currentAnimName });
  }

  // Startup done: the main process can now deliver queued CLI commands.
  platform.ready();

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
      viewer.updateRoam(dt);
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

  // Debug: auto-poke and measure hips height during reaction playback.
  if (isDebug) {
    const tmp = new THREE.Vector3();
    setInterval(() => {
      if (!animator || !currentVrm) return;
      const raw = currentVrm.humanoid.getRawBoneNode?.('hips')
        ?? currentVrm.humanoid.rawHumanBones?.hips?.node;
      const norm = currentVrm.humanoid.getNormalizedBoneNode('hips');
      console.log(
        `[hips-watch] state=${animator.state} rawHipsY=${raw ? raw.position.y.toFixed(3) : '?'} normHipsY=${norm ? norm.position.y.toFixed(3) : '?'} rawWorldY=${raw ? raw.getWorldPosition(tmp).y.toFixed(3) : '?'}`
      );
    }, 500);
    setInterval(() => {
      animator?.poke();
    }, 4000);
  }
}

main().catch((err) => {
  console.error(`[ai-live3d] fatal: ${err?.stack || err}`);
  document.getElementById('panel-error').textContent = String(err?.stack || err);
  document.getElementById('panel').classList.remove('hidden');
});
