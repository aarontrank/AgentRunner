import { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, Notification } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  // Minimize to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/trayIcon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('AgentRunner');

  const updateMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Open AgentRunner', click: () => mainWindow?.show() },
      { label: 'Settings', click: () => { mainWindow?.show(); mainWindow?.webContents.send('navigate', 'settings'); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { (app as any).isQuitting = true; app.quit(); } },
    ]);
    tray?.setContextMenu(menu);
  };

  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show();
  });

  updateMenu();
}

function registerShortcuts() {
  const send = (channel: string) => mainWindow?.webContents.send(channel);
  // App-level shortcuts are handled via menu accelerators in renderer
}

app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Lazy-load heavy modules after window is up
  const { initDatabase } = require('./database');
  const { initConfig } = require('./config');
  const { registerIpcHandlers } = require('./ipc');
  const { initScheduler } = require('./scheduler');
  const { initShellPath } = require('./executor');

  await initShellPath();
  initDatabase();
  initConfig();
  registerIpcHandlers();
  initScheduler();

  mainWindow?.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('app:ready');
  });
  // In case renderer already loaded
  mainWindow?.webContents.send('app:ready');
});

app.on('activate', () => {
  mainWindow?.show();
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
});

app.on('window-all-closed', () => {
  // On macOS, keep running in tray
});

export { mainWindow };

export function sendNotification(title: string, body: string) {
  new Notification({ title: `AgentRunner — ${title}`, body }).show();
}
