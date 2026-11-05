// js/excel/sheets/orthoticsSheet.js
// 装具採型採寸料（J119-2）月間算定実績一覧（いとう腎クリニック専用）

import { ORTHOTICS_RULES } from '../../config/rules.js';
import { getDailySchedule, listTherapistIdsFromSchedule } from '../../store/scheduleStore.js';
import { getPatientById } from '../../store/patientStore.js';
import { getTherapistById } from '../../store/therapistStore.js';
import {
  STYLES, setStyledCell, updateSheetRange, appendOrReplaceSheet, applyA4LandscapePrintSetup
} from '../sheetUtils.js';

const SHEET_NAME = '装具採型採寸料';

/**
 * @param {string} typeCode
 * @returns {{ label: string, points: number }}
 */
function resolveOrthoMeta(typeCode) {
  const found = (ORTHOTICS_RULES.TYPES || []).find((t) => t.code === typeCode);
  if (found) return { label: found.label, points: Number(found.points) || 0 };
  return { label: String(typeCode || '装具'), points: 0 };
}

/**
 * 当月の装具採型採寸実績を実施日順に抽出
 * @param {Object} aggregated
 * @returns {Array<object>}
 */
function collectOrthoticsRecords(aggregated) {
  const { year, month, daysInMonth, patientMap } = aggregated;
  /** @type {Array<object>} */
  const records = [];
  const seen = new Set();

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const schedule = getDailySchedule(dayStr);

    listTherapistIdsFromSchedule(schedule).forEach((tId) => {
      const slots = schedule[tId] || {};
      Object.entries(slots).forEach(([slotId, item]) => {
        if (!item?.patientId || !item.orthoticsBilling || typeof item.orthoticsBilling !== 'object') return;
        const meta = resolveOrthoMeta(item.orthoticsBilling.typeCode);
        const key = `${dayStr}|${item.patientId}|${item.orthoticsBilling.typeCode || ''}|${slotId}`;
        if (seen.has(key)) return;
        seen.add(key);
        const patient = getPatientById(item.patientId) || patientMap?.[item.patientId]?.patient
          || { id: item.patientId, name: '未登録患者', category: 'OUTPATIENT' };
        const therapist = getTherapistById(tId);
        records.push({
          date: dayStr,
          patientId: patient.id,
          patientName: patient.name || item.patientId,
          category: patient.category === 'INPATIENT' ? '入院' : '外来',
          typeLabel: meta.label,
          points: meta.points,
          doctorName: String(item.orthoticsBilling.doctorName || '').trim() || '—',
          therapistName: therapist?.name || tId
        });
      });
    });
  }

  // patientMap スロットからも補完
  Object.values(patientMap || {}).forEach((entry) => {
    const p = entry?.patient;
    if (!p?.id) return;
    (entry.slots || []).forEach((s) => {
      if (!s?.orthoticsBilling || typeof s.orthoticsBilling !== 'object') return;
      const dayStr = String(s.date || '');
      if (!dayStr.startsWith(`${year}-${String(month).padStart(2, '0')}`)) return;
      const meta = resolveOrthoMeta(s.orthoticsBilling.typeCode);
      const key = `${dayStr}|${p.id}|${s.orthoticsBilling.typeCode || ''}|${s.slotId || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const therapist = s.therapist ? getTherapistById(s.therapist) : null;
      records.push({
        date: dayStr,
        patientId: p.id,
        patientName: p.name || p.id,
        category: p.category === 'INPATIENT' ? '入院' : '外来',
        typeLabel: meta.label,
        points: meta.points,
        doctorName: String(s.orthoticsBilling.doctorName || '').trim() || '—',
        therapistName: therapist?.name || s.therapist || '—'
      });
    });
  });

  records.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.patientId).localeCompare(String(b.patientId), 'ja', { numeric: true }));
  return records;
}

/**
 * 装具採型採寸料シートを出力
 * @param {Object} wb
 * @param {Object} aggregated
 * @returns {string|null}
 */
export function writeOrthoticsSheet(wb, aggregated) {
  const { year, month } = aggregated;
  const records = collectOrthoticsRecords(aggregated);
  if (records.length === 0) return null;

  const ws = {};
  setStyledCell(ws, 0, 0, `【${year}年${month}月 装具採型採寸料 算定実績一覧表】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '7C3AED' } }
  });

  const headers = [
    '実施日', '患者ID', '患者氏名', '区分', '装具区分・名称', '算定点数', '立会医師', '担当セラピスト'
  ];
  headers.forEach((h, c) => {
    setStyledCell(ws, 1, c, h, {
      ...STYLES.headerNavy,
      fill: { fgColor: { rgb: c === 5 ? '7C3AED' : '1E293B' } }
    });
  });

  let curRow = 2;
  let totalPoints = 0;
  records.forEach((r, idx) => {
    const zebraBg = (idx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };
    totalPoints += Number(r.points) || 0;
    const dateDisp = String(r.date || '').replace(/-/g, '/');

    setStyledCell(ws, curRow, 0, dateDisp, { ...STYLES.cellCenter, fill: zebraBg });
    setStyledCell(ws, curRow, 1, r.patientId, {
      ...STYLES.cellCenter, fill: zebraBg, font: { name: 'Meiryo UI', sz: 9, bold: true }
    });
    setStyledCell(ws, curRow, 2, r.patientName, {
      ...STYLES.cellNormal, fill: zebraBg, font: { name: 'Meiryo UI', sz: 9, bold: true }
    });
    setStyledCell(ws, curRow, 3, r.category, { ...STYLES.cellCenter, fill: zebraBg });
    setStyledCell(ws, curRow, 4, r.typeLabel, { ...STYLES.cellNormal, fill: zebraBg });
    setStyledCell(ws, curRow, 5, r.points, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: 'F5F3FF' } },
      font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '6D28D9' } },
      numFmt: '#,##0'
    });
    setStyledCell(ws, curRow, 6, r.doctorName, { ...STYLES.cellNormal, fill: zebraBg });
    setStyledCell(ws, curRow, 7, r.therapistName, { ...STYLES.cellNormal, fill: zebraBg });
    curRow += 1;
  });

  // 合計行
  setStyledCell(ws, curRow, 0, '合計', {
    ...STYLES.cellSubTotal,
    alignment: { horizontal: 'center', vertical: 'center' }
  });
  setStyledCell(ws, curRow, 1, `${records.length} 件`, {
    ...STYLES.cellSubTotal,
    alignment: { horizontal: 'center', vertical: 'center' }
  });
  for (let c = 2; c <= 4; c += 1) {
    setStyledCell(ws, curRow, c, '', STYLES.cellSubTotal);
  }
  setStyledCell(ws, curRow, 5, totalPoints, {
    ...STYLES.cellSubTotal,
    alignment: { horizontal: 'center', vertical: 'center' },
    font: { name: 'Meiryo UI', sz: 10, bold: true, color: { rgb: '6D28D9' } },
    numFmt: '#,##0"点"'
  });
  setStyledCell(ws, curRow, 6, '', STYLES.cellSubTotal);
  setStyledCell(ws, curRow, 7, '', STYLES.cellSubTotal);

  const heights = [{ hpt: 30 }, { hpt: 26 }];
  for (let r = 2; r <= curRow; r += 1) heights.push({ hpt: 22 });
  ws['!rows'] = heights;
  ws['!cols'] = [
    { wch: 12 },
    { wch: 8 },
    { wch: 14 },
    { wch: 6 },
    { wch: 22 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 }
  ];
  ws['!freeze'] = {
    xSplit: 0, ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen'
  };

  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, SHEET_NAME);
  return SHEET_NAME;
}
