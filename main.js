const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 二重起動防止のロック取得
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;

/**
 * バックアップ専用フォルダのパスを取得・未存在時は自動生成
 * 保存先: Windowsの「ドキュメント」フォルダ内 \ リハ業務管理_自動バックアップ
 */
function getBackupDirectoryPath() {
  const documentsPath = app.getPath('documents');
  const backupDir = path.join(documentsPath, 'リハ業務管理_自動バックアップ');
  if (!fs.existsSync(backupDir)) {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create backup directory:', e);
    }
  }
  return backupDir;
}

/**
 * 直近14世代（14日分）を超過した古い自動バックアップJSONを安全に自動消去する
 */
function cleanOldBackupFiles(backupDir, keepCount = 14) {
  try {
    if (!fs.existsSync(backupDir)) return;
    const files = fs.readdirSync(backupDir);
    const backupFiles = files
      .filter((file) => file.startsWith('reha_autobackup_') && file.endsWith('.json'))
      .sort(); // ファイル名昇順（日付順 YYYY-MM-DD）

    while (backupFiles.length > keepCount) {
      const oldestFile = backupFiles.shift();
      if (oldestFile) {
        const fullPath = path.join(backupDir, oldestFile);
        fs.unlinkSync(fullPath);
      }
    }
  } catch (error) {
    console.error('cleanOldBackupFiles error:', error);
  }
}

/**
 * レンダラー（画面側）からのファイル保存・取得要求を受信するIPC通信ハンドラー
 */
function setupIpcHandlers() {
  // 1. 自動バックアップJSONの直接書き出し
  ipcMain.handle('save-daily-backup-file', async (event, payload) => {
    try {
      if (!payload || !payload.targetDate || !payload.data) {
        return { success: false, message: 'バックアップデータが不正です。' };
      }

      const backupDir = getBackupDirectoryPath();
      const fileName = `reha_autobackup_${payload.targetDate}.json`;
      const filePath = path.join(backupDir, fileName);

      // JSON文字列をインデント付きで整形してファイル書き出し
      const jsonStr = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data, null, 2);
      fs.writeFileSync(filePath, jsonStr, 'utf8');

      // 14日を超過した過去ファイルを自動消去
      cleanOldBackupFiles(backupDir, 14);

      return {
        success: true,
        filePath,
        fileName,
        message: `「ドキュメント\\リハ業務管理_自動バックアップ」に保存しました。`
      };
    } catch (error) {
      console.error('save-daily-backup-file error:', error);
      return { success: false, message: error.message || 'ファイル書き出しに失敗しました。' };
    }
  });

  // 2. バックアップ保存フォルダをエクスプローラーで直接開く
  ipcMain.handle('open-backup-folder', async () => {
    try {
      const backupDir = getBackupDirectoryPath();
      await shell.openPath(backupDir);
      return { success: true };
    } catch (error) {
      console.error('open-backup-folder error:', error);
      return { success: false, message: error.message };
    }
  });

  // 3. バックアップフォルダのパス情報を取得する
  ipcMain.handle('get-backup-dir-path', async () => {
    return getBackupDirectoryPath();
  });
}

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
      sandbox: false, // 外部ファイル連携とプリロード通信のためfalseに変更しcontextBridgeで厳格保護
      webSecurity: true
    }
  });

  // 医療現場向けに不要なメニューバーを整理
  const menuTemplate = [
    {
      label: 'ファイル',
      submenu: [
        {
          label: 'バックアップフォルダを開く',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            const dir = getBackupDirectoryPath();
            shell.openPath(dir);
          }
        },
        { type: 'separator' },
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
  setupIpcHandlers();
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
