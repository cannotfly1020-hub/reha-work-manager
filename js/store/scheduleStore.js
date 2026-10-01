// js/store/scheduleStore.js
// 時間割コマCRUD・LocalStorage永続化・月間集計マトリクス層

import { normalizeDateString, safeParseInt } from '../core/dataNormalizer.js';
import { getPatientById } from './patientStore.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';

const STORAGE_PREFIX = 'reha_schedule_';

/**
 * 指定日のスケジュール保存キーを取得
 * @param {string} dateStr YYYY-MM-DD
 * @returns {string}
 */
function getStorageKey(dateStr) {
  return `${STORAGE_PREFIX}${normalizeDateString(dateStr)}`;
}

/**
 * 指定日の時間割オブジェクトを取得する
 * @param {string} dateStr YYYY-MM-DD
 * @returns {Object} { A: {}, B: {}, C: {} }
 */
export function getDailySchedule(dateStr) {
  const defaultSchedule = { A: {}, B: {}, C: {} };
  const cleanDate = normalizeDateString(dateStr);
  if (!cleanDate) return defaultSchedule;

  try {
    const raw = localStorage.getItem(getStorageKey(cleanDate));
    if (!raw) return defaultSchedule;
    const parsed = JSON.parse(raw);
    return {
      A: parsed.A || {},
      B: parsed.B || {},
      C: parsed.C || {}
    };
  } catch (error) {
    console.error('getDailySchedule parse error:', error);
    return defaultSchedule;
  }
}

/**
 * 指定日の時間割全体をLocalStorageに保存する
 * @param {string} dateStr YYYY-MM-DD
 * @param {Object} scheduleData 
 * @returns {boolean}
 */
export function saveDailySchedule(dateStr, scheduleData) {
  const cleanDate = normalizeDateString(dateStr);
  if (!cleanDate || !scheduleData) return false;

  try {
    localStorage.setItem(getStorageKey(cleanDate), JSON.stringify(scheduleData));
    return true;
  } catch (error) {
    console.error('saveDailySchedule error:', error);
    return false;
  }
}

/**
 * 時間割スロットに患者・単位・計画書算定情報を配置・更新する
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} therapistId 'A' | 'B' | 'C'
 * @param {string} slotId 'am_1' 〜 'pm_12'
 * @param {Object} slotData { patientId, units, note, billingPlan }
 * @returns {boolean}
 */
export function setScheduleSlot(dateStr, therapistId, slotId, slotData) {
  const current = getDailySchedule(dateStr);
  if (!current[therapistId]) {
    current[therapistId] = {};
  }

  current[therapistId][slotId] = {
    patientId: slotData.patientId,
    units: Math.max(1, safeParseInt(slotData.units, 1)),
    note: slotData.note ? String(slotData.note).trim() : '',
    billingPlan: Boolean(slotData.billingPlan),
    updatedAt: new Date().toISOString()
  };

  return saveDailySchedule(dateStr, current);
}

/**
 * 指定時間割スロットの配置を解除する
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} therapistId 'A' | 'B' | 'C'
 * @param {string} slotId 'am_1' 〜 'pm_12'
 * @returns {boolean}
 */
export function clearScheduleSlot(dateStr, therapistId, slotId) {
  const current = getDailySchedule(dateStr);
  if (current[therapistId] && current[therapistId][slotId]) {
    delete current[therapistId][slotId];
    return saveDailySchedule(dateStr, current);
  }
  return true;
}

/**
 * 指定日のセラピスト別および全体の集計値（単位数・人数・計画書件数）を算出する
 * @param {string} dateStr YYYY-MM-DD
 * @returns {Object}
 */
export function getDailyStats(dateStr) {
  const schedule = getDailySchedule(dateStr);
  const stats = {
    totalUnits: 0,
    totalPatients: 0,
    planCount: 0,
    therapists: {
      A: { units: 0, patients: 0 },
      B: { units: 0, patients: 0 },
      C: { units: 0, patients: 0 }
    }
  };

  const uniquePatientsDaily = new Set();

  ['A', 'B', 'C'].forEach((tId) => {
    const tSlots = schedule[tId] || {};
    const tPatientSet = new Set();

    Object.values(tSlots).forEach((item) => {
      if (item && item.patientId) {
        const u = safeParseInt(item.units, 1);
        stats.therapists[tId].units += u;
        stats.totalUnits += u;
        tPatientSet.add(item.patientId);
        uniquePatientsDaily.add(item.patientId);
        if (item.billingPlan) stats.planCount += 1;
      }
    });

    stats.therapists[tId].patients = tPatientSet.size;
  });

  stats.totalPatients = uniquePatientsDaily.size;
  return stats;
}

/**
 * 指定年月の全時間割データを走査し、月間集計マトリクスを生成する（月間表示・Excel出力の共通基盤）
 * @param {number} year 
 * @param {number} month 1〜12
 * @returns {Object} 月間集計オブジェクト
 */
export function aggregateFromAppSchedule(year, month) {
  const y = safeParseInt(year);
  const m = safeParseInt(month);
  const daysInMonth = new Date(y, m, 0).getDate();
  const patientMap = {};
  const dailyBreakdown = {};

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const schedule = getDailySchedule(dayStr);
    dailyBreakdown[day] = { totalUnits: 0, inpatients: 0, outpatients: 0, planCount: 0 };

    ['A', 'B', 'C'].forEach((tId) => {
      const tSlots = schedule[tId] || {};
      Object.entries(tSlots).forEach(([slotId, item]) => {
        if (!item || !item.patientId) return;
        const pId = item.patientId;
        const u = safeParseInt(item.units, 1);
        const patient = getPatientById(pId) || { id: pId, name: '未登録患者', category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE' };

        if (!patientMap[pId]) {
          patientMap[pId] = {
            patient,
            totalUnits: 0,
            planCount: 0,
            earlyBonusCount: 0,
            dailyUnits: Array(daysInMonth + 1).fill(0),
            slots: []
          };
        }

        patientMap[pId].totalUnits += u;
        patientMap[pId].dailyUnits[day] += u;
        if (item.billingPlan) {
          patientMap[pId].planCount += 1;
          dailyBreakdown[day].planCount += 1;
        }

        const deadlineInfo = calculatePatientDeadlines(patient, dayStr);
        if (deadlineInfo.earlyBonus && deadlineInfo.earlyBonus.points > 0) {
          patientMap[pId].earlyBonusCount += 1;
        }

        patientMap[pId].slots.push({ date: dayStr, therapist: tId, slotId, units: u, billingPlan: item.billingPlan });
        dailyBreakdown[day].totalUnits += u;
        if (patient.category === 'INPATIENT') dailyBreakdown[day].inpatients += u;
        else dailyBreakdown[day].outpatients += u;
      });
    });
  }

  return { year: y, month: m, daysInMonth, patientMap, dailyBreakdown };
}
