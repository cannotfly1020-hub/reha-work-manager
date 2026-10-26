// js/excel/sheets/individualRehaSheet.js
// 個別リハビリ実施リスト（医事課要望: 通常/減算シート分離・区分列削除・入院日新設・A4横1枚）
// ★既存の日別グリッドシート(rehaPatientSheet.js)は削除せず残置。本モジュールが受付提出の正とする。

import { REHA_RULES } from '../../config/rules.js';
import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import {
  thinBorder, getEarlyBaseDate,
  setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup
} from '../sheetUtils.js';

export const SHEET_INDIVIDUAL_NORMAL = '個別リハ(通常)';
export const SHEET_INDIVIDUAL_REDUCED = '個別リハ(減算)';

const COL_HEADERS = [
  'No.', '患者ID', '氏名', '疾患名', '起算日', '入院日',
  '実施日数', '総単位数', '早期加算', '算定点数', '備考'
];
// wch: 4+9+14+22+11+11+7+8+8+10+12 ≈ 116（A4横≈100〜120文字相当で1枚収容）
const COL_WIDTHS = [4, 9, 14, 22, 11, 11, 7, 8, 8, 10, 12];

/**
 * YYYY-MM-DD → YYYY/MM/DD
 * @param {string} dateStr
 * @returns {string}
 */
function formatSlashDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return dateStr.trim();
}

/**
 * 個人台帳の具体的診断名（未記入時は制度名）
 * @param {Object} patient
 * @returns {string}
 */
function resolveDiagnosis(patient) {
  const specific = String(
    patient?.diagnosis || patient?.diseaseName || patient?.injuryDiseaseName || ''
  ).trim();
  if (specific && specific !== '未記入') return specific;
  const rule = REHA_RULES.LIMIT_DAYS[patient?.diseaseType] || REHA_RULES.LIMIT_DAYS.LOCOMOTIVE;
  return rule.fullName || rule.shortLabel || '-';
}

/**
 * 当月スロットから減算有無・点数・実施日数・早期加算・備考を集計
 * @param {Object} item - patientMap エントリ
 * @returns {{
 *   hasMaintRate: boolean,
 *   hasRegularRate: boolean,
 *   practiceDays: number,
 *   totalUnits: number,
 *   earlyUnits: number,
 *   early1Units: number,
 *   early2Units: number,
 *   totalPoints: number,
 *   note: string
 * }}
 */
function analyzeRehaItem(item) {
  const p = item.patient;
  const isIn = p.category === 'INPATIENT';
  const baseEarlyDate = getEarlyBaseDate(p);
  let hasMaintRate = false;
  let hasRegularRate = false;
  let totalUnits = 0;
  let totalPoints = 0;
  let early1Units = 0;
  let early2Units = 0;
  let planCount = 0;
  const practiceDaySet = new Set();

  (item.slots || []).forEach((s) => {
    if (!s || s.isAnalgesia) return;
    if (!s.date) return;
    const u = Number(s.units) || 1;
    totalUnits += u;
    practiceDaySet.add(s.date);

    const rate = getDailyBasePoints(p, s.date);
    totalPoints += u * (rate.points || 0);
    if (rate.isMaintenance && rate.isCareReduced) hasMaintRate = true;
    else hasRegularRate = true;

    if (s.billingPlan && REHA_RULES.PLAN_POINTS[s.billingPlan]) {
      planCount += 1;
      totalPoints += REHA_RULES.PLAN_POINTS[s.billingPlan];
    }

    if (isIn && baseEarlyDate) {
      const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
      if (ph.phase === 'PHASE_1' && ph.points > 0) {
        early1Units += u;
        totalPoints += u * ph.points;
      } else if (ph.phase === 'PHASE_2' && ph.points > 0) {
        early2Units += u;
        totalPoints += u * ph.points;
      }
    }
  });

  // slots が空でも dailyRehaUnits からフォールバック
  if (totalUnits === 0 && item.rehaTotalUnits > 0) {
    totalUnits = item.rehaTotalUnits;
    for (let d = 1; d < (item.dailyRehaUnits || []).length; d += 1) {
      if ((item.dailyRehaUnits[d] || 0) > 0) practiceDaySet.add(`d${d}`);
    }
  }

  const earlyUnits = early1Units + early2Units;
  const noteParts = [];
  if (hasMaintRate && hasRegularRate) noteParts.push('当月切替');
  else if (hasMaintRate) noteParts.push('維持期減算');
  if (planCount > 0) noteParts.push(`計画書${planCount}件`);
  if (early1Units > 0) noteParts.push(`早60:${early1Units}U`);
  if (early2Units > 0) noteParts.push(`早25:${early2Units}U`);
  if (p.category === 'INPATIENT') noteParts.push('入院');
  else noteParts.push('外来');

  return {
    hasMaintRate,
    hasRegularRate,
    practiceDays: practiceDaySet.size,
    totalUnits,
    earlyUnits,
    early1Units,
    early2Units,
    totalPoints,
    note: noteParts.join(' / ') || '-'
  };
}

/**
 * 個別リハ実績患者を通常／減算に分離
 * @param {Object} aggregated
 * @returns {{ normalList: object[], reducedList: object[] }}
 */
export function splitIndividualRehaPatients(aggregated) {
  const patientMap = aggregated?.patientMap || {};
  const rows = [];

  Object.values(patientMap).forEach((item) => {
    if (!item?.patient) return;
    if (item.patient.diseaseType === 'ANALGESIA') return;
    const rehaUnits = item.rehaTotalUnits !== undefined
      ? item.rehaTotalUnits
      : (item.hasRehaSlots ? (item.totalUnits || 0) : 0);
    if (!(rehaUnits > 0 || item.hasRehaSlots)) return;

    const stats = analyzeRehaItem(item);
    if (stats.totalUnits <= 0 && rehaUnits <= 0) return;

    const p = item.patient;
    const onset = p.onsetDate || p.admissionDate || '';
    const hasEarly = stats.earlyUnits > 0 || (item.totalEarlyUnits || 0) > 0;
    // 早期加算対象者のみ入院日を印字（外来・非対象は '-'）
    const admissionLabel = (p.category === 'INPATIENT' && hasEarly)
      ? (formatSlashDate(getEarlyBaseDate(p) || p.admissionDate || p.onsetDate) || '-')
      : '-';

    rows.push({
      id: String(p.id || ''),
      name: String(p.name || ''),
      diagnosis: resolveDiagnosis(p),
      onsetLabel: formatSlashDate(onset) || '-',
      admissionLabel,
      practiceDays: stats.practiceDays || (item.dailyRehaUnits
        ? item.dailyRehaUnits.filter((u, i) => i > 0 && u > 0).length
        : 0),
      totalUnits: stats.totalUnits || rehaUnits,
      earlyUnits: stats.earlyUnits || item.totalEarlyUnits || 0,
      totalPoints: stats.totalPoints,
      note: stats.note,
      hasMaintRate: stats.hasMaintRate,
      category: p.category === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT'
    });
  });

  rows.sort((a, b) => {
    const catDiff = (a.category === 'INPATIENT' ? 0 : 1) - (b.category === 'INPATIENT' ? 0 : 1);
    if (catDiff !== 0) return catDiff;
    return a.id.localeCompare(b.id, 'ja', { numeric: true });
  });

  return {
    normalList: rows.filter((r) => !r.hasMaintRate),
    reducedList: rows.filter((r) => r.hasMaintRate)
  };
}

/**
 * ヘッダースタイル
 * @param {string} headerRgb
 * @returns {Object}
 */
function buildHeaderStyle(headerRgb) {
  return {
    font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: headerRgb } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  };
}

const STYLE_CELL_C = {
  font: { name: 'Meiryo UI', sz: 8.5 },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};
const STYLE_CELL_L = {
  font: { name: 'Meiryo UI', sz: 8.5 },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: thinBorder()
};
const STYLE_CELL_R = {
  font: { name: 'Meiryo UI', sz: 8.5, bold: true },
  alignment: { horizontal: 'right', vertical: 'center' },
  border: thinBorder(),
  numFmt: '#,##0'
};
const STYLE_NAME = {
  font: { name: 'Meiryo UI', sz: 8.5, bold: true },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: thinBorder()
};
const STYLE_TOTAL = {
  font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '0F172A' } },
  fill: { fgColor: { rgb: 'E2E8F0' } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};

/**
 * 1シート描画（通常 or 減算）
 * @param {Object} wb
 * @param {Object} aggregated
 * @param {object[]} rows
 * @param {{ sheetName: string, title: string, headerRgb: string }} meta
 */
function writeOneIndividualSheet(wb, aggregated, rows, meta) {
  const { year, month } = aggregated;
  const ws = {};
  const headerStyle = buildHeaderStyle(meta.headerRgb);
  const merges = [];

  setStyledCell(ws, 0, 0, meta.title.replace('{YM}', `${year}年${month}月度`), {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: meta.headerRgb } },
    alignment: { horizontal: 'left', vertical: 'center' }
  });
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } });

  setStyledCell(ws, 1, 0, `対象: ${rows.length}名  |  受付・医事課 提出用  |  A4横1枚収容`, {
    font: { name: 'Meiryo UI', sz: 8, color: { rgb: '64748B' } }
  });
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 10 } });

  COL_HEADERS.forEach((h, c) => setStyledCell(ws, 2, c, h, headerStyle));

  let curRow = 3;
  let sumUnits = 0;
  let sumPoints = 0;
  let sumEarly = 0;
  let sumDays = 0;

  if (rows.length === 0) {
    setStyledCell(ws, curRow, 0, '※ 該当患者はありません', {
      font: { name: 'Meiryo UI', sz: 8.5, color: { rgb: '94A3B8' } }
    });
    merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: 10 } });
    curRow += 1;
  }

  rows.forEach((row, idx) => {
    const zebra = idx % 2 === 1 ? { fill: { fgColor: { rgb: 'F8FAFC' } } } : {};
    const c = (base) => ({ ...base, ...zebra });
    setStyledCell(ws, curRow, 0, idx + 1, c(STYLE_CELL_C));
    setStyledCell(ws, curRow, 1, row.id, c(STYLE_CELL_C));
    setStyledCell(ws, curRow, 2, row.name, c(STYLE_NAME));
    setStyledCell(ws, curRow, 3, row.diagnosis, c(STYLE_CELL_L));
    setStyledCell(ws, curRow, 4, row.onsetLabel, c(STYLE_CELL_C));
    setStyledCell(ws, curRow, 5, row.admissionLabel, c(STYLE_CELL_C));
    setStyledCell(ws, curRow, 6, row.practiceDays, c(STYLE_CELL_C));
    setStyledCell(ws, curRow, 7, row.totalUnits, c(STYLE_CELL_R));
    setStyledCell(ws, curRow, 8, row.earlyUnits > 0 ? row.earlyUnits : '-', c(STYLE_CELL_C));
    setStyledCell(ws, curRow, 9, row.totalPoints, c(STYLE_CELL_R));
    setStyledCell(ws, curRow, 10, row.note, c(STYLE_CELL_L));
    sumUnits += row.totalUnits;
    sumPoints += row.totalPoints;
    sumEarly += row.earlyUnits;
    sumDays += row.practiceDays;
    curRow += 1;
  });

  // 合計行
  setStyledCell(ws, curRow, 0, '合計', STYLE_TOTAL);
  for (let col = 1; col <= 5; col += 1) setStyledCell(ws, curRow, col, '', STYLE_TOTAL);
  setStyledCell(ws, curRow, 6, sumDays, { ...STYLE_TOTAL, numFmt: '#,##0' });
  setStyledCell(ws, curRow, 7, sumUnits, { ...STYLE_TOTAL, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: '#,##0' });
  setStyledCell(ws, curRow, 8, sumEarly, { ...STYLE_TOTAL, numFmt: '#,##0' });
  setStyledCell(ws, curRow, 9, sumPoints, { ...STYLE_TOTAL, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: '#,##0' });
  setStyledCell(ws, curRow, 10, `${rows.length}名`, STYLE_TOTAL);

  setSheetCols(ws, COL_WIDTHS);
  ws['!merges'] = merges;
  ws['!rows'] = [{ hpt: 20 }, { hpt: 14 }, { hpt: 18 }];
  ws['!views'] = [{ showGridLines: true }];
  updateSheetRange(ws);

  // A4横・横幅1・縦も1枚に収容（医事課提出のジャストフィット）
  applyA4LandscapePrintSetup(ws, true);
  ws['!margins'] = {
    left: 0.3,
    right: 0.3,
    top: 0.3,
    bottom: 0.3,
    header: 0.1,
    footer: 0.1
  };

  appendOrReplaceSheet(wb, ws, meta.sheetName);
}

/**
 * 個別リハ実施リスト（通常・減算）の2シートをブックへ追加
 * @param {Object} wb
 * @param {Object} aggregated
 */
export function writeIndividualRehaSheets(wb, aggregated) {
  const { normalList, reducedList } = splitIndividualRehaPatients(aggregated);

  writeOneIndividualSheet(wb, aggregated, normalList, {
    sheetName: SHEET_INDIVIDUAL_NORMAL,
    title: '【{YM} 個別リハビリテーション実施リスト (通常・減算なし)】',
    headerRgb: '1E3A8A'
  });

  writeOneIndividualSheet(wb, aggregated, reducedList, {
    sheetName: SHEET_INDIVIDUAL_REDUCED,
    title: '【{YM} 個別リハビリテーション実施リスト (維持期減算)】',
    headerRgb: '881337'
  });
}
