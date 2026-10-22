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
 * 2つの日付の暦日差を返す。同日は 0。算定日数（初日算入）そのものではない。
 * ローカル日付の 0:00 同士で引くため、JST と UTC の 9 時間差は入らない。
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
 * 起算日当日を 1 日目とする経過日数（診療報酬の初日算入）。
 * 同日は 1。起算日の前日は 0。
 * @param {string|Date} fromDate 起算日
 * @param {string|Date} toDate 判定日
 * @returns {number|null}
 */
export function getInclusiveDayCount(fromDate, toDate) {
  const diff = getDiffDays(fromDate, toDate);
  if (diff === null) return null;
  return diff + 1;
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
 * 起算日（転院患者は前医入院日、直接入院は当院入院日）当日を 1 日目とする
 * 1〜3日目: 60点, 4〜14日目: 25点, 15日目以降: なし
 * 告示は「起算日から4日目以降は25点」「14日を限度」。旧30日限度は令和8年度で廃止。
 * @param {string|Date} admissionOrStart 早期起算日
 * @param {string|Date} sessionDate 実施日
 * @param {string} category 患者区分 (INPATIENT | OUTPATIENT)
 * @returns {Object}
 */
export function evaluateEarlyBonusPhase(admissionOrStart, sessionDate, category = 'INPATIENT') {
  if (category !== 'INPATIENT') {
    return { phase: null, points: 0, label: '外来対象外', isEligible: false, endDateStr: '', remainingDays: null, shortLabel: '' };
  }
  const dayCount = getInclusiveDayCount(admissionOrStart, sessionDate);
  if (dayCount === null || dayCount < 1) {
    return { phase: null, points: 0, label: '対象外', isEligible: false, endDateStr: '', remainingDays: null, shortLabel: '' };
  }
  const maxAllowedDays = REHA_RULES.EARLY_BONUS.PHASE_2.maxDays;
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
  let elapsedDays = null;
  let isLimitExceeded = false;

  if (startDateStr && disease.days < 9000) {
    // 満了日 = 起算日 + (標準日数 - 1)。起算日が1日目、標準日数日目が最終算定日。
    // 翌日（標準日数 + 1 日目）から期限超過（月13単位）。
    limitDateStr = addDays(startDateStr, disease.days - 1);
    elapsedDays = getInclusiveDayCount(startDateStr, baseDate);
    if (elapsedDays !== null) {
      isLimitExceeded = elapsedDays > disease.days;
      remainingDays = disease.days - elapsedDays;
    }
  }

  const earlyBonus = evaluateEarlyBonusPhase(earlyStartStr, baseDate, patient?.category);

  let plan2TransitionDateStr = '';
  let plan2RemainingDays = null;
  let isPlan2Required = false;

  if (patient?.careInsuranceType === 'CARE' && startDateStr && disease.oneThirdDays < 9000) {
    // 「3分の1を超えた」翌日が移行日。50日なら起算日から数えて51日目 = 起算日+50日。
    plan2TransitionDateStr = addDays(startDateStr, disease.oneThirdDays);
    const diffToPlan2 = getDiffDays(baseDate, plan2TransitionDateStr);
    plan2RemainingDays = diffToPlan2 !== null ? diffToPlan2 : null;
    isPlan2Required = plan2RemainingDays !== null && plan2RemainingDays <= 0;
  }

  // 単価は実施日（baseDate）単位で判定。月一括の一律掛けはしない。
  const rate = getDailyBasePoints(patient, baseDate);
  const isCareInsured = rate.isCareInsured;
  const isMaintenanceReduction = rate.isCareReduced;
  const currentBasePoints = rate.points;

  return {
    diseaseLabel: disease.shortLabel,
    diseaseFullName: disease.fullName,
    standardDays: disease.days,
    startDateStr,
    elapsedDays,
    limitDateStr,
    remainingDays,
    isLimitExceeded,
    earlyBonus,
    isCareInsured,
    isMaintenanceReduction,
    currentBasePoints,
    careInsuranceType: patient?.careInsuranceType || 'NONE',
    plan2TransitionDateStr,
    plan2RemainingDays,
    isPlan2Required,
    dailyRateReason: rate.reason
  };
}

/**
 * 特定の実施日におけるリハビリ1単位あたりの算定点数を厳密取得する。
 * 満了日当日（第N日）までは正規点数、翌日（第N+1日）から維持期判定へ切り替える。
 * 医療保険のみ（NONE）は超過後も所定点数のまま。要介護・要支援のみ maintPoints を適用する。
 * @param {Object} patient
 * @param {string|Date} sessionDateStr
 * @returns {{ points: number, isMaintenance: boolean, isCareReduced: boolean, isCareInsured: boolean, reason: string }}
 */
export function getDailyBasePoints(patient, sessionDateStr) {
  const disease = REHA_RULES.LIMIT_DAYS[patient?.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
  const isCareInsured = patient?.careInsuranceType === 'CARE' || patient?.careInsuranceType === 'SUPPORT';

  if (!patient || patient.diseaseType === 'ANALGESIA' || disease.days >= 9000) {
    return {
      points: disease.defaultPoints,
      isMaintenance: false,
      isCareReduced: false,
      isCareInsured,
      reason: 'REGULAR'
    };
  }

  const force13 = patient.force13Limit === true || patient.force13UnitsLimit === true;
  if (force13 && isCareInsured) {
    return {
      points: disease.maintPoints,
      isMaintenance: true,
      isCareReduced: true,
      isCareInsured,
      reason: 'FORCE_CARE_MAINTENANCE'
    };
  }

  const startDateStr = normalizeDateString(patient.onsetDate || patient.admissionDate || '');
  if (!startDateStr) {
    return {
      points: disease.defaultPoints,
      isMaintenance: false,
      isCareReduced: false,
      isCareInsured,
      reason: 'NO_START_DATE'
    };
  }

  const elapsedDays = getInclusiveDayCount(startDateStr, sessionDateStr);
  // 標準算定日数以内（満了日当日を含む）: 誰でも正規満額
  if (elapsedDays === null || elapsedDays <= disease.days) {
    return {
      points: disease.defaultPoints,
      isMaintenance: false,
      isCareReduced: false,
      isCareInsured,
      reason: 'WITHIN_STANDARD_DAYS'
    };
  }

  // 標準算定日数超過後（満了日の翌日以降）
  if (!isCareInsured) {
    return {
      points: disease.defaultPoints,
      isMaintenance: true,
      isCareReduced: false,
      isCareInsured,
      reason: 'MEDICAL_ONLY_EXPIRED'
    };
  }

  return {
    points: disease.maintPoints,
    isMaintenance: true,
    isCareReduced: true,
    isCareInsured,
    reason: 'CARE_MAINTENANCE_REDUCED'
  };
}

/**
 * リハ総合計画評価料（4区分）の推奨選択肢を自動判定する純粋関数
 * 患者マスターの planStatus（計画書2継続中固定など）を最優先に評価する
 * @param {Object} patient 患者マスター情報
 * @param {string} targetDateStr 算定対象日 (YYYY-MM-DD)
 * @param {boolean} hasPastPlan 過去（対象日より前）に算定実績があるか
 * @returns {{ recommendedPlan: string, label: string, points: number, reason: string }}
 */
export function evaluateRecommendedPlan(patient, targetDateStr, hasPastPlan = false) {
  if (!patient || patient.diseaseType === 'ANALGESIA') {
    return { recommendedPlan: '', label: 'なし (算定しない)', points: 0, reason: '物療または患者未選択' };
  }

  // A: 患者マスターで「計画書2継続中」が指定されている場合は、無条件で196点固定
  if (patient.planStatus === 'PLAN_2_FOLLOW') {
    return {
      recommendedPlan: 'PLAN_2_FOLLOW',
      label: '総合実施計画書2 (2回目以降: 196点)',
      points: REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW,
      reason: '患者台帳: 計画書2継続中 (196点固定)'
    };
  }

  const deadlines = calculatePatientDeadlines(patient, targetDateStr);
  const isPlan2 = deadlines.isPlan2Required;

  // B: 患者マスターで「計画書1継続中」が指定されている場合
  if (patient.planStatus === 'PLAN_1_FOLLOW') {
    if (isPlan2) {
      return {
        recommendedPlan: 'PLAN_2_FOLLOW',
        label: '総合実施計画書2 (2回目以降: 196点)',
        points: REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW,
        reason: '計画書2への移行日到達 (2回目以降)'
      };
    }
    return {
      recommendedPlan: 'PLAN_1_FOLLOW',
      label: '総合実施計画書1 (2回目以降: 240点)',
      points: REHA_RULES.PLAN_POINTS.PLAN_1_FOLLOW,
      reason: '患者台帳: 計画書1継続中 (2回目以降)'
    };
  }

  // C: 未算定（初回対象）または未設定の場合
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

function sumUnits(dailyUnitsMap) {
  return Object.values(dailyUnitsMap || {}).reduce((sum, units) => sum + (Number(units) || 0), 0);
}

/**
 * 対象月の実施が月13単位制限を超えるかを、期限満了日の翌日から数えて判定する。
 * 要介護・要支援だけでは制限しない。標準算定日数の満了後、または個別の13単位指定があるときだけ対象。
 * @param {Object} patient
 * @param {number} year
 * @param {number} month 1〜12
 * @param {Object|number[]} dailyUnitsMap 日別単位。キーは日（1〜31）
 * @returns {{ isOver13: boolean, applicableUnits: number, reason: string }}
 */
export function checkMonth13UnitsViolation(patient, year, month, dailyUnitsMap = {}) {
  const force13 = patient?.force13Limit === true || patient?.force13UnitsLimit === true;
  if (force13) {
    const totalMonthUnits = sumUnits(dailyUnitsMap);
    return {
      isOver13: totalMonthUnits > 13,
      applicableUnits: totalMonthUnits,
      reason: 'FORCE_13_LIMIT'
    };
  }

  const onsetStr = normalizeDateString(patient?.onsetDate);
  if (!patient || patient.diseaseType === 'ANALGESIA' || !onsetStr) {
    return { isOver13: false, applicableUnits: 0, reason: 'NOT_APPLICABLE' };
  }

  const rule = REHA_RULES.LIMIT_DAYS[patient.diseaseType];
  if (!rule || !rule.days || rule.days >= 9000) {
    return { isOver13: false, applicableUnits: 0, reason: 'NO_LIMIT_RULE' };
  }

  const deadlineStr = addDays(onsetStr, rule.days - 1);
  if (!deadlineStr) {
    return { isOver13: false, applicableUnits: 0, reason: 'NOT_APPLICABLE' };
  }

  const y = Number(year);
  const m = Number(month);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStartStr = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEndStr = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  if (deadlineStr < monthStartStr) {
    const totalMonthUnits = sumUnits(dailyUnitsMap);
    return {
      isOver13: totalMonthUnits > 13,
      applicableUnits: totalMonthUnits,
      reason: 'EXPIRED_BEFORE_MONTH'
    };
  }

  if (deadlineStr >= monthStartStr && deadlineStr < monthEndStr) {
    const deadlineDay = Number(deadlineStr.slice(8, 10));
    let postDeadlineUnits = 0;
    for (let day = deadlineDay + 1; day <= daysInMonth; day += 1) {
      postDeadlineUnits += Number(dailyUnitsMap[day]) || 0;
    }
    return {
      isOver13: postDeadlineUnits > 13,
      applicableUnits: postDeadlineUnits,
      reason: 'EXPIRED_DURING_MONTH'
    };
  }

  return { isOver13: false, applicableUnits: 0, reason: 'WITHIN_LIMIT' };
}
