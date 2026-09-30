/**
 * @file deadlineCalc.js
 * @description リハビリテーション期限・早期加算・総合実施計画書期限 計算エンジン
 * 
 * 画面UIやExcel読み書きロジックには依存せず、純粋な日付計算・判定のみを担当します。
 * 単体テストが容易で、制度改定時は rules.js の値に準拠して自動的に計算結果が更新されます。
 */

import { REHA_RULES } from '../config/rules.js';

/**
 * 日付オブジェクトまたは文字列を標準Dateオブジェクト（時刻00:00:00）に変換
 * @param {string|Date|number} input - 日付文字列、Dateオブジェクト、Excelシリアル値
 * @returns {Date|null}
 */
export function normalizeDate(input) {
  if (!input) return null;

  let d;
  if (typeof input === 'number') {
    // Excelの日付シリアル値（1900年起算）対応
    // 25569 = 1970/1/1 - 1900/1/1 の日数差
    d = new Date(Math.round((input - 25569) * 86400 * 1000));
  } else if (input instanceof Date) {
    d = new Date(input.getTime());
  } else if (typeof input === 'string') {
    // YYYY-MM-DD または YYYY/MM/DD のパース
    const cleanStr = input.trim().replace(/\//g, '-');
    d = new Date(cleanStr);
  } else {
    return null;
  }

  if (isNaN(d.getTime())) return null;

  // 時刻を00:00:00にリセットして日付の純粋比較を保証
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 指定日数（正・負）を加算した新しいDateオブジェクトを返却
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
 * 2つの日付の日数差を計算（start日を含めない経過日数、または包括計算）
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
 * @param {Date|string} admissionDate - 入院日（早期加算の起算日）
 * @param {Date|string} sessionDate - リハビリ実施日
 * @returns {'PHASE_1'|'PHASE_2'|null} 対象の加算区分
 */
export function evaluateEarlyBonusPhase(admissionDate, sessionDate) {
  const adminDate = normalizeDate(admissionDate);
  const session = normalizeDate(sessionDate);

  if (!adminDate || !session) return null;

  // 入院日より前の実施は対象外
  if (session < adminDate) return null;

  // 入院日当日を1日目とする経過日数
  const elapsedDays = getDiffDays(adminDate, session) + 1;

  const phase1Max = REHA_RULES.EARLY_BONUS.PHASE_1.maxDays; // 4日
  const phase2Max = REHA_RULES.EARLY_BONUS.PHASE_2.maxDays; // 14日

  if (elapsedDays <= phase1Max) {
    return 'PHASE_1';
  } else if (elapsedDays <= phase2Max) {
    return 'PHASE_2';
  }

  return null; // 15日目以降は加算終了
}

/**
 * 患者ごとの各種期限（リハ上限・早期加算期限・計画書次回期限・月13単位管理）を一括計算
 * 
 * @param {Object} patient - 患者情報
 * @param {string} patient.id - 患者識別記号 (例: 'a')
 * @param {string|Date} patient.admissionDate - 入院日（当院入院日）
 * @param {string|Date} [patient.earlyBonusStartDate] - 早期加算の起算日（転院患者は前医入院日。未設定時は当院入院日）
 * @param {string|Date} [patient.onsetDate] - 発症日/手術日/急性増悪日（疾患別上限の起算日。未設定時は入院日を使用）
 * @param {string} [patient.diseaseType='LOCOMOTIVE'] - 疾患区分キー
 * @param {string|Date} [patient.lastPlanDate] - 前回総合実施計画書算定日
 * @param {number} [patient.currentMonthUnits=0] - 当月の実施単位合計
 * @param {boolean} [patient.isLimitExempt=false] - 算定日数上限の除外対象（継続的改善等で13単位上限なし）か否か
 * @param {Date|string} [baseDate=new Date()] - 計算基準日
 * @returns {Object} 算定された期限情報とアラートステータス
 */
export function calculatePatientDeadlines(patient, baseDate = new Date()) {
  const today = normalizeDate(baseDate) || new Date();
  
  // 当院入院日
  const adminDate = normalizeDate(patient.admissionDate);
  // 早期加算の起算日（転院患者の前医入院日。未指定時は当院入院日）
  const earlyStart = normalizeDate(patient.earlyBonusStartDate) || adminDate;
  // 発症日/起算日（疾患別上限の起算日：未入力時は当院入院日を使用）
  const onset = normalizeDate(patient.onsetDate) || adminDate;

  if (!adminDate && !onset && !earlyStart) {
    return {
      isValid: false,
      error: '入院日、早期加算起算日、または発症日（起算日）が設定されていません。',
    };
  }

  // 1. 早期加算 期限日計算（転院起算日または入院日ベース）
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

  // 2. 疾患別標準算定上限日数・上限日（発症日ベース）
  const diseaseConfig = REHA_RULES.LIMIT_DAYS[patient.diseaseType] || REHA_RULES.LIMIT_DAYS.LOCOMOTIVE;
  const limitDays = diseaseConfig.days;
  const rehaLimitDate = (onset && limitDays < 9999) ? addDays(onset, limitDays - 1) : null;
  const remainingRehaDays = rehaLimitDate ? getDiffDays(today, rehaLimitDate) : 9999;
  const isOverLimit = rehaLimitDate ? (remainingRehaDays < 0) : false;

  // 3. 総合実施計画書 次回作成期限
  const planRefDate = normalizeDate(patient.lastPlanDate) || adminDate || onset;
  const nextPlanLimit = addDays(planRefDate, REHA_RULES.PLAN_EVALUATION.CYCLE_DAYS);
  const remainingPlanDays = getDiffDays(today, nextPlanLimit);

  // 4. 月13単位制限チェック（算定上限超過時）
  const currentUnits = patient.currentMonthUnits || 0;
  const monthlyMaxUnits = 13;
  let unitAlertStatus = 'OK';
  if (isOverLimit && !patient.isLimitExempt) {
    if (currentUnits > monthlyMaxUnits) {
      unitAlertStatus = 'EXCEEDED'; // 13単位オーバー
    } else if (currentUnits >= monthlyMaxUnits - 2) {
      unitAlertStatus = 'NEAR_LIMIT'; // 残りわずか
    }
  }

  // アラート集約
  const alerts = [];

  // (a) 早期加算
  if (earlyBonusStatus === 'PHASE_1_ACTIVE') {
    alerts.push({ type: 'info', code: 'EARLY_P1', label: '早期加算（4日以内）対象期間中' });
  } else if (earlyBonusStatus === 'PHASE_2_ACTIVE') {
    alerts.push({ type: 'info', code: 'EARLY_P2', label: '早期加算（14日以内）対象期間中' });
  }

  // (b) リハビリ算定日数上限 & 月13単位
  let rehaLimitStatus = 'SAFE';
  if (isOverLimit) {
    if (patient.isLimitExempt) {
      rehaLimitStatus = 'EXEMPT';
      alerts.push({ type: 'info', code: 'LIMIT_EXEMPT', label: `算定上限超（除外規定適用中）` });
    } else {
      rehaLimitStatus = 'MONTHLY_13_MODE';
      alerts.push({ 
        type: unitAlertStatus === 'EXCEEDED' ? 'danger' : 'warning', 
        code: 'OVER_LIMIT_13', 
        label: `算定上限経過：月13単位制限中（当月 ${currentUnits}/${monthlyMaxUnits} 単位）` 
      });
    }
  } else if (rehaLimitDate && remainingRehaDays <= 14) {
    rehaLimitStatus = 'WARNING';
    alerts.push({ type: 'warning', code: 'LIMIT_APPROACHING', label: `算定上限まで残り ${remainingRehaDays} 日` });
  }

  // (c) 計画書期限アラート
  let planStatus = 'SAFE';
  if (remainingPlanDays < 0) {
    planStatus = 'EXPIRED';
    alerts.push({ type: 'danger', code: 'PLAN_OVERDUE', label: `計画書期限を経過（${Math.abs(remainingPlanDays)}日超過）` });
  } else if (remainingPlanDays <= REHA_RULES.PLAN_EVALUATION.ALERT_BEFORE_DAYS) {
    planStatus = 'WARNING';
    alerts.push({ type: 'warning', code: 'PLAN_DUE_SOON', label: `計画書作成期限が迫っています（残 ${remainingPlanDays} 日）` });
  }

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
    // リハ上限 & 13単位
    rehaLimitDays: limitDays,
    rehaLimitDate,
    rehaLimitDateStr: formatDate(rehaLimitDate),
    remainingRehaDays,
    isOverLimit,
    rehaLimitStatus,
    currentUnits,
    monthlyMaxUnits,
    unitAlertStatus,
    // 計画書
    lastPlanDateStr: formatDate(planRefDate),
    nextPlanLimitDate: nextPlanLimit,
    nextPlanLimitStr: formatDate(nextPlanLimit),
    remainingPlanDays,
    planStatus,
    // 集約アラート
    alerts,
  };
}

/**
 * 1か月分のリハビリ実施履歴から、早期加算（4日以内/14日以内）の該当回数を自動集計
 * @param {Date|string} admissionDate - 入院日（早期加算の起算日）
 * @param {Array<{date: Date|string, units: number}>} sessionList - その月の実施日一覧
 * @returns {{ phase1Sessions: number, phase2Sessions: number, normalSessions: number }}
 */
export function aggregateMonthlyEarlyBonus(admissionDate, sessionList = []) {
  let phase1Sessions = 0;
  let phase2Sessions = 0;
  let normalSessions = 0;

  sessionList.forEach((session) => {
    if (!session.units || session.units <= 0) return;
    const phase = evaluateEarlyBonusPhase(admissionDate, session.date);
    if (phase === 'PHASE_1') {
      phase1Sessions += 1;
    } else if (phase === 'PHASE_2') {
      phase2Sessions += 1;
    } else {
      normalSessions += 1;
    }
  });

  return {
    phase1Sessions,
    phase2Sessions,
    normalSessions,
  };
}
