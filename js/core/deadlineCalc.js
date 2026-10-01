/**
 * @file deadlineCalc.js
 * @description リハビリテーション期限・早期加算・総合実施計画書料2移行日 計算エンジン
 * 
 * - 疾患別標準算定日数上限（運動器150日、脳血管180日、廃用120日）の超過判定
 * - 令和8年度改定 早期加算（4日以内: 60点 / 14日以内: 25点）の判定
 * - 要介護被保険者における「総合実施計画書料2 移行日（3分の1経過日）」の精密計算
 *   ・運動器: 50日後
 *   ・脳血管: 60日後
 *   ・廃用: 40日後
 * - 単体テスト容易・完全オフライン動作
 */

import { REHA_RULES } from '../config/rules.js';

/**
 * 日付オブジェクトまたは文字列を標準Dateオブジェクト（時刻00:00:00）に変換
 * @param {string|Date|number} input
 * @returns {Date|null}
 */
export function normalizeDate(input) {
  if (!input) return null;

  let d;
  if (typeof input === 'number') {
    d = new Date(Math.round((input - 25569) * 86400 * 1000));
  } else if (input instanceof Date) {
    d = new Date(input.getTime());
  } else if (typeof input === 'string') {
    const cleanStr = input.trim().replace(/\//g, '-');
    d = new Date(cleanStr);
  } else {
    return null;
  }

  if (isNaN(d.getTime())) return null;

  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 指定日数を加算した新しいDateオブジェクトを返却
 * @param {Date} date 
 * @param {number} days 
 * @returns {Date}
 */
export function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * 2つの日付の日数差を計算
 * @param {Date} fromDate 
 * @param {Date} toDate 
 * @returns {number}
 */
export function getDiffDays(fromDate, toDate) {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round((toDate.getTime() - fromDate.getTime()) / oneDayMs);
}

/**
 * 日付を 'YYYY-MM-DD' 形式の文字列にフォーマット
 * @param {Date} date 
 * @returns {string}
 */
export function formatDate(date) {
  if (!date || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 令和8年度改定 早期加算（4日以内 / 14日以内）の判定
 * @param {Date|string} admissionDate - 入院日（起算日）
 * @param {Date|string} sessionDate - リハビリ実施日
 * @returns {'PHASE_1'|'PHASE_2'|null}
 */
export function evaluateEarlyBonusPhase(admissionDate, sessionDate) {
  const adminDate = normalizeDate(admissionDate);
  const session = normalizeDate(sessionDate);

  if (!adminDate || !session) return null;
  if (session < adminDate) return null;

  const elapsedDays = getDiffDays(adminDate, session) + 1;
  const phase1Max = REHA_RULES.EARLY_BONUS.PHASE_1.maxDays; // 4日
  const phase2Max = REHA_RULES.EARLY_BONUS.PHASE_2.maxDays; // 14日

  if (elapsedDays <= phase1Max) {
    return 'PHASE_1';
  } else if (elapsedDays <= phase2Max) {
    return 'PHASE_2';
  }

  return null;
}

/**
 * 疾患別・標準算定日数の3分の1日数を取得
 * @param {string} diseaseType 
 * @returns {number} 3分の1日数 (運動器: 50, 脳血管: 60, 廃用: 40)
 */
export function getOneThirdDays(diseaseType) {
  switch (diseaseType) {
    case 'CEREBROVASCULAR':
      return 60; // 180日 / 3
    case 'DISUSE':
      return 40; // 120日 / 3
    case 'LOCOMOTIVE':
    default:
      return 50; // 150日 / 3
  }
}

/**
 * 患者ごとの各種期限（リハ上限・早期加算・計画書料2移行日・月13単位）を一括計算
 * 
 * @param {Object} patient 
 * @param {Date|string} [baseDate=new Date()] 
 * @returns {Object}
 */
export function calculatePatientDeadlines(patient, baseDate = new Date()) {
  const today = normalizeDate(baseDate) || new Date();
  
  const adminDate = normalizeDate(patient.admissionDate);
  const earlyStart = normalizeDate(patient.earlyBonusStartDate) || adminDate;
  const onset = normalizeDate(patient.onsetDate) || adminDate;

  if (!adminDate && !onset && !earlyStart) {
    return {
      isValid: false,
      error: '日付情報が設定されていません。',
    };
  }

  // 1. 早期加算判定
  let earlyPhase1Limit = null;
  let earlyPhase2Limit = null;
  let earlyBonusStatus = 'NOT_APPLICABLE';

  if (earlyStart) {
    earlyPhase1Limit = addDays(earlyStart, REHA_RULES.EARLY_BONUS.PHASE_1.maxDays - 1);
    earlyPhase2Limit = addDays(earlyStart, REHA_RULES.EARLY_BONUS.PHASE_2.maxDays - 1);

    if (today <= earlyPhase1Limit) {
      earlyBonusStatus = 'PHASE_1_ACTIVE';
    } else if (today <= earlyPhase2Limit) {
      earlyBonusStatus = 'PHASE_2_ACTIVE';
    } else {
      earlyBonusStatus = 'EXPIRED';
    }
  }

  // 2. 疾患別標準算定上限
  const diseaseConfig = REHA_RULES.LIMIT_DAYS[patient.diseaseType] || REHA_RULES.LIMIT_DAYS.LOCOMOTIVE;
  const limitDays = diseaseConfig.days;
  const rehaLimitDate = (onset && limitDays < 9999) ? addDays(onset, limitDays - 1) : null;
  const remainingRehaDays = rehaLimitDate ? getDiffDays(today, rehaLimitDate) : 9999;
  const isOverLimit = rehaLimitDate ? (remainingRehaDays < 0) : false;

  // 3. 要介護被保険者における「総合実施計画書料2 移行日（3分の1経過日）」
  const careType = patient.careInsuranceType || (patient.category?.includes('maintenance') ? 'CARE' : 'NONE');
  const isCarePatient = careType === 'CARE'; // 要介護認定者のみが対象
  const oneThirdDays = getOneThirdDays(patient.diseaseType || 'LOCOMOTIVE');
  
  let plan2TransitionDate = null;
  let plan2TransitionDateStr = '-';
  let isPlan2Active = false;
  let daysUntilPlan2 = 9999;

  if (onset && isCarePatient && patient.diseaseType !== 'ANALGESIA') {
    // 起算日から 3分の1 日数を加算した翌日以降が「料2」
    plan2TransitionDate = addDays(onset, oneThirdDays);
    plan2TransitionDateStr = formatDate(plan2TransitionDate);
    daysUntilPlan2 = getDiffDays(today, plan2TransitionDate);
    isPlan2Active = daysUntilPlan2 <= 0;
  }

  // 4. 月13単位制限判定
  const isRestrictedTo13 = isOverLimit || careType === 'CARE' || careType === 'SUPPORT' || Boolean(patient.is13UnitLimited);

  return {
    isValid: true,
    patientId: patient.id,
    diseaseLabel: diseaseConfig.shortLabel,
    admissionDateStr: formatDate(adminDate),
    earlyBonusStartDateStr: formatDate(earlyStart),
    onsetDateStr: formatDate(onset),
    todayStr: formatDate(today),

    // 早期加算
    earlyPhase1LimitDate: earlyPhase1Limit,
    earlyPhase1LimitStr: formatDate(earlyPhase1Limit),
    earlyPhase2LimitDate: earlyPhase2Limit,
    earlyPhase2LimitStr: formatDate(earlyPhase2Limit),
    earlyBonusStatus,

    // リハ上限
    rehaLimitDays: limitDays,
    rehaLimitDate,
    rehaLimitDateStr: formatDate(rehaLimitDate),
    remainingRehaDays,
    isOverLimit,
    isRestrictedTo13,

    // 総合実施計画書料2 移行情報
    careType,
    isCarePatient,
    oneThirdDays,
    plan2TransitionDate,
    plan2TransitionDateStr,
    isPlan2Active,
    daysUntilPlan2,
  };
}
