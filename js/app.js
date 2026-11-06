// js/app.js
// 全体初期化・タブ切替自動再同期・ヘッダー＆時間割更新ボタン連動・全体再描画司令塔
// ★起動: IndexedDB → 共有マスター(reha_shared_master.json)同期 → アーカイブ → 各画面
// ★データ変更時: 日次バックアップ＋共有マスター自動保存
// ★共有同期: 全消去なしのインプレース適用 ＋ 先祖返り上書きインターロック

import { initStorage, storageSet, storageKeys, storageRemove } from './core/storageAdapter.js';
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
import { isFeatureEnabled } from './config/facilityConfig.js';

/** @type {ReturnType<typeof setTimeout>|null} */
let sharedMasterSaveTimer = null;

/** localStorage 直書き（storageAdapter 外・共有 dump 対象外） */
const LAST_SHARED_SYNC_LS_KEY = 'reha_last_shared_sync_timestamp';

/** @type {number} 自PCが最後に共有マスターと同期した時刻（ms）。メモリ＋LS */
let lastSharedSyncTimestampMs = 0;

try {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(LAST_SHARED_SYNC_LS_KEY);
    const parsed = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      lastSharedSyncTimestampMs = parsed;
    }
  }
} catch (_) { /* ignore */ }

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
 * dump メタデータから更新時刻（ms）を取得
 * @param {Object|null|undefined} dump
 * @returns {number}
 */
function parseDumpTimestampMs(dump) {
  if (!dump || typeof dump !== 'object') return 0;
  const raw = dump.updatedAt || dump.createdAt || dump.exportedAt;
  if (!raw || typeof raw !== 'string') return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/**
 * 自PCの最終共有同期日時を記録（apply 成功時 / push 成功時）
 * @param {number|string|Date} value
 */
function recordLastSharedSyncTimestamp(value) {
  let ms = 0;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    ms = value;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) ms = parsed;
  }
  if (ms <= 0) ms = Date.now();
  lastSharedSyncTimestampMs = ms;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_SHARED_SYNC_LS_KEY, new Date(ms).toISOString());
    }
  } catch (_) { /* ignore */ }
}

/**
 * 共有適用時にローカル孤立削除から除外するキーか
 * （施設プロファイル・操作者・監査・バックアップ系・同期メタ）
 * @param {string} key
 * @returns {boolean}
 */
function isSharedSyncProtectedLocalKey(key) {
  if (!key || typeof key !== 'string') return true;
  if (key.startsWith('reha_autobackup_')) return true;
  if (key.startsWith('reha_backup_folder_')) return true;
  if (key.startsWith('reha_facility_profile')) return true;
  if (key === 'reha_local_operator') return true;
  if (key === 'reha_audit_logs') return true;
  if (key === LAST_SHARED_SYNC_LS_KEY) return true;
  return false;
}

/**
 * 共有マスター dump.storage をローカルへアトミックに近いインプレース適用
 * （一括全消去は行わない。書込完了後に孤立キーのみ個別削除）
 * @param {Object} dump
 * @returns {{ applied: number, removed: number }}
 */
function applySharedMasterDump(dump) {
  if (!dump || !dump.storage || typeof dump.storage !== 'object') {
    return { applied: 0, removed: 0 };
  }

  // 監査ログは他端末分をマージ（上書きせず後段で merge）
  let remoteAuditLogs = [];
  try {
    const rawAudit = dump.storage.reha_audit_logs;
    if (typeof rawAudit === 'string') {
      const parsed = JSON.parse(rawAudit);
      if (Array.isArray(parsed)) remoteAuditLogs = parsed;
    }
  } catch (_) { /* ignore */ }

  // ① 共有マスターの各キーをローカルへ順次上書き・追加
  const masterKeySet = new Set();
  let applied = 0;
  for (const [k, v] of Object.entries(dump.storage)) {
    if (typeof v !== 'string') continue;
    if (k.startsWith('reha_autobackup_')) continue;
    if (k.startsWith('reha_backup_folder_')) continue;
    if (k === 'reha_audit_logs') continue; // 後でマージ
    masterKeySet.add(k);
    if (!writeStorageItem(k, v)) {
      storageSet(k, v);
    }
    applied += 1;
  }

  // 監査も「マスターに含まれるキー」として扱い、孤立削除しない
  if (Object.prototype.hasOwnProperty.call(dump.storage, 'reha_audit_logs')) {
    masterKeySet.add('reha_audit_logs');
  }

  // ③ 書込完了後: マスターに無く保護対象でもない孤立 reha_ キーのみ個別削除
  let removed = 0;
  const localKeys = storageKeys('reha_');
  for (const key of localKeys) {
    if (masterKeySet.has(key)) continue;
    if (isSharedSyncProtectedLocalKey(key)) continue;
    try {
      storageRemove(key);
      removed += 1;
    } catch (e) {
      console.warn('[app] orphan key remove soft-fail:', key, e);
    }
  }

  // ④ 監査ログは既存どおり安全マージ
  if (remoteAuditLogs.length > 0) {
    mergeAuditLogs(remoteAuditLogs);
    applied += 1;
  }

  return { applied, removed };
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

    const { applied, removed } = applySharedMasterDump(res.data);
    // 適用成功時に最終同期日時を記録（push インターロック用）
    const dumpTs = parseDumpTimestampMs(res.data);
    recordLastSharedSyncTimestamp(dumpTs > 0 ? dumpTs : Date.now());
    console.log(
      `[app] 共有マスター同期完了: applied=${applied} removed=${removed} from ${res.filePath || ''}`
    );
    return { applied: applied > 0 || removed > 0, keyCount: applied, message: res.filePath || '' };
  } catch (err) {
    console.warn('[app] pullSharedMasterToLocal soft-fail:', err);
    return { applied: false, keyCount: 0, message: err?.message || '同期エラー' };
  }
}

/**
 * ローカル全ダンプを共有マスターへ書き出し
 * ★サーバー側が自PC最終同期より新しい場合は先祖返り防止のためブロック
 * @param {{ force?: boolean }} [opts] force=true でインターロック回避（明示手動同期用）
 * @returns {Promise<{ success: boolean, blocked?: boolean, message?: string }>}
 */
async function pushLocalDumpToSharedMaster(opts = {}) {
  const force = Boolean(opts.force);
  const bridge = getBackupBridge();
  if (!bridge || typeof bridge.saveSharedMaster !== 'function') {
    return { success: false, message: 'Electron共有APIなし' };
  }

  try {
    // 先祖返りインターロック: 保存前にサーバー側メタデータを確認
    if (!force && typeof bridge.loadSharedMaster === 'function') {
      try {
        const remote = await bridge.loadSharedMaster();
        if (remote?.success !== false && remote?.exists && remote?.data) {
          const serverTs = parseDumpTimestampMs(remote.data);
          if (serverTs > 0 && serverTs > lastSharedSyncTimestampMs) {
            console.warn(
              '[app] 共有マスター上書きを安全に中断: serverTs=',
              serverTs,
              'lastSync=',
              lastSharedSyncTimestampMs,
              new Date(serverTs).toISOString(),
              '>',
              lastSharedSyncTimestampMs > 0
                ? new Date(lastSharedSyncTimestampMs).toISOString()
                : '(未同期)'
            );
            showToast(
              '共有マスターに新しいデータが存在するため、上書きを安全に中断しました。ヘッダーの最新化を行ってください。',
              'warn'
            );
            return {
              success: false,
              blocked: true,
              message: '共有マスターが新しいため上書きを中断'
            };
          }
        }
      } catch (probeErr) {
        // プローブ失敗時は保存自体は試行（オフライン等）。破壊的上書き判定はできないため警告のみ
        console.warn('[app] shared master freshness probe soft-fail:', probeErr);
      }
    }

    const nowIso = new Date().toISOString();
    const dump = await createSystemDump({
      backupType: 'SHARED_MASTER',
      sharedMaster: true,
      updatedAt: nowIso,
      createdAt: nowIso
    });
    const res = await bridge.saveSharedMaster(dump);
    if (res?.success) {
      recordLastSharedSyncTimestamp(nowIso);
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

/**
 * 施設プロファイルの機能フラグに応じてナビタブを表示/非表示
 * ※remove せず style.display のみ変更（DOM参照の副作用防止）
 * 病院A（デフォルト）では外来予約・物品貸出とも表示のまま
 */
function applyFacilityNavigationFeatures() {
  const hasApt = isFeatureEnabled('hasOutpatientReservation');
  const hasLoan = isFeatureEnabled('hasInventoryManagement');

  const aptTab = document.querySelector('.nav-tab[data-target="viewAppointmentCalendar"]');
  if (aptTab) {
    aptTab.style.display = hasApt ? '' : 'none';
  }

  const loanTab = document.querySelector('.nav-tab[data-target="viewLoan"]');
  if (loanTab) {
    loanTab.style.display = hasLoan ? '' : 'none';
  }
}

function initNavigationTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.view-panel');

  applyFacilityNavigationFeatures();

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
