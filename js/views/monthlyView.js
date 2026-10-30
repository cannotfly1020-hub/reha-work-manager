// js/views/monthlyView.js
// 月間単位・収益画面の初期化と再描画（過去月はオンデマンドハイドレーション後に集計）

import { safeParseInt } from '../core/dataNormalizer.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { loadMonthOnDemand } from '../store/archiveManager.js';
import { monthlyState, MONTHLY_QUICK_FILTERS } from './monthly/monthlyState.js';
import {
  renderRevenueDashboard, setupRevenueBreakdownModalListeners, openRevenueBreakdownModal
} from './monthly/revenueDashboard.js';
import { renderMonthlyUnitsTable } from './monthly/unitsTable.js';
import { renderDailyDiaryPreview } from './monthly/diaryPreview.js';

const VALID_QUICK_FILTERS = new Set(Object.values(MONTHLY_QUICK_FILTERS));

export function initMonthlyView() {
  const monthInput = document.getElementById('monthlyMonthInput');
  const btnPrev = document.getElementById('btnPrevMonth');
  const btnNext = document.getElementById('btnNextMonth');
  const sortSelect = document.getElementById('monthlySortSelect');
  const therapistFilterSelect = document.getElementById('monthlyTherapistFilterSelect');
  const todayCard = document.getElementById('kpiTodayRevenueCard');
  const quickFilterBar = document.getElementById('monthlyQuickFilterBar');

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
    // 並び替えのみ：再集計不要、テーブルだけ再描画
    if (monthlyState.lastAggregated) {
      renderMonthlyUnitsTable(monthlyState.lastAggregated);
    } else {
      renderMonthlyView();
    }
  });

  // 担当セラピスト絞り込み（クイックフィルター・ソートと併用／再集計不要）
  therapistFilterSelect?.addEventListener('change', (e) => {
    monthlyState.therapistFilterId = String(e.target.value || '').trim();
    if (monthlyState.lastAggregated) {
      renderMonthlyUnitsTable(monthlyState.lastAggregated);
    } else {
      renderMonthlyView();
    }
  });

  todayCard?.addEventListener('click', () => {
    openRevenueBreakdownModal();
  });

  // 臨床最重要クイックフィルター（ワンクリック切替・再集計なし）
  quickFilterBar?.addEventListener('click', (e) => {
    const btn = e.target.closest('.monthly-qf-btn');
    if (!btn || !quickFilterBar.contains(btn)) return;
    const key = btn.getAttribute('data-monthly-filter');
    if (!key || !VALID_QUICK_FILTERS.has(key)) return;
    if (monthlyState.quickFilter === key) return;
    monthlyState.quickFilter = key;
    if (monthlyState.lastAggregated) {
      renderMonthlyUnitsTable(monthlyState.lastAggregated);
    } else {
      renderMonthlyView();
    }
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
