// js/views/monthly/monthlyState.js
// 月間画面の対象年月・並び順・臨床クイックフィルター・直近の集計結果

const now = new Date();

/**
 * @typedef {'ALL'|'IN_DISEASE'|'IN_ANALGESIA'|'OUT_DISEASE'|'OUT_ANALGESIA'|'MAINTENANCE'|'PLAN_MISSING'} MonthlyQuickFilter
 */

export const MONTHLY_QUICK_FILTERS = Object.freeze({
  ALL: 'ALL',
  IN_DISEASE: 'IN_DISEASE',
  IN_ANALGESIA: 'IN_ANALGESIA',
  OUT_DISEASE: 'OUT_DISEASE',
  OUT_ANALGESIA: 'OUT_ANALGESIA',
  MAINTENANCE: 'MAINTENANCE',
  PLAN_MISSING: 'PLAN_MISSING',
});

export const monthlyState = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  sortKey: 'CATEGORY',
  /** @type {MonthlyQuickFilter} */
  quickFilter: MONTHLY_QUICK_FILTERS.ALL,
  lastAggregated: null,
};
