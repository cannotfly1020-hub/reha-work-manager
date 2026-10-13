// js/excel/sheets/analgesiaSheet.js
// 消炎鎮痛の実施リスト

import { REHA_RULES } from '../../config/rules.js';
import { evaluateEarlyBonusPhase } from '../../core/deadlineCalc.js';
import { aggregateFromAppSchedule } from '../../store/scheduleStore.js';
import {
  STYLES, thinBorder, getDiseaseInitial, getEarlyBaseDate,
  setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup, SUMMARY_SHEET, YEARLY_TREND_SHEET
} from '../sheetUtils.js';

export function writeAnalgesiaDedicatedSheet(wb, aggregated, sheetName) {
  const { daysInMonth, patientMap, year, month } = aggregated;
  const ws = {};
  const dayOfWeekNames = ['日', '月', '火', '水', '木', '金', '土'];

  setStyledCell(ws, 0, 0, `【${year}年${month}月 ${sheetName} (1日1回35点 / 入外合同)】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '15803D' } }
  });

  setStyledCell(ws, 1, 0, '患者ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '患者氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '区分', STYLES.headerNavy);
  setStyledCell(ws, 1, 3, '疾患名 / 部位', STYLES.headerNavy);
  setStyledCell(ws, 1, 4, '回数', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '15803D' } } });
  setStyledCell(ws, 1, 5, '総点数', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '15803D' } } });

  const dayColStart = 6;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dayOfWeek = dateObj.getDay();
    const col = dayColStart + (d - 1);
    const hLabel = `${d}\n${dayOfWeekNames[dayOfWeek]}`;

    let style = STYLES.headerNavy;
    if (dayOfWeek === 6) style = STYLES.headerSat;
    else if (dayOfWeek === 0) style = STYLES.headerSun;
    setStyledCell(ws, 1, col, hLabel, style);
  }

  const extraCol = dayColStart + daysInMonth;
  setStyledCell(ws, 1, extraCol, '備考', STYLES.headerNavy);

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
    const totalPoints = totalDays * 35;

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, catLabel, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 3, p.diseaseName || '消炎鎮痛等処置', { ...STYLES.cellNormal, fill: zebraBg, font: { sz: 8 } });

    setStyledCell(ws, curRow, 4, totalDays, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'DCFCE7' } },
      font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '15803D' } },
      numFmt: '#,##0'
    });

    setStyledCell(ws, curRow, 5, totalPoints, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'DCFCE7' } },
      font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '15803D' } },
      numFmt: '#,##0'
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const col = dayColStart + (d - 1);
      const isDone = analgesiaDaysSet.has(d);

      let cellStyle = { ...STYLES.cellCenter };
      if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
      else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
      else cellStyle.fill = zebraBg;

      if (isDone) {
        setStyledCell(ws, curRow, col, '○', { ...STYLES.cellCenter, fill: { fgColor: { rgb: 'DCFCE7' } }, font: { bold: true, color: { rgb: '15803D' } } });
      } else {
        setStyledCell(ws, curRow, col, '', cellStyle);
      }
    }

    setStyledCell(ws, curRow, extraCol, p.notes || '', { ...STYLES.cellNormal, fill: zebraBg });
    curRow++;
  });

  const aHeights = [{ hpt: 30 }, { hpt: 32 }];
  for (let r = 2; r < curRow; r++) {
    aHeights.push({ hpt: 25 });
  }
  ws['!rows'] = aHeights;

  const colProps = [
    { wch: 7.5 },       // 患者ID
    { wpx: 130 },       // 患者氏名 (130px固定)
    { wch: 4.5 },       // 区分
    { wch: 14.0 },      // 疾患名
    { wch: 6.5 },       // 回数
    { wch: 7.5 }        // 総点数
  ];
  for (let d = 1; d <= daysInMonth; d++) colProps.push({ wch: 3.6 });
  colProps.push({ wch: 10.0 });
  ws['!cols'] = colProps;

  ws['!autofilter'] = {
    ref: window.XLSX.utils.encode_range({ r: 1, c: 0 }, { r: Math.max(1, curRow - 1), c: 3 })
  };

  ws['!freeze'] = { xSplit: 'F', ySplit: '2', topLeftCell: 'G3', activePane: 'bottomRight', state: 'frozen' };

  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}
