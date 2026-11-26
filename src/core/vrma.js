import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

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
    const clip = createVRMAnimationClip(this.idleAnimation, vrm);
    this._pinHipsToCenter(clip);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
    for (const kind of [...this.reactions.keys()]) {
      this._buildReactionAction(kind, vrm);
    }
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

  /** Start a one-shot reaction; returns false when the kind was not loaded. */
  startReaction(kind, onFinished) {
    const entry = this.reactions.get(kind);
    if (!entry?.action) return false;
    this.action?.stop(); // idle loop steps aside
    this.reactionAction?.stop();
    this.reactionKind = kind;
    this.reactionAction = entry.action;
    this._onReactionFinished = onFinished ?? null;
    entry.action.reset().play();
    return true;
  }

  stopReaction() {
    this.reactionAction?.stop();
    this.reactionAction = null;
    this.reactionKind = null;
    this._onReactionFinished = null;
  }

  play() {
    if (this.action && !this.action.isRunning() && !this.reactionRunning) {
      this.action.play();
    }
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
      // y: keep vertical bob but clamp it — source-clip displacement scaled to
      // a much taller model can otherwise push the pet right out of the window.
      v[i + 1] = Math.max(-0.15, Math.min(0.15, v[i + 1]));
    }
  }
}
