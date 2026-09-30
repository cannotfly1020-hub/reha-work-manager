/**
 * @file scheduleStore.js
 * @description セラピスト別当日時間割（午前・午後コマ）および単位入力のローカル保存ストア
 * 
 * - 各セラピスト（A, B, C）の当日のタイムスケジュール（9:00〜12:20、14:00〜17:20）を直接管理
 * - 入力された患者・単位数・コマデータをブラウザのLocalStorageに完全ローカル蓄積
 * - Excelファイルに毎日手入力することなく、本アプリ内の蓄積データから月末の受付提出・業務日誌を即座に自動集計可能
 */

import { normalizePatientId, normalizeString } from '../core/dataNormalizer.js';
import { formatDate } from '../core/deadlineCalc.js';

const STORAGE_KEY_SCHEDULES = 'reha_manager_schedules_v1';

// リハビリ記録のコマ枠定義（午前10コマ、午後10コマ）
export const TIME_SLOTS = [
  // 午前セッション（10コマ）
  { id: 'am_1', period: 'am', time: '9:00～9:20', label: '9:00' },
  { id: 'am_2', period: 'am', time: '9:20～9:40', label: '9:20' },
  { id: 'am_3', period: 'am', time: '9:40～10:00', label: '9:40' },
  { id: 'am_4', period: 'am', time: '10:00～10:20', label: '10:00' },
  { id: 'am_5', period: 'am', time: '10:20～10:40', label: '10:20' },
  { id: 'am_6', period: 'am', time: '10:40～11:00', label: '10:40' },
  { id: 'am_7', period: 'am', time: '11:00～11:20', label: '11:00' },
  { id: 'am_8', period: 'am', time: '11:20～11:40', label: '11:20' },
  { id: 'am_9', period: 'am', time: '11:40～12:00', label: '11:40' },
  { id: 'am_10', period: 'am', time: '12:00～12:20', label: '12:00' },

  // 午後セッション（10コマ）
  { id: 'pm_1', period: 'pm', time: '14:00～14:20', label: '14:00' },
  { id: 'pm_2', period: 'pm', time: '14:20～14:40', label: '14:20' },
  { id: 'pm_3', period: 'pm', time: '14:40～15:00', label: '14:40' },
  { id: 'pm_4', period: 'pm', time: '15:00～15:20', label: '15:00' },
  { id: 'pm_5', period: 'pm', time: '15:20～15:40', label: '15:20' },
  { id: 'pm_6', period: 'pm', time: '15:40～16:00', label: '15:40' },
  { id: 'pm_7', period: 'pm', time: '16:00～16:20', label: '16:00' },
  { id: 'pm_8', period: 'pm', time: '16:20～16:40', label: '16:20' },
  { id: 'pm_9', period: 'pm', time: '16:40～17:00', label: '16:40' },
  { id: 'pm_10', period: 'pm', time: '17:00～17:20', label: '17:00' },
];

/**
 * 全日程のスケジュール辞書を取得
 * 構造: { [dateStr: 'YYYY-MM-DD']: { [therapistCode: 'A'|'B'|'C']: { [slotId]: { patientId, units, note } } } }
 */
export function getAllSchedules() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SCHEDULES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    console.error('[scheduleStore] スケジュール読み込みエラー:', error);
    return {};
  }
}

/**
 * 全日程のスケジュール辞書を保存
 */
export function saveAllSchedules(schedules) {
  try {
    localStorage.setItem(STORAGE_KEY_SCHEDULES, JSON.stringify(schedules));
  } catch (error) {
    console.error('[scheduleStore] スケジュール保存エラー:', error);
  }
}

/**
 * 特定日付のスケジュールを取得
 */
export function getDailySchedule(dateStr) {
  const all = getAllSchedules();
  return all[dateStr] || { A: {}, B: {}, C: {} };
}

/**
 * 1つのコマ（スロット）に患者・単位を設定
 * 
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} therapistCode - 'A'|'B'|'C'
 * @param {string} slotId - 例: 'am_1'
 * @param {Object} slotData - { patientId: 'a', units: 2, note?: string }
 */
export function setScheduleSlot(dateStr, therapistCode, slotId, slotData) {
  const all = getAllSchedules();
  if (!all[dateStr]) all[dateStr] = {};
  if (!all[dateStr][therapistCode]) all[dateStr][therapistCode] = {};

  const normPatientId = normalizePatientId(slotData.patientId);
  const units = parseInt(slotData.units, 10) || 0;

  if (!normPatientId || units <= 0) {
    // データが空または0単位ならコマをクリア
    delete all[dateStr][therapistCode][slotId];
  } else {
    all[dateStr][therapistCode][slotId] = {
      patientId: normPatientId,
      units,
      note: normalizeString(slotData.note || ''),
      updatedAt: new Date().toISOString(),
    };
  }

  saveAllSchedules(all);
  return all[dateStr];
}

/**
 * コマを削除（クリア）
 */
export function clearScheduleSlot(dateStr, therapistCode, slotId) {
  const all = getAllSchedules();
  if (all[dateStr] && all[dateStr][therapistCode]) {
    delete all[dateStr][therapistCode][slotId];
    saveAllSchedules(all);
  }
}

/**
 * 指定日のセラピスト別および全体の集計値（総単位、実人数）を取得
 */
export function getDailyStats(dateStr) {
  const daySchedule = getDailySchedule(dateStr);
  const therapistStats = {
    A: { totalUnits: 0, patients: new Set() },
    B: { totalUnits: 0, patients: new Set() },
    C: { totalUnits: 0, patients: new Set() },
  };

  const allPatientsToday = new Set();
  let grandTotalUnits = 0;

  ['A', 'B', 'C'].forEach((tCode) => {
    const slots = daySchedule[tCode] || {};
    for (const slot of Object.values(slots)) {
      if (slot && slot.units > 0 && slot.patientId) {
        therapistStats[tCode].totalUnits += slot.units;
        therapistStats[tCode].patients.add(slot.patientId);
        allPatientsToday.add(slot.patientId);
        grandTotalUnits += slot.units;
      }
    }
  });

  return {
    therapistStats: {
      A: { totalUnits: therapistStats.A.totalUnits, patientCount: therapistStats.A.patients.size },
      B: { totalUnits: therapistStats.B.totalUnits, patientCount: therapistStats.B.patients.size },
      C: { totalUnits: therapistStats.C.totalUnits, patientCount: therapistStats.C.patients.size },
    },
    grandTotalUnits,
    grandPatientCount: allPatientsToday.size,
  };
}

/**
 * アプリ内に蓄積された時間割データから、指定年月の集計オブジェクトを生成
 * （uketsukeWriter / diaryWriter が直接利用できる完全互換構造）
 * 
 * @param {number} targetYear 
 * @param {number} targetMonth 
 * @returns {Object} aggregated オブジェクト
 */
export function aggregateFromAppSchedule(targetYear, targetMonth) {
  const all = getAllSchedules();
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

  const byPatientAndDate = {};
  const byDateAndPatient = {};
  const patientTotals = {};
  const dailySummary = {};
  let rawRecordsCount = 0;

  // 各日を初期化
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(targetYear, targetMonth - 1, d);
    const dateStr = formatDate(dateObj);
    byDateAndPatient[dateStr] = {};
    dailySummary[dateStr] = {
      date: dateObj,
      dateStr,
      day: d,
      totalUnits: 0,
      uniquePatients: new Set(),
      therapistUnits: { A: 0, B: 0, C: 0 },
    };
  }

  // 該当月の日付を走査
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(targetYear, targetMonth - 1, d);
    const dateStr = formatDate(dateObj);
    const dayData = all[dateStr] || {};

    ['A', 'B', 'C'].forEach((tCode) => {
      const slots = dayData[tCode] || {};
      for (const [slotId, slot] of Object.entries(slots)) {
        if (!slot || !slot.patientId || slot.units <= 0) continue;

        const pId = normalizePatientId(slot.patientId);
        const units = slot.units;
        rawRecordsCount += 1;

        // byPatientAndDate 初期化
        if (!byPatientAndDate[pId]) {
          byPatientAndDate[pId] = {};
          patientTotals[pId] = {
            patientId: pId,
            totalUnits: 0,
            dates: new Set(),
          };
        }
        if (!byPatientAndDate[pId][dateStr]) {
          byPatientAndDate[pId][dateStr] = { PT: 0, OT: 0, total: 0, records: [] };
        }

        // byDateAndPatient 初期化
        if (!byDateAndPatient[dateStr][pId]) {
          byDateAndPatient[dateStr][pId] = { PT: 0, OT: 0, total: 0 };
        }

        // 加算（現在は全員PT）
        byPatientAndDate[pId][dateStr].PT += units;
        byPatientAndDate[pId][dateStr].total += units;
        byPatientAndDate[pId][dateStr].records.push({
          date: dateObj,
          dateStr,
          therapistCode: tCode,
          slotId,
          patientId: pId,
          units,
        });

        byDateAndPatient[dateStr][pId].PT += units;
        byDateAndPatient[dateStr][pId].total += units;

        patientTotals[pId].totalUnits += units;
        patientTotals[pId].dates.add(dateStr);

        dailySummary[dateStr].totalUnits += units;
        dailySummary[dateStr].uniquePatients.add(pId);
        dailySummary[dateStr].therapistUnits[tCode] += units;
      }
    });
  }

  return {
    targetYear,
    targetMonth,
    daysInMonth,
    rawRecordsCount,
    byPatientAndDate,
    byDateAndPatient,
    patientTotals,
    dailySummary,
    activePatientIds: Object.keys(patientTotals).sort(),
  };
}
