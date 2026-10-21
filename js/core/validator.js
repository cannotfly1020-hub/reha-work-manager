// js/core/validator.js
// 13単位制限・1日上限・人員基準・重複予約・計画書月1回算定の多重バリデーションガード
// DOM・Storageに非依存の純粋検証ロジック（200行制限準拠・18単位警告撤廃・週108単位超過判定対応版）

import { REHA_RULES, TIME_SLOTS } from '../config/rules.js';
import { getDiffDays } from './deadlineCalc.js';

/**
 * スロットIDと単位数から占有するスロットID一覧を取得する
 * @param {string} startSlotId 
 * @param {number} units 
 * @returns {string[]} 占有スロットIDの配列
 */
export function getOccupiedSlotIds(startSlotId, units) {
  const startIndex = TIME_SLOTS.findIndex((s) => s.id === startSlotId);
  if (startIndex === -1) return [];
  const occupied = [];
  for (let i = 0; i < units; i++) {
    const slot = TIME_SLOTS[startIndex + i];
    if (slot) occupied.push(slot.id);
  }
  return occupied;
}

/**
 * 1. 同時間帯重複防止（ダブルブッキングガード）
 * 指定患者が同時間帯に他セラピストまたは自身と重複していないか検証
 * @param {Object} dailySchedule { A: {}, B: {}, C: {} }
 * @param {string} targetTherapist A | B | C
 * @param {string} targetSlotId
 * @param {string} patientId
 * @param {number} units
 * @param {string|null} excludeSlotId 編集時に除外する元スロットID
 * @param {string|null} excludeTherapistId 担当変更時に除外する元セラピストID
 * @returns {{ valid: boolean, message: string }}
 */
export function validateTimeConflict(
  dailySchedule,
  targetTherapist,
  targetSlotId,
  patientId,
  units,
  excludeSlotId = null,
  excludeTherapistId = null
) {
  if (!patientId) return { valid: true, message: '' };

  const targetSlots = getOccupiedSlotIds(targetSlotId, units);
  if (targetSlots.length < units) {
    return { valid: false, message: 'コマの終了時間が診療時間枠を超過しています。' };
  }

  const therapists = ['A', 'B', 'C'];
  for (const tId of therapists) {
    const tSchedule = dailySchedule[tId] || {};
    for (const [sId, item] of Object.entries(tSchedule)) {
      if (!item || !item.patientId) continue;

      // 担当・時間変更時: 変更元コマは自分自身なので重複とみなさない
      if (excludeTherapistId && excludeSlotId && tId === excludeTherapistId && sId === excludeSlotId) {
        continue;
      }
      // 互換: 除外セラピスト未指定時は、保存先セラピスト上の excludeSlotId のみ除外
      if (!excludeTherapistId && excludeSlotId && tId === targetTherapist && sId === excludeSlotId) {
        continue;
      }

      const itemOccupied = getOccupiedSlotIds(sId, item.units || 1);
      const isOverlap = targetSlots.some((slot) => itemOccupied.includes(slot));

      if (isOverlap) {
        if (tId === targetTherapist) {
          return { valid: false, message: `担当セラピスト(${tId})の同時間帯に既に別の予定があります。` };
        }
        if (item.patientId === patientId) {
          return {
            valid: false,
            message: `【二重登録防止】同時刻にすでに該当患者が配置されています (${tId === targetTherapist ? '同セラピスト' : '他セラピスト'})`
          };
        }
      }
    }
  }
  return { valid: true, message: '' };
}

/**
 * 2. 患者1日算定上限ガード
 * 原則6単位。発症/入院14日以内の脳血管/廃用は9単位まで特例許可
 */
export function validateDailyLimit(dailySchedule, patient, currentDate, newUnits, currentSlotUnits = 0) {
  let dailyTotal = 0;
  ['A', 'B', 'C'].forEach((tId) => {
    const tSchedule = dailySchedule[tId] || {};
    Object.values(tSchedule).forEach((item) => {
      if (item && item.patientId === patient.id) {
        dailyTotal += Number(item.units) || 0;
      }
    });
  });

  const nextTotal = dailyTotal - currentSlotUnits + newUnits;
  let maxAllowed = REHA_RULES.LIMITS.DAILY_STANDARD;

  const startDate = patient.onsetDate || patient.admissionDate;
  const isAcuteEligible = patient.diseaseType === 'CEREBROVASCULAR' || patient.diseaseType === 'DISUSE';
  if (startDate && isAcuteEligible) {
    const diff = getDiffDays(startDate, currentDate);
    if (diff !== null && diff >= 0 && diff < 14) {
      maxAllowed = REHA_RULES.LIMITS.DAILY_ACUTE_MAX;
    }
  }

  if (nextTotal > maxAllowed) {
    return {
      valid: false,
      message: `患者1日上限（最大${maxAllowed}単位）を超過します。（現在: ${dailyTotal}単位 / 変更後: ${nextTotal}単位）`
    };
  }
  return { valid: true, message: '' };
}

/**
 * 3. 月13単位制限ガード
 * 対象は「標準算定日数超過」または「個別13単位指定」のみ。
 * 要介護・要支援であること自体では制限しない（点数減算とは独立）。
 * 医療保険のみ(NONE)でも日数超過後は本制限の対象となる。
 */
export function validateMonthly13Limit(monthlyCurrentUnits, patient, isLimitExceeded, newUnits, currentSlotUnits = 0) {
  const force13 = patient?.force13Limit === true || patient?.force13UnitsLimit === true;
  const isTarget = isLimitExceeded === true || force13;

  if (!isTarget) return { valid: true, message: '' };

  const nextMonthly = monthlyCurrentUnits - currentSlotUnits + newUnits;
  const maxMonthly = REHA_RULES.LIMITS.MONTHLY_MAINTENANCE_MAX;

  if (nextMonthly > maxMonthly) {
    return {
      valid: false,
      message: `算定期限超過後の「月13単位制限」を超過します。（当月累計: ${monthlyCurrentUnits}単位 / 変更後: ${nextMonthly}単位）`
    };
  }
  return { valid: true, message: '' };
}

/**
 * 4. 総合実施計画書料 月1回算定ガード
 * 同一月内に同一患者ですでに計画書を算定している場合は重複算定をブロック
 * @param {boolean} billingPlan 今回チェックが入っているか
 * @param {string|null} existingPlanDate すでに当月内に算定されている日付（YYYY-MM-DD）または null
 * @returns {{ valid: boolean, message: string }}
 */
export function validateMonthlyPlanLimit(billingPlan, existingPlanDate) {
  if (!billingPlan) return { valid: true, message: '' };
  if (existingPlanDate) {
    return {
      valid: false,
      message: `総合計画評価料は月1回のみ算定可能です。（既に ${existingPlanDate} に算定済みです）`
    };
  }
  return { valid: true, message: '' };
}

/**
 * 5. セラピスト人員基準ガード
 * 1日最大特例24単位（24超は完全遮断）、週108単位超過警告（18単位警告は撤廃）
 */
export function validateTherapistWorkload(dailySchedule, therapistId, newUnits, currentSlotUnits = 0, weeklyTotalBefore = 0) {
  let therapistDaily = 0;
  const tSchedule = dailySchedule[therapistId] || {};
  Object.values(tSchedule).forEach((item) => {
    if (item && item.patientId) therapistDaily += Number(item.units) || 0;
  });

  const nextDaily = therapistDaily - currentSlotUnits + newUnits;
  const nextWeekly = weeklyTotalBefore - currentSlotUnits + newUnits;

  // 1日特例上限（24単位）を超過した場合は物理的に遮断
  if (nextDaily > REHA_RULES.LIMITS.THERAPIST_DAILY_MAX) {
    return {
      valid: false,
      level: 'BLOCK',
      message: `セラピスト(${therapistId})の1日特例上限（${REHA_RULES.LIMITS.THERAPIST_DAILY_MAX}単位）を超過するため配置できません。（変更後: ${nextDaily}単位）`
    };
  }

  // 週累計が108単位を超過した場合のみ警告ポップアップを出す
  if (nextWeekly > REHA_RULES.LIMITS.THERAPIST_WEEKLY_MAX) {
    return {
      valid: true,
      level: 'WARN',
      message: `【人員基準注意】セラピスト(${therapistId})の週累計が基準（${REHA_RULES.LIMITS.THERAPIST_WEEKLY_MAX}単位）を超過します。（変更後: ${nextWeekly}単位）`
    };
  }

  // ★18単位超過での警告（ポップアップ）は不要のため完全撤廃

  return { valid: true, level: 'OK', message: '' };
}
