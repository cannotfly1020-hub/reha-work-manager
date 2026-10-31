// js/views/monthlyView.js
// 月間単位・収益画面の初期化と再描画（過去月はオンデマンドハイドレーション後に集計）

import { safeParseInt } from '../core/dataNormalizer.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { loadMonthOnDemand } from '../store/archiveManager.js';
import { showToast } from '../ui/toast.js';
import { printMonthlyAuditSheet } from '../print/monthlyAuditPrint.js';
import {
  monthlyState,
  MONTHLY_QUICK_FILTERS,
  MONTHLY_QUICK_FILTER_LABELS,
  parseMonthlyFilterSelectValue,
  buildMonthlyFilterSelectValue,
} from './monthly/monthlyState.js';
import {
  renderRevenueDashboard, setupRevenueBreakdownModalListeners, openRevenueBreakdownModal
} from './monthly/revenueDashboard.js';
import {
  renderMonthlyUnitsTable, collectVisibleMonthlyPatients
} from './monthly/unitsTable.js';
import { renderDailyDiaryPreview } from './monthly/diaryPreview.js';

export function initMonthlyView() {
  const monthInput = document.getElementById('monthPicker')
    || document.getElementById('monthlyMonthInput');
  const btnPrev = document.getElementById('btnPrevMonth');
  const btnNext = document.getElementById('btnNextMonth');
  const sortSelect = document.getElementById('monthlySortSelect');
  const filterSelect = document.getElementById('monthlyFilterSelect');
  const btnAuditPrint = document.getElementById('btnMonthlyAuditPrint');
  const todayCard = document.getElementById('kpiTodayRevenueCard');
  const btnDailyRevenueDetail = document.getElementById('btnDailyRevenueDetail');

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

  // 絞り込みセレクト（区分 / 維持期 / 計画未算定 / 担当セラピスト）
  filterSelect?.addEventListener('change', (e) => {
    const parsed = parseMonthlyFilterSelectValue(e.target.value);
    monthlyState.quickFilter = parsed.filterKey;
    monthlyState.therapistFilterId = parsed.therapistFilterId;
    if (monthlyState.lastAggregated) {
      renderMonthlyUnitsTable(monthlyState.lastAggregated);
    } else {
      renderMonthlyView();
    }
  });

  // 実務点検・赤ペン用 A4横チェックシート（画面の絞り込み・ソートを反映）
  btnAuditPrint?.addEventListener('click', () => {
    const aggregated = monthlyState.lastAggregated;
    if (!aggregated) {
      showToast('月間データが未集計です。画面を再表示してから印刷してください', 'warn');
      return;
    }
    const patients = collectVisibleMonthlyPatients(aggregated);
    const filterKey = monthlyState.quickFilter || MONTHLY_QUICK_FILTERS.ALL;
    const tid = String(monthlyState.therapistFilterId || '').trim();
    let quickFilterLabel = MONTHLY_QUICK_FILTER_LABELS[filterKey] || '全員';
    if (tid) {
      const opt = filterSelect?.selectedOptions?.[0];
      quickFilterLabel = opt ? String(opt.textContent || '').replace(/\s*\(\d+\)\s*$/, '').trim() : `担当 ${tid}`;
    }
    printMonthlyAuditSheet({
      year: monthlyState.year,
      month: monthlyState.month,
      patients,
      daysInMonth: aggregated.daysInMonth,
      selectedTherapistId: tid || null,
      quickFilterLabel
    });
  });

  const openTodayRevenue = () => openRevenueBreakdownModal();
  todayCard?.addEventListener('click', openTodayRevenue);
  todayCard?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openTodayRevenue();
    }
  });
  btnDailyRevenueDetail?.addEventListener('click', (e) => {
    e.stopPropagation();
    openTodayRevenue();
  });

  // 初期セレクト値を状態と同期
  if (filterSelect) {
    filterSelect.value = buildMonthlyFilterSelectValue(monthlyState);
  }
  if (sortSelect && monthlyState.sortKey) {
    sortSelect.value = monthlyState.sortKey;
  }

  setupRevenueBreakdownModalListeners();
}

function syncMonthInput() {
  const input = document.getElementById('monthPicker')
    || document.getElementById('monthlyMonthInput');
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
