// js/excel/uketsukeWriter.js
// 受付提出用Excel生成層（A4横1枚印刷対応 / 日付▼非表示 / 入院・外来・消炎鎮痛3分立 / 疾患・減算ソート）

import { REHA_RULES } from '../config/rules.js';
import { calculatePatientDeadlines, evaluateEarlyBonusPhase } from '../core/deadlineCalc.js';

const SUMMARY_SHEET = 'レセプト収益サマリー';
const INPATIENT_SHEET = '実施ﾘｽﾄ 入院';
const OUTPATIENT_SHEET = '実施ﾘｽﾄ 外来';
const ANALGESIA_SHEET = '実施ﾘｽﾄ 消炎鎮痛';

// デザイン・カラーパレット定数
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
 * 受付提出用ワークブック生成（入院・外来・消炎鎮痛3分立＋経営サマリー）
 */
export function generateUketsukeWorkbook(aggregated, templateBuffer = null) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');

  let wb = templateBuffer ? window.XLSX.read(templateBuffer, { type: 'array' }) : window.XLSX.utils.book_new();

  writeExecutiveSummarySheet(wb, aggregated);
  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', INPATIENT_SHEET);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', OUTPATIENT_SHEET);
  writeAnalgesiaDedicatedSheet(wb, aggregated, ANALGESIA_SHEET);

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

  setSheetCols(ws, [32, 16, 12, 15, 18, 26]);
  applyA4LandscapePrintSetup(ws);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, SUMMARY_SHEET);
}

/**
 * 事務（医事課）向け: 個別リハビリ実施リスト（入院 / 外来）
 * 疾患区分×算定区分ソート ＆ 左側7列のみオートフィルター（日付の▼は非表示） ＆ A4横1枚印刷
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

  // 行1: 固定サマリーヘッダー（Col 0〜6）
  setStyledCell(ws, 1, 0, '患者ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '患者氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '疾患名 (病名)', STYLES.headerNavy);
  setStyledCell(ws, 1, 3, '疾患区分', STYLES.headerNavy);
  setStyledCell(ws, 1, 4, '算定区分', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '334155' } } });
  setStyledCell(ws, 1, 5, '介護認定', STYLES.headerNavy);
  setStyledCell(ws, 1, 6, '当月総単位', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '0369A1' } } });

  // 日別ヘッダー（Col 7〜）
  const dayColStart = 7;
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
    setStyledCell(ws, 1, extraCol + 4, '備考・特記事項', STYLES.headerNavy);
  } else {
    setStyledCell(ws, 1, extraCol, '計画書算定日', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 1, '計画書区分・点数', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 2, '備考・特記事項', STYLES.headerNavy);
  }

  // 対象患者（消炎鎮痛のみの患者を除外）
  const rawPatients = Object.values(patientMap).filter(
    (item) => item.patient.category === category && item.patient.diseaseType !== 'ANALGESIA'
  );

  // 疾患順（運動器 -> 脳血管 -> 廃用） × 算定区分順（標準 -> 減算）でソート
  const diseaseOrder = { LOCOMOTIVE: 1, CEREBROVASCULAR: 2, DISUSE: 3 };
  const sortedPatients = rawPatients.map((item) => {
    const baseDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const dl = calculatePatientDeadlines(item.patient, baseDate);
    const isReduced = dl.isMaintenanceReduction;
    const calcType = isReduced ? '減算' : '標準';
    const sortScore = (diseaseOrder[item.patient.diseaseType] || 9) * 10 + (isReduced ? 2 : 1);
    return { ...item, calcType, isReduced, dl, sortScore };
  }).sort((a, b) => {
    if (a.sortScore !== b.sortScore) return a.sortScore - b.sortScore;
    return a.patient.id.localeCompare(b.patient.id);
  });

  let curRow = 2;
  sortedPatients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, p.diseaseName || '-', { ...STYLES.cellNormal, fill: zebraBg });
    setStyledCell(ws, curRow, 3, REHA_RULES.LIMIT_DAYS[p.diseaseType]?.shortLabel || p.diseaseType, { ...STYLES.cellCenter, fill: zebraBg });
    
    // 算定区分（標準 / 減算）
    const calcStyle = item.isReduced
      ? { ...STYLES.cellCenter, fill: { fgColor: { rgb: 'FEE2E2' } }, font: { bold: true, color: { rgb: 'B91C1C' } } }
      : { ...STYLES.cellCenter, fill: { fgColor: { rgb: 'ECFDF5' } }, font: { bold: true, color: { rgb: '047857' } } };
    setStyledCell(ws, curRow, 4, item.calcType, calcStyle);

    setStyledCell(ws, curRow, 5, p.careInsuranceType === 'CARE' ? '要介護' : (p.careInsuranceType === 'SUPPORT' ? '要支援' : 'なし'), { ...STYLES.cellCenter, fill: zebraBg });
    
    // 当月総単位
    setStyledCell(ws, curRow, 6, item.totalUnits, {
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

  // A4横印刷に最適化した列幅設定（コンパクトで横1枚に綺麗に凝縮）
  const colWidths = [8, 12, 16, 9, 8, 8, 9];
  for (let d = 1; d <= daysInMonth; d++) colWidths.push(3.6);
  if (isInput) colWidths.push(11, 11, 9, 18, 14);
  else colWidths.push(9, 18, 14);
  setSheetCols(ws, colWidths);

  // ウィンドウ枠固定（G列「当月総単位」まで常時画面固定）
  ws['!freeze'] = { xSplit: 'G', ySplit: '2', topLeftCell: 'H3', activePane: 'bottomRight', state: 'frozen' };

  // 【最重要】オートフィルターの範囲をCol 0〜6（患者ID〜当月総単位）のみに限定！
  // 日付列（Col 7以降）には昇降▼マークを一切出さない仕様
  ws['!autofilter'] = { ref: window.XLSX.utils.encode_range({ r: 1, c: 0 }, { r: Math.max(1, curRow - 1), c: 6 }) };

  // A4横1枚印刷（横幅ぴったり1ページフィット）設定
  applyA4LandscapePrintSetup(ws);

  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}

/**
 * 事務（医事課）向け: 消炎鎮痛（物療）専用シート
 */
function writeAnalgesiaDedicatedSheet(wb, aggregated, sheetName) {
  const { daysInMonth, patientMap, year, month } = aggregated;
  const ws = {};
  const dayOfWeekNames = ['日', '月', '火', '水', '木', '金', '土'];

  setStyledCell(ws, 0, 0, `【${year}年${month}月 消炎鎮痛等処置 (物療) 実施リスト (1日1回35点)】`, {
    font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: '0F172A' } }
  });

  setStyledCell(ws, 1, 0, '患者ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '患者氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '区分', STYLES.headerNavy);
  setStyledCell(ws, 1, 3, '疾患名 (処置部位)', STYLES.headerNavy);
  setStyledCell(ws, 1, 4, '当月実施回数', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '15803D' } } });
  setStyledCell(ws, 1, 5, '総点数(35点/回)', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '166534' } } });

  const dayColStart = 6;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dayOfWeek = dateObj.getDay();
    const col = dayColStart + (d - 1);
    let style = STYLES.headerNavy;
    if (dayOfWeek === 6) style = STYLES.headerSat;
    else if (dayOfWeek === 0) style = STYLES.headerSun;
    setStyledCell(ws, 1, col, `${d}\n${dayOfWeekNames[dayOfWeek]}`, style);
  }
  setStyledCell(ws, 1, dayColStart + daysInMonth, '備考・特記事項', STYLES.headerNavy);

  // 消炎鎮痛の患者を抽出
  const analgesiaPatients = Object.values(patientMap).filter((item) => {
    return item.patient.diseaseType === 'ANALGESIA' || item.slots.some((s) => s.isAnalgesia);
  }).sort((a, b) => {
    if (a.patient.category !== b.patient.category) {
      return a.patient.category === 'INPATIENT' ? -1 : 1;
    }
    return a.patient.id.localeCompare(b.patient.id);
  });

  let curRow = 2;
  analgesiaPatients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
    const analgesiaSlots = item.slots.filter((s) => s.isAnalgesia || p.diseaseType === 'ANALGESIA');
    const totalCount = analgesiaSlots.length || (p.diseaseType === 'ANALGESIA' ? item.totalUnits : 0);
    const totalPts = totalCount * 35;

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, p.category === 'INPATIENT' ? '入院' : '外来', { ...STYLES.cellCenter, fill: zebraBg });
    setStyledCell(ws, curRow, 3, p.diseaseName || '消炎鎮痛処置', { ...STYLES.cellNormal, fill: zebraBg });
    setStyledCell(ws, curRow, 4, `${totalCount} 回`, {
      ...STYLES.cellCenter, fill: { fgColor: { rgb: 'DCFCE7' } }, font: { bold: true, color: { rgb: '166534' } }
    });
    setStyledCell(ws, curRow, 5, totalPts, {
      ...STYLES.cellCenter, fill: { fgColor: { rgb: 'F0FDF4' } }, font: { bold: true, color: { rgb: '15803D' } }, numFmt: '#,##0'
    });

    const datesMap = new Set(analgesiaSlots.map((s) => parseInt(s.date.split('-')[2], 10)));
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const col = dayColStart + (d - 1);
      const isDone = datesMap.has(d) || (p.diseaseType === 'ANALGESIA' && (item.dailyUnits[d] || 0) > 0);

      let cellStyle = { ...STYLES.cellNormal, alignment: { horizontal: 'center', vertical: 'center' } };
      if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
      else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
      else cellStyle.fill = zebraBg;

      setStyledCell(ws, curRow, col, isDone ? '◯' : '', cellStyle);
    }

    setStyledCell(ws, curRow, dayColStart + daysInMonth, p.notes || '', { ...STYLES.cellNormal, fill: zebraBg });
    curRow++;
  });

  const colWidths = [8, 12, 7, 16, 10, 11];
  for (let d = 1; d <= daysInMonth; d++) colWidths.push(3.6);
  colWidths.push(18);
  setSheetCols(ws, colWidths);

  ws['!freeze'] = { xSplit: 'F', ySplit: '2', topLeftCell: 'G3', activePane: 'bottomRight', state: 'frozen' };

  // 左側6列のみオートフィルター（日付の▼は非表示）
  ws['!autofilter'] = { ref: window.XLSX.utils.encode_range({ r: 1, c: 0 }, { r: Math.max(1, curRow - 1), c: 5 }) };

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

  // 左右・上下の余白をスリムにしてA4横を最大限広く活用
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
