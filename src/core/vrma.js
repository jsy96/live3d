import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

/**
 * Plays .vrma (VRM Animation) clips on a VRM via THREE.AnimationMixer.
 * The clip drives normalized humanoid bones directly, so it MUST be mutually
 * exclusive with Animator's manual pose writes — Animator.update() yields to
 * this player while an idle VRMA is running (state IDLE + isRunning()).
 */
export class VRMAPlayer {
  constructor() {
    this.mixer = null;
    this.action = null;
    this.vrmAnimation = null;
    this.hasExpressions = false;
  }

  get ready() {
    return !!this.action;
  }

  get running() {
    return !!this.action?.isRunning();
  }

  /** Download + parse a .vrma and bind it to the given VRM. */
  async load(url, vrm) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrmAnimation = gltf.userData.vrmAnimations?.[0];
    if (!vrmAnimation) {
      throw new Error('not a VRMA animation file');
    }
    this.vrmAnimation = vrmAnimation;
    this.hasExpressions =
      vrmAnimation.expressionTracks.preset.size > 0 || vrmAnimation.expressionTracks.custom.size > 0;
    this.rebind(vrm);
  }

  /** Re-create the clip against a (new) VRM without re-downloading the file. */
  rebind(vrm) {
    if (!this.vrmAnimation) return;
    this._disposeMixer();
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    const clip = createVRMAnimationClip(this.vrmAnimation, vrm);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
  }

  play() {
    if (this.action && !this.action.isRunning()) {
      this.action.play();
    }
  }

  stop() {
    if (this.action?.isRunning()) {
      this.action.stop();
    }
  }

  update(dt) {
    if (this.running) {
      this.mixer.update(dt);
    }
  }

  clear() {
    this._disposeMixer();
    this.vrmAnimation = null;
    this.hasExpressions = false;
  }

  _disposeMixer() {
    if (this.mixer) {
      this.action?.stop();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.mixer = null;
    this.action = null;
  }
}
