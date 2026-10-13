// js/excel/uketsukeWriter.js
// 受付提出用Excelのシート組み立て

import { ANALGESIA_SHEET } from './sheetUtils.js';
import { writeExecutiveSummarySheet } from './sheets/summarySheet.js';
import { writeYearlyTrendSheet } from './sheets/yearlyTrendSheet.js';
import { writeRehaPatientSheet } from './sheets/rehaPatientSheet.js';
import { writeAnalgesiaDedicatedSheet } from './sheets/analgesiaSheet.js';

export function generateUketsukeWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();

  // 1. 全体経営・レセプト収益サマリー（入院・外来・総合計 完全細分化版）
  writeExecutiveSummarySheet(wb, aggregated);

  // 2. 年間推移シート（当年1月〜12月 入外別推移）
  writeYearlyTrendSheet(wb, aggregated.year);

  // 月内個別リハビリ実績がある患者を抽出
  const allRehaPatients = Object.values(aggregated.patientMap)
    .filter((item) => {
      const rehaUnits = item.rehaTotalUnits !== undefined ? item.rehaTotalUnits : (item.patient.diseaseType !== 'ANALGESIA' ? item.totalUnits : 0);
      return rehaUnits > 0;
    })
    .sort((a, b) => a.patient.id.localeCompare(b.patient.id, 'ja', { numeric: true }));

  const filterByCatAndDisease = (cat, dType) => {
    return allRehaPatients.filter((item) => {
      if (item.patient.category !== cat) return false;
      const targetDis = (item.patient.diseaseType && item.patient.diseaseType !== 'ANALGESIA') ? item.patient.diseaseType : 'LOCOMOTIVE';
      return targetDis === dType;
    });
  };

  // 3. 入院シート（運動器・脳血管・廃用）
  const inLoco = filterByCatAndDisease('INPATIENT', 'LOCOMOTIVE');
  const inCerebro = filterByCatAndDisease('INPATIENT', 'CEREBROVASCULAR');
  const inDisuse = filterByCatAndDisease('INPATIENT', 'DISUSE');

  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', '入院 運動器', inLoco);
  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', '入院 脳血管', inCerebro);
  writeRehaPatientSheet(wb, aggregated, 'INPATIENT', '入院 廃用', inDisuse);

  // 4. 外来シート（運動器①・運動器②・脳血管・廃用）
  const outLocoAll = filterByCatAndDisease('OUTPATIENT', 'LOCOMOTIVE');
  const outCerebro = filterByCatAndDisease('OUTPATIENT', 'CEREBROVASCULAR');
  const outDisuse = filterByCatAndDisease('OUTPATIENT', 'DISUSE');

  const mid = Math.ceil(outLocoAll.length / 2);
  const outLoco1 = outLocoAll.slice(0, mid);
  const outLoco2 = outLocoAll.slice(mid);

  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', '外来 運動器①', outLoco1);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', '外来 運動器②', outLoco2);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', '外来 脳血管', outCerebro);
  writeRehaPatientSheet(wb, aggregated, 'OUTPATIENT', '外来 廃用', outDisuse);

  // 5. 消炎鎮痛 専用シート
  writeAnalgesiaDedicatedSheet(wb, aggregated, ANALGESIA_SHEET);

  return wb;
}
