// Solver math sanity test for src/core/mocap.js (no camera needed).
// Builds a synthetic T-pose VRM rig, injects synthetic scene-space landmark
// points, runs updatePose to convergence, and asserts that each driven
// bone's WORLD direction matches the tracked segment direction.
//
// Run:  npm run build:test  (esbuild -> dist/test-mocap.mjs)  then  node dist/test-mocap.mjs
// (The direct .js import does not work under Node because the package has
// no "type": "module"; bundling to .mjs sidesteps that.)

import * as THREE from 'three';
import { MocapController } from '../src/core/mocap.js';

// --- synthetic T-pose rig (rest positions, world coords, meters) ---
const REST = {
  hips: [0, 0.90, 0],
  spine: [0, 1.00, 0],
  chest: [0, 1.10, 0],
  neck: [0, 1.35, 0],
  head: [0, 1.45, 0],
  leftUpperArm: [0.08, 1.35, 0],
  leftLowerArm: [0.32, 1.35, 0],
  leftHand: [0.56, 1.35, 0],
  rightUpperArm: [-0.08, 1.35, 0],
  rightLowerArm: [-0.32, 1.35, 0],
  rightHand: [-0.56, 1.35, 0],
  leftUpperLeg: [0.10, 0.85, 0],
  leftLowerLeg: [0.10, 0.45, 0],
  leftFoot: [0.10, 0.05, 0],
  rightUpperLeg: [-0.10, 0.85, 0],
  rightLowerLeg: [-0.10, 0.45, 0],
  rightFoot: [-0.10, 0.05, 0],
};
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  leftUpperArm: 'chest', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightUpperArm: 'chest', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg',
};

function buildRig() {
  const scene = new THREE.Object3D(); // stands in for vrm.scene
  const nodes = {};
  for (const [name, pos] of Object.entries(REST)) {
    const n = new THREE.Object3D();
    const p = new THREE.Vector3(...pos);
    const parentPos = PARENT[name] ? new THREE.Vector3(...REST[PARENT[name]]) : new THREE.Vector3();
    n.position.copy(p).sub(parentPos);
    nodes[name] = n;
  }
  for (const [name, parent] of Object.entries(PARENT)) {
    (parent ? nodes[parent] : scene).add(nodes[name]);
  }
  return { scene, nodes };
}

function makeMockVrm() {
  const { scene, nodes } = buildRig();
  return {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name) => nodes[name] ?? null,
      resetNormalizedPose: () => {
        for (const n of Object.values(nodes)) n.quaternion.identity();
      },
    },
  };
}

// Landmark indices used by the solver.
const IDX = {
  nose: 0, earL: 7, earR: 8,
  shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28,
};

/** Fill mocap._pts (scene space) + _vis from named joint positions. */
function inject(mocap, joints) {
  const pts = Array.from({ length: 33 }, () => new THREE.Vector3());
  const vis = new Float64Array(33).fill(1);
  const set = (i, x, y, z) => pts[i].set(x, y, z);
  const S = joints;
  set(IDX.nose, 0, 1.55, 0.09);
  set(IDX.earL, 0.07, 1.52, 0);
  set(IDX.earR, -0.07, 1.52, 0);
  set(IDX.shoulderL, 0.18, 1.38, 0);
  set(IDX.shoulderR, -0.18, 1.38, 0);
  set(IDX.hipL, 0.10, 0.88, 0);
  set(IDX.hipR, -0.10, 0.88, 0);
  set(IDX.elbowL, ...S.elbowL);
  set(IDX.wristL, ...S.wristL);
  set(IDX.elbowR, ...S.elbowR);
  set(IDX.wristR, ...S.wristR);
  set(IDX.kneeL, ...S.kneeL);
  set(IDX.ankleL, ...S.ankleL);
  set(IDX.kneeR, ...S.kneeR);
  set(IDX.ankleR, ...S.ankleR);
  mocap._pts = pts;
  mocap._vis = vis;
  mocap._personSeen = true;
}

/** World-space direction of a bone after the solver ran (independent recompute). */
function worldDir(nodes, name, anchor) {
  const q = new THREE.Quaternion();
  let n = nodes[name];
  const chain = [];
  for (let x = n; x; x = x.parent) chain.unshift(x);
  for (const x of chain) q.multiply(x.quaternion);
  const d = new THREE.Vector3(...REST[anchor]).sub(new THREE.Vector3(...REST[name]));
  return d.applyQuaternion(q).normalize();
}

const angleBetween = (a, b) => Math.acos(Math.min(1, Math.max(-1, a.dot(b))));

function run(label, joints, checks) {
  const vrm = makeMockVrm();
  const mocap = new MocapController({ wasmBase: '', modelUrl: '' });
  mocap.attach(vrm);
  mocap.active = true;
  inject(mocap, joints);
  for (let i = 0; i < 400; i++) mocap.updatePose(1 / 60); // converge damping
  const nodes = getNodes(vrm);
  let failed = 0;
  for (const [bone, anchor, expected] of checks) {
    const got = worldDir(nodes, bone, anchor);
    const err = angleBetween(got, new THREE.Vector3(...expected).normalize());
    const ok = err < 0.12;
    if (!ok) failed++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} [${label}] ${bone}: angle error ${(err * 180 / Math.PI).toFixed(1)} deg`
    );
  }
  return failed;
}

// nodes lookup helper (walks the rig; the mock keeps them on the scene tree)
function getNodes(vrm) {
  const nodes = {};
  for (const name of Object.keys(REST)) {
    nodes[name] = vrm.humanoid.getNormalizedBoneNode(name);
  }
  return nodes;
}

let failures = 0;

// T-pose: arms horizontal sideways -> arm bones stay at rest.
failures += run('T-pose', {
  elbowL: [0.45, 1.38, 0], wristL: [0.70, 1.38, 0],
  elbowR: [-0.45, 1.38, 0], wristR: [-0.70, 1.38, 0],
  kneeL: [0.10, 0.45, 0], ankleL: [0.10, 0.05, 0],
  kneeR: [-0.10, 0.45, 0], ankleR: [-0.10, 0.05, 0],
}, [
  ['leftUpperArm', 'leftLowerArm', [1, 0, 0]],
  ['leftLowerArm', 'leftHand', [1, 0, 0]],
  ['rightUpperArm', 'rightLowerArm', [-1, 0, 0]],
  ['leftUpperLeg', 'leftLowerLeg', [0, -1, 0]],
]);

// Arms raised 45 degrees up: upper arm aims up-outward.
const c45 = Math.cos(Math.PI / 4), s45 = Math.sin(Math.PI / 4);
failures += run('arms-45-up', {
  elbowL: [0.18 + 0.27 * c45, 1.38 + 0.27 * s45, 0], wristL: [0.18 + 0.54 * c45, 1.38 + 0.54 * s45, 0],
  elbowR: [-0.18 - 0.27 * c45, 1.38 + 0.27 * s45, 0], wristR: [-0.18 - 0.54 * c45, 1.38 + 0.54 * s45, 0],
  kneeL: [0.10, 0.45, 0], ankleL: [0.10, 0.05, 0],
  kneeR: [-0.10, 0.45, 0], ankleR: [-0.10, 0.05, 0],
}, [
  ['leftUpperArm', 'leftLowerArm', [c45, s45, 0]],
  ['rightUpperArm', 'rightLowerArm', [-c45, s45, 0]],
]);

// Arm reaching forward (+Z): upper arm aims toward the camera.
failures += run('arm-forward', {
  elbowL: [0.18, 1.38, 0.27], wristL: [0.20, 1.38, 0.55],
  elbowR: [-0.45, 1.38, 0], wristR: [-0.70, 1.38, 0],
  kneeL: [0.10, 0.45, 0], ankleL: [0.10, 0.05, 0],
  kneeR: [-0.10, 0.45, 0], ankleR: [-0.10, 0.05, 0],
}, [
  ['leftUpperArm', 'leftLowerArm', [0.1, 0, 1]],
  ['rightUpperArm', 'rightLowerArm', [-1, 0, 0]],
]);

// Torso lean to the user's right (scene -X): hips..chest compose to tilt.
{
  const vrm = makeMockVrm();
  const mocap = new MocapController({ wasmBase: '', modelUrl: '' });
  mocap.attach(vrm);
  mocap.active = true;
  const tilt = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), -0.4);
  const pts = Array.from({ length: 33 }, () => new THREE.Vector3());
  const vis = new Float64Array(33).fill(1);
  // shoulder midpoint = hips + tilted up-vector * torso length (0.5 m)
  const smid = new THREE.Vector3(0, 0.88, 0).addScaledVector(tilt, 0.5);
  pts[IDX.shoulderL].copy(smid).add(new THREE.Vector3(0.18, 0, 0));
  pts[IDX.shoulderR].copy(smid).add(new THREE.Vector3(-0.18, 0, 0));
  pts[IDX.hipL].set(0.10, 0.88, 0);
  pts[IDX.hipR].set(-0.10, 0.88, 0);
  pts[IDX.earL].set(0.07, 1.52, 0);
  pts[IDX.earR].set(-0.07, 1.52, 0);
  pts[IDX.nose].set(0, 1.55, 0.09);
  // arms/legs along the tilted torso (mark them visible with rest-ish dirs)
  pts[IDX.elbowL].copy(smid).add(new THREE.Vector3(0.27, 0, 0));
  pts[IDX.wristL].copy(smid).add(new THREE.Vector3(0.52, 0, 0));
  pts[IDX.elbowR].copy(smid).add(new THREE.Vector3(-0.27, 0, 0));
  pts[IDX.wristR].copy(smid).add(new THREE.Vector3(-0.52, 0, 0));
  pts[IDX.kneeL].set(0.10, 0.45, 0); pts[IDX.ankleL].set(0.10, 0.05, 0);
  pts[IDX.kneeR].set(-0.10, 0.45, 0); pts[IDX.ankleR].set(-0.10, 0.05, 0);
  mocap._pts = pts;
  mocap._vis = vis;
  mocap._personSeen = true;
  for (let i = 0; i < 400; i++) mocap.updatePose(1 / 60);
  // composed torso rotation (hips*spine*chest) should map +Y to the tilt.
  const nodes = getNodes(vrm);
  const q = new THREE.Quaternion();
  for (const n of [nodes.hips, nodes.spine, nodes.chest]) q.multiply(n.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const err = angleBetween(up, tilt.normalize());
  const ok = err < 0.1;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [torso-lean] composed tilt error ${(err * 180 / Math.PI).toFixed(1)} deg`);
}

// Head yaw: nose swung to scene +X should rotate the head bone about Y.
{
  const vrm = makeMockVrm();
  const mocap = new MocapController({ wasmBase: '', modelUrl: '' });
  mocap.attach(vrm);
  mocap.active = true;
  inject(mocap, {
    elbowL: [0.45, 1.38, 0], wristL: [0.70, 1.38, 0],
    elbowR: [-0.45, 1.38, 0], wristR: [-0.70, 1.38, 0],
    kneeL: [0.10, 0.45, 0], ankleL: [0.10, 0.05, 0],
    kneeR: [-0.10, 0.45, 0], ankleR: [-0.10, 0.05, 0],
  });
  mocap._pts[IDX.nose].set(0.12, 1.53, 0.02); // face turned toward +X
  for (let i = 0; i < 400; i++) mocap.updatePose(1 / 60);
  const head = vrm.humanoid.getNormalizedBoneNode('head');
  const yaw = 2 * Math.acos(Math.min(1, Math.max(-1, head.quaternion.w)));
  const comp = new THREE.Quaternion();
  {
    const nodes = getNodes(vrm);
    for (const n of [nodes.hips, nodes.spine, nodes.chest, nodes.neck]) comp.multiply(n.quaternion);
  }
  const local = head.quaternion;
  // The head local rotation must have a Y-axis (yaw) component.
  const yawAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(comp.invert());
  const proj = 2 * Math.atan2(
    local.x * yawAxis.x + local.y * yawAxis.y + local.z * yawAxis.z,
    local.w
  );
  const ok = proj > 0.5; // clearly nonzero yaw
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [head-yaw] local yaw magnitude ${proj.toFixed(2)} rad`);
}

console.log(failures === 0 ? '\nALL SOLVER TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
