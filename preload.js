const { contextBridge, ipcRenderer } = require('electron');

// レンダラープロセス（画面側）に安全なデスクトップ専用情報およびファイルバックアップAPIを公開
contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',

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
   * @returns {Promise<boolean>}
   */
  openBackupFolder: () => {
    return ipcRenderer.invoke('open-backup-folder');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('リハビリ業務管理システム: デスクトップアプリケーションモードで起動しました（直接ファイル保存API有効）。');
});
