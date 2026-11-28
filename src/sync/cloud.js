// Cloud sync lane (CDN mode): Tencent CloudBase realtime database.
//
// The PC WebSocket (sync/roaming.js) stays the fast lane while the computer
// is online, but the cloud lane is the always-on backbone that needs NO
// computer at all: every device that opens the page anonymously signs in,
// watches one shared document (pet_state/global) and converges on its state.
// Cross-device sync therefore survives the PC being off for good.
//
// Document shape (basenames only — the page resolves them against its own
// assets catalog, so the doc stays valid wherever the files are hosted):
//   { model: 'Seed-san.vrm'|null, animation: 'dance_2.vrma'|null,
//     play: { name, ts, from }|null, ts: <last write ms>, from: <device tag> }
//
// Event vocabulary matches the roaming WS lanes ('state' / 'play'), so the
// platform multiplexer can fan both lanes into the same callbacks.
const COLLECTION = 'pet_state';
const DOC_ID = 'global';


// Per-device tag stored in localStorage: echoes of our own writes come back
// through the watch and are dropped by `from` (+ ts for one-shots).
function clientId() {
  try {
    let tag = localStorage.getItem('live3d-cloud-id');
    if (!tag) {
      tag = `web-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem('live3d-cloud-id', tag);
    }
    return tag;
  } catch {
    return `web-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export class CloudPetSync {
  constructor() {
    this.handlers = new Map();
    this.id = clientId();
    this.app = null; // cloudbase app (created once, session persists locally)
    this.db = null;
    this.watcher = null;
    this.closedByUs = false;
    this.lastDoc = null; // previous snapshot, for change-only dispatch
    this.lastPlayTs = 0;
    this.retryTimer = null;
    this.envId = null;
  }

  /** Entry point: anonymous sign-in + watch, retrying in the background on
   *  any failure (SDK load, auth disabled, env briefly unreachable). */
  start(envId) {
    this.envId = envId;
    this._connect().catch((err) => {
      console.warn(`[ai-live3d] cloud sync failed: ${err?.message ?? err} (retrying)`);
      this._reconnectLater();
    });
  }

  async _connect() {
    if (!this.app) {
      // Dynamic import keeps the SDK (and its ~250 KB) out of the desktop
      // and LAN bundles — only CDN pages that open the cloud lane pay it.
      // Importing the modules self-registers their components (auth /
      // database / realtime — realtime injects the ws client class the
      // database's watch() needs); calling register* again just warns
      // "Duplicate component".
      const [{ default: cloudbase }] = await Promise.all([
        import('@cloudbase/js-sdk/app'),
        import('@cloudbase/js-sdk/auth'),
        import('@cloudbase/js-sdk/database'),
        import('@cloudbase/js-sdk/realtime'),
      ]);
      this.app = cloudbase.init({ env: this.envId });
      const auth = this.app.auth({ persistence: 'local' });
      // A persisted anonymous session survives reloads; only sign in fresh.
      if (!auth.currentUser) await auth.signInAnonymously({});
    }
    this.db = this.app.database();
    // v3 SDK: watch callbacks are onChange/onError (v1's onSnapshot is gone).
    // Watch the single shared document by id — doc().watch() injects the
    // {_id} query itself.
    this.watcher = this.db
      .collection(COLLECTION)
      .doc(DOC_ID)
      .watch({
        onChange: (snapshot) => this._onSnapshot(snapshot),
        onError: (err) => {
          console.warn(`[ai-live3d] cloud watch error: ${err?.message ?? err}`);
          this._reconnectLater();
        },
      });
    console.log(`[ai-live3d] cloud sync connected (env: ${this.envId}, id: ${this.id})`);
  }

  _reconnectLater() {
    if (this.closedByUs) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(async () => {
      if (this.closedByUs) return;
      try {
        this.watcher?.close();
      } catch {
        /* already dead */
      }
      try {
        await this._connect();
      } catch {
        this._reconnectLater();
      }
    }, 5000);
  }

  /** Full-document snapshots arrive on every change; dispatch only the fields
   *  that actually changed so null vs. absent stays meaningful. Own-write
   *  echoes need no special casing: app.js dedupes model/animation by
   *  basename and one-shot plays carry a monotonic ts. */
  _onSnapshot(snapshot) {
    const doc = Array.isArray(snapshot?.docs) ? snapshot.docs[0] : null;
    if (!doc) return; // document gone (shouldn't happen): nothing to apply
    const prev = this.lastDoc ?? {};
    this.lastDoc = { ...doc };
    this._dispatchDiff(prev, doc);
  }

  /** Re-fire the current document state for subscribers that registered
   *  after the first snapshot raced ahead of them (page still booting). */
  replay() {
    if (this.lastDoc) this._dispatchDiff({}, this.lastDoc);
  }

  _dispatchDiff(prev, doc) {
    if (doc.model && doc.model !== prev.model) {
      this._fire('state', { model: { path: doc.model } });
    }
    // A null animation only matters once a real one was seen (a fresh page
    // booting against an idle doc must not clear its startup default).
    if (doc.animation !== prev.animation && (doc.animation || prev.animation !== undefined)) {
      this._fire('state', { animation: doc.animation ? { path: doc.animation } : null });
    }
    const play = doc.play;
    if (play?.name && typeof play.ts === 'number' && play.ts > this.lastPlayTs) {
      this.lastPlayTs = play.ts;
      this._fire('play', { entry: { path: play.name } });
    }
  }

  _fire(type, msg) {
    for (const cb of this.handlers.get(type) ?? []) {
      try {
        cb(msg);
      } catch (err) {
        console.error(`[ai-live3d] cloud handler ${type}: ${err?.message ?? err}`);
      }
    }
  }

  on(type, cb) {
    const list = this.handlers.get(type) ?? [];
    list.push(cb);
    this.handlers.set(type, list);
  }

  /** Same send() surface as RoamingClient, used by the platform multiplexer:
   *  'pick' relays local selections, 'play' relays one-shot clips that arrived
   *  on the PC WS lane so cloud-only devices play them too. */
  send(type, payload = {}) {
    if (!this.db) return;
    const patch = { ts: Date.now(), from: this.id };
    if (type === 'pick') {
      if (payload.what === 'model') patch.model = payload.value;
      else if (payload.what === 'animation') patch.animation = payload.value;
      else return; // facing/roam stay PC-lane concepts
    } else if (type === 'play') {
      const name = String(payload.entry?.path ?? '').split(/[\\/]/).pop();
      if (!name) return;
      const ts = Date.now();
      this.lastPlayTs = ts;
      patch.play = { name, ts, from: this.id };
    } else {
      return;
    }
    this.db
      .collection(COLLECTION)
      .doc(DOC_ID)
      .update(patch)
      .catch((err) => console.warn(`[ai-live3d] cloud update failed: ${err?.message ?? err}`));
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.retryTimer);
    try {
      this.watcher?.close();
    } catch {
      /* noop */
    }
  }
}
