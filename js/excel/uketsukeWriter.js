// js/excel/uketsukeWriter.js
// 受付提出用Excelのシート組み立て
// ★個別リハ: 物理タブ分割 ＋ 当月切替患者の通常/減算日割りマトリクス

import { ANALGESIA_SHEET } from './sheetUtils.js';
import { writeExecutiveSummarySheet } from './sheets/summarySheet.js';
import { writeYearlyTrendSheet } from './sheets/yearlyTrendSheet.js';
import { writeIndividualRehaSheets } from './sheets/individualRehaSheet.js';
import { writeAnalgesiaDedicatedSheet } from './sheets/analgesiaSheet.js';
import { buildPatientMonthlyListSheet } from './sheets/patientMonthlyListSheet.js';

export function generateUketsukeWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();

  writeExecutiveSummarySheet(wb, aggregated);
  writeYearlyTrendSheet(wb, aggregated.year);

  // 個別リハ: 最大12物理タブ。当月切替は通常期間／減算期間で日割り分割出力
  const individualTabs = writeIndividualRehaSheets(wb, aggregated);
  if (typeof console !== 'undefined' && console.info) {
    console.info('[uketsuke] 個別リハ物理タブ:', individualTabs.length ? individualTabs.join(' / ') : '(該当なし)');
  }

  writeAnalgesiaDedicatedSheet(wb, aggregated, ANALGESIA_SHEET);
  buildPatientMonthlyListSheet(wb, aggregated);

  return wb;
}
