// js/backup/localFileBackup.js
// Electron ネイティブ自動バックアップ専用ヘルパー
// ★ブラウザ向け File System Access API / reha_backup_safety_net_db は完全撤廃済み
// 正本の保存先: ドキュメント\リハ業務管理_自動バックアップ（main/backupIpc.js）

/** Electron デスクトップアプリとして稼働中か */
export function isElectronDesktop() {
  return Boolean(
    typeof window !== 'undefined'
    && window.desktopApp
    && window.desktopApp.isDesktop
  );
}

/**
 * UI 表示用の固定保存先ラベル
 * @returns {string}
 */
export function getElectronBackupFolderLabel() {
  return 'ドキュメント\\リハ業務管理_自動バックアップ';
}

/**
 * 自動バックアップ UI 状態（Electron 1本化後）
 * @returns {{ isDesktop: boolean, autoEnabled: boolean, folderLabel: string }}
 */
export function getElectronBackupUiState() {
  const isDesktop = isElectronDesktop();
  return {
    isDesktop,
    autoEnabled: isDesktop,
    folderLabel: getElectronBackupFolderLabel()
  };
}

/**
 * エクスプローラーでバックアップ専用フォルダを開く
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function openElectronBackupFolder() {
  if (!isElectronDesktop() || typeof window.desktopApp.openBackupFolder !== 'function') {
    return {
      success: false,
      message: 'バックアップフォルダを開く機能はデスクトップアプリ版でのみ利用できます。'
    };
  }

  try {
    const res = await window.desktopApp.openBackupFolder();
    if (res && res.success === false) {
      return {
        success: false,
        message: res.message || 'バックアップフォルダを開けませんでした。'
      };
    }
    return { success: true };
  } catch (e) {
    console.warn('[localFileBackup] openElectronBackupFolder error:', e);
    return {
      success: false,
      message: e?.message || 'バックアップフォルダを開けませんでした。'
    };
  }
}

/**
 * 起動時フック（互換維持・副作用なし）
 * File System Access / 専用 IndexedDB への依存は持たない。
 * @returns {Promise<{ hasFolder: boolean, permission: string, mode: string }>}
 */
export async function initLocalFileBackup() {
  const isDesktop = isElectronDesktop();
  return {
    hasFolder: isDesktop,
    permission: isDesktop ? 'granted' : 'none',
    mode: 'electron-native'
  };
}

/**
 * 起動ログ（Electron 自動保存の有無のみ）
 */
export function logBackupNetStatus() {
  const state = getElectronBackupUiState();
  console.log(
    `[localFileBackup] mode=electron-native desktop=${state.isDesktop} folder=${state.folderLabel} auto=${state.autoEnabled}`
  );
}
