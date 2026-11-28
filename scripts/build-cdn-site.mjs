// Stage the CDN site (for Tencent CloudBase static hosting) into dist/cdn/pet/.
// The hosting root belongs to other apps — the pet lives under the /pet/ path.
// The CDN copy carries everything static (page, bundle, styles, models,
// animations, icons, PWA bits) plus an assets.json catalog; the LIVE address
// (tunnel/LAN) is read at runtime from /pet/live.json, which the PC registrar
// (main/tcb.js) publishes on every address change. Run after `npm run build`:
//   node scripts/build-cdn-site.mjs
// Without tcb-config.json (envId) the page runs standalone (no live sync).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist', 'cdn', 'pet');
const BASE = '/pet/';

let hubUrl = null;
let tcbEnv = null;
let assetOrigin = null;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tcb-config.json'), 'utf8'));
  // live.json is published to the same static hosting by the PC registrar
  // (main/tcb.js) — same-origin fetch, no CORS, no cloud function needed.
  if (typeof cfg.envId === 'string' && cfg.envId) {
    hubUrl = `${BASE}live.json`;
    // Cloud sync lane (pet_state realtime document) — the no-PC backbone.
    tcbEnv = cfg.envId;
    // Big binaries (models/animations/bundle) are fetched from the TCB
    // hosting origin directly — its China edge measures ~1.7s for a 15MB
    // model vs 20-45s through the CF front. The page keeps its clean
    // zc.leige.online shell; only asset URLs point here (browser fetch()
    // gets per-origin CORS from TCB, no interstitial).
    assetOrigin = `https://${cfg.envId}-1301305388.tcloudbaseapp.com`;
  }
} catch {
  /* standalone build */
}

const APP_VERSION =
  fs.readFileSync(path.join(ROOT, 'main', 'version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1] ?? 'dev';

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const s = path.join(from, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, path.join(to, f));
    else copy(s, path.join(to, f));
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Static assets at the paths index.html references.
copy(path.join(ROOT, 'src', 'styles.css'), path.join(OUT, 'styles.css'));
copy(path.join(ROOT, 'dist', 'bundle.js'), path.join(OUT, 'dist', 'bundle.js'));
copyDir(path.join(ROOT, 'models'), path.join(OUT, 'models'));
copyDir(path.join(ROOT, 'animations'), path.join(OUT, 'animations'));
copy(path.join(ROOT, 'assets', 'icon-192.png'), path.join(OUT, 'icon-192.png'));
copy(path.join(ROOT, 'assets', 'icon-512.png'), path.join(OUT, 'icon-512.png'));
copy(path.join(ROOT, 'assets', 'sw.js'), path.join(OUT, 'sw.js'));

// The page lives under /pet/: fix manifest paths accordingly.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.webmanifest'), 'utf8'));
manifest.start_url = `${BASE}index.html`;
manifest.scope = BASE;
manifest.icons = manifest.icons.map((i) => ({ ...i, src: BASE + i.src.slice(1) }));
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

// Catalog for the CDN page (the PC's /api/* doesn't exist there).
const list = (dir, exts) => {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
      .sort()
      .map((f) => ({ path: f, url: `${BASE}${path.basename(dir)}/${encodeURIComponent(f)}` }));
  } catch {
    return [];
  }
};
fs.writeFileSync(
  path.join(OUT, 'assets.json'),
  JSON.stringify(
    {
      version: APP_VERSION,
      models: list(path.join(ROOT, 'models'), ['.vrm', '.glb']),
      animations: list(path.join(ROOT, 'animations'), ['.vrma']),
    },
    null,
    1
  )
);

// Runtime config (loaded as a normal script to satisfy script-src 'self').
// Also hosts the asset-fallback shim: the fast-origin <script>/<link> tags
// cannot carry inline onerror handlers (CSP blocks them), so a capture-phase
// listener swaps failed fast-origin loads to the same-origin CDN path.
fs.writeFileSync(
  path.join(OUT, 'cdn-config.js'),
  `window.__LIVE3D_CDN__ = ${JSON.stringify({ hubUrl, base: BASE, envId: tcbEnv, assetOrigin })};
(function () {
  var cfg = window.__LIVE3D_CDN__;
  if (!cfg || !cfg.assetOrigin) return;
  document.addEventListener('error', function (ev) {
    var el = ev.target;
    if (!el || !el.tagName || el.getAttribute('data-fb')) return;
    var src = el.src || el.href || '';
    if (src.indexOf(cfg.assetOrigin) !== 0) return;
    var swap = src.slice(cfg.assetOrigin.length);
    el.setAttribute('data-fb', '1');
    if (el.tagName === 'SCRIPT') {
      el.remove();
      var s = document.createElement('script');
      s.type = el.type || 'module';
      s.src = swap;
      document.head.appendChild(s);
    } else {
      el.href = swap;
    }
  }, true);
})();
`
);

// index.html: CDN CSP (live endpoints live on other origins) + config script.
// Versioned asset URLs so a redeployed bundle can't be served from cache.
let html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
// NOTE on CSP: host wildcards only match on the LEFTMOST label (*.foo.com);
// "ws://192.168.*" is invalid syntax and silently blocks the connection.
// Scheme sources (https:/wss:) cover the tunnel + hub; 127.0.0.1 covers
// local testing. LAN http/ws from an https CDN page is mixed content anyway.
// The asset origin (TCB hosting, for the big bundle/styles) joins
// script/style-src; models/animations are fetched, covered by connect-src.
html = html.replace(
  /content="default-src[^"]*"/,
  `content="default-src 'self'; script-src 'self' ${assetOrigin ?? ''}; worker-src 'self'; style-src 'self' ${assetOrigin ?? ''}; img-src 'self' data: blob:; connect-src 'self' blob: data: https: wss: http://127.0.0.1:* ws://127.0.0.1:*;"`
);
// Big first-load assets load from the fast TCB origin; the cdn-config shim
// swaps them to the same-origin CDN path if that origin ever fails.
const bundleSrc = assetOrigin ? `${assetOrigin}${BASE}dist/bundle.js?v=${APP_VERSION}` : `${BASE}dist/bundle.js?v=${APP_VERSION}`;
html = html.replace(
  '<script type="module" src="../dist/bundle.js"></script>',
  `<script src="${BASE}cdn-config.js?v=${APP_VERSION}"></script>\n  <script type="module" src="${bundleSrc}"></script>`
);
// Root-absolute asset references move under /pet/ (versioned against cache).
// styles.css rides the fast origin too (fallback handled by cdn-config.js).
const cssHref = assetOrigin ? `${assetOrigin}${BASE}styles.css?v=${APP_VERSION}` : `styles.css?v=${APP_VERSION}`;
html = html.replaceAll('href="styles.css"', `href="${cssHref}"`);
html = html.replaceAll('href="/manifest.webmanifest"', `href="${BASE}manifest.webmanifest"`);
html = html.replaceAll('href="/icon-192.png"', `href="${BASE}icon-192.png"`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

console.log(`CDN site staged: ${OUT}`);
console.log(`  live address: ${hubUrl ?? '(standalone — set envId in tcb-config.json before deploying)'}`);
