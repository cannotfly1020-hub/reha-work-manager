// js/excel/uketsukeWriter.js
// 受付提出用Excelワークブック生成・テンプレート転記層（200行制限準拠）

import { REHA_RULES } from '../config/rules.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';

const INPATIENT_SHEET = '実施ﾘｽﾄ 入院';
const OUTPATIENT_SHEET = '外来';
const RECEIPT_SHEET = '(レセプト合計)入院';

/**
 * 受付提出用ワークブックを生成する（テンプレートがあれば転記、なければ新規構築）
 * @param {Object} aggregated aggregateFromAppSchedule の集計オブジェクト
 * @param {ArrayBuffer|null} templateBuffer アップロードされた原本テンプレート
 * @returns {Object|null} XLSX ワークブックオブジェクト
 */
export function generateUketsukeWorkbook(aggregated, templateBuffer = null) {
  if (!window.XLSX) {
    throw new Error('SheetJS (XLSX) ライブラリが読み込まれていません。');
  }

  let wb;
  if (templateBuffer) {
    wb = window.XLSX.read(templateBuffer, { type: 'array' });
  } else {
    wb = window.XLSX.utils.book_new();
    initFallbackSheets(wb, aggregated.daysInMonth);
  }

  writePatientCategorySheet(wb, aggregated, 'INPATIENT', INPATIENT_SHEET);
  writePatientCategorySheet(wb, aggregated, 'OUTPATIENT', OUTPATIENT_SHEET);
  writeReceiptTotalSheet(wb, aggregated);

  return wb;
}

/**
 * 入院・外来シートへの日別単位データ書き込み
 */
function writePatientCategorySheet(wb, aggregated, category, sheetName) {
  let ws = wb.Sheets[sheetName];
  if (!ws) {
    ws = window.XLSX.utils.aoa_to_sheet([['患者ID', '患者氏名', '疾患名', '合計']]);
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const { daysInMonth, patientMap, year, month } = aggregated;
  const patients = Object.values(patientMap).filter(
    (item) => item.patient.category === category
  );

  const startRow = 3; // 4行目（0-indexed: 3）からデータ行開始
  patients.forEach((item, pIndex) => {
    const r = startRow + pIndex;
    const p = item.patient;
    const baseDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const deadlines = calculatePatientDeadlines(p, baseDate);

    // 基本情報列
    setCell(ws, r, 0, p.id);
    setCell(ws, r, 1, p.name);
    setCell(ws, r, 2, p.diseaseName || deadlines.diseaseLabel);
    setCell(ws, r, 3, item.totalUnits);

    // 日別単位列（E列/col 4 以降）
    for (let day = 1; day <= daysInMonth; day++) {
      const col = 3 + day;
      const u = item.dailyUnits[day] || 0;
      setCell(ws, r, col, u > 0 ? u : '');
    }

    // 早期加算回数・計画書算定等の集計列
    const earlyBonusCol = 4 + daysInMonth;
    const planCol = earlyBonusCol + 1;
    setCell(ws, r, earlyBonusCol, item.earlyBonusCount || 0);
    setCell(ws, r, planCol, item.planCount || 0);
  });

  updateSheetRange(ws);
}

/**
 * レセプト合計シートへの疾患別・点数別合算書き込み
 */
function writeReceiptTotalSheet(wb, aggregated) {
  let ws = wb.Sheets[RECEIPT_SHEET];
  if (!ws) {
    ws = window.XLSX.utils.aoa_to_sheet([['疾患区分', '対象患者数', '総単位数', '概算点数']]);
    window.XLSX.utils.book_append_sheet(wb, ws, RECEIPT_SHEET);
  }

  const statsByDisease = {
    LOCOMOTIVE: { count: 0, units: 0, points: 0 },
    CEREBROVASCULAR: { count: 0, units: 0, points: 0 },
    DISUSE: { count: 0, units: 0, points: 0 },
    ANALGESIA: { count: 0, units: 0, points: 0 }
  };

  Object.values(aggregated.patientMap).forEach((item) => {
    const p = item.patient;
    const dType = statsByDisease[p.diseaseType] ? p.diseaseType : 'LOCOMOTIVE';
    const diseaseRule = REHA_RULES.LIMIT_DAYS[dType];

    statsByDisease[dType].count += 1;
    statsByDisease[dType].units += item.totalUnits;
    statsByDisease[dType].points += item.totalUnits * diseaseRule.defaultPoints;
    if (item.planCount) {
      statsByDisease[dType].points += item.planCount * REHA_RULES.PLAN_POINTS.PLAN_1;
    }
  });

  let row = 2;
  Object.entries(statsByDisease).forEach(([key, stat]) => {
    const label = REHA_RULES.LIMIT_DAYS[key]?.fullName || key;
    setCell(ws, row, 0, label);
    setCell(ws, row, 1, stat.count);
    setCell(ws, row, 2, stat.units);
    setCell(ws, row, 3, stat.points);
    row++;
  });

  updateSheetRange(ws);
}

/**
 * テンプレート未指定時のフォールバック用シート雛形生成
 */
function initFallbackSheets(wb, daysInMonth) {
  const header = ['患者ID', '患者氏名', '疾患名', '当月計'];
  for (let d = 1; d <= daysInMonth; d++) header.push(`${d}日`);
  header.push('早期加算回数', '計画書件数');

  [INPATIENT_SHEET, OUTPATIENT_SHEET].forEach((sName) => {
    const ws = window.XLSX.utils.aoa_to_sheet([
      [`受付提出用 実施リスト (${sName})`],
      header
    ]);
    window.XLSX.utils.book_append_sheet(wb, ws, sName);
  });
}

/**
 * ワークシートの特定セル (row, col) に値を設定
 */
function setCell(ws, r, c, val) {
  const addr = window.XLSX.utils.encode_cell({ r, c });
  if (val === '' || val === null || val === undefined) {
    delete ws[addr];
    return;
  }
  const isNum = typeof val === 'number';
  ws[addr] = { t: isNum ? 'n' : 's', v: val };
}

/**
 * ワークシートの !ref を再計算して更新
 */
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

  ws['!ref'] = window.XLSX.utils.encode_range(
    { r: minR, c: minC },
    { r: maxR, c: maxC }
  );
}
