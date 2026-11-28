import { platform } from '../platform.js';
import { STATE } from '../core/animator.js';

const HEAD_STROKE_PX = 90; // pointer path length over the head needed to pet
const HEAD_STROKE_WINDOW_MS = 900; // path must accumulate within this window

/**
 * Pointer interactions (Pointer Events cover both mouse and touch, so the same
 * code drives the desktop pet and the future phone web page):
 *   - stroke the head   -> petting (happy, leans into the hand)
 *   - drag the body     -> grabbed (window follows on desktop, model follows on web)
 *   - quick tap         -> poke (startled jump)
 *   - double click/tap  -> happy hop
 * Click-through is managed by the main process (cursor polling against the
 * model's bounding rect), so this class only handles gesture recognition.
 */
export class MouseInteractor {
  constructor(viewer, hitTester, animator, hooks = {}) {
    this.viewer = viewer;
    this.hit = hitTester;
    this.animator = animator;
    this.hooks = hooks;

    this.dragging = false;
    this.downAt = 0;
    this.downX = 0;
    this.downY = 0;
    this.downRegion = null;
    this.lastScreenX = 0;
    this.lastScreenY = 0;
    this.dragMoved = 0;

    // Head-stroke accumulator.
    this.stroke = 0;
    this._headLast = null;
    // Last quick tap (for double-tap detection; see _classifyTap).
    this._lastTap = null;
    // Web-mode free rotation: dragging the BACKGROUND (a miss on the pet)
    // spins the turntable continuously; see _move.
    this._orbit = null;
    this._orbitReportedAt = 0;

    this._onMove = (e) => this._move(e);
    this._onDown = (e) => this._down(e);
    this._onUp = (e) => this._up(e);
    this._onDbl = (e) => this._dbl(e);
    this._onLeave = () => {
      document.body.classList.remove('grab');
    };
    this._onWheel = (e) => {
      // Scroll over the pet turns it; over the desktop it scrolls normally.
      if (!this.hit.hit(e.clientX, e.clientY)) return;
      e.preventDefault();
      const step = e.deltaY > 0 ? -45 : 45;
      this.hooks.onWheelRotate?.(step);
    };

    const c = viewer.canvas;
    c.addEventListener('pointermove', this._onMove);
    c.addEventListener('pointerdown', this._onDown);
    c.addEventListener('pointerleave', this._onLeave);
    window.addEventListener('pointerup', this._onUp);
    c.addEventListener('dblclick', this._onDbl);
    c.addEventListener('wheel', this._onWheel, { passive: false });
  }

  dispose() {
    const c = this.viewer.canvas;
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointerleave', this._onLeave);
    window.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('dblclick', this._onDbl);
    c.removeEventListener('wheel', this._onWheel);
  }

  _ndc(e) {
    const c = this.viewer.canvas;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    return { x: (e.clientX / w) * 2 - 1, y: -(e.clientY / h) * 2 + 1 };
  }

  _move(e) {
    const ndc = this._ndc(e);
    this.animator.setPointer(ndc.x, ndc.y);
    this.hooks.onPointerNDC?.(ndc.x, ndc.y);
    const now = performance.now();

    // Background drag (web only): free-angle turntable. On the desktop the
    // background is click-through so this never fires there.
    if (this._orbit) {
      const dx = e.clientX - this._orbit.x;
      this._orbit.x = e.clientX;
      this.viewer.setFacing(this.viewer.facingTarget + dx * 0.45);
      if (now - this._orbitReportedAt > 120) {
        this._orbitReportedAt = now;
        platform.reportFacing(this.viewer.facingTarget); // relayed to phones
      }
      return;
    }

    if (this.dragging) {
      // Use screen coordinates: they stay stable while the window moves underneath.
      const dx = e.screenX - this.lastScreenX;
      const dy = e.screenY - this.lastScreenY;
      this.lastScreenX = e.screenX;
      this.lastScreenY = e.screenY;
      this.dragMoved += Math.hypot(dx, dy);
      this.animator.reportDrag(dx, dy);
      if (platform.isDesktop) {
        platform.moveWindowBy(dx, dy);
      } else {
        // Web page: no window to move; drag the model inside the viewport.
        const cam = this.viewer.camera;
        const h = this.viewer.canvas.clientHeight || 1;
        const worldPerPixel = (2 * Math.tan(((cam.fov * Math.PI) / 180) / 2) * cam.position.z) / h;
        this.animator.nudge(dx * worldPerPixel, -dy * worldPerPixel);
      }
      return;
    }

    const region = this.hit.hit(e.clientX, e.clientY);
    document.body.classList.toggle('grab', region === 'body');

    if (region === 'head') {
      if (this._headLast && now - this._headLast.t < HEAD_STROKE_WINDOW_MS) {
        this.stroke += Math.hypot(e.clientX - this._headLast.x, e.clientY - this._headLast.y);
      } else {
        this.stroke = 0;
      }
      this._headLast = { x: e.clientX, y: e.clientY, t: now };
      if (this.stroke >= HEAD_STROKE_PX || this.animator.state === STATE.PETTING) {
        this.animator.keepPetting();
      }
    } else {
      this._headLast = null;
      this.stroke = 0;
    }
  }

  _down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const region = this.hit.hit(e.clientX, e.clientY);
    if (!region) {
      // Empty space: on the phone this drag rotates the pet (any angle).
      if (!platform.isDesktop) this._orbit = { x: e.clientX };
      return;
    }
    this.downAt = performance.now();
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.lastScreenX = e.screenX;
    this.lastScreenY = e.screenY;
    this.dragMoved = 0;
    this.downRegion = region;
    if (region === 'body') {
      this.dragging = true;
      document.body.classList.add('grabbing');
      document.body.classList.remove('grab');
      this.animator.setState(STATE.GRABBED);
      e.target.setPointerCapture?.(e.pointerId);
    }
  }

  // Quick-tap classifier shared by the body/head release branches. A second
  // quick tap within 350ms and 35px counts as a double TAP: the dblclick event
  // is not reliably fired by mobile browsers, so we detect it ourselves.
  _classifyTap(e) {
    const now = performance.now();
    const isDouble =
      this._lastTap != null &&
      now - this._lastTap.t < 350 &&
      Math.hypot(e.clientX - this._lastTap.x, e.clientY - this._lastTap.y) < 35;
    this._lastTap = isDouble ? null : { x: e.clientX, y: e.clientY, t: now };
    return isDouble;
  }

  _up(e) {
    document.body.classList.remove('grabbing');
    if (this._orbit) {
      this._orbit = null;
      platform.reportFacing(this.viewer.facingTarget); // final angle sync
      return;
    }
    if (this.dragging) {
      this.dragging = false;
      const quick =
        performance.now() - this.downAt < 300 &&
        this.dragMoved < 6 &&
        Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < 6;
      if (quick) {
        if (this._classifyTap(e)) this.animator.excite();
        else this.animator.poke();
      } else {
        this.animator.release();
      }
    } else if (this.downRegion === 'head') {
      const quick =
        performance.now() - this.downAt < 300 &&
        Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < 6;
      if (quick) {
        if (this._classifyTap(e)) this.animator.excite();
        else this.animator.poke();
      }
    }
    this.downRegion = null;
  }

  _dbl(e) {
    if (this.hit.hit(e.clientX, e.clientY)) this.animator.excite();
  }
}
