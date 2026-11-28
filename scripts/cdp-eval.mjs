// Evaluate JS inside the phone page via CDP (Edge --remote-debugging-port).
// Usage: node scripts/cdp-eval.mjs <port> "<expression>"
import WebSocket from 'ws';
import http from 'node:http';

const port = Number(process.argv[2] ?? 9333);
const expr = process.argv[3] ?? 'document.title';

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
const page = list.find((t) => t.type === 'page' && t.url.includes('31790'));
if (!page) throw new Error('pet page target not found');
const ws = new WebSocket(page.webSocketDebuggerUrl); // no Origin header: DevTools rejects foreign origins
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.id === 1) {
    console.log(JSON.stringify(m.result?.result ?? m.result, null, 1));
    ws.close();
    process.exit(0);
  }
});
setTimeout(() => {
  console.log('timeout');
  process.exit(1);
}, 8000);
