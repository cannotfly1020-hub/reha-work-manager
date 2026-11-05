// js/excel/sheets/dialysisRehaSheet.js
// 透析時運動指導等加算（1回75点）月間実施実績表（いとう腎クリニック専用）

import { ORTHOTICS_RULES } from '../../config/rules.js';
import { getDailySchedule } from '../../store/scheduleStore.js';
import { getPatientById } from '../../store/patientStore.js';
import {
  STYLES, setStyledCell, updateSheetRange, appendOrReplaceSheet, applyA4LandscapePrintSetup
} from '../sheetUtils.js';

const DAY_OF_WEEK_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_COL_START = 3;
const COUNT_COL = DAY_COL_START + 31;
const POINTS_COL = COUNT_COL + 1;
const DIALYSIS_POINTS = Number(ORTHOTICS_RULES.DIALYSIS_REHA_POINTS) || 75;
const SHEET_NAME = '透析時運動加算';

/**
 * 当月の透析加算実績を患者別に集計
 * @param {Object} aggregated
 * @returns {Array<{ patient: object, days: Set<number>, count: number }>}
 */
function collectDialysisPatientRows(aggregated) {
  const { year, month, daysInMonth, patientMap } = aggregated;
  /** @type {Map<string, { patient: object, days: Set<number>, count: number }>} */
  const byId = new Map();

  const ensure = (pId, fallback) => {
    if (!byId.has(pId)) {
      const patient = getPatientById(pId) || fallback || patientMap?.[pId]?.patient
        || { id: pId, name: '未登録患者', category: 'OUTPATIENT' };
      byId.set(pId, { patient, days: new Set(), count: 0 });
    }
    return byId.get(pId);
  };

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const schedule = getDailySchedule(dayStr);

    // 並行レーン schedule.dialysis（同一患者・同一日は1回としてカウント）
    Object.values(schedule.dialysis || {}).forEach((ids) => {
      if (!Array.isArray(ids)) return;
      ids.forEach((pId) => {
        const row = ensure(pId);
        if (!row.days.has(d)) {
          row.days.add(d);
          row.count += 1;
        }
      });
    });

    // 旧スロット互換 isDialysisReha
    Object.entries(schedule || {}).forEach(([key, slotsMap]) => {
      if (key === 'analgesia' || key === 'dialysis') return;
      if (!slotsMap || typeof slotsMap !== 'object' || Array.isArray(slotsMap)) return;
      Object.values(slotsMap).forEach((item) => {
        if (!item?.patientId || item.isDialysisReha !== true) return;
        const row = ensure(item.patientId);
        if (!row.days.has(d)) {
          row.days.add(d);
          row.count += 1;
        }
      });
    });
  }

  // patientMap の集計スロットからも補完（レーン集計経由）
  Object.values(patientMap || {}).forEach((entry) => {
    const p = entry?.patient;
    if (!p?.id) return;
    (entry.slots || []).forEach((s) => {
      if (!s?.isDialysisReha && s?.therapist !== 'DIALYSIS') return;
      const day = Number(String(s.date || '').slice(8, 10));
      if (!(day >= 1 && day <= daysInMonth)) return;
      const row = ensure(p.id, p);
      if (!row.days.has(day)) {
        row.days.add(day);
        row.count += 1;
      }
    });
  });

  return [...byId.values()]
    .filter((r) => r.count > 0 || r.days.size > 0)
    .sort((a, b) => String(a.patient.id).localeCompare(String(b.patient.id), 'ja', { numeric: true }));
}

/**
 * 透析時運動指導等加算シートを出力
 * @param {Object} wb
 * @param {Object} aggregated
 * @returns {string|null} 生成シート名（該当0名なら null）
 */
export function writeDialysisRehaSheet(wb, aggregated) {
  const { year, month, daysInMonth } = aggregated;
  const rows = collectDialysisPatientRows(aggregated);
  if (rows.length === 0) return null;

  const ws = {};
  setStyledCell(ws, 0, 0, `【${year}年${month}月 人工腎臓 透析時運動指導等加算 集計表 (1回${DIALYSIS_POINTS}点)】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '0284C7' } }
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

  setStyledCell(ws, 1, COUNT_COL, '実施回数', {
    ...STYLES.headerNavy, fill: { fgColor: { rgb: '0284C7' } }
  });
  setStyledCell(ws, 1, POINTS_COL, '合計点数', {
    ...STYLES.headerNavy, fill: { fgColor: { rgb: '0369A1' } }
  });

  let curRow = 2;
  rows.forEach((row, pIdx) => {
    const p = row.patient;
    const zebraBg = (pIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
    const markCat = p.category === 'INPATIENT' ? '入' : '外';
    const sessionCount = Math.max(row.count, row.days.size);
    const totalPoints = sessionCount * DIALYSIS_POINTS;

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
      const isDone = row.days.has(d);

      if (isDone) {
        setStyledCell(ws, curRow, col, '○', {
          ...STYLES.cellCenter,
          fill: { fgColor: { rgb: 'E0F2FE' } },
          font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '0369A1' } }
        });
      } else {
        let cellStyle = { ...STYLES.cellCenter };
        if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
        else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
        else cellStyle.fill = zebraBg;
        setStyledCell(ws, curRow, col, '', cellStyle);
      }
    }

    setStyledCell(ws, curRow, COUNT_COL, `${sessionCount} 回`, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'E0F2FE' } },
      font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '0369A1' } }
    });
    setStyledCell(ws, curRow, POINTS_COL, totalPoints, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'DBEAFE' } },
      font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '1E40AF' } },
      numFmt: '#,##0"点"'
    });
    curRow += 1;
  });

  const heights = [{ hpt: 30 }, { hpt: 32 }];
  for (let r = 2; r < curRow; r += 1) heights.push({ hpt: 25 });
  ws['!rows'] = heights;
  ws['!cols'] = [
    { wch: 5.0 },
    { wch: 11.5 },
    { wch: 4.0 },
    ...Array.from({ length: 31 }, () => ({ wch: 3.2 })),
    { wch: 7.0 },
    { wch: 8.0 }
  ];
  ws['!freeze'] = {
    xSplit: 3, ySplit: 2, topLeftCell: 'D3', activePane: 'bottomRight', state: 'frozen'
  };

  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, SHEET_NAME);
  return SHEET_NAME;
}
