// PC-side registrar for the TCB pet-hub cloud function.
// Whenever the tunnel URL or LAN URLs change, POST them to the hub so the
// CDN-hosted page (static assets on Tencent CloudBase) can find the live PC.
// Config file: tcb-config.json in the app root, gitignored:
//   { "hubUrl": "https://<env>.service.tcloudbase.com/pet-hub",
//     "secret": "<REG_SECRET set on the function>" }
// Without the config the registrar is a silent no-op (LAN-only mode).
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', 'tcb-config.json');

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof cfg.hubUrl === 'string' && typeof cfg.secret === 'string') return cfg;
  } catch {
    /* absent or malformed: LAN-only mode */
  }
  return null;
}

function createTcbRegistrar(log) {
  let cfg = loadConfig();
  if (cfg) log(`[tcb] registrar ready (hub: ${cfg.hubUrl})`);
  else log('[tcb] no tcb-config.json; CDN page will not learn the live address');
  let timer = null;
  let latest = null;

  async function push() {
    if (!cfg || !latest) return;
    try {
      const r = await fetch(cfg.hubUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'register', secret: cfg.secret, ...latest }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.code !== 0) log(`[tcb] register rejected: ${JSON.stringify(j).slice(0, 120)}`);
    } catch (err) {
      log(`[tcb] register failed: ${err?.message ?? err}`);
    }
  }

  /** Register the PC's current addresses (debounced; safe to call often). */
  function register(fields) {
    if (!cfg) return;
    latest = { ...latest, ...fields };
    clearTimeout(timer);
    timer = setTimeout(push, 1500);
  }

  return { register, configured: () => !!cfg };
}

module.exports = { createTcbRegistrar };
