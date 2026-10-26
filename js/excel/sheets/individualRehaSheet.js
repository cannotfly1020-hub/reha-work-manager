// js/excel/sheets/individualRehaSheet.js
// 個別リハビリ実施リスト（原本A4横マトリクス完全再現）
// ★医事課要望: 通常/減算の2シート分離・「区分」→「入院日」・日別1〜31・早Ⅰ/早Ⅱ/計画
// ★旧 rehaPatientSheet.js は削除せず残置（本モジュールが受付提出の正本）

import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import {
  STYLES, thinBorder, getEarlyBaseDate,
  setStyledCell, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup
} from '../sheetUtils.js';

export const SHEET_INDIVIDUAL_NORMAL = '個別リハ(通常)';
export const SHEET_INDIVIDUAL_REDUCED = '個別リハ(減算)';

const DAY_COLS = 31; // 原本: F〜AJ（1〜31）固定
const DAY_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'];

const SECTION_ORDER = [
  { category: 'INPATIENT', diseaseType: 'LOCOMOTIVE', catLabel: '入院', disLabel: '運動器' },
  { category: 'INPATIENT', diseaseType: 'CEREBROVASCULAR', catLabel: '入院', disLabel: '脳血管' },
  { category: 'INPATIENT', diseaseType: 'DISUSE', catLabel: '入院', disLabel: '廃用' },
  { category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE', catLabel: '外来', disLabel: '運動器' },
  { category: 'OUTPATIENT', diseaseType: 'CEREBROVASCULAR', catLabel: '外来', disLabel: '脳血管' },
  { category: 'OUTPATIENT', diseaseType: 'DISUSE', catLabel: '外来', disLabel: '廃用' }
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
  font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: 'B45309' } }
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
const STYLE_SECTION = {
  font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: '0F172A' } },
  fill: { fgColor: { rgb: 'E2E8F0' } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: thinBorder()
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

function buildDateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatAdmissionShort(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr.trim();
  return `${m[2]}/${m[3]}`;
}

/**
 * 介列表示（原本・事務表記: 介維持 / 介日割 / 介護 + 単位）
 * @param {string} careType
 * @param {boolean} hasRegularRate
 * @param {boolean} hasMaintRate
 * @param {number} maintUnits
 * @returns {{ label: string, styleBase: object|null }}
 */
function resolveCareColumnDisplay(careType, hasRegularRate, hasMaintRate, maintUnits) {
  if (careType !== 'CARE' && careType !== 'SUPPORT') {
    return { label: '-', styleBase: null };
  }
  const isSupport = careType === 'SUPPORT';
  const uSuffix = maintUnits > 0 ? ` ${maintUnits}` : '';
  if (hasMaintRate && hasRegularRate) {
    return {
      label: `${isSupport ? '支日割' : '介日割'}${uSuffix}`,
      styleBase: STYLE_CARE_SPLIT
    };
  }
  if (hasMaintRate) {
    return {
      label: `${isSupport ? '支維持' : '介維持'}${uSuffix}`,
      styleBase: STYLE_CARE_MAINT
    };
  }
  return { label: isSupport ? '支援' : '介護', styleBase: null };
}

/**
 * 患者1名の当月スロットを解析（減算判定・早期加算・計画日）
 * @param {Object} item
 * @param {number} year
 * @param {number} month
 * @param {number} daysInMonth
 */
function analyzePatientItem(item, year, month, daysInMonth) {
  const p = item.patient;
  const isIn = p.category === 'INPATIENT';
  const baseEarlyDate = getEarlyBaseDate(p);
  const planDatesSet = new Set();
  const early1DatesSet = new Set();
  const early2DatesSet = new Set();
  const maintDatesSet = new Set();
  let early1Units = 0;
  let early2Units = 0;
  let planDateStr = '';
  let hasMaintRate = false;
  let hasRegularRate = false;
  let maintUnits = 0;

  (item.slots || []).forEach((s) => {
    if (!s || s.isAnalgesia || !s.date) return;
    const u = s.units || 1;
    if (s.billingPlan) {
      planDateStr = s.date.slice(5); // MM-DD
      planDatesSet.add(parseInt(s.date.split('-')[2], 10));
    }
    if (isIn && baseEarlyDate) {
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
    const rateInfo = getDailyBasePoints(p, s.date);
    if (rateInfo.isMaintenance && rateInfo.isCareReduced) {
      const dNum = parseInt(s.date.split('-')[2], 10);
      maintDatesSet.add(dNum);
      hasMaintRate = true;
      maintUnits += u;
    } else {
      hasRegularRate = true;
    }
  });

  // 日別配列からも減算日を補完
  for (let d = 1; d <= daysInMonth; d += 1) {
    const u = item.dailyRehaUnits ? (item.dailyRehaUnits[d] || 0) : (item.dailyUnits?.[d] || 0);
    if (u <= 0) continue;
    const dateStr = buildDateStr(year, month, d);
    const dayRate = getDailyBasePoints(p, dateStr);
    if (dayRate.isMaintenance && dayRate.isCareReduced) {
      hasMaintRate = true;
      if (!maintDatesSet.has(d)) {
        maintDatesSet.add(d);
        maintUnits += u;
      }
    } else {
      hasRegularRate = true;
    }
  }

  const totalRehaUnits = item.rehaTotalUnits !== undefined ? item.rehaTotalUnits : (item.totalUnits || 0);
  const hasEarly = early1Units > 0 || early2Units > 0;
  const admissionLabel = (isIn && hasEarly)
    ? (formatAdmissionShort(baseEarlyDate || p.admissionDate || p.onsetDate) || '-')
    : '-';

  return {
    hasMaintRate,
    hasRegularRate,
    maintUnits,
    early1Units,
    early2Units,
    early1DatesSet,
    early2DatesSet,
    maintDatesSet,
    planDatesSet,
    planDateStr,
    totalRehaUnits,
    admissionLabel,
    careDisplay: resolveCareColumnDisplay(p.careInsuranceType, hasRegularRate, hasMaintRate, maintUnits)
  };
}

/**
 * 個別リハ実績患者を通常／減算に分離（消炎鎮痛除外）
 * @param {Object} aggregated
 * @returns {{ normalList: object[], reducedList: object[] }}
 */
export function splitIndividualRehaPatients(aggregated) {
  const { year, month, daysInMonth, patientMap } = aggregated;
  const normalList = [];
  const reducedList = [];

  Object.values(patientMap || {}).forEach((item) => {
    if (!item?.patient) return;
    if (item.patient.diseaseType === 'ANALGESIA') return;
    const rehaUnits = item.rehaTotalUnits !== undefined
      ? item.rehaTotalUnits
      : (item.hasRehaSlots ? (item.totalUnits || 0) : 0);
    if (!(rehaUnits > 0 || item.hasRehaSlots)) return;

    const analysis = analyzePatientItem(item, year, month, daysInMonth);
    const packed = { item, analysis };
    if (analysis.hasMaintRate) reducedList.push(packed);
    else normalList.push(packed);
  });

  const sortFn = (a, b) => {
    const pa = a.item.patient;
    const pb = b.item.patient;
    const catA = pa.category === 'INPATIENT' ? 0 : 1;
    const catB = pb.category === 'INPATIENT' ? 0 : 1;
    if (catA !== catB) return catA - catB;
    const order = ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE'];
    const dA = order.indexOf(pa.diseaseType);
    const dB = order.indexOf(pb.diseaseType);
    if (dA !== dB) return (dA < 0 ? 99 : dA) - (dB < 0 ? 99 : dB);
    return String(pa.id || '').localeCompare(String(pb.id || ''), 'ja', { numeric: true });
  };
  normalList.sort(sortFn);
  reducedList.sort(sortFn);
  return { normalList, reducedList };
}

/**
 * テーブルヘッダー行（ID〜計画）を描画。日列は常に1〜31
 * @returns {number} 最後の列 index（計画）
 */
function writeMatrixHeader(ws, headerRow, year, month, daysInMonth) {
  setStyledCell(ws, headerRow, 0, 'ID', STYLE_HEADER);
  setStyledCell(ws, headerRow, 1, '患者氏名', STYLE_HEADER);
  setStyledCell(ws, headerRow, 2, '入院日', STYLE_HEADER);
  setStyledCell(ws, headerRow, 3, '介', STYLE_HEADER);
  setStyledCell(ws, headerRow, 4, '総', STYLE_HEADER_TOTAL);

  const dayColStart = 5;
  for (let d = 1; d <= DAY_COLS; d += 1) {
    const col = dayColStart + (d - 1);
    if (d > daysInMonth) {
      setStyledCell(ws, headerRow, col, `${d}`, {
        font: { name: 'Meiryo UI', sz: 7, color: { rgb: '94A3B8' } },
        fill: { fgColor: { rgb: 'F1F5F9' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: thinBorder()
      });
      continue;
    }
    const dateObj = new Date(year, month - 1, d);
    const dow = dateObj.getDay();
    const hLabel = `${d}\n${DAY_OF_WEEK[dow]}`;
    let style = STYLE_HEADER;
    if (dow === 6) style = STYLES.headerSat;
    else if (dow === 0) style = STYLES.headerSun;
    setStyledCell(ws, headerRow, col, hLabel, {
      ...style,
      font: { ...(style.font || {}), sz: 7.5, bold: true }
    });
  }

  const extraCol = dayColStart + DAY_COLS;
  setStyledCell(ws, headerRow, extraCol, '早Ⅰ', STYLE_HEADER);
  setStyledCell(ws, headerRow, extraCol + 1, '早Ⅱ', STYLE_HEADER);
  setStyledCell(ws, headerRow, extraCol + 2, '計画', STYLE_HEADER);
  return extraCol + 2;
}

/**
 * 患者1行をマトリクスに描画
 */
function writePatientMatrixRow(ws, curRow, packed, year, month, daysInMonth, zebraBg) {
  const { item, analysis } = packed;
  const p = item.patient;
  const {
    early1Units, early2Units, early1DatesSet, early2DatesSet,
    maintDatesSet, planDatesSet, planDateStr, totalRehaUnits,
    admissionLabel, careDisplay, hasMaintRate
  } = analysis;

  setStyledCell(ws, curRow, 0, p.id, {
    ...STYLE_DATA_C, fill: zebraBg, font: { name: 'Meiryo UI', sz: 8, bold: true }
  });
  setStyledCell(ws, curRow, 1, p.name, { ...STYLE_DATA_L, fill: zebraBg });
  setStyledCell(ws, curRow, 2, admissionLabel, { ...STYLE_DATA_C, fill: zebraBg });

  const careStyle = careDisplay.styleBase
    ? { ...careDisplay.styleBase, fill: careDisplay.styleBase.fill || zebraBg }
    : { ...STYLE_DATA_C, fill: zebraBg };
  setStyledCell(ws, curRow, 3, careDisplay.label, careStyle);

  setStyledCell(ws, curRow, 4, totalRehaUnits, {
    ...STYLE_DATA_C,
    fill: { fgColor: { rgb: hasMaintRate ? 'FEF3C7' : 'E0F2FE' } },
    font: {
      name: 'Meiryo UI',
      sz: 8.5,
      bold: true,
      color: { rgb: hasMaintRate ? 'B45309' : '0369A1' }
    },
    numFmt: '#,##0'
  });

  const dayColStart = 5;
  for (let d = 1; d <= DAY_COLS; d += 1) {
    const col = dayColStart + (d - 1);
    if (d > daysInMonth) {
      setStyledCell(ws, curRow, col, '', {
        ...STYLE_UNIT,
        fill: { fgColor: { rgb: 'F8FAFC' } }
      });
      continue;
    }

    const dateObj = new Date(year, month - 1, d);
    const dow = dateObj.getDay();
    const u = item.dailyRehaUnits ? (item.dailyRehaUnits[d] || 0) : (item.dailyUnits?.[d] || 0);
    const isPlanDay = planDatesSet.has(d);
    const isEarly1Day = early1DatesSet.has(d);
    const isEarly2Day = early2DatesSet.has(d);
    const dateStr = buildDateStr(year, month, d);
    const dayRate = getDailyBasePoints(p, dateStr);
    const isMaintDay = (u > 0) && (
      maintDatesSet.has(d)
      || (dayRate.isMaintenance === true && dayRate.isCareReduced === true)
    );

    let cellStyle = { ...STYLE_UNIT };
    if (dow === 6) cellStyle.fill = STYLES.cellSatCol;
    else if (dow === 0) cellStyle.fill = STYLES.cellSunCol;
    else cellStyle.fill = zebraBg;

    if (u > 0) {
      if (isPlanDay && isMaintDay) setStyledCell(ws, curRow, col, u, STYLE_CELL_PLAN_MAINT);
      else if (isPlanDay) setStyledCell(ws, curRow, col, u, { ...STYLES.cellPlanStar, font: { ...STYLES.cellPlanStar.font, sz: 8 } });
      else if (isEarly1Day) setStyledCell(ws, curRow, col, u, { ...STYLES.cellEarly1, font: { ...STYLES.cellEarly1.font, sz: 8 } });
      else if (isEarly2Day) setStyledCell(ws, curRow, col, u, { ...STYLES.cellEarly2, font: { ...STYLES.cellEarly2.font, sz: 8 } });
      else if (isMaintDay) setStyledCell(ws, curRow, col, u, STYLE_CELL_MAINT);
      else setStyledCell(ws, curRow, col, u, cellStyle);
    } else {
      setStyledCell(ws, curRow, col, '', cellStyle);
    }
  }

  const extraCol = dayColStart + DAY_COLS;
  setStyledCell(ws, curRow, extraCol, early1Units > 0 ? early1Units : '-', {
    ...STYLE_DATA_C,
    fill: early1Units > 0 ? { fgColor: { rgb: 'D1FAE5' } } : zebraBg,
    font: { name: 'Meiryo UI', sz: 8, bold: early1Units > 0 }
  });
  setStyledCell(ws, curRow, extraCol + 1, early2Units > 0 ? early2Units : '-', {
    ...STYLE_DATA_C,
    fill: early2Units > 0 ? { fgColor: { rgb: 'DBEAFE' } } : zebraBg,
    font: { name: 'Meiryo UI', sz: 8, bold: early2Units > 0 }
  });
  setStyledCell(ws, curRow, extraCol + 2, planDateStr || '-', {
    ...STYLE_DATA_C,
    fill: zebraBg,
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'B45309' } }
  });
}

/**
 * 通常 or 減算の1シートを生成（区分×疾患セクション展開の日別マトリクス）
 */
function writeOneMatrixSheet(wb, aggregated, packedList, sheetName, sheetKindLabel) {
  const { year, month, daysInMonth } = aggregated;
  const ws = {};
  const lastCol = 5 + DAY_COLS + 2; // ID..計画
  let curRow = 0;
  let patientRowCount = 0;

  // シート全体タイトル
  const topTitle = sheetKindLabel === 'reduced'
    ? `【${year}年${month}月度 個別リハビリ実施リスト（維持期減算）】`
    : `【${year}年${month}月度 個別リハビリ実施リスト（通常・減算なし）】`;
  setStyledCell(ws, curRow, 0, topTitle, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: sheetKindLabel === 'reduced' ? '881337' : '1E3A8A' } }
  });
  curRow += 1;

  let anySection = false;
  SECTION_ORDER.forEach((sec) => {
    const sectionPatients = packedList.filter((pk) => {
      const p = pk.item.patient;
      const dType = (p.diseaseType && p.diseaseType !== 'ANALGESIA') ? p.diseaseType : 'LOCOMOTIVE';
      return p.category === sec.category && dType === sec.diseaseType;
    });
    if (sectionPatients.length === 0) return;
    anySection = true;

    // セクション見出し（原本タイトル形式）
    const secTitle = `【${year}年${month}月 ${sec.catLabel} ${sec.disLabel}（個別リハビリ実施リスト）】`;
    setStyledCell(ws, curRow, 0, secTitle, STYLE_SECTION);
    for (let c = 1; c <= lastCol; c += 1) {
      setStyledCell(ws, curRow, c, '', STYLE_SECTION);
    }
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: lastCol } });
    curRow += 1;

    writeMatrixHeader(ws, curRow, year, month, daysInMonth);
    curRow += 1;

    sectionPatients.forEach((pk, idx) => {
      const zebraBg = (idx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
      writePatientMatrixRow(ws, curRow, pk, year, month, daysInMonth, zebraBg);
      curRow += 1;
      patientRowCount += 1;
    });

    curRow += 1; // セクション間余白
  });

  if (!anySection) {
    setStyledCell(ws, curRow, 0, '※ 該当する個別リハビリ実施患者はありません', {
      font: { name: 'Meiryo UI', sz: 9, color: { rgb: '94A3B8' } }
    });
    curRow += 1;
  }

  // 凡例
  const legendRow = curRow;
  setStyledCell(ws, legendRow, 0,
    '凡例: 「入院日」＝早期加算対象者のみ印字（非対象・外来は -）／ 介列「介維持・支維持」＝維持期減算 ／「介日割・支日割」＝当月切替 ／ 日セル薄アンバー＝減算単価 ／ 薄緑＝早Ⅰ ／ 薄青＝早Ⅱ ／ 計画日＝薄黄。医療保険のみ超過は正規点（通常シート）。',
    {
      font: { name: 'Meiryo UI', sz: 7.5, color: { rgb: '64748B' } },
      alignment: { vertical: 'center', wrapText: true }
    }
  );

  // 行高
  const rHeights = [];
  for (let r = 0; r <= legendRow; r += 1) {
    rHeights.push({ hpt: 18 });
  }
  rHeights[0] = { hpt: 22 };
  rHeights[legendRow] = { hpt: 28 };
  ws['!rows'] = rHeights;

  // 列幅（原本イメージ: ID7 / 氏名13 / 入院日9 / 介8 / 総6 / 日3.2×31 / 早5×2 / 計画7）
  const colProps = [
    { wch: 7 },
    { wch: 13 },
    { wch: 9 },
    { wch: 8 },
    { wch: 6 }
  ];
  for (let d = 0; d < DAY_COLS; d += 1) colProps.push({ wch: 3.2 });
  colProps.push({ wch: 5 }, { wch: 5 }, { wch: 7 });
  ws['!cols'] = colProps;

  ws['!views'] = [{ showGridLines: true }];
  ws['!freeze'] = { xSplit: 5, ySplit: 2, topLeftCell: 'F3', activePane: 'bottomRight', state: 'frozen' };

  // A4横1枚: 横は必ず1、縦は行数に応じて（多い場合は自動改ページ）
  const fitHeight = patientRowCount <= 22;
  applyA4LandscapePrintSetup(ws, fitHeight);
  ws['!margins'] = {
    left: 0.25,
    right: 0.25,
    top: 0.3,
    bottom: 0.3,
    header: 0.1,
    footer: 0.1
  };

  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}

/**
 * 個別リハ実施リスト（通常・減算）日別マトリクス2シートをブックへ追加
 * @param {Object} wb
 * @param {Object} aggregated
 */
export function writeIndividualRehaSheets(wb, aggregated) {
  const { normalList, reducedList } = splitIndividualRehaPatients(aggregated);

  writeOneMatrixSheet(wb, aggregated, normalList, SHEET_INDIVIDUAL_NORMAL, 'normal');
  writeOneMatrixSheet(wb, aggregated, reducedList, SHEET_INDIVIDUAL_REDUCED, 'reduced');
}
