// js/app.js
// 全体初期化・タブ切替自動再同期・ヘッダー＆時間割更新ボタン連動・全体再描画司令塔
// ★起動: IndexedDB透過ストレージ（アクティブ窓のみメモリ）→ アーカイブ → ローカルバックアップ → 各画面

import { initStorage } from './core/storageAdapter.js';
import {
  registerArchiveHydrationFilter,
  initArchiveManager
} from './store/archiveManager.js';
import { initLocalFileBackup, logBackupNetStatus } from './backup/localFileBackup.js';
import { performDailyAutoBackup, triggerDailyAutoBackup } from './backup/backupService.js';
import { initScheduleView, renderScheduleView } from './views/scheduleView.js';
import { initAppointmentCalendarView, renderAppointmentCalendarView } from './views/appointmentCalendarView.js';
import { initMonthlyView, renderMonthlyView } from './views/monthlyView.js';
import { initPatientView, renderPatientView } from './views/patientView.js';
import { initLoanView, renderLoanView } from './views/loanView.js';
import {
  initExportView,
  refreshBackupFolderStatusUi,
  refreshArchiveStatusUi
} from './views/exportView.js';
import { showToast } from './ui/toast.js';
import { setupAppointmentModalListeners } from './views/modals/appointmentModal.js';

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

  // 1.25 アーカイブ統計・余剰パージ
  try {
    await initArchiveManager();
  } catch (err) {
    console.warn('[app] initArchiveManager soft-fail:', err);
  }

  // 1.5 ローカルフォルダ／IDBスナップショット セーフティネット
  try {
    const backupInit = await initLocalFileBackup();
    logBackupNetStatus();
    console.log('[app] Local file backup init:', backupInit);
  } catch (err) {
    console.warn('[app] initLocalFileBackup soft-fail:', err);
  }

  // 2. 既存の各画面初期化（これまでと全く同一順序）
  initScheduleView();
  initAppointmentCalendarView();
  initMonthlyView();
  initPatientView();
  initLoanView();
  initExportView();
  initNavigationTabs();
  initRefreshButtons();

  setupAppointmentModalListeners(() => {
    renderAllViews();
  });

  try {
    refreshBackupFolderStatusUi();
    refreshArchiveStatusUi();
  } catch (_) { /* ignore */ }

  // 3. 画面描画
  renderAllViews();

  // 4. 起動時スナップショット（非ブロッキング）
  performDailyAutoBackup().catch((e) => {
    console.warn('[app] startup auto backup soft-fail:', e);
  });

  window.triggerDailyBackup = triggerDailyAutoBackup;
});

window.addEventListener('beforeunload', () => {
  try {
    performDailyAutoBackup();
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

  const handleRefresh = () => {
    renderAllViews();
    showToast('🔄 画面表示と集計データを最新化しました', 'success');
  };

  btnHeader?.addEventListener('click', () => handleRefresh());
  btnSchedule?.addEventListener('click', () => handleRefresh());
}
