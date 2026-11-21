// js/core/annualStats.js
// 診療報酬年度（4月〜翌3月）統計の読み取り専用集計
// ※ scheduleStore.aggregateFromAppSchedule / deadlineCalc は変更しない

import { storageGet } from './storageAdapter.js';
import { writeStorageItem } from '../store/storageWrite.js';
import {
  getDailySchedule,
  isNonPatientBlock,
  listTherapistIdsFromSchedule
} from '../store/scheduleStore.js';
import { getPatientById, getAllPatients } from '../store/patientStore.js';
import { loadMonthOnDemand } from '../store/archiveManager.js';
import { safeParseInt } from './dataNormalizer.js';

const HOSPITAL_DISCHARGE_KEY_PREFIX = 'reha_annual_hospital_discharges_FY';

/**
 * 本日基準の診療報酬年度（4月始まり）
 * @param {Date} [base]
 * @returns {number} 年度の西暦（例: 2026年度 → 2026）
 */
export function getCurrentFiscalYear(base = new Date()) {
  const y = base.getFullYear();
  const m = base.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}

/**
 * 年度に含まれる { year, month } を4月〜翌3月で返す
 * @param {number} fiscalYear
 * @returns {{ year: number, month: number, key: string, label: string }[]}
 */
export function listFiscalYearMonths(fiscalYear) {
  const fy = Number(fiscalYear) || getCurrentFiscalYear();
  const months = [];
  for (let i = 0; i < 12; i += 1) {
    // 0-based: 4月=3 … 3月=14 → 翌年3月
    const monthIndex = 3 + i;
    const year = fy + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    months.push({
      year,
      month,
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: `${year}年${month}月`
    });
  }
  return months;
}

/**
 * 年度選択用オプション
 * @param {number} [centerFy]
 * @param {number} [span=5]
 * @returns {{ value: number, label: string }[]}
 */
export function buildFiscalYearOptions(centerFy = getCurrentFiscalYear(), span = 5) {
  const opts = [];
  for (let fy = centerFy - (span - 1); fy <= centerFy + 1; fy += 1) {
    opts.push({
      value: fy,
      label: `${fy}年度（${fy}年4月〜${fy + 1}年3月）`
    });
  }
  return opts;
}

/**
 * @param {number} fiscalYear
 * @returns {Record<string, number>}
 */
export function loadHospitalDischargeInputs(fiscalYear) {
  try {
    const raw = storageGet(`${HOSPITAL_DISCHARGE_KEY_PREFIX}${fiscalYear}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * @param {number} fiscalYear
 * @param {Record<string, number|string>} map monthKey → 総退院数
 * @returns {boolean}
 */
export function saveHospitalDischargeInputs(fiscalYear, map) {
  const clean = {};
  Object.entries(map || {}).forEach(([k, v]) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) clean[k] = Math.round(n);
  });
  return writeStorageItem(
    `${HOSPITAL_DISCHARGE_KEY_PREFIX}${fiscalYear}`,
    JSON.stringify(clean)
  );
}

/**
 * 患者の終了・退院日 YYYY-MM-DD
 * @param {object} patient
 * @returns {string}
 */
function resolvePatientExitDateStr(patient) {
  if (!patient) return '';
  const raw = patient.exitDate
    || patient.plannedDischargeDate
    || patient.dischargeDate
    || patient.discontinuedDate
    || patient.endDate
    || '';
  const m = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/**
 * 疾患別個別リハ対象か（消炎患者は除外）
 * @param {object|null} patient
 * @returns {boolean}
 */
function isDiseaseRehaPatient(patient) {
  if (!patient) return false;
  return patient.diseaseType !== 'ANALGESIA';
}

/**
 * 1ヶ月分の疾患別リハ単位・延べ人数を日次スケジュールから集計
 * @param {number} year
 * @param {number} month
 * @returns {{ totalUnits: number, patientDays: number, rehaPatientIds: Set<string> }}
 */
function aggregateMonthRehaStats(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let totalUnits = 0;
  let patientDays = 0;
  /** @type {Set<string>} */
  const rehaPatientIds = new Set();

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const schedule = getDailySchedule(dayStr);
    /** @type {Set<string>} */
    const dayPatients = new Set();

    listTherapistIdsFromSchedule(schedule).forEach((tId) => {
      const slots = schedule[tId] || {};
      Object.values(slots).forEach((item) => {
        if (!item?.patientId || isNonPatientBlock(item)) return;
        const p = getPatientById(item.patientId);
        if (!isDiseaseRehaPatient(p)) return;
        const u = safeParseInt(item.units, 1);
        if (u <= 0) return;
        totalUnits += u;
        dayPatients.add(String(item.patientId));
        rehaPatientIds.add(String(item.patientId));
      });
    });

    patientDays += dayPatients.size;
  }

  return { totalUnits, patientDays, rehaPatientIds };
}

/**
 * リハ実施退院数: 入院・その月に退院日・年度内に疾患別リハ実績あり
 * @param {number} year
 * @param {number} month
 * @param {Set<string>} fiscalRehaPatientIds
 * @returns {number}
 */
function countRehabDischargesWithFiscalReha(year, month, fiscalRehaPatientIds) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  let count = 0;
  getAllPatients(true).forEach((p) => {
    if (!p || p.category !== 'INPATIENT') return;
    if (!isDiseaseRehaPatient(p)) return;
    const exit = resolvePatientExitDateStr(p);
    if (!exit || !exit.startsWith(prefix)) return;
    if (!fiscalRehaPatientIds.has(String(p.id))) return;
    count += 1;
  });
  return count;
}

/**
 * 平均単位（小数第2位）
 * @param {number} units
 * @param {number} patientDays
 * @returns {number}
 */
export function calcAvgUnitsPerPatientDay(units, patientDays) {
  if (!patientDays || patientDays <= 0) return 0;
  return Math.round((units / patientDays) * 100) / 100;
}

/**
 * 退院率％（小数第1位）。総退院数未入力時は null
 * @param {number} rehabDischarges
 * @param {number|null|undefined} hospitalTotal
 * @returns {number|null}
 */
export function calcRehabDischargeRate(rehabDischarges, hospitalTotal) {
  const total = Number(hospitalTotal);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((rehabDischarges / total) * 1000) / 10;
}

/**
 * 年度統計を集計（必要月をオンデマンドロード）
 * @param {number} fiscalYear
 * @returns {Promise<object>}
 */
export async function computeAnnualStats(fiscalYear) {
  const fy = Number(fiscalYear) || getCurrentFiscalYear();
  const monthsMeta = listFiscalYearMonths(fy);
  const hospitalInputs = loadHospitalDischargeInputs(fy);

  // 過去月をメモリへハイドレート（読み取り専用・既存集計関数は呼ばない）
  for (const m of monthsMeta) {
    try {
      await loadMonthOnDemand(m.year, m.month);
    } catch (e) {
      console.warn('[annualStats] loadMonthOnDemand soft-fail:', m.key, e);
    }
  }

  /** @type {Set<string>} */
  const fiscalRehaPatientIds = new Set();
  const monthRows = monthsMeta.map((m) => {
    const agg = aggregateMonthRehaStats(m.year, m.month);
    agg.rehaPatientIds.forEach((id) => fiscalRehaPatientIds.add(id));
    return {
      ...m,
      totalUnits: agg.totalUnits,
      patientDays: agg.patientDays,
      avgUnits: calcAvgUnitsPerPatientDay(agg.totalUnits, agg.patientDays),
      rehaPatientIds: agg.rehaPatientIds
    };
  });

  const rows = monthRows.map((m) => {
    const rehabDischarges = countRehabDischargesWithFiscalReha(
      m.year,
      m.month,
      fiscalRehaPatientIds
    );
    const hospitalTotalRaw = hospitalInputs[m.key];
    const hospitalTotal = (hospitalTotalRaw === undefined || hospitalTotalRaw === '' || hospitalTotalRaw === null)
      ? null
      : Number(hospitalTotalRaw);
    const dischargeRate = calcRehabDischargeRate(
      rehabDischarges,
      Number.isFinite(hospitalTotal) ? hospitalTotal : null
    );
    return {
      key: m.key,
      year: m.year,
      month: m.month,
      label: m.label,
      totalUnits: m.totalUnits,
      patientDays: m.patientDays,
      avgUnits: m.avgUnits,
      rehabDischarges,
      hospitalTotal: Number.isFinite(hospitalTotal) ? hospitalTotal : null,
      dischargeRate
    };
  });

  const yearTotalUnits = rows.reduce((s, r) => s + r.totalUnits, 0);
  const yearPatientDays = rows.reduce((s, r) => s + r.patientDays, 0);
  const yearRehabDischarges = rows.reduce((s, r) => s + r.rehabDischarges, 0);
  const yearHospitalTotal = rows.reduce(
    (s, r) => s + (r.hospitalTotal != null ? r.hospitalTotal : 0),
    0
  );
  const hasAnyHospital = rows.some((r) => r.hospitalTotal != null && r.hospitalTotal > 0);

  return {
    fiscalYear: fy,
    label: `${fy}年度（${fy}年4月〜${fy + 1}年3月）`,
    months: rows,
    summary: {
      totalUnits: yearTotalUnits,
      patientDays: yearPatientDays,
      avgUnits: calcAvgUnitsPerPatientDay(yearTotalUnits, yearPatientDays),
      rehabDischarges: yearRehabDischarges,
      hospitalTotal: hasAnyHospital ? yearHospitalTotal : null,
      dischargeRate: hasAnyHospital
        ? calcRehabDischargeRate(yearRehabDischarges, yearHospitalTotal)
        : null
    }
  };
}
