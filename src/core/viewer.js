import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { applyAPose } from './pose.js';

/**
 * Three.js scene wrapper: transparent background (desktop-pet window),
 * camera auto-fit to the loaded model, and a look-at target driven by the pointer.
 */
export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, 1.2, 3.2);

  // three r155+ uses physically based light units by default; VRM MToon
  // materials expect roughly PI-scaled intensities. Keep ambient modest so
  // model colors stay saturated (too much ambient washes them out).
  const sun = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
  sun.position.set(0.6, 1.0, 1.2);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35 * Math.PI));

  // Invisible object the VRM's eyes track; moved by setLookFromPointer().
  const lookTarget = new THREE.Object3D();
  scene.add(lookTarget);

  // Intermediate group the model lives in. The animator owns vrm.scene.position
  // (hips-height .y, browser drag offset .x/.y), so the roaming hand-off
  // animation (pet runs off / in through the screen edge) drives THIS group
  // instead — the two mechanisms never fight over the same transform.
  const petRoot = new THREE.Group();
  scene.add(petRoot);

  let current = null;
  // Roaming run animation state: { from, to, t, dur, onDone } on petRoot.x.
  let roam = null;
  // Facing (turntable) state in degrees: 0 = front, ±45 = three-quarter,
  // ±90 = side, 180 = back. Damped so the turn never snaps.
  const facing = { current: 0, target: 0 };
  // Base yaw VRMUtils.rotateVRM0 put on the scene (VRM 0.x models need
  // +180° to face the camera). updateFacing must ADD to it, not replace it
  // — writing facing alone wipes the correction and the pet shows its back.
  let baseYaw = 0;

  function fitRenderer() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  fitRenderer();
  window.addEventListener('resize', fitRenderer);

  return {
    renderer,
    scene,
    camera,
    canvas,
    lookTarget,
    petRoot,
    get vrm() {
      return current;
    },
    set vrm(v) {
      current = v;
    },
    get petVisible() {
      return petRoot.visible;
    },
    setPetVisible(v) {
      petRoot.visible = v;
    },
    /** Horizontal world distance that clears the camera view (plus margin) —
     *  how far the pet must travel to be fully off-screen. */
    runSpan() {
      const vfov = (camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(camera.aspect, 0.2));
      return Math.tan(hfov / 2) * camera.position.length() + 0.6;
    },
    /** 'exit': run off the LEFT edge (ease-in, accelerating away).
     *  'enter': run in FROM the right edge (ease-out, arriving softly). */
    startRoam(kind, onDone) {
      const span = this.runSpan();
      roam =
        kind === 'exit'
          ? { from: 0, to: -span, t: 0, dur: 0.9, onDone }
          : { from: span, to: 0, t: 0, dur: 0.9, onDone };
      petRoot.position.x = roam.from;
    },
    updateRoam(dt) {
      if (!roam) return;
      roam.t += dt;
      const k = Math.min(roam.t / roam.dur, 1);
      const e = roam.to === 0 ? 1 - Math.pow(1 - k, 3) : k * k;
      petRoot.position.x = roam.from + (roam.to - roam.from) * e;
      // Lean into the (always leftward) run, straightening out at both ends.
      petRoot.rotation.z = -0.12 * Math.sin(Math.PI * k);
      if (k >= 1) {
        const done = roam.onDone;
        roam = null;
        petRoot.rotation.z = 0;
        done?.();
      }
    },
    get facingTarget() {
      return facing.target;
    },
    setFacing(deg) {
      facing.target = deg;
    },
    // Called by loadVRM right after rotateVRM0 so the turntable composes on
    // top of the model's native facing correction.
    setBaseYaw(rad) {
      baseYaw = rad;
    },
    updateFacing(dt) {
      if (current) {
        // Shortest-path damping toward the target angle.
        // NOTE: current is the VRM instance — the Object3D is vrm.scene.
        const diff = ((((facing.target - facing.current) % 360) + 540) % 360) - 180;
        facing.current += diff * (1 - Math.exp(-dt * 8));
        current.scene.rotation.y = baseYaw + (facing.current * Math.PI) / 180;
      }
    },
    render() {
      renderer.render(scene, camera);
    },
    setLookFromPointer(nx, ny) {
      // Place the look target in front of the camera, offset by pointer NDC.
      lookTarget.position.set(
        camera.position.x + nx * 1.4,
        camera.position.y + ny * 0.9,
        camera.position.z - 2.5
      );
    },
  };
}

/**
 * Bone-joint based bounds: reflects the CURRENT pose (A-pose, applied before
 * this runs). Box3.setFromObject would use skinned bind-pose geometry, i.e.
 * the T-pose arm span, regardless of the pose we actually display.
 */
function computePoseBounds(vrm) {
  const hb = vrm.humanoid;
  const names = ['head', 'hips', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes'];
  const pts = [];
  const tmp = new THREE.Vector3();
  if (hb) {
    for (const name of names) {
      const node = hb.getNormalizedBoneNode(name);
      if (node) pts.push(node.getWorldPosition(tmp).clone());
    }
  }
  if (pts.length < 4) {
    return new THREE.Box3().setFromObject(vrm.scene);
  }
  const box = new THREE.Box3().setFromPoints(pts);
  const spanY = Math.max(box.max.y - box.min.y, 0.1);
  const pad = spanY * 0.3;
  box.min.y -= pad * 0.6; // soles below the ankle joint
  box.max.y += pad * 1.0; // skull above the head joint
  box.min.x -= pad * 0.6; // body thickness beyond joints
  box.max.x += pad * 0.6;
  return box;
}

function fitCameraToModel(viewer, vrm) {
  viewer.vrm.scene.updateMatrixWorld(true);
  const box = computePoseBounds(vrm);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, 0.05);
  const vfov = (viewer.camera.fov * Math.PI) / 180;
  const aspect = Math.max(viewer.camera.aspect, 0.2);
  // Fit BOTH axes: vertical (body height) and horizontal (arm span) — a
  // height-only fit clips hands on the narrow portrait window.
  const distV = (height / 2) / Math.tan(vfov / 2);
  const distH = (Math.max(size.x, height * 0.55) / 2) / (Math.tan(vfov / 2) * aspect);
  const dist = Math.max(distV, distH) * 1.15;
  viewer.camera.position.set(center.x, center.y + height * 0.02, center.z + dist);
  viewer.camera.lookAt(center.x, center.y + height * 0.05, center.z);
  viewer.camera.updateProjectionMatrix();
}

export async function loadVRM(viewer, url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) {
    throw new Error('not a VRM file (no VRM extension found)');
  }

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (typeof VRMUtils.combineSkeletons === 'function') {
    VRMUtils.combineSkeletons(gltf.scene);
  } else if (typeof VRMUtils.removeUnnecessaryJoints === 'function') {
    VRMUtils.removeUnnecessaryJoints(gltf.scene);
  }
  // VRM 0.x models face -Z; rotate so the pet faces the camera (+Z).
  VRMUtils.rotateVRM0(vrm);
  // Remember the correction: updateFacing composes the turntable ON TOP of
  // it (replacing scene.rotation.y outright would re-break VRM 0.x facing).
  viewer.setBaseYaw(vrm.scene.rotation.y);

  if (viewer.vrm) {
    viewer.petRoot.remove(viewer.vrm.scene);
    VRMUtils.deepDispose(viewer.vrm.scene);
  }
  viewer.vrm = vrm;
  viewer.petRoot.add(vrm.scene);
  // Relax the arms before framing: the camera fit must see the pose the pet
  // will actually stand in, not the T-pose.
  applyAPose(vrm);
  if (vrm.lookAt) {
    vrm.lookAt.target = viewer.lookTarget;
  }
  fitCameraToModel(viewer, vrm);
  return vrm;
}
