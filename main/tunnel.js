// Public internet tunnel (cloudflared quick tunnel).
// "Lend the pet to a friend in another city": cloudflared exposes the LAN
// server (localhost:<port>) at a random https://*.trycloudflare.com URL that
// a phone anywhere can open — no app install, no account, no port forward.
// The friend's page shows up as a regular roaming client, so the pet can be
// handed off to them and recalled afterwards.
//
// Requires the cloudflared CLI:
//   winget install Cloudflare.cloudflared
// Quick-tunnel URLs are unguessable but PUBLIC while running — treat the URL
// as the credential and turn the tunnel off when done playing.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// winget puts cloudflared on PATH via links; check a few common spots too.
function findCloudflared() {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const candidates = [
    exe,
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', exe),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'cloudflared', exe),
    path.join(process.env.ProgramFiles ?? '', 'cloudflared', exe),
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'cloudflared', exe),
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // keep looking
    }
  }
  return null;
}

function createTunnel(log, hooks = {}) {
  let proc = null;
  let url = null;

  function start() {
    if (proc) return true;
    const port = hooks.getPort?.();
    if (!port) {
      log('[tunnel] LAN server not running; start it first');
      return false;
    }
    const exe = findCloudflared();
    if (!exe) {
      log('[tunnel] cloudflared not found — winget install Cloudflare.cloudflared');
      return false;
    }
    url = null;
    proc = spawn(exe, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // cloudflared prints the assigned URL on stderr; grab the first match.
    const pickUrl = (chunk) => {
      if (url) return;
      const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m) {
        url = m[0];
        log(`[tunnel] public url: ${url}`);
        hooks.onUrl?.(url);
      }
    };
    proc.stdout.on('data', pickUrl);
    proc.stderr.on('data', pickUrl);
    proc.on('error', (err) => {
      log(`[tunnel] spawn error: ${err.message}`);
      proc = null;
      url = null;
    });
    proc.on('exit', (code) => {
      proc = null;
      if (url) log(`[tunnel] stopped (code ${code ?? '?'})`);
      url = null;
      hooks.onUrl?.(null);
    });
    log('[tunnel] starting cloudflared quick tunnel...');
    return true;
  }

  function stop() {
    if (!proc) return;
    // TerminateProcess so no zombie console child lingers.
    proc.kill();
    proc = null;
    url = null;
    log('[tunnel] stopped');
    hooks.onUrl?.(null);
  }

  return {
    get running() {
      return !!proc;
    },
    get url() {
      return url;
    },
    available: () => !!findCloudflared(),
    start,
    stop,
  };
}

module.exports = { createTunnel };
