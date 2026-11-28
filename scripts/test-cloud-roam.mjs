// Cloud roaming e2e: two browsers (A, B = separate identities).
//   1. First-open name prompt on both ("A家" / "B家")
//   2. Presence: both homes listed
//   3. A adopts the pet -> B's page stows it (petHere=0) + panel says 在A家做客
//   4. A releases -> B sees the pet again (petHere=1), visit history closed
//   5. (optional, --auto-return) A adopts then dies; B auto-returns the pet
// Usage: node scripts/test-cloud-roam.mjs [url] [--auto-return]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';

const URL_TO_TEST = process.argv[2] ?? 'https://zc.leige.online/';
const AUTO_RETURN = process.argv.includes('--auto-return');

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = edgePaths.find((p) => fs.existsSync(p));
if (!edge) throw new Error('msedge.exe not found');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openBrowser(portSeed, label) {
  const port = portSeed + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `roam-${label}-`));
  const proc = spawn(
    edge,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--window-size=420,800', 'about:blank'],
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
  // Attach to whatever page exists (about:blank at first), then navigate
  // explicitly — robust against slow DNS / failed initial loads.
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJ('/json/list');
      const page = list.find((t) => t.type === 'page');
      if (page) {
        const logs = [];
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.on('open', r));
        let mid = 0;
        const evalExpr = (expression) =>
          new Promise((resolve) => {
            const id = ++mid + 1000;
            const on = (d) => {
              const m = JSON.parse(d.toString());
              if (m.id === id) {
                ws.off('message', on);
                resolve(m.result?.result?.value ?? null);
              }
            };
            ws.on('message', on);
            ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
          });
        ws.on('message', (d) => {
          const m = JSON.parse(d.toString());
          if (m.method === 'Runtime.consoleAPICalled') {
            logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 180)}`);
          } else if (m.method === 'Runtime.exceptionThrown') {
            logs.push(`EXC: ${m.params.exceptionDetails.exception?.description?.slice(0, 250) ?? m.params.exceptionDetails.text}`);
          }
        });
        ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.enable' }));
        ws.send(JSON.stringify({ id: ++mid, method: 'Page.enable' }));
        ws.send(JSON.stringify({ id: ++mid, method: 'Page.navigate', params: { url: URL_TO_TEST } }));
        const client = { proc, port, label, logs, eval: evalExpr };
        await waitFor(async () => (await evalExpr('document.readyState')) === 'complete', 90000, `${label} page load`).catch(async (e) => {
          throw new Error(`${label}: ${e.message} lastUrl=${await evalExpr('location.href')}`);
        });
        return client;
      }
    } catch (e) {
      if (String(e.message).includes('page load')) throw e;
    }
    await sleep(300);
  }
  throw new Error(`browser ${label} never came up`);
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(700);
  }
  throw new Error(`timeout: ${label}`);
}

const ENSURE_PANEL = `(document.querySelector('.roam-sheet')?.classList.contains('hidden') ? document.querySelector('.web-fab').click() : 0), 'ok'`;

const fail = async (browsers, msg) => {
  console.error('RESULT: FAIL —', msg);
  for (const b of browsers.filter(Boolean)) {
    const st = await b.eval(`JSON.stringify({ holder: window.__cloudSync?.lastDoc?.holder ?? null, holderName: window.__cloudSync?.lastDoc?.holderName ?? null, me: window.__cloudSync?.id, homes: (window.__cloudSync?.homes ?? []).map(h => h.id + ':' + h.name).join(','), sheets: document.querySelectorAll('.roam-sheet').length, docks: document.querySelectorAll('.web-dock').length, canvases: document.querySelectorAll('#stage').length })`).catch(() => '?');
    console.log(`[${b.label} live] ${st}`);
  }
  dump();
  B?.proc.kill();
  A?.proc.kill();
  process.exit(1);
};

const dump = () => {
  for (const b of [A, B].filter(Boolean)) {
    console.log(`--- ${b.label} cloud lines ---`);
    console.log(b.logs.filter((l) => /cloud|heartbeat|homes|INIT_WATCH|realtime|EXC|adopt|release/i.test(l)).slice(-15).join('\n') || '(none)');
  }
};
let A, B;
try {
A = await openBrowser(9351, 'A');
console.log('A open');
B = await openBrowser(9352, 'B');
console.log('B open');

// 1. Name prompts (first open on fresh profiles).
await waitFor(async () => (await A.eval('document.querySelector(".roam-prompt-input") ? 1 : 0')) === 1, 30000, 'A prompt');
await A.eval(`(function () {
  const i = document.querySelector('.roam-prompt-input');
  i.value = 'A家';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.roam-prompt .web-btn').click();
  return 'named ' + !document.querySelector('.roam-prompt');
})()`);
console.log('A named');
await waitFor(async () => (await B.eval('document.querySelector(".roam-prompt-input") ? 1 : 0')) === 1, 30000, 'B prompt');
await B.eval(`(function () {
  const i = document.querySelector('.roam-prompt-input');
  i.value = 'B家';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.roam-prompt .web-btn').click();
  return 'named ' + !document.querySelector('.roam-prompt');
})()`);
console.log('B named');
console.log('A cloudSync.name:', await A.eval('window.__cloudSync?.name ?? "(none)"'));
console.log('B cloudSync.name:', await B.eval('window.__cloudSync?.name ?? "(none)"'));
console.log('B db ready:', await B.eval('window.__cloudSync?.db ? "yes" : "null"'));

// 2. Presence: both homes visible on both pages (heartbeats ~20s; allow 45s).
const homesOk = await waitFor(async () => {
  const t = await B.eval('document.body.dataset.roamHomesCount ?? "0"');
  return Number(t) >= 2 ? t : null;
}, 50000, 'both homes listed').catch(() => null);
if (homesOk === null) {
  const panelText = await waitFor(async () => {
    await B.eval(ENSURE_PANEL);
    await sleep(300);
    return await B.eval('document.querySelector(".roam-sheet")?.innerText ?? ""');
  }, 50000, 'panel with both homes');
  if (!/A家/.test(panelText) || !/B家/.test(panelText)) fail([A, B], 'homes missing in panel: ' + panelText.slice(0, 200));
  console.log('presence ok (panel lists A家+B家)');
} else {
  console.log('presence ok (dataset count >= 2)');
}

// Both pages show the free pet (a leftover holder from a previous run gets
// auto-returned within ~15s: poll 10s + recheck 5s).
await waitFor(async () => (await A.eval('document.body.dataset.petHere')) === '1', 60000, 'A free state after cleanup');
await waitFor(async () => (await B.eval('document.body.dataset.petHere')) === '1', 60000, 'B free state after cleanup');
console.log('free state: pet visible on both ✔');

// 3. A adopts.
await A.eval(ENSURE_PANEL);
await sleep(300);
const adoptRes = await A.eval(`(() => {
  const btn = document.querySelector('.roam-act');
  if (!btn) return 'no action button';
  btn.click();
  return 'clicked: ' + btn.textContent;
})()`);
console.log('A adopt:', adoptRes);

await waitFor(async () => (await A.eval('document.body.dataset.petHere')) === '1', 20000, 'A still holds pet');
const bAway = await waitFor(async () => (await B.eval('document.body.dataset.petHere')) === '0', 30000, 'B pet stowed');
console.log('A holds; B pet stowed ✔');

// B's panel should say 在「A家」做客 and have auto-opened.
const bPanel = await B.eval('document.querySelector(".roam-sheet")?.innerText ?? ""');
if (!/A家/.test(bPanel) || !/做客/.test(bPanel)) fail([A, B], 'B panel missing 在A家做客: ' + bPanel.slice(0, 300));
console.log('B panel: 在A家做客 ✔');
if (!/串门记录/.test(bPanel) || !/A家/.test(bPanel)) fail([A, B], 'B panel missing history');
console.log('B panel history section ✔');

// 4. A releases.
await A.eval('document.querySelector(".roam-act") ? document.querySelector(".roam-act").click() : document.querySelector(".web-fab").click()');
await sleep(400);
const relPanel = await A.eval('document.querySelector(".roam-sheet")?.innerText ?? ""');
if (!/送回云之家/.test(relPanel)) fail([A, B], 'A has no release button: ' + relPanel.slice(0, 200));
// holder actions have a 2s cooldown (anti double-fire) — let it lapse
await sleep(2500);
await A.eval('document.querySelector(".roam-act").click()');
console.log('A released');
await waitFor(async () => (await B.eval('document.body.dataset.petHere')) === '1', 30000, 'B pet back');
console.log('free again: B pet back ✔');
const bPanel2 = await B.eval('document.querySelector(".roam-sheet")?.innerText ?? ""');
if (!/分钟/.test(bPanel2)) fail([A, B], 'history duration missing: ' + bPanel2.slice(0, 300));
console.log('visit closed with duration ✔');

let extra = '';
if (AUTO_RETURN) {
  // 5. A adopts again then dies; B auto-returns after the heartbeat TTL.
  await A.eval(ENSURE_PANEL);
  await sleep(300);
  // holder actions have a 2s cooldown (anti double-fire) — let it lapse
await sleep(2500);
await A.eval('document.querySelector(".roam-act").click()');
  await waitFor(async () => (await B.eval('document.body.dataset.petHere')) === '0', 30000, 'B stowed (2nd adopt)');
  console.log('A re-adopted; killing A browser...');
  A.proc.kill();
  await waitFor(async () => (await B.eval('document.body.dataset.petHere')) === '1', 150000, 'auto-return after holder death');
  console.log('auto-return ✔ (pet freed after holder offline)');
  extra = ' + auto-return';
}

B.proc.kill();
A.proc.kill();
console.log(`RESULT: PASS${extra}`);
process.exit(0);
} catch (e) {
  console.error('RESULT: FAIL —', e.message);
  dump();
  B?.proc.kill(); A?.proc.kill();
  process.exit(1);
}
