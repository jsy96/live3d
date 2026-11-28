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
//     play: { name, ts, from }|null, ts: <last write ms>, from: <device tag>,
//     holder: <device id of the home currently hosting the pet>|null,
//     holderName: '老金的家', holderSince: <ms>,
//     visits: [{ id, name, from, to? }] — most recent last, capped }
//
// Cloud roaming ("谁家养着桌宠"): holder=null is the free state where every
// page shows the pet; a page adopting the pet becomes the exclusive holder
// (pet runs in there, stows everywhere else). Homes announce themselves in
// the pet_homes collection via heartbeats; a holder whose heartbeat goes
// stale gets the pet auto-returned to the free state by whoever notices.
//
// Event vocabulary matches the roaming WS lanes ('state' / 'play' / 'roam'),
// so the platform multiplexer can fan both lanes into the same callbacks;
// 'roamstate' carries the full whereabouts picture for the UI.
const COLLECTION = 'pet_state';
const DOC_ID = 'global';
const HOMES = 'pet_homes';
const HEARTBEAT_MS = 20000;
const HOME_TTL_MS = 60000; // stale after three missed beats
const HOMES_POLL_MS = 10000; // presence list refresh (plain query, no watch)


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

// The human name of THIS browser ("谁的家"), asked once on first open.
export function getHomeName() {
  try {
    return localStorage.getItem('live3d-home-name') || '';
  } catch {
    return '';
  }
}
export function saveHomeName(name) {
  try {
    localStorage.setItem('live3d-home-name', name);
  } catch {
    /* private mode: name lives only for this session */
  }
}

export class CloudPetSync {
  constructor() {
    this.handlers = new Map();
    this.id = clientId();
    this.name = getHomeName();
    this.app = null; // cloudbase app (created once, session persists locally)
    this.db = null;
    this.watcher = null;
    this.closedByUs = false;
    this.lastDoc = null; // previous snapshot, for change-only dispatch
    this.lastPlayTs = 0;
    this.retryTimer = null;
    this.envId = null;
    this.homes = []; // fresh heartbeat docs (incl. self), newest lastSeen first
    this.roamState = null; // last dispatched whereabouts picture
    this._beatTimer = null;
    this._holderGoneTimer = null;
    this._lastRoamVisible = true; // free state: the pet shows everywhere
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
    try {
      this.watcher?.close();
    } catch {
      /* already dead */
    }
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
    this._startHomes();
    console.log(`[ai-live3d] cloud sync connected (env: ${this.envId}, id: ${this.id})`);
  }

  /** Presence: heartbeat doc per open browser + a POLLED "who is online"
   *  list. Deliberately not a realtime watch — two watches on the SDK's
   *  single shared websocket raced each other's INIT into
   *  "wsclient.send timedout" cascades; a 10s plain query needs no push
   *  precision for a waiting list (holder transitions still arrive
   *  instantly via the pet_state watch). */
  _startHomes() {
    if (this._beatTimer) return;
    this._beatTimer = setInterval(() => this._beat(), HEARTBEAT_MS);
    this._beat();
    const poll = async () => {
      if (!this.db || this.closedByUs) return;
      try {
        const _ = this.db.command;
        const [r, docRes] = await Promise.all([
          this.db.collection(HOMES).where({ lastSeen: _.gt(Date.now() - HOME_TTL_MS) }).get(),
          // Watchdog: the realtime watch occasionally drops events (SDK
          // "nextevent ignored" / INIT retry noise) — reconcile against a
          // fresh read so missed changes converge within one poll.
          this.db.collection(COLLECTION).doc(DOC_ID).get(),
        ]);
        this.homes = (Array.isArray(r?.data) ? r.data : [])
          .map((d) => ({ id: d._id, name: d.name ?? '（未命名）', lastSeen: d.lastSeen ?? 0 }))
          .sort((a, b) => b.lastSeen - a.lastSeen);
        const fd = Array.isArray(docRes?.data) ? docRes.data[0] : docRes?.data;
        if (fd && JSON.stringify(fd) !== JSON.stringify(this.lastDoc)) {
          this._onSnapshot({ docs: [fd] });
        } else {
          this._checkHolderGone();
          this._dispatchRoamState();
        }
      } catch (err) {
        console.warn(`[ai-live3d] homes poll failed: ${err?.message ?? err}`);
      }
    };
    this._homesTimer = setInterval(poll, HOMES_POLL_MS);
    poll();
  }

  _beat() {
    if (!this.db || !this.name) return; // unnamed homes stay off the list
    this.db
      .collection(HOMES)
      .doc(this.id)
      .set({ name: this.name, lastSeen: Date.now() })
      .catch((err) => console.warn(`[ai-live3d] heartbeat failed: ${err?.message ?? err}`));
  }

  /** Rename this browser's home (first-open prompt); re-announce presence. */
  renameHome(name) {
    this.name = String(name ?? '').trim().slice(0, 24);
    if (!this.name) return;
    saveHomeName(this.name);
    this._beat();
  }

  /** Adopt the pet (only from the free state — no stealing) / send it back. */
  adoptPet() {
    if (!this.db || !this.name) return false;
    const doc = this.lastDoc ?? {};
    if (doc.holder && doc.holder !== this.id) return false;
    // Our own adopt echo is in flight — an armed holder-gone timer built on
    // a pre-adopt snapshot must not "return" the pet we just took.
    clearTimeout(this._holderGoneTimer);
    this._holderGoneTimer = null;
    const now = Date.now();
    this._update({
      holder: this.id,
      holderName: this.name,
      holderSince: now,
      visits: this._visitsWith(doc, now, true),
      ts: now,
      from: this.id,
      note: 'adopt',
    });
    return true;
  }

  releasePet() {
    if (!this.db) return false;
    const doc = this.lastDoc ?? {};
    if (!doc.holder || doc.holder !== this.id) return false;
    const now = Date.now();
    this._update({
      holder: null,
      holderName: null,
      holderSince: null,
      visits: this._visitsWith(doc, now, false),
      ts: now,
      from: this.id,
      note: 'release',
    });
    return true;
  }

  /** Copy the visit history, closing the currently-open visit. */
  _visitsWith(doc, now, appendMine) {
    const visits = (Array.isArray(doc.visits) ? doc.visits : []).slice();
    const last = visits[visits.length - 1];
    if (last && !last.to) visits[visits.length - 1] = { ...last, to: now };
    if (appendMine) visits.push({ id: this.id, name: this.name, from: now });
    return visits.slice(-30);
  }

  /** Anyone noticing the holder went offline returns the pet to the free
   *  state (idempotent same-value writes make the race harmless). */
  _checkHolderGone() {
    const doc = this.lastDoc;
    if (!doc?.holder || doc.holder === this.id) return;
    const alive = this.homes.some((h) => h.id === doc.holder);
    if (alive) return;
    if (this._holderGoneTimer) return;
    // Small delay: let a racing heartbeat land before we act.
    this._holderGoneTimer = setTimeout(async () => {
      this._holderGoneTimer = null;
      const d = this.lastDoc;
      if (!d?.holder || d.holder === this.id) return;
      if (this.homes.some((h) => h.id === d.holder)) return;
      // Re-read the doc fresh: our snapshot may predate an adopt that just
      // replaced the stale holder — "returning" that pet would clobber it.
      try {
        const fresh = await this.db.collection(COLLECTION).doc(DOC_ID).get();
        const fd = Array.isArray(fresh?.data) ? fresh.data[0] : fresh?.data;
        if (!fd || fd.holder !== d.holder) return; // someone else holds it now
        this._update({
          holder: null,
          holderName: null,
          holderSince: null,
          visits: this._visitsWith(fd, Date.now(), false),
          ts: Date.now(),
          from: this.id,
          note: 'auto-return',
        });
        console.log(`[ai-live3d] holder "${d.holderName ?? d.holder}" went offline; pet returned to the cloud home`);
      } catch (err) {
        console.warn(`[ai-live3d] holder-gone recheck failed: ${err?.message ?? err}`);
      }
    }, 5000);
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
    if (!this.lastDoc) return;
    // Re-assume the visible default so a lost early 'exit' (snapshot raced
    // the app's onRoam registration) is replayed too.
    this._lastRoamVisible = true;
    this._dispatchDiff({}, this.lastDoc);
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
    // Holder transitions drive the run-in/run-out animations through the
    // same 'roam' vocabulary the PC WS lane uses. The pet is visible here
    // exactly when nobody holds it or I hold it.
    const visibleNow = !doc.holder || doc.holder === this.id;
    if (visibleNow !== this._lastRoamVisible) {
      this._lastRoamVisible = visibleNow;
      if (visibleNow) {
        // The pet is (back) here — any armed holder-gone timer is moot.
        clearTimeout(this._holderGoneTimer);
        this._holderGoneTimer = null;
      }
      console.log(`[ai-live3d] roam transition -> ${visibleNow ? 'HERE' : 'AWAY'} (holder=${doc.holder ?? 'null'} note=${doc.note ?? '?'} from=${doc.from ?? '?'} ts=${doc.ts ?? '?'})`);
      this._fire('roam', { cmd: visibleNow ? 'enter' : 'exit' });
    }
    this._dispatchRoamState();
  }

  _dispatchRoamState() {
    const doc = this.lastDoc ?? {};
    this.roamState = {
      me: this.id,
      myName: this.name,
      holder: doc.holder ?? null,
      holderName: doc.holderName ?? null,
      holderSince: doc.holderSince ?? null,
      holderOnline: !doc.holder || this.homes.some((h) => h.id === doc.holder),
      visits: Array.isArray(doc.visits) ? doc.visits.slice(-30) : [],
      homes: this.homes,
    };
    this._fire('roamstate', this.roamState);
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

  /** Write fields into the shared pet_state document (fire-and-forget). */
  _update(patch) {
    if (!this.db) return;
    this.db
      .collection(COLLECTION)
      .doc(DOC_ID)
      .update(patch)
      .catch((err) => console.warn(`[ai-live3d] cloud update failed: ${err?.message ?? err}`));
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
    this._update(patch);
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.retryTimer);
    clearInterval(this._beatTimer);
    this._beatTimer = null;
    clearInterval(this._homesTimer);
    try {
      this.watcher?.close();
    } catch {
      /* noop */
    }
  }
}
