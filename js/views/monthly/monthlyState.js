// js/views/monthly/monthlyState.js
// 月間画面の対象年月・並び順・臨床クイックフィルター・直近の集計結果

const now = new Date();

/** @typedef {'ALL'|'PLAN_MISSING'|'INPATIENT'|'OUT_ANALGESIA'|'OUT_DISEASE'} MonthlyQuickFilter */

export const MONTHLY_QUICK_FILTERS = Object.freeze({
  ALL: 'ALL',
  PLAN_MISSING: 'PLAN_MISSING',
  INPATIENT: 'INPATIENT',
  OUT_ANALGESIA: 'OUT_ANALGESIA',
  OUT_DISEASE: 'OUT_DISEASE',
});

export const monthlyState = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  sortKey: 'CATEGORY',
  /** @type {MonthlyQuickFilter} */
  quickFilter: MONTHLY_QUICK_FILTERS.ALL,
  lastAggregated: null,
};
