const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('node:path');
const { APP_VERSION } = require('./version');

// lanHooks (all optional so the tray still builds if LAN is unavailable):
//   lanState() -> { running: bool, url: string|null }
//   toggleLan()/showQr() -> click handlers
// Returns { refresh } so the main process can rebuild the checkmarks after the
// LAN server (async) starts or stops.
function createTray(getWin, onPickModel, lanHooks = {}) {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  const tray = new Tray(icon);

  const buildMenu = () => {
    const lan = lanHooks.lanState?.() ?? { running: false, url: null };
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
          else win.show();
        },
      },
      { type: 'separator' },
      { label: `Phone: ${lan.running ? (lan.url ?? 'listening') : 'server off'}`, enabled: false },
      {
        label: 'LAN server (phone access)',
        type: 'checkbox',
        checked: lan.running,
        click: () => lanHooks.toggleLan?.(),
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
