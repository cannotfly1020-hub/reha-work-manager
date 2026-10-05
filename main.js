const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// 二重起動防止のロック取得
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'リハビリ業務管理システム (reha-work-manager)',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  // 医療現場向けに不要なメニューバーを整理
  const menuTemplate = [
    {
      label: 'ファイル',
      submenu: [
        {
          label: '最新状態に更新 (リロード)',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.reload()
        },
        { type: 'separator' },
        {
          label: '終了',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '表示',
      submenu: [
        { label: '拡大', role: 'zoomIn' },
        { label: '縮小', role: 'zoomOut' },
        { label: '標準サイズに戻す', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全画面表示切替', role: 'togglefullscreen' }
      ]
    },
    {
      label: '開発者ツール',
      submenu: [
        {
          label: '開発者ツールを開く/閉じる (F12)',
          accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.loadFile('index.html');

  // ウィンドウが閉じられたときの参照解除
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Windowsでは全ウィンドウが閉じられたらアプリを終了
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 二重起動が試みられた場合は既存ウィンドウを前面に表示
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
