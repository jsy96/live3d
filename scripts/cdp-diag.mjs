// Quick CDP diagnostic: open the URL, dump target list, page load state,
// console logs and any JS errors. Usage: node scripts/cdp-diag.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';

const URL_TO_TEST = process.argv[2] ?? 'https://ajmj-d2g1eishpbe7677fe-1301305388.tcloudbaseapp.com/pet/';
const PORT = 9335;
const WAIT = Number(process.argv[3] ?? 15000);

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = edgePaths.find((p) => fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-diag-'));
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', URL_TO_TEST], { stdio: 'ignore', windowsHide: true });

function getJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve(JSON.parse(s)));
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let list = null;
  for (let i = 0; i < 50; i++) {
    try {
      list = await getJson('/json/list');
      if (list.some((t) => t.type === 'page' && t.url.startsWith('http'))) break;
    } catch {}
    await sleep(300);
  }
  console.log('targets:', list.filter((t) => t.type === 'page').map((t) => t.url).join(' | '));
  const page = list.find((t) => t.type === 'page' && t.url.startsWith(URL_TO_TEST.replace(/\/$/, '')));
  if (!page) throw new Error('pet page target not found');

  const logs = [];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let mid = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++mid, method, params }));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map((p) => p.value)) ?? '').join(' ')}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`EXC: ${m.params.exceptionDetails.text} :: ${m.params.exceptionDetails.exception?.description?.slice(0, 500) ?? ''}`);
    } else if (m.method === 'Log.entryAdded') {
      logs.push(`[log] ${m.params.entry.source}/${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
    }
  });
  send('Runtime.enable');
  send('Log.enable');
  send('Page.enable');
  send('Page.reload');

  await sleep(WAIT);

  const evalExpr = (expression) =>
    new Promise((resolve) => {
      const id = ++mid + 1000;
      const on = (d) => {
        const m = JSON.parse(d.toString());
        if (m.id === id) {
          ws.off('message', on);
          resolve(m.result?.result?.value ?? JSON.stringify(m.result ?? {}));
        }
      };
      ws.on('message', on);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });

  console.log('readyState:', await evalExpr('document.readyState'));
  console.log('title:', await evalExpr('document.title'));
  console.log('bodyText:', await evalExpr('document.body.innerText.slice(0, 200)'));
  console.log('cdnConfig:', await evalExpr('JSON.stringify(window.__LIVE3D_CDN__)'));
  console.log('bundleVersion:', await evalExpr('[...document.scripts].map(s=>s.src).join("\\n")'));
  console.log('bodyChildren:', await evalExpr('document.body.children.length'));
  console.log('--- console/logs ---');
  console.log(logs.join('\n') || '(none captured)');
} finally {
  proc.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}
