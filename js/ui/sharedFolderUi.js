// js/ui/sharedFolderUi.js
// 院内LAN共有フォルダー（NAS等）選択・ステータス表示 UI

import { showToast } from './toast.js';

/**
 * Electron 共有フォルダ API
 * @returns {object|null}
 */
function getSharedFolderBridge() {
  if (typeof window === 'undefined') return null;
  if (window.electronBackup?.selectSharedFolder && window.electronBackup?.getSharedFolderPath) {
    return window.electronBackup;
  }
  if (window.desktopApp?.selectSharedFolder && window.desktopApp?.getSharedFolderPath) {
    return window.desktopApp;
  }
  return null;
}

/**
 * パス末尾を表示用に短縮
 * @param {string} fullPath
 * @param {number} [maxLen=48]
 * @returns {string}
 */
function shortenPath(fullPath, maxLen = 48) {
  const p = String(fullPath || '').trim();
  if (!p) return '';
  if (p.length <= maxLen) return p;
  return `…${p.slice(-(maxLen - 1))}`;
}

/**
 * ヘッダー／Excel画面の共有先ステータスを更新
 * @param {{ path?: string, configuredPath?: string, masterPath?: string, masterExists?: boolean, success?: boolean }|null} info
 */
export function applySharedFolderStatusToUi(info) {
  const iconEl = document.getElementById('sharedFolderStatusIcon');
  const textEl = document.getElementById('sharedFolderStatusText');
  const badgeEl = document.getElementById('sharedFolderHeaderBadge');
  const exportBadge = document.getElementById('sharedFolderExportStatusBadge');
  const masterHint = document.getElementById('sharedFolderMasterPathHint');

  const bridge = getSharedFolderBridge();
  if (!bridge) {
    const offlineMsg = '共有先: デスクトップアプリ版で設定可';
    if (textEl) textEl.textContent = offlineMsg;
    if (iconEl) iconEl.textContent = '📂';
    if (badgeEl) {
      badgeEl.style.background = '#f1f5f9';
      badgeEl.title = offlineMsg;
    }
    if (exportBadge) {
      exportBadge.textContent = offlineMsg;
      exportBadge.style.color = '#64748b';
    }
    if (masterHint) masterHint.textContent = '';
    return;
  }

  const path = (info && info.path) ? String(info.path) : '';
  const configured = (info && info.configuredPath) ? String(info.configuredPath) : '';
  const masterPath = (info && info.masterPath) ? String(info.masterPath) : '';
  const masterExists = Boolean(info && info.masterExists);
  const isUserConfigured = Boolean(configured);

  let label = '共有先: 未設定 (ローカル)';
  let icon = '📁';
  let bg = '#e2e8f0';
  let color = '#475569';

  if (path) {
    if (isUserConfigured) {
      label = `共有先: ${shortenPath(path)}`;
      icon = masterExists ? '🟢' : '🟡';
      bg = masterExists ? '#dcfce7' : '#fef9c3';
      color = masterExists ? '#166534' : '#854d0e';
    } else {
      label = `共有先: 自動 (${shortenPath(path)})`;
      icon = masterExists ? '🟢' : '📁';
      bg = masterExists ? '#e0f2fe' : '#e2e8f0';
      color = masterExists ? '#0369a1' : '#475569';
    }
  }

  if (textEl) textEl.textContent = label;
  if (iconEl) iconEl.textContent = icon;
  if (badgeEl) {
    badgeEl.style.background = bg;
    badgeEl.title = path
      ? `${path}${masterPath ? `\nマスター: ${masterPath}` : ''}${masterExists ? '\n(マスターファイルあり)' : '\n(マスター未作成・次回保存で生成)'}`
      : '共有フォルダ未設定';
  }
  if (exportBadge) {
    exportBadge.textContent = path
      ? `${isUserConfigured ? '🟢 設定済' : '📁 自動解決'}: ${path}${masterExists ? ' （マスターあり）' : ' （マスター未作成）'}`
      : '共有先: 未設定 (ローカル日次バックアップ先を利用)';
    exportBadge.style.color = color;
  }
  if (masterHint) {
    masterHint.textContent = masterPath
      ? `マスターファイル: ${masterPath}`
      : '';
  }
}

/**
 * 現在の共有フォルダ情報を取得して UI 反映
 * @returns {Promise<object|null>}
 */
export async function refreshSharedFolderStatusUi() {
  const bridge = getSharedFolderBridge();
  if (!bridge) {
    applySharedFolderStatusToUi(null);
    return null;
  }
  try {
    const info = await bridge.getSharedFolderPath();
    applySharedFolderStatusToUi(info && info.success !== false ? info : null);
    return info;
  } catch (e) {
    console.warn('[sharedFolderUi] refresh soft-fail:', e);
    applySharedFolderStatusToUi(null);
    return null;
  }
}

/**
 * 共有フォルダ選択ダイアログを開き、成功時にステータス更新
 * @returns {Promise<boolean>}
 */
export async function handleSelectSharedFolder() {
  const bridge = getSharedFolderBridge();
  if (!bridge) {
    showToast('共有フォルダ設定はデスクトップアプリ版でのみ利用できます', 'warn');
    return false;
  }
  try {
    showToast('共有フォルダを選択してください…', 'info');
    const res = await bridge.selectSharedFolder();
    if (res?.canceled) {
      showToast('フォルダ選択をキャンセルしました', 'info');
      await refreshSharedFolderStatusUi();
      return false;
    }
    if (!res?.success) {
      showToast(res?.message || '共有フォルダの設定に失敗しました', 'error');
      await refreshSharedFolderStatusUi();
      return false;
    }
    await refreshSharedFolderStatusUi();
    showToast(`共有フォルダを設定しました: ${res.path || ''}`, 'success');
    return true;
  } catch (e) {
    console.error('[sharedFolderUi] select error:', e);
    showToast(e?.message || '共有フォルダの選択に失敗しました', 'error');
    return false;
  }
}

/**
 * ヘッダー／Excel画面の選択ボタンを初期化
 */
export function initSharedFolderUi() {
  const btnHeader = document.getElementById('btnSelectSharedFolderHeader');
  const btnExport = document.getElementById('btnSelectSharedFolderExport');

  btnHeader?.addEventListener('click', () => {
    handleSelectSharedFolder();
  });
  btnExport?.addEventListener('click', () => {
    handleSelectSharedFolder();
  });

  refreshSharedFolderStatusUi().catch(() => { /* ignore */ });
}
