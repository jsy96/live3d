// Phase 4: the pet roams between the desktop and phone web clients.
// Transport = WebSocket at /ws on the LAN HTTP server (main/lan.js hosts it;
// that side speaks the same event vocabulary). This module is the
// phone-browser side plus the shared event names.
//
// Message shapes (JSON text frames):
//   phone -> PC : { type: 'hello', ua }
//                 { type: 'pick', what: 'model'|'animation'|'facing'|'roam',
//                                value: <basename | null | degrees | 'phone'|'desktop'> }
//   PC -> phone : { type: 'state', model?: {path,url}, animation?: {path,url}|null,
//                          facing?: degrees }   (omitted field = unchanged)
//                 { type: 'play', entry: {path,url} }
//                 { type: 'roam', cmd: 'enter' | 'exit' }
// 'roam exit' tells the client to play the run-off animation and stow the pet;
// 'roam enter' brings it back with a run-in animation.

export const ROAMING_EVENTS = Object.freeze({
  HELLO: 'hello', // phone announcing itself to the desktop host
  STATE: 'state', // model / animation / facing sync (partial updates)
  PLAY: 'play', // one-shot clip broadcast (--play / poke reactions)
  PICK: 'pick', // phone-side selection flowing back to the PC
  ROAM: 'roam', // hand-off animation commands
});

const RECONNECT_MS = 2000;

// Stable per-device tag so the desktop can tell several phones apart in the
// hand-off chooser ("Phone·a1b2"). Stored in localStorage; random fallback.
function deviceName() {
  try {
    let tag = localStorage.getItem('live3d-name');
    if (!tag) {
      tag = Math.random().toString(36).slice(2, 6);
      localStorage.setItem('live3d-name', tag);
    }
    return `Phone·${tag}`;
  } catch {
    return 'Phone';
  }
}

export class RoamingClient {
  constructor() {
    this.ws = null;
    this.url = null;
    this.name = deviceName();
    this.handlers = new Map(); // event type -> cb[]
    this.closedByUs = false;
    this._retryTimer = null;
  }

  /** Connect to the LAN host; resolves true once the socket is open. Keeps
   *  retrying in the background (PC restarted / Wi-Fi blip) until close(). */
  connect(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
    this.url = url;
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        done(false);
        this._reconnectLater();
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.send(ROAMING_EVENTS.HELLO, { ua: navigator.userAgent, name: this.name });
        done(true);
      };
      ws.onerror = () => done(false);
      ws.onclose = () => {
        done(false);
        this._reconnectLater();
      };
      ws.onmessage = (ev) => this._dispatch(ev.data);
    });
  }

  _reconnectLater() {
    if (this.closedByUs || !this.url) return;
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      if (!this.closedByUs) this.connect(this.url);
    }, RECONNECT_MS);
  }

  _dispatch(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    for (const cb of this.handlers.get(msg.type) ?? []) {
      try {
        cb(msg);
      } catch (err) {
        console.error(`[ai-live3d] roaming handler ${msg.type}: ${err?.message ?? err}`);
      }
    }
  }

  on(type, cb) {
    const list = this.handlers.get(type) ?? [];
    list.push(cb);
    this.handlers.set(type, list);
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this._retryTimer);
    this.ws?.close();
    this.ws = null;
  }
}
