// js/store/archiveManager.js
// 過去月スケジュールのアクティブウィンドウ常駐 + オンデマンドハイドレーション
// IndexedDB 正本は維持し、メモリのみスリム化（同期 getDailySchedule は破壊しない）

import { getLocalDateStr } from '../core/dateUtils.js';
import {
  SCHEDULE_PREFIX,
  setScheduleHydrationFilter,
  storageKeys,
  storageMemoryKeys,
  storageMemoryHas,
  storageHydrateKeys,
  storagePurgeKeysFromMemory,
  getStorageStats
} from '../core/storageAdapter.js';

/** 基準月から前後何ヶ月をアクティブ常駐とするか（前後3ヶ月 = 計最大7ヶ月） */
const ACTIVE_RADIUS_MONTHS = 3;

/** オンデマンドで追加ロードした YYYY-MM 集合 */
const onDemandMonths = new Set();

/**
 * 年月に offset ヶ月を加算
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} deltaMonths
 * @returns {{ year: number, month: number }}
 */
export function addMonths(year, month, deltaMonths) {
  const idx = year * 12 + (month - 1) + deltaMonths;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return { year: y, month: m };
}

/**
 * アクティブ窓の開始・終了（YYYY-MM-DD）
 * @param {Date|string} [base]
 * @returns {{ start: string, end: string, centerYear: number, centerMonth: number }}
 */
export function getActiveWindowBounds(base = new Date()) {
  let y;
  let m;
  if (typeof base === 'string' && /^\d{4}-\d{2}/.test(base)) {
    y = Number(base.slice(0, 4));
    m = Number(base.slice(5, 7));
  } else {
    const d = base instanceof Date ? base : new Date();
    y = d.getFullYear();
    m = d.getMonth() + 1;
  }

  const startYm = addMonths(y, m, -ACTIVE_RADIUS_MONTHS);
  const endYm = addMonths(y, m, ACTIVE_RADIUS_MONTHS);
  const start = `${startYm.year}-${String(startYm.month).padStart(2, '0')}-01`;
  const endDay = new Date(endYm.year, endYm.month, 0).getDate();
  const end = `${endYm.year}-${String(endYm.month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

  return { start, end, centerYear: y, centerMonth: m };
}

/**
 * @param {string} dateStr YYYY-MM-DD
 * @param {Date|string} [base]
 * @returns {boolean}
 */
export function isDateStrInActiveWindow(dateStr, base = new Date()) {
  if (!dateStr || dateStr.length < 10) return false;
  const { start, end } = getActiveWindowBounds(base);
  return dateStr >= start && dateStr <= end;
}

/**
 * @param {string} key reha_schedule_YYYY-MM-DD
 * @param {Date|string} [base]
 * @returns {boolean}
 */
export function isScheduleKeyInActiveWindow(key, base = new Date()) {
  if (!key || !key.startsWith(SCHEDULE_PREFIX)) return true;
  const dateStr = key.slice(SCHEDULE_PREFIX.length);
  return isDateStrInActiveWindow(dateStr, base);
}

/**
 * initStorage より前に呼ぶ: 起動時メモリをアクティブ窓のみに制限
 */
export function registerArchiveHydrationFilter() {
  setScheduleHydrationFilter((key) => isScheduleKeyInActiveWindow(key));
}

/**
 * 指定年月の全スケジュールキーを列挙（索引ベース）
 * @param {number} year
 * @param {number} month
 * @returns {string[]}
 */
export function listScheduleKeysForMonth(year, month) {
  const prefix = `${SCHEDULE_PREFIX}${year}-${String(month).padStart(2, '0')}-`;
  return storageKeys(prefix);
}

/**
 * 過去月をオンデマンドでメモリへ展開。完了後は getDailySchedule が同期で読める。
 * @param {number} year
 * @param {number} month
 * @returns {Promise<{ year: number, month: number, loaded: number, keys: number }>}
 */
export async function loadMonthOnDemand(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) {
    return { year: y, month: m, loaded: 0, keys: 0 };
  }

  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const keys = listScheduleKeysForMonth(y, m);

  // 索引に無い日もあり得るため、当月全日キーを候補に追加（空データは hydrate でスキップ）
  const daysInMonth = new Date(y, m, 0).getDate();
  const candidateKeys = new Set(keys);
  for (let d = 1; d <= daysInMonth; d += 1) {
    candidateKeys.add(`${SCHEDULE_PREFIX}${ym}-${String(d).padStart(2, '0')}`);
  }

  const toLoad = [...candidateKeys];
  const loaded = await storageHydrateKeys(toLoad);
  onDemandMonths.add(ym);

  // アクティブ窓外の古いオンデマンド月をメモリから安全に破棄
  await purgeStaleOnDemandCaches(y, m);

  return { year: y, month: m, loaded, keys: toLoad.length };
}

/**
 * 年間推移など向け: 指定年の1〜12月を順にハイドレート
 * @param {number} year
 */
export async function loadYearOnDemand(year) {
  const y = Number(year);
  for (let m = 1; m <= 12; m += 1) {
    await loadMonthOnDemand(y, m);
  }
}

/**
 * 診療報酬年度（4月〜翌3月）をハイドレート
 * @param {number} fiscalStartYear 年度開始年（4月の西暦）
 */
export async function loadFiscalYearOnDemand(fiscalStartYear) {
  const y0 = Number(fiscalStartYear);
  if (!y0) return;
  for (let m = 4; m <= 12; m += 1) {
    await loadMonthOnDemand(y0, m);
  }
  const y1 = y0 + 1;
  for (let m = 1; m <= 3; m += 1) {
    await loadMonthOnDemand(y1, m);
  }
}

/**
 * 表示中月＋アクティブ窓以外のオンデマンドキャッシュをメモリから外す
 * @param {number} viewYear
 * @param {number} viewMonth
 */
async function purgeStaleOnDemandCaches(viewYear, viewMonth) {
  const keep = new Set();
  const { start, end } = getActiveWindowBounds();
  // アクティブ窓の YYYY-MM
  let cursor = { year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) };
  const endYm = `${end.slice(0, 4)}-${end.slice(5, 7)}`;
  for (let i = 0; i < 24; i += 1) {
    const ym = `${cursor.year}-${String(cursor.month).padStart(2, '0')}`;
    keep.add(ym);
    if (ym >= endYm) break;
    cursor = addMonths(cursor.year, cursor.month, 1);
  }
  // 表示中月は保持
  keep.add(`${viewYear}-${String(viewMonth).padStart(2, '0')}`);

  const toDrop = [];
  onDemandMonths.forEach((ym) => {
    if (!keep.has(ym)) toDrop.push(ym);
  });

  toDrop.forEach((ym) => {
    const keys = storageMemoryKeys(`${SCHEDULE_PREFIX}${ym}-`);
    // アクティブ窓内の日付は落とさない
    const purgeTargets = keys.filter((key) => !isScheduleKeyInActiveWindow(key));
    storagePurgeKeysFromMemory(purgeTargets);
    onDemandMonths.delete(ym);
  });
}

/**
 * 起動直後: フィルタ適用済みなら追加パージは不要だが、統計ログを出す
 * @returns {Promise<{ active: number, archived: number }>}
 */
export async function initArchiveManager() {
  // 万一フィルタ未適用で全件載っている場合に備え、アクティブ外をメモリから外す
  const cold = storageMemoryKeys(SCHEDULE_PREFIX).filter((key) => !isScheduleKeyInActiveWindow(key));
  if (cold.length > 0) {
    storagePurgeKeysFromMemory(cold);
    console.log(`[archiveManager] Purged ${cold.length} cold schedule keys from memory`);
  }

  const stats = getArchiveStats();
  console.log(
    `[archiveManager] Active schedules in memory: ${stats.activeInMemory}, archived (cold index): ${stats.archivedCount}`
  );
  return { active: stats.activeInMemory, archived: stats.archivedCount };
}

/**
 * UI 表示用統計
 * @returns {{ activeInMemory: number, archivedCount: number, totalScheduleKeys: number, onDemandMonths: string[] }}
 */
export function getArchiveStats() {
  const allSchedule = storageKeys(SCHEDULE_PREFIX);
  let activeInMemory = 0;
  let archivedCount = 0;

  allSchedule.forEach((key) => {
    if (isScheduleKeyInActiveWindow(key)) {
      if (storageMemoryHas(key)) activeInMemory += 1;
    } else {
      archivedCount += 1;
    }
  });

  // メモリ上のアクティブ窓キー（索引に無い新規日も含めたい場合）
  const memActive = storageMemoryKeys(SCHEDULE_PREFIX).filter((k) => isScheduleKeyInActiveWindow(k)).length;
  if (memActive > activeInMemory) activeInMemory = memActive;

  return {
    activeInMemory,
    archivedCount,
    totalScheduleKeys: allSchedule.length,
    onDemandMonths: [...onDemandMonths].sort(),
    storage: getStorageStats(),
    window: getActiveWindowBounds(getLocalDateStr())
  };
}
