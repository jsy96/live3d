// Skeleton preview window for camera mocap.
//
// PURE SKELETON VIEW: renders only the tracked 33-keypoint pose on a dark
// backdrop — no camera image is shown or even opened (the preview owns no
// MediaStream at all). Landmark data flows from the pet renderer (which
// owns the tracking camera + landmarker) via ipc 'mocap:landmarks' relayed
// by the main process.
//
// Style: MediaPipe-classic skeleton — cyan bone edges, white joints,
// low-visibility joints in red, unseen joints omitted.

import { PoseLandmarker } from '@mediapipe/tasks-vision';

const CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS; // [{start, end}]
const JOINT_COUNT = 33;
const DATA_FRESH_MS = 1500; // older landmark data = person lost

const canvas = document.getElementById('skeleton');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d');

let lm = null; // Float32Array(JOINT_COUNT * 3): x, y, visibility
let lastData = 0; // performance.now() of the last landmark update
let updates = 0; // landmark updates counted for the Hz readout
let hzWindowStart = performance.now();
let hz = 0;

// Landmarks are normalized to the camera's 4:3 frame; letterbox that into
// the canvas so the skeleton keeps its proportions at any window size.
// Mirrored X (1 - x) matches the pet's mirror mode.
function project(nx, ny) {
  const s = Math.min(canvas.width / 4, canvas.height / 3);
  const ox = (canvas.width - 4 * s) / 2;
  const oy = (canvas.height - 3 * s) / 2;
  return [ox + (1 - nx) * 4 * s, oy + ny * 3 * s];
}

function drawSkeleton() {
  const fresh = lm && performance.now() - lastData < DATA_FRESH_MS;
  if (!fresh) return;
  const scale = Math.min(canvas.width / 4, canvas.height / 3);
  ctx.lineWidth = Math.max(2, scale / 45);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(85, 220, 255, 0.9)';
  ctx.beginPath();
  for (const c of CONNECTIONS) {
    const a = c.start;
    const b = c.end;
    if (a >= JOINT_COUNT || b >= JOINT_COUNT) continue;
    const va = lm[a * 3 + 2] ?? 1;
    const vb = lm[b * 3 + 2] ?? 1;
    if (va < 0.4 && vb < 0.4) continue; // both ends invisible: skip the bone
    const [ax, ay] = project(lm[a * 3], lm[a * 3 + 1]);
    const [bx, by] = project(lm[b * 3], lm[b * 3 + 1]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();

  const r = Math.max(2.5, scale / 30);
  for (let i = 0; i < JOINT_COUNT; i++) {
    const v = lm[i * 3 + 2] ?? 1;
    if (v < 0.25) continue; // unseen joint: no dot
    const [x, y] = project(lm[i * 3], lm[i * 3 + 1]);
    ctx.beginPath();
    ctx.fillStyle = v >= 0.55 ? '#ffffff' : 'rgba(255, 120, 100, 0.95)';
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function updateStatus(tracking) {
  const text = tracking ? `● 跟踪中 · ${hz}/s` : '未检测到人体';
  if (statusEl.textContent !== text) statusEl.textContent = text;
  statusEl.classList.toggle('ok', tracking);
}

let lastCanvasW = -1;
let lastCanvasH = -1;
function fitCanvasIfChanged() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round((canvas.clientWidth || 320) * dpr);
  const h = Math.round((canvas.clientHeight || 240) * dpr);
  if (w !== lastCanvasW || h !== lastCanvasH) {
    lastCanvasW = w;
    lastCanvasH = h;
    canvas.width = w;
    canvas.height = h;
  }
}

function frame() {
  requestAnimationFrame(frame);
  fitCanvasIfChanged();
  ctx.fillStyle = '#15171c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawSkeleton();
  const fresh = lm && performance.now() - lastData < DATA_FRESH_MS;
  updateStatus(!!fresh);
}

// Landmark data from the tracking pipeline (via main-process relay).
window.live3d?.onMocapLandmarks?.((data) => {
  updates++;
  const now = performance.now();
  if (now - hzWindowStart >= 1000) {
    hz = Math.round((updates * 1000) / (now - hzWindowStart));
    updates = 0;
    hzWindowStart = now;
  }
  if (data && data.lm) {
    lm = data.lm;
    lastData = now;
  } else {
    lm = null; // person lost
  }
});

frame();
