// js/app.js
// 全体初期化・タブ切替ルーティング・全体再描画司令塔（50行以下制限準拠）

import { initScheduleView, renderScheduleView } from './views/scheduleView.js';
import { initMonthlyView, renderMonthlyView } from './views/monthlyView.js';
import { initPatientView, renderPatientView } from './views/patientView.js';
import { initLoanView, renderLoanView } from './views/loanView.js';
import { initExportView } from './views/exportView.js';

document.addEventListener('DOMContentLoaded', () => {
  initScheduleView();
  initMonthlyView();
  initPatientView();
  initLoanView();
  initExportView();
  initNavigationTabs();

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
      if (targetPanel) targetPanel.classList.add('active');
    });
  });
}
