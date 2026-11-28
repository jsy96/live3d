// Stage the CDN site (for Tencent CloudBase static hosting) into dist/cdn/.
// The CDN copy carries everything static (page, bundle, styles, models,
// animations, icons, PWA bits) plus an assets.json catalog; the LIVE address
// (tunnel/LAN) is discovered at runtime from the pet-hub cloud function so
// sync/roaming still work. Run after `npm run build`:
//   node scripts/build-cdn-site.mjs
// Hub URL comes from tcb-config.json (hubUrl); without it the page runs
// standalone (no live sync).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist', 'cdn');

let hubUrl = '';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tcb-config.json'), 'utf8'));
  hubUrl = typeof cfg.hubUrl === 'string' ? cfg.hubUrl : '';
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

// The page lives at the CDN root: fix manifest start_url accordingly.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.webmanifest'), 'utf8'));
manifest.start_url = '/index.html';
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

// Catalog for the CDN page (the PC's /api/* doesn't exist there).
const list = (dir, exts) => {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
      .sort()
      .map((f) => ({ path: f, url: `/${path.basename(dir)}/${encodeURIComponent(f)}` }));
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
fs.writeFileSync(
  path.join(OUT, 'cdn-config.js'),
  `window.__LIVE3D_CDN__ = ${JSON.stringify({ hubUrl: hubUrl || null })};\n`
);

// index.html: CDN CSP (live endpoints live on other origins) + config script.
let html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
// NOTE on CSP: host wildcards only match on the LEFTMOST label (*.foo.com);
// "ws://192.168.*" is invalid syntax and silently blocks the connection.
// Scheme sources (https:/wss:) cover the tunnel + hub; 127.0.0.1 covers
// local testing. LAN http/ws from an https CDN page is mixed content anyway.
html = html.replace(
  /content="default-src[^"]*"/,
  'content="default-src \'self\'; script-src \'self\'; worker-src \'self\'; style-src \'self\'; img-src \'self\' data: blob:; connect-src \'self\' blob: data: https: wss: http://127.0.0.1:* ws://127.0.0.1:*;"'
);
html = html.replace(
  '<script type="module" src="../dist/bundle.js"></script>',
  '<script src="/cdn-config.js"></script>\n  <script type="module" src="/dist/bundle.js"></script>'
);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

console.log(`CDN site staged: ${OUT}`);
console.log(`  hub: ${hubUrl || '(standalone — add tcb-config.json hubUrl before deploying)'}`);
