// js/excel/sheets/summarySheet.js
// レセプト収益サマリー
// ★疾患別点数は getDailyBasePoints による日別単価積算（所定／維持期減算を行分割して印字）

import { REHA_RULES } from '../../config/rules.js';
import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import {
  STYLES, thinBorder, getEarlyBaseDate,
  setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup, SUMMARY_SHEET
} from '../sheetUtils.js';

/**
 * 入院／外来ごとの疾患別カウンタを初期化する
 * STD = 所定点数、MAINT = 要介護・要支援の維持期減算点数
 * @returns {object}
 */
function createCategoryStats() {
  return {
    LOCOMOTIVE_STD_U: 0,
    LOCOMOTIVE_STD_PTS: 0,
    LOCOMOTIVE_MAINT_U: 0,
    LOCOMOTIVE_MAINT_PTS: 0,
    CEREBROVASCULAR_STD_U: 0,
    CEREBROVASCULAR_STD_PTS: 0,
    CEREBROVASCULAR_MAINT_U: 0,
    CEREBROVASCULAR_MAINT_PTS: 0,
    DISUSE_STD_U: 0,
    DISUSE_STD_PTS: 0,
    DISUSE_MAINT_U: 0,
    DISUSE_MAINT_PTS: 0,
    early1: 0,
    early2: 0,
    planPts: 0,
    planCount: 0,
    analgesia: 0
  };
}

/**
 * スロット1件を疾患別・所定／維持期へ加算する
 * @param {object} target
 * @param {object} patient
 * @param {{ date?: string, units?: number, isAnalgesia?: boolean }} slot
 */
function accumulateDiseaseSlot(target, patient, slot) {
  const u = Number(slot.units) || 1;
  const dType = (patient.diseaseType && patient.diseaseType !== 'ANALGESIA')
    ? patient.diseaseType
    : 'LOCOMOTIVE';
  if (!['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE'].includes(dType)) return;

  const rate = getDailyBasePoints(patient, slot.date);
  const pts = rate.points * u;
  if (rate.isCareReduced === true) {
    target[`${dType}_MAINT_U`] += u;
    target[`${dType}_MAINT_PTS`] += pts;
  } else {
    target[`${dType}_STD_U`] += u;
    target[`${dType}_STD_PTS`] += pts;
  }
}

export function writeExecutiveSummarySheet(wb, aggregated) {
  const { patientMap, year, month } = aggregated;
  const ws = {};
  const rowHeights = [];

  const inStats = createCategoryStats();
  const outStats = createCategoryStats();

  Object.values(patientMap).forEach((item) => {
    const p = item.patient;
    const isInput = p.category === 'INPATIENT';
    const target = isInput ? inStats : outStats;
    const baseEarlyDate = getEarlyBaseDate(p);

    item.slots.forEach((s) => {
      if (s.isAnalgesia) {
        if (!isInput) target.analgesia += 1;
        return;
      }

      const u = Number(s.units) || 1;

      // ★日別単価で疾患別基本料を積算（一律 defaultPoints 掛けは禁止）
      accumulateDiseaseSlot(target, p, s);

      if (s.billingPlan && REHA_RULES.PLAN_POINTS[s.billingPlan]) {
        target.planPts += REHA_RULES.PLAN_POINTS[s.billingPlan];
        target.planCount += 1;
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

  /**
   * @param {string} name
   * @param {number} qty
   * @param {number} unitPts 表示単価（0 のとき「-」）
   * @param {number|null} customPts null なら qty*unitPts
   * @param {string} note
   * @param {{ maint?: boolean }} [opts]
   */
  const renderDataRow = (name, qty, unitPts, customPts = null, note = '', opts = {}) => {
    rowHeights[rIdx] = 25;
    const totPts = customPts !== null ? customPts : qty * unitPts;
    const totYen = totPts * REHA_RULES.POINT_RATE;
    const isMaint = opts.maint === true;
    const bg = isMaint
      ? { fgColor: { rgb: 'FEF3C7' } }
      : ((rIdx % 2 === 1) ? STYLES.cellZebra : { fgColor: { rgb: 'FFFFFF' } });
    const nameFont = isMaint
      ? { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: 'B45309' } }
      : { name: 'Meiryo UI', sz: 9.5 };

    setStyledCell(ws, rIdx, 0, name, { ...STYLES.cellNormal, font: nameFont, fill: bg });
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

  /**
   * 疾患1種について所定行＋維持期減算行を出力し、点数合計を返す
   * @param {object} stats
   * @param {'LOCOMOTIVE'|'CEREBROVASCULAR'|'DISUSE'} dType
   * @param {string} labelStd
   * @param {string} labelMaint
   * @returns {{ pts: number, yen: number, units: number }}
   */
  const renderDiseasePair = (stats, dType, labelStd, labelMaint) => {
    const disease = REHA_RULES.LIMIT_DAYS[dType];
    const stdU = stats[`${dType}_STD_U`];
    const stdPts = stats[`${dType}_STD_PTS`];
    const maintU = stats[`${dType}_MAINT_U`];
    const maintPts = stats[`${dType}_MAINT_PTS`];

    let pts = 0;
    let yen = 0;
    let units = 0;

    // 所定行は実績があるとき、または維持期も所定も0のとき（空でも行を残すのは運動器のみではなく、従来どおり常時表示）
    const rStd = renderDataRow(
      labelStd,
      stdU,
      disease.defaultPoints,
      stdPts,
      `単位 × ${disease.defaultPoints}点（標準算定日内・医療保険のみ超過含む）`
    );
    pts += rStd.pts;
    yen += rStd.yen;
    units += rStd.units;

    if (maintU > 0 || maintPts > 0) {
      const rMaint = renderDataRow(
        labelMaint,
        maintU,
        disease.maintPoints,
        maintPts,
        `単位 × ${disease.maintPoints}点（要介護・要支援の標準日数超過翌日以降）`,
        { maint: true }
      );
      pts += rMaint.pts;
      yen += rMaint.yen;
      units += rMaint.units;
    }

    return { pts, yen, units };
  };

  // 1. 【入院セクション】
  renderSectionHeader('■ 【入院】リハビリテーション算定項目', '0284C7');

  const inLoco = renderDiseasePair(
    inStats, 'LOCOMOTIVE',
    '運動器リハビリテーション(Ⅱ)',
    '運動器リハビリテーション(Ⅱ) 【維持期減算】'
  );
  const inCere = renderDiseasePair(
    inStats, 'CEREBROVASCULAR',
    '脳血管疾患等リハビリテーション(Ⅲ)',
    '脳血管疾患等リハビリテーション(Ⅲ) 【維持期減算】'
  );
  const inDis = renderDiseasePair(
    inStats, 'DISUSE',
    '廃用症候群リハビリテーション(Ⅲ)',
    '廃用症候群リハビリテーション(Ⅲ) 【維持期減算】'
  );
  const r4 = renderDataRow('早期加算(Ⅰ) 1〜3日目', inStats.early1, REHA_RULES.EARLY_BONUS.PHASE_1.points, null, '単位 (入院のみ 60点)');
  const r5 = renderDataRow('早期加算(Ⅱ) 4〜14日目', inStats.early2, REHA_RULES.EARLY_BONUS.PHASE_2.points, null, '単位 (入院のみ 25点)');
  const r6 = renderDataRow('総合実施計画書 (入院計)', inStats.planCount, 0, inStats.planPts, '件数 (初回300点/継続240点/固定196点)');

  const inTotalUnits = inLoco.units + inCere.units + inDis.units;
  const inTotalPts = inLoco.pts + inCere.pts + inDis.pts + r4.pts + r5.pts + r6.pts;
  const inTotalYen = inLoco.yen + inCere.yen + inDis.yen + r4.yen + r5.yen + r6.yen;
  renderSubTotalRow('★【入院 総単位・収益 小計】', inTotalUnits, inTotalPts, inTotalYen);

  rowHeights[rIdx] = 14;
  rIdx++;

  // 2. 【外来セクション】
  renderSectionHeader('■ 【外来】リハビリテーション算定項目', '0369A1');

  const outLoco = renderDiseasePair(
    outStats, 'LOCOMOTIVE',
    '運動器リハビリテーション(Ⅱ)',
    '運動器リハビリテーション(Ⅱ) 【維持期減算】'
  );
  const outCere = renderDiseasePair(
    outStats, 'CEREBROVASCULAR',
    '脳血管疾患等リハビリテーション(Ⅲ)',
    '脳血管疾患等リハビリテーション(Ⅲ) 【維持期減算】'
  );
  const outDis = renderDiseasePair(
    outStats, 'DISUSE',
    '廃用症候群リハビリテーション(Ⅲ)',
    '廃用症候群リハビリテーション(Ⅲ) 【維持期減算】'
  );
  const ro4 = renderDataRow('消炎鎮痛等処置 (物療)', outStats.analgesia, 35, null, '件数 (1日1回35点)');
  const ro5 = renderDataRow('総合実施計画書 (外来計)', outStats.planCount, 0, outStats.planPts, '件数 (初回300点/継続240点/固定196点)');

  const outTotalUnits = outLoco.units + outCere.units + outDis.units;
  const outTotalPts = outLoco.pts + outCere.pts + outDis.pts + ro4.pts + ro5.pts;
  const outTotalYen = outLoco.yen + outCere.yen + outDis.yen + ro4.yen + ro5.yen;
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
  setStyledCell(ws, rIdx, 5, '総点数×10円（保険請求確定・維持期日割り反映済）', { font: { name: 'Meiryo UI', sz: 9, color: { rgb: '047857' }, bold: true }, fill: totalFill, border: totalBorder, alignment: { vertical: 'center' } });

  setSheetCols(ws, [42, 14, 10, 14, 18, 36]);
  ws['!rows'] = rowHeights.map((h) => ({ hpt: h || 24 }));

  applyA4LandscapePrintSetup(ws, true);
  updateSheetRange(ws);
  appendOrReplaceSheet(wb, ws, SUMMARY_SHEET);
}
