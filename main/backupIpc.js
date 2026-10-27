// main/backupIpc.js
// ドキュメントフォルダへの日次バックアップ書き出し
// ★院内LAN共有: reha_shared_master.json の自動読み書き・フォルダ選択

const { app, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const SHARED_MASTER_FILE = 'reha_shared_master.json';
const SHARED_CONFIG_FILE = 'reha_shared_folder_config.json';

/**
 * バックアップ専用フォルダのパスを取得・未存在時は自動生成
 * 保存先: Windowsの「ドキュメント」フォルダ内 \ リハ業務管理_自動バックアップ
 */
function formatLocalDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
 * アプリルート（exe 直下 / 開発時はプロジェクトルート）
 * @returns {string}
 */
function getAppRootDirectory() {
  try {
    if (app.isPackaged) {
      return path.dirname(process.execPath);
    }
  } catch (_) { /* ignore */ }
  // main/backupIpc.js → プロジェクトルート
  return path.join(__dirname, '..');
}

/**
 * 共有フォルダ設定の保存パス（userData）
 * @returns {string}
 */
function getSharedConfigPath() {
  return path.join(app.getPath('userData'), SHARED_CONFIG_FILE);
}

/**
 * 共有フォルダ設定を読み込み
 * @returns {{ sharedFolderPath: string }}
 */
function readSharedFolderConfig() {
  try {
    const cfgPath = getSharedConfigPath();
    if (!fs.existsSync(cfgPath)) return { sharedFolderPath: '' };
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      sharedFolderPath: typeof parsed?.sharedFolderPath === 'string'
        ? parsed.sharedFolderPath.trim()
        : ''
    };
  } catch (e) {
    console.warn('[backupIpc] readSharedFolderConfig soft-fail:', e?.message || e);
    return { sharedFolderPath: '' };
  }
}

/**
 * 共有フォルダ設定を保存
 * @param {string} folderPath
 * @returns {boolean}
 */
function writeSharedFolderConfig(folderPath) {
  try {
    const cfgPath = getSharedConfigPath();
    const payload = {
      sharedFolderPath: folderPath || '',
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(cfgPath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[backupIpc] writeSharedFolderConfig error:', e);
    return false;
  }
}

/**
 * 共有データディレクトリを解決
 * 優先順:
 * 1. ユーザー指定（select-shared-folder）
 * 2. exe/プロジェクト直下の shared_data（存在する場合）
 * 3. 従来のローカルドキュメントバックアップフォルダ
 * @returns {string}
 */
function getSharedDataDirectoryPath() {
  const cfg = readSharedFolderConfig();
  if (cfg.sharedFolderPath) {
    try {
      if (!fs.existsSync(cfg.sharedFolderPath)) {
        fs.mkdirSync(cfg.sharedFolderPath, { recursive: true });
      }
      if (fs.existsSync(cfg.sharedFolderPath)) {
        return cfg.sharedFolderPath;
      }
    } catch (e) {
      console.warn('[backupIpc] configured shared folder unavailable:', e?.message || e);
    }
  }

  const exeShared = path.join(getAppRootDirectory(), 'shared_data');
  try {
    if (fs.existsSync(exeShared)) {
      return exeShared;
    }
  } catch (_) { /* ignore */ }

  return getBackupDirectoryPath();
}

/**
 * 共有マスター JSON のフルパス
 * @returns {string}
 */
function getSharedMasterFilePath() {
  return path.join(getSharedDataDirectoryPath(), SHARED_MASTER_FILE);
}

/**
 * アトミック書き込み（一時ファイル → リネーム）
 * @param {string} filePath
 * @param {string} content
 */
function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  try {
    // Windows では既存ファイル上への rename が失敗することがあるため先に削除
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (renameErr) {
    try {
      fs.copyFileSync(tmpPath, filePath);
      fs.unlinkSync(tmpPath);
    } catch (copyErr) {
      try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
      throw copyErr || renameErr;
    }
  }
}

/**
 * 直近14世代（14日分）を超過した古い自動バックアップJSONを安全に自動消去する
 */
function isDailyBackupFileName(file) {
  if (!file || !file.endsWith('.json')) return false;
  // 現行: reha_backup_YYYY-MM-DD.json / 旧互換: reha_autobackup_YYYY-MM-DD.json
  return file.startsWith('reha_backup_') || file.startsWith('reha_autobackup_');
}

function cleanOldBackupFiles(backupDir, keepCount = 14) {
  try {
    if (!fs.existsSync(backupDir)) return;
    const files = fs.readdirSync(backupDir);
    const backupFiles = files
      .filter((file) => isDailyBackupFileName(file))
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
 * dump ペイロードから targetDate / dumpData を吸収
 * @param {*} payload
 * @returns {{ targetDate: string, dumpData: Object|string|null }}
 */
function normalizeDumpPayload(payload) {
  let targetDate = '';
  let dumpData = null;

  if (!payload) {
    return { targetDate: formatLocalDate(), dumpData: null };
  }

  if (payload.data && typeof payload.data === 'object') {
    targetDate = payload.targetDate || formatLocalDate();
    dumpData = payload.data;
  } else {
    targetDate = payload.targetDate || formatLocalDate();
    dumpData = payload;
  }

  return { targetDate, dumpData };
}

/**
 * 日次バックアップファイルへ書き出し（共有保存時にも併用）
 * @param {Object|string} dumpData
 * @param {string} targetDate
 * @returns {{ success: boolean, filePath?: string, fileName?: string, message?: string }}
 */
function writeDailyBackupFile(dumpData, targetDate) {
  const backupDir = getBackupDirectoryPath();
  const dateStr = targetDate || formatLocalDate();
  const fileName = `reha_backup_${dateStr}.json`;
  const filePath = path.join(backupDir, fileName);
  const jsonStr = typeof dumpData === 'string' ? dumpData : JSON.stringify(dumpData, null, 2);
  atomicWriteFile(filePath, jsonStr);
  cleanOldBackupFiles(backupDir, 14);
  return {
    success: true,
    filePath,
    fileName,
    message: `「ドキュメント\\リハ業務管理_自動バックアップ」に保存しました。`
  };
}

/**
 * レンダラー（画面側）からのファイル保存・取得要求を受信するIPC通信ハンドラー
 */
function setupIpcHandlers() {
  // 1. 自動バックアップJSONの直接書き出し
  ipcMain.handle('save-daily-backup-file', async (event, payload) => {
    try {
      if (!payload) {
        return { success: false, message: 'バックアップデータが空です。' };
      }

      const { targetDate, dumpData } = normalizeDumpPayload(payload);
      if (!dumpData) {
        return { success: false, message: 'バックアップデータが空です。' };
      }

      const result = writeDailyBackupFile(dumpData, targetDate);
      console.log(`[IPC] バックアップ書き出し成功: ${result.filePath}`);
      return result;
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

  // 4. 共有マスター読み込み
  ipcMain.handle('load-shared-master', async () => {
    try {
      const sharedDir = getSharedDataDirectoryPath();
      const filePath = path.join(sharedDir, SHARED_MASTER_FILE);

      if (!fs.existsSync(filePath)) {
        return {
          exists: false,
          success: true,
          sharedDir,
          filePath,
          message: '共有マスターファイルはまだありません。'
        };
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (parseErr) {
        return {
          exists: true,
          success: false,
          sharedDir,
          filePath,
          message: '共有マスターJSONの解析に失敗しました。',
          error: parseErr.message
        };
      }

      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(filePath).mtimeMs;
      } catch (_) { /* ignore */ }

      return {
        exists: true,
        success: true,
        data,
        sharedDir,
        filePath,
        mtimeMs,
        message: '共有マスターを読み込みました。'
      };
    } catch (error) {
      console.error('load-shared-master error:', error);
      return {
        exists: false,
        success: false,
        message: error.message || '共有マスターの読み込みに失敗しました。'
      };
    }
  });

  // 5. 共有マスター保存（アトミック）＋日次バックアップも併記
  ipcMain.handle('save-shared-master', async (event, payload) => {
    try {
      if (!payload) {
        return { success: false, message: '共有マスターデータが空です。' };
      }

      const { targetDate, dumpData } = normalizeDumpPayload(payload);
      if (!dumpData) {
        return { success: false, message: '共有マスターデータが空です。' };
      }

      const sharedDir = getSharedDataDirectoryPath();
      if (!fs.existsSync(sharedDir)) {
        fs.mkdirSync(sharedDir, { recursive: true });
      }

      const filePath = path.join(sharedDir, SHARED_MASTER_FILE);
      const enriched = typeof dumpData === 'string'
        ? dumpData
        : {
          ...dumpData,
          sharedMaster: true,
          sharedSavedAt: new Date().toISOString(),
          targetDate: targetDate || formatLocalDate()
        };
      const jsonStr = typeof enriched === 'string' ? enriched : JSON.stringify(enriched, null, 2);
      atomicWriteFile(filePath, jsonStr);

      // 従来の日次バックアップも同時記録
      let daily = null;
      try {
        daily = writeDailyBackupFile(
          typeof dumpData === 'string' ? JSON.parse(dumpData) : dumpData,
          targetDate || formatLocalDate()
        );
      } catch (dailyErr) {
        console.warn('[IPC] shared master saved but daily backup soft-fail:', dailyErr);
      }

      console.log(`[IPC] 共有マスター書き出し成功: ${filePath}`);
      return {
        success: true,
        filePath,
        sharedDir,
        dailyBackupPath: daily?.filePath || '',
        message: `共有マスターを保存しました: ${filePath}`
      };
    } catch (error) {
      console.error('save-shared-master error:', error);
      return { success: false, message: error.message || '共有マスターの保存に失敗しました。' };
    }
  });

  // 6. 共有フォルダ選択ダイアログ
  ipcMain.handle('select-shared-folder', async () => {
    try {
      const current = getSharedDataDirectoryPath();
      const result = await dialog.showOpenDialog({
        title: '院内共有フォルダ（NAS等）を選択',
        defaultPath: current || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory']
      });

      if (result.canceled || !result.filePaths || !result.filePaths[0]) {
        return {
          success: false,
          canceled: true,
          path: current,
          message: 'フォルダ選択がキャンセルされました。'
        };
      }

      const selected = result.filePaths[0];
      if (!fs.existsSync(selected)) {
        fs.mkdirSync(selected, { recursive: true });
      }
      writeSharedFolderConfig(selected);

      return {
        success: true,
        canceled: false,
        path: selected,
        masterPath: path.join(selected, SHARED_MASTER_FILE),
        message: `共有フォルダを設定しました: ${selected}`
      };
    } catch (error) {
      console.error('select-shared-folder error:', error);
      return { success: false, message: error.message || '共有フォルダの選択に失敗しました。' };
    }
  });

  // 7. 現在の共有フォルダパス取得
  ipcMain.handle('get-shared-folder-path', async () => {
    try {
      const sharedDir = getSharedDataDirectoryPath();
      const cfg = readSharedFolderConfig();
      return {
        success: true,
        path: sharedDir,
        configuredPath: cfg.sharedFolderPath || '',
        masterPath: path.join(sharedDir, SHARED_MASTER_FILE),
        masterExists: fs.existsSync(path.join(sharedDir, SHARED_MASTER_FILE))
      };
    } catch (error) {
      console.error('get-shared-folder-path error:', error);
      return { success: false, path: '', message: error.message };
    }
  });
}

module.exports = {
  getBackupDirectoryPath,
  getSharedDataDirectoryPath,
  getSharedMasterFilePath,
  setupBackupIpc: setupIpcHandlers,
};
