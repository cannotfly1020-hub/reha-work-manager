// js/excel/uketsukeWriter.js
// 受付提出用Excelのシート組み立て
// ★個別リハは 入院/外来×疾患×通常/減算 ごとに物理タブを個別 append（1シート縦積み禁止）

import { ANALGESIA_SHEET } from './sheetUtils.js';
import { writeExecutiveSummarySheet } from './sheets/summarySheet.js';
import { writeYearlyTrendSheet } from './sheets/yearlyTrendSheet.js';
import { writeIndividualRehaSheets } from './sheets/individualRehaSheet.js';
import { writeAnalgesiaDedicatedSheet } from './sheets/analgesiaSheet.js';
import { buildPatientMonthlyListSheet } from './sheets/patientMonthlyListSheet.js';

export function generateUketsukeWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();

  // 1. 全体経営・レセプト収益サマリー
  writeExecutiveSummarySheet(wb, aggregated);

  // 2. 年間推移
  writeYearlyTrendSheet(wb, aggregated.year);

  // 3. 個別リハビリ実施リスト
  //    → 最大12物理タブ（入院_運動器(通常) 等）。各タブは1表のみ。縦積み禁止。
  const individualTabs = writeIndividualRehaSheets(wb, aggregated);
  if (typeof console !== 'undefined' && console.info) {
    console.info('[uketsuke] 個別リハ物理タブ:', individualTabs.length ? individualTabs.join(' / ') : '(該当なし)');
  }

  // 4. 消炎鎮痛（別タブ1枚）
  writeAnalgesiaDedicatedSheet(wb, aggregated, ANALGESIA_SHEET);

  // 5. 当月実施患者一覧（別タブ1枚・これは一覧用であり日別マトリクスではない）
  buildPatientMonthlyListSheet(wb, aggregated);

  return wb;
}
