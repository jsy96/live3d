// PC-side publisher for the Tencent CloudBase CDN copy.
// Whenever the tunnel URL or LAN URLs change, we publish a tiny live.json to
// the env's static hosting (same origin as the CDN page) so the page knows
// where the live PC is — no cloud function, no database, same-origin fetch.
//
// Deployment uses the local cloudbase CLI (devDependency, already logged in
// via `cloudbase login`). Config file: tcb-config.json in the app root,
// gitignored: { "envId": "<tcb env id>" }
// Without the config this is a silent no-op (LAN-only mode).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CONFIG_PATH = path.join(__dirname, '..', 'tcb-config.json');

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof cfg.envId === 'string' && cfg.envId) return cfg;
  } catch {
    /* absent or malformed: LAN-only mode */
  }
  return null;
}

function cloudbaseBin() {
  // The bin shim is a plain JS file — invoke it with Electron's bundled Node
  // directly. (spawn('...cloudbase.cmd') without shell:true fails on Node 20+.)
  const local = path.join(__dirname, '..', 'node_modules', '@cloudbase', 'cli', 'bin', 'cloudbase');
  try {
    fs.accessSync(local);
    return local;
  } catch {
    return null;
  }
}

function createTcbRegistrar(log) {
  const cfg = loadConfig();
  const bin = cloudbaseBin();
  if (cfg && bin) log(`[tcb] publisher ready (env: ${cfg.envId})`);
  else log('[tcb] no tcb-config.json or cloudbase CLI; CDN page will not learn the live address');
  let latest = null;
  let publishing = false;
  let dirty = false;

  function publish() {
    if (!cfg || !bin || !latest || publishing) {
      dirty = true; // retried after the in-flight publish finishes
      return;
    }
    publishing = true;
    const tmp = path.join(os.tmpdir(), `live3d-live-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(latest));
    const proc = spawn(
      'node',
      [
        bin,
        // Must match the BASE in scripts/build-cdn-site.mjs (hosting root
        // belongs to other apps; the pet lives under /pet/).
        'hosting',
        'deploy',
        tmp,
        '/pet/live.json',
        '-e',
        cfg.envId,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    let err = '';
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) => {
      log(`[tcb] publish spawn error: ${e.message}`);
      publishing = false;
    });
    proc.on('exit', (code) => {
      publishing = false;
      fs.unlink(tmp, () => {});
      if (code === 0) log('[tcb] live.json published');
      else {
        dirty = true;
        log(`[tcb] publish failed (code ${code}): ${err.slice(0, 120)}`);
      }
      if (dirty) {
        dirty = false;
        setTimeout(publish, 2000);
      }
    });
  }

  /** Publish the PC's current addresses (debounced; safe to call often). */
  function register(fields) {
    if (!cfg || !bin) return;
    latest = { ...latest, ...fields, updatedAt: Date.now() };
    // Hosting deploy takes a few seconds; 10s debounce batches bursts.
    clearTimeout(register._t);
    register._t = setTimeout(publish, 10000);
  }

  return { register, configured: () => !!cfg && !!bin };
}

module.exports = { createTcbRegistrar };
