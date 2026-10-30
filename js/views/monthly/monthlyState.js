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

/** クイックフィルター表示ラベル（印刷タイトル・UI共用） */
export const MONTHLY_QUICK_FILTER_LABELS = Object.freeze({
  [MONTHLY_QUICK_FILTERS.ALL]: '全員',
  [MONTHLY_QUICK_FILTERS.IN_DISEASE]: '入院疾患別',
  [MONTHLY_QUICK_FILTERS.IN_ANALGESIA]: '入院消炎鎮痛',
  [MONTHLY_QUICK_FILTERS.OUT_DISEASE]: '外来疾患別',
  [MONTHLY_QUICK_FILTERS.OUT_ANALGESIA]: '外来消炎鎮痛',
  [MONTHLY_QUICK_FILTERS.MAINTENANCE]: '維持期・移行対象',
  [MONTHLY_QUICK_FILTERS.PLAN_MISSING]: '計画書未算定',
});

export const monthlyState = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  sortKey: 'CATEGORY',
  /** @type {MonthlyQuickFilter} */
  quickFilter: MONTHLY_QUICK_FILTERS.ALL,
  /** 担当セラピスト絞り込み（空文字＝全員） */
  therapistFilterId: '',
  lastAggregated: null,
};
