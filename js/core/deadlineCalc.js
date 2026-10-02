// js/core/deadlineCalc.js
// 期限・早期加算・要介護3分の1移行日計算・総合計画書自動判定エンジン
// DOMおよびStorageに一切依存しない純粋関数群として実装（200行制限準拠）

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
 * 入院患者の早期加算フェーズ・終了日・残日数を自動評価する（令和8年度改定準拠）
 * 起算日（転院患者は前医入院日、直接入院は当院入院日）含めての日数判定
 * 1〜4日目: 第1期 (60点), 5〜14日目: 第2期 (25点), 15日目以降/外来: なし
 * @param {string|Date} admissionOrStart 早期起算日
 * @param {string|Date} sessionDate 実施日
 * @param {string} category 患者区分 (INPATIENT | OUTPATIENT)
 * @returns {Object}
 */
export function evaluateEarlyBonusPhase(admissionOrStart, sessionDate, category = 'INPATIENT') {
  if (category !== 'INPATIENT') {
    return { phase: null, points: 0, label: '外来対象外', isEligible: false, endDateStr: '', remainingDays: null, shortLabel: '' };
  }
  const diff = getDiffDays(admissionOrStart, sessionDate);
  if (diff === null || diff < 0) {
    return { phase: null, points: 0, label: '対象外', isEligible: false, endDateStr: '', remainingDays: null, shortLabel: '' };
  }

  // 起算日当日を1日目とするため dayCount = diff + 1
  const dayCount = diff + 1;
  const maxAllowedDays = REHA_RULES.EARLY_BONUS.PHASE_2.maxDays; // 14日
  const endDateStr = addDays(admissionOrStart, maxAllowedDays - 1);
  const remainingDays = maxAllowedDays - dayCount;

  const endParts = endDateStr.split('-');
  const shortDateStr = endParts.length === 3 ? `${Number(endParts[1])}/${Number(endParts[2])}` : '';

  if (dayCount <= REHA_RULES.EARLY_BONUS.PHASE_1.maxDays) {
    return {
      phase: 'PHASE_1',
      points: REHA_RULES.EARLY_BONUS.PHASE_1.points,
      label: `早期加算(Ⅰ) +${REHA_RULES.EARLY_BONUS.PHASE_1.points}点 [${dayCount}日目]`,
      isEligible: true,
      dayCount,
      endDateStr,
      remainingDays,
      shortLabel: `早:〜${shortDateStr}`
    };
  }
  if (dayCount <= maxAllowedDays) {
    return {
      phase: 'PHASE_2',
      points: REHA_RULES.EARLY_BONUS.PHASE_2.points,
      label: `早期加算(Ⅱ) +${REHA_RULES.EARLY_BONUS.PHASE_2.points}点 [${dayCount}日目]`,
      isEligible: true,
      dayCount,
      endDateStr,
      remainingDays,
      shortLabel: `早:〜${shortDateStr}`
    };
  }
  return {
    phase: null,
    points: 0,
    label: `早期加算終了 [${dayCount}日目]`,
    isEligible: false,
    dayCount,
    endDateStr,
    remainingDays: 0,
    shortLabel: ''
  };
}

/**
 * 患者の標準算定上限日・早期加算ステータス・要介護3分の1移行日を包括計算する
 * @param {Object} patient 患者マスター情報
 * @param {string|Date} baseDate 判定基準日（通常は当日）
 * @returns {Object} 判定結果オブジェクト
 */
export function calculatePatientDeadlines(patient, baseDate = new Date()) {
  const disease = REHA_RULES.LIMIT_DAYS[patient?.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
  const startDateStr = patient?.onsetDate || patient?.admissionDate || '';
  const earlyStartStr = patient?.earlyBonusStartDate || patient?.admissionDate || '';

  let limitDateStr = '';
  let remainingDays = null;
  let isLimitExceeded = false;

  if (startDateStr && disease.days < 9000) {
    limitDateStr = addDays(startDateStr, disease.days);
    const diff = getDiffDays(baseDate, limitDateStr);
    remainingDays = diff !== null ? diff : null;
    isLimitExceeded = remainingDays !== null && remainingDays < 0;
  }

  const earlyBonus = evaluateEarlyBonusPhase(earlyStartStr, baseDate, patient?.category);

  let plan2TransitionDateStr = '';
  let plan2RemainingDays = null;
  let isPlan2Required = false;

  if (patient?.careInsuranceType === 'CARE' && startDateStr && disease.oneThirdDays < 9000) {
    plan2TransitionDateStr = addDays(startDateStr, disease.oneThirdDays);
    const diffToPlan2 = getDiffDays(baseDate, plan2TransitionDateStr);
    plan2RemainingDays = diffToPlan2 !== null ? diffToPlan2 : null;
    isPlan2Required = plan2RemainingDays !== null && plan2RemainingDays <= 0;
  }

  const isMaintenanceReduction = isLimitExceeded || patient?.careInsuranceType === 'SUPPORT' || patient?.careInsuranceType === 'CARE';
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
    careInsuranceType: patient?.careInsuranceType || 'NONE',
    plan2TransitionDateStr,
    plan2RemainingDays,
    isPlan2Required
  };
}

/**
 * リハ総合計画評価料（4区分）の推奨選択肢を自動判定する純粋関数
 * @param {Object} patient 患者マスター情報
 * @param {string} targetDateStr 算定対象日 (YYYY-MM-DD)
 * @param {boolean} hasPastPlan 過去（対象日より前）に算定実績があるか
 * @returns {{ recommendedPlan: string, label: string, points: number, reason: string }}
 */
export function evaluateRecommendedPlan(patient, targetDateStr, hasPastPlan = false) {
  if (!patient || patient.diseaseType === 'ANALGESIA') {
    return { recommendedPlan: '', label: 'なし (算定しない)', points: 0, reason: '物療または患者未選択' };
  }

  const deadlines = calculatePatientDeadlines(patient, targetDateStr);
  const isPlan2 = deadlines.isPlan2Required;
  const isFirst = !hasPastPlan;

  if (isPlan2) {
    return isFirst
      ? {
          recommendedPlan: 'PLAN_2_FIRST',
          label: '総合実施計画書2 (初回: 240点)',
          points: REHA_RULES.PLAN_POINTS.PLAN_2_FIRST,
          reason: '要介護認定 ＋ 3分の1日数経過 (初回)'
        }
      : {
          recommendedPlan: 'PLAN_2_FOLLOW',
          label: '総合実施計画書2 (2回目以降: 196点)',
          points: REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW,
          reason: '要介護認定 ＋ 3分の1日数経過 (2回目以降)'
        };
  }

  return isFirst
    ? {
        recommendedPlan: 'PLAN_1_FIRST',
        label: '総合実施計画書1 (初回: 300点)',
        points: REHA_RULES.PLAN_POINTS.PLAN_1_FIRST,
        reason: '通常算定 (初回)'
      }
    : {
        recommendedPlan: 'PLAN_1_FOLLOW',
        label: '総合実施計画書1 (2回目以降: 240点)',
        points: REHA_RULES.PLAN_POINTS.PLAN_1_FOLLOW,
        reason: '通常算定 (2回目以降)'
      };
}
