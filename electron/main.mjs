import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';

const port = 37421;
const origin = `http://127.0.0.1:${port}`;
let window;

function sendMenuCommand(command) {
  if (window && !window.isDestroyed()) window.webContents.send('screenwriter-menu-command', command);
}

function installApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Screenplay', accelerator: 'CmdOrCtrl+N', click: () => sendMenuCommand('new') },
        { label: 'Open / Import Fountain…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuCommand('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenuCommand('save') },
        { type: 'separator' },
        { label: 'Export PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendMenuCommand('export-pdf') },
        { label: 'Export Fountain…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuCommand('export-fountain') },
        { type: 'separator' },
        { label: 'Screenplay Dictionary…', click: () => sendMenuCommand('dictionary') },
        { label: 'Revision History…', click: () => sendMenuCommand('revisions') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuCommand('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenuCommand('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) app.quit();

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { const response = await fetch(`${origin}/api/health`); if (response.ok) return; } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The local Screenwriter server did not start.');
}

async function createWindow() {
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.APP_MODE = 'standalone';
  process.env.SCREENWRITER_DATA_DIR = path.join(app.getPath('userData'), 'screenplays');
  await import('../server-dist/index.js');
  await waitForServer();

  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#17211c',
    title: 'Screenwriter',
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' }; });
  await window.loadURL(`${origin}/?mode=standalone`);
  installApplicationMenu();
}

app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.whenReady().then(createWindow).catch((error) => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
