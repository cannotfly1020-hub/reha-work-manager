// js/store/scheduleStore.js
// 時間割コマCRUD・LocalStorage永続化・月間集計・計画書算定履歴検索層（200行制限準拠）

import { normalizeDateString, safeParseInt } from '../core/dataNormalizer.js';
import { getPatientById } from './patientStore.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';

const STORAGE_PREFIX = 'reha_schedule_';

function getStorageKey(dateStr) {
  return `${STORAGE_PREFIX}${normalizeDateString(dateStr)}`;
}

export function getDailySchedule(dateStr) {
  const defaultSchedule = { A: {}, B: {}, C: {} };
  const cleanDate = normalizeDateString(dateStr);
  if (!cleanDate) return defaultSchedule;

  try {
    const raw = localStorage.getItem(getStorageKey(cleanDate));
    if (!raw) return defaultSchedule;
    const parsed = JSON.parse(raw);
    return { A: parsed.A || {}, B: parsed.B || {}, C: parsed.C || {} };
  } catch (error) {
    console.error('getDailySchedule parse error:', error);
    return defaultSchedule;
  }
}

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

export function setScheduleSlot(dateStr, therapistId, slotId, slotData) {
  const current = getDailySchedule(dateStr);
  if (!current[therapistId]) current[therapistId] = {};

  current[therapistId][slotId] = {
    patientId: slotData.patientId,
    units: Math.max(1, safeParseInt(slotData.units, 1)),
    note: slotData.note ? String(slotData.note).trim() : '',
    billingPlan: Boolean(slotData.billingPlan),
    updatedAt: new Date().toISOString()
  };
  return saveDailySchedule(dateStr, current);
}

export function clearScheduleSlot(dateStr, therapistId, slotId) {
  const current = getDailySchedule(dateStr);
  if (current[therapistId]?.[slotId]) {
    delete current[therapistId][slotId];
    return saveDailySchedule(dateStr, current);
  }
  return true;
}

export function getDailyStats(dateStr) {
  const schedule = getDailySchedule(dateStr);
  const stats = {
    totalUnits: 0, totalPatients: 0, planCount: 0,
    therapists: { A: { units: 0, patients: 0 }, B: { units: 0, patients: 0 }, C: { units: 0, patients: 0 } }
  };
  const uniquePatients = new Set();

  ['A', 'B', 'C'].forEach((tId) => {
    const tSlots = schedule[tId] || {};
    const tSet = new Set();
    Object.values(tSlots).forEach((item) => {
      if (item?.patientId) {
        const u = safeParseInt(item.units, 1);
        stats.therapists[tId].units += u;
        stats.totalUnits += u;
        tSet.add(item.patientId);
        uniquePatients.add(item.patientId);
        if (item.billingPlan) stats.planCount += 1;
      }
    });
    stats.therapists[tId].patients = tSet.size;
  });
  stats.totalPatients = uniquePatients.size;
  return stats;
}

/**
 * 当月内に同一患者が既に計画書料を算定している日付を走査・検出する
 */
export function findPatientMonthlyPlanDate(patientId, year, month, excludeDate = '', excludeSlotId = '') {
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const schedule = getDailySchedule(dStr);
    for (const tId of ['A', 'B', 'C']) {
      const slots = schedule[tId] || {};
      for (const [sId, item] of Object.entries(slots)) {
        if (!item || item.patientId !== patientId || !item.billingPlan) continue;
        if (dStr === excludeDate && sId === excludeSlotId) continue;
        return dStr; // 算定日を発見
      }
    }
  }
  return null;
}

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
        if (!item?.patientId) return;
        const pId = item.patientId;
        const u = safeParseInt(item.units, 1);
        const patient = getPatientById(pId) || { id: pId, name: '未登録患者', category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE' };

        if (!patientMap[pId]) {
          patientMap[pId] = {
            patient, totalUnits: 0, planCount: 0, earlyBonusCount: 0,
            dailyUnits: Array(daysInMonth + 1).fill(0), slots: []
          };
        }
        patientMap[pId].totalUnits += u;
        patientMap[pId].dailyUnits[day] += u;
        if (item.billingPlan) {
          patientMap[pId].planCount += 1;
          dailyBreakdown[day].planCount += 1;
        }
        const deadline = calculatePatientDeadlines(patient, dayStr);
        if (deadline.earlyBonus?.points > 0) patientMap[pId].earlyBonusCount += 1;

        patientMap[pId].slots.push({ date: dayStr, therapist: tId, slotId, units: u, billingPlan: item.billingPlan });
        dailyBreakdown[day].totalUnits += u;
        if (patient.category === 'INPATIENT') dailyBreakdown[day].inpatients += u;
        else dailyBreakdown[day].outpatients += u;
      });
    });
  }
  return { year: y, month: m, daysInMonth, patientMap, dailyBreakdown };
}
