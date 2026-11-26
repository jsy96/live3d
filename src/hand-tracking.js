// Phase 2 interface: camera hand-gesture interaction via MediaPipe Hands (JS).
// The GESTURE values below are the contract; the animator will map them:
//   WAVE      -> happy hop
//   HEAD_PAT  -> petting
//   HEART     -> happy + chat bubble
//   POINT     -> look at the hand
//   OPEN_PALM -> attention / greet
// Not active in this build; no MediaPipe dependency is installed yet.

export const GESTURE = Object.freeze({
  NONE: 'none',
  OPEN_PALM: 'open_palm',
  WAVE: 'wave',
  HEAD_PAT: 'head_pat',
  HEART: 'heart',
  POINT: 'point',
});

export class HandTracker {
  constructor() {
    this.active = false;
    this._cb = null;
  }

  /** Subscribe to gesture events: cb(gesture, confidence, landmarks). */
  onGesture(cb) {
    this._cb = cb;
  }

  /** Request camera permission and start the recognition loop. Phase 2. */
  async start() {
    throw new Error('HandTracker: MediaPipe 手势识别在第二期接入');
  }

  stop() {
    this.active = false;
  }

  /** Phase 2: classify 21 hand landmarks into a GESTURE value. */
  static classify(_landmarks) {
    return GESTURE.NONE;
  }
}
