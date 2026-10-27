// js/store/scheduleStore.js
// 時間割コマCRUD・コマ移動・消炎鎮痛CRUD・LocalStorage永続化・月間集計（消炎/疾患別自動完全分離対応・高速O(1)最適化版）

import { TIME_SLOTS } from '../config/rules.js';
import { normalizeDateString, safeParseInt } from '../core/dataNormalizer.js';
import { storageGet, storageKeys } from '../core/storageAdapter.js';
import { writeStorageItem } from './storageWrite.js';
import { getPatientById } from './patientStore.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';
import { appendAuditLog, AUDIT_CATEGORY, AUDIT_ACTION } from './auditLogStore.js';

export function isNonPatientBlock(item) {
  return item?.itemType === 'TASK'
    || item?.itemType === 'LEAVE'
    || item?.itemType === 'HOLIDAY'
    || item?.itemType === 'SPECIAL_LEAVE';
}

export function getSlotSpan(item) {
  if (!item) return 0;
  if (isNonPatientBlock(item)) {
    return Math.min(24, Math.max(1, safeParseInt(item.slotsCount || item.units, 1)));
  }
  if (item.patientId) return Math.min(4, Math.max(1, safeParseInt(item.units, 1)));
  return 0;
}

export function slotRangeOverlaps(schedule, therapistId, startSlotId, span, excludeSlotId = null) {
  const startIndex = TIME_SLOTS.findIndex((slot) => slot.id === startSlotId);
  if (startIndex < 0) return { blocked: true, message: '時間枠が見つかりません。' };
  if (startIndex + span > TIME_SLOTS.length) {
    return { blocked: true, message: 'コマの終了時間が診療時間枠を超過しています。' };
  }

  const slots = schedule?.[therapistId] || {};
  for (const [slotId, item] of Object.entries(slots)) {
    if (!item || slotId === excludeSlotId) continue;
    const itemStart = TIME_SLOTS.findIndex((slot) => slot.id === slotId);
    const itemSpan = getSlotSpan(item);
    if (itemStart < 0 || itemSpan <= 0) continue;
    const overlaps = startIndex < itemStart + itemSpan && itemStart < startIndex + span;
    if (overlaps) {
      const label = isNonPatientBlock(item) ? (item.title || '業務') : '患者予定';
      return { blocked: true, message: `この時間枠は「${label}」と重なるため配置できません。` };
    }
  }
  return { blocked: false, message: '' };
}

const STORAGE_PREFIX = 'reha_schedule_';

function getStorageKey(dateStr) {
  return `${STORAGE_PREFIX}${normalizeDateString(dateStr)}`;
}

/** スケジュールオブジェクトからセラピスト列ID一覧を取得（analgesia を除外） */
export function listTherapistIdsFromSchedule(schedule) {
  return Object.keys(schedule || {}).filter((key) => key !== 'analgesia');
}

export function getDailySchedule(dateStr) {
  const defaultSchedule = { A: {}, B: {}, C: {}, analgesia: {} };
  const cleanDate = normalizeDateString(dateStr);
  if (!cleanDate) return { ...defaultSchedule };

  try {
    const raw = storageGet(getStorageKey(cleanDate));
    if (!raw) return { ...defaultSchedule };
    const parsed = JSON.parse(raw);
    // A/B/C 以外（D以降の増員枠）も永続化データを欠落させない
    const result = { analgesia: parsed.analgesia || {} };
    Object.keys(parsed).forEach((key) => {
      if (key === 'analgesia') return;
      if (parsed[key] && typeof parsed[key] === 'object' && !Array.isArray(parsed[key])) {
        result[key] = parsed[key];
      }
    });
    ['A', 'B', 'C'].forEach((id) => {
      if (!result[id]) result[id] = {};
    });
    return result;
  } catch (error) {
    console.error('getDailySchedule parse error:', error);
    return { ...defaultSchedule };
  }
}

export function saveDailySchedule(dateStr, scheduleData) {
  const cleanDate = normalizeDateString(dateStr);
  if (!cleanDate || !scheduleData) return false;
  try {
    return writeStorageItem(getStorageKey(cleanDate), JSON.stringify(scheduleData));
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
  const isBlock = isNonPatientBlock(slotData);
  const units = isBlock
    ? Math.min(24, Math.max(1, safeParseInt(slotData.slotsCount || slotData.units, 1)))
    : Math.max(1, safeParseInt(slotData.units, 1));

  const record = {
    patientId: isBlock ? null : (slotData.patientId || ''),
    units,
    note: slotData.note ? String(slotData.note).trim() : '',
    billingPlan: isBlock ? '' : billingPlanVal,
    updatedAt: new Date().toISOString()
  };
  if (isBlock) {
    record.itemType = slotData.itemType;
    record.title = String(slotData.title || '業務').trim() || '業務';
    record.slotsCount = units;
  } else if (record.patientId) {
    record.itemType = 'PATIENT';
  }

  const prev = current[therapistId]?.[slotId] || null;
  current[therapistId][slotId] = record;
  const ok = saveDailySchedule(dateStr, current);
  if (ok && !isBlock && record.patientId) {
    try {
      const patient = getPatientById(record.patientId);
      appendAuditLog({
        category: AUDIT_CATEGORY.SCHEDULE,
        action: prev ? AUDIT_ACTION.UPDATE : AUDIT_ACTION.CREATE,
        targetPatientId: record.patientId,
        targetPatientName: patient?.name || '',
        description: prev
          ? `時間割コマを更新（${dateStr} ${therapistId}/${slotId}・${record.units}単位）`
          : `時間割に配置（${dateStr} ${therapistId}/${slotId}・${record.units}単位）`
      });
    } catch (_) { /* ignore */ }
  }
  return ok;
}

export function clearScheduleSlot(dateStr, therapistId, slotId) {
  const current = getDailySchedule(dateStr);
  if (current[therapistId]?.[slotId]) {
    const removed = current[therapistId][slotId];
    delete current[therapistId][slotId];
    const ok = saveDailySchedule(dateStr, current);
    if (ok && removed?.patientId) {
      try {
        const patient = getPatientById(removed.patientId);
        appendAuditLog({
          category: AUDIT_CATEGORY.SCHEDULE,
          action: AUDIT_ACTION.DELETE,
          targetPatientId: removed.patientId,
          targetPatientName: patient?.name || '',
          description: `時間割コマを削除（${dateStr} ${therapistId}/${slotId}）`
        });
      } catch (_) { /* ignore */ }
    }
    return ok;
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
  const ok = saveDailySchedule(dateStr, current);
  if (ok && sourceSlot.patientId) {
    try {
      const patient = getPatientById(sourceSlot.patientId);
      appendAuditLog({
        category: AUDIT_CATEGORY.SCHEDULE,
        action: AUDIT_ACTION.MOVE,
        targetPatientId: sourceSlot.patientId,
        targetPatientName: patient?.name || '',
        description: `時間割コマを移動（${dateStr} ${fromTherapistId}/${fromSlotId} → ${toTherapistId}/${toSlotId}）`
      });
    } catch (_) { /* ignore */ }
  }
  return ok;
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
    therapists: {},
    analgesia: { total: 0, inpatients: 0, outpatients: 0 }
  };
  const uniquePatients = new Set();

  listTherapistIdsFromSchedule(schedule).forEach((tId) => {
    const tSlots = schedule[tId] || {};
    const tSet = new Set();
    if (!stats.therapists[tId]) stats.therapists[tId] = { units: 0, patients: 0 };
    Object.values(tSlots).forEach((item) => {
      if (isNonPatientBlock(item)) return;
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
    for (const tId of listTherapistIdsFromSchedule(schedule)) {
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

export function hasPatientPastPlan(patientId, beforeDateStr) {
  if (!patientId || !beforeDateStr) return false;

  const patient = getPatientById(patientId);
  if (patient) {
    if (patient.planStatus === 'PLAN_1_FOLLOW' || patient.planStatus === 'PLAN_2_FOLLOW') {
      return true;
    }
  }

  try {
    const scheduleKeys = storageKeys(STORAGE_PREFIX);
    for (const key of scheduleKeys) {
      const datePart = key.replace(STORAGE_PREFIX, '');
      if (datePart >= beforeDateStr) continue;

      const raw = storageGet(key);
      if (!raw || !raw.includes(patientId)) continue;

      const sched = JSON.parse(raw);
      for (const tId of listTherapistIdsFromSchedule(sched)) {
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

/**
 * 月間集計（疾患別リハビリと消炎鎮痛処置の月途中複数回往復・完全自動分離集計対応）
 */
export function aggregateFromAppSchedule(year, month) {
  const y = safeParseInt(year);
  const m = safeParseInt(month);
  const daysInMonth = new Date(y, m, 0).getDate();
  const patientMap = {};
  const dailyBreakdown = {};

  const ensurePatientEntry = (pId, fallbackPatient) => {
    if (!patientMap[pId]) {
      const patient = getPatientById(pId) || fallbackPatient || { id: pId, name: '未登録患者', category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE' };
      patientMap[pId] = {
        patient,
        totalUnits: 0,          // 全体単位（互換用）
        rehaTotalUnits: 0,      // 個別リハ純粋合計単位
        totalAnalgesiaDays: 0,  // 消炎鎮痛純粋来院日数
        hasRehaSlots: false,    // 月内個別リハ実績の有無
        hasAnalgesiaSlots: false,// 月内消炎鎮痛来院実績の有無
        planCount: 0,
        earlyBonusCount: 0,
        totalEarlyUnits: 0,
        dailyUnits: Array(daysInMonth + 1).fill(0),      // 画面表示用（個別リハ優先、消炎のみ患者は日数）
        dailyRehaUnits: Array(daysInMonth + 1).fill(0),  // 個別リハ日別単位
        dailyAnalgesia: Array(daysInMonth + 1).fill(0),  // 消炎鎮痛日別来院回数 (1/0)
        dailyEarlyUnits: Array(daysInMonth + 1).fill(0),
        slots: []
      };
    }
    return patientMap[pId];
  };

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const schedule = getDailySchedule(dayStr);
    dailyBreakdown[day] = {
      totalUnits: 0, inpatients: 0, outpatients: 0, planCount: 0,
      analgesiaTotal: 0, analgesiaInpatients: 0, analgesiaOutpatients: 0
    };

    // 1. セラピスト個別枠の走査（疾患別リハビリテーション・増員枠 D 以降も対象）
    listTherapistIdsFromSchedule(schedule).forEach((tId) => {
      const tSlots = schedule[tId] || {};
      Object.entries(tSlots).forEach(([slotId, item]) => {
        if (!item?.patientId || isNonPatientBlock(item)) return;
        const pId = item.patientId;
        const u = safeParseInt(item.units, 1);
        const entry = ensurePatientEntry(pId);

        entry.hasRehaSlots = true;
        entry.rehaTotalUnits += u;
        entry.dailyRehaUnits[day] += u;

        if (item.billingPlan) {
          entry.planCount += 1;
          dailyBreakdown[day].planCount += 1;
        }

        const deadline = calculatePatientDeadlines(entry.patient, dayStr);
        if (deadline.earlyBonus?.points > 0) {
          entry.earlyBonusCount += 1;
          entry.totalEarlyUnits += u;
          entry.dailyEarlyUnits[day] += u;
        }

        entry.slots.push({ date: dayStr, therapist: tId, slotId, units: u, billingPlan: item.billingPlan });
        dailyBreakdown[day].totalUnits += u;

        if (entry.patient.category === 'INPATIENT') dailyBreakdown[day].inpatients += u;
        else dailyBreakdown[day].outpatients += u;
      });
    });

    // 2. 消炎鎮痛枠の走査（消炎鎮痛等処置 35点）
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
            const entry = ensurePatientEntry(pId, p);
            entry.hasAnalgesiaSlots = true;
            entry.dailyAnalgesia[day] = 1;
            entry.totalAnalgesiaDays += 1;
            entry.slots.push({ date: dayStr, isAnalgesia: true, points: 35, units: 0 });
          }
        });
      }
    });
  }

  // 3. 後処理：画面表示・集計互換用 dailyUnits の確定
  Object.values(patientMap).forEach((entry) => {
    if (entry.hasRehaSlots) {
      // 月内に個別リハを実施している患者：dailyUnits は純粋な個別リハ単位数を採用
      entry.dailyUnits = [...entry.dailyRehaUnits];
      entry.totalUnits = entry.rehaTotalUnits;
    } else {
      // 個別リハ実績が0件（純粋な消炎鎮痛専任）の患者：dailyUnits は消炎鎮痛来院日数を採用
      entry.dailyUnits = [...entry.dailyAnalgesia];
      entry.totalUnits = entry.totalAnalgesiaDays;
    }
  });

  return { year: y, month: m, daysInMonth, patientMap, dailyBreakdown };
}

/**
 * 指定患者の当月・日別個別リハ単位マップ（キーは日 1〜31）
 * 月13単位ブレーキ・ドロップ即配置の判定用。消炎鎮痛は含めない。
 * @param {string} patientId
 * @param {number} year
 * @param {number} month 1〜12
 * @returns {Record<number, number>}
 */
export function getPatientMonthDailyRehaUnitsMap(patientId, year, month) {
  const map = {};
  if (!patientId) return map;
  const y = safeParseInt(year);
  const m = safeParseInt(month);
  if (!y || !m) return map;

  const daysInMonth = new Date(y, m, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const schedule = getDailySchedule(dayStr);
    let dayUnits = 0;
    listTherapistIdsFromSchedule(schedule).forEach((tId) => {
      const slots = schedule[tId] || {};
      Object.values(slots).forEach((item) => {
        if (!item?.patientId || item.patientId !== patientId || isNonPatientBlock(item)) return;
        dayUnits += safeParseInt(item.units, 1);
      });
    });
    if (dayUnits > 0) map[day] = dayUnits;
  }
  return map;
}
