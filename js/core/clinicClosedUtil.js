// js/core/clinicClosedUtil.js
// 外来予約カレンダー：祝日＋定休（曜日×午前/午後）の共通判定
// ★読み取り専用に holidayCalc / OUTPATIENT_HOURS を利用（スケジュール本体は変更しない）

import { getJapaneseHolidayName } from './holidayCalc.js';
import { OUTPATIENT_HOURS } from '../config/rules.js';
import { normalizeTimeString, timeToMinutes } from './timeSlotGenerator.js';

/** UI・保存キー用の曜日キー（月→日） */
export const CLOSED_DAY_KEYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

/** Date#getDay() (0=日 … 6=土) → CLOSED_DAY_KEYS */
const DOW_TO_KEY = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

const DAY_LABELS = Object.freeze({
  mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日'
});

/**
 * デフォルト定休: 木曜午後・土曜午後
 * @returns {Record<string, { am: boolean, pm: boolean }>}
 */
export function createDefaultClosedPeriods() {
  return {
    mon: { am: false, pm: false },
    tue: { am: false, pm: false },
    wed: { am: false, pm: false },
    thu: { am: false, pm: true },
    fri: { am: false, pm: false },
    sat: { am: false, pm: true },
    sun: { am: false, pm: false }
  };
}

/**
 * 定休マップを正規化（欠落キーはデフォルトで補完）
 * @param {unknown} raw
 * @returns {Record<string, { am: boolean, pm: boolean }>}
 */
export function normalizeClosedPeriods(raw) {
  const defaults = createDefaultClosedPeriods();
  if (!raw || typeof raw !== 'object') return defaults;
  const src = /** @type {Record<string, { am?: boolean, pm?: boolean }>} */ (raw);
  const out = createDefaultClosedPeriods();
  CLOSED_DAY_KEYS.forEach((key) => {
    const row = src[key];
    if (!row || typeof row !== 'object') {
      // 未保存キーはデフォルト（木PM・土PM）を維持
      out[key] = { ...defaults[key] };
      return;
    }
    out[key] = {
      am: Boolean(row.am),
      pm: Boolean(row.pm)
    };
  });
  return out;
}

/**
 * @param {string|Date} dateInput
 * @returns {string} YYYY-MM-DD
 */
function toDateStr(dateInput) {
  if (!dateInput) return '';
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    const y = dateInput.getFullYear();
    const m = String(dateInput.getMonth() + 1).padStart(2, '0');
    const d = String(dateInput.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(dateInput).replace(/\//g, '-').slice(0, 10);
}

/**
 * @param {string} dateStr
 * @returns {number|null} 0=日 … 6=土
 */
function resolveDow(dateStr) {
  const s = toDateStr(dateStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return null;
  return dt.getDay();
}

/**
 * スロット時刻が午前か午後か（pmStart 未満＝AM）
 * @param {string} [slotTimeStr]
 * @param {string} [pmStart]
 * @returns {'am'|'pm'|null}
 */
export function resolveAmPmPeriod(slotTimeStr, pmStart) {
  const t = normalizeTimeString(slotTimeStr || '');
  if (!t) return null;
  const pm = normalizeTimeString(pmStart)
    || normalizeTimeString(OUTPATIENT_HOURS?.pmStart)
    || '13:00';
  return timeToMinutes(t) < timeToMinutes(pm) ? 'am' : 'pm';
}

/**
 * @param {object} [hours] OUTPATIENT_HOURS 相当
 * @returns {Record<string, { am: boolean, pm: boolean }>}
 */
export function getClosedPeriodsFromHours(hours) {
  return normalizeClosedPeriods(hours?.closedPeriods);
}

/**
 * 定休のみ（祝日除く）
 * @param {string|Date} dateInput
 * @param {string} [slotTimeStr] 未指定時は「その日の AM または PM のどちらかが休診」なら true
 * @param {object} [hours]
 * @returns {boolean}
 */
export function isRegularClosed(dateInput, slotTimeStr = '', hours = OUTPATIENT_HOURS) {
  const dow = resolveDow(dateInput);
  if (dow === null) return false;
  const key = DOW_TO_KEY[dow];
  const periods = getClosedPeriodsFromHours(hours);
  const row = periods[key] || { am: false, pm: false };
  const period = resolveAmPmPeriod(slotTimeStr, hours?.pmStart);
  if (!period) {
    return Boolean(row.am || row.pm);
  }
  return Boolean(row[period]);
}

/**
 * 祝日または定休か
 * @param {string|Date} dateInput
 * @param {string} [slotTimeStr]
 * @param {object} [hours]
 * @returns {boolean}
 */
export function isClinicClosed(dateInput, slotTimeStr = '', hours = OUTPATIENT_HOURS) {
  if (getJapaneseHolidayName(dateInput)) return true;
  return isRegularClosed(dateInput, slotTimeStr, hours);
}

/**
 * 休診理由（表示用）。開院時は null
 * @param {string|Date} dateInput
 * @param {string} [slotTimeStr]
 * @param {object} [hours]
 * @returns {string|null}
 */
export function getClinicClosedReason(dateInput, slotTimeStr = '', hours = OUTPATIENT_HOURS) {
  const holidayName = getJapaneseHolidayName(dateInput);
  if (holidayName) return `祝日（${holidayName}）`;

  const dow = resolveDow(dateInput);
  if (dow === null) return null;
  const key = DOW_TO_KEY[dow];
  const periods = getClosedPeriodsFromHours(hours);
  const row = periods[key] || { am: false, pm: false };
  const period = resolveAmPmPeriod(slotTimeStr, hours?.pmStart);
  const dayLabel = DAY_LABELS[key] || '';

  if (!period) {
    if (row.am && row.pm) return `${dayLabel}曜・終日休診`;
    if (row.am) return `${dayLabel}曜・午前休診`;
    if (row.pm) return `${dayLabel}曜・午後休診`;
    return null;
  }
  if (!row[period]) return null;
  return `${dayLabel}曜・${period === 'am' ? '午前' : '午後'}休診`;
}
