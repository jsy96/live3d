// Take a screenshot of a CDP page target's own composite (renderer-side, so
// it shows exactly what the window shows, transparent content included).
// Usage: node scripts/cdp-shot.mjs <port> <urlMatch> <outPng>
import WebSocket from 'ws';
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 9444);
const urlMatch = process.argv[3] ?? 'index.html';
const out = process.argv[4] ?? 'cdp-shot.png';

function getJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve(JSON.parse(s)));
      })
      .on('error', reject);
  });
}

const list = await getJson('/json/list');
const page = list.find((t) => t.type === 'page' && t.url.includes(urlMatch));
if (!page) throw new Error(`page target not found for ${urlMatch}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
ws.on('message', (d, isBinary) => {
  if (!isBinary) {
    const m = JSON.parse(d.toString());
    if (m.id === 1) {
      fs.writeFileSync(out, Buffer.from(m.result.data, 'base64'));
      console.log(`saved ${out}`);
      ws.close();
      process.exit(0);
    }
  }
});
setTimeout(() => {
  console.log('timeout');
  process.exit(1);
}, 8000);
