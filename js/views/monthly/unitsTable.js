// js/views/monthly/unitsTable.js
// 月間単位表（退院予定日バッジ・退院翌日以降セルのグレーアウト・臨床クイックフィルター・担当セラピスト順ソート対応）

import { REHA_RULES } from '../../config/rules.js';
import { sanitizeHtml, normalizeToKatakana } from '../../core/dataNormalizer.js';
import { calculatePatientDeadlines, checkMonth13UnitsViolation } from '../../core/deadlineCalc.js';
import { getTherapistRole } from '../../core/therapistRoleUtil.js';
import { getAllTherapists, getTherapistById } from '../../store/therapistStore.js';
import {
  monthlyState,
  MONTHLY_QUICK_FILTERS,
  MONTHLY_FILTER_THERAPIST_PREFIX,
  buildMonthlyFilterSelectValue,
} from './monthlyState.js';
import { printPatientMonthlyReport } from '../../print/patientMonthlyReportPrint.js';
import { showToast } from '../../ui/toast.js';

const ROLE_SORT_ORDER = Object.freeze({ PT: 1, OT: 2, ST: 3 });

/**
 * 患者の当月実施回数（日数）と総単位を集計
 * （単位 > 0 の日を「実施1回」としてカウント）
 * @param {Record<number, number>|Array<number>|null|undefined} dailyUnitsMap
 * @returns {{ totalUnits: number, sessionDays: number }}
 */
export function aggregatePatientMonthlyStats(dailyUnitsMap) {
  let totalUnits = 0;
  let sessionDays = 0;
  for (let day = 1; day <= 31; day += 1) {
    const units = Number(dailyUnitsMap?.[day] || 0);
    if (units > 0) {
      totalUnits += units;
      sessionDays += 1;
    }
  }
  return { totalUnits, sessionDays };
}

/**
 * 疾患区分の短ラベル／バッジ用クラス（廃用は高視認）
 * @param {object} patient
 * @returns {{ label: string, className: string, isDisuse: boolean }}
 */
export function resolveDiseaseDisplay(patient) {
  const type = String(patient?.diseaseType || '').toUpperCase();
  if (type === 'DISUSE') {
    return { label: '廃用', className: 'disease-tag disease-tag-disuse', isDisuse: true };
  }
  if (type === 'CEREBROVASCULAR') {
    return { label: '脳血管', className: 'disease-tag disease-tag-cerebro', isDisuse: false };
  }
  if (type === 'LOCOMOTIVE') {
    return { label: '運動器', className: 'disease-tag disease-tag-loco', isDisuse: false };
  }
  if (type === 'ANALGESIA') {
    return { label: '消炎', className: 'disease-tag disease-tag-analg', isDisuse: false };
  }
  if (type === 'CARDIOVASCULAR' || type === 'CARDIAC') {
    return { label: '心大血管', className: 'disease-tag disease-tag-cardio', isDisuse: false };
  }
  if (type === 'RESPIRATORY') {
    return { label: '呼吸器', className: 'disease-tag disease-tag-resp', isDisuse: false };
  }
  if (type === 'CANCER') {
    return { label: 'がん', className: 'disease-tag', isDisuse: false };
  }
  const rule = REHA_RULES.LIMIT_DAYS?.[patient?.diseaseType];
  if (rule?.shortLabel) {
    const short = String(rule.shortLabel).replace(/[ⅠⅡⅢIVⅠ-Ⅲ]/g, '').trim() || rule.tag || '他';
    return { label: short, className: 'disease-tag', isDisuse: false };
  }
  return { label: '—', className: 'disease-tag disease-tag-unknown', isDisuse: false };
}

/**
 * 疾患バッジHTML
 * @param {object} patient
 * @returns {string}
 */
export function buildDiseaseBadgeHtml(patient) {
  const d = resolveDiseaseDisplay(patient);
  const title = sanitizeHtml(
    patient?.diseaseName || patient?.disease || REHA_RULES.LIMIT_DAYS?.[patient?.diseaseType]?.fullName || d.label
  );
  return `<span class="${d.className}" title="${title}">${sanitizeHtml(d.label)}</span>`;
}

/**
 * 患者の担当セラピストIDを解決する
 * 優先: 患者マスター主担当 → 当月スロットで最多単位のセラピスト
 * @param {object} item aggregate patientMap entry
 * @returns {string}
 */
export function resolvePrimaryTherapistId(item) {
  const p = item?.patient || {};
  const masterId = String(
    p.mainTherapistId || p.assignedTherapistId || p.primaryTherapistId || p.therapistId || ''
  ).trim();
  if (masterId && masterId !== 'NONE' && masterId !== 'ANALGESIA' && masterId.toUpperCase() !== 'NONE') {
    return masterId;
  }

  /** @type {Record<string, number>} */
  const unitsByTherapist = {};
  (item?.slots || []).forEach((s) => {
    if (!s || s.isAnalgesia) return;
    const tid = String(s.therapist || s.therapistId || '').trim();
    if (!tid || tid === 'NONE' || tid === 'ANALGESIA') return;
    const u = Number(s.units) || 0;
    if (u <= 0) return;
    unitsByTherapist[tid] = (unitsByTherapist[tid] || 0) + u;
  });

  let bestId = '';
  let bestUnits = -1;
  Object.entries(unitsByTherapist).forEach(([tid, units]) => {
    if (units > bestUnits) {
      bestUnits = units;
      bestId = tid;
      return;
    }
    if (units === bestUnits && bestId) {
      // 同単位は ID 昇順で安定化
      if (tid.localeCompare(bestId, undefined, { numeric: true }) < 0) {
        bestId = tid;
      }
    }
  });
  return bestId;
}

/**
 * 当月スロットに指定セラピストの実施が含まれるか
 * @param {object} item
 * @param {string} therapistId
 * @returns {boolean}
 */
function patientHasTherapistSlots(item, therapistId) {
  const tid = String(therapistId || '').trim();
  if (!tid) return false;
  return (item?.slots || []).some((s) => {
    if (!s || s.isAnalgesia) return false;
    const sid = String(s.therapist || s.therapistId || '').trim();
    return sid === tid;
  });
}

/**
 * 特定セラピストに絞り込まれた際の当人単位集計（患者1名分）
 * @param {object} item aggregate patientMap entry
 * @param {string} selectedTherapistId
 * @returns {{ totalUnits: number, dailyUnits: Record<number, number>, earlyUnits: number, planCount: number, diseaseUnits: number }|null}
 */
export function calculateTherapistSpecificUnits(item, selectedTherapistId) {
  const tid = String(selectedTherapistId || '').trim();
  if (!tid || tid === 'ALL') return null;

  let therapistUnits = 0;
  let earlyUnits = 0;
  let planCount = 0;
  /** @type {Record<number, number>} */
  const therapistDaily = {};

  (item?.slots || []).forEach((slot) => {
    if (!slot || slot.isAnalgesia) return;
    const slotTid = String(slot.therapist || slot.therapistId || '').trim();
    if (slotTid !== tid) return;

    const u = Number(slot.units || slot.unit || 0);
    if (u <= 0) return;

    therapistUnits += u;
    const day = Number(String(slot.date || '').slice(8, 10));
    if (day >= 1 && day <= 31) {
      therapistDaily[day] = (therapistDaily[day] || 0) + u;
      // その日に早期加算実績がある場合、当人実施単位を加算側に計上
      const dayEarly = Number(item?.dailyEarlyUnits?.[day] || 0);
      if (dayEarly > 0) earlyUnits += u;
    }
    if (slot.billingPlan) planCount += 1;
  });

  return {
    totalUnits: therapistUnits,
    dailyUnits: therapistDaily,
    earlyUnits,
    planCount,
    diseaseUnits: therapistUnits, // 個別リハ（消炎スロット除外済み）
  };
}

/**
 * 表示中患者群に対するセラピスト個人サマリーを集計
 * @param {object[]} patients
 * @param {string} selectedTherapistId
 * @returns {{ patientCount: number, totalUnits: number, diseaseUnits: number, earlyUnits: number, planCount: number }}
 */
export function aggregateTherapistPersonalSummary(patients, selectedTherapistId) {
  const summary = {
    patientCount: 0,
    totalUnits: 0,
    diseaseUnits: 0,
    earlyUnits: 0,
    planCount: 0,
  };
  const tid = String(selectedTherapistId || '').trim();
  if (!tid) return summary;

  (patients || []).forEach((item) => {
    const specific = calculateTherapistSpecificUnits(item, tid);
    if (!specific || specific.totalUnits <= 0) return;
    summary.patientCount += 1;
    summary.totalUnits += specific.totalUnits;
    summary.diseaseUnits += specific.diseaseUnits;
    summary.earlyUnits += specific.earlyUnits;
    summary.planCount += specific.planCount;
  });
  return summary;
}

/**
 * セラピスト個人サマリーバーの表示／非表示
 * @param {string} therapistFilterId
 * @param {object[]} patients
 */
export function syncMonthlyTherapistSummaryBar(therapistFilterId, patients) {
  const bar = document.getElementById('monthlyTherapistSummaryBar');
  if (!bar) return;

  const tid = String(therapistFilterId || '').trim();
  if (!tid || tid === 'ALL') {
    bar.classList.remove('is-visible');
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  const t = getTherapistById(tid);
  const role = getTherapistRole(tid, t?.name || '', getAllTherapists());
  const name = t?.name || tid;
  const summary = aggregateTherapistPersonalSummary(patients, tid);

  bar.innerHTML = `
    <span class="mts-title">【👤 ${sanitizeHtml(role)} ${sanitizeHtml(name)} 療法士 の当月実績】</span>
    担当患者: <span class="mts-num">${summary.patientCount}</span> 名
    <span class="mts-sep">｜</span>
    個人取得単位: <span class="mts-num">${summary.totalUnits}</span> 単位
    <span style="font-weight:600; color:#0369a1;">
      (疾患別: ${summary.diseaseUnits} / 加算: ${summary.earlyUnits} / 計画書: ${summary.planCount}件)
    </span>
  `;
  bar.classList.add('is-visible');
  bar.style.display = 'block';
}

/**
 * セラピスト名・職種に基づく患者ソート
 * @param {object[]} patientRows
 * @param {boolean} [isAsc=true]
 * @param {Array} [therapistsMaster=[]]
 * @returns {object[]}
 */
export function sortPatientsByTherapist(patientRows, isAsc = true, therapistsMaster = []) {
  const master = Array.isArray(therapistsMaster) && therapistsMaster.length > 0
    ? therapistsMaster
    : getAllTherapists();
  const therapistMap = new Map(master.map((t) => [String(t.id), t]));

  return [...patientRows].sort((a, b) => {
    const tIdA = resolvePrimaryTherapistId(a);
    const tIdB = resolvePrimaryTherapistId(b);
    const tA = therapistMap.get(String(tIdA)) || (tIdA ? getTherapistById(tIdA) : null);
    const tB = therapistMap.get(String(tIdB)) || (tIdB ? getTherapistById(tIdB) : null);

    // 未設定は末尾
    if (!tIdA && tIdB) return 1;
    if (tIdA && !tIdB) return -1;
    if (!tIdA && !tIdB) {
      return (a.patient?.name || '').localeCompare(b.patient?.name || '', 'ja');
    }

    const roleA = getTherapistRole(tIdA, tA?.name || '', master);
    const roleB = getTherapistRole(tIdB, tB?.name || '', master);
    const rA = ROLE_SORT_ORDER[roleA] || 99;
    const rB = ROLE_SORT_ORDER[roleB] || 99;
    if (rA !== rB) {
      return isAsc ? (rA - rB) : (rB - rA);
    }

    const nameA = (tA?.name || tIdA || '');
    const nameB = (tB?.name || tIdB || '');
    const nameCmp = nameA.localeCompare(nameB, 'ja');
    if (nameCmp !== 0) {
      return isAsc ? nameCmp : -nameCmp;
    }

    // 同一セラピスト内は患者氏名順（昇順固定で視認性を安定）
    const patientCmp = (a.patient?.name || '').localeCompare(b.patient?.name || '', 'ja');
    if (patientCmp !== 0) return patientCmp;
    return String(a.patient?.id || '').localeCompare(String(b.patient?.id || ''), undefined, { numeric: true });
  });
}

/**
 * 絞り込みセレクトの担当セラピスト optgroup を同期し、件数ラベルも更新
 * @param {object[]} rawPatients
 * @param {Record<string, number>} [counts]
 */
export function syncMonthlyFilterSelect(rawPatients, counts = {}) {
  const select = document.getElementById('monthlyFilterSelect');
  if (!select) return;

  const therapists = getAllTherapists();
  const usedIds = new Set();
  (rawPatients || []).forEach((item) => {
    const primary = resolvePrimaryTherapistId(item);
    if (primary) usedIds.add(primary);
    (item?.slots || []).forEach((s) => {
      if (s?.isAnalgesia) return;
      const tid = String(s.therapist || s.therapistId || '').trim();
      if (tid && tid !== 'NONE' && tid !== 'ANALGESIA') usedIds.add(tid);
    });
  });

  // 固定オプションの件数をラベルへ反映
  const labelMap = {
    ALL: `絞り込み: 全員${counts.ALL != null ? ` (${counts.ALL})` : ''}`,
    inpatient: `入院患者のみ${counts.inpatient != null ? ` (${counts.inpatient})` : ''}`,
    outpatient: `外来患者のみ${counts.outpatient != null ? ` (${counts.outpatient})` : ''}`,
    disuse_all: `消炎鎮痛のみ${counts.disuse_all != null ? ` (${counts.disuse_all})` : ''}`,
    maint_all: `維持期 全員（月13単位）${counts.maint_all != null ? ` (${counts.maint_all})` : ''}`,
    maint_inpatient: `🏥 入院の維持期のみ${counts.maint_inpatient != null ? ` (${counts.maint_inpatient})` : ''}`,
    maint_outpatient: `🚶 外来の維持期のみ${counts.maint_outpatient != null ? ` (${counts.maint_outpatient})` : ''}`,
    uncalculated_plan: `⚠️ 計画書未算定のみ${counts.uncalculated_plan != null ? ` (${counts.uncalculated_plan})` : ''}`,
  };
  [...select.options].forEach((opt) => {
    if (Object.prototype.hasOwnProperty.call(labelMap, opt.value)) {
      opt.textContent = labelMap[opt.value];
    }
  });

  let og = document.getElementById('filterOptgroupTherapists');
  if (!og) {
    og = document.createElement('optgroup');
    og.id = 'filterOptgroupTherapists';
    og.label = '担当セラピスト';
    select.appendChild(og);
  }
  og.innerHTML = '';
  therapists
    .slice()
    .sort((a, b) => {
      const rA = ROLE_SORT_ORDER[getTherapistRole(a.id, a.name, therapists)] || 99;
      const rB = ROLE_SORT_ORDER[getTherapistRole(b.id, b.name, therapists)] || 99;
      if (rA !== rB) return rA - rB;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
    })
    .forEach((t) => {
      const role = getTherapistRole(t.id, t.name, therapists);
      const mark = usedIds.has(String(t.id)) ? '' : '（当月実績なし）';
      const opt = document.createElement('option');
      opt.value = `${MONTHLY_FILTER_THERAPIST_PREFIX}${t.id}`;
      opt.textContent = `${role} ${t.name || t.id}${mark}`;
      og.appendChild(opt);
    });

  const desired = buildMonthlyFilterSelectValue(monthlyState);
  if ([...select.options].some((o) => o.value === desired)) {
    select.value = desired;
  } else {
    select.value = MONTHLY_QUICK_FILTERS.ALL;
    monthlyState.quickFilter = MONTHLY_QUICK_FILTERS.ALL;
    monthlyState.therapistFilterId = '';
  }
}

/** @deprecated 互換エイリアス */
export function syncMonthlyTherapistFilterSelect(rawPatients) {
  syncMonthlyFilterSelect(rawPatients, countMonthlyQuickFilters(rawPatients || []));
}

/**
 * 疾患別ソート用ランク（運動器 → 脳血管 → 廃用 → その他個別 → 消炎 → 未設定）
 * diseaseType コードを最優先し、病名テキストからもフォールバック判定する。
 * @param {object} patient
 * @returns {number}
 */
function getDiseaseSortRank(patient) {
  const type = String(patient?.diseaseType || '').toUpperCase();
  if (type === 'LOCOMOTIVE') return 1;
  if (type === 'CEREBROVASCULAR') return 2;
  if (type === 'DISUSE') return 3;
  if (type === 'RESPIRATORY' || type === 'CARDIOVASCULAR' || type === 'CANCER') return 4;
  if (type === 'ANALGESIA') return 8;

  const text = (
    `${patient?.diseaseType || ''} ${patient?.disease || ''} ${patient?.diagnosis || ''} ${patient?.diseaseName || ''} ${patient?.diseaseLabel || ''}`
  ).toLowerCase();

  // 1. 運動器
  if (text.includes('運動') || text.includes('loco') || text.includes('ortho')) {
    return 1;
  }
  // 2. 脳血管等
  if (text.includes('脳') || text.includes('cerebro') || text.includes('neuro')) {
    return 2;
  }
  // 3. 廃用症候群
  if (text.includes('廃用') || text.includes('disuse')) {
    return 3;
  }
  // 4. 呼吸器・心大血管・がん等（その他個別リハ）
  if (text.includes('呼吸') || text.includes('心大') || text.includes('心大血管') || text.includes('がん') || text.includes('癌')) {
    return 4;
  }
  // 5. 消炎鎮痛のみ
  if (patient?.isInflammation || patient?.isInflammationOnly || text.includes('消炎') || text.includes('analges')) {
    return 8;
  }
  // 6. 未設定・その他
  return 9;
}

/**
 * 維持期13単位ソート用の適用単位（非対象は -1）
 * @param {object} item
 * @returns {{ units: number, over: boolean, subject: boolean }}
 */
function resolveMaint13SortMeta(item) {
  const p = item?.patient;
  if (!p || p.diseaseType === 'ANALGESIA') {
    return { units: -1, over: false, subject: false };
  }
  const daysInMonth = new Date(monthlyState.year, monthlyState.month, 0).getDate();
  const dailyUnitsMap = {};
  for (let day = 1; day <= daysInMonth; day += 1) {
    dailyUnitsMap[day] = item.dailyRehaUnits?.[day] || 0;
  }
  const violation = checkMonth13UnitsViolation(p, monthlyState.year, monthlyState.month, dailyUnitsMap);
  const subject = violation.reason === 'FORCE_13_LIMIT'
    || violation.reason === 'EXPIRED_BEFORE_MONTH'
    || violation.reason === 'EXPIRED_DURING_MONTH'
    || isMaintenanceTransitionTarget(item, monthlyState.year, monthlyState.month);
  if (!subject) return { units: -1, over: false, subject: false };
  return {
    units: Number(violation.applicableUnits) || 0,
    over: Boolean(violation.isOver13),
    subject: true,
  };
}

function sortPatients(patients, sortKey) {
  if (sortKey === 'THERAPIST_ASC' || sortKey === 'THERAPIST' || sortKey === 'therapist') {
    return sortPatientsByTherapist(patients, true, getAllTherapists());
  }
  if (sortKey === 'THERAPIST_DESC') {
    return sortPatientsByTherapist(patients, false, getAllTherapists());
  }

  return [...patients].sort((a, b) => {
    const pA = a.patient;
    const pB = b.patient;

    if (sortKey === 'KANA') {
      const kanaA = normalizeToKatakana(pA.nameKana || pA.name);
      const kanaB = normalizeToKatakana(pB.nameKana || pB.name);
      return kanaA.localeCompare(kanaB, 'ja');
    }

    if (sortKey === 'ID') {
      return (pA.id || '').localeCompare(pB.id || '', undefined, { numeric: true });
    }

    // 維持期13単位: 超過 → 適用単位多い順 → 非対象は末尾
    if (sortKey === 'MAINT13_DESC') {
      const mA = resolveMaint13SortMeta(a);
      const mB = resolveMaint13SortMeta(b);
      if (mA.subject !== mB.subject) return mA.subject ? -1 : 1;
      if (mA.over !== mB.over) return mA.over ? -1 : 1;
      if (mA.units !== mB.units) return mB.units - mA.units;
      return (pA.id || '').localeCompare(pB.id || '', undefined, { numeric: true });
    }

    // 疾患別 (運動器 → 脳血管 → 廃用 → その他 → 消炎)
    if (sortKey === 'DISEASE' || sortKey === 'disease') {
      const rankDiff = getDiseaseSortRank(pA) - getDiseaseSortRank(pB);
      if (rankDiff !== 0) return rankDiff;
      // 同疾患内は区分（入院→外来）→ ID で安定ソート
      const catA = pA.category === 'INPATIENT' ? 0 : 1;
      const catB = pB.category === 'INPATIENT' ? 0 : 1;
      if (catA !== catB) return catA - catB;
      return (pA.id || '').localeCompare(pB.id || '', undefined, { numeric: true });
    }

    // デフォルト: CATEGORY (入院 → 外来 → 消炎)
    const getCatScore = (p) => {
      if (p.diseaseType === 'ANALGESIA') return 3;
      if (p.category === 'INPATIENT') return 1;
      return 2;
    };
    const scoreDiff = getCatScore(pA) - getCatScore(pB);
    if (scoreDiff !== 0) return scoreDiff;
    return (pA.id || '').localeCompare(pB.id || '', undefined, { numeric: true });
  });
}

/**
 * 担当セラピスト絞り込み（当月に当該セラピストの実施スロットがある患者）
 * @param {object} item
 * @param {string} therapistFilterId
 * @returns {boolean}
 */
export function matchesTherapistFilter(item, therapistFilterId) {
  const tid = String(therapistFilterId || '').trim();
  if (!tid) return true;
  return patientHasTherapistSlots(item, tid);
}

/**
 * 対象月における退院日情報（未設定は null）
 * @param {Object} patient
 * @param {number} year
 * @param {number} month
 * @returns {{ day: number, dateStr: string, isPastOrToday: boolean, label: string }|null}
 */
function resolveDischargeInMonth(patient, year, month) {
  const dateStr = patient?.exitDate || patient?.plannedDischargeDate || patient?.discontinuedDate || patient?.endDate;
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (y !== Number(year) || mo !== Number(month)) return null;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isPastOrToday = todayStr >= dateStr;
  const md = `${mo}/${day}`;
  return {
    day,
    dateStr,
    isPastOrToday,
    label: isPastOrToday ? `[${md} 退院]` : `[${md} 退院予定]`
  };
}

/**
 * 維持期・要介護移行期・月13単位制限の管理対象か
 * （算定日数上限超過／当月満了による移行／個別13単位指定）
 * @param {object} item aggregate patientMap entry
 * @param {number} [year]
 * @param {number} [month]
 * @returns {boolean}
 */
export function isMaintenanceTransitionTarget(item, year = monthlyState.year, month = monthlyState.month) {
  const p = item?.patient;
  if (!p || p.diseaseType === 'ANALGESIA') return false;

  const rehaUnits = Number(item?.rehaTotalUnits || 0);
  const hasReha = Boolean(item?.hasRehaSlots) || rehaUnits >= 1;
  if (!hasReha) return false;

  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return false;

  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  if (p.force13Limit === true || p.force13UnitsLimit === true) {
    return true;
  }

  const dailyUnitsMap = {};
  for (let day = 1; day <= daysInMonth; day += 1) {
    dailyUnitsMap[day] = item.dailyRehaUnits?.[day] || 0;
  }
  const violation = checkMonth13UnitsViolation(p, y, m, dailyUnitsMap);
  if (
    violation.reason === 'FORCE_13_LIMIT'
    || violation.reason === 'EXPIRED_BEFORE_MONTH'
    || violation.reason === 'EXPIRED_DURING_MONTH'
  ) {
    return true;
  }

  // 当月末時点で期限超過、または当月内に満了日がある（移行期・月末満了含む）
  const deadlines = calculatePatientDeadlines(p, monthEnd);
  if (deadlines?.isLimitExceeded) return true;
  if (deadlines?.limitDateStr
    && deadlines.limitDateStr >= monthStart
    && deadlines.limitDateStr <= monthEnd) {
    return true;
  }

  return false;
}

/**
 * 集計エントリが絞り込み条件に合致するか
 * @param {object} item aggregate patientMap entry
 * @param {string} filterKey
 * @returns {boolean}
 */
export function matchesMonthlyQuickFilter(item, filterKey) {
  const p = item?.patient || {};
  const isOut = p.category === 'OUTPATIENT';
  const isIn = p.category === 'INPATIENT';
  const isAnalgesiaType = p.diseaseType === 'ANALGESIA';
  const rehaUnits = Number(item?.rehaTotalUnits || 0);
  const hasReha = Boolean(item?.hasRehaSlots) || rehaUnits >= 1;
  const hasAnalgesiaOnly = Boolean(item?.hasAnalgesiaSlots) && !hasReha;
  const isAnalgesia = isAnalgesiaType || hasAnalgesiaOnly;
  const planCount = Number(item?.planCount || 0);
  const isMaint = isMaintenanceTransitionTarget(item, monthlyState.year, monthlyState.month);
  const key = String(filterKey || MONTHLY_QUICK_FILTERS.ALL);

  switch (key) {
    case MONTHLY_QUICK_FILTERS.INPATIENT:
    case 'INPATIENT':
      return isIn;
    case MONTHLY_QUICK_FILTERS.OUTPATIENT:
    case 'OUTPATIENT':
      return isOut;
    case MONTHLY_QUICK_FILTERS.ANALGESIA:
      // 仕様値 disuse_all = 消炎鎮痛のみ
      return isAnalgesia;
    case MONTHLY_QUICK_FILTERS.MAINT_ALL:
    case MONTHLY_QUICK_FILTERS.MAINTENANCE:
      return isMaint;
    case MONTHLY_QUICK_FILTERS.MAINT_INPATIENT:
      return isMaint && isIn;
    case MONTHLY_QUICK_FILTERS.MAINT_OUTPATIENT:
      return isMaint && isOut;
    case MONTHLY_QUICK_FILTERS.PLAN_MISSING:
    case 'PLAN_MISSING':
      return hasReha && planCount === 0;
    case MONTHLY_QUICK_FILTERS.IN_DISEASE:
      return isIn && !isAnalgesia;
    case MONTHLY_QUICK_FILTERS.IN_ANALGESIA:
      return isIn && isAnalgesia;
    case MONTHLY_QUICK_FILTERS.OUT_DISEASE:
      return isOut && !isAnalgesia;
    case MONTHLY_QUICK_FILTERS.OUT_ANALGESIA:
      return isOut && isAnalgesia;
    case MONTHLY_QUICK_FILTERS.ALL:
    default:
      return true;
  }
}

/**
 * 各絞り込みの該当件数
 * @param {object[]} rawPatients
 * @returns {Record<string, number>}
 */
export function countMonthlyQuickFilters(rawPatients) {
  const list = rawPatients || [];
  const keys = [
    MONTHLY_QUICK_FILTERS.ALL,
    MONTHLY_QUICK_FILTERS.INPATIENT,
    MONTHLY_QUICK_FILTERS.OUTPATIENT,
    MONTHLY_QUICK_FILTERS.ANALGESIA,
    MONTHLY_QUICK_FILTERS.MAINT_ALL,
    MONTHLY_QUICK_FILTERS.MAINT_INPATIENT,
    MONTHLY_QUICK_FILTERS.MAINT_OUTPATIENT,
    MONTHLY_QUICK_FILTERS.PLAN_MISSING,
  ];
  /** @type {Record<string, number>} */
  const counts = {};
  keys.forEach((key) => {
    counts[key] = key === MONTHLY_QUICK_FILTERS.ALL
      ? list.length
      : list.filter((item) => matchesMonthlyQuickFilter(item, key)).length;
  });
  return counts;
}

/**
 * 表示件数バッジを同期
 * @param {Record<string, number>} counts
 * @param {number} [shownCount]
 */
export function syncMonthlyQuickFilterBar(counts, shownCount) {
  const shownEl = document.getElementById('currentShownCount');
  if (!shownEl) return;
  const active = monthlyState.therapistFilterId
    ? null
    : (monthlyState.quickFilter || MONTHLY_QUICK_FILTERS.ALL);
  const n = typeof shownCount === 'number'
    ? shownCount
    : (active ? (counts[active] ?? 0) : 0);
  shownEl.textContent = String(n);
}

/**
 * 月13単位メーターHTML（査定防止・視認性極大化）
 * @param {{ isOver13: boolean, applicableUnits: number, reason: string }} violation
 * @returns {{ html: string, rowClass: string, isSubject: boolean }}
 */
export function buildMaint13MeterHtml(violation) {
  const reason = String(violation?.reason || '');
  const isSubject = reason === 'FORCE_13_LIMIT'
    || reason === 'EXPIRED_BEFORE_MONTH'
    || reason === 'EXPIRED_DURING_MONTH';
  if (!isSubject) {
    return { html: '', rowClass: '', isSubject: false };
  }
  const units = Math.max(0, Number(violation.applicableUnits) || 0);
  const over = Boolean(violation.isOver13) || units > 13;
  const near = !over && units >= 11;
  const pct = Math.min(100, Math.round((units / 13) * 100));
  let tone = 'ok';
  if (over) tone = 'over';
  else if (near) tone = 'near';
  const warn = over ? '⚠️' : '';
  const title = over
    ? `月13単位制限超過: ${units}/13`
    : `維持期 月13単位進捗: ${units}/13`;
  const html = `
    <div class="maint13-meter maint13-${tone}" title="${sanitizeHtml(title)}">
      <div class="maint13-meter-top">
        <span class="maint13-label">維持13</span>
        <span class="maint13-frac">${units}<span class="maint13-den">/13</span>${warn}</span>
      </div>
      <div class="maint13-bar" aria-hidden="true"><i style="width:${pct}%;"></i></div>
    </div>`;
  const rowClass = over ? ' row-maint13-over' : (near ? ' row-maint13-near' : ' row-maint13');
  return { html, rowClass, isSubject: true };
}

/**
 * 画面と同じクイックフィルター・担当絞り込み・ソート済みの患者行を返す
 * （点検チェック印刷など外部出力用）
 * @param {object} aggregated
 * @returns {object[]}
 */
export function collectVisibleMonthlyPatients(aggregated) {
  if (!aggregated?.patientMap) return [];
  const rawPatients = Object.values(aggregated.patientMap);
  const filterKey = monthlyState.quickFilter || MONTHLY_QUICK_FILTERS.ALL;
  const therapistFilterId = String(monthlyState.therapistFilterId || '').trim();
  const filtered = rawPatients.filter((item) => (
    matchesMonthlyQuickFilter(item, filterKey)
    && matchesTherapistFilter(item, therapistFilterId)
  ));
  return sortPatients(filtered, monthlyState.sortKey);
}

export function renderMonthlyUnitsTable(aggregated) {
  const container = document.getElementById('monthlyTableContainer');
  if (!container) return;

  const { daysInMonth, patientMap } = aggregated;
  const rawPatients = Object.values(patientMap);
  const counts = countMonthlyQuickFilters(rawPatients);
  syncMonthlyFilterSelect(rawPatients, counts);

  if (rawPatients.length === 0) {
    syncMonthlyQuickFilterBar(counts, 0);
    syncMonthlyTherapistSummaryBar('', []);
    container.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.85rem;">対象月のデータはありません</div>';
    return;
  }

  const filterKey = monthlyState.quickFilter || MONTHLY_QUICK_FILTERS.ALL;
  const therapistFilterId = String(monthlyState.therapistFilterId || '').trim();
  const filtered = rawPatients.filter((item) => (
    matchesMonthlyQuickFilter(item, filterKey)
    && matchesTherapistFilter(item, therapistFilterId)
  ));
  const patients = sortPatients(filtered, monthlyState.sortKey);
  syncMonthlyQuickFilterBar(counts, patients.length);
  syncMonthlyTherapistSummaryBar(therapistFilterId, patients);
  const year = monthlyState.year;
  const month = monthlyState.month;
  const therapistFocus = Boolean(therapistFilterId);

  if (patients.length === 0) {
    const labels = {
      [MONTHLY_QUICK_FILTERS.INPATIENT]: '入院患者の該当はありません',
      [MONTHLY_QUICK_FILTERS.OUTPATIENT]: '外来患者の該当はありません',
      [MONTHLY_QUICK_FILTERS.ANALGESIA]: '消炎鎮痛の該当はありません',
      [MONTHLY_QUICK_FILTERS.MAINT_ALL]: '維持期（月13単位）対象の該当患者はいません',
      [MONTHLY_QUICK_FILTERS.MAINT_INPATIENT]: '入院の維持期対象はいません',
      [MONTHLY_QUICK_FILTERS.MAINT_OUTPATIENT]: '外来の維持期対象はいません',
      [MONTHLY_QUICK_FILTERS.PLAN_MISSING]: '計画書未算定の該当患者はいません（算定漏れなし）',
      [MONTHLY_QUICK_FILTERS.ALL]: '対象月のデータはありません',
    };
    let emptyMsg = labels[filterKey] || labels.ALL;
    if (therapistFilterId) {
      const t = getTherapistById(therapistFilterId);
      const tLabel = t ? `${getTherapistRole(t.id, t.name)} ${t.name}` : therapistFilterId;
      emptyMsg = `担当「${tLabel}」に該当する患者はいません`;
    }
    container.innerHTML = `<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.85rem;">${sanitizeHtml(emptyMsg)}</div>`;
    return;
  }

  const totalColWidth = therapistFocus ? '72px' : '56px';
  const totalColLabel = therapistFocus ? '当人/全体' : '当月計';

  let html = `
    <table class="modern-table table-monthly${therapistFocus ? ' table-monthly-therapist-focus' : ''}">
      <thead>
        <tr>
          <th class="col-fixed" style="width:128px;">氏名・疾患</th>
          <th style="width:24px;">区</th>
          <th style="width:34px;" title="リハビリ実施日数（単位&gt;0の日）">回数</th>
          <th style="width:${totalColWidth};" title="当月単位／維持期は月13単位メーター">${totalColLabel}</th>
          <th style="width:36px;">計画</th>
          <th style="width:48px;">提出</th>
  `;
  for (let d = 1; d <= daysInMonth; d++) {
    html += `<th>${d}</th>`;
  }
  html += `</tr></thead><tbody>`;

  patients.forEach((item) => {
    const p = item.patient;
    const isAnalgesia = p.diseaseType === 'ANALGESIA';
    const isOut = p.category === 'OUTPATIENT';
    const dischargeInfo = (!isOut && !isAnalgesia) ? resolveDischargeInMonth(p, year, month) : null;
    const specific = therapistFocus
      ? calculateTherapistSpecificUnits(item, therapistFilterId)
      : null;
    const diseaseBadge = buildDiseaseBadgeHtml(p);
    const diseaseMeta = resolveDiseaseDisplay(p);

    let catBadge = isOut
      ? '<span style="color:#2563eb; font-weight:700;">外</span>'
      : '<span style="color:#d97706; font-weight:700;">入</span>';
    if (isAnalgesia) {
      catBadge = '<span style="color:#16a34a; font-weight:700;">消</span>';
    }

    // 月13単位⚠️は介護保険の有無・点数減算と独立。医療保険のみでも期限超過後は警告対象。
    const dailyUnitsMap = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
      dailyUnitsMap[day] = item.dailyRehaUnits?.[day] || 0;
    }
    // 実施回数: セラピスト絞り込み時は当人日別、それ以外は患者全体の個別リハ日別
    const statsSource = (therapistFocus && specific)
      ? specific.dailyUnits
      : dailyUnitsMap;
    const monthlyStats = aggregatePatientMonthlyStats(statsSource);
    const sessionDays = monthlyStats.sessionDays;

    const violation = checkMonth13UnitsViolation(p, monthlyState.year, monthlyState.month, dailyUnitsMap);
    const maintMeter = buildMaint13MeterHtml(violation);
    const isNearLimit = maintMeter.isSubject
      && !violation.isOver13
      && violation.applicableUnits >= 11
      && violation.applicableUnits <= 13;

    let totalTitle = '';
    if (violation.reason === 'EXPIRED_DURING_MONTH') {
      totalTitle = `算定期限超過後(${violation.applicableUnits}単位)が月13単位制限対象`;
    } else if (violation.reason === 'EXPIRED_BEFORE_MONTH') {
      totalTitle = '算定期限超過患者のため月13単位制限対象';
    } else if (violation.reason === 'FORCE_13_LIMIT') {
      totalTitle = '個別13単位制限設定中';
    }

    const sessionTitle = `実施回数: ${sessionDays}回 / 総単位: ${monthlyStats.totalUnits}単位`;
    let totalBadge = `<strong title="${sanitizeHtml(sessionTitle)}">${item.totalUnits}</strong>`;
    if (therapistFocus && specific) {
      const ownU = specific.totalUnits;
      const allU = item.rehaTotalUnits || item.totalUnits || 0;
      const warnMark = violation.isOver13 ? '⚠️' : '';
      totalBadge = `
        <span class="total-therapist-own" title="${sanitizeHtml(totalTitle || `${sessionTitle}（当人 ${ownU} / 全体 ${allU}）`)}">当人:${ownU}${warnMark}</span>
        <span class="total-therapist-all">全体:${allU}</span>
        ${maintMeter.html}
      `;
    } else if (maintMeter.isSubject) {
      const toneClass = violation.isOver13 ? 'total-maint-over' : (isNearLimit ? 'total-maint-near' : 'total-maint-ok');
      totalBadge = `
        <div class="total-with-maint">
          <span class="${toneClass}" title="${sanitizeHtml(totalTitle || sessionTitle)}">${item.totalUnits}${violation.isOver13 ? '⚠️' : ''}</span>
          ${maintMeter.html}
        </div>
      `;
    }

    const planCountForBadge = (therapistFocus && specific)
      ? specific.planCount
      : item.planCount;
    const planBadge = planCountForBadge > 0
      ? `<span style="background:#e0f2fe; color:#0369a1; padding:1px 4px; border-radius:3px; font-weight:700;">${therapistFocus ? `${planCountForBadge}` : '済'}</span>`
      : '<span style="color:#cbd5e1;">-</span>';

    const hasEarly = therapistFocus && specific
      ? specific.earlyUnits > 0
      : item.totalEarlyUnits > 0;
    const earlyBadge = hasEarly
      ? `<span class="toggle-early-btn" style="cursor:pointer; margin-left:4px; font-size:0.65rem; background:#ede9fe; color:#7c3aed; padding:0 3px; border-radius:3px; font-weight:700;" title="早期加算内訳">早▼</span>`
      : '';

    const dischargeBadgeHtml = dischargeInfo
      ? `<span class="${dischargeInfo.isPastOrToday ? 'badge-monthly-discharged' : 'badge-monthly-discharge-planned'}" title="退院予定日: ${sanitizeHtml(dischargeInfo.dateStr)}">${sanitizeHtml(dischargeInfo.label)}</span>`
      : '';

    const sessionBadge = `
      <span class="session-days-badge" title="${sanitizeHtml(sessionTitle)}">${sessionDays}<span class="session-days-unit">回</span></span>
    `;

    html += `
      <tr class="${hasEarly ? 'row-has-early' : ''}${dischargeInfo ? ' row-has-discharge' : ''}${diseaseMeta.isDisuse ? ' row-disease-disuse' : ''}${maintMeter.rowClass}" data-target-id="early-${p.id}" style="${hasEarly ? 'cursor:pointer;' : ''}">
        <td class="col-fixed">
          <div class="monthly-name-cell">
            <strong class="monthly-patient-name">${sanitizeHtml(p.name)}</strong>${earlyBadge}
            ${diseaseBadge}
          </div>
          ${dischargeBadgeHtml ? `<div class="monthly-name-sub">${dischargeBadgeHtml}</div>` : ''}
        </td>
        <td>${catBadge}</td>
        <td class="col-session-days">${sessionBadge}</td>
        <td class="col-total-units">${totalBadge}</td>
        <td>${planBadge}</td>
        <td style="text-align:center; vertical-align:middle;">
          <button type="button" class="btn btn-xs btn-outline-primary btn-print-patient"
            data-patient-id="${sanitizeHtml(p.id)}"
            title="退院・医事課提出用A4印刷"
            style="padding:2px 5px; font-size:0.65rem; font-weight:800; border:1px solid #0284c7; background:#fff; color:#0369a1; border-radius:4px; cursor:pointer; white-space:nowrap;">
            🖨️
          </button>
        </td>
    `;
    for (let d = 1; d <= daysInMonth; d++) {
      const uAll = item.dailyUnits[d] || 0;
      const uOwn = specific ? (specific.dailyUnits[d] || 0) : 0;
      const isAfterDischarge = dischargeInfo && d > dischargeInfo.day;
      const isDischargeDay = dischargeInfo && d === dischargeInfo.day;
      let cellClass = '';
      if (isAfterDischarge) cellClass = 'cell-after-discharge';
      else if (isDischargeDay) cellClass = 'cell-discharge-day';

      if (therapistFocus) {
        if (isAfterDischarge) {
          html += `<td class="${cellClass}">${uOwn > 0 ? `<span class="unit-after-discharge">${uOwn}</span>` : '<span class="dash-after-discharge">-</span>'}</td>`;
        } else if (uOwn > 0) {
          const tip = uAll > uOwn ? `当人${uOwn} / 全体${uAll}` : `当人${uOwn}単位`;
          html += `<td class="${cellClass} cell-therapist-own" title="${tip}"><span class="unit-therapist-own">${uOwn}</span></td>`;
        } else if (uAll > 0) {
          html += `<td class="${cellClass}" title="他担当のみ: ${uAll}単位"><span class="unit-therapist-other">${uAll}</span></td>`;
        } else {
          html += `<td class="${cellClass}"><span style="color:#e2e8f0;">-</span></td>`;
        }
      } else if (isAfterDischarge) {
        html += `<td class="${cellClass}">${uAll > 0 ? `<span class="unit-after-discharge">${uAll}</span>` : '<span class="dash-after-discharge">-</span>'}</td>`;
      } else if (uAll > 0) {
        html += `<td class="${cellClass}"><span style="font-weight:700; color:${isAnalgesia ? '#16a34a' : '#0f172a'};">${uAll}</span></td>`;
      } else {
        html += `<td class="${cellClass}"><span style="color:#e2e8f0;">-</span></td>`;
      }
    }
    html += `</tr>`;

    if (hasEarly) {
      const earlyTotalShow = (therapistFocus && specific) ? specific.earlyUnits : item.totalEarlyUnits;
      html += `
        <tr id="early-${p.id}" class="sub-row-early" style="display:none;">
          <td class="col-fixed" style="font-size:0.72rem; color:#7c3aed; font-weight:700; padding-left:14px;">↳ 早</td>
          <td style="font-size:0.7rem; color:#7c3aed;">加</td>
          <td style="color:#cbd5e1;">-</td>
          <td style="font-weight:700; color:#7c3aed;">${earlyTotalShow}</td>
          <td style="color:#cbd5e1;">-</td>
          <td style="color:#cbd5e1;">-</td>
      `;
      for (let d = 1; d <= daysInMonth; d++) {
        const euAll = item.dailyEarlyUnits[d] || 0;
        const euOwn = (therapistFocus && specific && euAll > 0)
          ? (specific.dailyUnits[d] || 0)
          : euAll;
        const showEu = therapistFocus ? euOwn : euAll;
        const isAfterDischarge = dischargeInfo && d > dischargeInfo.day;
        const cellClass = isAfterDischarge ? 'cell-after-discharge' : '';
        html += `<td class="${cellClass}">${showEu > 0 ? `<span style="font-weight:700; color:#7c3aed;">${showEu}</span>` : '<span style="color:#e2e8f0;">-</span>'}</td>`;
      }
      html += `</tr>`;
    }
  });

  html += `</tbody></table>`;
  container.innerHTML = html;

  container.querySelectorAll('.row-has-early').forEach((row) => {
    row.addEventListener('click', () => {
      const targetId = row.dataset.targetId;
      const subRow = document.getElementById(targetId);
      const btn = row.querySelector('.toggle-early-btn');
      if (subRow) {
        const isHidden = subRow.style.display === 'none';
        subRow.style.display = isHidden ? 'table-row' : 'none';
        if (btn) btn.textContent = isHidden ? '早▲' : '早▼';
      }
    });
  });

  // 医事課提出用・患者個人月間実績 A4縦印刷
  container.querySelectorAll('.btn-print-patient').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = btn.getAttribute('data-patient-id');
      if (!pid) {
        showToast('患者IDが取得できません', 'warn');
        return;
      }
      printPatientMonthlyReport(
        pid,
        monthlyState.year,
        monthlyState.month,
        aggregated
      ).catch((err) => {
        console.error('[unitsTable] printPatientMonthlyReport error:', err);
        showToast('印刷の起動に失敗しました', 'error');
      });
    });
  });
}
