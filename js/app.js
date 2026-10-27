// js/app.js
// 全体初期化・タブ切替自動再同期・ヘッダー＆時間割更新ボタン連動・全体再描画司令塔
// ★起動: IndexedDB → 共有マスター(reha_shared_master.json)同期 → アーカイブ → 各画面
// ★データ変更時: 日次バックアップ＋共有マスター自動保存

import { initStorage, storageSet, storageRemoveByPrefix } from './core/storageAdapter.js';
import {
  registerArchiveHydrationFilter,
  initArchiveManager
} from './store/archiveManager.js';
import { writeStorageItem } from './store/storageWrite.js';
import { initLocalFileBackup, logBackupNetStatus } from './backup/localFileBackup.js';
import {
  createSystemDump,
  performDailyAutoBackup,
  triggerDailyAutoBackup
} from './backup/backupService.js';
import { initScheduleView, renderScheduleView } from './views/scheduleView.js';
import { initAppointmentCalendarView, renderAppointmentCalendarView } from './views/appointmentCalendarView.js';
import { initMonthlyView, renderMonthlyView } from './views/monthlyView.js';
import { initPatientView, renderPatientView } from './views/patientView.js';
import { initLoanView, renderLoanView } from './views/loanView.js';
import {
  initExportView,
  refreshBackupFolderStatusUi,
  refreshArchiveStatusUi,
  refreshSharedFolderStatusUi
} from './views/exportView.js';
import { showToast } from './ui/toast.js';
import { setupAppointmentModalListeners } from './views/modals/appointmentModal.js';
import { initAuditLogView, renderAuditTimeline, refreshOperatorBadge } from './views/auditLogView.js';
import { mergeAuditLogs } from './store/auditLogStore.js';

/** @type {ReturnType<typeof setTimeout>|null} */
let sharedMasterSaveTimer = null;

/**
 * Electron 共有マスター API（electronBackup / desktopApp 両対応）
 * @returns {object|null}
 */
function getBackupBridge() {
  if (typeof window === 'undefined') return null;
  if (window.electronBackup && typeof window.electronBackup.loadSharedMaster === 'function') {
    return window.electronBackup;
  }
  if (window.desktopApp && typeof window.desktopApp.loadSharedMaster === 'function') {
    return window.desktopApp;
  }
  return null;
}

/**
 * 共有マスター dump.storage をローカルストアへ一括適用
 * @param {Object} dump
 * @returns {{ applied: number }}
 */
function applySharedMasterDump(dump) {
  if (!dump || !dump.storage || typeof dump.storage !== 'object') {
    return { applied: 0 };
  }

  // 監査ログは他端末分をマージ（クリア前にリモート分を退避）
  let remoteAuditLogs = [];
  try {
    const rawAudit = dump.storage.reha_audit_logs;
    if (typeof rawAudit === 'string') {
      const parsed = JSON.parse(rawAudit);
      if (Array.isArray(parsed)) remoteAuditLogs = parsed;
    }
  } catch (_) { /* ignore */ }

  // 共有正本でローカルを上書き（reha_ 系を一旦クリアしてから投入）
  // ※操作者 (reha_local_operator) は localStorage 直書きのため影響なし
  storageRemoveByPrefix('reha_');

  let applied = 0;
  for (const [k, v] of Object.entries(dump.storage)) {
    if (typeof v !== 'string') continue;
    if (k.startsWith('reha_autobackup_')) continue;
    if (k.startsWith('reha_backup_folder_')) continue;
    if (k === 'reha_audit_logs') continue; // 後でマージ
    if (!writeStorageItem(k, v)) {
      storageSet(k, v);
    }
    applied += 1;
  }

  if (remoteAuditLogs.length > 0) {
    mergeAuditLogs(remoteAuditLogs);
    applied += 1;
  }

  return { applied };
}

/**
 * 起動・最新化時: 共有マスターを読み込みローカルへ同期
 * @param {{ silent?: boolean }} [opts]
 * @returns {Promise<{ applied: boolean, keyCount: number, message?: string }>}
 */
async function pullSharedMasterToLocal(opts = {}) {
  const silent = Boolean(opts.silent);
  const bridge = getBackupBridge();
  if (!bridge || typeof bridge.loadSharedMaster !== 'function') {
    return { applied: false, keyCount: 0, message: 'Electron共有APIなし' };
  }

  try {
    const res = await bridge.loadSharedMaster();
    if (!res || res.success === false) {
      if (!silent) {
        console.warn('[app] loadSharedMaster failed:', res?.message || res);
      }
      return { applied: false, keyCount: 0, message: res?.message || '読込失敗' };
    }
    if (!res.exists || !res.data) {
      console.log('[app] 共有マスター未作成 — ローカル状態を維持');
      return { applied: false, keyCount: 0, message: '共有マスター未作成' };
    }
    if (!res.data.storage || typeof res.data.storage !== 'object') {
      return { applied: false, keyCount: 0, message: '共有マスターに storage がありません' };
    }

    const { applied } = applySharedMasterDump(res.data);
    console.log(`[app] 共有マスター同期完了: ${applied} keys from ${res.filePath || ''}`);
    return { applied: applied > 0, keyCount: applied, message: res.filePath || '' };
  } catch (err) {
    console.warn('[app] pullSharedMasterToLocal soft-fail:', err);
    return { applied: false, keyCount: 0, message: err?.message || '同期エラー' };
  }
}

/**
 * ローカル全ダンプを共有マスターへ書き出し
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
async function pushLocalDumpToSharedMaster() {
  const bridge = getBackupBridge();
  if (!bridge || typeof bridge.saveSharedMaster !== 'function') {
    return { success: false, message: 'Electron共有APIなし' };
  }

  try {
    const dump = await createSystemDump({
      backupType: 'SHARED_MASTER',
      sharedMaster: true
    });
    const res = await bridge.saveSharedMaster(dump);
    if (res?.success) {
      console.log(`[app] 共有マスター保存成功: ${res.filePath || ''}`);
      return { success: true, message: res.filePath || '' };
    }
    console.warn('[app] saveSharedMaster soft-fail:', res);
    return { success: false, message: res?.message || '保存失敗' };
  } catch (err) {
    console.warn('[app] pushLocalDumpToSharedMaster soft-fail:', err);
    return { success: false, message: err?.message || '保存エラー' };
  }
}

/**
 * データ変更時: 日次バックアップ＋共有マスターをデバウンス保存
 */
function triggerDailyBackupWithSharedSync() {
  // 既存の日次自動バックアップ（ドキュメントフォルダ）
  triggerDailyAutoBackup();

  // 共有マスターも同タイミングでデバウンス保存
  if (sharedMasterSaveTimer) clearTimeout(sharedMasterSaveTimer);
  sharedMasterSaveTimer = setTimeout(() => {
    pushLocalDumpToSharedMaster().catch((e) => {
      console.warn('[app] debounced shared master save error:', e);
    });
  }, 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
  // 0. アーカイブ窓フィルタを initStorage より先に登録（起動メモリをスリム化）
  try {
    registerArchiveHydrationFilter();
  } catch (e) {
    console.warn('[app] registerArchiveHydrationFilter soft-fail:', e);
  }

  // 1. IndexedDB プリロード＆マイグレーション（アクティブスケジュールのみメモリ常駐）
  try {
    const result = await initStorage();
    if (result?.migrated) {
      console.log(`[app] Storage migration complete (index=${result.keyCount}, memory=${result.memoryCount})`);
    }
  } catch (err) {
    console.error('[app] initStorage failed — continuing with fallback cache:', err);
  }

  // 1.1 共有マスター → ローカル一括同期（他PCの最新状態で上書き）
  try {
    const syncRes = await pullSharedMasterToLocal({ silent: true });
    if (syncRes.applied) {
      console.log(`[app] Startup shared sync applied (${syncRes.keyCount} keys)`);
    }
  } catch (err) {
    console.warn('[app] startup shared sync soft-fail:', err);
  }

  // 1.25 アーカイブ統計・余剰パージ
  try {
    await initArchiveManager();
  } catch (err) {
    console.warn('[app] initArchiveManager soft-fail:', err);
  }

  // 1.5 Electron ネイティブ自動バックアップ状態ログ（File System Access は不使用）
  try {
    const backupInit = await initLocalFileBackup();
    logBackupNetStatus();
    console.log('[app] Electron backup init:', backupInit);
    const bridge = getBackupBridge();
    if (bridge?.getSharedFolderPath) {
      const folderInfo = await bridge.getSharedFolderPath();
      console.log('[app] Shared folder:', folderInfo);
    }
  } catch (err) {
    console.warn('[app] backup init soft-fail:', err);
  }

  // 2. 既存の各画面初期化（これまでと全く同一順序）
  initScheduleView();
  initAppointmentCalendarView();
  initMonthlyView();
  initPatientView();
  initLoanView();
  initExportView();
  initAuditLogView();
  initNavigationTabs();
  initRefreshButtons();

  setupAppointmentModalListeners(() => {
    renderAllViews();
  });

  try {
    refreshBackupFolderStatusUi();
    refreshArchiveStatusUi();
    refreshSharedFolderStatusUi();
  } catch (_) { /* ignore */ }

  // 3. 画面描画
  renderAllViews();

  // 4. 起動時スナップショット（非ブロッキング）＋共有マスターへも反映
  performDailyAutoBackup().catch((e) => {
    console.warn('[app] startup auto backup soft-fail:', e);
  });
  pushLocalDumpToSharedMaster().catch((e) => {
    console.warn('[app] startup shared master push soft-fail:', e);
  });

  window.triggerDailyBackup = triggerDailyBackupWithSharedSync;
});

window.addEventListener('beforeunload', () => {
  try {
    performDailyAutoBackup();
  } catch (_) { /* ignore */ }
  try {
    // beforeunload では await できないため fire-and-forget
    pushLocalDumpToSharedMaster();
  } catch (_) { /* ignore */ }
});

export function renderAllViews() {
  try { renderScheduleView(); } catch (e) { console.error('ScheduleView error:', e); }
  try { renderAppointmentCalendarView(); } catch (e) { console.error('AppointmentCalendarView error:', e); }
  try {
    const p = renderMonthlyView();
    if (p && typeof p.catch === 'function') p.catch((e) => console.error('MonthlyView error:', e));
  } catch (e) { console.error('MonthlyView error:', e); }
  try { renderPatientView(); } catch (e) { console.error('PatientView error:', e); }
  try { renderLoanView(); } catch (e) { console.error('LoanView error:', e); }
  try { refreshOperatorBadge(); } catch (_) { /* ignore */ }
  try { renderAuditTimeline(); } catch (_) { /* ignore */ }
  try { refreshArchiveStatusUi(); } catch (_) { /* ignore */ }
}

function initNavigationTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.view-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const targetPanel = document.getElementById(tab.dataset.target);
      if (targetPanel) {
        targetPanel.classList.add('active');
        renderAllViews();
      }
    });
  });
}

function initRefreshButtons() {
  const btnHeader = document.getElementById('btnRefreshHeader');
  const btnSchedule = document.getElementById('btnRefreshSchedule');

  const handleRefresh = async () => {
    try {
      const syncRes = await pullSharedMasterToLocal({ silent: false });
      renderAllViews();
      try { await refreshSharedFolderStatusUi(); } catch (_) { /* ignore */ }
      if (syncRes.applied) {
        showToast(`🔄 共有マスターから最新化しました（${syncRes.keyCount}件）`, 'success');
      } else {
        showToast('🔄 画面表示と集計データを最新化しました', 'success');
      }
    } catch (err) {
      console.warn('[app] refresh shared sync soft-fail:', err);
      renderAllViews();
      showToast('🔄 画面表示と集計データを最新化しました', 'success');
    }
  };

  btnHeader?.addEventListener('click', () => { handleRefresh(); });
  btnSchedule?.addEventListener('click', () => { handleRefresh(); });
}
