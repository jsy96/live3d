import * as THREE from 'three';

/**
 * Screen-space hit testing against bone anchor points (head, hips) instead of
 * mesh raycasts: fast, stable across VRM models, and unaffected by hair/alpha
 * geometry. Radii derive from the projected head↔hips span so they scale with
 * any model size and camera fit.
 *
 * The stage canvas is fullscreen at (0,0), so clientX/clientY map directly to
 * canvas pixels.
 */
export class HitTester {
  constructor(vrm) {
    this.vrm = vrm;
    this.headScreen = new THREE.Vector2();
    this.hipsScreen = new THREE.Vector2();
    this.headR = 20;
    this.bodyR = 20;
    this.valid = false;
    this._world = new THREE.Vector3();
    this._tmp = new THREE.Vector2();
  }

  update(canvas, camera) {
    const hb = this.vrm.humanoid;
    const head = hb.getNormalizedBoneNode('head');
    const hips = hb.getNormalizedBoneNode('hips');
    if (!head || !hips) {
      this.valid = false;
      return;
    }
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this._project(head, camera, w, h, this.headScreen);
    this._project(hips, camera, w, h, this.hipsScreen);
    const span = this.headScreen.distanceTo(this.hipsScreen);
    this.headR = span * 0.4;
    this.bodyR = span * 0.52;
    this.valid = true;
  }

  _project(node, camera, w, h, out) {
    node.getWorldPosition(this._world);
    this._world.project(camera);
    out.set((this._world.x * 0.5 + 0.5) * w, (-this._world.y * 0.5 + 0.5) * h);
  }

  /** @returns {'head'|'body'|null} */
  hit(clientX, clientY) {
    if (!this.valid) return null;
    this._tmp.set(clientX, clientY);
    if (this._tmp.distanceTo(this.headScreen) < this.headR) return 'head';
    // Body: ellipse around the hips anchor (taller than wide).
    const dx = (clientX - this.hipsScreen.x) / (this.bodyR * 0.95);
    const dy = (clientY - this.hipsScreen.y) / (this.bodyR * 1.5);
    if (dx * dx + dy * dy < 1) return 'body';
    return null;
  }

  /**
   * Window-relative bounding rect covering head circle + body ellipse.
   * Sent to the main process, which uses it to toggle click-through.
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  getRegion() {
    if (!this.valid) return null;
    const left = Math.min(this.headScreen.x - this.headR, this.hipsScreen.x - this.bodyR * 0.95);
    const right = Math.max(this.headScreen.x + this.headR, this.hipsScreen.x + this.bodyR * 0.95);
    const top = Math.min(this.headScreen.y - this.headR, this.hipsScreen.y - this.bodyR * 1.5);
    const bottom = Math.max(this.headScreen.y + this.headR, this.hipsScreen.y + this.bodyR * 1.5);
    const pad = 12;
    return {
      x: Math.round(left - pad),
      y: Math.round(top - pad),
      w: Math.round(right - left + pad * 2),
      h: Math.round(bottom - top + pad * 2),
    };
  }
}
