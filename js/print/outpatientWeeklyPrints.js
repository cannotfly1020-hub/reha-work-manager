// js/print/outpatientWeeklyPrints.js
// 旧混在ファイルの互換再エクスポート（本体は完全分離済み）
// 受付簿: printWeeklyReceptionBook.js ／ 翌週表: printNextWeekBookingSheet.js

export {
  printWeeklyReceptionBook,
  printHandwritingWeeklySheet
} from './printWeeklyReceptionBook.js';

export {
  printNextWeekBookingSheet,
  printWeeklyPaperBookingSheet,
  openNextWeekBookingSheetPrintFlow,
  showNextWeekPrintWeekPicker
} from './printNextWeekBookingSheet.js';
