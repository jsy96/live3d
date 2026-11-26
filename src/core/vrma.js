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
 * centered) — see _extractHipsHeight and Animator's scene-position follow.
 */
export class VRMAPlayer {
  constructor() {
    this.mixer = null;
    this.action = null; // idle loop action
    this.idleAnimation = null; // source VRMAnimation, kept for rebind()
    this.idleHipsTrack = null; // { times, values, duration } hips height data
    this.hasExpressions = false;
    /** kind -> { animation, action, hipsHeight } — one-shot reaction clips */
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
    if (!this.mixer) this.rebind(vrm);
    else this._buildReactionAction(kind, vrm);
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

  /**
   * Re-create all clips against a (new) VRM without re-downloading files.
   * Safe with no idle clip loaded (reaction-only player, e.g. idle "(None)"
   * + a CLI --play): the mixer still exists so one-shot reactions can play.
   */
  rebind(vrm) {
    this._disposeMixer();
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.mixer.addEventListener('finished', (e) => this._onMixerFinished(e));
    if (this.idleAnimation) {
      const clip = createVRMAnimationClip(this.idleAnimation, vrm);
      this.idleHipsTrack = this._extractHipsHeight(clip);
      this.action = this.mixer.clipAction(clip);
      this.action.play();
    }
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

  /**
   * Pull the hips position track OUT of the clip and keep it as height data.
   *
   * Why: three-vrm-animation treats VRMA hips tracks as ABSOLUTE heights
   * (value × targetRestY/sourceRestY is written straight to the hips bone),
   * but the mixer's property binding for the hips bone name is unreliable in
   * the normalized rig — heights ended up either ignored or snapping (the
   * pet visibly jumped between heights). Instead we sample this data per
   * frame ourselves and move the WHOLE model (scene.position.y) so the feet
   * keep their ground relation during sit/jump motions.
   *
   * The track is grounded on its first frame (BVH rest offsets often differ
   * from the motion's real standing height) and clamped against capture drift.
   */
  _extractHipsHeight(clip) {
    const idx = clip.tracks.findIndex((t) => t.name.endsWith('.position') && /hips/i.test(t.name));
    if (idx < 0) return null;
    const track = clip.tracks[idx];
    const values = Float32Array.from(track.values);
    const y0 = values[1];
    for (let i = 1; i < values.length; i += 3) {
      const v = values[i] - y0;
      values[i] = Math.max(-0.6, Math.min(0.25, v));
    }
    clip.tracks.splice(idx, 1); // the mixer must not drive the hips bone
    return { times: Float32Array.from(track.times), values, duration: track.times[track.times.length - 1] };
  }

  _buildReactionAction(kind, vrm) {
    if (!this.mixer) return;
    const entry = this.reactions.get(kind);
    if (!entry) return;
    const clip = createVRMAnimationClip(entry.animation, vrm);
    entry.hipsHeight = this._extractHipsHeight(clip);
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
      // Fresh start after a full stop (e.g. hand-written idle or camera mocap
      // owned the bones): fade in from weight 0 so the pose never snaps.
      this.action.reset().setEffectiveWeight(0).fadeIn(TRANSITION).play();
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

  /**
   * Hips height offset from the REACTION clip currently playing (null when
   * none). The idle loop does NOT participate: idle VRMAs in the wild carry
   * inconsistent hips height semantics (some clips sit deep in their track),
   * and an idle loop is expected to stand at the model rest height anyway.
   */
  currentHipsOffset() {
    if (!this.reactionAction || !this.reactionKind) return null;
    const track = this.reactions.get(this.reactionKind)?.hipsHeight;
    if (!track || track.duration <= 0) return null;
    const t = ((this.reactionAction.time % track.duration) + track.duration) % track.duration;
    // Linear scan is fine: VRMA clips have dozens of keys at most.
    let i = 0;
    while (i < track.times.length - 1 && track.times[i + 1] < t) i++;
    const iNext = Math.min(i + 1, track.times.length - 1);
    const span = track.times[iNext] - track.times[i];
    const f = span > 0 ? (t - track.times[i]) / span : 0;
    const v0 = track.values[i * 3 + 1];
    const v1 = track.values[iNext * 3 + 1];
    return v0 + (v1 - v0) * f;
  }

  clear() {
    this._disposeMixer();
    this.idleAnimation = null;
    this.hasExpressions = false;
    this.idleHipsTrack = null;
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
}
