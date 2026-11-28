// Local single-browser repro of the mystery release: adopt, then watch the
// doc + console with timestamps for 15s WITHOUT any further clicks.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';

const URL = 'http://localhost:8080/pet/';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-'));
const port = 9375;
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', URL], { stdio: 'ignore', windowsHide: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve(JSON.parse(s)));
    }).on('error', reject);
  });

try {
  let page;
  for (let i = 0; i < 60; i++) {
    try {
      const l = await getJson('/json/list');
      page = l.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page) break;
    } catch {}
    await sleep(300);
  }
  const logs = [];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let mid = 0;
  const ev = (expression) =>
    new Promise((resolve) => {
      const id = ++mid + 1000;
      const on = (d) => {
        const m = JSON.parse(d.toString());
        if (m.id === id) {
          ws.off('message', on);
          resolve(m.result?.result?.value ?? JSON.stringify(m.result?.result).slice(0, 200));
        }
      };
      ws.on('message', on);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] EXC: ${(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 250)}`);
    }
  });
  ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.enable' }));
  const t0 = Date.now();

  // wait for cloudSync + db
  for (let i = 0; i < 40; i++) {
    if ((await ev('window.__cloudSync && window.__cloudSync.db ? 1 : 0')) === 1) break;
    await sleep(1000);
  }
  console.log('cloud ready');

  // name via prompt
  for (let i = 0; i < 30; i++) {
    if ((await ev('document.querySelector(".roam-prompt-input") ? 1 : 0')) === 1) break;
    await sleep(1000);
  }
  console.log('prompt:', await ev(`(function(){const i=document.querySelector('.roam-prompt-input'); if(!i) return 'none'; i.value='复现家'; i.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('.roam-prompt .web-btn').click(); return 'named'})()`));

  // ensure free state (wait out any leftovers)
  for (let i = 0; i < 40; i++) {
    if ((await ev('document.body.dataset.petHere')) === '1') break;
    await sleep(1500);
  }
  console.log('free ✔  holder now:', await ev('window.__cloudSync.lastDoc?.holder ?? "null"'));

  // adopt — then TOUCH NOTHING for 15 seconds
  await ev(`document.querySelector('.roam-sheet')?.classList.contains('hidden') && document.querySelector('.web-fab').click(), 'ok'`);
  await sleep(400);
  console.log('adopt click:', await ev(`(function(){const b=document.querySelector('.roam-act'); if(!b) return 'no btn'; b.click(); return b.textContent})()`));
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    console.log(`t+${i + 1}s holder=${await ev('window.__cloudSync.lastDoc?.holder ?? "null"')} petHere=${await ev('document.body.dataset.petHere')}`);
  }
  console.log('--- console ---');
  console.log(logs.filter((l) => /roam|release|adopt|cloud|holder/i.test(l)).join('\n') || '(none)');
} finally {
  proc.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}
process.exit(0);
