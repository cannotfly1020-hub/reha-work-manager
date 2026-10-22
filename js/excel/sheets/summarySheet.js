// js/excel/sheets/summarySheet.js
// レセプト収益サマリー

import { REHA_RULES } from '../../config/rules.js';
import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import {
  STYLES, thinBorder, getEarlyBaseDate,
  setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup, SUMMARY_SHEET
} from '../sheetUtils.js';

export function writeExecutiveSummarySheet(wb, aggregated) {
  const { patientMap, year, month } = aggregated;
  const ws = {};
  const rowHeights = [];

  // units = 実施単位, pts = 実施日別単価で積算した総点数（維持期日割り対応）
  const inStats = {
    LOCOMOTIVE: 0, CEREBROVASCULAR: 0, DISUSE: 0,
    LOCOMOTIVE_PTS: 0, CEREBROVASCULAR_PTS: 0, DISUSE_PTS: 0,
    early1: 0, early2: 0,
    planPts: 0, planCount: 0
  };
  const outStats = {
    LOCOMOTIVE: 0, CEREBROVASCULAR: 0, DISUSE: 0,
    LOCOMOTIVE_PTS: 0, CEREBROVASCULAR_PTS: 0, DISUSE_PTS: 0,
    analgesia: 0,
    planPts: 0, planCount: 0
  };

  Object.values(patientMap).forEach((item) => {
    const p = item.patient;
    const isInput = p.category === 'INPATIENT';
    const target = isInput ? inStats : outStats;
    const baseEarlyDate = getEarlyBaseDate(p);

    item.slots.forEach((s) => {
      if (s.isAnalgesia) {
        if (!isInput) target.analgesia++;
        return;
      }

      const u = Number(s.units) || 1;
      const dType = (p.diseaseType && p.diseaseType !== 'ANALGESIA') ? p.diseaseType : 'LOCOMOTIVE';
      if (target[dType] !== undefined) {
        const rate = getDailyBasePoints(p, s.date);
        target[dType] += u;
        target[`${dType}_PTS`] += rate.points * u;
      }

      if (s.billingPlan && REHA_RULES.PLAN_POINTS[s.billingPlan]) {
        target.planPts += REHA_RULES.PLAN_POINTS[s.billingPlan];
        target.planCount++;
      }

      // 早期加算は単位ごとに計上（収益ダッシュボードと一致）
      if (isInput && baseEarlyDate && s.date) {
        const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
        if (ph.phase === 'PHASE_1') inStats.early1 += u;
        else if (ph.phase === 'PHASE_2') inStats.early2 += u;
      }
    });
  });

  // タイトル（A列から開始、ゆったり36pt）
  setStyledCell(ws, 0, 0, `【${year}年${month}月 リハビリテーション科 レセプト確定・経営収益サマリー (入院・外来別内訳)】`, {
    font: { name: 'Meiryo UI', sz: 14, bold: true, color: { rgb: '0F172A' } },
    alignment: { vertical: 'center' }
  });
  rowHeights[0] = 36;
  rowHeights[1] = 14;

  const headers = ['項目 / 算定区分', '算定対象 (単位/回)', '単価点数', '総点数', '総売上金額 (¥)', '備考・算定区分'];
  headers.forEach((h, idx) => setStyledCell(ws, 2, idx, h, {
    ...STYLES.headerNavy,
    font: { ...STYLES.headerNavy.font, sz: 10 }
  }));
  rowHeights[2] = 28;

  let rIdx = 3;

  const renderSectionHeader = (title, bgColor) => {
    rowHeights[rIdx] = 26;
    setStyledCell(ws, rIdx, 0, title, {
      font: { name: 'Meiryo UI', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: bgColor } },
      alignment: { vertical: 'center' },
      border: thinBorder()
    });
    for (let c = 1; c < 6; c++) {
      setStyledCell(ws, rIdx, c, '', { fill: { fgColor: { rgb: bgColor } }, border: thinBorder() });
    }
    rIdx++;
  };

  const renderDataRow = (name, qty, unitPts, customPts = null, note = '') => {
    rowHeights[rIdx] = 25;
    const totPts = customPts !== null ? customPts : qty * unitPts;
    const totYen = totPts * 10;
    const bg = (rIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    setStyledCell(ws, rIdx, 0, name, { ...STYLES.cellNormal, font: { name: 'Meiryo UI', sz: 9.5 }, fill: bg });
    setStyledCell(ws, rIdx, 1, qty, { ...STYLES.cellCenter, font: { name: 'Meiryo UI', sz: 9.5 }, fill: bg, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 2, unitPts > 0 ? unitPts : '-', { ...STYLES.cellCenter, font: { name: 'Meiryo UI', sz: 9.5 }, fill: bg, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 3, totPts, { ...STYLES.cellRight, fill: bg, numFmt: '#,##0', font: { name: 'Meiryo UI', sz: 9.5, bold: true } });
    setStyledCell(ws, rIdx, 4, totYen, { ...STYLES.cellRight, fill: bg, numFmt: '¥#,##0', font: { name: 'Meiryo UI', sz: 10, bold: true, color: { rgb: '047857' } } });
    setStyledCell(ws, rIdx, 5, note, { ...STYLES.cellNormal, fill: bg, font: { name: 'Meiryo UI', sz: 8.5, color: { rgb: '64748B' } } });
    rIdx++;
    return { pts: totPts, yen: totYen, units: qty };
  };

  const renderSubTotalRow = (title, units, totPts, totYen) => {
    rowHeights[rIdx] = 28;
    setStyledCell(ws, rIdx, 0, title, { ...STYLES.cellSubTotal, font: { ...STYLES.cellSubTotal.font, sz: 10 }, alignment: { vertical: 'center' } });
    setStyledCell(ws, rIdx, 1, units, { ...STYLES.cellSubTotal, font: { ...STYLES.cellSubTotal.font, sz: 10 }, alignment: { horizontal: 'center', vertical: 'center' }, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 2, '-', { ...STYLES.cellSubTotal, font: { ...STYLES.cellSubTotal.font, sz: 10 }, alignment: { horizontal: 'center', vertical: 'center' } });
    setStyledCell(ws, rIdx, 3, totPts, { ...STYLES.cellSubTotal, font: { ...STYLES.cellSubTotal.font, sz: 10 }, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 4, totYen, { ...STYLES.cellSubTotal, alignment: { horizontal: 'right', vertical: 'center' }, font: { name: 'Meiryo UI', sz: 10.5, bold: true, color: { rgb: '047857' } }, numFmt: '¥#,##0' });
    setStyledCell(ws, rIdx, 5, '小計 (単位・点数×10円)', { ...STYLES.cellSubTotal, font: { name: 'Meiryo UI', sz: 8.5, color: { rgb: '475569' } } });
    rIdx++;
  };

  // 1. 【入院セクション】
  renderSectionHeader('■ 【入院】リハビリテーション算定項目', '0284C7');
  let inTotalUnits = inStats.LOCOMOTIVE + inStats.CEREBROVASCULAR + inStats.DISUSE;
  let inTotalPts = 0;
  let inTotalYen = 0;

  const r1 = renderDataRow('運動器リハビリテーション(Ⅱ)', inStats.LOCOMOTIVE, REHA_RULES.LIMIT_DAYS.LOCOMOTIVE.defaultPoints, inStats.LOCOMOTIVE_PTS, '単位 (日別単価積算・維持期対応)');
  const r2 = renderDataRow('脳血管疾患等リハビリテーション(Ⅲ)', inStats.CEREBROVASCULAR, REHA_RULES.LIMIT_DAYS.CEREBROVASCULAR.defaultPoints, inStats.CEREBROVASCULAR_PTS, '単位 (日別単価積算・維持期対応)');
  const r3 = renderDataRow('廃用症候群リハビリテーション(Ⅲ)', inStats.DISUSE, REHA_RULES.LIMIT_DAYS.DISUSE.defaultPoints, inStats.DISUSE_PTS, '単位 (日別単価積算・維持期対応)');
  const r4 = renderDataRow('早期加算(Ⅰ) 1〜3日目', inStats.early1, REHA_RULES.EARLY_BONUS.PHASE_1.points, null, '単位 (入院のみ 60点)');
  const r5 = renderDataRow('早期加算(Ⅱ) 4〜14日目', inStats.early2, REHA_RULES.EARLY_BONUS.PHASE_2.points, null, '単位 (入院のみ 25点)');
  const r6 = renderDataRow('総合実施計画書 (入院計)', inStats.planCount, 0, inStats.planPts, '件数 (初回300点/継続240点/固定196点)');

  inTotalPts = r1.pts + r2.pts + r3.pts + r4.pts + r5.pts + r6.pts;
  inTotalYen = r1.yen + r2.yen + r3.yen + r4.yen + r5.yen + r6.yen;
  renderSubTotalRow('★【入院 総単位・収益 小計】', inTotalUnits, inTotalPts, inTotalYen);

  rowHeights[rIdx] = 14;
  rIdx++;

  // 2. 【外来セクション】
  renderSectionHeader('■ 【外来】リハビリテーション算定項目', '0369A1');
  let outTotalUnits = outStats.LOCOMOTIVE + outStats.CEREBROVASCULAR + outStats.DISUSE;
  let outTotalPts = 0;
  let outTotalYen = 0;

  const ro1 = renderDataRow('運動器リハビリテーション(Ⅱ)', outStats.LOCOMOTIVE, REHA_RULES.LIMIT_DAYS.LOCOMOTIVE.defaultPoints, outStats.LOCOMOTIVE_PTS, '単位 (日別単価積算・維持期対応)');
  const ro2 = renderDataRow('脳血管疾患等リハビリテーション(Ⅲ)', outStats.CEREBROVASCULAR, REHA_RULES.LIMIT_DAYS.CEREBROVASCULAR.defaultPoints, outStats.CEREBROVASCULAR_PTS, '単位 (日別単価積算・維持期対応)');
  const ro3 = renderDataRow('廃用症候群リハビリテーション(Ⅲ)', outStats.DISUSE, REHA_RULES.LIMIT_DAYS.DISUSE.defaultPoints, outStats.DISUSE_PTS, '単位 (日別単価積算・維持期対応)');
  const ro4 = renderDataRow('消炎鎮痛等処置 (物療)', outStats.analgesia, 35, null, '件数 (1日1回35点)');
  const ro5 = renderDataRow('総合実施計画書 (外来計)', outStats.planCount, 0, outStats.planPts, '件数 (初回300点/継続240点/固定196点)');

  outTotalPts = ro1.pts + ro2.pts + ro3.pts + ro4.pts + ro5.pts;
  outTotalYen = ro1.yen + ro2.yen + ro3.yen + ro4.yen + ro5.yen;
  renderSubTotalRow('★【外来 総単位・収益 小計】', outTotalUnits, outTotalPts, outTotalYen);

  rowHeights[rIdx] = 14;
  rIdx++;

  // 3. 【全体総合計セクション】
  const grandTotalUnits = inTotalUnits + outTotalUnits;
  const grandTotalPts = inTotalPts + outTotalPts;
  const grandTotalYen = inTotalYen + outTotalYen;
  const totalBorder = { top: { style: 'thin', color: { rgb: '0F172A' } }, bottom: { style: 'double', color: { rgb: '0F172A' } } };
  const totalFill = { fgColor: { rgb: 'ECFDF5' } };

  rowHeights[rIdx] = 34;
  setStyledCell(ws, rIdx, 0, '★★★【レセプト総確定 合計 (入院＋外来)】', { font: { name: 'Meiryo UI', sz: 10.5, bold: true, color: { rgb: '0F172A' } }, fill: totalFill, border: totalBorder, alignment: { vertical: 'center' } });
  setStyledCell(ws, rIdx, 1, grandTotalUnits, { alignment: { horizontal: 'center', vertical: 'center' }, font: { name: 'Meiryo UI', sz: 10.5, bold: true }, fill: totalFill, border: totalBorder, numFmt: '#,##0' });
  setStyledCell(ws, rIdx, 2, '-', { alignment: { horizontal: 'center', vertical: 'center' }, fill: totalFill, border: totalBorder });
  setStyledCell(ws, rIdx, 3, grandTotalPts, { alignment: { horizontal: 'right', vertical: 'center' }, font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: '0F172A' } }, fill: totalFill, border: totalBorder, numFmt: '#,##0' });
  setStyledCell(ws, rIdx, 4, grandTotalYen, { alignment: { horizontal: 'right', vertical: 'center' }, font: { name: 'Meiryo UI', sz: 11.5, bold: true, color: { rgb: '047857' } }, fill: totalFill, border: totalBorder, numFmt: '¥#,##0' });
  setStyledCell(ws, rIdx, 5, '総点数×10円（保険請求確定）', { font: { name: 'Meiryo UI', sz: 9, color: { rgb: '047857' }, bold: true }, fill: totalFill, border: totalBorder, alignment: { vertical: 'center' } });

  setSheetCols(ws, [38, 14, 10, 14, 18, 28]);
  ws['!rows'] = rowHeights.map((h) => ({ hpt: h || 24 }));

  applyA4LandscapePrintSetup(ws, true);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, SUMMARY_SHEET);
}
