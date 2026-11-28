// Phase 4, slice 1: LAN phone access.
// A tiny node:http server in the main process serves the SAME renderer bundle
// the desktop window uses, so a phone on the same Wi-Fi can open
//   http://<pc-ip>:31790
// and the pet renders there too (touch gestures already work — Pointer Events).
// Routes:
//   /                   -> 302 to /src/index.html
//   /src/index.html     -> shared renderer page (no-store)
//   /src/styles.css     -> styles (no-store)
//   /dist/bundle.js     -> esbuild bundle, same file the desktop loads
//   /api/models         -> [{ path, url }] like the desktop 'models:list' IPC
//   /api/animations     -> same shape for .vrma clips
//   /api/version        -> { version: APP_VERSION }
//   /models/<file>      -> model files (basename only, extension whitelisted)
//   /animations/<file>  -> animation clips (same guard)
// Plus a small QR-code window (tray / --qr) so the phone can scan the URL.
// A WebSocket endpoint at /ws (package 'ws') carries live sync both ways:
// phones receive state/play/roam pushes and send picker selections upstream.
// hooks (all optional):
//   buildState() -> full {model,animation,facing} sent to each new client
//   onPick(what, value) -> phone-side selection (model|animation|facing|roam)
//   onClientsChanged() -> connection count changed (tray refresh, auto-return)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');
const { BrowserWindow } = require('electron');
const { APP_VERSION } = require('./version');

const APP_ROOT = path.join(__dirname, '..');
const MODELS_DIR = path.join(APP_ROOT, 'models');
const ANIM_DIR = path.join(APP_ROOT, 'animations');
const PORTS = [31790, 31791, 31792, 31793, 31794];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vrm': 'model/gltf-binary',
  '.glb': 'model/gltf-binary',
  '.vrma': 'application/octet-stream',
};

// qrcode is an optional runtime dep: without it the QR window degrades to
// showing the URL as text (still copyable / typeable).
let QRCodeLib = null;
try {
  QRCodeLib = require('qrcode');
} catch {
  QRCodeLib = null;
}

/** LAN IPv4 candidates, home-network ranges first (for the QR code). */
function lanIps() {
  const out = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const ni of infos || []) {
      if (ni.internal || ni.family !== 'IPv4') continue;
      out.push(ni.address);
    }
  }
  const rank = (ip) =>
    ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0;
  return out.sort((a, b) => rank(b) - rank(a));
}

/** Best-guess "which NIC reaches the internet", without sending packets:
 *  UDP connect() only consults the local routing table. Machines with
 *  VMware/Hyper-V adapters have several 192.168.x.1 candidates and the first
 *  one is usually a virtual adapter a phone cannot reach. */
function routePreferredIp() {
  return new Promise((resolve) => {
    let sock;
    try {
      sock = dgram.createSocket('udp4');
    } catch {
      resolve(null);
      return;
    }
    const done = (v) => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(v);
    };
    sock.once('error', () => done(null));
    sock.connect(53, '223.5.5.5', () => {
      try {
        done(sock.address()?.address ?? null);
      } catch {
        done(null);
      }
    });
  });
}

function listDir(dir, exts, urlPrefix) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
      .sort()
      .map((f) => ({ path: f, url: `${urlPrefix}${encodeURIComponent(f)}` }));
  } catch {
    return [];
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function createLanServer(log, hooks = {}) {
  let server = null;
  let port = null;
  let preferredIp = null; // NIC the routing table would use (see routePreferredIp)
  let wss = null; // WebSocket server for live sync (see /ws route)
  const sockets = new Set();
  // The QR window is reused across calls while it stays open.
  let qrWin = null;

  const urlOf = (ip) => `http://${ip}:${port}`;

  /** Ordered LAN IPs: route-preferred first, then the remaining candidates. */
  function orderedIps() {
    const ips = lanIps();
    if (!preferredIp) return ips;
    const i = ips.indexOf(preferredIp);
    if (i > 0) {
      ips.splice(i, 1);
      ips.unshift(preferredIp);
    } else if (i === -1) {
      ips.unshift(preferredIp);
    }
    return ips;
  }

  /** Primary phone URL (best-guess LAN IP), null when not running. */
  function lanUrl() {
    if (!server) return null;
    const ip = orderedIps()[0];
    return ip ? urlOf(ip) : null;
  }

  /** All phone URLs (one per LAN IPv4); primary first. Empty when off. */
  function urls() {
    if (!server) return [];
    return orderedIps().map(urlOf);
  }

  function sendJson(res, code, obj, head) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': MIME['.json'],
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(head ? undefined : body);
  }

  function sendText(res, code, text) {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  }

  function serveFile(res, absPath, head) {
    fs.stat(absPath, (err, st) => {
      if (err || !st.isFile()) {
        sendText(res, 404, 'not found');
        return;
      }
      const type = MIME[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        // Bundled code changes with every rebuild; models/animations are
        // immutable per file name, so only those may be cached.
        'Cache-Control': /\.(vrm|glb|vrma)$/i.test(absPath) ? 'public, max-age=3600' : 'no-store',
      });
      if (head) {
        res.end();
        return;
      }
      const stream = fs.createReadStream(absPath);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
  }

  // Basename-only resolution: subdirectories, ".." and unknown extensions are
  // rejected, so only whitelisted files inside the two content dirs are served.
  function serveFromDir(res, dir, rawName, exts, head) {
    let name;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      sendText(res, 404, 'not found');
      return;
    }
    if (
      name === '' ||
      name !== path.basename(name) ||
      !exts.some((e) => name.toLowerCase().endsWith(e))
    ) {
      sendText(res, 404, 'not found');
      return;
    }
    serveFile(res, path.join(dir, name), head);
  }

  // --- WebSocket live sync (phones) -----------------------------------------
  function attachWs(s) {
    let WebSocketServer;
    try {
      ({ WebSocketServer } = require('ws'));
    } catch {
      log('[lan] ws package unavailable; live sync disabled (HTTP still fine)');
      return;
    }
    wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
    s.on('upgrade', (req, socket, head) => {
      let u;
      try {
        u = new URL(req.url, 'http://lan.local');
      } catch {
        socket.destroy();
        return;
      }
      if (u.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    wss.on('connection', (ws, req) => {
      log(`[lan] phone connected from ${req.socket.remoteAddress ?? '?'}`);
      const hello = hooks.buildState?.();
      if (hello) ws.send(JSON.stringify({ type: 'state', ...hello }));
      hooks.onClientsChanged?.();
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (msg.type === 'hello') {
          log(`[lan] hello: ${String(msg.ua ?? '').slice(0, 90)}`);
        } else if (msg.type === 'pick') {
          hooks.onPick?.(msg.what, msg.value);
        }
      });
      ws.on('close', () => hooks.onClientsChanged?.());
      ws.on('error', () => {
        /* per-socket errors must not take the server down */
      });
    });
  }

  function broadcast(obj) {
    if (!wss) return;
    const s = JSON.stringify(obj);
    for (const c of wss.clients) {
      if (c.readyState === 1) c.send(s);
    }
  }

  function onRequest(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'method not allowed');
        return;
      }
      const head = req.method === 'HEAD';
      const u = new URL(req.url, 'http://lan.local');
      const p = u.pathname;

      if (p === '/') {
        res.writeHead(302, { Location: '/src/index.html' });
        res.end();
        return;
      }
      if (p === '/src/index.html') {
        log(`[lan] page opened from ${req.socket.remoteAddress ?? '?'}`);
        serveFile(res, path.join(APP_ROOT, 'src', 'index.html'), head);
        return;
      }
      if (p === '/src/styles.css') {
        serveFile(res, path.join(APP_ROOT, 'src', 'styles.css'), head);
        return;
      }
      if (p === '/dist/bundle.js') {
        serveFile(res, path.join(APP_ROOT, 'dist', 'bundle.js'), head);
        return;
      }
      if (p === '/api/models') {
        sendJson(res, 200, listDir(MODELS_DIR, ['.vrm', '.glb'], '/models/'), head);
        return;
      }
      if (p === '/api/animations') {
        sendJson(res, 200, listDir(ANIM_DIR, ['.vrma'], '/animations/'), head);
        return;
      }
      if (p === '/api/version') {
        sendJson(res, 200, { version: APP_VERSION }, head);
        return;
      }
      if (p.startsWith('/models/')) {
        serveFromDir(res, MODELS_DIR, p.slice('/models/'.length), ['.vrm', '.glb'], head);
        return;
      }
      if (p.startsWith('/animations/')) {
        serveFromDir(res, ANIM_DIR, p.slice('/animations/'.length), ['.vrma'], head);
        return;
      }
      sendText(res, 404, 'not found');
    } catch (err) {
      log(`[lan] request error: ${err?.message ?? err}`);
      try {
        sendText(res, 500, 'server error');
      } catch {
        /* response may already be gone */
      }
    }
  }

  // --- QR window ------------------------------------------------------------
  // Small always-on-top card with a scannable QR of the phone URL; falls back
  // to plain URL text when the qrcode package is unavailable.
  async function buildQrHtml() {
    const primary = lanUrl();
    const all = urls();
    let qrCard;
    if (QRCodeLib && primary) {
      const svg = await QRCodeLib.toString(primary, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      qrCard = `<div class="card">${svg}</div>`;
    } else {
      qrCard = `<div class="card plain">${QRCodeLib ? 'No LAN IPv4 address found' : esc(primary ?? '')}</div>`;
    }
    const others = all.slice(1);
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Phone access</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<style>
body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#1c2436;color:#e8ecf4;font-family:'Microsoft YaHei',system-ui,sans-serif}
.card{background:#fff;border-radius:16px;padding:14px}
.card svg{width:230px;height:230px;display:block}
.card.plain{color:#1c2436;font:600 15px/1.6 Consolas,monospace;padding:22px 18px;max-width:250px;word-break:break-all}
code{font:15px/1.5 Consolas,monospace;background:#2b3a55;padding:6px 12px;border-radius:8px}
.hint{font-size:13px;color:#9fb0cc;text-align:center;line-height:1.8;max-width:290px;padding:0 10px}
.alt{font-size:11px;color:#6c7d9c;text-align:center;line-height:1.7}
</style></head><body>
${qrCard}
<code>${esc(primary ?? 'LAN server not running')}</code>
<div class="hint">Make sure the phone is on the same Wi-Fi as this PC,<br>then scan the code to open the pet in the phone browser.<br>For an app-like icon: browser menu &#8594; "Add to Home Screen".</div>
${others.length > 0 ? `<div class="alt">Other adapters:<br>${others.map((u) => esc(u)).join('<br>')}</div>` : ''}
</body></html>`;
  }

  function showQr() {
    try {
      if (qrWin && !qrWin.isDestroyed()) {
        qrWin.focus();
        return;
      }
      qrWin = new BrowserWindow({
        width: 340,
        height: 560,
        useContentSize: true,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        title: 'AI Live3D - Phone access',
        autoHideMenuBar: true,
        backgroundColor: '#1c2436',
      });
      // Keep OUR window title (the page <title> would otherwise replace it).
      qrWin.on('page-title-updated', (e) => e.preventDefault());
      qrWin.webContents.on('console-message', (_e, _level, msg) => log(`[qr] ${msg}`));
      qrWin.on('closed', () => {
        qrWin = null;
      });
      // Server may still be mid-start from a CLI --qr; build the page after it.
      readyPromise
        .then(buildQrHtml)
        .then((html) => {
          if (qrWin && !qrWin.isDestroyed()) {
            qrWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
            log('[lan] qr window shown');
          }
        })
        .catch((err) => log(`[lan] qr window failed: ${err?.stack ?? err}`));
    } catch (err) {
      log(`[lan] qr window error: ${err?.stack ?? err}`);
    }
  }

  let readyPromise = Promise.resolve(false);
  return {
    get running() {
      return !!server;
    },
    get port() {
      return port;
    },
    /** All phone URLs (one per LAN IPv4); primary first. Empty when off. */
    urls,
    lanUrl,

    /** Resolves true once listening, false if no port could be bound. */
    start() {
      if (server) return Promise.resolve(true);
      readyPromise = new Promise((resolve) => {
        let idx = 0;
        const tryNext = () => {
          if (idx >= PORTS.length) {
            log('[lan] no free port in 31790-31794; phone access disabled');
            resolve(false);
            return;
          }
          const candidate = PORTS[idx++];
          const s = http.createServer(onRequest);
          s.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              tryNext();
            } else {
              log(`[lan] server error: ${err.code ?? err.message}`);
              resolve(false);
            }
          });
          s.listen(candidate, '0.0.0.0', () => {
            server = s;
            port = candidate;
            s.on('connection', (sock) => {
              sockets.add(sock);
              sock.on('close', () => sockets.delete(sock));
            });
            // Figure out which adapter a phone should use before announcing.
            routePreferredIp().then((ip) => {
              preferredIp = ip;
              attachWs(s);
              log(`[lan] listening on 0.0.0.0:${candidate} (${APP_VERSION})`);
              if (ip) log(`[lan] route-preferred adapter: ${ip}`);
              for (const u of orderedIps().map(urlOf)) log(`[lan] phone url: ${u}`);
              resolve(true);
            });
          });
        };
        tryNext();
      });
      return readyPromise;
    },

    stop() {
      if (!server) return;
      const s = server;
      server = null;
      port = null;
      if (wss) {
        for (const c of wss.clients) c.terminate();
        wss.close();
        wss = null;
      }
      for (const sock of sockets) sock.destroy();
      sockets.clear();
      s.close();
      log('[lan] server stopped');
    },

    clientsCount() {
      return wss ? wss.clients.size : 0;
    },
    broadcastState(fields) {
      broadcast({ type: 'state', ...fields });
    },
    broadcastPlay(entry) {
      broadcast({ type: 'play', entry });
    },
    broadcastRoam(cmd) {
      broadcast({ type: 'roam', cmd });
    },

    showQr,
  };
}

module.exports = { createLanServer };
