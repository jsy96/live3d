// Emulates a phone against the LAN sync WebSocket (/ws) to verify the
// phase-4 protocol end to end: initial state push, picker round-trips and
// the roaming hand-off. Run from the project root:
//   node scripts/test-lan-sync.mjs step1|step2|step3
import WebSocket from 'ws';

const step = process.argv[2] ?? 'step1';
const URL = 'ws://127.0.0.1:31790/ws';
const log = (...a) => console.log(`[${step}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(URL);
const seen = [];
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  seen.push(m);
  log('<<', JSON.stringify(m).slice(0, 160));
});
ws.on('error', (e) => {
  log('ws error:', e.message);
  process.exit(2);
});

async function waitFor(pred, label, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const m = seen.find(pred);
    if (m) return m;
    await sleep(150);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const hasModel = (name) => (m) => m.type === 'state' && m.model?.path === name;
const hasFacing = (deg) => (m) => m.type === 'state' && m.facing === deg;
const isRoam = (cmd) => (m) => m.type === 'roam' && m.cmd === cmd;
const send = (obj) => {
  ws.send(JSON.stringify(obj));
  log('>>', JSON.stringify(obj));
};

try {
    await new Promise((r) => ws.on('open', r));
  log('connected');
  send({ type: 'hello', ua: 'test-lan-sync' });

  if (step === 'step1') {
    const st = await waitFor((m) => m.type === 'state' && m.model !== undefined, 'initial state');
    if (!st.model || !st.animation || typeof st.facing !== 'number') throw new Error(`bad initial state: ${JSON.stringify(st)}`);
    log('initial state ok:', st.model.path, st.animation?.path ?? null, st.facing);

    send({ type: 'pick', what: 'model', value: 'AvatarSample_B' });
    await waitFor(hasModel('AvatarSample_B.vrm'), 'model switch broadcast');
    send({ type: 'pick', what: 'facing', value: 90 });
    await waitFor(hasFacing(90), 'facing broadcast');

    send({ type: 'pick', what: 'roam', value: 'phone' });
    await waitFor(isRoam('enter'), 'roam enter after hand-off');
    log('STEP1 PASS');
    ws.close(); // leave the pet on the phone; step2 will recall it
  } else if (step === 'step2') {
    send({ type: 'pick', what: 'roam', value: 'desktop' });
    await waitFor(isRoam('exit'), 'roam exit broadcast');
    log('STEP2 PASS');
    ws.close();
  } else if (step === 'step3') {
    // Hand off, then drop the connection: the pet must auto-return.
    send({ type: 'pick', what: 'roam', value: 'phone' });
    await waitFor(isRoam('enter'), 'roam enter');
    log('closing socket while the pet is on the phone...');
    ws.close();
    process.exit(0); // disconnect is the actual test action
  }
  process.exit(0);
} catch (err) {
  log('FAIL:', err.message);
  process.exit(1);
}
