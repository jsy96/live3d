import * as THREE from 'three';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Smooths VRM expression values (blendshapes) towards per-frame targets.
 * All writes go through here so expressions never snap.
 */
export class ExpressionMixer {
  constructor(vrm) {
    this.vrm = vrm;
    this.em = vrm.expressionManager;
    this.current = {}; // name -> smoothed value
    this.desired = {}; // name -> target value
    this.available = this.em ? this.em.expressions.map((e) => e.expressionName) : [];
  }

  has(name) {
    return this.available.includes(name);
  }

  set(name, value) {
    if (!this.has(name)) return;
    this.desired[name] = clamp01(value);
  }

  /** Set every known expression back to 0 except the listed ones. */
  clearAll(except = []) {
    for (const name of this.available) {
      if (!except.includes(name)) this.desired[name] = 0;
    }
  }

  /** Mouth shapes for future lip sync (Phase 3 chat). */
  setMouth(vowel, value) {
    const map = { a: 'aa', i: 'ih', u: 'uu', e: 'eh', o: 'oh' };
    const name = map[vowel];
    if (name) this.set(name, value);
  }

  closeMouth() {
    for (const name of ['aa', 'ih', 'uu', 'eh', 'oh']) this.set(name, 0);
  }

  update(dt) {
    if (!this.em) return;
    // Exponential smoothing, frame-rate independent.
    const k = 1 - Math.exp(-dt * 10);
    for (const name of this.available) {
      const target = this.desired[name] ?? 0;
      const cur = this.current[name] ?? 0;
      const next = cur + (target - cur) * k;
      this.current[name] = next;
      this.em.setValue(name, next);
    }
  }
}
