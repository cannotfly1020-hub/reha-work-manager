// js/excel/sheets/yearlyTrendSheet.js
// 年間推移（点数票準拠・暦年 1月〜12月＋年間合計）
// 2026年1〜9月: js/fy2026_annual_historical_score_data.js の確定値
// 10月: ライブ集計 / 11・12月: 空欄（見込み）
// ※既存の個別リハ患者シート・20名分割・PT/OT結合は本ファイルでは触らない

import { ANNUAL_HISTORICAL_DATA_2026 } from '../../fy2026_annual_historical_score_data.js';
import { REHA_RULES } from '../../config/rules.js';
import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import { aggregateFromAppSchedule } from '../../store/scheduleStore.js';
import {
  getEarlyBaseDate, thinBorder,
  setStyledCell, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup, YEARLY_TREND_SHEET
} from '../sheetUtils.js';
import {
  renderRevenuePointsChartPng,
  renderDiseaseUnitsChartPng
} from '../yearlyTrendChart.js';

const RESPIRATORY_FALLBACK_POINTS = 85;

/** 暦年 1〜12月 */
const CALENDAR_MONTHS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

/**
 * 互換: 旧呼び出し向け（暦年では year をそのまま返す）
 * @param {number} year
 * @param {number} [_month]
 * @returns {number}
 */
export function resolveFiscalStartYear(year, _month = 4) {
  return Number(year) || new Date().getFullYear();
}

function emptyDiseaseBucket() {
  return { units: 0, points: 0, count: 0 };
}

function emptyMonthStats() {
  return {
    in: {
      CEREBROVASCULAR: emptyDiseaseBucket(),
      DISUSE: emptyDiseaseBucket(),
      LOCOMOTIVE: emptyDiseaseBucket(),
      RESPIRATORY: emptyDiseaseBucket(),
      units: 0,
      points: 0
    },
    out: {
      CEREBROVASCULAR: emptyDiseaseBucket(),
      DISUSE: emptyDiseaseBucket(),
      LOCOMOTIVE: emptyDiseaseBucket(),
      ANALGESIA: emptyDiseaseBucket(),
      units: 0,
      points: 0
    },
    early: emptyDiseaseBucket(),
    plan: emptyDiseaseBucket(),
    grandUnits: 0,
    grandPoints: 0,
    /** 未確定月（数式SUM対象だが表示は空） */
    isBlank: false
  };
}

function resolveDiseaseKey(patient) {
  const t = String(patient?.diseaseType || '').toUpperCase();
  if (t === 'CEREBROVASCULAR' || t === 'DISUSE' || t === 'LOCOMOTIVE' || t === 'RESPIRATORY' || t === 'ANALGESIA') {
    return t;
  }
  if (t === 'CARDIAC' || t === 'CARDIOVASCULAR') return 'CEREBROVASCULAR';
  if (t.includes('RESP')) return 'RESPIRATORY';
  return 'LOCOMOTIVE';
}

/**
 * 履歴モジュール1ヶ月分 → 内部stats
 * @param {typeof ANNUAL_HISTORICAL_DATA_2026} hist
 * @param {number} month 1-9
 */
function statsFromHistorical(hist, month) {
  const st = emptyMonthStats();
  const m = Number(month);
  if (!hist || !m) return st;

  // 入院
  st.in.CEREBROVASCULAR.units = Number(hist.inpatient?.cerebrovascular?.units?.[m]) || 0;
  st.in.CEREBROVASCULAR.points = Number(hist.inpatient?.cerebrovascular?.points?.[m]) || 0;
  st.in.DISUSE.units = Number(hist.inpatient?.disuse?.units?.[m]) || 0;
  st.in.DISUSE.points = Number(hist.inpatient?.disuse?.points?.[m]) || 0;
  st.in.LOCOMOTIVE.units = Number(hist.inpatient?.locomotive?.units?.[m]) || 0;
  st.in.LOCOMOTIVE.points = Number(hist.inpatient?.locomotive?.points?.[m]) || 0;
  st.in.RESPIRATORY.units = Number(hist.inpatient?.respiratory?.units?.[m]) || 0;
  st.in.RESPIRATORY.points = Number(hist.inpatient?.respiratory?.points?.[m]) || 0;
  st.in.units = st.in.CEREBROVASCULAR.units + st.in.DISUSE.units + st.in.LOCOMOTIVE.units + st.in.RESPIRATORY.units;
  st.in.points = st.in.CEREBROVASCULAR.points + st.in.DISUSE.points + st.in.LOCOMOTIVE.points + st.in.RESPIRATORY.points;

  // 外来
  st.out.CEREBROVASCULAR.units = Number(hist.outpatient?.cerebrovascular?.units?.[m]) || 0;
  st.out.CEREBROVASCULAR.points = Number(hist.outpatient?.cerebrovascular?.points?.[m]) || 0;
  st.out.DISUSE.units = Number(hist.outpatient?.disuse?.units?.[m]) || 0;
  st.out.DISUSE.points = Number(hist.outpatient?.disuse?.points?.[m]) || 0;
  st.out.LOCOMOTIVE.units = Number(hist.outpatient?.locomotive?.units?.[m]) || 0;
  st.out.LOCOMOTIVE.points = Number(hist.outpatient?.locomotive?.points?.[m]) || 0;
  st.out.ANALGESIA.count = Number(hist.outpatient?.disuseTreatment?.count?.[m]) || 0;
  st.out.ANALGESIA.points = Number(hist.outpatient?.disuseTreatment?.points?.[m]) || 0;
  st.out.units = st.out.CEREBROVASCULAR.units + st.out.DISUSE.units + st.out.LOCOMOTIVE.units;
  st.out.points = st.out.CEREBROVASCULAR.points + st.out.DISUSE.points
    + st.out.LOCOMOTIVE.points + st.out.ANALGESIA.points;

  // 加算
  st.early.units = Number(hist.additions?.earlyAddition?.units?.[m]) || 0;
  st.early.points = Number(hist.additions?.earlyAddition?.points?.[m]) || 0;
  st.plan.count = Number(hist.additions?.rehabPlan?.count?.[m]) || 0;
  st.plan.points = Number(hist.additions?.rehabPlan?.points?.[m]) || 0;

  st.grandUnits = st.in.units + st.out.units;
  st.grandPoints = st.in.points + st.out.points + st.early.points + st.plan.points;
  return st;
}

/**
 * ライブ集計1ヶ月分
 * @param {object} aggregated
 */
function aggregateMonthTrendStats(aggregated) {
  const st = emptyMonthStats();
  Object.values(aggregated?.patientMap || {}).forEach((item) => {
    const p = item?.patient;
    if (!p) return;
    const isIn = p.category === 'INPATIENT';
    const baseEarlyDate = getEarlyBaseDate(p);

    (item.slots || []).forEach((s) => {
      if (!s) return;

      if (s.isAnalgesia || p.diseaseType === 'ANALGESIA') {
        if (!isIn) {
          const pts = Number(REHA_RULES.LIMIT_DAYS.ANALGESIA?.defaultPoints) || 35;
          st.out.ANALGESIA.count += 1;
          st.out.ANALGESIA.points += pts;
          st.out.points += pts;
          st.grandPoints += pts;
        }
        return;
      }

      const u = Number(s.units) || 1;
      const dKey = resolveDiseaseKey(p);
      const rate = getDailyBasePoints(p, s.date);
      let unitPts = Number(rate?.points);
      if (!Number.isFinite(unitPts) || unitPts <= 0) {
        if (dKey === 'RESPIRATORY') unitPts = RESPIRATORY_FALLBACK_POINTS;
        else unitPts = Number(REHA_RULES.LIMIT_DAYS[dKey]?.defaultPoints) || 170;
      }
      const linePts = u * unitPts;

      if (isIn) {
        const inKey = st.in[dKey] ? dKey : 'LOCOMOTIVE';
        st.in[inKey].units += u;
        st.in[inKey].points += linePts;
        st.in.units += u;
        st.in.points += linePts;
      } else if (dKey === 'ANALGESIA') {
        st.out.ANALGESIA.count += 1;
        st.out.ANALGESIA.points += linePts;
        st.out.points += linePts;
      } else {
        const outKey = st.out[dKey] ? dKey : 'LOCOMOTIVE';
        st.out[outKey].units += u;
        st.out[outKey].points += linePts;
        st.out.units += u;
        st.out.points += linePts;
      }

      st.grandUnits += u;
      st.grandPoints += linePts;

      if (s.billingPlan && REHA_RULES.PLAN_POINTS[s.billingPlan]) {
        const pPts = Number(REHA_RULES.PLAN_POINTS[s.billingPlan]) || 0;
        st.plan.count += 1;
        st.plan.points += pPts;
        st.grandPoints += pPts;
      }

      if (isIn && baseEarlyDate && s.date) {
        const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
        if (ph.points > 0) {
          const ePts = ph.points * u;
          st.early.units += u;
          st.early.count += 1;
          st.early.points += ePts;
          st.grandPoints += ePts;
        }
      }
    });
  });
  return st;
}

/**
 * 暦年12ヶ月の統計を構築
 * @param {number} calendarYear
 * @returns {ReturnType<typeof emptyMonthStats>[]}
 */
function buildCalendarYearStats(calendarYear) {
  const y = Number(calendarYear);
  const hist = (y === Number(ANNUAL_HISTORICAL_DATA_2026?.year))
    ? ANNUAL_HISTORICAL_DATA_2026
    : null;
  const confirmed = new Set(
    Array.isArray(hist?.months) ? hist.months.map((n) => Number(n)) : []
  );

  return CALENDAR_MONTHS.map((month) => {
    // 1〜9月: 確定履歴（2026）
    if (hist && confirmed.has(month) && month <= 9) {
      return statsFromHistorical(hist, month);
    }
    // 10月: ライブ集計
    if (month === 10) {
      try {
        return aggregateMonthTrendStats(aggregateFromAppSchedule(y, 10));
      } catch (_) {
        return emptyMonthStats();
      }
    }
    // 11・12月（および履歴外）: 空欄
    if (month >= 11 || (hist && month <= 9 && !confirmed.has(month))) {
      const blank = emptyMonthStats();
      blank.isBlank = true;
      return blank;
    }
    // 非2026年など: 可能ならライブ
    try {
      return aggregateMonthTrendStats(aggregateFromAppSchedule(y, month));
    } catch (_) {
      const blank = emptyMonthStats();
      blank.isBlank = true;
      return blank;
    }
  });
}

function styleHeader() {
  return {
    font: { name: 'Meiryo UI', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  };
}

function styleCat(fillRgb) {
  return {
    font: { name: 'Meiryo UI', sz: 10, bold: true, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: fillRgb } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  };
}

function styleItem(zebra) {
  return {
    font: { name: 'Meiryo UI', sz: 9.5 },
    fill: zebra ? { fgColor: { rgb: 'F8FAFC' } } : { fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'left', vertical: 'center', shrinkToFit: true },
    border: thinBorder()
  };
}

function styleMetric(zebra) {
  return {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '475569' } },
    fill: zebra ? { fgColor: { rgb: 'F8FAFC' } } : { fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center', shrinkToFit: true },
    border: thinBorder()
  };
}

function styleNum(zebra, emphasize) {
  return {
    font: {
      name: 'Meiryo UI',
      sz: 9.5,
      bold: !!emphasize,
      color: { rgb: emphasize ? '0F172A' : '334155' }
    },
    fill: zebra ? { fgColor: { rgb: 'F8FAFC' } } : { fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'right', vertical: 'center', shrinkToFit: true },
    border: thinBorder(),
    numFmt: '#,##0'
  };
}

function styleSubTotal() {
  return {
    font: { name: 'Meiryo UI', sz: 10, bold: true, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: 'E2E8F0' } },
    alignment: { horizontal: 'right', vertical: 'center', shrinkToFit: true },
    border: {
      top: { style: 'thin', color: { rgb: '64748B' } },
      bottom: { style: 'double', color: { rgb: '334155' } },
      left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      right: { style: 'thin', color: { rgb: 'CBD5E1' } }
    },
    numFmt: '#,##0'
  };
}

function styleGrand() {
  return {
    font: { name: 'Meiryo UI', sz: 10.5, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '0F172A' } },
    alignment: { horizontal: 'right', vertical: 'center', shrinkToFit: true },
    border: {
      top: { style: 'thin', color: { rgb: '0F172A' } },
      bottom: { style: 'double', color: { rgb: '0F172A' } },
      left: { style: 'thin', color: { rgb: '0F172A' } },
      right: { style: 'thin', color: { rgb: '0F172A' } }
    },
    numFmt: '#,##0'
  };
}

function setFormulaCell(ws, r, c, formula, style = {}) {
  const addr = window.XLSX.utils.encode_cell({ r, c });
  ws[addr] = { t: 'n', f: formula, s: style };
}

/**
 * @returns {number} nextRow
 */
function writeMetricRow(ws, row, merges, opts) {
  const {
    catLabel, catFill, itemLabel, metricLabel,
    monthValues, blankFlags, zebra, isSubtotal, isGrand, mergeCatRows
  } = opts;

  const catStyle = isGrand
    ? { ...styleGrand(), alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }
    : (isSubtotal
      ? { ...styleSubTotal(), alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }
      : styleCat(catFill));
  const itemStyle = isGrand
    ? { ...styleGrand(), alignment: { horizontal: 'left', vertical: 'center' } }
    : (isSubtotal
      ? { ...styleSubTotal(), alignment: { horizontal: 'left', vertical: 'center' } }
      : styleItem(zebra));
  const metricStyle = isGrand
    ? { ...styleGrand(), alignment: { horizontal: 'center', vertical: 'center' } }
    : (isSubtotal
      ? { ...styleSubTotal(), alignment: { horizontal: 'center', vertical: 'center' } }
      : styleMetric(zebra));
  const numStyle = isGrand ? styleGrand() : (isSubtotal ? styleSubTotal() : styleNum(zebra, false));
  const totalStyle = isGrand ? styleGrand() : (isSubtotal ? styleSubTotal() : styleNum(zebra, true));

  setStyledCell(ws, row, 0, catLabel || '', catStyle);
  setStyledCell(ws, row, 1, itemLabel || '', itemStyle);
  setStyledCell(ws, row, 2, metricLabel || '', metricStyle);

  // D〜O = 1月〜12月（列3〜14）
  for (let i = 0; i < 12; i += 1) {
    const col = 3 + i;
    const blank = blankFlags?.[i];
    if (blank) {
      setStyledCell(ws, row, col, '', numStyle);
    } else {
      setStyledCell(ws, row, col, Number(monthValues[i]) || 0, numStyle);
    }
  }

  // P列: 年間合計 = SUM(D:O)  ※Excel行は1始まり
  const excelRow = row + 1;
  setFormulaCell(ws, row, 15, `SUM(D${excelRow}:O${excelRow})`, totalStyle);

  if (mergeCatRows && mergeCatRows > 1) {
    merges.push({ s: { r: row, c: 0 }, e: { r: row + mergeCatRows - 1, c: 0 } });
  }
  return row + 1;
}

/**
 * @param {Object} wb
 * @param {number} year 暦年
 * @param {number} [_month] 互換引数（未使用）
 */
export function writeYearlyTrendSheet(wb, year, _month) {
  const calendarYear = Number(year) || new Date().getFullYear();
  const statsList = buildCalendarYearStats(calendarYear);
  const blankFlags = statsList.map((s) => !!s.isBlank);

  const ws = {};
  const merges = [];
  const rowHeights = [];
  let r = 0;

  setStyledCell(ws, r, 0, `【${calendarYear}年 リハビリテーション科 年間推移（1月〜12月 暦年）】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '0F172A' } }
  });
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 15 } });
  rowHeights[r] = 24;
  r += 1;

  const histNote = (calendarYear === 2026)
    ? '1〜9月=点数票確定値（fy2026_annual_historical_score_data）／10月=ライブ集計／11・12月=空欄'
    : '月次ライブ集計（履歴モジュール対象外年）';
  setStyledCell(ws, r, 0, `点数票準拠／${histNote}／A4横 fitToWidth=1`, {
    font: { name: 'Meiryo UI', sz: 8.5, color: { rgb: '64748B' } }
  });
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 15 } });
  rowHeights[r] = 16;
  r += 1;

  const headerRow = r;
  const headers = [
    '大区分', '疾患・項目名', '指標',
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月',
    '年間合計'
  ];
  headers.forEach((h, c) => setStyledCell(ws, headerRow, c, h, styleHeader()));
  rowHeights[headerRow] = 22;
  r = headerRow + 1;

  const monthVals = (picker) => statsList.map((st) => picker(st));

  const rowOpts = (partial) => ({
    blankFlags,
    ...partial
  });

  // —— 入院 ——
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '入院', catFill: 'FEF3C7',
    itemLabel: '脳血管疾患等リハビリテーション料', metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.CEREBROVASCULAR.units), zebra: false, mergeCatRows: 8
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'FEF3C7',
    itemLabel: '脳血管疾患等リハビリテーション料', metricLabel: '点数',
    monthValues: monthVals((s) => s.in.CEREBROVASCULAR.points), zebra: true
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'FEF3C7',
    itemLabel: '廃用症候群リハビリテーション料', metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.DISUSE.units), zebra: false
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'FEF3C7',
    itemLabel: '廃用症候群リハビリテーション料', metricLabel: '点数',
    monthValues: monthVals((s) => s.in.DISUSE.points), zebra: true
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'FEF3C7',
    itemLabel: '運動器リハビリテーション料', metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.LOCOMOTIVE.units), zebra: false
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'FEF3C7',
    itemLabel: '運動器リハビリテーション料', metricLabel: '点数',
    monthValues: monthVals((s) => s.in.LOCOMOTIVE.points), zebra: true
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'FEF3C7',
    itemLabel: '呼吸器リハビリテーション料', metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.RESPIRATORY.units), zebra: false
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'FEF3C7',
    itemLabel: '呼吸器リハビリテーション料', metricLabel: '点数',
    monthValues: monthVals((s) => s.in.RESPIRATORY.points), zebra: true
  }));
  rowHeights[r - 1] = 16;

  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '入院', catFill: 'E2E8F0',
    itemLabel: '※ 小計：入院単位合計', metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.units), isSubtotal: true
  }));
  rowHeights[r - 1] = 17;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '入院', catFill: 'E2E8F0',
    itemLabel: '※ 小計：入院点数合計', metricLabel: '点数',
    monthValues: monthVals((s) => s.in.points), isSubtotal: true
  }));
  rowHeights[r - 1] = 17;

  // —— 外来 ——
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '外来', catFill: 'DBEAFE',
    itemLabel: '脳血管疾患等リハビリテーション料', metricLabel: '単位数',
    monthValues: monthVals((s) => s.out.CEREBROVASCULAR.units), zebra: false, mergeCatRows: 8
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'DBEAFE',
    itemLabel: '脳血管疾患等リハビリテーション料', metricLabel: '点数',
    monthValues: monthVals((s) => s.out.CEREBROVASCULAR.points), zebra: true
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'DBEAFE',
    itemLabel: '廃用症候群リハビリテーション料', metricLabel: '単位数',
    monthValues: monthVals((s) => s.out.DISUSE.units), zebra: false
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'DBEAFE',
    itemLabel: '廃用症候群リハビリテーション料', metricLabel: '点数',
    monthValues: monthVals((s) => s.out.DISUSE.points), zebra: true
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'DBEAFE',
    itemLabel: '運動器リハビリテーション料', metricLabel: '単位数',
    monthValues: monthVals((s) => s.out.LOCOMOTIVE.units), zebra: false
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'DBEAFE',
    itemLabel: '運動器リハビリテーション料', metricLabel: '点数',
    monthValues: monthVals((s) => s.out.LOCOMOTIVE.points), zebra: true
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'DBEAFE',
    itemLabel: '消炎鎮痛等処置', metricLabel: '件数',
    monthValues: monthVals((s) => s.out.ANALGESIA.count), zebra: false
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'DBEAFE',
    itemLabel: '消炎鎮痛等処置', metricLabel: '点数',
    monthValues: monthVals((s) => s.out.ANALGESIA.points), zebra: true
  }));
  rowHeights[r - 1] = 16;

  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '外来', catFill: 'E2E8F0',
    itemLabel: '※ 小計：外来単位合計', metricLabel: '単位数',
    monthValues: monthVals((s) => s.out.units), isSubtotal: true
  }));
  rowHeights[r - 1] = 17;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '外来', catFill: 'E2E8F0',
    itemLabel: '※ 小計：外来点数合計', metricLabel: '点数',
    monthValues: monthVals((s) => s.out.points), isSubtotal: true
  }));
  rowHeights[r - 1] = 17;

  // —— 加算 ——
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '加算・管理料', catFill: 'D1FAE5',
    itemLabel: '早期リハビリテーション加算', metricLabel: '単位数',
    monthValues: monthVals((s) => s.early.units), zebra: false, mergeCatRows: 4
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'D1FAE5',
    itemLabel: '早期リハビリテーション加算', metricLabel: '点数',
    monthValues: monthVals((s) => s.early.points), zebra: true
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'D1FAE5',
    itemLabel: 'リハビリテーション総合計画評価料', metricLabel: '件数',
    monthValues: monthVals((s) => s.plan.count), zebra: false
  }));
  rowHeights[r - 1] = 16;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: 'D1FAE5',
    itemLabel: 'リハビリテーション総合計画評価料', metricLabel: '点数',
    monthValues: monthVals((s) => s.plan.points), zebra: true
  }));
  rowHeights[r - 1] = 16;

  // —— 総合計 ——
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '総合計', catFill: '0F172A',
    itemLabel: 'リハビリテーション科 総単位数', metricLabel: '単位数',
    monthValues: monthVals((s) => s.grandUnits), isGrand: true, mergeCatRows: 2
  }));
  rowHeights[r - 1] = 17;
  r = writeMetricRow(ws, r, merges, rowOpts({
    catLabel: '', catFill: '0F172A',
    itemLabel: '診療報酬 請求総点数', metricLabel: '点数',
    monthValues: monthVals((s) => s.grandPoints), isGrand: true
  }));
  rowHeights[r - 1] = 17;

  // 表を Excel 行30までに揃え、31〜33は空行、34行目からグラフ（手動改ページは使わない）
  while (r < 30) {
    rowHeights[r] = rowHeights[r] || 4;
    r += 1;
  }
  // Excel 31〜33（0始まり 30〜32）: 空行バッファ（セル・結合なし）
  for (let emptyR = 30; emptyR <= 32; emptyR += 1) {
    rowHeights[emptyR] = 12;
  }

  // Excel 34行目（0始まり 33）から2グラフを左右配置
  // 左=請求点数 / 右=3大疾患単位 ※rowBreaks 不使用・1 drawing に複数 PNG
  const chartAnchorRow = 33; // Excel row 34
  const chartW = 460;
  const chartH = 320;

  const monthNum = (picker) => statsList.map((s) => (s.isBlank ? 0 : (Number(picker(s)) || 0)));
  const pickCombinedUnits = (inKey, outKey) => statsList.map((s) => {
    if (s.isBlank) return 0;
    return (Number(s.in?.[inKey]?.units) || 0) + (Number(s.out?.[outKey]?.units) || 0);
  });

  const grandPointsByMonth = monthNum((s) => s.grandPoints);
  const inpatientPointsByMonth = monthNum((s) => s.in.points);
  const outpatientPointsByMonth = monthNum((s) => s.out.points);
  const cerebrovascularUnits = pickCombinedUnits('CEREBROVASCULAR', 'CEREBROVASCULAR');
  const locomotiveUnits = pickCombinedUnits('LOCOMOTIVE', 'LOCOMOTIVE');
  const disuseUnits = pickCombinedUnits('DISUSE', 'DISUSE');

  try {
    const embedded = [];
    const revenueChart = renderRevenuePointsChartPng({
      calendarYear,
      calendarMode: true,
      grandPointsByMonth,
      inpatientPointsByMonth,
      outpatientPointsByMonth,
      width: chartW,
      height: chartH
    });
    if (revenueChart?.png) {
      embedded.push({
        name: 'revenue_points_chart',
        png: revenueChart.png,
        fromCol: 0, // A列
        fromRow: chartAnchorRow,
        widthPx: revenueChart.widthPx,
        heightPx: revenueChart.heightPx
      });
    }
    const diseaseChart = renderDiseaseUnitsChartPng({
      calendarYear,
      calendarMode: true,
      cerebrovascularUnits,
      locomotiveUnits,
      disuseUnits,
      width: chartW,
      height: chartH
    });
    if (diseaseChart?.png) {
      embedded.push({
        name: 'disease_units_chart',
        png: diseaseChart.png,
        fromCol: 8, // I列
        fromRow: chartAnchorRow,
        widthPx: diseaseChart.widthPx,
        heightPx: diseaseChart.heightPx
      });
    }
    if (embedded.length) {
      ws['!rehaEmbeddedImages'] = embedded;
      for (let i = 0; i < 18; i += 1) {
        rowHeights[chartAnchorRow + i] = rowHeights[chartAnchorRow + i] || 15;
      }
    }
  } catch (err) {
    console.warn('[yearlyTrend] chart render skipped:', err);
  }

  ws['!cols'] = [
    { wch: 11 },
    { wch: 30 },
    { wch: 6.5 },
    ...Array.from({ length: 12 }, () => ({ wch: 8.2 })),
    { wch: 12.5 }
  ];
  ws['!rows'] = rowHeights.map((h) => ({ hpt: h || 17 }));
  ws['!merges'] = merges;
  ws['!views'] = [{ showGridLines: true }];
  ws['!freeze'] = { xSplit: 3, ySplit: headerRow + 1, topLeftCell: 'D4', activePane: 'bottomRight', state: 'frozen' };
  // 手動 rowBreaks / pageBreak は注入しない（sheet XML 破損防止）

  applyA4LandscapePrintSetup(ws, false);
  ws['!margins'] = {
    left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15
  };
  ws['!pageSetup'] = {
    ...(ws['!pageSetup'] || {}),
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    scale: 100
  };
  ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
  ws['!rehaPrintSetup'] = {
    paperSize: 9,
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: 0,
    fitHeight: false,
    scale: 100,
    margins: {
      left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15
    }
  };

  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, YEARLY_TREND_SHEET);
}
