const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

/**
 * デスクトップ専用 API（日次バックアップ＋院内共有マスター同期＋端末名）
 * window.desktopApp / window.electronBackup の両方に同一オブジェクトを公開
 */
const backupBridge = {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',

  /**
   * 端末ホスト名（監査ログ併記用）
   * @returns {string}
   */
  getHostname: () => {
    try {
      return os.hostname() || 'UNKNOWN-PC';
    } catch (_) {
      return 'UNKNOWN-PC';
    }
  },

  /**
   * 日次自動バックアップデータをPCの専用フォルダ（ドキュメント/リハ業務管理_自動バックアップ/）へ直接書き出す
   * @param {Object} dumpData バックアップJSONオブジェクト
   * @returns {Promise<{ success: boolean, filePath?: string, error?: string }>}
   */
  saveDailyBackup: (dumpData) => {
    return ipcRenderer.invoke('save-daily-backup-file', dumpData);
  },

  /**
   * 自動バックアップが保存されているフォルダをWindowsエクスプローラーで直接開く
   * @returns {Promise<boolean|{ success: boolean }>}
   */
  openBackupFolder: () => {
    return ipcRenderer.invoke('open-backup-folder');
  },

  /**
   * 共有フォルダ内の reha_shared_master.json を読み込む
   * @returns {Promise<{ exists: boolean, success?: boolean, data?: Object, sharedDir?: string, filePath?: string }>}
   */
  loadSharedMaster: () => {
    return ipcRenderer.invoke('load-shared-master');
  },

  /**
   * フルダンプを共有マスターへアトミック保存（日次バックアップも併記）
   * @param {Object} dumpData
   * @returns {Promise<{ success: boolean, filePath?: string, message?: string }>}
   */
  saveSharedMaster: (dumpData) => {
    return ipcRenderer.invoke('save-shared-master', dumpData);
  },

  /**
   * 院内共有フォルダ（NAS等）をダイアログで選択・保存
   * @returns {Promise<{ success: boolean, path?: string, canceled?: boolean }>}
   */
  selectSharedFolder: () => {
    return ipcRenderer.invoke('select-shared-folder');
  },

  /**
   * 現在の共有フォルダパスを取得
   * @returns {Promise<{ success: boolean, path?: string, masterPath?: string, masterExists?: boolean }>}
   */
  getSharedFolderPath: () => {
    return ipcRenderer.invoke('get-shared-folder-path');
  },

  /**
   * 共有フォルダをエクスプローラーで開く
   * @returns {Promise<{ success: boolean, path?: string, message?: string }>}
   */
  openSharedFolder: () => {
    return ipcRenderer.invoke('open-shared-folder');
  }
};

// 既存コード互換
contextBridge.exposeInMainWorld('desktopApp', backupBridge);
// 仕様名（electronBackup）でも同一 API を公開
contextBridge.exposeInMainWorld('electronBackup', backupBridge);

window.addEventListener('DOMContentLoaded', () => {
  console.log('リハビリ業務管理システム: デスクトップアプリケーションモードで起動しました（共有マスター同期API有効）。');
});
