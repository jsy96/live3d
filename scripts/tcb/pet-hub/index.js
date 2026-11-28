// TCB cloud function "pet-hub": the live-address registry for the CDN-hosted
// pet page. The PC registers its current tunnel/LAN addresses here whenever
// they change; the CDN page asks for them on load and connects its WebSocket
// to the live PC.
//
// 云接入 (HTTP) bindings:
//   GET  /pet-hub            -> { code: 0, tunnelUrl, lanUrls, version, updatedAt }
//   POST /pet-hub  (JSON)    -> { secret, tunnelUrl, lanUrls, version }  (PC only)
//
// Setup in the TCB console:
//   - create function from this directory (Node.js 16+, no deps needed at
//     runtime besides @cloudbase/node-sdk, which is built into the env)
//   - function config env var: REG_SECRET=<the same secret as tcb-config.json>
//   - database collection "pet_live" (read: all users, write: function only)
const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();
const COL = 'pet_live';
const DOC = 'current';

function badArg(v) {
  return typeof v !== 'string' || v.length > 300;
}

exports.main = async (event) => {
  // 云接入 wraps the HTTP request; direct invocations pass fields on event.
  let body = event;
  const method = String(event?.method ?? event?.httpMethod ?? 'GET').toUpperCase();
  if (typeof event?.body === 'string' && event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return { code: 400, error: 'bad json body' };
    }
  }

  if (method === 'GET' && !body?.action) {
    const doc = (await db.collection(COL).doc(DOC).get()).data ?? {};
    return { code: 0, ...doc };
  }

  if (body?.action === 'live') {
    const doc = (await db.collection(COL).doc(DOC).get()).data ?? {};
    return { code: 0, ...doc };
  }

  if (body?.action === 'register') {
    if (!process.env.REG_SECRET || body.secret !== process.env.REG_SECRET) {
      return { code: 403, error: 'bad secret' };
    }
    const { tunnelUrl = null, lanUrls = [], version = '' } = body;
    if (tunnelUrl && badArg(tunnelUrl)) return { code: 400, error: 'bad tunnelUrl' };
    if (!Array.isArray(lanUrls) || lanUrls.some(badArg)) {
      return { code: 400, error: 'bad lanUrls' };
    }
    await db
      .collection(COL)
      .doc(DOC)
      .set({ tunnelUrl, lanUrls, version, updatedAt: Date.now() });
    return { code: 0 };
  }

  return { code: 400, error: 'unknown action' };
};
