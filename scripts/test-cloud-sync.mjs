// Two-device cloud sync e2e: page A picks a model, page B (separate browser
// profile = separate device identity) must follow via the realtime watch.
// Usage: node scripts/test-cloud-sync.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';

const URL_TO_TEST = process.argv[2] ?? 'http://localhost:8080/pet/';
const PORT = 9339;

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = edgePaths.find((p) => fs.existsSync(p));
if (!edge) throw new Error('msedge.exe not found');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve(JSON.parse(s)));
    }).on('error', reject);
  });
}

class Page {
  constructor(profile, label) {
    this.profile = profile;
    this.label = label;
    this.logs = [];
  }
  async start() {
    this.proc = spawn(
      edge,
      [
        '--headless=new',
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${this.profile}`,
        '--no-first-run',
        '--disable-gpu',
        '--window-size=420,800',
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true }
    );
    // Wait for CDP, then open the pet page in this browser.
    for (let i = 0; i < 50; i++) {
      try {
        await getJson('/json/version');
        break;
      } catch {
        await sleep(300);
      }
    }
    // Distinct ports would be needed for parallel browsers — instead run
    // sequentially: both profiles share the port, but only one runs at a
    // time EXCEPT we need them concurrent for the watch push test... so we
    // give each Page its own port.
    return this;
  }
}

// Simpler: run two browsers on two ports.
async function openBrowser(port, label) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `pet-${label}-`));
  const proc = spawn(
    edge,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      '--window-size=420,800',
      URL_TO_TEST,
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  const getJ = (p) =>
    new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: p }, (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve(JSON.parse(s)));
      }).on('error', reject);
    });
  for (let i = 0; i < 50; i++) {
    try {
      const list = await getJ('/json/list');
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (i < 3 || page) console.log(`[${label}] poll ${i}: ${list.map((t) => t.type + '@' + t.url.slice(0, 40)).join(', ')}`);
      if (page) {
        if (!page.webSocketDebuggerUrl) throw new Error(`no ws url for ${page.url}`);
        const logs = [];
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.on('open', r));
        let mid = 0;
        const client = {
          proc,
          profile,
          label,
          logs,
          eval: (expression) =>
            new Promise((resolve) => {
              const id = ++mid + 100;
              const on = (d) => {
                const m = JSON.parse(d.toString());
                if (m.id === id) {
                  ws.off('message', on);
                  resolve(m.result?.result?.value ?? null);
                }
              };
              ws.on('message', on);
              ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
            }),
        };
        ws.on('message', (d) => {
          const m = JSON.parse(d.toString());
          if (m.method === 'Runtime.consoleAPICalled') {
            logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
          } else if (m.method === 'Runtime.exceptionThrown') {
            logs.push(`EXC: ${m.params.exceptionDetails.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails.text}`);
          }
        });
        ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.enable' }));
        return client;
      }
    } catch (e) {
      console.log(`[${label}] poll ${i} err: ${e.message}`);
    }
    await sleep(300);
  }
  throw new Error(`browser ${label} never came up`);
}

const chipExpr = `(() => {
  const chips = [...document.querySelectorAll('.web-mchip')];
  return JSON.stringify(chips.map((c) => ({ t: c.textContent, cur: c.classList.contains('cur') })));
})()`;

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timeout: ${label}`);
}

let A, B;
try {
  // Both browsers stay open: the push path (watch onChange) is what we test.
  A = await openBrowser(PORT, 'A');
  console.log('A open');
  B = await openBrowser(PORT + 1, 'B');
  console.log('B open');

  await waitFor(async () => (await A.eval('document.querySelectorAll(".web-mchip").length')) > 0, 30000, 'A chips');
  await waitFor(async () => (await B.eval('document.querySelectorAll(".web-mchip").length')) > 0, 30000, 'B chips');
  console.log('both pages booted');

  await waitFor(async () => A.logs.some((l) => l.includes('cloud sync connected')), 20000, 'A cloud connect');
  await waitFor(async () => B.logs.some((l) => l.includes('cloud sync connected')), 20000, 'B cloud connect');
  console.log('both cloud lanes connected');

  const aBefore = JSON.parse(await A.eval(chipExpr));
  const bBefore = JSON.parse(await B.eval(chipExpr));
  console.log('A chips before:', JSON.stringify(aBefore));
  console.log('B chips before:', JSON.stringify(bBefore));

  // A picks the first chip that is NOT current (and not B's current either,
  // so the change is unambiguous).
  const curName = aBefore.find((c) => c.cur)?.t;
  const target = aBefore.find((c) => !c.cur && c.t !== bBefore.find((b) => b.cur)?.t);
  if (!target) throw new Error('no alternative model chip to pick');
  const pickedIdx = aBefore.indexOf(target);
  console.log(`A picks #${pickedIdx}: ${target.t} (was ${curName})`);
  await A.eval(`document.querySelectorAll('.web-mchip')[${pickedIdx}].click()`);

  // B must converge via the realtime watch push.
  const bAfterName = await waitFor(async () => {
    const chips = JSON.parse(await B.eval(chipExpr));
    const cur = chips.find((c) => c.cur);
    return cur && cur.t === target.t ? cur.t : null;
  }, 90000, 'B follows A pick');
  console.log(`B converged to: ${bAfterName} ✔`);

  const aAfterName = (JSON.parse(await A.eval(chipExpr))).find((c) => c.cur)?.t;
  console.log(`A current after pick: ${aAfterName}`);
  console.log('--- A console ---');
  console.log(A.logs.filter((l) => /cloud|model|error|EXC/i.test(l)).join('\n'));
  console.log('--- B console ---');
  console.log(B.logs.filter((l) => /cloud|model|error|EXC/i.test(l)).join('\n'));
  console.log('RESULT: PASS');
  A.proc.kill();
  B.proc.kill();
} catch (err) {
  console.error('RESULT: FAIL —', err.message);
  try {
    console.log('--- A console (tail) ---');
    console.log(A.logs.slice(-15).join('\n'));
    console.log('--- B console (tail) ---');
    console.log(B.logs.slice(-15).join('\n'));
  } catch {}
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
