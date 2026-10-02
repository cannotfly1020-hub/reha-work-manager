// js/store/scheduleStore.js
// 時間割コマCRUD・コマ移動・消炎鎮痛CRUD・LocalStorage永続化・月間集計・過去計画書履歴判定層（200行制限準拠）

import { normalizeDateString, safeParseInt } from '../core/dataNormalizer.js';
import { getPatientById } from './patientStore.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';

const STORAGE_PREFIX = 'reha_schedule_';

function getStorageKey(dateStr) {
  return `${STORAGE_PREFIX}${normalizeDateString(dateStr)}`;
}

export function getDailySchedule(dateStr) {
  const defaultSchedule = { A: {}, B: {}, C: {}, analgesia: {} };
  const cleanDate = normalizeDateString(dateStr);
  if (!cleanDate) return defaultSchedule;

  try {
    const raw = localStorage.getItem(getStorageKey(cleanDate));
    if (!raw) return defaultSchedule;
    const parsed = JSON.parse(raw);
    return {
      A: parsed.A || {},
      B: parsed.B || {},
      C: parsed.C || {},
      analgesia: parsed.analgesia || {}
    };
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

  const rawPlan = slotData.billingPlan;
  const billingPlanVal = rawPlan ? String(rawPlan) : '';

  current[therapistId][slotId] = {
    patientId: slotData.patientId,
    units: Math.max(1, safeParseInt(slotData.units, 1)),
    note: slotData.note ? String(slotData.note).trim() : '',
    billingPlan: billingPlanVal,
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

export function moveScheduleSlot(dateStr, fromTherapistId, fromSlotId, toTherapistId, toSlotId) {
  const current = getDailySchedule(dateStr);
  const sourceSlot = current[fromTherapistId]?.[fromSlotId];
  if (!sourceSlot) return false;

  if (fromTherapistId === toTherapistId && fromSlotId === toSlotId) return true;
  if (!current[toTherapistId]) current[toTherapistId] = {};
  
  current[toTherapistId][toSlotId] = { ...sourceSlot, updatedAt: new Date().toISOString() };
  delete current[fromTherapistId][fromSlotId];
  return saveDailySchedule(dateStr, current);
}

export function addAnalgesiaPatient(dateStr, slotId, patientId) {
  if (!dateStr || !slotId || !patientId) return false;
  const current = getDailySchedule(dateStr);
  if (!current.analgesia) current.analgesia = {};
  if (!Array.isArray(current.analgesia[slotId])) current.analgesia[slotId] = [];

  if (!current.analgesia[slotId].includes(patientId)) {
    current.analgesia[slotId].push(patientId);
    return saveDailySchedule(dateStr, current);
  }
  return true;
}

export function removeAnalgesiaPatient(dateStr, slotId, patientId) {
  if (!dateStr || !slotId || !patientId) return false;
  const current = getDailySchedule(dateStr);
  if (!current.analgesia?.[slotId]) return true;

  current.analgesia[slotId] = current.analgesia[slotId].filter((id) => id !== patientId);
  if (current.analgesia[slotId].length === 0) delete current.analgesia[slotId];
  return saveDailySchedule(dateStr, current);
}

export function getAnalgesiaSlotPatients(dateStr, slotId) {
  const schedule = getDailySchedule(dateStr);
  const patientIds = schedule.analgesia?.[slotId] || [];
  return patientIds.map((id) => getPatientById(id) || { id, name: '未登録患者', category: 'OUTPATIENT', diseaseType: 'ANALGESIA' });
}

export function getDailyStats(dateStr) {
  const schedule = getDailySchedule(dateStr);
  const stats = {
    totalUnits: 0, totalPatients: 0, planCount: 0,
    therapists: { A: { units: 0, patients: 0 }, B: { units: 0, patients: 0 }, C: { units: 0, patients: 0 } },
    analgesia: { total: 0, inpatients: 0, outpatients: 0 }
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

  const aSlots = schedule.analgesia || {};
  Object.values(aSlots).forEach((pIds) => {
    if (Array.isArray(pIds)) {
      pIds.forEach((pId) => {
        uniquePatients.add(pId);
        stats.analgesia.total += 1;
        const p = getPatientById(pId);
        if (p?.category === 'INPATIENT') stats.analgesia.inpatients += 1;
        else stats.analgesia.outpatients += 1;
      });
    }
  });

  stats.totalPatients = uniquePatients.size;
  return stats;
}

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
        return dStr;
      }
    }
  }
  return null;
}

/**
 * 対象患者が指定日より過去に計画書を算定した実績があるか判定する
 */
export function hasPatientPastPlan(patientId, beforeDateStr) {
  if (!patientId || !beforeDateStr) return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const datePart = key.replace(STORAGE_PREFIX, '');
      if (datePart >= beforeDateStr) continue; // 指定日当日以降は除外

      const sched = JSON.parse(localStorage.getItem(key) || '{}');
      for (const tId of ['A', 'B', 'C']) {
        const slots = sched[tId] || {};
        for (const item of Object.values(slots)) {
          if (item?.patientId === patientId && item?.billingPlan) return true;
        }
      }
    }
  } catch (e) {
    console.error('hasPatientPastPlan error:', e);
  }
  return false;
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
    dailyBreakdown[day] = {
      totalUnits: 0, inpatients: 0, outpatients: 0, planCount: 0,
      analgesiaTotal: 0, analgesiaInpatients: 0, analgesiaOutpatients: 0
    };

    ['A', 'B', 'C'].forEach((tId) => {
      const tSlots = schedule[tId] || {};
      Object.entries(tSlots).forEach(([slotId, item]) => {
        if (!item?.patientId) return;
        const pId = item.patientId;
        const u = safeParseInt(item.units, 1);
        const patient = getPatientById(pId) || { id: pId, name: '未登録患者', category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE' };

        if (!patientMap[pId]) {
          patientMap[pId] = {
            patient, totalUnits: 0, planCount: 0, earlyBonusCount: 0, totalEarlyUnits: 0,
            dailyUnits: Array(daysInMonth + 1).fill(0), dailyEarlyUnits: Array(daysInMonth + 1).fill(0), slots: []
          };
        }
        patientMap[pId].totalUnits += u;
        patientMap[pId].dailyUnits[day] += u;
        if (item.billingPlan) {
          patientMap[pId].planCount += 1;
          dailyBreakdown[day].planCount += 1;
        }
        const deadline = calculatePatientDeadlines(patient, dayStr);
        if (deadline.earlyBonus?.points > 0) {
          patientMap[pId].earlyBonusCount += 1;
          patientMap[pId].totalEarlyUnits += u;
          patientMap[pId].dailyEarlyUnits[day] += u;
        }
        patientMap[pId].slots.push({ date: dayStr, therapist: tId, slotId, units: u, billingPlan: item.billingPlan });
        dailyBreakdown[day].totalUnits += u;
        if (patient.category === 'INPATIENT') dailyBreakdown[day].inpatients += u;
        else dailyBreakdown[day].outpatients += u;
      });
    });

    const aSlots = schedule.analgesia || {};
    const daySeen = new Set();
    Object.values(aSlots).forEach((pIds) => {
      if (Array.isArray(pIds)) {
        pIds.forEach((pId) => {
          dailyBreakdown[day].analgesiaTotal += 1;
          const p = getPatientById(pId);
          if (p?.category === 'INPATIENT') dailyBreakdown[day].analgesiaInpatients += 1;
          else dailyBreakdown[day].analgesiaOutpatients += 1;

          if (!daySeen.has(pId)) {
            daySeen.add(pId);
            const patient = p || { id: pId, name: '未登録患者', category: 'OUTPATIENT', diseaseType: 'ANALGESIA' };
            if (!patientMap[pId]) {
              patientMap[pId] = {
                patient, totalUnits: 0, planCount: 0, earlyBonusCount: 0, totalEarlyUnits: 0,
                dailyUnits: Array(daysInMonth + 1).fill(0), dailyEarlyUnits: Array(daysInMonth + 1).fill(0), slots: []
              };
            }
            if (patient.diseaseType === 'ANALGESIA') {
              patientMap[pId].dailyUnits[day] = 1;
              patientMap[pId].totalUnits += 1;
            }
            patientMap[pId].slots.push({ date: dayStr, isAnalgesia: true, points: 35, units: 0 });
          }
        });
      }
    });
  }
  return { year: y, month: m, daysInMonth, patientMap, dailyBreakdown };
}
