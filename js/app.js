// js/app.js
// 全体初期化・タブ切替自動再同期・ヘッダー＆時間割更新ボタン連動・全体再描画司令塔

import { initScheduleView, renderScheduleView } from './views/scheduleView.js';
import { initMonthlyView, renderMonthlyView } from './views/monthlyView.js';
import { initPatientView, renderPatientView } from './views/patientView.js';
import { initLoanView, renderLoanView } from './views/loanView.js';
import { initExportView, showToast } from './views/exportView.js';

document.addEventListener('DOMContentLoaded', () => {
  initScheduleView();
  initMonthlyView();
  initPatientView();
  initLoanView();
  initExportView();
  initNavigationTabs();
  initRefreshButtons();

  renderAllViews();
});

export function renderAllViews() {
  try { renderScheduleView(); } catch (e) { console.error('ScheduleView error:', e); }
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
        // ★タブ切り替え時に全ビューを自動再同期・最新化（他画面の変更が即座に反映されます）
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
