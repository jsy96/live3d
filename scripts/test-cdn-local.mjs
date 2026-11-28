// Local end-to-end test of the CDN architecture WITHOUT Tencent CloudBase:
//   :9990  fake pet-hub  — GET returns the PC's live address; POST accepts
//                         the registrar's pushes (logs them)
//   :9991  static server — serves dist/cdn (the staged CDN site)
// Then open http://127.0.0.1:9991/ in a browser: the page loads assets from
// the "CDN", discovers the PC via the fake hub, and live-syncs to it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CDN = path.join(ROOT, 'dist', 'cdn');
const HUB_PORT = 9990;
const WEB_PORT = 9991;

let lastRegister = null;

http
  .createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'GET') {
      // Answer with the local test address (CSP on the staged page allows
      // 127.0.0.1); what the registrar pushed is logged above.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tunnelUrl: null, lanUrls: ['http://127.0.0.1:31790'], version: 'local-test' }));
      return;
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      lastRegister = JSON.parse(body || '{}');
      console.log('[fake-hub] register:', JSON.stringify(lastRegister).slice(0, 160));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"code":0}');
    });
  })
  .listen(HUB_PORT, '127.0.0.1', () => console.log(`fake pet-hub: http://127.0.0.1:${HUB_PORT}`));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.vrm': 'model/gltf-binary',
  '.glb': 'model/gltf-binary',
  '.vrma': 'application/octet-stream',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(CDN, p));
    if (!file.startsWith(CDN)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': st.size,
      });
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(WEB_PORT, '127.0.0.1', () => console.log(`cdn site:  http://127.0.0.1:${WEB_PORT}/`));
