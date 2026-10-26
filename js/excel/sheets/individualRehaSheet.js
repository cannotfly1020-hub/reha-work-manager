// js/excel/sheets/individualRehaSheet.js
// 個別リハビリ実施リスト（原本A4横マトリクス）
// ★入院/外来 × 疾患 × 通常/減算 → 最大12物理タブ（1タブ＝1表、縦積み禁止、凡例なし）
// ★当月中切替（要介護・要支援）: 満了日まで通常シート／翌日以降減算シートへ日割り分割
// ★旧 rehaPatientSheet.js は削除せず残置

import {
  addDays, calculatePatientDeadlines, evaluateEarlyBonusPhase, getDailyBasePoints
} from '../../core/deadlineCalc.js';
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
 */
function analyzePatientItem(item, year, month, daysInMonth) {
  const p = item.patient;
  const isIn = p.category === 'INPATIENT';
  const baseEarlyDate = getEarlyBaseDate(p);
  const { monthStart, monthEnd } = getMonthBounds(year, month);
  const deadlines = calculatePatientDeadlines(p, monthEnd);
  const limitDateStr = deadlines.limitDateStr || '';
  const placement = classifyBillingPlacement(p, monthStart, monthEnd, limitDateStr);
  const switchStartStr = limitDateStr ? addDays(limitDateStr, 1) : '';

  const dailyUnits = Array(daysInMonth + 1).fill(0);
  const early1ByDay = Array(daysInMonth + 1).fill(0);
  const early2ByDay = Array(daysInMonth + 1).fill(0);
  const planByDay = Array(daysInMonth + 1).fill('');
  const isMaintDay = Array(daysInMonth + 1).fill(false);

  // dailyRehaUnits 優先で単位を埋める
  for (let d = 1; d <= daysInMonth; d += 1) {
    dailyUnits[d] = item.dailyRehaUnits
      ? (item.dailyRehaUnits[d] || 0)
      : (item.dailyUnits?.[d] || 0);
  }

  (item.slots || []).forEach((s) => {
    if (!s || s.isAnalgesia || !s.date) return;
    const parts = s.date.split('-');
    const dNum = parseInt(parts[2], 10);
    if (!(dNum >= 1 && dNum <= daysInMonth)) return;
    const u = s.units || 1;

    if (s.billingPlan) planByDay[dNum] = s.date.slice(5);

    if (isIn && baseEarlyDate) {
      const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
      if (ph.phase === 'PHASE_1') early1ByDay[dNum] += u;
      else if (ph.phase === 'PHASE_2') early2ByDay[dNum] += u;
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

  // 退院日（未設定の過去データは空＝マークなし）
  const dischargeDateStr = String(p.plannedDischargeDate || p.dischargeDate || '').trim().slice(0, 10);

  return {
    placement,
    limitDateStr,
    switchStartStr,
    dischargeDateStr,
    dailyUnits,
    early1ByDay,
    early2ByDay,
    planByDay,
    isMaintDay,
    admissionLabel,
    careType: p.careInsuranceType || 'NONE'
  };
}

/**
 * シート期間モード向けの行ビュー（総単位・介ラベル・期間内早期/計画）を構築
 * @param {object} analysis
 * @param {SheetPeriodMode} mode
 * @param {number} year
 * @param {number} month
 * @param {number} daysInMonth
 */
function buildPeriodRowView(analysis, mode, year, month, daysInMonth) {
  const {
    limitDateStr, switchStartStr, dailyUnits, early1ByDay, early2ByDay,
    planByDay, isMaintDay, careType
  } = analysis;

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
    if (item.patient.diseaseType === 'ANALGESIA') return;
    const rehaUnits = item.rehaTotalUnits !== undefined
      ? item.rehaTotalUnits
      : (item.hasRehaSlots ? (item.totalUnits || 0) : 0);
    if (!(rehaUnits > 0 || item.hasRehaSlots)) return;

    const analysis = analyzePatientItem(item, year, month, daysInMonth);
    const p = item.patient;
    const base = {
      item,
      analysis,
      category: p.category === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT',
      diseaseKey: resolveDiseaseKey(p),
      id: String(p.id || ''),
      name: String(p.name || '')
    };

    if (analysis.placement === 'FULL_NORMAL') {
      rows.push({
        ...base,
        reduced: false,
        rowView: buildPeriodRowView(analysis, 'FULL_NORMAL', year, month, daysInMonth)
      });
    } else if (analysis.placement === 'FULL_REDUCED') {
      rows.push({
        ...base,
        reduced: true,
        rowView: buildPeriodRowView(analysis, 'FULL_REDUCED', year, month, daysInMonth)
      });
    } else {
      // MID_MONTH_SWITCH → 通常・減算の両方（各期間の単位のみ計上）
      rows.push({
        ...base,
        reduced: false,
        rowView: buildPeriodRowView(analysis, 'SPLIT_NORMAL', year, month, daysInMonth)
      });
      rows.push({
        ...base,
        reduced: true,
        rowView: buildPeriodRowView(analysis, 'SPLIT_REDUCED', year, month, daysInMonth)
      });
    }
  });

  rows.sort((a, b) => a.id.localeCompare(b.id, 'ja', { numeric: true }));
  return rows;
}

function writeTwoRowHeader(ws, rowH1, rowH2, year, month, daysInMonth, merges) {
  const fixedLabels = ['ID', '患者氏名', '入院日', '介', '総'];
  fixedLabels.forEach((label, c) => {
    const style = c === 4 ? STYLE_HEADER_TOTAL : STYLE_HEADER;
    setStyledCell(ws, rowH1, c, label, style);
    setStyledCell(ws, rowH2, c, '', style);
    merges.push({ s: { r: rowH1, c }, e: { r: rowH2, c } });
  });

  const dayColStart = 5;
  for (let d = 1; d <= DAY_COLS; d += 1) {
    const col = dayColStart + (d - 1);
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
      font: { ...(dayStyle.font || {}), sz: 8, bold: true }
    });
    setStyledCell(ws, rowH2, col, DAY_OF_WEEK[dow], {
      ...dowStyle,
      font: { ...(dowStyle.font || {}), sz: 7.5, bold: true }
    });
  }

  const extraCol = dayColStart + DAY_COLS;
  ['早Ⅰ', '早Ⅱ', '計画'].forEach((label, i) => {
    const c = extraCol + i;
    setStyledCell(ws, rowH1, c, label, STYLE_HEADER);
    setStyledCell(ws, rowH2, c, '', STYLE_HEADER);
    merges.push({ s: { r: rowH1, c }, e: { r: rowH2, c } });
  });
}

function writePatientMatrixRow(ws, curRow, row, year, month, daysInMonth, zebraBg) {
  const { item, rowView } = row;
  const p = item.patient;
  const {
    periodTotal, early1, early2, planDateStr, visibleUnits,
    careLabel, careStyleBase, admissionLabel, mode,
    dischargeDateStr, maintenanceStartDateStr
  } = rowView;

  setStyledCell(ws, curRow, 0, p.id, {
    ...STYLE_DATA_C, fill: zebraBg, font: { name: 'Meiryo UI', sz: 8, bold: true }
  });
  setStyledCell(ws, curRow, 1, p.name, { ...STYLE_DATA_L, fill: zebraBg });
  setStyledCell(ws, curRow, 2, admissionLabel, { ...STYLE_DATA_C, fill: zebraBg });

  const careStyle = careStyleBase
    ? { ...careStyleBase }
    : { ...STYLE_DATA_C, fill: zebraBg };
  setStyledCell(ws, curRow, 3, careLabel, careStyle);

  // ★「総」は期間内の純粋な数値単位のみ（退・維マークは一切含めない）
  const isReducedSheet = mode === 'FULL_REDUCED' || mode === 'SPLIT_REDUCED';
  setStyledCell(ws, curRow, 4, periodTotal, {
    ...STYLE_DATA_C,
    fill: { fgColor: { rgb: isReducedSheet ? 'FEF3C7' : 'E0F2FE' } },
    font: {
      name: 'Meiryo UI',
      sz: 8.5,
      bold: true,
      color: { rgb: isReducedSheet ? 'B45309' : '0369A1' }
    },
    numFmt: '#,##0'
  });

  const dayColStart = 5;
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
    const isPlan = !!row.analysis.planByDay[d];
    const isE1 = (row.analysis.early1ByDay[d] || 0) > 0;
    const isE2 = (row.analysis.early2ByDay[d] || 0) > 0;

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

  const extraCol = dayColStart + DAY_COLS;
  setStyledCell(ws, curRow, extraCol, early1 > 0 ? early1 : '-', {
    ...STYLE_DATA_C,
    fill: early1 > 0 ? { fgColor: { rgb: 'D1FAE5' } } : zebraBg,
    font: { name: 'Meiryo UI', sz: 8, bold: early1 > 0 }
  });
  setStyledCell(ws, curRow, extraCol + 1, early2 > 0 ? early2 : '-', {
    ...STYLE_DATA_C,
    fill: early2 > 0 ? { fgColor: { rgb: 'DBEAFE' } } : zebraBg,
    font: { name: 'Meiryo UI', sz: 8, bold: early2 > 0 }
  });
  setStyledCell(ws, curRow, extraCol + 2, planDateStr || '-', {
    ...STYLE_DATA_C,
    fill: zebraBg,
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'B45309' } }
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

  groupRows.forEach((row, idx) => {
    const zebraBg = (idx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
    writePatientMatrixRow(ws, curRow, row, year, month, daysInMonth, zebraBg);
    curRow += 1;
  });

  const rHeights = [{ hpt: 22 }, { hpt: 16 }, { hpt: 14 }];
  for (let r = 3; r < curRow; r += 1) rHeights.push({ hpt: 18 });
  ws['!rows'] = rHeights;
  ws['!merges'] = merges;

  const colProps = [
    { wch: 7 }, { wch: 13 }, { wch: 9 }, { wch: 8 }, { wch: 6 }
  ];
  for (let d = 0; d < DAY_COLS; d += 1) colProps.push({ wch: 3.2 });
  colProps.push({ wch: 5 }, { wch: 5 }, { wch: 7 });
  ws['!cols'] = colProps;

  ws['!views'] = [{ showGridLines: true }];
  ws['!freeze'] = { xSplit: 5, ySplit: 3, topLeftCell: 'F4', activePane: 'bottomRight', state: 'frozen' };

  applyA4LandscapePrintSetup(ws, false);
  ws['!margins'] = {
    left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1
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
