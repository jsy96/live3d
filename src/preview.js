// Skeleton preview window for camera mocap.
//
// Shows the webcam image with the tracked 33-keypoint pose skeleton drawn
// on top (MediaPipe's classic visualization style: dimmed video backdrop,
// cyan bone edges, white joints, low-visibility joints in red).
//
// Data flow: pet renderer (which owns the tracking camera + landmarker)
// -> ipc 'mocap:landmarks' -> main process relay -> this window. The
// preview opens its own DISPLAY-ONLY camera stream so video pixels never
// travel over IPC and the tracking pipeline is untouched. If the second
// camera open fails, the skeleton is still drawn over a black background.

import { PoseLandmarker } from '@mediapipe/tasks-vision';

const CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS; // [{start, end}]
const JOINT_COUNT = 33;
const DATA_FRESH_MS = 1500; // older landmark data = person lost

const video = document.getElementById('cam');
const canvas = document.getElementById('skeleton');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d');

let lm = null; // Float32Array(JOINT_COUNT * 3): x, y, visibility
let lastData = 0; // performance.now() of the last landmark update
let camOk = false;
let updates = 0; // landmark updates counted for the Hz readout
let hzWindowStart = performance.now();
let hz = 0;

// Mirror view, like looking into a mirror: the video element flips X via
// CSS and landmarks are drawn at (1 - x). This matches the pet's default
// mirror mode, so "my left hand" is on the same side in both views.

async function openCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    camOk = true;
  } catch (err) {
    console.error(`[preview] camera open failed: ${err.message}`);
    camOk = false;
  }
}

/** Map a normalized landmark to canvas px with letterboxing + mirroring. */
function project(nx, ny) {
  // Video display rect (object-fit: contain) inside the canvas.
  const vw = camOk && video.videoWidth ? video.videoWidth : 4;
  const vh = camOk && video.videoHeight ? video.videoHeight : 3;
  const s = Math.min(canvas.width / vw, canvas.height / vh);
  const ox = (canvas.width - vw * s) / 2;
  const oy = (canvas.height - vh * s) / 2;
  return [ox + (1 - nx) * vw * s, oy + ny * vh * s];
}

function drawSkeleton() {
  const fresh = lm && performance.now() - lastData < DATA_FRESH_MS;
  if (!fresh) return;
  ctx.lineWidth = Math.max(2, canvas.width / 160);
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

  const r = Math.max(2.5, canvas.width / 110);
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
  let text;
  if (!camOk) {
    text = tracking ? `仅骨骼（摄像头打开失败）· ${hz}/s` : '摄像头打开失败，仅骨骼显示';
  } else if (tracking) {
    text = `● 跟踪中 · ${hz}/s`;
  } else {
    text = '未检测到人体';
  }
  if (statusEl.textContent !== text) statusEl.textContent = text;
  statusEl.classList.toggle('ok', tracking);
}

function frame() {
  requestAnimationFrame(frame);
  fitCanvasIfChanged();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Dim the camera image so the skeleton pops.
  if (camOk && video.videoWidth) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const fresh = lm && performance.now() - lastData < DATA_FRESH_MS;
  drawSkeleton();
  updateStatus(!!fresh);
}

let lastCanvasW = -1;
let lastCanvasH = -1;
function fitCanvasIfChanged() {
  const w = Math.round((canvas.clientWidth || 320) * Math.min(window.devicePixelRatio || 1, 2));
  const h = Math.round((canvas.clientHeight || 240) * Math.min(window.devicePixelRatio || 1, 2));
  if (w !== lastCanvasW || h !== lastCanvasH) {
    lastCanvasW = w;
    lastCanvasH = h;
    canvas.width = w;
    canvas.height = h;
  }
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

// Release the display camera when the window closes.
window.addEventListener('pagehide', () => {
  video.srcObject?.getTracks().forEach((t) => t.stop());
});

openCamera();
frame();
