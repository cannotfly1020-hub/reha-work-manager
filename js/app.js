// js/app.js
// 全体初期化・タブ切替自動再同期・ヘッダー＆時間割更新ボタン連動・全体再描画司令塔
// ★起動最優先: IndexedDB 透過ストレージ → ローカルバックアップセーフティネット → 各画面

import { initStorage } from './core/storageAdapter.js';
import { initLocalFileBackup, logBackupNetStatus } from './backup/localFileBackup.js';
import { performDailyAutoBackup, triggerDailyAutoBackup } from './backup/backupService.js';
import { initScheduleView, renderScheduleView } from './views/scheduleView.js';
import { initAppointmentCalendarView, renderAppointmentCalendarView } from './views/appointmentCalendarView.js';
import { initMonthlyView, renderMonthlyView } from './views/monthlyView.js';
import { initPatientView, renderPatientView } from './views/patientView.js';
import { initLoanView, renderLoanView } from './views/loanView.js';
import { initExportView, refreshBackupFolderStatusUi } from './views/exportView.js';
import { showToast } from './ui/toast.js';
import { setupAppointmentModalListeners } from './views/modals/appointmentModal.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 最優先: ストレージ層（IndexedDB）のプリロード＆マイグレーション完了を待機
  try {
    const result = await initStorage();
    if (result?.migrated) {
      console.log(`[app] Storage migration complete (${result.keyCount} keys)`);
    }
  } catch (err) {
    console.error('[app] initStorage failed — continuing with fallback cache:', err);
  }

  // 1.5 ローカルフォルダ／IDBスナップショット セーフティネット初期化
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

  // 外来予約モーダルのリスナー初期化（保存・削除時は全ビューを即座に再同期）
  setupAppointmentModalListeners(() => {
    renderAllViews();
  });

  // フォルダバッジをハンドル復元後の状態で再同期
  try {
    refreshBackupFolderStatusUi();
  } catch (_) { /* ignore */ }

  // 3. 画面描画
  renderAllViews();

  // 4. 起動時スナップショット（非ブロッキング）
  performDailyAutoBackup().catch((e) => {
    console.warn('[app] startup auto backup soft-fail:', e);
  });

  // グローバル公開（exportView でも設定するが起動順の保険）
  window.triggerDailyBackup = triggerDailyAutoBackup;
});

// ウィンドウ終了前に最終状態をフラッシュ（ブロッキングしない）
window.addEventListener('beforeunload', () => {
  try {
    performDailyAutoBackup();
  } catch (_) { /* ignore */ }
});

export function renderAllViews() {
  try { renderScheduleView(); } catch (e) { console.error('ScheduleView error:', e); }
  try { renderAppointmentCalendarView(); } catch (e) { console.error('AppointmentCalendarView error:', e); }
  try { renderMonthlyView(); } catch (e) { console.error('MonthlyView error:', e); }
  try { renderPatientView(); } catch (e) { console.error('PatientView error:', e); }
  try { renderLoanView(); } catch (e) { console.error('LoanView error:', e); }
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

  const handleRefresh = (sourceLabel) => {
    renderAllViews();
    showToast('🔄 画面表示と集計データを最新化しました', 'success');
  };

  btnHeader?.addEventListener('click', () => handleRefresh('header'));
  btnSchedule?.addEventListener('click', () => handleRefresh('schedule'));
}
