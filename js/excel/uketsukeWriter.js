// js/excel/uketsukeWriter.js
// 受付提出用Excel生成層（A4横1枚完全収容 / 早期Ⅱはみ出し解消 / 早期完全集計 / 日別カラー / 200行制限準拠）

import { REHA_RULES } from '../config/rules.js';
import { evaluateEarlyBonusPhase } from '../core/deadlineCalc.js';

const SUMMARY_SHEET = 'レセプト収益サマリー';
const INPATIENT_SHEET = '実施ﾘｽﾄ 入院';
const OUTPATIENT_SHEET = '実施ﾘｽﾄ 外来';
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

export function generateUketsukeWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();

  writeExecutiveSummarySheet(wb, aggregated);
  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', INPATIENT_SHEET);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', OUTPATIENT_SHEET);
  writeAnalgesiaDedicatedSheet(wb, aggregated, ANALGESIA_SHEET);

  return wb;
}

function getEarlyBaseDate(p) {
  return p.earlyBonusStartDate || p.admissionDate || p.onsetDate || '';
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

    if (p.diseaseType !== 'ANALGESIA') {
      if (diseaseStats[p.diseaseType] !== undefined) diseaseStats[p.diseaseType] += item.totalUnits;
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

  setSheetCols(ws, [26, 12, 9, 11, 15, 22]);
  applyA4LandscapePrintSetup(ws);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, SUMMARY_SHEET);
}

function writeRehaPatientSheet(wb, aggregated, category, sheetName) {
  const { daysInMonth, patientMap, year, month } = aggregated;
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
    setStyledCell(ws, 1, extraCol + 3, '計画書区分・点数', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 4, '備考', STYLES.headerNavy);
  } else {
    setStyledCell(ws, 1, extraCol, '計画日', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 1, '計画書区分・点数', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 2, '備考', STYLES.headerNavy);
  }

  const patients = Object.values(patientMap).filter(
    (item) => item.patient.category === category && item.patient.diseaseType !== 'ANALGESIA' && item.totalUnits > 0
  );

  let curRow = 2;
  patients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
    const baseEarlyDate = getEarlyBaseDate(p);

    const planDatesSet = new Set();
    const early1DatesSet = new Set();
    const early2DatesSet = new Set();
    let planDateStr = '', planLabel = '';

    item.slots.forEach((s) => {
      if (s.billingPlan) {
        planDateStr = s.date ? s.date.slice(5) : '';
        planLabel = formatPlanLabel(s.billingPlan);
        planDatesSet.add(parseInt(s.date.split('-')[2], 10));
      }
      if (isInput && baseEarlyDate && s.date && !s.isAnalgesia) {
        const dNum = parseInt(s.date.split('-')[2], 10);
        const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
        if (ph.phase === 'PHASE_1') early1DatesSet.add(dNum);
        else if (ph.phase === 'PHASE_2') early2DatesSet.add(dNum);
      }
    });

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, REHA_RULES.LIMIT_DAYS[p.diseaseType]?.shortLabel || p.diseaseType, { ...STYLES.cellCenter, fill: zebraBg });
    setStyledCell(ws, curRow, 3, p.careInsuranceType === 'CARE' ? '介護' : (p.careInsuranceType === 'SUPPORT' ? '支援' : '-'), { ...STYLES.cellCenter, fill: zebraBg });
    
    setStyledCell(ws, curRow, 4, item.totalUnits, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'E0F2FE' } },
      font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '0369A1' } },
      numFmt: '#,##0'
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const col = dayColStart + (d - 1);
      const u = item.dailyUnits[d] || 0;
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
      const e1Count = early1DatesSet.size;
      const e2Count = early2DatesSet.size;
      setStyledCell(ws, curRow, extraCol, e1Count > 0 ? `${e1Count}日` : '-', { ...STYLES.cellCenter, fill: e1Count > 0 ? { fgColor: { rgb: 'D1FAE5' } } : zebraBg, font: { bold: e1Count > 0 } });
      setStyledCell(ws, curRow, extraCol + 1, e2Count > 0 ? `${e2Count}日` : '-', { ...STYLES.cellCenter, fill: e2Count > 0 ? { fgColor: { rgb: 'DBEAFE' } } : zebraBg, font: { bold: e2Count > 0 } });
      setStyledCell(ws, curRow, extraCol + 2, planDateStr || '-', { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true, color: { rgb: 'B45309' } } });
      setStyledCell(ws, curRow, extraCol + 3, planLabel || '-', { ...STYLES.cellNormal, fill: zebraBg, font: { sz: 7 } });
      setStyledCell(ws, curRow, extraCol + 4, p.notes || '', { ...STYLES.cellNormal, fill: zebraBg });
    } else {
      setStyledCell(ws, curRow, extraCol, planDateStr || '-', { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true, color: { rgb: 'B45309' } } });
      setStyledCell(ws, curRow, extraCol + 1, planLabel || '-', { ...STYLES.cellNormal, fill: zebraBg, font: { sz: 7 } });
      setStyledCell(ws, curRow, extraCol + 2, p.notes || '', { ...STYLES.cellNormal, fill: zebraBg });
    }

    curRow++;
  });

  // A4横1枚（縮小なしでも合計97幅で完全収容）
  const colWidths = [4.0, 7.5, 3.2, 2.8, 4.2];
  for (let d = 1; d <= daysInMonth; d++) colWidths.push(1.85);
  if (isInput) colWidths.push(3.2, 3.2, 3.8, 8.5, 4.5);
  else colWidths.push(3.8, 8.5, 4.5);
  setSheetCols(ws, colWidths);

  ws['!freeze'] = { xSplit: 'E', ySplit: '2', topLeftCell: 'F3', activePane: 'bottomRight', state: 'frozen' };

  applyA4LandscapePrintSetup(ws);
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

  const analgesiaPatients = Object.values(patientMap).filter((item) => {
    return item.patient.diseaseType === 'ANALGESIA' || item.slots.some((s) => s.isAnalgesia);
  });

  let curRow = 2;
  analgesiaPatients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    const analgesiaDaysSet = new Set();
    item.slots.forEach((s) => {
      if (s.isAnalgesia && s.date) analgesiaDaysSet.add(parseInt(s.date.split('-')[2], 10));
    });

    if (p.diseaseType === 'ANALGESIA' && analgesiaDaysSet.size === 0) {
      for (let d = 1; d <= daysInMonth; d++) {
        if (item.dailyUnits[d] > 0) analgesiaDaysSet.add(d);
      }
    }

    const catLabel = p.category === 'INPATIENT' ? '入院' : '外来';
    const totalDays = analgesiaDaysSet.size;
    const totalPoints = totalDays * 35;

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, catLabel, { ...STYLES.cellCenter, fill: zebraBg });
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

  const colWidths = [4.0, 7.5, 3.0, 8.5, 3.8, 4.5];
  for (let d = 1; d <= daysInMonth; d++) colWidths.push(1.85);
  colWidths.push(5.0);
  setSheetCols(ws, colWidths);

  ws['!freeze'] = { xSplit: 'F', ySplit: '2', topLeftCell: 'G3', activePane: 'bottomRight', state: 'frozen' };

  applyA4LandscapePrintSetup(ws);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}

function applyA4LandscapePrintSetup(ws) {
  ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
  ws['!properties'] = { pageSetUpPr: { fitToPage: true } };
  ws['!pageSetup'] = {
    paperSize: 9, // A4
    orientation: 'landscape', // 横向き
    fitToWidth: 1, // 横幅は絶対に1ページに収める
    fitToHeight: 99, // 縦は行数に応じて自然改ページ
    fitToPage: true
  };
  ws['!margins'] = { left: 0.1, right: 0.1, top: 0.2, bottom: 0.2, header: 0.05, footer: 0.05 };
}

function formatPlanLabel(planKey) {
  switch (planKey) {
    case 'PLAN_1_FIRST': return '計1(初300)';
    case 'PLAN_1_FOLLOW': return '計1(継240)';
    case 'PLAN_2_FIRST': return '計2(初240)';
    case 'PLAN_2_FOLLOW': return '計2(継196)';
    default: return planKey;
  }
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
