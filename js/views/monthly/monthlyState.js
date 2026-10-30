// js/views/monthly/monthlyState.js
// 月間画面の対象年月・並び順・絞り込み（セレクト統合）・直近の集計結果

const now = new Date();

/**
 * 絞り込みセレクト値（セラピストは th:<id>）
 * @typedef {'ALL'|'inpatient'|'outpatient'|'disuse_all'|'maint_all'|'maint_inpatient'|'maint_outpatient'|'uncalculated_plan'} MonthlyFilterKey
 */

export const MONTHLY_QUICK_FILTERS = Object.freeze({
  ALL: 'ALL',
  INPATIENT: 'inpatient',
  OUTPATIENT: 'outpatient',
  /** ラベル: 消炎鎮痛のみ（値名は仕様固定） */
  ANALGESIA: 'disuse_all',
  MAINT_ALL: 'maint_all',
  MAINT_INPATIENT: 'maint_inpatient',
  MAINT_OUTPATIENT: 'maint_outpatient',
  PLAN_MISSING: 'uncalculated_plan',
  // 旧キー互換
  IN_DISEASE: 'IN_DISEASE',
  IN_ANALGESIA: 'IN_ANALGESIA',
  OUT_DISEASE: 'OUT_DISEASE',
  OUT_ANALGESIA: 'OUT_ANALGESIA',
  MAINTENANCE: 'MAINTENANCE',
});

/** 絞り込み表示ラベル（印刷タイトル・UI共用） */
export const MONTHLY_QUICK_FILTER_LABELS = Object.freeze({
  [MONTHLY_QUICK_FILTERS.ALL]: '全員',
  [MONTHLY_QUICK_FILTERS.INPATIENT]: '入院患者のみ',
  [MONTHLY_QUICK_FILTERS.OUTPATIENT]: '外来患者のみ',
  [MONTHLY_QUICK_FILTERS.ANALGESIA]: '消炎鎮痛のみ',
  [MONTHLY_QUICK_FILTERS.MAINT_ALL]: '維持期 全員（月13単位）',
  [MONTHLY_QUICK_FILTERS.MAINT_INPATIENT]: '入院の維持期のみ',
  [MONTHLY_QUICK_FILTERS.MAINT_OUTPATIENT]: '外来の維持期のみ',
  [MONTHLY_QUICK_FILTERS.PLAN_MISSING]: '計画書未算定のみ',
  // 旧キー
  [MONTHLY_QUICK_FILTERS.IN_DISEASE]: '入院疾患別',
  [MONTHLY_QUICK_FILTERS.IN_ANALGESIA]: '入院消炎鎮痛',
  [MONTHLY_QUICK_FILTERS.OUT_DISEASE]: '外来疾患別',
  [MONTHLY_QUICK_FILTERS.OUT_ANALGESIA]: '外来消炎鎮痛',
  [MONTHLY_QUICK_FILTERS.MAINTENANCE]: '維持期・移行対象',
  PLAN_MISSING_LEGACY: '計画書未算定',
});

/** セラピスト絞り込みの value 接頭辞 */
export const MONTHLY_FILTER_THERAPIST_PREFIX = 'th:';

/**
 * セレクト値を quickFilter / therapistFilterId に分解
 * @param {string} raw
 * @returns {{ filterKey: string, therapistFilterId: string }}
 */
export function parseMonthlyFilterSelectValue(raw) {
  const v = String(raw || '').trim();
  if (v.startsWith(MONTHLY_FILTER_THERAPIST_PREFIX)) {
    return {
      filterKey: MONTHLY_QUICK_FILTERS.ALL,
      therapistFilterId: v.slice(MONTHLY_FILTER_THERAPIST_PREFIX.length).trim(),
    };
  }
  return {
    filterKey: v || MONTHLY_QUICK_FILTERS.ALL,
    therapistFilterId: '',
  };
}

/**
 * 状態からセレクト value を復元
 * @param {{ quickFilter?: string, therapistFilterId?: string }} state
 * @returns {string}
 */
export function buildMonthlyFilterSelectValue(state) {
  const tid = String(state?.therapistFilterId || '').trim();
  if (tid) return `${MONTHLY_FILTER_THERAPIST_PREFIX}${tid}`;
  return String(state?.quickFilter || MONTHLY_QUICK_FILTERS.ALL);
}

export const monthlyState = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  sortKey: 'CATEGORY',
  /** @type {string} */
  quickFilter: MONTHLY_QUICK_FILTERS.ALL,
  /** 担当セラピスト絞り込み（空文字＝全員／セレクトで th: 選択時のみ） */
  therapistFilterId: '',
  lastAggregated: null,
};
