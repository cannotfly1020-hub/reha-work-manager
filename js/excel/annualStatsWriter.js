// js/excel/annualStatsWriter.js
// 年度統計（年報）Excel出力（読み取り専用・既存帳票非干渉）

import { setStyledCell, updateSheetRange, applyA4LandscapePrintSetup, thinBorder } from './sheetUtils.js';

/**
 * @param {object} stats computeAnnualStats の結果
 * @returns {object} workbook
 */
export function generateAnnualStatsWorkbook(stats) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();
  const ws = {};
  const border = thinBorder('94A3B8');
  const headerStyle = {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border
  };
  const cellStyle = {
    font: { name: 'Meiryo UI', sz: 9 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border
  };
  const numStyle = {
    font: { name: 'Meiryo UI', sz: 9, bold: true },
    alignment: { horizontal: 'right', vertical: 'center' },
    border
  };
  const totalStyle = {
    font: { name: 'Meiryo UI', sz: 9, bold: true },
    fill: { patternType: 'solid', fgColor: { rgb: 'E0F2FE' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border
  };

  const fy = stats.fiscalYear;
  setStyledCell(ws, 0, 0, `リハビリテーション年度統計（${fy}年度）`, {
    font: { name: 'Meiryo UI', sz: 14, bold: true, color: { rgb: '0F172A' } }
  });
  setStyledCell(ws, 1, 0, `${fy}年4月〜${fy + 1}年3月 ／ 疾患別個別リハ（消炎・透析・業務ブロック除外）`, {
    font: { name: 'Meiryo UI', sz: 9, color: { rgb: '475569' } }
  });

  const s = stats.summary || {};
  setStyledCell(ws, 3, 0, '年間総単位数', headerStyle);
  setStyledCell(ws, 3, 1, s.totalUnits ?? 0, numStyle);
  setStyledCell(ws, 3, 2, '延べ実施人数', headerStyle);
  setStyledCell(ws, 3, 3, s.patientDays ?? 0, numStyle);
  setStyledCell(ws, 3, 4, '年間1日平均単位', headerStyle);
  setStyledCell(ws, 3, 5, s.avgUnits ?? 0, numStyle);
  setStyledCell(ws, 3, 6, '年間リハ退院数', headerStyle);
  setStyledCell(ws, 3, 7, s.rehabDischarges ?? 0, numStyle);

  const headers = [
    '月', '総単位数', '延べ実施人数', '1日平均単位数',
    'リハ実施退院数', '病院総退院数', 'リハ退院率(%)'
  ];
  const startRow = 5;
  headers.forEach((h, c) => setStyledCell(ws, startRow, c, h, headerStyle));

  const months = Array.isArray(stats.months) ? stats.months : [];
  months.forEach((m, idx) => {
    const r = startRow + 1 + idx;
    setStyledCell(ws, r, 0, m.label, cellStyle);
    setStyledCell(ws, r, 1, m.totalUnits, numStyle);
    setStyledCell(ws, r, 2, m.patientDays, numStyle);
    setStyledCell(ws, r, 3, m.avgUnits, numStyle);
    setStyledCell(ws, r, 4, m.rehabDischarges, numStyle);
    setStyledCell(ws, r, 5, m.hospitalTotal != null ? m.hospitalTotal : '', numStyle);
    setStyledCell(ws, r, 6, m.dischargeRate != null ? m.dischargeRate : '', numStyle);
  });

  const totalRow = startRow + 1 + months.length;
  setStyledCell(ws, totalRow, 0, '年間合計／平均', totalStyle);
  setStyledCell(ws, totalRow, 1, s.totalUnits ?? 0, totalStyle);
  setStyledCell(ws, totalRow, 2, s.patientDays ?? 0, totalStyle);
  setStyledCell(ws, totalRow, 3, s.avgUnits ?? 0, totalStyle);
  setStyledCell(ws, totalRow, 4, s.rehabDischarges ?? 0, totalStyle);
  setStyledCell(ws, totalRow, 5, s.hospitalTotal != null ? s.hospitalTotal : '', totalStyle);
  setStyledCell(ws, totalRow, 6, s.dischargeRate != null ? s.dischargeRate : '', totalStyle);

  ws['!cols'] = [
    { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }
  ];
  applyA4LandscapePrintSetup(ws, true);
  updateSheetRange(ws);
  window.XLSX.utils.book_append_sheet(wb, ws, '年度統計');
  return wb;
}

/**
 * @param {object} stats
 */
export function downloadAnnualStatsExcel(stats) {
  const wb = generateAnnualStatsWorkbook(stats);
  const fy = stats.fiscalYear;
  const filename = `リハ年度統計_${fy}年度.xlsx`;
  window.XLSX.writeFile(wb, filename);
}
