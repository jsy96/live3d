// Camera motion capture: MediaPipe PoseLandmarker (webcam) -> VRM humanoid.
//
// Pipeline per frame:
//   video --detectForVideo--> worldLandmarks (33 joints, meters, hip-centered)
//     -> EMA smoothing -> map into VRM scene space (mirror-aware)
//     -> aim solver: each bone is rotated so its REST direction points along
//      the tracked direction (setFromUnitVectors in the parent's CURRENT
//      frame), walking the hierarchy in order so ancestors' (damped)
//      rotations are accumulated first.
//     -> per-bone slerp damping + visibility gating (unseen limbs relax to a
//      natural fallback pose instead of freezing).
//
// Conventions are measured from the actual rig at attach time (rest joint
// positions), so there is no axis/sign guessing: the solver records which way
// each bone points at rest and rotates that direction onto the tracked one.
//
// Coordinate mapping (MediaPipe world -> VRM scene space):
//   mp.x: + = subject's left | mp.y: - = up | mp.z: - = toward the camera
//   scene: +Y up, +Z toward the viewer (model faces the viewer)
//   mirror ON  -> scene.x = -mp.x (pet acts as the user's mirror image)
//   mirror OFF -> scene.x = +mp.x (pet imitates with same-named limbs)

import * as THREE from 'three';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe Pose landmark indices (the subset this solver uses).
const LM = {
  nose: 0,
  earL: 7,
  earR: 8,
  shoulderL: 11,
  shoulderR: 12,
  elbowL: 13,
  elbowR: 14,
  wristL: 15,
  wristR: 16,
  hipL: 23,
  hipR: 24,
  kneeL: 25,
  kneeR: 26,
  ankleL: 27,
  ankleR: 28,
};

const LIMB_VIS_MIN = 0.55; // landmark visibility above this = limb tracked
const SMOOTH_HZ = 9; // landmark EMA cutoff (Hz)
const BONE_RATE = 14; // bone quaternion slerp rate (1/s)
const CONF_RATE = 6; // per-limb confidence fade rate (1/s)
const TORSO_MAX_TILT = 0.5; // rad, clamp on whole-torso lean
const NECK_CAP = 0.55; // rad, clamp neck away from rest
const HEAD_CAP = 0.85; // rad, clamp head away from rest
const ARM_CAP = 2.7; // rad, clamp arm segments away from rest
const LEG_CAP = 1.35; // rad, clamp leg segments away from rest
const HIPS_CLAMP = [-0.65, 0.25]; // m, hips height offset clamp (sit / jump)
const CALIB_FRAMES = 40; // frames sampled for the standing-height baseline

// Landmark index pairs per driven limb segment [from-joint, to-joint]; the
// pair doubles as the visibility gate (both joints must be visible).
const SEGMENTS = {
  leftUpperArm: [LM.shoulderL, LM.elbowL],
  rightUpperArm: [LM.shoulderR, LM.elbowR],
  leftLowerArm: [LM.elbowL, LM.wristL],
  rightLowerArm: [LM.elbowR, LM.wristR],
  leftUpperLeg: [LM.hipL, LM.kneeL],
  rightUpperLeg: [LM.hipR, LM.kneeR],
  leftLowerLeg: [LM.kneeL, LM.ankleL],
  rightLowerLeg: [LM.kneeR, LM.ankleR],
};

// Tracked direction of the neck segment comes from face landmarks instead.
const NECK_VIS = [LM.earL, LM.earR, LM.shoulderL, LM.shoulderR];
const HEAD_VIS = [LM.nose, LM.earL, LM.earR];

// Driven bones in hierarchy order (parents first). anchor = bone whose REST
// position defines this bone's rest direction; parents = candidate nearest
// driven ancestors (first one present in the rig wins).
const DRIVEN = [
  { bone: 'hips', parents: [] }, // torso split (axis-angle), no anchor
  { bone: 'spine', parents: ['hips'] },
  { bone: 'chest', parents: ['spine', 'hips'] },
  { bone: 'neck', parents: ['chest', 'spine', 'hips'], cap: NECK_CAP, anchor: 'head' },
  { bone: 'leftUpperArm', parents: ['chest', 'spine', 'hips'], anchor: 'leftLowerArm', cap: ARM_CAP },
  { bone: 'rightUpperArm', parents: ['chest', 'spine', 'hips'], anchor: 'rightLowerArm', cap: ARM_CAP },
  { bone: 'leftLowerArm', parents: ['leftUpperArm'], anchor: 'leftHand', cap: ARM_CAP },
  { bone: 'rightLowerArm', parents: ['rightUpperArm'], anchor: 'rightHand', cap: ARM_CAP },
  { bone: 'leftUpperLeg', parents: ['hips'], anchor: 'leftLowerLeg', cap: LEG_CAP },
  { bone: 'rightUpperLeg', parents: ['hips'], anchor: 'rightLowerLeg', cap: LEG_CAP },
  { bone: 'leftLowerLeg', parents: ['leftUpperLeg'], anchor: 'leftFoot', cap: LEG_CAP },
  { bone: 'rightLowerLeg', parents: ['rightUpperLeg'], anchor: 'rightFoot', cap: LEG_CAP },
];

// Torso lean is ONE scene-space rotation split across these bones (fractions
// sum to 1): splitting the angle along the same axis composes exactly.
const TORSO_SPLIT = { hips: 0.35, spine: 0.35, chest: 0.3 };

// Bones the frame-based head solver drives separately (after the loop).
const HEAD_BONE = 'head';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Clamp a quaternion's rotation angle away from identity (in place). */
function capRotation(q, maxAng) {
  const ang = 2 * Math.acos(clamp(q.w, -1, 1));
  if (ang <= maxAng || ang < 1e-6) return q;
  const k = Math.sin(maxAng / 2) / (Math.sin(ang / 2) || 1);
  q.x *= k;
  q.y *= k;
  q.z *= k;
  q.w = Math.cos(maxAng / 2);
  return q.normalize();
}

export class MocapController {
  /**
   * @param {{ wasmBase: string, modelUrl: string }} opts
   *   wasmBase: URL of the directory holding the MediaPipe wasm files
   *             (the loader script is <script>-loaded, so it must be
   *             same-origin reachable; the binary is fetched from there too)
   *   modelUrl: URL of the pose_landmarker .task file (fetched)
   */
  constructor(opts) {
    this.opts = opts;
    this.active = false;
    this.mirror = true; // mirror mode: pet acts as the user's reflection
    this.hipsOffset = 0; // target hips-height offset (m), Animator follows it
    // Optional per-detection callback for the skeleton preview window:
    // cb(Float32Array(99) [x,y,visibility x33] | null). Receives the
    // NORMALIZED image-space landmarks (matches the camera picture), not
    // the world-space ones the solver uses.
    this.onLandmarks = null;

    this.vrm = null;
    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this.delegate = 'GPU';

    this._bones = new Map(); // name -> entry (insertion order = DRIVEN order)
    this._conf = new Map(); // bone name -> smoothed 0..1 tracked confidence
    this._pts = null; // Vector3[33] smoothed landmarks (scene space)
    this._vis = null; // Float64Array(33)
    this._lastVideoTime = -1;
    this._personSeen = false;
    this._flat = null; // Float32Array(99) reused for onLandmarks payloads
    this._calib = []; // standing-height samples (scene-space hips y)
    this._baselineY = null;
    this._warnedDetect = false;

    // Key joints refreshed each solve (scene space).
    this._shoulderMid = new THREE.Vector3();
    this._hipMid = new THREE.Vector3();
    this._earMid = new THREE.Vector3();
    this._up = new THREE.Vector3();

    // Scratch (no per-frame allocation in the solve path).
    this._dir = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._qParent = new THREE.Quaternion();
    this._qParentInv = new THREE.Quaternion();
    this._qTrack = new THREE.Quaternion();
    this._qFb = new THREE.Quaternion();
    this._qTarget = new THREE.Quaternion();
    this._qScene = new THREE.Quaternion();
    this._mBasis = new THREE.Matrix4();
  }

  _log(msg) {
    console.log(`[mocap] ${msg}`);
  }

  /**
   * Scene-local REST position of a normalized bone: the normalized rig has
   * identity rest rotations, so summing the .position offsets up to
   * vrm.scene gives the T-pose joint location regardless of current pose.
   */
  _restPos(hb, name) {
    const node = hb.getNormalizedBoneNode(name);
    if (!node) return null;
    const p = new THREE.Vector3();
    for (let n = node; n && n !== this.vrm.scene; n = n.parent) p.add(n.position);
    return p;
  }

  /** Build the rest-pose rig map for a (new) VRM. Idempotent. */
  attach(vrm) {
    this.vrm = vrm;
    this._bones = new Map();
    this._conf = new Map();
    const hb = vrm?.humanoid;
    if (!hb) return;

    for (const spec of DRIVEN) {
      const node = hb.getNormalizedBoneNode(spec.bone);
      if (!node) continue;
      const dRest = new THREE.Vector3();
      if (spec.anchor) {
        const a = this._restPos(hb, spec.anchor);
        const b = this._restPos(hb, spec.bone);
        if (a && b) dRest.subVectors(a, b);
        if (dRest.lengthSq() < 1e-8) continue; // degenerate joint pair
        dRest.normalize();
      }
      let parent = null;
      for (const cand of spec.parents) {
        if (this._bones.has(cand)) {
          parent = cand;
          break;
        }
      }
      this._bones.set(spec.bone, {
        node,
        dRest,
        cap: spec.cap ?? 0,
        torso: spec.bone in TORSO_SPLIT,
        parent, // nearest present driven ancestor
        down: /Arm/.test(spec.bone), // arms relax to hanging down
      });
      this._conf.set(spec.bone, 0);
    }

    this._resetPose();
    this._calib = [];
    this._baselineY = null;
  }

  _resetPose() {
    try {
      this.vrm?.humanoid?.resetNormalizedPose?.();
    } catch (err) {
      this._log(`resetNormalizedPose failed: ${err.message}`);
    }
  }

  /** Start camera + landmarker; resolves when tracking is live. */
  async start() {
    if (this.active) return;
    if (!this.vrm) throw new Error('no VRM model loaded');
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('camera API unavailable');
    }
    this._log('requesting camera...');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.style.display = 'none';
      document.body.appendChild(this.video);
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this._log(`camera ok (${this.video.videoWidth}x${this.video.videoHeight})`);

    await this._ensureLandmarker();
    this._resetPose();
    this._calib = [];
    this._baselineY = null;
    this._personSeen = false;
    this._lastVideoTime = -1;
    this.active = true;
    this._log(`tracking started (delegate=${this.delegate}, mirror=${this.mirror})`);
  }

  async _ensureLandmarker() {
    if (this.landmarker) return;
    this._log('loading pose landmarker (wasm + model)...');
    const fileset = await FilesetResolver.forVisionTasks(this.opts.wasmBase);
    const make = (delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.opts.modelUrl, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minTrackingConfidence: 0.6,
      });
    try {
      this.landmarker = await make(this.delegate);
    } catch (err) {
      if (this.delegate !== 'GPU') throw err;
      this._log(`GPU delegate failed (${err.message}); retrying CPU`);
      this.delegate = 'CPU';
      this.landmarker = await make(this.delegate);
    }
    this._log(`landmarker ready (delegate=${this.delegate})`);
  }

  stop() {
    if (!this.active && !this.stream) return;
    this.active = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this._personSeen = false;
    this.hipsOffset = 0;
    this._log('tracking stopped');
  }

  setMirror(on) {
    if (this.mirror === on) return;
    this.mirror = on;
    this._pts = null; // drop smoothing so the flip applies immediately
    this._log(`mirror ${on ? 'on' : 'off'}`);
  }

  /** Run detection on fresh video frames; refresh smoothed landmarks. */
  _detect(dt) {
    const v = this.video;
    if (!v || v.readyState < 2) return;
    if (v.currentTime === this._lastVideoTime) return;
    this._lastVideoTime = v.currentTime;

    let res;
    try {
      res = this.landmarker.detectForVideo(v, performance.now());
    } catch (err) {
      if (!this._warnedDetect) {
        this._warnedDetect = true;
        this._log(`detectForVideo error: ${err.message}`);
      }
      return;
    }
    const lm = res?.worldLandmarks?.[0];
    if (!lm || lm.length < 33) {
      this._personSeen = false;
      this.onLandmarks?.(null); // tell the preview the person was lost
      return;
    }
    this._personSeen = true;

    // Normalized image-space landmarks for the skeleton preview window.
    if (this.onLandmarks) {
      const lm2 = res.landmarks?.[0];
      if (lm2 && lm2.length >= 33) {
        if (!this._flat) this._flat = new Float32Array(33 * 3);
        for (let i = 0; i < 33; i++) {
          const p = lm2[i];
          this._flat[i * 3] = Number.isFinite(p?.x) ? p.x : 0;
          this._flat[i * 3 + 1] = Number.isFinite(p?.y) ? p.y : 0;
          this._flat[i * 3 + 2] = p?.visibility ?? 1;
        }
        this.onLandmarks(this._flat);
      } else {
        this.onLandmarks(null);
      }
    }

    if (!this._pts) {
      this._pts = Array.from({ length: 33 }, () => new THREE.Vector3());
      this._vis = new Float64Array(33).fill(1);
    }
    const a = 1 - Math.exp(-dt * SMOOTH_HZ);
    const mx = this.mirror ? -1 : 1;
    for (let i = 0; i < 33; i++) {
      const p = lm[i];
      if (!p || !Number.isFinite(p.x)) continue;
      const tgt = this._pts[i];
      tgt.x += (mx * p.x - tgt.x) * a;
      tgt.y += (-p.y - tgt.y) * a;
      tgt.z += (-p.z - tgt.z) * a;
      this._vis[i] = p.visibility ?? 1;
    }
  }

  /**
   * Per-frame driver. The Animator calls this instead of its own pose writes
   * while mocap is active: this method owns the normalized bones and sets
   * `hipsOffset` (the Animator moves vrm.scene.position.y toward it).
   */
  updatePose(dt) {
    if (!this.active) return;
    this._detect(dt);
    if (this._personSeen && this._pts) {
      this._solveBody(dt);
    } else {
      // Nobody in frame: relax everything toward rest gently.
      const k = 1 - Math.exp(-dt * BONE_RATE);
      this._qTarget.identity();
      for (const e of this._bones.values()) e.node.quaternion.slerp(this._qTarget, k);
      this.hipsOffset = 0;
    }
  }

  _refreshJoints() {
    const P = this._pts;
    this._shoulderMid
      .copy(P[LM.shoulderL])
      .add(P[LM.shoulderR])
      .multiplyScalar(0.5);
    this._hipMid.copy(P[LM.hipL]).add(P[LM.hipR]).multiplyScalar(0.5);
    this._earMid.copy(P[LM.earL]).add(P[LM.earR]).multiplyScalar(0.5);
    this._up.subVectors(this._shoulderMid, this._hipMid);
    if (this._up.lengthSq() < 1e-8) this._up.set(0, 1, 0);
    this._up.normalize();
  }

  _solveBody(dt) {
    const V = this._vis;
    this._refreshJoints();

    const torsoVis = Math.min(
      V[LM.shoulderL], V[LM.shoulderR], V[LM.hipL], V[LM.hipR]
    );

    // --- torso lean: one clamped rotation, angle split along one axis.
    let ang = 0;
    let hasAxis = false;
    if (torsoVis >= LIMB_VIS_MIN) {
      this._qTrack.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this._up);
      ang = Math.min(2 * Math.acos(clamp(this._qTrack.w, -1, 1)), TORSO_MAX_TILT);
      if (ang > 1e-4) {
        const s = Math.sin(ang / 2) || 1;
        this._axis.set(this._qTrack.x / s, this._qTrack.y / s, this._qTrack.z / s);
        if (this._axis.lengthSq() > 1e-8) {
          this._axis.normalize();
          hasAxis = true;
        }
      }
    }

    // --- hips height target (from the calibrated standing baseline).
    if (torsoVis >= LIMB_VIS_MIN) {
      if (this._baselineY == null) {
        this._calib.push(this._hipMid.y);
        if (this._calib.length >= CALIB_FRAMES) {
          const sorted = [...this._calib].sort((x, y) => x - y);
          this._baselineY = sorted[Math.floor(sorted.length / 2)];
          this._log(`standing-height baseline: ${this._baselineY.toFixed(3)} m`);
        }
      }
      if (this._baselineY != null) {
        this.hipsOffset = clamp(
          this._hipMid.y - this._baselineY,
          HIPS_CLAMP[0],
          HIPS_CLAMP[1]
        );
      }
    } else {
      this.hipsOffset = 0;
    }

    // --- apply bones in hierarchy order (parents first).
    const k = 1 - Math.exp(-dt * BONE_RATE);
    for (const [name, e] of this._bones) {
      if (name === HEAD_BONE) continue; // frame-solved after the loop
      const parentNode = e.parent ? this._bones.get(e.parent)?.node : null;
      if (parentNode) this._qParent.copy(parentNode.quaternion);
      else this._qParent.identity();
      this._qParentInv.copy(this._qParent).invert();

      if (e.torso) {
        if (hasAxis) {
          const frac = TORSO_SPLIT[name] ?? 0;
          // Carry the scene-space tilt axis into the parent's current frame.
          this._local.copy(this._axis).applyQuaternion(this._qParentInv);
          if (this._local.lengthSq() > 1e-8) {
            this._local.normalize();
            this._qTarget.setFromAxisAngle(this._local, ang * frac);
            e.node.quaternion.slerp(this._qTarget, k);
          }
        } else {
          e.node.quaternion.slerp(this._qTarget.identity(), k);
        }
        continue;
      }

      // --- tracked direction for this bone (scene space), if visible.
      let tracked = false;
      let dir = null;
      if (name === 'neck') {
        tracked = NECK_VIS.every((i) => V[i] >= LIMB_VIS_MIN);
        if (tracked) dir = this._dir.subVectors(this._earMid, this._shoulderMid);
      } else {
        const [from, to] = SEGMENTS[name] ?? [];
        tracked = from !== undefined && V[from] >= LIMB_VIS_MIN && V[to] >= LIMB_VIS_MIN;
        if (tracked) dir = this._dir.subVectors(this._pts[to], this._pts[from]);
      }

      // Confidence fade so limbs appear/leave frame smoothly.
      const prev = this._conf.get(name) ?? 0;
      const conf = prev + ((tracked ? 1 : 0) - prev) * (1 - Math.exp(-dt * CONF_RATE));
      this._conf.set(name, conf);

      if (dir && dir.lengthSq() > 1e-8 && conf > 0.01) {
        dir.normalize();
        this._local.copy(dir).applyQuaternion(this._qParentInv);
        this._qTrack.setFromUnitVectors(e.dRest, this._local);
        if (e.cap) capRotation(this._qTrack, e.cap);
        if (conf >= 1) {
          this._qTarget.copy(this._qTrack);
        } else {
          this._qFb.copy(this._fallbackLocal(e));
          this._qTarget.slerpQuaternions(this._qFb, this._qTrack, conf);
        }
        e.node.quaternion.slerp(this._qTarget, k);
      } else {
        this._qFb.copy(this._fallbackLocal(e));
        if (this._qFb.angleTo(e.node.quaternion) < 1e-3) {
          e.node.quaternion.copy(this._qFb);
        } else {
          e.node.quaternion.slerp(this._qFb, k);
        }
      }
    }

    this._solveHead(dt, k);
  }

  /**
   * Fallback local rotation for an untracked bone: arms hang down along the
   * body, everything else relaxes to rest. Computed against the parent's
   * CURRENT frame so it stays valid as the torso moves.
   */
  _fallbackLocal(e) {
    if (!e.down) return this._qScene.identity();
    // aim the bone's rest direction at "down" expressed in the parent frame
    this._local.set(0, -1, 0).applyQuaternion(this._qParentInv);
    return this._qScene.setFromUnitVectors(e.dRest, this._local.normalize());
  }

  /**
   * Head uses a full frame instead of a single aim: Y = neck direction,
   * Z = face forward (nose ahead of the ear midpoint). This captures
   * yaw/pitch/roll of the skull, which a single aim vector cannot.
   */
  _solveHead(dt, k) {
    const entry = this._bones.get(HEAD_BONE) ?? this._headEntry();
    if (!entry) return;
    const V = this._vis;
    if (!HEAD_VIS.every((i) => V[i] >= LIMB_VIS_MIN)) return;

    const parentQ = this._qParent;
    const neckNode = this._bones.get('neck')?.node ?? entry.node.parent;
    if (neckNode) parentQ.copy(neckNode.quaternion);
    else parentQ.identity();
    this._qParentInv.copy(parentQ).invert();

    const P = this._pts;
    this._dir.subVectors(P[LM.nose], this._earMid); // face forward (scene)
    this._local.copy(this._up); // neck direction = head "up"
    // Orthonormalize: Z perpendicular to Y, then X = Y x Z.
    this._dir.addScaledVector(this._local, -this._dir.dot(this._local));
    if (this._dir.lengthSq() < 1e-6) return;
    this._dir.normalize();
    this._axis.crossVectors(this._local, this._dir);
    if (this._axis.lengthSq() < 1e-8) return;
    this._axis.normalize();

    this._mBasis.makeBasis(this._axis, this._local, this._dir);
    this._qScene.setFromRotationMatrix(this._mBasis);
    this._qTrack.copy(this._qParentInv).multiply(this._qScene);
    capRotation(this._qTrack, entry.cap || HEAD_CAP);
    entry.node.quaternion.slerp(this._qTrack, k);
  }

  /** head is not in the DRIVEN list (frame-solved); look it up lazily. */
  _headEntry() {
    const node = this.vrm?.humanoid?.getNormalizedBoneNode(HEAD_BONE);
    if (!node) return null;
    const entry = { node, dRest: new THREE.Vector3(0, 1, 0), cap: HEAD_CAP, torso: false, parent: 'neck', down: false };
    this._bones.set(HEAD_BONE, entry);
    return entry;
  }
}
