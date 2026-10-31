// js/excel/sheets/yearlyTrendSheet.js
// 年間推移（点数票準拠・診療報酬年度 4月〜3月マトリクス）
// 列: 大区分 / 疾患・項目 / 指標 / 4月〜3月 / 年度合計
// ※既存の個別リハ患者シート・20名分割・PT/OT結合は本ファイルでは触らない

import { REHA_RULES } from '../../config/rules.js';
import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import { aggregateFromAppSchedule } from '../../store/scheduleStore.js';
import {
  STYLES, getEarlyBaseDate, thinBorder,
  setStyledCell, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup, YEARLY_TREND_SHEET
} from '../sheetUtils.js';
import { renderYearlyTrendChartPng } from '../yearlyTrendChart.js';

/** 呼吸器リハ（マスター未登録時のフォールバック点数） */
const RESPIRATORY_FALLBACK_POINTS = 85;

/** 診療報酬年度の月順（4月始まり） */
const FISCAL_MONTHS = Object.freeze([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]);

/**
 * 対象年月から診療報酬年度の開始年（4月の西暦年）を求める
 * @param {number} year
 * @param {number} [month=4]
 * @returns {number}
 */
export function resolveFiscalStartYear(year, month = 4) {
  const y = Number(year) || new Date().getFullYear();
  const m = Number(month) || 4;
  return m >= 4 ? y : y - 1;
}

/**
 * 年度内インデックス(0=4月) → { calendarYear, month }
 * @param {number} fiscalStartYear
 * @param {number} fiscalIndex 0..11
 */
function fiscalIndexToYm(fiscalStartYear, fiscalIndex) {
  const month = FISCAL_MONTHS[fiscalIndex];
  const calendarYear = month >= 4 ? fiscalStartYear : fiscalStartYear + 1;
  return { calendarYear, month };
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
    grandPoints: 0
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
 * 1ヶ月分の入外・疾患別・加算実績を集計（単位 / 点数）
 * @param {object} aggregated
 * @returns {ReturnType<typeof emptyMonthStats>}
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

      // 消炎鎮痛等処置（外来件数）
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
      } else {
        if (dKey === 'ANALGESIA') {
          st.out.ANALGESIA.count += 1;
          st.out.ANALGESIA.points += linePts;
        } else if (st.out[dKey]) {
          st.out[dKey].units += u;
          st.out[dKey].points += linePts;
        } else {
          st.out.LOCOMOTIVE.units += u;
          st.out.LOCOMOTIVE.points += linePts;
        }
        st.out.units += u;
        st.out.points += linePts;
      }

      st.grandUnits += u;
      st.grandPoints += linePts;

      // 計画評価料
      if (s.billingPlan && REHA_RULES.PLAN_POINTS[s.billingPlan]) {
        const pPts = Number(REHA_RULES.PLAN_POINTS[s.billingPlan]) || 0;
        st.plan.count += 1;
        st.plan.points += pPts;
        st.grandPoints += pPts;
      }

      // 早期加算（入院のみ）
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
 * 年度12ヶ月分の統計配列を構築
 * @param {number} fiscalStartYear
 * @returns {ReturnType<typeof emptyMonthStats>[]}
 */
function buildFiscalYearStats(fiscalStartYear) {
  return FISCAL_MONTHS.map((_, idx) => {
    const { calendarYear, month } = fiscalIndexToYm(fiscalStartYear, idx);
    try {
      const agg = aggregateFromAppSchedule(calendarYear, month);
      return aggregateMonthTrendStats(agg);
    } catch (_) {
      return emptyMonthStats();
    }
  });
}

function styleHeader() {
  return {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  };
}

function styleCat(fillRgb) {
  return {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: fillRgb } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  };
}

function styleItem(zebra) {
  return {
    font: { name: 'Meiryo UI', sz: 8.5 },
    fill: zebra ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: thinBorder()
  };
}

function styleMetric(zebra) {
  return {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '475569' } },
    fill: zebra ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  };
}

function styleNum(zebra, emphasize) {
  return {
    font: {
      name: 'Meiryo UI',
      sz: 8.5,
      bold: !!emphasize,
      color: { rgb: emphasize ? '0F172A' : '334155' }
    },
    fill: zebra ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder(),
    numFmt: '#,##0'
  };
}

function styleSubTotal() {
  return {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: 'E2E8F0' } },
    alignment: { horizontal: 'right', vertical: 'center' },
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
    font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '0F172A' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: '0F172A' } },
      bottom: { style: 'double', color: { rgb: '0F172A' } },
      left: { style: 'thin', color: { rgb: '0F172A' } },
      right: { style: 'thin', color: { rgb: '0F172A' } }
    },
    numFmt: '#,##0'
  };
}

function sumArr(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

/**
 * 1指標行を書き込む（月12列 + 合計）
 * @returns {number} nextRow
 */
function writeMetricRow(ws, row, merges, opts) {
  const {
    catLabel, catFill, itemLabel, metricLabel,
    monthValues, zebra, isSubtotal, isGrand, mergeCatRows
  } = opts;

  const total = sumArr(monthValues);
  const catStyle = isGrand
    ? { ...styleGrand(), alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }
    : (isSubtotal
      ? { ...styleSubTotal(), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, fill: { fgColor: { rgb: 'E2E8F0' } } }
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
  monthValues.forEach((v, i) => {
    setStyledCell(ws, row, 3 + i, Number(v) || 0, numStyle);
  });
  setStyledCell(ws, row, 15, total, totalStyle);

  if (mergeCatRows && mergeCatRows > 1) {
    merges.push({ s: { r: row, c: 0 }, e: { r: row + mergeCatRows - 1, c: 0 } });
  }
  return row + 1;
}

/**
 * 年間推移シートを生成（点数票準拠・A4横 fitToWidth=1）
 * @param {Object} wb
 * @param {number} year 基準年（集計月の西暦）
 * @param {number} [month] 基準月（1-12）。省略時は4月扱い＝その年の年度
 */
export function writeYearlyTrendSheet(wb, year, month) {
  const fiscalStartYear = resolveFiscalStartYear(year, month || 4);
  const fiscalEndYear = fiscalStartYear + 1;
  const statsList = buildFiscalYearStats(fiscalStartYear);

  const ws = {};
  const merges = [];
  const rowHeights = [];
  let r = 0;

  // タイトル
  setStyledCell(ws, r, 0, `【${fiscalStartYear}年度 リハビリテーション科 年間推移（${fiscalStartYear}年4月〜${fiscalEndYear}年3月）】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '0F172A' } }
  });
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 15 } });
  rowHeights[r] = 28;
  r += 1;

  setStyledCell(ws, r, 0, '点数票準拠マトリクス／大区分×疾患・項目×指標（単位数・点数）／A4横・横幅1ページ収容', {
    font: { name: 'Meiryo UI', sz: 8, color: { rgb: '64748B' } }
  });
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 15 } });
  rowHeights[r] = 18;
  r += 1;

  // ヘッダー
  const headerRow = r;
  const headers = [
    '大区分', '疾患・項目名', '指標',
    '4月', '5月', '6月', '7月', '8月', '9月',
    '10月', '11月', '12月', '1月', '2月', '3月',
    '年度合計'
  ];
  headers.forEach((h, c) => setStyledCell(ws, headerRow, c, h, styleHeader()));
  rowHeights[headerRow] = 22;
  r = headerRow + 1;

  const monthVals = (picker) => statsList.map((st) => picker(st));

  // —— 入院（8行: 4疾患 × 単位/点数）——
  const inStart = r;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '入院',
    catFill: 'FEF3C7',
    itemLabel: '脳血管疾患等リハビリテーション料',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.CEREBROVASCULAR.units),
    zebra: false,
    mergeCatRows: 8
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'FEF3C7',
    itemLabel: '脳血管疾患等リハビリテーション料',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.in.CEREBROVASCULAR.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'FEF3C7',
    itemLabel: '廃用症候群リハビリテーション料',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.DISUSE.units),
    zebra: false
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'FEF3C7',
    itemLabel: '廃用症候群リハビリテーション料',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.in.DISUSE.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'FEF3C7',
    itemLabel: '運動器リハビリテーション料',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.LOCOMOTIVE.units),
    zebra: false
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'FEF3C7',
    itemLabel: '運動器リハビリテーション料',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.in.LOCOMOTIVE.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'FEF3C7',
    itemLabel: '呼吸器リハビリテーション料',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.RESPIRATORY.units),
    zebra: false
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'FEF3C7',
    itemLabel: '呼吸器リハビリテーション料',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.in.RESPIRATORY.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;
  // 入院小計
  r = writeMetricRow(ws, r, merges, {
    catLabel: '入院',
    catFill: 'E2E8F0',
    itemLabel: '※ 小計：入院単位合計',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.in.units),
    isSubtotal: true
  });
  rowHeights[r - 1] = 20;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '入院',
    catFill: 'E2E8F0',
    itemLabel: '※ 小計：入院点数合計',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.in.points),
    isSubtotal: true
  });
  rowHeights[r - 1] = 20;
  // 入院カテゴリ結合は先頭8行のみ（小計は別表示）
  void inStart;

  // —— 外来 ——
  r = writeMetricRow(ws, r, merges, {
    catLabel: '外来',
    catFill: 'DBEAFE',
    itemLabel: '脳血管疾患等リハビリテーション料',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.out.CEREBROVASCULAR.units),
    zebra: false,
    mergeCatRows: 8
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'DBEAFE',
    itemLabel: '脳血管疾患等リハビリテーション料',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.out.CEREBROVASCULAR.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'DBEAFE',
    itemLabel: '廃用症候群リハビリテーション料',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.out.DISUSE.units),
    zebra: false
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'DBEAFE',
    itemLabel: '廃用症候群リハビリテーション料',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.out.DISUSE.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'DBEAFE',
    itemLabel: '運動器リハビリテーション料',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.out.LOCOMOTIVE.units),
    zebra: false
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'DBEAFE',
    itemLabel: '運動器リハビリテーション料',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.out.LOCOMOTIVE.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'DBEAFE',
    itemLabel: '消炎鎮痛等処置',
    metricLabel: '件数',
    monthValues: monthVals((s) => s.out.ANALGESIA.count),
    zebra: false
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'DBEAFE',
    itemLabel: '消炎鎮痛等処置',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.out.ANALGESIA.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;

  r = writeMetricRow(ws, r, merges, {
    catLabel: '外来',
    catFill: 'E2E8F0',
    itemLabel: '※ 小計：外来単位合計',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.out.units),
    isSubtotal: true
  });
  rowHeights[r - 1] = 20;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '外来',
    catFill: 'E2E8F0',
    itemLabel: '※ 小計：外来点数合計',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.out.points),
    isSubtotal: true
  });
  rowHeights[r - 1] = 20;

  // —— 加算・管理料 ——
  r = writeMetricRow(ws, r, merges, {
    catLabel: '加算・管理料',
    catFill: 'D1FAE5',
    itemLabel: '早期リハビリテーション加算',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.early.units),
    zebra: false,
    mergeCatRows: 4
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'D1FAE5',
    itemLabel: '早期リハビリテーション加算',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.early.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'D1FAE5',
    itemLabel: 'リハビリテーション総合計画評価料',
    metricLabel: '件数',
    monthValues: monthVals((s) => s.plan.count),
    zebra: false
  });
  rowHeights[r - 1] = 18;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: 'D1FAE5',
    itemLabel: 'リハビリテーション総合計画評価料',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.plan.points),
    zebra: true
  });
  rowHeights[r - 1] = 18;

  // —— 総合計 ——
  r = writeMetricRow(ws, r, merges, {
    catLabel: '総合計',
    catFill: '0F172A',
    itemLabel: 'リハビリテーション科 総単位数',
    metricLabel: '単位数',
    monthValues: monthVals((s) => s.grandUnits),
    isGrand: true,
    mergeCatRows: 2
  });
  rowHeights[r - 1] = 22;
  r = writeMetricRow(ws, r, merges, {
    catLabel: '',
    catFill: '0F172A',
    itemLabel: '診療報酬 請求総点数',
    metricLabel: '点数',
    monthValues: monthVals((s) => s.grandPoints),
    isGrand: true
  });
  rowHeights[r - 1] = 22;

  // チャート配置用の余白行（表の直下）
  const chartCaptionRow = r + 1;
  setStyledCell(ws, chartCaptionRow, 0, '■ 月次推移グラフ（棒: 請求総点数／折線: 総単位数）※静的画像・マクロ不要', {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '0369A1' } }
  });
  rowHeights[chartCaptionRow] = 20;
  const chartAnchorRow = chartCaptionRow + 1;

  // コンボチャートを Canvas 描画 → PNG（ZIP後処理でシートへ埋め込み）
  const pointsByMonth = statsList.map((s) => s.grandPoints);
  const unitsByMonth = statsList.map((s) => s.grandUnits);
  try {
    const chart = renderYearlyTrendChartPng({
      fiscalStartYear,
      pointsByMonth,
      unitsByMonth,
      width: 900,
      height: 360
    });
    if (chart?.png) {
      ws['!rehaEmbeddedImages'] = [{
        name: `${fiscalStartYear}年度_年間推移チャート`,
        png: chart.png,
        fromCol: 0,
        fromRow: chartAnchorRow,
        widthPx: chart.widthPx,
        heightPx: chart.heightPx
      }];
      // 画像の見た目分の行高を確保（印刷時の重なり軽減）
      for (let i = 0; i < 18; i += 1) {
        rowHeights[chartAnchorRow + i] = rowHeights[chartAnchorRow + i] || 15;
      }
    }
  } catch (err) {
    console.warn('[yearlyTrend] chart render skipped:', err);
  }

  // 列幅（A4横 fitToWidth=1 向けに詰める）
  ws['!cols'] = [
    { wch: 12 },  // 大区分
    { wch: 28 },  // 疾患・項目
    { wch: 7 },   // 指標
    ...Array.from({ length: 12 }, () => ({ wch: 6.2 })),
    { wch: 9 }    // 年度合計
  ];
  ws['!rows'] = rowHeights.map((h) => ({ hpt: h || 18 }));
  ws['!merges'] = merges;
  ws['!views'] = [{ showGridLines: true }];
  ws['!freeze'] = { xSplit: 3, ySplit: headerRow + 1, topLeftCell: 'D4', activePane: 'bottomRight', state: 'frozen' };

  // ★A4横・横幅1ページ絶対収容
  applyA4LandscapePrintSetup(ws, false);
  ws['!margins'] = {
    left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2
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
      left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2
    }
  };

  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, YEARLY_TREND_SHEET);
}
