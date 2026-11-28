const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('node:path');
const { APP_VERSION } = require('./version');

// lanHooks (all optional so the tray still builds if LAN is unavailable):
//   lanState() -> { running, url, clients, tunnel: {running,url,available} }
//   toggleLan()/toggleTunnel()/showQr()/goPhone()/goDesktop() -> click handlers
// Returns { refresh } so the main process can rebuild the checkmarks after the
// LAN server (async) starts/stops or phones connect/disconnect.
function createTray(getWin, onPickModel, lanHooks = {}) {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  const tray = new Tray(icon);

  const buildMenu = () => {
    const lan = lanHooks.lanState?.() ?? {
      running: false,
      url: null,
      clients: 0,
      tunnel: { running: false, url: null, available: false },
    };
    const t = lan.tunnel ?? { running: false, url: null, available: false };
    return Menu.buildFromTemplate([
      { label: `AI Live3D ${APP_VERSION}`, enabled: false },
      { type: 'separator' },
      { label: 'Change model...', click: onPickModel },
      {
        label: 'Show / hide pet',
        click: () => {
          const win = getWin();
          if (!win) return;
          if (win.isVisible()) win.hide();
          // Hidden while roaming on a phone: recall plays the enter animation.
          else if (lanHooks.goDesktop) lanHooks.goDesktop();
          else win.show();
        },
      },
      { type: 'separator' },
      { label: `Phone: ${lan.running ? (lan.url ?? 'listening') : 'server off'}`, enabled: false },
      {
        label: `Send pet to phone${lan.clients > 0 ? ` (${lan.clients})` : ''}`,
        enabled: lan.running && lan.clients > 0,
        click: () => lanHooks.goPhone?.(),
      },
      {
        label: 'LAN server (phone access)',
        type: 'checkbox',
        checked: lan.running,
        click: () => lanHooks.toggleLan?.(),
      },
      {
        label: t.url ? `Public link: ${t.url.replace('https://', '')}` : 'Public link (internet)',
        type: 'checkbox',
        checked: t.running,
        enabled: lan.running && t.available,
        // Greyed with cloudflared missing: the click logs the install hint.
        click: () => lanHooks.toggleTunnel?.(),
      },
      { label: 'Show QR code', click: () => lanHooks.showQr?.() },
      { type: 'separator' },
      { label: 'Open DevTools', click: () => getWin()?.webContents.toggleDevTools() },
      { label: 'Quit', click: () => app.quit() },
    ]);
  };

  tray.setContextMenu(buildMenu());
  tray.setToolTip(`AI Live3D ${APP_VERSION}`);
  return {
    refresh: () => tray.setContextMenu(buildMenu()),
  };
}

module.exports = { createTray };
