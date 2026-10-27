// js/ui/sharedFolderUi.js
// 院内LAN共有フォルダー UI
// ★ヘッダー: 状態ランプのみ / Excel・バックアップ画面: 選択・変更・開く操作を一本化

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
 * ヘッダーランプ＋Excel画面の共有先ステータスを更新
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
    if (textEl) textEl.textContent = '院内LAN アプリ版のみ';
    if (iconEl) iconEl.textContent = '⚪';
    if (badgeEl) {
      badgeEl.classList.remove('is-syncing', 'is-pending', 'is-local');
      badgeEl.classList.add('is-offline');
      badgeEl.title = '共有フォルダ設定はデスクトップアプリ版の「Excel出力」画面で行えます';
    }
    if (exportBadge) {
      exportBadge.textContent = '共有先: デスクトップアプリ版で設定可';
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

  // --- ヘッダー: コンパクトな状態ランプのみ ---
  let lampLabel = '院内LAN 未設定';
  let lampIcon = '⚪';
  let lampClass = 'is-local';
  let lampTitle = '共有フォルダ未設定。設定は「Excel出力」画面から行えます。';

  if (path) {
    if (isUserConfigured && masterExists) {
      lampLabel = '院内LAN同期中';
      lampIcon = '🟢';
      lampClass = 'is-syncing';
      lampTitle = `院内LAN同期中\n${path}\nマスター: ${masterPath || '(あり)'}\n※設定変更は Excel出力画面`;
    } else if (isUserConfigured) {
      lampLabel = '院内LAN 待機中';
      lampIcon = '🟡';
      lampClass = 'is-pending';
      lampTitle = `共有先設定済（マスター未作成）\n${path}\n次回保存で生成されます\n※設定変更は Excel出力画面`;
    } else if (masterExists) {
      lampLabel = '院内LAN同期中';
      lampIcon = '🟢';
      lampClass = 'is-syncing';
      lampTitle = `自動解決の共有先で同期中\n${path}\n※設定変更は Excel出力画面`;
    } else {
      lampLabel = '院内LAN ローカル';
      lampIcon = '📁';
      lampClass = 'is-local';
      lampTitle = `自動解決先: ${path}\n※NAS等の指定は Excel出力画面`;
    }
  }

  if (textEl) textEl.textContent = lampLabel;
  if (iconEl) iconEl.textContent = lampIcon;
  if (badgeEl) {
    badgeEl.classList.remove('is-syncing', 'is-pending', 'is-local', 'is-offline');
    badgeEl.classList.add(lampClass);
    badgeEl.title = lampTitle;
  }

  // --- Excel画面: 詳細パス＋操作パネル ---
  const exportColor = lampClass === 'is-syncing'
    ? '#166534'
    : (lampClass === 'is-pending' ? '#854d0e' : '#475569');
  if (exportBadge) {
    exportBadge.textContent = path
      ? `${isUserConfigured ? '🟢 設定済' : '📁 自動解決'}: ${path}${masterExists ? ' （マスターあり）' : ' （マスター未作成）'}`
      : '共有先: 未設定 (ローカル日次バックアップ先を利用)';
    exportBadge.style.color = exportColor;
  }
  if (masterHint) {
    masterHint.textContent = masterPath
      ? `マスターファイル: ${masterPath}`
      : (path ? `短縮表示: ${shortenPath(path, 64)}` : '');
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
 * 共有フォルダをエクスプローラーで開く
 * @returns {Promise<boolean>}
 */
export async function handleOpenSharedFolder() {
  const bridge = getSharedFolderBridge();
  if (!bridge) {
    showToast('共有フォルダを開く機能はデスクトップアプリ版でのみ利用できます', 'warn');
    return false;
  }
  try {
    if (typeof bridge.openSharedFolder === 'function') {
      const res = await bridge.openSharedFolder();
      if (res?.success) {
        showToast(`📂 共有フォルダを開きました${res.path ? `: ${res.path}` : ''}`, 'success');
        return true;
      }
      showToast(res?.message || '共有フォルダを開けませんでした', 'warn');
      return false;
    }
    // フォールバック: パス取得のみ
    const info = await bridge.getSharedFolderPath();
    showToast(info?.path
      ? `共有先パス: ${info.path}`
      : '共有フォルダが未設定です', 'info');
    return false;
  } catch (e) {
    console.error('[sharedFolderUi] open error:', e);
    showToast(e?.message || '共有フォルダを開けませんでした', 'error');
    return false;
  }
}

/**
 * Excel画面の操作ボタンを初期化（ヘッダーには設定ボタンを置かない）
 */
export function initSharedFolderUi() {
  const btnExport = document.getElementById('btnSelectSharedFolderExport');
  const btnOpen = document.getElementById('btnOpenSharedFolderExport');

  btnExport?.addEventListener('click', () => {
    handleSelectSharedFolder();
  });
  btnOpen?.addEventListener('click', () => {
    handleOpenSharedFolder();
  });

  // ヘッダーランプをクリックしたら Excel 画面へ誘導（設定操作は一本化）
  const lamp = document.getElementById('sharedFolderHeaderBadge');
  lamp?.addEventListener('click', () => {
    const tab = document.querySelector('.nav-tab[data-target="viewExport"]');
    if (tab) tab.click();
    showToast('共有フォルダの設定・変更はこちらで行えます', 'info');
  });

  refreshSharedFolderStatusUi().catch(() => { /* ignore */ });
}
