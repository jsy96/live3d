import { platform } from '../platform.js';
import { A_POSE_ANGLE, applyAPose } from './pose.js';

export const STATE = Object.freeze({
  IDLE: 'idle',
  PETTING: 'petting',
  GRABBED: 'grabbed',
  POKED: 'poked',
  HAPPY: 'happy',
});

// Normalized-bone Z rotation that lowers the arms from the VRM T-pose into a
// relaxed A-pose (left arm positive, right arm negative). ~63 degrees.
const POKE_DURATION = 0.5;
const HAPPY_DURATION = 1.1;
const JUMP_HEIGHT = 0.1; // m, apex of the hop
const CROUCH_DEPTH = 0.045; // m, anticipation/landing squash depth
const PETTING_TIMEOUT = 0.45; // s without petting input before returning to idle
const BLINK_DURATION = 0.22;

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
const easeInOut = (q) => q * q * (3 - 2 * q); // smoothstep

/**
 * Poses the VRM every frame: resets to the A-pose base, layers breathing /
 * head-follow / blinking, then applies the interaction state machine.
 * Bones are set absolutely each frame so nothing accumulates across states.
 */
export class Animator {
  constructor(vrm, mixer) {
    this.vrm = vrm;
    this.mixer = mixer;
    this.state = STATE.IDLE;
    this.now = 0;
    this.stateStart = 0;
    this.vrma = null; // VRMAPlayer, set via setVRMA()

    const hb = vrm.humanoid;
    this.bones = {};
    for (const name of [
      'hips', 'spine', 'chest', 'neck', 'head',
      'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
    ]) {
      this.bones[name] = hb.getNormalizedBoneNode(name);
    }

    // Base pose = A-pose; every frame starts from these values.
    // IMPORTANT: apply the pose BEFORE capturing the base, otherwise the
    // per-frame reset would restore the T-pose (arms stretched out).
    applyAPose(vrm);
    this.base = {};
    for (const [name, node] of Object.entries(this.bones)) {
      this.base[name] = node
        ? { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z }
        : { x: 0, y: 0, z: 0 };
    }
    this.hipsBaseY = this.bones.hips ? this.bones.hips.position.y : 0;

    this.pointerNDC = { x: 0, y: 0 };
    this.grabVel = { x: 0, y: 0 }; // smoothed drag velocity, screen px per frame
    this._dragDX = 0;
    this._dragDY = 0;
    this._modelOffset = { x: 0, y: 0 }; // browser mode: model dragged inside viewport
    this._lastPetting = -Infinity;

    this.blinkTimer = rand(1.8, 4.5);
    this.blinkPhase = -1;
    this.idleTimer = rand(3, 6);
    this.tilt = 0;
    this.tiltTarget = 0;
  }

  /** Attach a VRMAPlayer for idle-loop animation (or null to disable). */
  setVRMA(player) {
    this.vrma = player;
    if (this.state === STATE.IDLE) player?.play();
  }

  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateStart = this.now;
    // VRMA idle clip and manual poses both write normalized bones: stop the
    // clip during interactions, resume it when back to idle.
    if (next !== STATE.IDLE) this.vrma?.stop();
    else this.vrma?.play();
  }

  poke() {
    this.setState(STATE.POKED);
  }

  excite() {
    this.setState(STATE.HAPPY);
  }

  release() {
    if (this.state === STATE.GRABBED) this.setState(STATE.IDLE);
  }

  setPointer(x, y) {
    this.pointerNDC.x = x;
    this.pointerNDC.y = y;
  }

  /** Accumulate drag delta for the current frame (screen px). */
  reportDrag(dx, dy) {
    this._dragDX += dx;
    this._dragDY += dy;
  }

  /** Browser-mode drag: move the model inside the viewport (world units). */
  nudge(wx, wy) {
    this._modelOffset.x = clamp(this._modelOffset.x + wx, -0.45, 0.45);
    this._modelOffset.y = clamp(this._modelOffset.y + wy, -0.35, 0.45);
  }

  keepPetting() {
    this._lastPetting = this.now;
    if (this.state !== STATE.PETTING) this.setState(STATE.PETTING);
  }

  update(dt) {
    this.now += dt;
    const t = this.now;
    const b = this.bones;
    const base = this.base;
    const inState = this.now - this.stateStart;

    // Idle VRMA mode: the AnimationMixer drives the pose (normalized bones),
    // so all manual pose writes below are skipped while it runs.
    if (this.state === STATE.IDLE && this.vrma?.running) {
      if (!this.vrma.hasExpressions) {
        this.mixer.clearAll();
        this._updateBlink(dt);
        this.mixer.update(dt);
      }
      this.vrma.update(dt);
      this.vrm.update(dt);
      return;
    }

    // Petting times out when the hand leaves the head.
    if (this.state === STATE.PETTING && this.now - this._lastPetting > PETTING_TIMEOUT) {
      this.setState(STATE.IDLE);
    }

    // --- reset to base pose
    for (const [name, node] of Object.entries(b)) {
      if (!node) continue;
      node.rotation.set(base[name].x, base[name].y, base[name].z);
    }
    if (b.hips) b.hips.position.y = this.hipsBaseY;

    // --- model offset (browser drag), spring back when not grabbed
    if (!platform.isDesktop) {
      const scene = this.vrm.scene;
      if (this.state === STATE.GRABBED) {
        scene.position.set(this._modelOffset.x, this._modelOffset.y, scene.position.z);
      } else {
        const decay = Math.exp(-dt * 4);
        this._modelOffset.x *= decay;
        this._modelOffset.y *= decay;
        scene.position.set(this._modelOffset.x, this._modelOffset.y, scene.position.z);
      }
    }

    // --- expression targets for this frame
    this.mixer.clearAll(['blink']);
    let happy = 0;
    let surprised = 0;
    let relaxed = 0;

    // --- breathing (always)
    if (b.spine) b.spine.rotation.x = base.spine.x + Math.sin(t * 1.7) * 0.022;
    if (b.chest) b.chest.rotation.x = base.chest.x + Math.sin(t * 1.7 + 0.7) * 0.012;

    // --- head follows the pointer (subtle)
    const yaw = clamp(this.pointerNDC.x * 0.5, -0.45, 0.45);
    const pitch = clamp(this.pointerNDC.y * 0.35, -0.3, 0.35);
    if (b.head) {
      b.head.rotation.y = base.head.y + yaw;
      b.head.rotation.x = base.head.x + pitch;
    }

    // --- drag velocity smoothing (reset unless grabbed)
    if (this.state === STATE.GRABBED) {
      this.grabVel.x = damp(this.grabVel.x, this._dragDX, 8, dt);
      this.grabVel.y = damp(this.grabVel.y, this._dragDY, 8, dt);
    } else {
      this.grabVel.x = 0;
      this.grabVel.y = 0;
    }
    this._dragDX = 0;
    this._dragDY = 0;

    // --- blink
    this._updateBlink(dt);

    // --- state-specific pose
    switch (this.state) {
      case STATE.IDLE: {
        // Occasional head tilt: tilt for a moment, then settle back.
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) {
          if (this.tiltTarget !== 0) {
            this.tiltTarget = 0;
            this.idleTimer = rand(4, 9);
          } else {
            this.tiltTarget = (Math.random() < 0.5 ? -1 : 1) * rand(0.08, 0.14);
            this.idleTimer = rand(1.2, 2.0);
          }
        }
        this.tilt = damp(this.tilt, this.tiltTarget, 4, dt);
        if (b.head) b.head.rotation.z = base.head.z + this.tilt;
        break;
      }
      case STATE.PETTING: {
        happy = 1;
        relaxed = 0.4;
        if (b.head) {
          b.head.rotation.z = base.head.z + Math.sin(t * 5.5) * 0.1;
          b.head.rotation.x = base.head.x + pitch + 0.06; // lean into the hand
        }
        break;
      }
      case STATE.GRABBED: {
        surprised = 0.75;
        // Lean opposite to the drag direction (inertia), flail slightly.
        const leanZ = clamp(-this.grabVel.x * 0.0015, -0.35, 0.35);
        const flail = Math.sin(t * 9) * clamp(Math.hypot(this.grabVel.x, this.grabVel.y) * 0.0006, 0, 0.18);
        if (b.spine) b.spine.rotation.z = base.spine.z + leanZ;
        if (b.head) b.head.rotation.z = base.head.z + leanZ * 0.8;
        if (b.leftUpperArm) b.leftUpperArm.rotation.z = A_POSE_ANGLE + flail;
        if (b.rightUpperArm) b.rightUpperArm.rotation.z = -A_POSE_ANGLE - flail;
        break;
      }
      case STATE.POKED: {
        surprised = 1;
        const p = clamp(inState / POKE_DURATION, 0, 1);
        // Startle: tiny dip first, then a quick springy hop on a gravity arc.
        let dip;
        if (p < 0.18) {
          dip = -easeInOut(p / 0.18) * 0.03;
        } else {
          const q = (p - 0.18) / 0.82;
          dip = 0.06 * 4 * q * (1 - q);
        }
        if (b.hips) b.hips.position.y = this.hipsBaseY + dip;
        if (b.spine) b.spine.rotation.x = base.spine.x + 0.08 * Math.sin(p * Math.PI);
        if (p >= 1) this.setState(STATE.IDLE);
        break;
      }
      case STATE.HAPPY: {
        happy = 1;
        const p = clamp(inState / HAPPY_DURATION, 0, 1);
        // Physics-style hop, all phases on one time axis so the arms stay in
        // sync with the jump: crouch anticipation -> parabolic airborne arc ->
        // landing squash -> small rebound to stand.
        const CROUCH_END = 0.14;
        const LAND_END = 0.62;
        const SETTLE_END = 0.8;
        let hopY = 0;
        let armRaise = 0;
        if (p < CROUCH_END) {
          const q = p / CROUCH_END;
          hopY = -easeInOut(q) * CROUCH_DEPTH;
          armRaise = -0.1 * Math.sin(q * Math.PI); // slight wind-up
        } else if (p < LAND_END) {
          const q = (p - CROUCH_END) / (LAND_END - CROUCH_END);
          hopY = JUMP_HEIGHT * 4 * q * (1 - q); // gravity parabola, apex mid-air
          armRaise = 0.85 + Math.sin(q * Math.PI) * 0.15; // arms up through the jump
        } else if (p < SETTLE_END) {
          const q = (p - LAND_END) / (SETTLE_END - LAND_END);
          hopY = -Math.sin(q * Math.PI) * CROUCH_DEPTH * 0.8; // landing squash
          armRaise = 0.85 * (1 - q); // arms come down while landing
        } else {
          const q = (p - SETTLE_END) / (1 - SETTLE_END);
          hopY = Math.sin(q * Math.PI) * CROUCH_DEPTH * 0.25; // small rebound
          armRaise = 0;
        }
        if (b.hips) b.hips.position.y = this.hipsBaseY + hopY;
        const wave = armRaise > 0.3 ? Math.sin(t * 8) * 0.12 * armRaise : 0;
        // Raise the arms by rotating BACK toward the T-pose and beyond (negative
        // direction): rotating further positive would cross both arms over the
        // body midline (they end up folded behind the back).
        if (b.leftUpperArm) b.leftUpperArm.rotation.z = A_POSE_ANGLE - armRaise * 2.0 + wave;
        if (b.rightUpperArm) b.rightUpperArm.rotation.z = -A_POSE_ANGLE + armRaise * 2.0 - wave;
        if (b.spine) b.spine.rotation.x = base.spine.x + (armRaise > 0 ? 0.05 * armRaise : 0);
        if (p >= 1) this.setState(STATE.IDLE);
        break;
      }
    }

    this.mixer.set('happy', happy);
    this.mixer.set('surprised', surprised);
    this.mixer.set('relaxed', relaxed);
    this.mixer.update(dt);
    this.vrm.update(dt);
  }

  _updateBlink(dt) {
    if (this.blinkPhase < 0) {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinkPhase = 0;
      } else {
        this.mixer.set('blink', 0);
        return;
      }
    }
    this.blinkPhase += dt / BLINK_DURATION;
    const p = Math.min(this.blinkPhase, 1);
    const v = p < 0.5 ? p * 2 : 2 - p * 2;
    // Squint while being petted (the happy expression already closes the eyes).
    const scale = this.state === STATE.PETTING ? 0.25 : 1;
    this.mixer.set('blink', v * scale);
    if (this.blinkPhase >= 1) {
      this.blinkPhase = -1;
      this.blinkTimer = rand(1.8, 4.5);
      this.mixer.set('blink', 0);
    }
  }
}
