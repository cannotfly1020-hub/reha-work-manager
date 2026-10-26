// js/excel/uketsukeWriter.js
// 受付提出用Excelのシート組み立て
// ★個別リハ実施リストは医事課要望により「通常／減算」2シートへ分離（旧疾患別日別グリッドは呼び出し停止・ファイルは残置）

import { ANALGESIA_SHEET } from './sheetUtils.js';
import { writeExecutiveSummarySheet } from './sheets/summarySheet.js';
import { writeYearlyTrendSheet } from './sheets/yearlyTrendSheet.js';
import { writeIndividualRehaSheets } from './sheets/individualRehaSheet.js';
import { writeAnalgesiaDedicatedSheet } from './sheets/analgesiaSheet.js';
import { buildPatientMonthlyListSheet } from './sheets/patientMonthlyListSheet.js';

export function generateUketsukeWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();

  // 1. 全体経営・レセプト収益サマリー（入院・外来・総合計 完全細分化版）
  writeExecutiveSummarySheet(wb, aggregated);

  // 2. 年間推移シート（当年1月〜12月 入外別推移）
  writeYearlyTrendSheet(wb, aggregated.year);

  // 3. 個別リハビリ実施リスト（通常・減算なし / 維持期減算）※医事課提出用・A4横1枚
  writeIndividualRehaSheets(wb, aggregated);

  // 4. 消炎鎮痛 専用シート
  writeAnalgesiaDedicatedSheet(wb, aggregated, ANALGESIA_SHEET);

  // 5. 当月実施患者一覧（区分×疾患×算定ステータス）※受付提出用
  buildPatientMonthlyListSheet(wb, aggregated);

  return wb;
}
