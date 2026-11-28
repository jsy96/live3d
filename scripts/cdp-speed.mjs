// Measure real load timing of the zc pet page in a browser: which origin
// served the model/bundle and how long each took (performance entries).
// Usage: node scripts/cdp-speed.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';

const URL_TO_TEST = process.argv[2] ?? 'https://zc.leige.online/';
const PORT = 9344;
const WAIT = Number(process.argv[3] ?? 30000);

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = edgePaths.find((p) => fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-speed-'));
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', URL_TO_TEST], { stdio: 'ignore', windowsHide: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve(JSON.parse(s)));
    }).on('error', reject);
  });

try {
  let page;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJson('/json/list');
      page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page) break;
    } catch {}
    await sleep(300);
  }
  if (!page) throw new Error('page never appeared');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let mid = 0;
  const ev = (expression) =>
    new Promise((resolve) => {
      const id = ++mid;
      const on = (d) => {
        const m = JSON.parse(d.toString());
        if (m.id === id) {
          ws.off('message', on);
          resolve(m.result?.result?.value ?? JSON.stringify(m.result?.result ?? {}));
        }
      };
      ws.on('message', on);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });

  await sleep(WAIT);
  console.log('title:', await ev('document.title'));
  console.log('cdnConfig assetOrigin:', await ev('window.__LIVE3D_CDN__?.assetOrigin ?? "none"'));
  const rows = await ev(`JSON.stringify(performance.getEntriesByType('resource')
    .filter(r => /bundle|models|vrma|styles/.test(r.name))
    .map(r => ({ f: r.name.split('/').pop().split('?')[0].slice(0, 30), host: new URL(r.name).host, ms: Math.round(r.duration), mb: +(r.decodedBodySize / 1048576).toFixed(1) })), null, 1)`);
  for (const line of rows.split('\\n')) console.log(line);
} finally {
  proc.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}
