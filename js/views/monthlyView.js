// js/views/monthlyView.js
// 月間単位・収益画面の初期化と再描画（過去月はオンデマンドハイドレーション後に集計）

import { safeParseInt } from '../core/dataNormalizer.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { loadMonthOnDemand } from '../store/archiveManager.js';
import { monthlyState } from './monthly/monthlyState.js';
import {
  renderRevenueDashboard, setupRevenueBreakdownModalListeners, openRevenueBreakdownModal
} from './monthly/revenueDashboard.js';
import { renderMonthlyUnitsTable } from './monthly/unitsTable.js';
import { renderDailyDiaryPreview } from './monthly/diaryPreview.js';

export function initMonthlyView() {
  const monthInput = document.getElementById('monthlyMonthInput');
  const btnPrev = document.getElementById('btnPrevMonth');
  const btnNext = document.getElementById('btnNextMonth');
  const sortSelect = document.getElementById('monthlySortSelect');
  const todayCard = document.getElementById('kpiTodayRevenueCard');

  if (monthInput) {
    monthInput.value = `${monthlyState.year}-${String(monthlyState.month).padStart(2, '0')}`;
    monthInput.addEventListener('change', (e) => {
      const [y, m] = e.target.value.split('-').map((v) => safeParseInt(v));
      if (y && m) {
        monthlyState.year = y;
        monthlyState.month = m;
        renderMonthlyView();
      }
    });
  }

  btnPrev?.addEventListener('click', () => {
    monthlyState.month -= 1;
    if (monthlyState.month < 1) { monthlyState.month = 12; monthlyState.year -= 1; }
    syncMonthInput();
    renderMonthlyView();
  });

  btnNext?.addEventListener('click', () => {
    monthlyState.month += 1;
    if (monthlyState.month > 12) { monthlyState.month = 1; monthlyState.year += 1; }
    syncMonthInput();
    renderMonthlyView();
  });

  sortSelect?.addEventListener('change', (e) => {
    monthlyState.sortKey = e.target.value;
    renderMonthlyView();
  });

  todayCard?.addEventListener('click', () => {
    openRevenueBreakdownModal();
  });

  setupRevenueBreakdownModalListeners();
}

function syncMonthInput() {
  const input = document.getElementById('monthlyMonthInput');
  if (input) input.value = `${monthlyState.year}-${String(monthlyState.month).padStart(2, '0')}`;
}

/**
 * 月間画面再描画（過去月選択時は IndexedDB から該当月を先読みしてから同期集計）
 * @returns {Promise<void>}
 */
export async function renderMonthlyView() {
  try {
    await loadMonthOnDemand(monthlyState.year, monthlyState.month);
  } catch (e) {
    console.warn('[monthlyView] loadMonthOnDemand soft-fail:', e);
  }

  monthlyState.lastAggregated = aggregateFromAppSchedule(monthlyState.year, monthlyState.month);
  renderRevenueDashboard(monthlyState.lastAggregated);
  renderMonthlyUnitsTable(monthlyState.lastAggregated);
  renderDailyDiaryPreview(monthlyState.lastAggregated);
}
