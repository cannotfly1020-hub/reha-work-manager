// js/excel/uketsukeWriter.js
// 受付提出用Excelのシート組み立て
// ★個別リハ: グループごとに物理タブを個別 append（1シート縦積み禁止・凡例なし）

import { ANALGESIA_SHEET } from './sheetUtils.js';
import { writeExecutiveSummarySheet } from './sheets/summarySheet.js';
import { writeYearlyTrendSheet } from './sheets/yearlyTrendSheet.js';
import { writeIndividualRehaSheets } from './sheets/individualRehaSheet.js';
import { writeAnalgesiaDedicatedSheet } from './sheets/analgesiaSheet.js';
import { buildPatientMonthlyListSheet } from './sheets/patientMonthlyListSheet.js';

export function generateUketsukeWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();

  // 1. レセプト収益サマリー
  writeExecutiveSummarySheet(wb, aggregated);

  // 2. 年間推移
  writeYearlyTrendSheet(wb, aggregated.year);

  // 3. 個別リハビリ実施リスト（最大12物理タブ・各タブは1表のみ・凡例なし）
  const individualTabs = writeIndividualRehaSheets(wb, aggregated);
  if (typeof console !== 'undefined' && console.info) {
    console.info('[uketsuke] 個別リハ物理タブ:', individualTabs.length ? individualTabs.join(' / ') : '(該当なし)');
  }

  // 4. 消炎鎮痛
  writeAnalgesiaDedicatedSheet(wb, aggregated, ANALGESIA_SHEET);

  // 5. 当月実施患者一覧
  buildPatientMonthlyListSheet(wb, aggregated);

  return wb;
}
