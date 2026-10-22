// js/excel/sheets/yearlyTrendSheet.js
// 年間推移

import { REHA_RULES } from '../../config/rules.js';
import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import { aggregateFromAppSchedule } from '../../store/scheduleStore.js';
import {
  STYLES, getEarlyBaseDate,
  setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup, YEARLY_TREND_SHEET
} from '../sheetUtils.js';

export function writeYearlyTrendSheet(wb, targetYear) {
  const ws = {};
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const rowHeights = [];

  const monthlyData = months.map((m) => {
    try {
      return aggregateFromAppSchedule(targetYear, m);
    } catch (_) {
      return { patientMap: {}, dailyBreakdown: {} };
    }
  });

  const statsList = months.map(() => ({
    inUnits: 0, outUnits: 0, totalUnits: 0,
    analgesiaCount: 0,
    inAmount: 0, outAmount: 0, totalAmount: 0,
    inLoco: 0, inCerebro: 0, inDisuse: 0,
    outLoco: 0, outCerebro: 0, outDisuse: 0
  }));

  monthlyData.forEach((mAgg, mIdx) => {
    const st = statsList[mIdx];
    Object.values(mAgg.patientMap || {}).forEach((item) => {
      const p = item.patient;
      const isInput = p.category === 'INPATIENT';
      const baseEarlyDate = getEarlyBaseDate(p);

      item.slots.forEach((s) => {
        if (s.isAnalgesia) {
          if (!isInput) {
            st.analgesiaCount += 1;
            st.outAmount += 35 * 10;
            st.totalAmount += 35 * 10;
          }
          return;
        }

        const u = s.units || 1;
        const dType = (p.diseaseType && p.diseaseType !== 'ANALGESIA') ? p.diseaseType : 'LOCOMOTIVE';
        const unitPts = getDailyBasePoints(p, s.date).points
          || REHA_RULES.LIMIT_DAYS[dType]?.defaultPoints
          || 170;
        const yen = u * unitPts * 10;

        if (isInput) {
          st.inUnits += u;
          st.inAmount += yen;
          if (dType === 'LOCOMOTIVE') st.inLoco += u;
          else if (dType === 'CEREBROVASCULAR') st.inCerebro += u;
          else if (dType === 'DISUSE') st.inDisuse += u;
        } else {
          st.outUnits += u;
          st.outAmount += yen;
          if (dType === 'LOCOMOTIVE') st.outLoco += u;
          else if (dType === 'CEREBROVASCULAR') st.outCerebro += u;
          else if (dType === 'DISUSE') st.outDisuse += u;
        }

        st.totalUnits += u;
        st.totalAmount += yen;

        if (s.billingPlan && REHA_RULES.PLAN_POINTS[s.billingPlan]) {
          const pPts = REHA_RULES.PLAN_POINTS[s.billingPlan];
          const pYen = pPts * 10;
          if (isInput) st.inAmount += pYen;
          else st.outAmount += pYen;
          st.totalAmount += pYen;
        }

        if (isInput && baseEarlyDate && s.date) {
          const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
          if (ph.points > 0) {
            const eYen = ph.points * u * 10;
            st.inAmount += eYen;
            st.totalAmount += eYen;
          }
        }
      });
    });
  });

  setStyledCell(ws, 0, 0, `【${targetYear}年 リハビリテーション科 年間推移表 (1月〜12月 グラフ自動作成対応マトリクス)】`, {
    font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '0F172A' } }
  });
  rowHeights[0] = 30;

  setStyledCell(ws, 1, 0, `💡【グラフのワンクリック作成方法】 下記の「表①」または「表②」の範囲を選び、キーボードの「Alt + F1」（またはメニューの「挿入」→「おすすめグラフ」）を押すと、一瞬で綺麗な折れ線・棒グラフが完成します。`, {
    font: { name: 'Meiryo UI', sz: 8.5, color: { rgb: '0369A1' }, bold: true }
  });
  rowHeights[1] = 20;

  // 表①：単位数推移
  setStyledCell(ws, 3, 0, '■ 表①：月別 リハビリ実施単位数 推移 (棒グラフ用)', {
    font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '1E40AF' } }
  });
  rowHeights[3] = 24;

  const t1Headers = ['対象月', '入院 単位数', '外来 単位数', '個別リハ 合計単位', '消炎鎮痛 (件数)'];
  t1Headers.forEach((h, cIdx) => {
    setStyledCell(ws, 4, cIdx, h, { ...STYLES.headerNavy, fill: { fgColor: { rgb: '1E3A8A' } } });
  });
  rowHeights[4] = 24;

  let rIdx = 5;
  let sumInU = 0, sumOutU = 0, sumTotU = 0, sumAnaC = 0;

  months.forEach((m, idx) => {
    const st = statsList[idx];
    const bg = (idx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    setStyledCell(ws, rIdx, 0, `${m}月`, { ...STYLES.cellCenter, font: { bold: true }, fill: bg });
    setStyledCell(ws, rIdx, 1, st.inUnits, { ...STYLES.cellRight, fill: bg, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 2, st.outUnits, { ...STYLES.cellRight, fill: bg, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 3, st.totalUnits, { ...STYLES.cellRight, fill: bg, font: { bold: true, color: { rgb: '1E40AF' } }, numFmt: '#,##0' });
    setStyledCell(ws, rIdx, 4, st.analgesiaCount, { ...STYLES.cellRight, fill: bg, numFmt: '#,##0', font: { color: { rgb: '15803D' } } });

    sumInU += st.inUnits;
    sumOutU += st.outUnits;
    sumTotU += st.totalUnits;
    sumAnaC += st.analgesiaCount;

    rowHeights[rIdx] = 20;
    rIdx++;
  });

  setStyledCell(ws, rIdx, 0, '年間合計', { ...STYLES.cellSubTotal, alignment: { horizontal: 'center' } });
  setStyledCell(ws, rIdx, 1, sumInU, { ...STYLES.cellSubTotal, alignment: { horizontal: 'right' }, numFmt: '#,##0' });
  setStyledCell(ws, rIdx, 2, sumOutU, { ...STYLES.cellSubTotal, alignment: { horizontal: 'right' }, numFmt: '#,##0' });
  setStyledCell(ws, rIdx, 3, sumTotU, { ...STYLES.cellSubTotal, alignment: { horizontal: 'right' }, numFmt: '#,##0', font: { bold: true, color: { rgb: '1E40AF' } } });
  setStyledCell(ws, rIdx, 4, sumAnaC, { ...STYLES.cellSubTotal, alignment: { horizontal: 'right' }, numFmt: '#,##0', font: { bold: true, color: { rgb: '15803D' } } });
  rowHeights[rIdx] = 24;
  rIdx++;

  // 表②：売上推移
  rIdx++;
  rowHeights[rIdx - 1] = 14;

  setStyledCell(ws, rIdx, 0, '■ 表②：月別 リハビリ科 売上金額 推移 (折れ線グラフ用)', {
    font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '065F46' } }
  });
  rowHeights[rIdx] = 24;
  rIdx++;

  const t2Headers = ['対象月', '入院 売上 (¥)', '外来 売上 (¥)', 'リハ科 総売上金額 (¥)'];
  t2Headers.forEach((h, cIdx) => {
    setStyledCell(ws, rIdx, cIdx, h, { ...STYLES.headerNavy, fill: { fgColor: { rgb: '065F46' } } });
  });
  rowHeights[rIdx] = 24;
  rIdx++;

  let sumInY = 0, sumOutY = 0, sumTotY = 0;

  months.forEach((m, idx) => {
    const st = statsList[idx];
    const bg = (idx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } };

    setStyledCell(ws, rIdx, 0, `${m}月`, { ...STYLES.cellCenter, font: { bold: true }, fill: bg });
    setStyledCell(ws, rIdx, 1, st.inAmount, { ...STYLES.cellRight, fill: bg, numFmt: '¥#,##0' });
    setStyledCell(ws, rIdx, 2, st.outAmount, { ...STYLES.cellRight, fill: bg, numFmt: '¥#,##0' });
    setStyledCell(ws, rIdx, 3, st.totalAmount, { ...STYLES.cellRight, fill: bg, font: { bold: true, color: { rgb: '047857' } }, numFmt: '¥#,##0' });

    sumInY += st.inAmount;
    sumOutY += st.outAmount;
    sumTotY += st.totalAmount;

    rowHeights[rIdx] = 20;
    rIdx++;
  });

  setStyledCell(ws, rIdx, 0, '年間合計', { ...STYLES.cellSubTotal, alignment: { horizontal: 'center' } });
  setStyledCell(ws, rIdx, 1, sumInY, { ...STYLES.cellSubTotal, alignment: { horizontal: 'right' }, numFmt: '¥#,##0' });
  setStyledCell(ws, rIdx, 2, sumOutY, { ...STYLES.cellSubTotal, alignment: { horizontal: 'right' }, numFmt: '¥#,##0' });
  setStyledCell(ws, rIdx, 3, sumTotY, { ...STYLES.cellSubTotal, alignment: { horizontal: 'right' }, numFmt: '¥#,##0', font: { bold: true, color: { rgb: '047857' } } });
  rowHeights[rIdx] = 24;

  setSheetCols(ws, [14, 18, 18, 22, 18]);
  ws['!rows'] = rowHeights.map((h) => ({ hpt: h || 20 }));

  applyA4LandscapePrintSetup(ws, false);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, YEARLY_TREND_SHEET);
}
