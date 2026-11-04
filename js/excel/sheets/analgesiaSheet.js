// js/excel/sheets/analgesiaSheet.js
// 消炎鎮痛の実施リスト（A4横1枚幅。ID・氏名・区分・1〜31日・回数）
// ★入院 / 外来を独立した物理タブへ分割出力（該当患者がいる場合のみ）

import {
  STYLES, setStyledCell, updateSheetRange, appendOrReplaceSheet, applyA4LandscapePrintSetup,
  ANALGESIA_SHEET
} from '../sheetUtils.js';

const DAY_OF_WEEK_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_COL_START = 3;
const COUNT_COL = DAY_COL_START + 31;

/**
 * 旧「入外合同」シート名をワークブックから除去（分割後の残骸防止）
 * @param {Object} wb
 */
function removeLegacyCombinedAnalgesiaSheet(wb) {
  if (!wb || !Array.isArray(wb.SheetNames)) return;
  const legacyNames = [ANALGESIA_SHEET, '実施リスト 消炎鎮痛', '消炎鎮痛'];
  legacyNames.forEach((name) => {
    const idx = wb.SheetNames.indexOf(name);
    if (idx >= 0) {
      const key = wb.SheetNames[idx];
      wb.SheetNames.splice(idx, 1);
      if (wb.Sheets && wb.Sheets[key]) delete wb.Sheets[key];
    }
  });
}

/**
 * 指定区分の消炎鎮痛シートを生成
 * @param {Object} wb
 * @param {Object} aggregated
 * @param {'INPATIENT'|'OUTPATIENT'} targetCategory
 * @param {string} sheetName
 * @returns {string|null} 生成したシート名（該当患者0名なら null）
 */
function buildAnalgesiaSheetForCategory(wb, aggregated, targetCategory, sheetName) {
  const { daysInMonth, patientMap, year, month } = aggregated;
  const isTarget = (p) => (
    targetCategory === 'INPATIENT'
      ? p?.category === 'INPATIENT'
      : p?.category !== 'INPATIENT'
  );

  const analgesiaPatients = Object.values(patientMap || {})
    .filter((item) => {
      if (!item?.patient || !isTarget(item.patient)) return false;
      const anaDays = item.totalAnalgesiaDays !== undefined
        ? item.totalAnalgesiaDays
        : (item.slots ? item.slots.filter((s) => s.isAnalgesia).length : 0);
      return anaDays > 0 || (item.patient.diseaseType === 'ANALGESIA' && item.totalUnits > 0);
    })
    .sort((a, b) => a.patient.id.localeCompare(b.patient.id, 'ja', { numeric: true }));

  // 該当患者が0名の場合はシートを作成しない（無駄な空シート防止）
  if (analgesiaPatients.length === 0) return null;

  const ws = {};
  const catLabel = targetCategory === 'INPATIENT' ? '入院' : '外来';

  setStyledCell(ws, 0, 0, `【${year}年${month}月 消炎鎮痛(${catLabel}) (1日1回35点)】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '15803D' } }
  });

  setStyledCell(ws, 1, 0, 'ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '区分', STYLES.headerNavy);

  for (let d = 1; d <= 31; d += 1) {
    const col = DAY_COL_START + (d - 1);
    if (d > daysInMonth) {
      setStyledCell(ws, 1, col, '', STYLES.headerNavy);
      continue;
    }
    const dateObj = new Date(year, month - 1, d);
    const dayOfWeek = dateObj.getDay();
    const hLabel = `${d}\n${DAY_OF_WEEK_NAMES[dayOfWeek]}`;
    let style = STYLES.headerNavy;
    if (dayOfWeek === 6) style = STYLES.headerSat;
    else if (dayOfWeek === 0) style = STYLES.headerSun;
    setStyledCell(ws, 1, col, hLabel, style);
  }

  setStyledCell(ws, 1, COUNT_COL, '回数', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '15803D' } } });

  let curRow = 2;
  analgesiaPatients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    const analgesiaDaysSet = new Set();
    if (item.dailyAnalgesia) {
      for (let d = 1; d <= daysInMonth; d += 1) {
        if (item.dailyAnalgesia[d] > 0) analgesiaDaysSet.add(d);
      }
    }
    if (analgesiaDaysSet.size === 0 && item.slots) {
      item.slots.forEach((s) => {
        if (s.isAnalgesia && s.date) analgesiaDaysSet.add(parseInt(s.date.split('-')[2], 10));
      });
    }
    if (analgesiaDaysSet.size === 0 && p.diseaseType === 'ANALGESIA') {
      for (let d = 1; d <= daysInMonth; d += 1) {
        if (item.dailyUnits?.[d] > 0) analgesiaDaysSet.add(d);
      }
    }

    const markCat = p.category === 'INPATIENT' ? '入' : '外';
    const totalDays = item.totalAnalgesiaDays !== undefined && item.totalAnalgesiaDays > 0
      ? item.totalAnalgesiaDays
      : analgesiaDaysSet.size;

    setStyledCell(ws, curRow, 0, p.id, {
      ...STYLES.cellCenter, fill: zebraBg, font: { name: 'Meiryo UI', sz: 9, bold: true }
    });
    setStyledCell(ws, curRow, 1, p.name, {
      ...STYLES.cellNormal, fill: zebraBg, font: { name: 'Meiryo UI', sz: 9, bold: true }
    });
    setStyledCell(ws, curRow, 2, markCat, {
      ...STYLES.cellCenter, fill: zebraBg, font: { name: 'Meiryo UI', sz: 9, bold: true }
    });

    for (let d = 1; d <= 31; d += 1) {
      const col = DAY_COL_START + (d - 1);
      if (d > daysInMonth) {
        setStyledCell(ws, curRow, col, '', { ...STYLES.cellCenter, fill: zebraBg });
        continue;
      }
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const isDone = analgesiaDaysSet.has(d);

      if (isDone) {
        setStyledCell(ws, curRow, col, '○', {
          ...STYLES.cellCenter,
          fill: { fgColor: { rgb: 'DCFCE7' } },
          font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '15803D' } }
        });
      } else {
        let cellStyle = { ...STYLES.cellCenter };
        if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
        else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
        else cellStyle.fill = zebraBg;
        setStyledCell(ws, curRow, col, '', cellStyle);
      }
    }

    setStyledCell(ws, curRow, COUNT_COL, totalDays, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'DCFCE7' } },
      font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '15803D' } },
      numFmt: '#,##0'
    });
    curRow += 1;
  });

  const aHeights = [{ hpt: 30 }, { hpt: 32 }];
  for (let r = 2; r < curRow; r += 1) {
    aHeights.push({ hpt: 25 });
  }
  ws['!rows'] = aHeights;

  ws['!cols'] = [
    { wch: 5.0 },
    { wch: 11.5 },
    { wch: 4.0 },
    ...Array.from({ length: 31 }, () => ({ wch: 3.2 })),
    { wch: 3.8 }
  ];

  ws['!autofilter'] = {
    ref: window.XLSX.utils.encode_range({ r: 1, c: 0 }, { r: Math.max(1, curRow - 1), c: 2 })
  };

  ws['!freeze'] = {
    xSplit: 3, ySplit: 2, topLeftCell: 'D3', activePane: 'bottomRight', state: 'frozen'
  };

  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
  return sheetName;
}

/**
 * 消炎鎮痛シートを出力（入院・外来の2シートに分割）
 * @param {Object} wb
 * @param {Object} aggregated
 * @param {string} [_legacySheetName] 互換用（無視）
 * @returns {string[]} 生成されたシート名一覧
 */
export function writeAnalgesiaDedicatedSheet(wb, aggregated, _legacySheetName) {
  removeLegacyCombinedAnalgesiaSheet(wb);

  const appended = [];
  const inName = buildAnalgesiaSheetForCategory(wb, aggregated, 'INPATIENT', '消炎鎮痛(入院)');
  if (inName) appended.push(inName);

  const outName = buildAnalgesiaSheetForCategory(wb, aggregated, 'OUTPATIENT', '消炎鎮痛(外来)');
  if (outName) appended.push(outName);

  return appended;
}
