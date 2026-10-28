// js/excel/sheets/individualRehaSheet.js
// 個別リハビリ実施リスト（原本A4横マトリクス）
// ★入院/外来 × 疾患 × 通常/減算 → 最大12物理タブ（1タブ＝1表、縦積み禁止、凡例なし）
// ★当月中切替（要介護・要支援）: 満了日まで通常シート／翌日以降減算シートへ日割り分割
// ★旧 rehaPatientSheet.js は削除せず残置

import {
  addDays, calculatePatientDeadlines, evaluateEarlyBonusPhase, getDailyBasePoints
} from '../../core/deadlineCalc.js';
import {
  buildDailyUnitsByRole, getTherapistRole, listRolesForExcelRows
} from '../../core/therapistRoleUtil.js';
import { getPatientById } from '../../store/patientStore.js';
import { getAllTherapists, getTherapistById } from '../../store/therapistStore.js';
import {
  STYLES, thinBorder, getEarlyBaseDate,
  setStyledCell, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup
} from '../sheetUtils.js';

const DAY_COLS = 31;
const DAY_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** @typedef {'FULL_NORMAL'|'FULL_REDUCED'|'SPLIT_NORMAL'|'SPLIT_REDUCED'} SheetPeriodMode */

const SHEET_DEFS = [
  { category: 'INPATIENT', diseaseType: 'LOCOMOTIVE', reduced: false, sheetName: '入院_運動器(通常)', catLabel: '入院', disLabel: '運動器', kindLabel: '通常' },
  { category: 'INPATIENT', diseaseType: 'LOCOMOTIVE', reduced: true, sheetName: '入院_運動器(減算)', catLabel: '入院', disLabel: '運動器', kindLabel: '減算' },
  { category: 'INPATIENT', diseaseType: 'CEREBROVASCULAR', reduced: false, sheetName: '入院_脳血管(通常)', catLabel: '入院', disLabel: '脳血管', kindLabel: '通常' },
  { category: 'INPATIENT', diseaseType: 'CEREBROVASCULAR', reduced: true, sheetName: '入院_脳血管(減算)', catLabel: '入院', disLabel: '脳血管', kindLabel: '減算' },
  { category: 'INPATIENT', diseaseType: 'DISUSE', reduced: false, sheetName: '入院_廃用(通常)', catLabel: '入院', disLabel: '廃用', kindLabel: '通常' },
  { category: 'INPATIENT', diseaseType: 'DISUSE', reduced: true, sheetName: '入院_廃用(減算)', catLabel: '入院', disLabel: '廃用', kindLabel: '減算' },
  { category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE', reduced: false, sheetName: '外来_運動器(通常)', catLabel: '外来', disLabel: '運動器', kindLabel: '通常' },
  { category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE', reduced: true, sheetName: '外来_運動器(減算)', catLabel: '外来', disLabel: '運動器', kindLabel: '減算' },
  { category: 'OUTPATIENT', diseaseType: 'CEREBROVASCULAR', reduced: false, sheetName: '外来_脳血管(通常)', catLabel: '外来', disLabel: '脳血管', kindLabel: '通常' },
  { category: 'OUTPATIENT', diseaseType: 'CEREBROVASCULAR', reduced: true, sheetName: '外来_脳血管(減算)', catLabel: '外来', disLabel: '脳血管', kindLabel: '減算' },
  { category: 'OUTPATIENT', diseaseType: 'DISUSE', reduced: false, sheetName: '外来_廃用(通常)', catLabel: '外来', disLabel: '廃用', kindLabel: '通常' },
  { category: 'OUTPATIENT', diseaseType: 'DISUSE', reduced: true, sheetName: '外来_廃用(減算)', catLabel: '外来', disLabel: '廃用', kindLabel: '減算' }
];

const STYLE_CELL_MAINT = {
  font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'B45309' } },
  fill: { fgColor: { rgb: 'FEF3C7' } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};
const STYLE_CELL_PLAN_MAINT = {
  font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'B45309' } },
  fill: { fgColor: { rgb: 'FDE68A' } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};
const STYLE_CARE_MAINT = {
  ...STYLES.cellCenter,
  fill: { fgColor: { rgb: 'FEF3C7' } },
  font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: 'B45309' } }
};
const STYLE_CARE_SPLIT = {
  ...STYLES.cellCenter,
  fill: { fgColor: { rgb: 'FEF3C7' } },
  font: { name: 'Meiryo UI', sz: 7, bold: true, color: { rgb: 'B45309' } }
};
const STYLE_HEADER = {
  font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '1E293B' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: thinBorder()
};
const STYLE_HEADER_TOTAL = {
  ...STYLE_HEADER,
  fill: { fgColor: { rgb: '0369A1' } }
};
const STYLE_DATA_C = {
  font: { name: 'Meiryo UI', sz: 8 },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};
const STYLE_DATA_L = {
  font: { name: 'Meiryo UI', sz: 8, bold: true },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: thinBorder()
};
const STYLE_UNIT = {
  font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '0F172A' } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};
/** 期間外セル（当月切替の相手側期間） */
const STYLE_OUT_OF_PERIOD = {
  font: { name: 'Meiryo UI', sz: 8, color: { rgb: 'CBD5E1' } },
  fill: { fgColor: { rgb: 'F1F5F9' } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};

function buildDateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatAdmissionShort(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr.trim();
  return `${m[2]}/${m[3]}`;
}

function formatMd(dateStr) {
  return formatAdmissionShort(dateStr);
}

/**
 * 任意の日付入力を YYYY-MM-DD へ正規化（無効は空文字）
 * @param {string|Date|*} raw
 * @returns {string}
 */
function normalizeExitDateString(raw) {
  if (!raw) return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(raw).trim();
  if (!str) return '';
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  }
  const slash = str.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
  if (slash) {
    return `${slash[1]}-${String(slash[2]).padStart(2, '0')}-${String(slash[3]).padStart(2, '0')}`;
  }
  // 先頭10文字が YYYY-MM-DD 形式なら採用
  const head = str.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  return '';
}

/**
 * スケジュール内スナップショットより患者マスター（最新）を優先して合成
 * → 台帳で終了・退院日を更新しても、Excel 出力時に確実に反映される
 * @param {Object} snap
 * @returns {Object}
 */
function resolveLivePatient(snap) {
  if (!snap || typeof snap !== 'object') return {};
  const id = snap.id;
  const live = id ? getPatientById(id) : null;
  if (!live) return { ...snap };
  // マスター側のステータス・終了/退院日フィールドを優先（exitDate が正本）
  const exitDate = live.exitDate
    || snap.exitDate
    || live.discontinuedDate
    || live.endDate
    || live.plannedDischargeDate
    || snap.discontinuedDate
    || snap.endDate
    || snap.plannedDischargeDate
    || '';
  return {
    ...snap,
    ...live,
    exitDate,
    plannedDischargeDate: live.plannedDischargeDate || snap.plannedDischargeDate || exitDate || '',
    discontinuedDate: live.discontinuedDate || snap.discontinuedDate || exitDate || '',
    endDate: live.endDate || snap.endDate || exitDate || '',
    dischargeDate: live.dischargeDate || snap.dischargeDate || '',
    finishDate: live.finishDate || snap.finishDate || '',
    stoppedDate: live.stoppedDate || snap.stoppedDate || '',
    status: live.status || snap.status
  };
}

/**
 * 終了系ステータスか（患者台帳の DISCONTINUED / 退院・終了・中止 等）
 * @param {Object} patient
 * @returns {boolean}
 */
function isPatientExitStatus(patient) {
  const st = String(patient?.status || '').trim();
  if (!st) return false;
  const upper = st.toUpperCase();
  if (
    upper === 'DISCONTINUED'
    || upper === 'DISCHARGED'
    || upper === 'FINISHED'
    || upper === 'STOPPED'
    || upper === 'END'
    || upper === 'CLOSED'
  ) {
    return true;
  }
  return st === '退院' || st === '終了' || st === '中止' || st === '終了・退院' || st.includes('退院') || st.includes('終了');
}

/**
 * 患者台帳から終了・退院（中止）日を網羅的に取得
 * ※ getPatientById で最新マスターを引き直してから候補フィールドを走査
 * @param {Object} patient
 * @returns {string} YYYY-MM-DD（未設定は空文字）
 */
function extractPatientExitDate(patient) {
  const p = resolveLivePatient(patient);
  if (!p || !p.id) {
    // id 無しでも渡されたオブジェクトから走査
    if (!patient) return '';
  }
  const src = p.id ? p : (patient || {});

  // ★正本 exitDate を最優先。旧フィールドは下位互換
  const candidates = [
    src.exitDate,
    src.discontinuedDate,
    src.endDate,
    src.plannedDischargeDate,
    src.dischargeDate,
    src.finishDate,
    src.stoppedDate
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const normalized = normalizeExitDateString(candidates[i]);
    if (normalized) return normalized;
  }

  // 終了系ステータスだが日付フィールドが空の場合は印字日を特定できない
  // （誤って全日に「退」を付けないよう空を返す）
  if (isPatientExitStatus(src)) {
    return '';
  }

  return '';
}

function resolveDiseaseKey(patient) {
  const key = patient?.diseaseType;
  if (key === 'LOCOMOTIVE' || key === 'CEREBROVASCULAR' || key === 'DISUSE') return key;
  return 'LOCOMOTIVE';
}

function isCareInsured(patient) {
  return patient?.careInsuranceType === 'CARE' || patient?.careInsuranceType === 'SUPPORT';
}

function getMonthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const daysInMonth = new Date(y, m, 0).getDate();
  return {
    monthStart: `${y}-${String(m).padStart(2, '0')}-01`,
    monthEnd: `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`,
    daysInMonth
  };
}

/**
 * 当月における算定区分
 * - FULL_NORMAL: 通常シートのみ（全日）
 * - FULL_REDUCED: 減算シートのみ（全日・前月以前満了の要介護等）
 * - MID_MONTH_SWITCH: 通常＋減算の両方（日割り）
 * @param {Object} patient
 * @param {string} monthStart
 * @param {string} monthEnd
 * @param {string} limitDateStr
 * @returns {'FULL_NORMAL'|'FULL_REDUCED'|'MID_MONTH_SWITCH'}
 */
function classifyBillingPlacement(patient, monthStart, monthEnd, limitDateStr) {
  const care = isCareInsured(patient);
  const force13 = patient?.force13Limit === true || patient?.force13UnitsLimit === true;

  // 医療のみ・期限なし・ANALGESIA相当: 常に通常（減算免除）
  if (!care) return 'FULL_NORMAL';
  if (!limitDateStr) return 'FULL_NORMAL';

  // 強制13単位制限（要介護）は満了扱いに近いが、起算未設定時は全日減算
  if (force13) {
    if (limitDateStr >= monthStart && limitDateStr <= monthEnd) return 'MID_MONTH_SWITCH';
    if (limitDateStr < monthStart) return 'FULL_REDUCED';
    return 'FULL_NORMAL';
  }

  // 前月以前に満了 → 全日減算
  if (limitDateStr < monthStart) return 'FULL_REDUCED';
  // 当月内に満了 → 日割り分割（通常＋減算）
  if (limitDateStr >= monthStart && limitDateStr <= monthEnd) return 'MID_MONTH_SWITCH';
  // 満了が翌月以降 → 全日通常
  return 'FULL_NORMAL';
}

/**
 * 日付 d がそのシート期間に属するか
 * @param {string} dateStr YYYY-MM-DD
 * @param {SheetPeriodMode} mode
 * @param {string} limitDateStr
 * @returns {boolean}
 */
function isDateInSheetPeriod(dateStr, mode, limitDateStr) {
  if (mode === 'FULL_NORMAL' || mode === 'FULL_REDUCED') return true;
  if (!limitDateStr) return mode === 'SPLIT_NORMAL';
  // 満了日当日まで通常、翌日以降減算
  if (mode === 'SPLIT_NORMAL') return dateStr <= limitDateStr;
  if (mode === 'SPLIT_REDUCED') return dateStr > limitDateStr;
  return true;
}

/**
 * 患者スロット解析＋日割り用メタ
 * ★患者マスターを getPatientById で引き直し、最新の退院・終了日を反映
 */
function analyzePatientItem(item, year, month, daysInMonth) {
  const p = resolveLivePatient(item.patient);
  const isIn = p.category === 'INPATIENT';
  const baseEarlyDate = getEarlyBaseDate(p);
  const { monthStart, monthEnd } = getMonthBounds(year, month);
  const deadlines = calculatePatientDeadlines(p, monthEnd);
  const limitDateStr = deadlines.limitDateStr || '';
  const placement = classifyBillingPlacement(p, monthStart, monthEnd, limitDateStr);
  const switchStartStr = limitDateStr ? addDays(limitDateStr, 1) : '';
  const therapistsMaster = getAllTherapists();

  const dailyUnits = Array(daysInMonth + 1).fill(0);
  const early1ByDay = Array(daysInMonth + 1).fill(0);
  const early2ByDay = Array(daysInMonth + 1).fill(0);
  const early1ByDayByRole = {
    PT: Array(daysInMonth + 1).fill(0),
    OT: Array(daysInMonth + 1).fill(0),
    ST: Array(daysInMonth + 1).fill(0)
  };
  const early2ByDayByRole = {
    PT: Array(daysInMonth + 1).fill(0),
    OT: Array(daysInMonth + 1).fill(0),
    ST: Array(daysInMonth + 1).fill(0)
  };
  const planByDay = Array(daysInMonth + 1).fill('');
  const planByDayByRole = {
    PT: Array(daysInMonth + 1).fill(''),
    OT: Array(daysInMonth + 1).fill(''),
    ST: Array(daysInMonth + 1).fill('')
  };
  const isMaintDay = Array(daysInMonth + 1).fill(false);

  // 職種別日別単位（スロットの therapist から判定）
  const roleAgg = buildDailyUnitsByRole(item.slots || [], daysInMonth, therapistsMaster);
  const dailyUnitsByRole = roleAgg.dailyByRole;
  const totalsByRole = roleAgg.totalsByRole;

  // 合計日別: 職種合算（スロット優先）。スロット無し時は従来 dailyRehaUnits
  const slotTotal = (totalsByRole.PT || 0) + (totalsByRole.OT || 0) + (totalsByRole.ST || 0);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const fromRoles = (dailyUnitsByRole.PT[d] || 0)
      + (dailyUnitsByRole.OT[d] || 0)
      + (dailyUnitsByRole.ST[d] || 0);
    if (slotTotal > 0) {
      dailyUnits[d] = fromRoles;
    } else {
      dailyUnits[d] = item.dailyRehaUnits
        ? (item.dailyRehaUnits[d] || 0)
        : (item.dailyUnits?.[d] || 0);
      // スロット無しのフォールバックは PT 行へ寄せる
      dailyUnitsByRole.PT[d] = dailyUnits[d];
      totalsByRole.PT += dailyUnits[d];
    }
  }

  (item.slots || []).forEach((s) => {
    if (!s || s.isAnalgesia || !s.date) return;
    const parts = s.date.split('-');
    const dNum = parseInt(parts[2], 10);
    if (!(dNum >= 1 && dNum <= daysInMonth)) return;
    const u = s.units || 1;
    const tid = s.therapistId || s.therapist || '';
    const tObj = tid ? getTherapistById(tid) : null;
    const role = getTherapistRole(tid, tObj?.name || s.therapistName || '', therapistsMaster);

    if (s.billingPlan) {
      planByDay[dNum] = s.date.slice(5);
      planByDayByRole[role][dNum] = s.date.slice(5);
    }

    if (isIn && baseEarlyDate) {
      const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
      if (ph.phase === 'PHASE_1') {
        early1ByDay[dNum] += u;
        early1ByDayByRole[role][dNum] += u;
      } else if (ph.phase === 'PHASE_2') {
        early2ByDay[dNum] += u;
        early2ByDayByRole[role][dNum] += u;
      }
    }

    const rateInfo = getDailyBasePoints(p, s.date);
    if (rateInfo.isMaintenance && rateInfo.isCareReduced) isMaintDay[dNum] = true;
  });

  for (let d = 1; d <= daysInMonth; d += 1) {
    if (dailyUnits[d] <= 0) continue;
    const dateStr = buildDateStr(year, month, d);
    const dayRate = getDailyBasePoints(p, dateStr);
    if (dayRate.isMaintenance && dayRate.isCareReduced) isMaintDay[d] = true;
  }

  const hasEarly = early1ByDay.some((v) => v > 0) || early2ByDay.some((v) => v > 0);
  const admissionLabel = (isIn && hasEarly)
    ? (formatAdmissionShort(baseEarlyDate || p.admissionDate || p.onsetDate) || '-')
    : '-';

  // 終了・退院（中止）日: 最新マスターの候補フィールドを網羅走査
  const dischargeDateStr = extractPatientExitDate(p);

  return {
    placement,
    limitDateStr,
    switchStartStr,
    dischargeDateStr,
    dailyUnits,
    dailyUnitsByRole,
    totalsByRole,
    early1ByDay,
    early2ByDay,
    early1ByDayByRole,
    early2ByDayByRole,
    planByDay,
    planByDayByRole,
    isMaintDay,
    admissionLabel,
    careType: p.careInsuranceType || 'NONE',
    livePatient: p
  };
}

/**
 * シート期間モード向けの行ビュー（総単位・介ラベル・期間内早期/計画）を構築
 * @param {object} analysis
 * @param {SheetPeriodMode} mode
 * @param {number} year
 * @param {number} month
 * @param {number} daysInMonth
 * @param {'PT'|'OT'|'ST'} [role] 職種行（必須: PT/OT分離）
 */
function buildPeriodRowView(analysis, mode, year, month, daysInMonth, role = 'PT') {
  const {
    limitDateStr, switchStartStr, isMaintDay, careType
  } = analysis;

  const dailyUnits = (analysis.dailyUnitsByRole && analysis.dailyUnitsByRole[role])
    ? analysis.dailyUnitsByRole[role]
    : analysis.dailyUnits;
  const early1ByDay = (analysis.early1ByDayByRole && analysis.early1ByDayByRole[role])
    ? analysis.early1ByDayByRole[role]
    : analysis.early1ByDay;
  const early2ByDay = (analysis.early2ByDayByRole && analysis.early2ByDayByRole[role])
    ? analysis.early2ByDayByRole[role]
    : analysis.early2ByDay;
  const planByDay = (analysis.planByDayByRole && analysis.planByDayByRole[role])
    ? analysis.planByDayByRole[role]
    : analysis.planByDay;

  let periodTotal = 0;
  let early1 = 0;
  let early2 = 0;
  let planDateStr = '';
  let maintUnitsInPeriod = 0;
  const visibleUnits = Array(daysInMonth + 1).fill(null); // null=期間外空欄, number=表示

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = buildDateStr(year, month, d);
    const inPeriod = isDateInSheetPeriod(dateStr, mode, limitDateStr);
    if (!inPeriod) {
      visibleUnits[d] = null;
      continue;
    }
    const u = dailyUnits[d] || 0;
    visibleUnits[d] = u;
    periodTotal += u;
    early1 += early1ByDay[d] || 0;
    early2 += early2ByDay[d] || 0;
    if (planByDay[d]) planDateStr = planByDay[d];
    if (isMaintDay[d]) maintUnitsInPeriod += u;
  }

  // 介列
  let careLabel = '-';
  let careStyleBase = null;
  if (mode === 'SPLIT_NORMAL') {
    const md = formatMd(limitDateStr);
    careLabel = md ? `〜${md}通常` : '-';
  } else if (mode === 'SPLIT_REDUCED') {
    const md = formatMd(switchStartStr);
    careLabel = md ? `${md}〜維持` : '維持';
    careStyleBase = STYLE_CARE_SPLIT;
  } else if (mode === 'FULL_REDUCED') {
    if (careType === 'CARE' || careType === 'SUPPORT') {
      const prefix = careType === 'SUPPORT' ? '支維持' : '介維持';
      careLabel = maintUnitsInPeriod > 0 ? `${prefix} ${maintUnitsInPeriod}` : prefix;
      careStyleBase = STYLE_CARE_MAINT;
    }
  } else if (mode === 'FULL_NORMAL') {
    if (careType === 'CARE') careLabel = '介護';
    else if (careType === 'SUPPORT') careLabel = '支援';
    else careLabel = '-';
  }

  return {
    mode,
    role,
    periodTotal, // ★純粋な数値合算（「退」「維」文字列は含めない）
    early1,
    early2,
    planDateStr,
    visibleUnits,
    careLabel,
    careStyleBase,
    admissionLabel: analysis.admissionLabel,
    dischargeDateStr: analysis.dischargeDateStr || '',
    // 維持開始日＝満了翌日（当月切替の減算初日に「維」を印字）
    maintenanceStartDateStr: analysis.switchStartStr || ''
  };
}

/**
 * 日セル表示値（単位＋退/維マーク）。総列計算には使わない。
 * @param {number} units
 * @param {boolean} isDischargeDay
 * @param {boolean} isMaintenanceStartDay
 * @returns {string}
 */
function buildDayCellDisplay(units, isDischargeDay, isMaintenanceStartDay) {
  const u = Number(units) || 0;
  if (u > 0) {
    let displayVal = String(u);
    if (isDischargeDay) displayVal += '退';
    else if (isMaintenanceStartDay) displayVal += '維';
    return displayVal;
  }
  if (isDischargeDay) return '退';
  if (isMaintenanceStartDay) return '維';
  return '';
}

function collectSheetRows(aggregated) {
  const { year, month, daysInMonth, patientMap } = aggregated;
  /** @type {object[]} */
  const rows = [];

  Object.values(patientMap || {}).forEach((item) => {
    if (!item?.patient) return;
    const livePeek = resolveLivePatient(item.patient);
    if (livePeek.diseaseType === 'ANALGESIA') return;
    const rehaUnits = item.rehaTotalUnits !== undefined
      ? item.rehaTotalUnits
      : (item.hasRehaSlots ? (item.totalUnits || 0) : 0);
    if (!(rehaUnits > 0 || item.hasRehaSlots)) return;

    const analysis = analyzePatientItem(item, year, month, daysInMonth);
    const p = analysis.livePatient || resolveLivePatient(item.patient);
    const base = {
      item,
      analysis,
      category: p.category === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT',
      diseaseKey: resolveDiseaseKey(p),
      id: String(p.id || ''),
      name: String(p.name || '')
    };

    const roles = listRolesForExcelRows(analysis.totalsByRole);
    const modes = analysis.placement === 'FULL_NORMAL'
      ? [{ reduced: false, mode: 'FULL_NORMAL' }]
      : (analysis.placement === 'FULL_REDUCED'
        ? [{ reduced: true, mode: 'FULL_REDUCED' }]
        : [
          { reduced: false, mode: 'SPLIT_NORMAL' },
          { reduced: true, mode: 'SPLIT_REDUCED' }
        ]);

    // 医事課照合用: 患者×期間モードごとに PT行 / OT行（ST実績時はST行も）を展開
    modes.forEach(({ reduced, mode }) => {
      roles.forEach((role) => {
        rows.push({
          ...base,
          reduced,
          role,
          rowView: buildPeriodRowView(analysis, mode, year, month, daysInMonth, role)
        });
      });
    });
  });

  // ★同一患者×同一算定区分で PT→OT（→ST）が連続するよう並べ、縦結合の対象にする
  rows.sort((a, b) => {
    const idCmp = a.id.localeCompare(b.id, 'ja', { numeric: true });
    if (idCmp !== 0) return idCmp;
    const redCmp = Number(a.reduced) - Number(b.reduced);
    if (redCmp !== 0) return redCmp;
    const roleOrder = { PT: 0, OT: 1, ST: 2 };
    return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
  });
  return rows;
}

/**
 * 列順序（厳格）:
 * ID → 患者氏名 → 介 → 入院日 → 職 → 1〜31日 → 総 → 早Ⅰ → 早Ⅱ → 計画
 */
const COL_ID = 0;
const COL_NAME = 1;
const COL_CARE = 2;
const COL_ADMISSION = 3;
const COL_ROLE = 4;
const DAY_COL_START = 5;
const COL_TOTAL = DAY_COL_START + DAY_COLS; // 36
const COL_EARLY1 = COL_TOTAL + 1;           // 37
const COL_EARLY2 = COL_TOTAL + 2;           // 38
const COL_PLAN = COL_TOTAL + 3;             // 39

function writeTwoRowHeader(ws, rowH1, rowH2, year, month, daysInMonth, merges) {
  // 固定先頭: ID / 患者氏名 / 介 / 入院日 / 職
  const leftLabels = [
    { c: COL_ID, label: 'ID', style: STYLE_HEADER },
    { c: COL_NAME, label: '患者氏名', style: STYLE_HEADER },
    { c: COL_CARE, label: '介', style: STYLE_HEADER },
    { c: COL_ADMISSION, label: '入院日', style: STYLE_HEADER },
    { c: COL_ROLE, label: '職', style: STYLE_HEADER }
  ];
  leftLabels.forEach(({ c, label, style }) => {
    setStyledCell(ws, rowH1, c, label, {
      ...style,
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    });
    setStyledCell(ws, rowH2, c, '', {
      ...style,
      alignment: { horizontal: 'center', vertical: 'center' }
    });
    merges.push({ s: { r: rowH1, c }, e: { r: rowH2, c } });
  });

  for (let d = 1; d <= DAY_COLS; d += 1) {
    const col = DAY_COL_START + (d - 1);
    if (d > daysInMonth) {
      const muted = {
        font: { name: 'Meiryo UI', sz: 7, color: { rgb: '94A3B8' } },
        fill: { fgColor: { rgb: 'F1F5F9' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: thinBorder()
      };
      setStyledCell(ws, rowH1, col, String(d), muted);
      setStyledCell(ws, rowH2, col, '', muted);
      continue;
    }
    const dateObj = new Date(year, month - 1, d);
    const dow = dateObj.getDay();
    let dayStyle = STYLE_HEADER;
    let dowStyle = STYLE_HEADER;
    if (dow === 6) {
      dayStyle = STYLES.headerSat;
      dowStyle = STYLES.headerSat;
    } else if (dow === 0) {
      dayStyle = STYLES.headerSun;
      dowStyle = STYLES.headerSun;
    }
    setStyledCell(ws, rowH1, col, String(d), {
      ...dayStyle,
      font: { ...(dayStyle.font || {}), sz: 8, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    });
    setStyledCell(ws, rowH2, col, DAY_OF_WEEK[dow], {
      ...dowStyle,
      font: { ...(dowStyle.font || {}), sz: 7.5, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    });
  }

  // 右端: 総 / 早Ⅰ / 早Ⅱ / 計画
  const rightLabels = [
    { c: COL_TOTAL, label: '総', style: STYLE_HEADER_TOTAL },
    { c: COL_EARLY1, label: '早Ⅰ', style: STYLE_HEADER },
    { c: COL_EARLY2, label: '早Ⅱ', style: STYLE_HEADER },
    { c: COL_PLAN, label: '計画', style: STYLE_HEADER }
  ];
  rightLabels.forEach(({ c, label, style }) => {
    setStyledCell(ws, rowH1, c, label, {
      ...style,
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    });
    setStyledCell(ws, rowH2, c, '', {
      ...style,
      alignment: { horizontal: 'center', vertical: 'center' }
    });
    merges.push({ s: { r: rowH1, c }, e: { r: rowH2, c } });
  });
}

/**
 * @param {object} ws
 * @param {number} curRow
 * @param {object} row
 * @param {number} year
 * @param {number} month
 * @param {number} daysInMonth
 * @param {object} zebraBg
 * @param {{
 *   writeShared?: boolean,
 *   mergedTotal?: number,
 *   mergedEarly1?: number,
 *   mergedEarly2?: number,
 *   mergedPlan?: string
 * }} [mergeOpts] 同一患者PT/OT縦結合用。writeShared=true の先頭行に合算値を書く
 */
function writePatientMatrixRow(ws, curRow, row, year, month, daysInMonth, zebraBg, mergeOpts = {}) {
  const { item, rowView } = row;
  // 最新マスター優先（退マーク・グレーアウト判定と氏名表示の整合）
  const p = row.analysis?.livePatient || resolveLivePatient(item.patient);
  const {
    periodTotal, early1, early2, planDateStr, visibleUnits,
    careLabel, careStyleBase, admissionLabel, mode,
    dischargeDateStr, maintenanceStartDateStr, role
  } = rowView;
  const roleLabel = role || row.role || 'PT';
  const writeShared = mergeOpts.writeShared !== false;
  const totalValue = Number.isFinite(mergeOpts.mergedTotal) ? mergeOpts.mergedTotal : periodTotal;
  const early1Value = Number.isFinite(mergeOpts.mergedEarly1) ? mergeOpts.mergedEarly1 : early1;
  const early2Value = Number.isFinite(mergeOpts.mergedEarly2) ? mergeOpts.mergedEarly2 : early2;
  const planValue = (mergeOpts.mergedPlan !== undefined) ? mergeOpts.mergedPlan : planDateStr;

  // 結合セル用: 先頭行に値、下位行は空（マージで上の値が見える）
  // 順序: ID → 氏名 → 介 → 入院日 → 職 → 日別 → 総 → 早Ⅰ → 早Ⅱ → 計画
  if (writeShared) {
    setStyledCell(ws, curRow, COL_ID, p.id, {
      ...STYLE_DATA_C,
      fill: zebraBg,
      font: { name: 'Meiryo UI', sz: 8, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    });
    setStyledCell(ws, curRow, COL_NAME, p.name, {
      ...STYLE_DATA_L, fill: zebraBg, alignment: { horizontal: 'left', vertical: 'center' }
    });
    const careStyle = careStyleBase
      ? { ...careStyleBase, alignment: { ...(careStyleBase.alignment || {}), vertical: 'center', horizontal: 'center' } }
      : { ...STYLE_DATA_C, fill: zebraBg, alignment: { horizontal: 'center', vertical: 'center' } };
    setStyledCell(ws, curRow, COL_CARE, careLabel, careStyle);
    setStyledCell(ws, curRow, COL_ADMISSION, admissionLabel, {
      ...STYLE_DATA_C, fill: zebraBg, alignment: { horizontal: 'center', vertical: 'center' }
    });
  } else {
    setStyledCell(ws, curRow, COL_ID, '', {
      ...STYLE_DATA_C, fill: zebraBg, alignment: { horizontal: 'center', vertical: 'center' }
    });
    setStyledCell(ws, curRow, COL_NAME, '', { ...STYLE_DATA_L, fill: zebraBg });
    setStyledCell(ws, curRow, COL_CARE, '', { ...STYLE_DATA_C, fill: zebraBg });
    setStyledCell(ws, curRow, COL_ADMISSION, '', { ...STYLE_DATA_C, fill: zebraBg });
  }

  // 職種別行ラベル（PT=青 / OT=緑 / ST=紫）※結合しない
  let roleFill = { fgColor: { rgb: 'DBEAFE' } };
  let roleColor = '1D4ED8';
  if (roleLabel === 'OT') {
    roleFill = { fgColor: { rgb: 'D1FAE5' } };
    roleColor = '047857';
  } else if (roleLabel === 'ST') {
    roleFill = { fgColor: { rgb: 'EDE9FE' } };
    roleColor = '6D28D9';
  }
  setStyledCell(ws, curRow, COL_ROLE, roleLabel, {
    ...STYLE_DATA_C,
    fill: roleFill,
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: roleColor } }
  });

  const dayColStart = DAY_COL_START;
  for (let d = 1; d <= DAY_COLS; d += 1) {
    const col = dayColStart + (d - 1);
    if (d > daysInMonth) {
      setStyledCell(ws, curRow, col, '', STYLE_OUT_OF_PERIOD);
      continue;
    }

    const dateObj = new Date(year, month - 1, d);
    const dow = dateObj.getDay();
    const dateStr = buildDateStr(year, month, d);
    const cellVal = visibleUnits[d];
    const isDischargeDay = !!(dischargeDateStr && dischargeDateStr === dateStr);
    const isMaintenanceStartDay = !!(maintenanceStartDateStr && maintenanceStartDateStr === dateStr);
    const isDayAfterDischarge = !!(dischargeDateStr && dateStr > dischargeDateStr);

    // シート期間外 → 空欄＋グレー
    if (cellVal === null) {
      setStyledCell(ws, curRow, col, '', STYLE_OUT_OF_PERIOD);
      continue;
    }

    const u = Number(cellVal) || 0;
    const displayVal = buildDayCellDisplay(u, isDischargeDay, isMaintenanceStartDay);
    const hasMark = displayVal.includes('退') || displayVal.includes('維');
    const dayRate = getDailyBasePoints(p, dateStr);
    const isMaint = u > 0 && dayRate.isMaintenance && dayRate.isCareReduced;
    const planMap = (row.analysis.planByDayByRole && row.analysis.planByDayByRole[roleLabel])
      ? row.analysis.planByDayByRole[roleLabel]
      : row.analysis.planByDay;
    const e1Map = (row.analysis.early1ByDayByRole && row.analysis.early1ByDayByRole[roleLabel])
      ? row.analysis.early1ByDayByRole[roleLabel]
      : row.analysis.early1ByDay;
    const e2Map = (row.analysis.early2ByDayByRole && row.analysis.early2ByDayByRole[roleLabel])
      ? row.analysis.early2ByDayByRole[roleLabel]
      : row.analysis.early2ByDay;
    const isPlan = !!planMap[d];
    const isE1 = (e1Map[d] || 0) > 0;
    const isE2 = (e2Map[d] || 0) > 0;

    // 退院翌日以降の空欄はグレー。マーク付きは強調色
    let cellStyle = { ...STYLE_UNIT };
    if (isDayAfterDischarge && !displayVal) {
      cellStyle = { ...STYLE_OUT_OF_PERIOD };
    } else if (displayVal.includes('退')) {
      cellStyle = {
        ...STYLE_UNIT,
        fill: { fgColor: { rgb: 'FEE2E2' } },
        font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: 'B91C1C' } }
      };
    } else if (displayVal.includes('維')) {
      cellStyle = {
        ...STYLE_UNIT,
        fill: { fgColor: { rgb: 'FEF3C7' } },
        font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: 'B45309' } }
      };
    } else if (dow === 6) {
      cellStyle.fill = STYLES.cellSatCol;
    } else if (dow === 0) {
      cellStyle.fill = STYLES.cellSunCol;
    } else {
      cellStyle.fill = zebraBg;
    }

    if (displayVal) {
      // マーク付きは文字列として印字。無印の単位は従来どおり背景優先ルールも適用
      if (hasMark) {
        setStyledCell(ws, curRow, col, displayVal, cellStyle);
      } else if (isPlan && isMaint) {
        setStyledCell(ws, curRow, col, u, STYLE_CELL_PLAN_MAINT);
      } else if (isPlan) {
        setStyledCell(ws, curRow, col, u, { ...STYLES.cellPlanStar, font: { ...STYLES.cellPlanStar.font, sz: 8 } });
      } else if (isE1) {
        setStyledCell(ws, curRow, col, u, { ...STYLES.cellEarly1, font: { ...STYLES.cellEarly1.font, sz: 8 } });
      } else if (isE2) {
        setStyledCell(ws, curRow, col, u, { ...STYLES.cellEarly2, font: { ...STYLES.cellEarly2.font, sz: 8 } });
      } else if (isMaint) {
        setStyledCell(ws, curRow, col, u, STYLE_CELL_MAINT);
      } else {
        setStyledCell(ws, curRow, col, u, cellStyle);
      }
    } else {
      setStyledCell(ws, curRow, col, '', cellStyle);
    }
  }

  // 日別の右側: 総（合算）→ 早Ⅰ → 早Ⅱ → 計画
  if (writeShared) {
    const isReducedSheet = mode === 'FULL_REDUCED' || mode === 'SPLIT_REDUCED';
    setStyledCell(ws, curRow, COL_TOTAL, totalValue, {
      ...STYLE_DATA_C,
      fill: { fgColor: { rgb: isReducedSheet ? 'FEF3C7' : 'E0F2FE' } },
      font: {
        name: 'Meiryo UI',
        sz: 8.5,
        bold: true,
        color: { rgb: isReducedSheet ? 'B45309' : '0369A1' }
      },
      alignment: { horizontal: 'center', vertical: 'center' },
      numFmt: '#,##0'
    });
    setStyledCell(ws, curRow, COL_EARLY1, early1Value > 0 ? early1Value : '-', {
      ...STYLE_DATA_C,
      fill: early1Value > 0 ? { fgColor: { rgb: 'D1FAE5' } } : zebraBg,
      font: { name: 'Meiryo UI', sz: 8, bold: early1Value > 0 },
      alignment: { horizontal: 'center', vertical: 'center' }
    });
    setStyledCell(ws, curRow, COL_EARLY2, early2Value > 0 ? early2Value : '-', {
      ...STYLE_DATA_C,
      fill: early2Value > 0 ? { fgColor: { rgb: 'DBEAFE' } } : zebraBg,
      font: { name: 'Meiryo UI', sz: 8, bold: early2Value > 0 },
      alignment: { horizontal: 'center', vertical: 'center' }
    });
    setStyledCell(ws, curRow, COL_PLAN, planValue || '-', {
      ...STYLE_DATA_C,
      fill: zebraBg,
      font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'B45309' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    });
  } else {
    setStyledCell(ws, curRow, COL_TOTAL, '', { ...STYLE_DATA_C, fill: zebraBg });
    setStyledCell(ws, curRow, COL_EARLY1, '', { ...STYLE_DATA_C, fill: zebraBg });
    setStyledCell(ws, curRow, COL_EARLY2, '', { ...STYLE_DATA_C, fill: zebraBg });
    setStyledCell(ws, curRow, COL_PLAN, '', { ...STYLE_DATA_C, fill: zebraBg });
  }
}

/**
 * 同一患者×同一算定区分の職種行グループについて、結合対象列のマージを追加
 * （職・1〜31日は結合しない）
 * @param {Array} merges
 * @param {number} rowStart 先頭行（0始まり）
 * @param {number} rowEnd 末尾行（含む）
 */
function pushPatientRoleMerges(merges, rowStart, rowEnd) {
  if (!(rowEnd > rowStart)) return;
  const mergeCols = [
    COL_ID,
    COL_NAME,
    COL_CARE,
    COL_ADMISSION,
    COL_TOTAL,
    COL_EARLY1,
    COL_EARLY2,
    COL_PLAN
  ];
  mergeCols.forEach((c) => {
    merges.push({ s: { r: rowStart, c }, e: { r: rowEnd, c } });
  });
}

function buildSingleGroupWorksheet(aggregated, groupRows, def) {
  if (!groupRows || groupRows.length === 0) return null;

  const { year, month, daysInMonth } = aggregated;
  const ws = {};
  const merges = [];
  let curRow = 0;

  const titleColor = def.reduced ? '881337' : '1E3A8A';
  const title = `【${year}年${month}月 ${def.catLabel} ${def.disLabel} (${def.kindLabel})（個別リハビリ実施リスト）】`;
  setStyledCell(ws, curRow, 0, title, {
    font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: titleColor } }
  });
  curRow += 1;

  const rowH1 = curRow;
  const rowH2 = curRow + 1;
  writeTwoRowHeader(ws, rowH1, rowH2, year, month, daysInMonth, merges);
  curRow = rowH2 + 1;

  // 同一患者の PT/OT(/ST) をグループ化し、属性列を縦結合＋総は合算表示
  let patientBand = 0;
  let prevId = '';
  let i = 0;
  while (i < groupRows.length) {
    const lead = groupRows[i];
    if (lead.id !== prevId) {
      if (prevId) patientBand += 1;
      prevId = lead.id;
    }
    // 同一 id × 同一 reduced の連続職種行を1ブロックにまとめる
    let j = i + 1;
    while (
      j < groupRows.length
      && groupRows[j].id === lead.id
      && Boolean(groupRows[j].reduced) === Boolean(lead.reduced)
    ) {
      j += 1;
    }
    const block = groupRows.slice(i, j);
    const zebraBg = (patientBand % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    let mergedTotal = 0;
    let mergedEarly1 = 0;
    let mergedEarly2 = 0;
    let mergedPlan = '';
    block.forEach((r) => {
      mergedTotal += Number(r.rowView?.periodTotal) || 0;
      mergedEarly1 += Number(r.rowView?.early1) || 0;
      mergedEarly2 += Number(r.rowView?.early2) || 0;
      if (!mergedPlan && r.rowView?.planDateStr) mergedPlan = r.rowView.planDateStr;
    });

    const blockStartRow = curRow;
    block.forEach((r, idx) => {
      writePatientMatrixRow(ws, curRow, r, year, month, daysInMonth, zebraBg, {
        writeShared: idx === 0,
        mergedTotal,
        mergedEarly1,
        mergedEarly2,
        mergedPlan
      });
      curRow += 1;
    });
    const blockEndRow = curRow - 1;
    pushPatientRoleMerges(merges, blockStartRow, blockEndRow);

    i = j;
  }

  const rHeights = [{ hpt: 22 }, { hpt: 16 }, { hpt: 14 }];
  for (let r = 3; r < curRow; r += 1) rHeights.push({ hpt: 16 });
  ws['!rows'] = rHeights;
  ws['!merges'] = merges;

  // 列幅: A4横 fitToWidth=1 で右端（総・早Ⅰ・早Ⅱ・計画）がハミ出さないよう詰める
  // 順序: ID / 氏名 / 介 / 入院日 / 職 / 1〜31 / 総 / 早Ⅰ / 早Ⅱ / 計画
  const colProps = [
    { wch: 6.5 },  // ID
    { wch: 11 },   // 患者氏名
    { wch: 7 },    // 介
    { wch: 7 },    // 入院日
    { wch: 3.8 }   // 職
  ];
  for (let d = 0; d < DAY_COLS; d += 1) colProps.push({ wch: 2.85 });
  colProps.push(
    { wch: 4.5 },  // 総
    { wch: 4.2 },  // 早Ⅰ
    { wch: 4.2 },  // 早Ⅱ
    { wch: 5.5 }   // 計画
  );
  ws['!cols'] = colProps;

  ws['!views'] = [{ showGridLines: true }];
  // 職列まで固定（日列開始 = col 5 → F列）
  ws['!freeze'] = { xSplit: 5, ySplit: 3, topLeftCell: 'F4', activePane: 'bottomRight', state: 'frozen' };

  // ★A4横・横幅1ページ絶対収容（fitToWidth:1 / orientation:landscape）
  applyA4LandscapePrintSetup(ws, false);
  ws['!margins'] = {
    left: 0.15, right: 0.15, top: 0.25, bottom: 0.25, header: 0.08, footer: 0.08
  };
  // applyA4 後も fitToWidth を明示上書き（他処理による上書き防止）
  ws['!pageSetup'] = {
    ...(ws['!pageSetup'] || {}),
    paperSize: 9,
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: 0,
    scale: 100,
    fitToPage: true
  };
  ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
  ws['!rehaPrintSetup'] = {
    ...(ws['!rehaPrintSetup'] || {}),
    paperSize: 9,
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: 0,
    fitHeight: false,
    scale: 100
  };

  updateSheetRange(ws);
  return ws;
}

/**
 * 個別リハ実施リストを最大12物理タブへ追加（当月切替は日割りで両シートへ）
 * @param {Object} wb
 * @param {Object} aggregated
 * @returns {string[]}
 */
export function writeIndividualRehaSheets(wb, aggregated) {
  const allRows = collectSheetRows(aggregated);
  const appendedNames = [];

  for (let i = 0; i < SHEET_DEFS.length; i += 1) {
    const def = SHEET_DEFS[i];
    const filtered = allRows.filter((row) => (
      row.category === def.category
      && row.diseaseKey === def.diseaseType
      && row.reduced === def.reduced
    ));

    if (filtered.length === 0) continue;

    const ws = buildSingleGroupWorksheet(aggregated, filtered, def);
    if (!ws) continue;

    appendOrReplaceSheet(wb, ws, def.sheetName);
    if (wb.SheetNames.indexOf(def.sheetName) < 0 && window.XLSX?.utils?.book_append_sheet) {
      window.XLSX.utils.book_append_sheet(wb, ws, def.sheetName);
    }
    appendedNames.push(def.sheetName);
  }

  return appendedNames;
}

export function splitIndividualRehaPatients(aggregated) {
  const allRows = collectSheetRows(aggregated);
  return {
    normalList: allRows.filter((r) => !r.reduced),
    reducedList: allRows.filter((r) => r.reduced)
  };
}
