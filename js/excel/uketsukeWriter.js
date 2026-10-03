// js/excel/uketsukeWriter.js
// 受付提出用Excel生成層（A4横1枚印刷完全最適化 / 1日〜31日フィット / 経営サマリー美装）

import { REHA_RULES } from '../config/rules.js';
import { calculatePatientDeadlines, evaluateEarlyBonusPhase } from '../core/deadlineCalc.js';

const SUMMARY_SHEET = 'レセプト収益サマリー';
const INPATIENT_SHEET = '実施ﾘｽﾄ 入院';
const OUTPATIENT_SHEET = '実施ﾘｽﾄ 外来';

// 美装デザイン用スタイル定数
const STYLES = {
  headerNavy: {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  },
  headerSat: {
    font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'DBEAFE' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  },
  headerSun: {
    font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '991B1B' } },
    fill: { fgColor: { rgb: 'FEE2E2' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  },
  cellNormal: {
    font: { name: 'Meiryo UI', sz: 8.5 },
    alignment: { vertical: 'center' },
    border: thinBorder()
  },
  cellCenter: {
    font: { name: 'Meiryo UI', sz: 8.5 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellUnit: {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '0F172A' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellPlanStar: {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: 'B45309' } },
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

/**
 * 受付提出用ワークブック生成（A4横1ページ印刷完全対応）
 */
export function generateUketsukeWorkbook(aggregated, templateBuffer = null) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');

  let wb = templateBuffer ? window.XLSX.read(templateBuffer, { type: 'array' }) : window.XLSX.utils.book_new();

  writeExecutiveSummarySheet(wb, aggregated);
  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', INPATIENT_SHEET);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', OUTPATIENT_SHEET);

  return wb;
}

/**
 * 経営者向け: レセプト総確定・収益サマリーシート
 */
function writeExecutiveSummarySheet(wb, aggregated) {
  const { patientMap, year, month } = aggregated;
  const ws = {};
  const diseaseStats = { LOCOMOTIVE: 0, CEREBROVASCULAR: 0, DISUSE: 0, ANALGESIA: 0 };
  let early1Count = 0, early2Count = 0;
  const planStats = { PLAN_1_FIRST: 0, PLAN_1_FOLLOW: 0, PLAN_2_FIRST: 0, PLAN_2_FOLLOW: 0 };

  Object.values(patientMap).forEach((item) => {
    const p = item.patient;
    if (diseaseStats[p.diseaseType] !== undefined) {
      diseaseStats[p.diseaseType] += (p.diseaseType === 'ANALGESIA' ? item.slots.length : item.totalUnits);
    }
    item.slots.forEach((s) => {
      if (s.billingPlan && planStats[s.billingPlan] !== undefined) planStats[s.billingPlan]++;
      if (p.category === 'INPATIENT' && !s.isAnalgesia) {
        const ph = evaluateEarlyBonusPhase(p.earlyBonusStartDate || p.admissionDate, s.date, 'INPATIENT');
        if (ph.phase === 'PHASE_1') early1Count++;
        else if (ph.phase === 'PHASE_2') early2Count++;
      }
    });
  });

  setStyledCell(ws, 1, 1, `【${year}年${month}月 リハビリテーション科 レセプト確定・経営収益サマリー】`, {
    font: { name: 'Meiryo UI', sz: 13, bold: true, color: { rgb: '0F172A' } }
  });

  const headers = ['項目 / 算定区分', '算定対象 (単位/回)', '単価点数', '総点数', '総売上金額 (¥)', '備考・算定区分'];
  headers.forEach((h, idx) => setStyledCell(ws, 3, idx + 1, h, STYLES.headerNavy));

  const rows = [
    ['運動器リハビリテーション(Ⅱ)', diseaseStats.LOCOMOTIVE, REHA_RULES.LIMIT_DAYS.LOCOMOTIVE.defaultPoints, '単位'],
    ['脳血管疾患等リハビリテーション(Ⅲ)', diseaseStats.CEREBROVASCULAR, REHA_RULES.LIMIT_DAYS.CEREBROVASCULAR.defaultPoints, '単位'],
    ['廃用症候群リハビリテーション(Ⅲ)', diseaseStats.DISUSE, REHA_RULES.LIMIT_DAYS.DISUSE.defaultPoints, '単位'],
    ['消炎鎮痛等処置 (物療)', diseaseStats.ANALGESIA, 35, '件数 (1日1回35点)'],
    ['早期加算(Ⅰ) 1〜4日目', early1Count, REHA_RULES.EARLY_BONUS.PHASE_1.points, '件数 (入院のみ)'],
    ['早期加算(Ⅱ) 5〜14日目', early2Count, REHA_RULES.EARLY_BONUS.PHASE_2.points, '件数 (入院のみ)'],
    ['総合実施計画書1 (初回)', planStats.PLAN_1_FIRST, REHA_RULES.PLAN_POINTS.PLAN_1_FIRST, '件数 (300点)'],
    ['総合実施計画書1 (2回目以降)', planStats.PLAN_1_FOLLOW, REHA_RULES.PLAN_POINTS.PLAN_1_FOLLOW, '件数 (240点)'],
    ['総合実施計画書2 (初回)', planStats.PLAN_2_FIRST, REHA_RULES.PLAN_POINTS.PLAN_2_FIRST, '件数 (要介護3分の1到達)'],
    ['総合実施計画書2 (2回目以降:固定)', planStats.PLAN_2_FOLLOW, REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW, '件数 (要介護3分の1継続 196点)']
  ];

  let rIdx = 4;
  let grandTotalPoints = 0;
  rows.forEach((rData, i) => {
    const qty = rData[1];
    const pts = rData[2];
    const totPts = qty * pts;
    const totAmount = totPts * 10;
    grandTotalPoints += totPts;
    const bg = (i % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    setStyledCell(ws, rIdx, 1, rData[0], { ...STYLES.cellNormal, fill: bg });
    setStyledCell(ws, rIdx, 2, qty, { ...STYLES.cellCenter, fill: bg, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 3, pts, { ...STYLES.cellCenter, fill: bg, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 4, totPts, { ...STYLES.cellNormal, alignment: { horizontal: 'right' }, fill: bg, numFmt: '#,##0', font: { bold: true } });
    setStyledCell(ws, rIdx, 5, totAmount, { ...STYLES.cellNormal, alignment: { horizontal: 'right' }, fill: bg, numFmt: '¥#,##0', font: { bold: true, color: { rgb: '047857' } } });
    setStyledCell(ws, rIdx, 6, rData[3], { ...STYLES.cellNormal, fill: bg, font: { sz: 8.5, color: { rgb: '64748b' } } });
    rIdx++;
  });

  const totalBorder = {
    top: { style: 'thin', color: { rgb: '0F172A' } },
    bottom: { style: 'double', color: { rgb: '0F172A' } },
    left: { style: 'thin', color: { rgb: 'CBD5E1' } },
    right: { style: 'thin', color: { rgb: 'CBD5E1' } }
  };
  const totalFill = { fgColor: { rgb: 'ECFDF5' } };

  setStyledCell(ws, rIdx, 1, '【レセプト総確定 合計】', { font: { name: 'Meiryo UI', sz: 9.5, bold: true }, fill: totalFill, border: totalBorder });
  setStyledCell(ws, rIdx, 2, '-', { alignment: { horizontal: 'center' }, fill: totalFill, border: totalBorder });
  setStyledCell(ws, rIdx, 3, '-', { alignment: { horizontal: 'center' }, fill: totalFill, border: totalBorder });
  setStyledCell(ws, rIdx, 4, grandTotalPoints, { alignment: { horizontal: 'right' }, font: { name: 'Meiryo UI', sz: 10.5, bold: true, color: { rgb: '0F172A' } }, fill: totalFill, border: totalBorder, numFmt: '#,##0' });
  setStyledCell(ws, rIdx, 5, grandTotalPoints * 10, { alignment: { horizontal: 'right' }, font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: '047857' } }, fill: totalFill, border: totalBorder, numFmt: '¥#,##0' });
  setStyledCell(ws, rIdx, 6, 'レセプト総収益（保険点数×10円）', { font: { sz: 8.5, color: { rgb: '047857' }, bold: true }, fill: totalFill, border: totalBorder });

  setSheetCols(ws, [30, 16, 12, 14, 18, 26]);
  applyA4LandscapePrintSetup(ws);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, SUMMARY_SHEET);
}

/**
 * 事務（医事課）向け: 個別リハビリ実施リスト（入院 / 外来）
 * A4横1枚に31日まで確実に収まるよう列幅・印刷設定を完全最適化
 */
function writeRehaPatientSheet(wb, aggregated, category, sheetName) {
  const { daysInMonth, patientMap, year, month } = aggregated;
  const isInput = category === 'INPATIENT';
  const ws = {};
  const dayOfWeekNames = ['日', '月', '火', '水', '木', '金', '土'];

  // 行0: タイトル
  setStyledCell(ws, 0, 0, `【${year}年${month}月 ${sheetName} (医事課レセコン入力用)】`, {
    font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: '0F172A' } }
  });

  // 行1: 固定サマリーヘッダー（Col 0〜5）
  setStyledCell(ws, 1, 0, '患者ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '患者氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '疾患名', STYLES.headerNavy);
  setStyledCell(ws, 1, 3, '疾患区分', STYLES.headerNavy);
  setStyledCell(ws, 1, 4, '介護認定', STYLES.headerNavy);
  setStyledCell(ws, 1, 5, '当月総単位', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '0369A1' } } });

  // 日別ヘッダー（Col 6〜）
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

  // 加算集計列（末尾）
  const extraCol = dayColStart + daysInMonth;
  if (isInput) {
    setStyledCell(ws, 1, extraCol, '早期加算Ⅰ(60点)', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 1, '早期加算Ⅱ(25点)', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 2, '計画書算定日', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 3, '計画書区分・点数', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 4, '備考', STYLES.headerNavy);
  } else {
    setStyledCell(ws, 1, extraCol, '計画書算定日', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 1, '計画書区分・点数', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 2, '備考', STYLES.headerNavy);
  }

  // データ行生成
  const patients = Object.values(patientMap).filter(
    (item) => item.patient.category === category
  );

  let curRow = 2;
  patients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, p.diseaseName || '-', { ...STYLES.cellNormal, fill: zebraBg });
    setStyledCell(ws, curRow, 3, REHA_RULES.LIMIT_DAYS[p.diseaseType]?.shortLabel || p.diseaseType, { ...STYLES.cellCenter, fill: zebraBg });
    setStyledCell(ws, curRow, 4, p.careInsuranceType === 'CARE' ? '要介護' : (p.careInsuranceType === 'SUPPORT' ? '要支援' : '-'), { ...STYLES.cellCenter, fill: zebraBg });
    
    // 当月総単位（目立つライトブルー背景）
    setStyledCell(ws, curRow, 5, item.totalUnits, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'E0F2FE' } },
      font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '0369A1' } },
      numFmt: '#,##0'
    });

    // 計画書・早期加算走査
    let e1 = 0, e2 = 0, planDateStr = '', planLabel = '';
    const planDatesSet = new Set();
    item.slots.forEach((s) => {
      if (s.billingPlan) {
        planDateStr = s.date ? s.date.slice(5) : '';
        planLabel = formatPlanLabel(s.billingPlan);
        planDatesSet.add(parseInt(s.date.split('-')[2], 10));
      }
      if (isInput && !s.isAnalgesia) {
        const ph = evaluateEarlyBonusPhase(p.earlyBonusStartDate || p.admissionDate, s.date, 'INPATIENT');
        if (ph.phase === 'PHASE_1') e1++;
        else if (ph.phase === 'PHASE_2') e2++;
      }
    });

    // 日別セル（1日〜31日）
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const col = dayColStart + (d - 1);
      const u = item.dailyUnits[d] || 0;
      const isPlanDay = planDatesSet.has(d);

      let cellStyle = { ...STYLES.cellUnit };
      if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
      else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
      else cellStyle.fill = zebraBg;

      if (isPlanDay) {
        setStyledCell(ws, curRow, col, `${u}★`, STYLES.cellPlanStar);
      } else {
        setStyledCell(ws, curRow, col, u > 0 ? u : '', cellStyle);
      }
    }

    // 加算集計
    if (isInput) {
      setStyledCell(ws, curRow, extraCol, e1 > 0 ? `${e1}日` : '-', { ...STYLES.cellCenter, fill: zebraBg });
      setStyledCell(ws, curRow, extraCol + 1, e2 > 0 ? `${e2}日` : '-', { ...STYLES.cellCenter, fill: zebraBg });
      setStyledCell(ws, curRow, extraCol + 2, planDateStr || '-', { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true, color: { rgb: 'B45309' } } });
      setStyledCell(ws, curRow, extraCol + 3, planLabel || '-', { ...STYLES.cellNormal, fill: zebraBg });
      setStyledCell(ws, curRow, extraCol + 4, p.notes || '', { ...STYLES.cellNormal, fill: zebraBg });
    } else {
      setStyledCell(ws, curRow, extraCol, planDateStr || '-', { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true, color: { rgb: 'B45309' } } });
      setStyledCell(ws, curRow, extraCol + 1, planLabel || '-', { ...STYLES.cellNormal, fill: zebraBg });
      setStyledCell(ws, curRow, extraCol + 2, p.notes || '', { ...STYLES.cellNormal, fill: zebraBg });
    }

    curRow++;
  });

  // A4横印刷に最適化したスリム列幅設定（日別列を3.15に圧縮し、31日まで1枚に収める）
  const colWidths = [6.5, 11, 14, 8, 7, 8.5]; // ID(6.5), 氏名(11), 疾患名(14), 区分(8), 介護(7), 総単位(8.5)
  for (let d = 1; d <= daysInMonth; d++) colWidths.push(3.15); // 日別は3.15
  if (isInput) colWidths.push(9.5, 9.5, 8.5, 18, 10);
  else colWidths.push(8.5, 18, 10);
  setSheetCols(ws, colWidths);

  // ウィンドウ枠固定（F列「当月総単位」まで常時固定）
  ws['!freeze'] = { xSplit: 'F', ySplit: '2', topLeftCell: 'G3', activePane: 'bottomRight', state: 'frozen' };

  // A4横1枚印刷（横幅ぴったり1ページフィット）設定
  applyA4LandscapePrintSetup(ws);

  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}

/**
 * A4横向き・横幅1ページぴったり収める印刷設定をシートに適用
 */
function applyA4LandscapePrintSetup(ws) {
  // A4 (paperSize: 9), 横向き (orientation: 'landscape')
  // fitToWidth: 1 (横幅を必ず1ページに収める), fitToHeight: 0 (縦は行数に応じて自然に次ページへ)
  ws['!pageSetup'] = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0
  };

  // 左右・上下の余白を極限までスリムにして印字可能エリアを最大化
  ws['!margins'] = {
    left: 0.25,
    right: 0.25,
    top: 0.35,
    bottom: 0.35,
    header: 0.15,
    footer: 0.15
  };
}

function formatPlanLabel(planKey) {
  switch (planKey) {
    case 'PLAN_1_FIRST': return '計画書1 (初回 300点)';
    case 'PLAN_1_FOLLOW': return '計画書1 (継続 240点)';
    case 'PLAN_2_FIRST': return '計画書2 (初回 240点)';
    case 'PLAN_2_FOLLOW': return '計画書2 (継続 196点)';
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
  if (existingIdx >= 0) {
    wb.Sheets[name] = ws;
  } else {
    window.XLSX.utils.book_append_sheet(wb, ws, name);
  }
}
