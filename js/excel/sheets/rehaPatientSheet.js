// js/excel/sheets/rehaPatientSheet.js
// 入院・外来の疾患別実施リスト

import { REHA_RULES } from '../../config/rules.js';
import { evaluateEarlyBonusPhase } from '../../core/deadlineCalc.js';
import { aggregateFromAppSchedule } from '../../store/scheduleStore.js';
import {
  STYLES, thinBorder, getDiseaseInitial, getEarlyBaseDate,
  setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup, SUMMARY_SHEET, YEARLY_TREND_SHEET
} from '../sheetUtils.js';

export function writeRehaPatientSheet(wb, aggregated, category, sheetName, patients) {
  const { daysInMonth, year, month } = aggregated;
  const isInput = category === 'INPATIENT';
  const ws = {};
  const dayOfWeekNames = ['日', '月', '火', '水', '木', '金', '土'];

  setStyledCell(ws, 0, 0, `【${year}年${month}月 ${sheetName} (個別リハビリ実施リスト)】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '0F172A' } }
  });

  // 短縮ヘッダー名適用
  setStyledCell(ws, 1, 0, 'ID', STYLES.headerNavy);
  setStyledCell(ws, 1, 1, '患者氏名', STYLES.headerNavy);
  setStyledCell(ws, 1, 2, '区分', STYLES.headerNavy);
  setStyledCell(ws, 1, 3, '介', STYLES.headerNavy);
  setStyledCell(ws, 1, 4, '総', { ...STYLES.headerNavy, fill: { fgColor: { rgb: '0369A1' } } });

  const dayColStart = 5;
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
  if (isInput) {
    setStyledCell(ws, 1, extraCol, '早Ⅰ', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 1, '早Ⅱ', STYLES.headerNavy);
    setStyledCell(ws, 1, extraCol + 2, '計画', STYLES.headerNavy);
  } else {
    setStyledCell(ws, 1, extraCol, '計画', STYLES.headerNavy);
  }

  let curRow = 2;
  patients.forEach((item, pIdx) => {
    const p = item.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
    const baseEarlyDate = getEarlyBaseDate(p);

    const planDatesSet = new Set();
    const early1DatesSet = new Set();
    const early2DatesSet = new Set();
    let early1Units = 0;
    let early2Units = 0;
    let planDateStr = '';

    item.slots.forEach((s) => {
      const u = s.units || 1;
      if (s.billingPlan) {
        planDateStr = s.date ? s.date.slice(5) : '';
        planDatesSet.add(parseInt(s.date.split('-')[2], 10));
      }
      if (isInput && baseEarlyDate && s.date && !s.isAnalgesia) {
        const dNum = parseInt(s.date.split('-')[2], 10);
        const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
        if (ph.phase === 'PHASE_1') {
          early1DatesSet.add(dNum);
          early1Units += u;
        } else if (ph.phase === 'PHASE_2') {
          early2DatesSet.add(dNum);
          early2Units += u;
        }
      }
    });

    const displayDisType = (p.diseaseType && p.diseaseType !== 'ANALGESIA') ? p.diseaseType : 'LOCOMOTIVE';
    const totalRehaUnits = item.rehaTotalUnits !== undefined ? item.rehaTotalUnits : item.totalUnits;

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, getDiseaseInitial(displayDisType), { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 3, p.careInsuranceType === 'CARE' ? '介護' : (p.careInsuranceType === 'SUPPORT' ? '支援' : '-'), { ...STYLES.cellCenter, fill: zebraBg });
    
    setStyledCell(ws, curRow, 4, totalRehaUnits, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'E0F2FE' } },
      font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '0369A1' } },
      numFmt: '#,##0'
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const col = dayColStart + (d - 1);
      const u = item.dailyRehaUnits ? (item.dailyRehaUnits[d] || 0) : (item.dailyUnits[d] || 0);
      const isPlanDay = planDatesSet.has(d);
      const isEarly1Day = early1DatesSet.has(d);
      const isEarly2Day = early2DatesSet.has(d);

      let cellStyle = { ...STYLES.cellUnit };
      if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
      else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
      else cellStyle.fill = zebraBg;

      if (u > 0) {
        if (isPlanDay) {
          setStyledCell(ws, curRow, col, `${u}★`, STYLES.cellPlanStar);
        } else if (isEarly1Day) {
          setStyledCell(ws, curRow, col, u, STYLES.cellEarly1);
        } else if (isEarly2Day) {
          setStyledCell(ws, curRow, col, u, STYLES.cellEarly2);
        } else {
          setStyledCell(ws, curRow, col, u, cellStyle);
        }
      } else {
        setStyledCell(ws, curRow, col, '', cellStyle);
      }
    }

    if (isInput) {
      setStyledCell(ws, curRow, extraCol, early1Units > 0 ? early1Units : '-', {
        ...STYLES.cellCenter,
        fill: early1Units > 0 ? { fgColor: { rgb: 'D1FAE5' } } : zebraBg,
        font: { bold: early1Units > 0 }
      });
      setStyledCell(ws, curRow, extraCol + 1, early2Units > 0 ? early2Units : '-', {
        ...STYLES.cellCenter,
        fill: early2Units > 0 ? { fgColor: { rgb: 'DBEAFE' } } : zebraBg,
        font: { bold: early2Units > 0 }
      });
      setStyledCell(ws, curRow, extraCol + 2, planDateStr || '-', { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true, color: { rgb: 'B45309' } } });
    } else {
      setStyledCell(ws, curRow, extraCol, planDateStr || '-', { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true, color: { rgb: 'B45309' } } });
    }

    curRow++;
  });

  // 行高設定：ヘッダーは30ptで改行潰れゼロ、データ行はゆったり25ptで堂々とした見栄えに
  const rHeights = [{ hpt: 30 }, { hpt: 32 }];
  for (let r = 2; r < curRow; r++) {
    rHeights.push({ hpt: 25 });
  }
  ws['!rows'] = rHeights;

  // ★列幅設定：Excel内部展開比率（約1.165倍）を逆算補正し、目標ピクセル（42, 80, 29, 23, 29, 23, 34, 38px）にジャスト調整
  const colProps = [
    { wpx: 36 },        // ID (目標 42px 狙い: 36 * 1.167 ≒ 42px)
    { wpx: 69 },        // 患者氏名 (目標 80px 狙い: 69 * 1.163 ≒ 80px)
    { wpx: 25 },        // 区分 (目標 29px 狙い: 25 * 1.172 ≒ 29px)
    { wpx: 20 },        // 介 (目標 23px 狙い: 20 * 1.17 ≒ 23px)
    { wpx: 25 }         // 総 (目標 29px 狙い: 25 * 1.172 ≒ 29px)
  ];
  for (let d = 1; d <= daysInMonth; d++) {
    colProps.push({ wpx: 20 }); // 日付 (目標 23px 狙い: 20 * 1.17 ≒ 23px)
  }
  if (isInput) colProps.push({ wpx: 29 }, { wpx: 29 }, { wpx: 33 }); // 早Ⅰ(34px), 早Ⅱ(34px), 計画(38px)
  else colProps.push({ wpx: 33 });                                     // 計画(38px)
  ws['!cols'] = colProps;

  ws['!autofilter'] = {
    ref: window.XLSX.utils.encode_range({ r: 1, c: 0 }, { r: Math.max(1, curRow - 1), c: 3 })
  };

  ws['!freeze'] = { xSplit: 'E', ySplit: '2', topLeftCell: 'F3', activePane: 'bottomRight', state: 'frozen' };

  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, sheetName);
}
