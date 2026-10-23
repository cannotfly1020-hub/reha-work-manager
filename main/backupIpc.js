// main/backupIpc.js
// ドキュメントフォルダへの日次バックアップ書き出し

const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

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
 * レンダラー（画面側）からのファイル保存・取得要求を受信するIPC通信ハンドラー
 */
function setupIpcHandlers() {
  // 1. 自動バックアップJSONの直接書き出し
  ipcMain.handle('save-daily-backup-file', async (event, payload) => {
    try {
      if (!payload) {
        return { success: false, message: 'バックアップデータが空です。' };
      }

      // ★重要：dumpオブジェクト直渡し / { targetDate, data } 包み渡しの両方を自動吸収
      let targetDate = '';
      let dumpData = null;

      if (payload.data && typeof payload.data === 'object') {
        // パターンA: { targetDate: '...', data: dump } で渡された場合
        targetDate = payload.targetDate || formatLocalDate();
        dumpData = payload.data;
      } else {
        // パターンB: dump オブジェクトそのものが渡された場合 (exportView.js の呼び出し形式)
        targetDate = payload.targetDate || formatLocalDate();
        dumpData = payload;
      }

      const backupDir = getBackupDirectoryPath();
      const fileName = `reha_backup_${targetDate}.json`;
      const filePath = path.join(backupDir, fileName);

      // JSON文字列をインデント付きで整形してファイル書き出し
      const jsonStr = typeof dumpData === 'string' ? dumpData : JSON.stringify(dumpData, null, 2);
      fs.writeFileSync(filePath, jsonStr, 'utf8');

      // 14日を超過した過去ファイルを自動消去
      cleanOldBackupFiles(backupDir, 14);

      console.log(`[IPC] バックアップ書き出し成功: ${filePath}`);
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


module.exports = {
  getBackupDirectoryPath,
  setupBackupIpc: setupIpcHandlers,
};
