// js/core/deadlineCalc.js
// 期限・早期加算・要介護3分の1移行日計算エンジン
// DOMおよびStorageに一切依存しない純粋関数群として実装

import { REHA_RULES } from '../config/rules.js';
import { normalizeDateString } from './dataNormalizer.js';

/**
 * 日付オブジェクトまたは文字列を、時刻を切り捨てたローカルDateに変換する
 * @param {string|Date} input 
 * @returns {Date|null}
 */
export function normalizeDate(input) {
  if (!input) return null;
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }
  const dateStr = normalizeDateString(input);
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

/**
 * Dateオブジェクトを YYYY-MM-DD 形式にフォーマットする
 * @param {Date} date 
 * @returns {string}
 */
export function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 2つの日付間の経過日数を計算する（開始日当日は0日目、diffDays=0）
 * @param {string|Date} fromDate 
 * @param {string|Date} toDate 
 * @returns {number|null}
 */
export function getDiffDays(fromDate, toDate) {
  const f = normalizeDate(fromDate);
  const t = normalizeDate(toDate);
  if (!f || !t) return null;
  const diffTime = t.getTime() - f.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * 疾患区分に応じた標準算定日数の3分の1日数を取得する
 * @param {string} diseaseType LOCOMOTIVE | CEREBROVASCULAR | DISUSE | ANALGESIA
 * @returns {number}
 */
export function getOneThirdDays(diseaseType) {
  const rule = REHA_RULES.LIMIT_DAYS[diseaseType];
  return rule ? rule.oneThirdDays : 9999;
}

/**
 * 基準日に指定日数を加算した日付文字列を返す
 * @param {string|Date} baseDate 
 * @param {number} daysToAdd 
 * @returns {string}
 */
export function addDays(baseDate, daysToAdd) {
  const d = normalizeDate(baseDate);
  if (!d) return '';
  d.setDate(d.getDate() + daysToAdd);
  return formatDate(d);
}

/**
 * 入院患者の早期加算フェーズを自動評価する（令和8年度改定準拠）
 * 起算日（転院患者は前医入院日、直接入院は当院入院日）含めての日数判定
 * 1〜4日目: 第1期 (60点), 5〜14日目: 第2期 (25点), 15日目以降/外来: なし
 * @param {string|Date} admissionOrStart 早期起算日
 * @param {string|Date} sessionDate 実施日
 * @param {string} category 患者区分 (INPATIENT | OUTPATIENT)
 * @returns {{ phase: 'PHASE_1'|'PHASE_2'|null, points: number, label: string }}
 */
export function evaluateEarlyBonusPhase(admissionOrStart, sessionDate, category = 'INPATIENT') {
  if (category !== 'INPATIENT') {
    return { phase: null, points: 0, label: '外来対象外' };
  }
  const diff = getDiffDays(admissionOrStart, sessionDate);
  if (diff === null || diff < 0) {
    return { phase: null, points: 0, label: '対象外' };
  }

  // 起算日当日を1日目とするため dayCount = diff + 1
  const dayCount = diff + 1;
  if (dayCount <= REHA_RULES.EARLY_BONUS.PHASE_1.maxDays) {
    return {
      phase: 'PHASE_1',
      points: REHA_RULES.EARLY_BONUS.PHASE_1.points,
      label: `早期加算(Ⅰ) +${REHA_RULES.EARLY_BONUS.PHASE_1.points}点 [${dayCount}日目]`
    };
  }
  if (dayCount <= REHA_RULES.EARLY_BONUS.PHASE_2.maxDays) {
    return {
      phase: 'PHASE_2',
      points: REHA_RULES.EARLY_BONUS.PHASE_2.points,
      label: `早期加算(Ⅱ) +${REHA_RULES.EARLY_BONUS.PHASE_2.points}点 [${dayCount}日目]`
    };
  }
  return { phase: null, points: 0, label: `早期加算終了 [${dayCount}日目]` };
}

/**
 * 患者の標準算定上限日・早期加算ステータス・要介護3分の1移行日を包括計算する
 * @param {Object} patient 患者マスター情報
 * @param {string|Date} baseDate 判定基準日（通常は当日）
 * @returns {Object} 判定結果オブジェクト
 */
export function calculatePatientDeadlines(patient, baseDate = new Date()) {
  const disease = REHA_RULES.LIMIT_DAYS[patient.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
  
  // 起算日選定（発症日・手術日優先、無ければ入院日）
  const startDateStr = patient.onsetDate || patient.admissionDate || '';
  const earlyStartStr = patient.earlyBonusStartDate || patient.admissionDate || '';

  // 1. 標準算定日数上限到達日および残日数
  let limitDateStr = '';
  let remainingDays = null;
  let isLimitExceeded = false;

  if (startDateStr && disease.days < 9000) {
    limitDateStr = addDays(startDateStr, disease.days);
    const diff = getDiffDays(baseDate, limitDateStr);
    remainingDays = diff !== null ? diff : null;
    isLimitExceeded = remainingDays !== null && remainingDays < 0;
  }

  // 2. 令和8年度改定 早期加算ステータス
  const earlyBonus = evaluateEarlyBonusPhase(earlyStartStr, baseDate, patient.category);

  // 3. 介護保険認定区分と総合実施計画書料2 移行日（3分の1経過日）
  let plan2TransitionDateStr = '';
  let plan2RemainingDays = null;
  let isPlan2Required = false;

  if (patient.careInsuranceType === 'CARE' && startDateStr && disease.oneThirdDays < 9000) {
    plan2TransitionDateStr = addDays(startDateStr, disease.oneThirdDays);
    const diffToPlan2 = getDiffDays(baseDate, plan2TransitionDateStr);
    plan2RemainingDays = diffToPlan2 !== null ? diffToPlan2 : null;
    isPlan2Required = plan2RemainingDays !== null && plan2RemainingDays <= 0;
  }

  // 4. 適用基本点数（100分の60減算判定連動）
  const isMaintenanceReduction = isLimitExceeded || patient.careInsuranceType === 'SUPPORT' || patient.careInsuranceType === 'CARE';
  const currentBasePoints = isMaintenanceReduction ? disease.maintPoints : disease.defaultPoints;

  return {
    diseaseLabel: disease.shortLabel,
    diseaseFullName: disease.fullName,
    standardDays: disease.days,
    startDateStr,
    limitDateStr,
    remainingDays,
    isLimitExceeded,
    earlyBonus,
    isMaintenanceReduction,
    currentBasePoints,
    careInsuranceType: patient.careInsuranceType || 'NONE',
    plan2TransitionDateStr,
    plan2RemainingDays,
    isPlan2Required
  };
}
