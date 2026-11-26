const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('node:path');
const { APP_VERSION } = require('./version');

function createTray(getWin, onPickModel) {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  const tray = new Tray(icon);

  const menu = Menu.buildFromTemplate([
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
    { label: 'Open DevTools', click: () => getWin()?.webContents.toggleDevTools() },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip(`AI Live3D ${APP_VERSION}`);
  tray.setContextMenu(menu);
  return tray;
}

module.exports = { createTray };
