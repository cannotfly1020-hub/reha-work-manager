// js/views/monthly/monthlyState.js
// 月間画面の対象年月・並び順・直近の集計結果

const now = new Date();

export const monthlyState = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  sortKey: 'CATEGORY',
  lastAggregated: null,
};
