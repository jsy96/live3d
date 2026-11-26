import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

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

  let current = null;

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
    get vrm() {
      return current;
    },
    set vrm(v) {
      current = v;
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

function fitCameraToModel(viewer, vrm) {
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const height = Math.max(box.max.y - box.min.y, 0.05);
  const center = box.getCenter(new THREE.Vector3());
  const fovRad = (viewer.camera.fov * Math.PI) / 180;
  const dist = (height / 2) / Math.tan(fovRad / 2) * 1.15;
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

  if (viewer.vrm) {
    viewer.scene.remove(viewer.vrm.scene);
    VRMUtils.deepDispose(viewer.vrm.scene);
  }
  viewer.vrm = vrm;
  viewer.scene.add(vrm.scene);
  if (vrm.lookAt) {
    vrm.lookAt.target = viewer.lookTarget;
  }
  fitCameraToModel(viewer, vrm);
  return vrm;
}
