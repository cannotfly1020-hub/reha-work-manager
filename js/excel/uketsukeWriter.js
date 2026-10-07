// js/excel/uketsukeWriter.js
// 受付提出用Excel生成層（疾患別シート細分化[入院:運・脳・廃 / 外来:運①・運②・脳・廃 / 消炎] / 横1枚固定・縦自然改ページ / 氏名100px / 早期加算・計画書完全連携 / A4横最適化版）

import { REHA_RULES } from '../config/rules.js';
import { evaluateEarlyBonusPhase } from '../core/deadlineCalc.js';

const SUMMARY_SHEET = 'レセプト収益サマリー';
const ANALGESIA_SHEET = '実施ﾘｽﾄ 消炎鎮痛';

const STYLES = {
  headerNavy: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  },
  headerSat: {
    font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'DBEAFE' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  },
  headerSun: {
    font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: '991B1B' } },
    fill: { fgColor: { rgb: 'FEE2E2' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  },
  cellNormal: {
    font: { name: 'Meiryo UI', sz: 7.5 },
    alignment: { vertical: 'center' },
    border: thinBorder()
  },
  cellCenter: {
    font: { name: 'Meiryo UI', sz: 7.5 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellUnit: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '0F172A' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellEarly1: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '065F46' } },
    fill: { fgColor: { rgb: 'D1FAE5' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellEarly2: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'DBEAFE' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellPlanStar: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'B45309' } },
    fill: { fgColor: { rgb: 'FEF3C7' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellZebra: { fgColor: { rgb: 'F8FAFC' } },
  cellSatCol: { fgColor: { rgb: 'EFF6FF' } },
  cellSunCol: { fgColor: { rgb: 'FFF1F2' } }
};

function thinBorder() {
  const b = { style: 'thin', color: { rgb: 'CBD5E1' } };
  return { top: b, bottom: b, left: b, right: b };
}

function getDiseaseInitial(type) {
  switch (type) {
    case 'LOCOMOTIVE': return '運';
    case 'CEREBROVASCULAR': return '脳';
    case 'DISUSE': return '廃';
    case 'ANALGESIA': return '消';
    default: return type ? type.slice(0, 1) : '-';
  }
}

function getEarlyBaseDate(p) {
  return p.earlyBonusStartDate || p.admissionDate || p.onsetDate || '';
}

export function generateUketsukeWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();

  // 1. 全体経営・レセプト収益サマリー
  writeExecutiveSummarySheet(wb, aggregated);

  // 月内個別リハビリ実績がある患者を抽出
  const allRehaPatients = Object.values(aggregated.patientMap)
    .filter((item) => {
      const rehaUnits = item.rehaTotalUnits !== undefined ? item.rehaTotalUnits : (item.patient.diseaseType !== 'ANALGESIA' ? item.totalUnits : 0);
      return rehaUnits > 0;
    })
    .sort((a, b) => a.patient.id.localeCompare(b.patient.id, 'ja', { numeric: true }));

  const filterByCatAndDisease = (cat, dType) => {
    return allRehaPatients.filter((item) => {
      if (item.patient.category !== cat) return false;
      const targetDis = (item.patient.diseaseType && item.patient.diseaseType !== 'ANALGESIA') ? item.patient.diseaseType : 'LOCOMOTIVE';
      return targetDis === dType;
    });
  };

  // 2. 入院シート（運動器・脳血管・廃用）
  const inLoco = filterByCatAndDisease('INPATIENT', 'LOCOMOTIVE');
  const inCerebro = filterByCatAndDisease('INPATIENT', 'CEREBROVASCULAR');
  const inDisuse = filterByCatAndDisease('INPATIENT', 'DISUSE');

  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', '入院 運動器', inLoco);
  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', '入院 脳血管', inCerebro);
  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', '入院 廃用', inDisuse);

  // 3. 外来シート（運動器①・運動器②・脳血管・廃用）
  const outLocoAll = filterByCatAndDisease('OUTPATIENT', 'LOCOMOTIVE');
  const outCerebro = filterByCatAndDisease('OUTPATIENT', 'CEREBROVASCULAR');
  const outDisuse = filterByCatAndDisease('OUTPATIENT', 'DISUSE');

  // 外来 運動器を前半・後半にバランスよく分割（案A）
  const mid = Math.ceil(outLocoAll.length / 2);
  const outLoco1 = outLocoAll.slice(0, mid);
  const outLoco2 = outLocoAll.slice(mid);

  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', '外来 運動器①', outLoco1);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', '外来 運動器②', outLoco2);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', '外来 脳血管', outCerebro);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', '外来 廃用', outDisuse);

  // 4. 消炎鎮痛 専用シート
  writeAnalgesiaDedicatedSheet(wb, aggregated, ANALGESIA_SHEET);

  return wb;
}

function writeExecutiveSummarySheet(wb, aggregated) {
  const { patientMap, year, month } = aggregated;
  const ws = {};
  const diseaseStats = { LOCOMOTIVE: 0, CEREBROVASCULAR: 0, DISUSE: 0, ANALGESIA: 0 };
  let early1DaysTotal = 0, early2DaysTotal = 0;
  const planStats = { PLAN_1_FIRST: 0, PLAN_1_FOLLOW: 0, PLAN_2_FIRST: 0, PLAN_2_FOLLOW: 0 };

  Object.values(patientMap).forEach((item) => {
    const p = item.patient;
    const isInput = p.category === 'INPATIENT';
    const baseEarlyDate = getEarlyBaseDate(p);

    const earlyDatesCounted = new Set();
    item.slots.forEach((s) => {
      if (s.isAnalgesia) {
        diseaseStats.ANALGESIA++;
      } else {
        if (s.billingPlan && planStats[s.billingPlan] !== undefined) planStats[s.billingPlan]++;
        if (isInput && baseEarlyDate && s.date && !earlyDatesCounted.has(s.date)) {
          earlyDatesCounted.add(s.date);
          const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
          if (ph.phase === 'PHASE_1') early1DaysTotal++;
          else if (ph.phase === 'PHASE_2') early2DaysTotal++;
        }
      }
    });

    const rehaUnits = item.rehaTotalUnits !== undefined ? item.rehaTotalUnits : (p.diseaseType !== 'ANALGESIA' ? item.totalUnits : 0);
    if (rehaUnits > 0) {
      const dType = (p.diseaseType && p.diseaseType !== 'ANALGESIA') ? p.diseaseType : 'LOCOMOTIVE';
      if (diseaseStats[dType] !== undefined) diseaseStats[dType] += rehaUnits;
    }
  });

  setStyledCell(ws, 1, 1, `【${year}年${month}月 リハビリテーション科 レセプト確定・経営収益サマリー】`, {
    font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: '0F172A' } }
  });

  const headers = ['項目 / 算定区分', '算定対象 (単位/回)', '単価点数', '総点数', '総売上金額 (¥)', '備考・算定区分'];
  headers.forEach((h, idx) => setStyledCell(ws, 3, idx + 1, h, STYLES.headerNavy));

  const rows = [
    ['運動器リハビリテーション(Ⅱ)', diseaseStats.LOCOMOTIVE, REHA_RULES.LIMIT_DAYS.LOCOMOTIVE.defaultPoints, '単位'],
    ['脳血管疾患等リハビリテーション(Ⅲ)', diseaseStats.CEREBROVASCULAR, REHA_RULES.LIMIT_DAYS.CEREBROVASCULAR.defaultPoints, '単位'],
    ['廃用症候群リハビリテーション(Ⅲ)', diseaseStats.DISUSE, REHA_RULES.LIMIT_DAYS.DISUSE.defaultPoints, '単位'],
    ['消炎鎮痛等処置 (物療)', diseaseStats.ANALGESIA, 35, '件数 (1日1回35点)'],
    ['早期加算(Ⅰ) 1〜4日目', early1DaysTotal, REHA_RULES.EARLY_BONUS.PHASE_1.points, '件数 (入院のみ 60点)'],
    ['早期加算(Ⅱ) 5〜14日目', early2DaysTotal, REHA_RULES.EARLY_BONUS.PHASE_2.points, '件数 (入院のみ 25点)'],
    ['総合実施計画書1 (初回)', planStats.PLAN_1_FIRST, REHA_RULES.PLAN_POINTS.PLAN_1_FIRST, '件数 (300点)'],
    ['総合実施計画書1 (2回目以降)', planStats.PLAN_1_FOLLOW, REHA_RULES.PLAN_POINTS.PLAN_1_FOLLOW, '件数 (240点)'],
    ['総合実施計画書2 (初回)', planStats.PLAN_2_FIRST, REHA_RULES.PLAN_POINTS.PLAN_2_FIRST, '件数 (要介護3分の1到達 240点)'],
    ['総合実施計画書2 (2回目以降:固定)', planStats.PLAN_2_FOLLOW, REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW, '件数 (要介護3分の1継続 196点)']
  ];

  let rIdx = 4;
  let grandTotalPoints = 0;
  rows.forEach((rData, i) => {
    const qty = rData[1];
    const pts = rData[2];
    const totPts = qty * pts;
    grandTotalPoints += totPts;
    const bg = (i % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    setStyledCell(ws, rIdx, 1, rData[0], { ...STYLES.cellNormal, fill: bg });
    setStyledCell(ws, rIdx, 2, qty, { ...STYLES.cellCenter, fill: bg, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 3, pts, { ...STYLES.cellCenter, fill: bg, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 4, totPts, { ...STYLES.cellNormal, alignment: { horizontal: 'right' }, fill: bg, numFmt: '#,##0', font: { bold: true } });
    setStyledCell(ws, rIdx, 5, totPts * 10, { ...STYLES.cellNormal, alignment: { horizontal: 'right' }, fill: bg, numFmt: '¥#,##0', font: { bold: true, color: { rgb: '047857' } } });
    setStyledCell(ws, rIdx, 6, rData[3], { ...STYLES.cellNormal, fill: bg, font: { sz: 7.5, color: { rgb: '64748b' } } });
    rIdx++;
  });

  const totalBorder = { top: { style: 'thin', color: { rgb: '0F172A' } }, bottom: { style: 'double', color: { rgb: '0F172A' } } };
  const totalFill = { fgColor: { rgb: 'ECFDF5' } };

  setStyledCell(ws, rIdx, 1, '【レセプト総確定 合計】', { font: { name: 'Meiryo UI', sz: 8.5, bold: true }, fill: totalFill, border: totalBorder });
  setStyledCell(ws, rIdx, 2, '-', { alignment: { horizontal: 'center' }, fill: totalFill, border: totalBorder });
  setStyledCell(ws, rIdx, 3, '-', { alignment: { horizontal: 'center' }, fill: totalFill, border: totalBorder });
  setStyledCell(ws, rIdx, 4, grandTotalPoints, { alignment: { horizontal: 'right' }, font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '0F172A' } }, fill: totalFill, border: totalBorder, numFmt: '#,##0' });
  setStyledCell(ws, rIdx, 5, grandTotalPoints * 10, { alignment: { horizontal: 'right' }, font: { name: 'Meiryo UI', sz: 10, bold: true, color: { rgb: '047857' } }, fill: totalFill, border: totalBorder, numFmt: '¥#,##0' });
  setStyledCell(ws, rIdx, 6, 'レセプト総収益（保険点数×10円）', { font: { sz: 7.5, color: { rgb: '047857' }, bold: true }, fill: totalFill, border: totalBorder });

  // セル幅を十分な余白付きで拡張（文字切れ完全防止）
  setSheetCols(ws, [34, 14, 10, 13, 18, 30]);
  applyA4LandscapePrintSetup(ws, true); // サマリーは1枚収容
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, SUMMARY_SHEET);
}

function writeYearlyTrendSheet(wb, targetYear) {
  const ws = {};
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // 当年1月〜12月の集計データを一括収集
  const monthlyData = months.map((m) => {
    try {
      return aggregateFromAppSchedule(targetYear, m);
    } catch (_) {
      return { patientMap: {}, dailyBreakdown: {} };
    }
  });

  // 月別・入院/外来別スタッツ集計コンテナ
  const inStats = months.map(() => ({ loco: 0, cerebro: 0, disuse: 0, earlyPts: 0, planPts: 0, totalUnits: 0, totalAmount: 0 }));
  const outStats = months.map(() => ({ loco: 0, cerebro: 0, disuse: 0, analgesia: 0, planPts: 0, totalUnits: 0, totalAmount: 0 }));

  monthlyData.forEach((mAgg, mIdx) => {
    Object.values(mAgg.patientMap || {}).forEach((item) => {
      const p = item.patient;
      const isInput = p.category === 'INPATIENT';
      const stats = isInput ? inStats[mIdx] : outStats[mIdx];
      const baseEarlyDate = getEarlyBaseDate(p);

      const earlyDatesCounted = new Set();
      item.slots.forEach((s) => {
        if (s.isAnalgesia) {
          if (!isInput) {
            stats.analgesia += 1;
            stats.totalAmount += 35 * 10;
          }
        } else {
          const u = s.units || 1;
          const dType = (p.diseaseType && p.diseaseType !== 'ANALGESIA') ? p.diseaseType : 'LOCOMOTIVE';
          const unitPts = REHA_RULES.LIMIT_DAYS[dType]?.defaultPoints || 170;

          if (dType === 'LOCOMOTIVE') stats.loco += u;
          else if (dType === 'CEREBROVASCULAR') stats.cerebro += u;
          else if (dType === 'DISUSE') stats.disuse += u;

          stats.totalUnits += u;
          stats.totalAmount += u * unitPts * 10;

          if (s.billingPlan && REHA_RULES.PLAN_POINTS[s.billingPlan]) {
            const pPts = REHA_RULES.PLAN_POINTS[s.billingPlan];
            stats.planPts += pPts;
            stats.totalAmount += pPts * 10;
          }

          if (isInput && baseEarlyDate && s.date && !earlyDatesCounted.has(s.date)) {
            earlyDatesCounted.add(s.date);
            const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
            if (ph.points > 0) {
              stats.earlyPts += ph.points;
              stats.totalAmount += ph.points * 10;
            }
          }
        }
      });
    });
  });

  // タイトル
  setStyledCell(ws, 0, 0, `【${targetYear}年 リハビリテーション科 年間推移表 (入院・外来別 / 1月〜12月)】`, {
    font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: '0F172A' } }
  });

  const mHeaders = months.map((m) => `${m}月`);
  const headerCols = ['区分 / 算定項目', ...mHeaders, '年間累計'];

  const renderSectionHeader = (rowIdx, title) => {
    headerCols.forEach((h, cIdx) => {
      setStyledCell(ws, rowIdx, cIdx, cIdx === 0 ? title : h, STYLES.headerNavy);
    });
  };

  const renderDataRow = (rowIdx, label, dataArr, isCurrency = false, isBold = false) => {
    const total = dataArr.reduce((acc, val) => acc + val, 0);
    const bg = isBold ? { fgColor: { rgb: 'F1F5F9' } } : { fgColor: { rgb: 'FFFFFF' } };

    setStyledCell(ws, rowIdx, 0, label, { ...STYLES.cellNormal, font: { ...STYLES.cellNormal.font, bold: isBold }, fill: bg });
    dataArr.forEach((v, idx) => {
      setStyledCell(ws, rowIdx, idx + 1, v, {
        ...STYLES.cellNormal,
        alignment: { horizontal: 'right', vertical: 'center' },
        fill: bg,
        numFmt: isCurrency ? '¥#,##0' : '#,##0',
        font: { bold: isBold }
      });
    });
    setStyledCell(ws, rowIdx, 13, total, {
      ...STYLES.cellNormal,
      alignment: { horizontal: 'right', vertical: 'center' },
      fill: isBold ? { fgColor: { rgb: 'E2E8F0' } } : { fgColor: { rgb: 'F8FAFC' } },
      numFmt: isCurrency ? '¥#,##0' : '#,##0',
      font: { bold: true, color: isCurrency ? { rgb: '047857' } : { rgb: '0F172A' } }
    });
  };

  // 1. 【入院セクション】
  let curR = 2;
  renderSectionHeader(curR, '【入院】算定項目');
  curR++;
  renderDataRow(curR++, '運動器リハ(Ⅱ) (単位)', inStats.map((s) => s.loco));
  renderDataRow(curR++, '脳血管等リハ(Ⅲ) (単位)', inStats.map((s) => s.cerebro));
  renderDataRow(curR++, '廃用症候群(Ⅲ) (単位)', inStats.map((s) => s.disuse));
  renderDataRow(curR++, '入院 個別リハ 総単位', inStats.map((s) => s.totalUnits), false, true);
  renderDataRow(curR++, '入院 早期加算 (点数計)', inStats.map((s) => s.earlyPts));
  renderDataRow(curR++, '入院 総合計画書 (点数計)', inStats.map((s) => s.planPts));
  renderDataRow(curR++, '【入院 総売上金額 (¥)】', inStats.map((s) => s.totalAmount), true, true);

  // 2. 【外来セクション】
  curR += 2;
  renderSectionHeader(curR, '【外来】算定項目');
  curR++;
  renderDataRow(curR++, '運動器リハ(Ⅱ) (単位)', outStats.map((s) => s.loco));
  renderDataRow(curR++, '脳血管等リハ(Ⅲ) (単位)', outStats.map((s) => s.cerebro));
  renderDataRow(curR++, '廃用症候群(Ⅲ) (単位)', outStats.map((s) => s.disuse));
  renderDataRow(curR++, '外来 個別リハ 総単位', outStats.map((s) => s.totalUnits), false, true);
  renderDataRow(curR++, '消炎鎮痛等処置 (回数)', outStats.map((s) => s.analgesia));
  renderDataRow(curR++, '外来 総合計画書 (点数計)', outStats.map((s) => s.planPts));
  renderDataRow(curR++, '【外来 総売上金額 (¥)】', outStats.map((s) => s.totalAmount), true, true);

  // 3. 【全体総合計セクション】
  curR += 2;
  renderSectionHeader(curR, '【総合計】入外合算');
  curR++;
  const grandUnits = months.map((_, i) => inStats[i].totalUnits + outStats[i].totalUnits);
  const grandAnalgesia = months.map((_, i) => outStats[i].analgesia);
  const grandAmounts = months.map((_, i) => inStats[i].totalAmount + outStats[i].totalAmount);

  renderDataRow(curR++, '全個別リハ 総単位 (単位)', grandUnits, false, true);
  renderDataRow(curR++, '消炎鎮痛処置 総件数 (件)', grandAnalgesia);
  renderDataRow(curR++, '【リハ科 総売上金額 (¥)】', grandAmounts, true, true);

  // 列幅設定（項目名26、各月8.2、年間累計13.5）
  const colWidths = [26];
  for (let m = 1; m <= 12; m++) colWidths.push(8.5);
  colWidths.push(14);
  setSheetCols(ws, colWidths);

  applyA4LandscapePrintSetup(ws, true); // 年間推移もA4横1枚に綺麗に収容
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, YEARLY_TREND_SHEET);
}

function writeRehaPatientSheet(wb, aggregated, category, sheetName, patients) {
  const { daysInMonth, year, month } = aggregated;
  const isInput = category === 'INPATIENT';
  const ws = {};
  const dayOfWeekNames = ['日', '月', '火', '水', '木', '金', '土'];

  setStyledCell(ws, 0, 0, `【${year}年${month}月 ${sheetName} (個別リハビリ実施リスト)】`, {
    font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '0F172A' } }
  });

  setStyledCell(ws, 1, 0, '患者ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '患者氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '区分', STYLES.headerNavy);
  setStyledCell(ws, 1, 3, '介護', STYLES.headerNavy);
  setStyledCell(ws, 1, 4, '総単位', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '0369A1' } } });

  const dayColStart = 5;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dayOfWeek = dateObj.getDay();
    const col = dayColStart + (d - 1);
    const hLabel = `${d}\n${dayOfWeekNames[dayOfWeek]}`;

    let style = STYLES.headerNavy;
    if (dayOfWeek === 6) style = STYLES.headerSat;
    else if (dayOfWeek === 0) style = STYLES.headerSun;
    setStyledCell(ws, 1, col, hLabel, style);
  }

  const extraCol = dayColStart + daysInMonth;
  if (isInput) {
    setStyledCell(ws, 1, extraCol, '早期Ⅰ', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 1, '早期Ⅱ', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 2, '計画日', STYLES.headerNavy);
  } else {
    setStyledCell(ws, 1, extraCol, '計画日', STYLES.headerNavy);
  }

  let curRow = 2;
  patients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
    const baseEarlyDate = getEarlyBaseDate(p);

    const planDatesSet = new Set();
    const early1DatesSet = new Set();
    const early2DatesSet = new Set();
    let early1Units = 0;
    let early2Units = 0;
    let planDateStr = '';

    item.slots.forEach((s) => {
      const u = s.units || 1;
      if (s.billingPlan) {
        planDateStr = s.date ? s.date.slice(5) : '';
        planDatesSet.add(parseInt(s.date.split('-')[2], 10));
      }
      if (isInput && baseEarlyDate && s.date && !s.isAnalgesia) {
        const dNum = parseInt(s.date.split('-')[2], 10);
        const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
        if (ph.phase === 'PHASE_1') {
          early1DatesSet.add(dNum);
          early1Units += u;
        } else if (ph.phase === 'PHASE_2') {
          early2DatesSet.add(dNum);
          early2Units += u;
        }
      }
    });

    const displayDisType = (p.diseaseType && p.diseaseType !== 'ANALGESIA') ? p.diseaseType : 'LOCOMOTIVE';
    const totalRehaUnits = item.rehaTotalUnits !== undefined ? item.rehaTotalUnits : item.totalUnits;

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, getDiseaseInitial(displayDisType), { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 3, p.careInsuranceType === 'CARE' ? '介護' : (p.careInsuranceType === 'SUPPORT' ? '支援' : '-'), { ...STYLES.cellCenter, fill: zebraBg });
    
    setStyledCell(ws, curRow, 4, totalRehaUnits, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'E0F2FE' } },
      font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '0369A1' } },
      numFmt: '#,##0'
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const col = dayColStart + (d - 1);
      const u = item.dailyRehaUnits ? (item.dailyRehaUnits[d] || 0) : (item.dailyUnits[d] || 0);
      const isPlanDay = planDatesSet.has(d);
      const isEarly1Day = early1DatesSet.has(d);
      const isEarly2Day = early2DatesSet.has(d);

      let cellStyle = { ...STYLES.cellUnit };
      if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
      else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
      else cellStyle.fill = zebraBg;

      if (u > 0) {
        if (isPlanDay) {
          setStyledCell(ws, curRow, col, `${u}★`, STYLES.cellPlanStar);
        } else if (isEarly1Day) {
          setStyledCell(ws, curRow, col, u, STYLES.cellEarly1);
        } else if (isEarly2Day) {
          setStyledCell(ws, curRow, col, u, STYLES.cellEarly2);
        } else {
          setStyledCell(ws, curRow, col, u, cellStyle);
        }
      } else {
        setStyledCell(ws, curRow, col, '', cellStyle);
      }
    }

    if (isInput) {
      setStyledCell(ws, curRow, extraCol, early1Units > 0 ? early1Units : '-', {
        ...STYLES.cellCenter,
        fill: early1Units > 0 ? { fgColor: { rgb: 'D1FAE5' } } : zebraBg,
        font: { bold: early1Units > 0 }
      });
      setStyledCell(ws, curRow, extraCol + 1, early2Units > 0 ? early2Units : '-', {
        ...STYLES.cellCenter,
        fill: early2Units > 0 ? { fgColor: { rgb: 'DBEAFE' } } : zebraBg,
        font: { bold: early2Units > 0 }
      });
      setStyledCell(ws, curRow, extraCol + 2, planDateStr || '-', { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true, color: { rgb: 'B45309' } } });
    } else {
      setStyledCell(ws, curRow, extraCol, planDateStr || '-', { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true, color: { rgb: 'B45309' } } });
    }

    curRow++;
  });

  const colProps = [
    { wch: 4.2 },       // 患者ID
    { wpx: 100 },       // 患者氏名 (100px固定)
    { wch: 2.8 },       // 区分
    { wch: 3.0 },       // 介護
    { wch: 4.5 }        // 総単位
  ];
  for (let d = 1; d <= daysInMonth; d++) colProps.push({ wch: 1.9 });
  if (isInput) colProps.push({ wch: 3.5 }, { wch: 3.5 }, { wch: 4.2 });
  else colProps.push({ wch: 4.2 });
  ws['!cols'] = colProps;

  // オートフィルターを「患者ID」「患者氏名」「区分」「介護」（col 0〜3）のみに限定
  ws['!autofilter'] = {
    ref: window.XLSX.utils.encode_range({ r: 1, c: 0 }, { r: Math.max(1, curRow - 1), c: 3 })
  };

  ws['!freeze'] = { xSplit: 'E', ySplit: '2', topLeftCell: 'F3', activePane: 'bottomRight', state: 'frozen' };

  // 横1枚固定・縦方向は自然改ページ許可
  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}

function writeAnalgesiaDedicatedSheet(wb, aggregated, sheetName) {
  const { daysInMonth, patientMap, year, month } = aggregated;
  const ws = {};
  const dayOfWeekNames = ['日', '月', '火', '水', '木', '金', '土'];

  setStyledCell(ws, 0, 0, `【${year}年${month}月 ${sheetName} (1日1回35点 / 入外合同)】`, {
    font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '15803D' } }
  });

  setStyledCell(ws, 1, 0, '患者ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '患者氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '区分', STYLES.headerNavy);
  setStyledCell(ws, 1, 3, '疾患名 / 部位', STYLES.headerNavy);
  setStyledCell(ws, 1, 4, '回数', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '15803D' } } });
  setStyledCell(ws, 1, 5, '総点数', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '15803D' } } });

  const dayColStart = 6;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dayOfWeek = dateObj.getDay();
    const col = dayColStart + (d - 1);
    const hLabel = `${d}\n${dayOfWeekNames[dayOfWeek]}`;

    let style = STYLES.headerNavy;
    if (dayOfWeek === 6) style = STYLES.headerSat;
    else if (dayOfWeek === 0) style = STYLES.headerSun;
    setStyledCell(ws, 1, col, hLabel, style);
  }

  const extraCol = dayColStart + daysInMonth;
  setStyledCell(ws, 1, extraCol, '備考', STYLES.headerNavy);

  const analgesiaPatients = Object.values(patientMap)
    .filter((item) => {
      const anaDays = item.totalAnalgesiaDays !== undefined ? item.totalAnalgesiaDays : (item.slots ? item.slots.filter((s) => s.isAnalgesia).length : 0);
      return anaDays > 0 || (item.patient.diseaseType === 'ANALGESIA' && item.totalUnits > 0);
    })
    .sort((a, b) => a.patient.id.localeCompare(b.patient.id, 'ja', { numeric: true }));

  let curRow = 2;
  analgesiaPatients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    const analgesiaDaysSet = new Set();
    if (item.dailyAnalgesia) {
      for (let d = 1; d <= daysInMonth; d++) {
        if (item.dailyAnalgesia[d] > 0) analgesiaDaysSet.add(d);
      }
    }
    if (analgesiaDaysSet.size === 0 && item.slots) {
      item.slots.forEach((s) => {
        if (s.isAnalgesia && s.date) analgesiaDaysSet.add(parseInt(s.date.split('-')[2], 10));
      });
    }
    if (analgesiaDaysSet.size === 0 && p.diseaseType === 'ANALGESIA') {
      for (let d = 1; d <= daysInMonth; d++) {
        if (item.dailyUnits[d] > 0) analgesiaDaysSet.add(d);
      }
    }

    const catLabel = p.category === 'INPATIENT' ? '入' : '外';
    const totalDays = item.totalAnalgesiaDays !== undefined && item.totalAnalgesiaDays > 0 ? item.totalAnalgesiaDays : analgesiaDaysSet.size;
    const totalPoints = totalDays * 35;

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, catLabel, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 3, p.diseaseName || '消炎鎮痛等処置', { ...STYLES.cellNormal, fill: zebraBg, font: { sz: 7 } });

    setStyledCell(ws, curRow, 4, totalDays, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'DCFCE7' } },
      font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '15803D' } },
      numFmt: '#,##0'
    });

    setStyledCell(ws, curRow, 5, totalPoints, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'DCFCE7' } },
      font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '15803D' } },
      numFmt: '#,##0'
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const col = dayColStart + (d - 1);
      const isDone = analgesiaDaysSet.has(d);

      let cellStyle = { ...STYLES.cellCenter };
      if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
      else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
      else cellStyle.fill = zebraBg;

      if (isDone) {
        setStyledCell(ws, curRow, col, '○', { ...STYLES.cellCenter, fill: { fgColor: { rgb: 'DCFCE7' } }, font: { bold: true, color: { rgb: '15803D' } } });
      } else {
        setStyledCell(ws, curRow, col, '', cellStyle);
      }
    }

    setStyledCell(ws, curRow, extraCol, p.notes || '', { ...STYLES.cellNormal, fill: zebraBg });
    curRow++;
  });

  const colProps = [
    { wch: 4.0 },       // 患者ID
    { wpx: 100 },       // 患者氏名 (100px固定)
    { wch: 2.8 },       // 区分
    { wch: 8.5 },       // 疾患名
    { wch: 3.8 },       // 回数
    { wch: 4.5 }        // 総点数
  ];
  for (let d = 1; d <= daysInMonth; d++) colProps.push({ wch: 1.85 });
  colProps.push({ wch: 5.0 });
  ws['!cols'] = colProps;

  ws['!autofilter'] = {
    ref: window.XLSX.utils.encode_range({ r: 1, c: 0 }, { r: Math.max(1, curRow - 1), c: 3 })
  };

  ws['!freeze'] = { xSplit: 'F', ySplit: '2', topLeftCell: 'G3', activePane: 'bottomRight', state: 'frozen' };

  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}

function applyA4LandscapePrintSetup(ws, singlePageOnly = false) {
  ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
  ws['!properties'] = { pageSetUpPr: { fitToPage: true } };
  ws['!pageSetup'] = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToWidth: 1, // 横幅は必ず1ページ幅に自動収容
    fitToHeight: singlePageOnly ? 1 : 0, // サマリーは1枚収容、リスト系は縦の自然改ページを許可
    fitToPage: true
  };
  ws['!margins'] = { left: 0.1, right: 0.1, top: 0.2, bottom: 0.2, header: 0.05, footer: 0.05 };
}

function setStyledCell(ws, r, c, val, style = {}) {
  const addr = window.XLSX.utils.encode_cell({ r, c });
  if (val === '' || val === null || val === undefined) {
    ws[addr] = { t: 's', v: '', s: style };
    return;
  }
  const isNum = typeof val === 'number';
  ws[addr] = { t: isNum ? 'n' : 's', v: val, s: style };
}

function setSheetCols(ws, widthList) {
  ws['!cols'] = widthList.map((w) => ({ wch: w }));
}

function updateSheetRange(ws) {
  const keys = Object.keys(ws).filter((k) => !k.startsWith('!'));
  if (keys.length === 0) return;
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  keys.forEach((k) => {
    const cell = window.XLSX.utils.decode_cell(k);
    if (cell.r < minR) minR = cell.r;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c < minC) minC = cell.c;
    if (cell.c > maxC) maxC = cell.c;
  });
  ws['!ref'] = window.XLSX.utils.encode_range({ r: minR, c: minC }, { r: maxR, c: maxC });
}

function appendOrReplaceSheet(wb, ws, name) {
  const existingIdx = wb.SheetNames.indexOf(name);
  if (existingIdx >= 0) wb.Sheets[name] = ws;
  else window.XLSX.utils.book_append_sheet(wb, ws, name);
}
