// Emulates phone(s) against the LAN sync WebSocket (/ws) to verify the
// phase-4 protocol end to end: initial state push, picker round-trips and
// the (targeted) roaming hand-off. Run from the project root:
//   node scripts/test-lan-sync.mjs step1|step2|step3|step4
import WebSocket from 'ws';

const step = process.argv[2] ?? 'step1';
const URL = 'ws://127.0.0.1:31790/ws';
const log = (...a) => console.log(`[${step}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mkPhone(name) {
  const ws = new WebSocket(URL);
  const seen = [];
  const p = {
    name,
    ws,
    seen,
    send: (obj) => {
      ws.send(JSON.stringify(obj));
      log(`(${name}) >>`, JSON.stringify(obj));
    },
    waitFor: async (pred, label, timeout = 10000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const m = seen.find(pred);
        if (m) return m;
        await sleep(150);
      }
      throw new Error(`${name}: timeout waiting for: ${label}`);
    },
  };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    seen.push(m);
    log(`(${name}) <<`, JSON.stringify(m).slice(0, 160));
  });
  ws.on('error', () => {});
  p.open = new Promise((r) => ws.on('open', r));
  return p;
}

const hasModel = (name) => (m) => m.type === 'state' && m.model?.path === name;
const hasFacing = (deg) => (m) => m.type === 'state' && m.facing === deg;
const isRoam = (cmd) => (m) => m.type === 'roam' && m.cmd === cmd;

try {
  if (step === 'step4') {
    // Two phones: the hand-off must TARGET the requester, not everyone.
    const a = mkPhone('phoneA');
    const b = mkPhone('phoneB');
    await a.open;
    await b.open;
    a.send({ type: 'hello', ua: 'test-A', name: 'Phone·aaaa' });
    b.send({ type: 'hello', ua: 'test-B', name: 'Phone·bbbb' });
    await sleep(400);

    b.send({ type: 'pick', what: 'roam', value: 'phone' }); // B asks for the pet
    await b.waitFor(isRoam('enter'), 'B gets enter');
    await a.waitFor(isRoam('exit'), 'A gets exit');

    a.send({ type: 'pick', what: 'roam', value: 'phone' }); // now A wants it back
    await a.waitFor(isRoam('enter'), 'A gets enter');
    await b.waitFor(isRoam('exit'), 'B gets exit');

    a.send({ type: 'pick', what: 'roam', value: 'desktop' });
    await a.waitFor(isRoam('exit'), 'A exit on recall');
    log('STEP4 PASS');
    a.ws.close();
    b.ws.close();
    process.exit(0);
  }

  const main = mkPhone('main');
  const send = main.send;
  const waitFor = main.waitFor;
  await main.open;
  log('connected');
  send({ type: 'hello', ua: 'test-lan-sync', name: 'Phone·test' });

  if (step === 'step1') {
    const st = await waitFor((m) => m.type === 'state' && m.model !== undefined, 'initial state');
    if (!st.model || !st.animation || typeof st.facing !== 'number')
      throw new Error(`bad initial state: ${JSON.stringify(st)}`);
    log('initial state ok:', st.model.path, st.animation?.path ?? null, st.facing);

    send({ type: 'pick', what: 'model', value: 'AvatarSample_B' });
    await waitFor(hasModel('AvatarSample_B.vrm'), 'model switch broadcast');
    send({ type: 'pick', what: 'facing', value: 90 });
    await waitFor(hasFacing(90), 'facing broadcast');

    send({ type: 'pick', what: 'roam', value: 'phone' });
    await waitFor(isRoam('enter'), 'roam enter after hand-off');
    log('STEP1 PASS');
    main.ws.close(); // leave the pet on the phone; step2 will recall it
  } else if (step === 'step2') {
    send({ type: 'pick', what: 'roam', value: 'desktop' });
    await waitFor(isRoam('exit'), 'roam exit broadcast');
    log('STEP2 PASS');
    main.ws.close();
  } else if (step === 'step3') {
    // Hand off, then drop the connection: the pet must auto-return.
    send({ type: 'pick', what: 'roam', value: 'phone' });
    await waitFor(isRoam('enter'), 'roam enter');
    log('closing socket while the pet is on the phone...');
    main.ws.close();
    process.exit(0); // disconnect is the actual test action
  }
  process.exit(0);
} catch (err) {
  log('FAIL:', err.message);
  process.exit(1);
}
