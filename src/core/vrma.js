import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

// Crossfade duration for every VRMA-to-VRMA transition (idle <-> reaction).
const TRANSITION = 0.2;

/**
 * Plays .vrma (VRM Animation) clips on a VRM via THREE.AnimationMixer.
 *
 * Two kinds of clips live here and are MUTUALLY EXCLUSIVE with each other and
 * with Animator's manual pose writes:
 *   - idle clip: loops forever, driven while Animator state is IDLE
 *   - reaction clips: one-shot (LoopOnce), started by interactions
 *     (poke/excite); the finished event hands control back to the Animator,
 *     which resumes the idle loop.
 * All clips get their hips lateral drift pinned to zero (desktop pet must stay
 * centered) — see _pinHipsToCenter.
 */
export class VRMAPlayer {
  constructor() {
    this.mixer = null;
    this.action = null; // idle loop action
    this.idleAnimation = null; // source VRMAnimation, kept for rebind()
    this.hasExpressions = false;
    /** kind -> { animation, action } — one-shot reaction clips (LoopOnce) */
    this.reactions = new Map();
    this.reactionAction = null;
    this.reactionKind = null;
    this._onReactionFinished = null;
  }

  get ready() {
    return !!this.action;
  }

  get running() {
    return !!this.action?.isRunning();
  }

  get reactionRunning() {
    return !!this.reactionAction?.isRunning();
  }

  /** Download + parse an idle .vrma and bind it to the given VRM. */
  async load(url, vrm) {
    const animation = await this._loadVRMA(url);
    this.idleAnimation = animation;
    this.hasExpressions =
      animation.expressionTracks.preset.size > 0 || animation.expressionTracks.custom.size > 0;
    this.rebind(vrm);
  }

  /** Preload a one-shot reaction clip ('poked', 'happy', ...). */
  async loadReaction(kind, url, vrm) {
    const animation = await this._loadVRMA(url);
    this.reactions.set(kind, { animation, action: null });
    if (this.mixer) {
      this._buildReactionAction(kind, vrm);
    }
  }

  async _loadVRMA(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const animation = gltf.userData.vrmAnimations?.[0];
    if (!animation) {
      throw new Error('not a VRMA animation file');
    }
    return animation;
  }

  /** Re-create all clips against a (new) VRM without re-downloading files. */
  rebind(vrm) {
    this._disposeMixer();
    if (!this.idleAnimation) return;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.mixer.addEventListener('finished', (e) => this._onMixerFinished(e));
    const clip = createVRMAnimationClip(this.idleAnimation, vrm);
    this._pinHipsToCenter(clip);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
    for (const kind of [...this.reactions.keys()]) {
      this._buildReactionAction(kind, vrm);
    }
  }

  /**
   * One-shot reaction clip finished on its own: fade the idle loop back in
   * (its clock kept running, so the loop resumes in continuous motion) and
   * notify the animator to leave the REACTION state.
   */
  _onMixerFinished(e) {
    if (e.action !== this.reactionAction) return;
    this.reactionAction = null;
    const kind = this.reactionKind;
    this.reactionKind = null;
    const cb = this._onReactionFinished;
    this._onReactionFinished = null;
    this._resumeIdle();
    cb?.();
  }

  _buildReactionAction(kind, vrm) {
    if (!this.mixer) return;
    const entry = this.reactions.get(kind);
    if (!entry) return;
    const clip = createVRMAnimationClip(entry.animation, vrm);
    this._pinHipsToCenter(clip);
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    entry.action = action;
  }

  /** Start a one-shot reaction with a smooth crossfade from the idle loop. */
  startReaction(kind, onFinished) {
    const entry = this.reactions.get(kind);
    if (!entry?.action) return false;
    if (this.reactionAction) this.reactionAction.stop();
    // Crossfade: idle fades out (its clock keeps running so the loop is
    // continuous), reaction fades in from weight 0 — no pose snapping.
    this.action?.fadeOut(TRANSITION);
    entry.action.reset().setEffectiveWeight(0).fadeIn(TRANSITION).play();
    this.reactionKind = kind;
    this.reactionAction = entry.action;
    this._onReactionFinished = onFinished ?? null;
    return true;
  }

  /** Interrupt a playing reaction (interaction took over); idle fades back. */
  stopReaction() {
    if (this.reactionAction) {
      this.reactionAction.stop();
    }
    this.reactionAction = null;
    this.reactionKind = null;
    this._onReactionFinished = null;
    this._resumeIdle();
  }

  /** Fade the idle loop back in WITHOUT resetting its clock. */
  _resumeIdle() {
    if (!this.action) return;
    if (!this.action.isRunning()) {
      this.action.reset().setEffectiveWeight(1).play();
      return;
    }
    this.action.setEffectiveWeight(0);
    this.action.fadeIn(TRANSITION);
  }

  play() {
    if (!this.action || this.reactionRunning) return;
    if (!this.action.isRunning()) {
      // Fresh start after a full stop (e.g. hand-written idle took over).
      this.action.reset().setEffectiveWeight(1).play();
    }
    // While running (incl. mid-fade) leave the weights untouched so fades
    // complete naturally.
  }

  stop() {
    if (this.action?.isRunning()) {
      this.action.stop();
    }
  }

  update(dt) {
    if (this.mixer) {
      this.mixer.update(dt);
    }
  }

  clear() {
    this._disposeMixer();
    this.idleAnimation = null;
    this.hasExpressions = false;
    this.reactions.clear();
  }

  _disposeMixer() {
    if (this.mixer) {
      this.action?.stop();
      this.reactionAction?.stop();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.mixer = null;
    this.action = null;
    this.reactionAction = null;
    this.reactionKind = null;
  }

  /**
   * Desktop pet must stay centered: VRMA clips made for streaming stages carry
   * lateral/forward hips drift that looks like the pet is sliding around in
   * the narrow window. Zero out the X/Z hips translation, keep vertical bob.
   */
  _pinHipsToCenter(clip) {
    // Track name = "<hips node name>.position"; match by suffix + "hips" so it
    // does not depend on three-vrm's normalized-rig naming.
    const track = clip.tracks.find((t) => t.name.endsWith('.position') && /hips/i.test(t.name));
    if (!track) return;
    const v = track.values;
    for (let i = 0; i < v.length; i += 3) {
      v[i] = 0; // x: no lateral drift
      v[i + 2] = 0; // z: no forward/back drift
      // y: keep the full vertical displacement — mocap data is grounded by
      // nature (hips sink when sitting/lying so feet stay on the floor).
      // Clamp ONLY against capture drift (some BVH tracks drift meters over
      // time) — the wide band keeps sit/lie-down intact, prevents off-screen.
      v[i + 1] = Math.max(-0.6, Math.min(0.25, v[i + 1]));
    }
  }
}
