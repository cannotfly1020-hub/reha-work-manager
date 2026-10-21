// js/excel/sheets/analgesiaSheet.js
// 消炎鎮痛の実施リスト（A4横1枚幅。ID・氏名・区分・1〜31日・回数）

import {
  STYLES, setStyledCell, updateSheetRange, appendOrReplaceSheet, applyA4LandscapePrintSetup
} from '../sheetUtils.js';

export function writeAnalgesiaDedicatedSheet(wb, aggregated, sheetName) {
  const { daysInMonth, patientMap, year, month } = aggregated;
  const ws = {};
  const dayOfWeekNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayColStart = 3;
  const countCol = dayColStart + 31;

  setStyledCell(ws, 0, 0, `【${year}年${month}月 ${sheetName} (1日1回35点 / 入外合同)】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '15803D' } }
  });

  setStyledCell(ws, 1, 0, 'ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '区分', STYLES.headerNavy);

  for (let d = 1; d <= 31; d++) {
    const col = dayColStart + (d - 1);
    if (d > daysInMonth) {
      setStyledCell(ws, 1, col, '', STYLES.headerNavy);
      continue;
    }
    const dateObj = new Date(year, month - 1, d);
    const dayOfWeek = dateObj.getDay();
    const hLabel = `${d}\n${dayOfWeekNames[dayOfWeek]}`;
    let style = STYLES.headerNavy;
    if (dayOfWeek === 6) style = STYLES.headerSat;
    else if (dayOfWeek === 0) style = STYLES.headerSun;
    setStyledCell(ws, 1, col, hLabel, style);
  }

  setStyledCell(ws, 1, countCol, '回数', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '15803D' } } });

  const analgesiaPatients = Object.values(patientMap)
    .filter((item) => {
      const anaDays = item.totalAnalgesiaDays !== undefined ? item.totalAnalgesiaDays : (item.slots ? item.slots.filter((s) => s.isAnalgesia).length : 0);
      return anaDays > 0 || (item.patient.diseaseType === 'ANALGESIA' && item.totalUnits > 0);
    })
    .sort((a, b) => a.patient.id.localeCompare(b.patient.id, 'ja', { numeric: true }));

  let curRow = 2;
  analgesiaPatients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    const analgesiaDaysSet = new Set();
    if (item.dailyAnalgesia) {
      for (let d = 1; d <= daysInMonth; d++) {
        if (item.dailyAnalgesia[d] > 0) analgesiaDaysSet.add(d);
      }
    }
    if (analgesiaDaysSet.size === 0 && item.slots) {
      item.slots.forEach((s) => {
        if (s.isAnalgesia && s.date) analgesiaDaysSet.add(parseInt(s.date.split('-')[2], 10));
      });
    }
    if (analgesiaDaysSet.size === 0 && p.diseaseType === 'ANALGESIA') {
      for (let d = 1; d <= daysInMonth; d++) {
        if (item.dailyUnits[d] > 0) analgesiaDaysSet.add(d);
      }
    }

    const catLabel = p.category === 'INPATIENT' ? '入' : '外';
    const totalDays = item.totalAnalgesiaDays !== undefined && item.totalAnalgesiaDays > 0 ? item.totalAnalgesiaDays : analgesiaDaysSet.size;

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { name: 'Meiryo UI', sz: 9, bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { name: 'Meiryo UI', sz: 9, bold: true } });
    setStyledCell(ws, curRow, 2, catLabel, { ...STYLES.cellCenter, fill: zebraBg, font: { name: 'Meiryo UI', sz: 9, bold: true } });

    for (let d = 1; d <= 31; d++) {
      const col = dayColStart + (d - 1);
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

    setStyledCell(ws, curRow, countCol, totalDays, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'DCFCE7' } },
      font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '15803D' } },
      numFmt: '#,##0'
    });
    curRow++;
  });

  const aHeights = [{ hpt: 30 }, { hpt: 32 }];
  for (let r = 2; r < curRow; r++) {
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

  ws['!freeze'] = { xSplit: 3, ySplit: 2, topLeftCell: 'D3', activePane: 'bottomRight', state: 'frozen' };

  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}
