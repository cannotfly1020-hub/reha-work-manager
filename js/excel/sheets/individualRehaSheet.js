// js/excel/sheets/individualRehaSheet.js
// 個別リハビリ実施リスト（原本A4横マトリクス）
// ★医事課要望: 入院/外来 × 疾患 × 通常/減算 で最大12シートへ物理分離（該当0名はスキップ）
// ★各シートは 1〜31日の日別実施単位マトリクスを完全展開（サマリー化禁止）
// ★旧 rehaPatientSheet.js は削除せず残置

import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import {
  STYLES, thinBorder, getEarlyBaseDate,
  setStyledCell, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup
} from '../sheetUtils.js';

const DAY_COLS = 31;
const DAY_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 生成対象シート定義（Excelシート名 ≦ 31文字） */
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

function resolveDiseaseKey(patient) {
  const key = patient?.diseaseType;
  if (key === 'LOCOMOTIVE' || key === 'CEREBROVASCULAR' || key === 'DISUSE') return key;
  return 'LOCOMOTIVE';
}

/**
 * 介列表示
 * @param {string} careType
 * @param {boolean} hasRegularRate
 * @param {boolean} hasMaintRate
 * @param {number} maintUnits
 */
function resolveCareColumnDisplay(careType, hasRegularRate, hasMaintRate, maintUnits) {
  if (careType !== 'CARE' && careType !== 'SUPPORT') {
    return { label: '-', styleBase: null };
  }
  const isSupport = careType === 'SUPPORT';
  const uSuffix = maintUnits > 0 ? ` ${maintUnits}` : '';
  if (hasMaintRate && hasRegularRate) {
    return { label: `${isSupport ? '支日割' : '介日割'}${uSuffix}`, styleBase: STYLE_CARE_SPLIT };
  }
  if (hasMaintRate) {
    return { label: `${isSupport ? '支維持' : '介維持'}${uSuffix}`, styleBase: STYLE_CARE_MAINT };
  }
  return { label: isSupport ? '支援' : '介護', styleBase: null };
}

/**
 * 患者1名の当月解析（減算・早期加算・計画）
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
      planDateStr = s.date.slice(5);
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
 * 当月個別リハ患者を解析付きリスト化
 * @param {Object} aggregated
 * @returns {object[]}
 */
function collectAnalyzedPatients(aggregated) {
  const { year, month, daysInMonth, patientMap } = aggregated;
  const list = [];

  Object.values(patientMap || {}).forEach((item) => {
    if (!item?.patient) return;
    if (item.patient.diseaseType === 'ANALGESIA') return;
    const rehaUnits = item.rehaTotalUnits !== undefined
      ? item.rehaTotalUnits
      : (item.hasRehaSlots ? (item.totalUnits || 0) : 0);
    if (!(rehaUnits > 0 || item.hasRehaSlots)) return;

    const analysis = analyzePatientItem(item, year, month, daysInMonth);
    list.push({ item, analysis });
  });

  list.sort((a, b) => {
    const pa = a.item.patient;
    const pb = b.item.patient;
    return String(pa.id || '').localeCompare(String(pb.id || ''), 'ja', { numeric: true });
  });
  return list;
}

/**
 * ヘッダー行（ID〜計画、日列は常に1〜31）
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
}

/**
 * 患者1行（日別マトリクス完全展開）
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
    ? { ...careDisplay.styleBase }
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
      setStyledCell(ws, curRow, col, '', { ...STYLE_UNIT, fill: { fgColor: { rgb: 'F8FAFC' } } });
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
 * 1シート生成（該当患者がいる場合のみ）
 * @param {Object} wb
 * @param {Object} aggregated
 * @param {object[]} packedList
 * @param {object} def - SHEET_DEFS の1要素
 */
function writeOneSplitSheet(wb, aggregated, packedList, def) {
  if (!packedList.length) return;

  const { year, month, daysInMonth } = aggregated;
  const ws = {};
  let curRow = 0;

  const titleColor = def.reduced ? '881337' : '1E3A8A';
  const title = `【${year}年${month}月 ${def.catLabel} ${def.disLabel} (${def.kindLabel})（個別リハビリ実施リスト）】`;
  setStyledCell(ws, curRow, 0, title, {
    font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: titleColor } }
  });
  curRow += 1;

  writeMatrixHeader(ws, curRow, year, month, daysInMonth);
  curRow += 1;

  packedList.forEach((pk, idx) => {
    const zebraBg = (idx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
    writePatientMatrixRow(ws, curRow, pk, year, month, daysInMonth, zebraBg);
    curRow += 1;
  });

  const legendRow = curRow + 1;
  setStyledCell(ws, legendRow, 0,
    '凡例: 「入院日」＝早期加算対象者のみ（非対象・外来は -）／ 介列「介維持・支維持」＝維持期減算 ／「介日割・支日割」＝当月切替 ／ 日セル薄アンバー＝減算単価 ／ 薄緑＝早Ⅰ ／ 薄青＝早Ⅱ ／ 計画日＝薄黄。',
    {
      font: { name: 'Meiryo UI', sz: 7.5, color: { rgb: '64748B' } },
      alignment: { vertical: 'center', wrapText: true }
    }
  );

  const rHeights = [];
  for (let r = 0; r <= legendRow; r += 1) rHeights.push({ hpt: 18 });
  rHeights[0] = { hpt: 22 };
  rHeights[1] = { hpt: 28 };
  rHeights[legendRow] = { hpt: 26 };
  ws['!rows'] = rHeights;

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

  // A4横: 横幅1ページ強制、縦は行数に応じて自動改ページ
  applyA4LandscapePrintSetup(ws, false);
  ws['!margins'] = {
    left: 0.2,
    right: 0.2,
    top: 0.3,
    bottom: 0.3,
    header: 0.1,
    footer: 0.1
  };

  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, def.sheetName);
}

/**
 * 個別リハ実施リストを最大12シートへ物理分離して追加
 * （入院/外来 × 運動器/脳血管/廃用 × 通常/減算。0名シートはスキップ）
 * @param {Object} wb
 * @param {Object} aggregated
 */
export function writeIndividualRehaSheets(wb, aggregated) {
  const all = collectAnalyzedPatients(aggregated);

  SHEET_DEFS.forEach((def) => {
    const filtered = all.filter((pk) => {
      const p = pk.item.patient;
      if (p.category !== def.category) return false;
      if (resolveDiseaseKey(p) !== def.diseaseType) return false;
      const isReduced = pk.analysis.hasMaintRate === true;
      return def.reduced ? isReduced : !isReduced;
    });
    writeOneSplitSheet(wb, aggregated, filtered, def);
  });
}

/** 互換: 旧2シート分離API名（内部は12シート分割） */
export function splitIndividualRehaPatients(aggregated) {
  const all = collectAnalyzedPatients(aggregated);
  return {
    normalList: all.filter((pk) => !pk.analysis.hasMaintRate),
    reducedList: all.filter((pk) => pk.analysis.hasMaintRate)
  };
}
