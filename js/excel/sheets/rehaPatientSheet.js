// js/excel/sheets/rehaPatientSheet.js
// 入院・外来の疾患別実施リスト
// ★維持期介護減算: getDailyBasePoints で日別単価を判定し、介列バッジ・実施セル▼で一目識別する

import { evaluateEarlyBonusPhase, getDailyBasePoints } from '../../core/deadlineCalc.js';
import {
  STYLES, thinBorder, getDiseaseInitial, getEarlyBaseDate,
  setStyledCell, updateSheetRange, appendOrReplaceSheet,
  applyA4LandscapePrintSetup
} from '../sheetUtils.js';

/** 維持期減算実施日セル（計画★・早期加算より優先度は下） */
const STYLE_CELL_MAINT = {
  font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '9A3412' } },
  fill: { fgColor: { rgb: 'FFEDD5' } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};

/** 介列: 当月すべて維持期減算 */
const STYLE_CARE_MAINT = {
  ...STYLES.cellCenter,
  fill: { fgColor: { rgb: 'FFEDD5' } },
  font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '9A3412' } }
};

/** 介列: 当月内に通常→減算へ切替（日割り） */
const STYLE_CARE_SPLIT = {
  ...STYLES.cellCenter,
  fill: { fgColor: { rgb: 'FEF3C7' } },
  font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: 'B45309' } }
};

/**
 * 介列の表示文言を決定する。
 * - 医療のみ: '-'
 * - 要介護/要支援で通常実施のみ: '介護' / '支援'
 * - 維持期減算実施のみ: '▼減算'
 * - 当月に通常と減算が混在（満了日跨ぎ日割り）: '介→減' / '支→減'
 * @param {string} careType
 * @param {boolean} hasRegularRate
 * @param {boolean} hasMaintRate
 * @returns {{ label: string, styleBase: object }}
 */
function resolveCareColumnDisplay(careType, hasRegularRate, hasMaintRate) {
  if (careType !== 'CARE' && careType !== 'SUPPORT') {
    return { label: '-', styleBase: null };
  }
  const isSupport = careType === 'SUPPORT';
  if (hasMaintRate && hasRegularRate) {
    return { label: isSupport ? '支→減' : '介→減', styleBase: STYLE_CARE_SPLIT };
  }
  if (hasMaintRate) {
    return { label: '▼減算', styleBase: STYLE_CARE_MAINT };
  }
  return { label: isSupport ? '支援' : '介護', styleBase: null };
}

/**
 * YYYY-MM-DD を組み立てる（日セルの単価再判定用）
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {string}
 */
function buildDateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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
    const maintDatesSet = new Set();
    let early1Units = 0;
    let early2Units = 0;
    let planDateStr = '';
    let hasMaintRate = false;
    let hasRegularRate = false;

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

      // ★日別維持期減算判定（要介護・要支援のみ maintPoints。医療のみは超過後も正規点）
      if (s.date && !s.isAnalgesia) {
        const dNum = parseInt(s.date.split('-')[2], 10);
        const rateInfo = getDailyBasePoints(p, s.date);
        if (rateInfo.isMaintenance && rateInfo.isCareReduced) {
          maintDatesSet.add(dNum);
          hasMaintRate = true;
        } else {
          hasRegularRate = true;
        }
      }
    });

    const displayDisType = (p.diseaseType && p.diseaseType !== 'ANALGESIA') ? p.diseaseType : 'LOCOMOTIVE';
    const totalRehaUnits = item.rehaTotalUnits !== undefined ? item.rehaTotalUnits : item.totalUnits;
    const careDisplay = resolveCareColumnDisplay(p.careInsuranceType, hasRegularRate, hasMaintRate);

    setStyledCell(ws, curRow, 0, p.id, { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 1, p.name, { ...STYLES.cellNormal, fill: zebraBg, font: { bold: true } });
    setStyledCell(ws, curRow, 2, getDiseaseInitial(displayDisType), { ...STYLES.cellCenter, fill: zebraBg, font: { bold: true } });

    // 介列: 維持期減算の有無をバッジ色＋文言で明示（医事課が一目で判別可能）
    const careStyle = careDisplay.styleBase
      ? { ...careDisplay.styleBase }
      : { ...STYLES.cellCenter, fill: zebraBg };
    setStyledCell(ws, curRow, 3, careDisplay.label, careStyle);

    // 総単位（青系は維持）。維持期混在時はツールチップ相当のコメントは付けず、日セル▼で識別
    setStyledCell(ws, curRow, 4, totalRehaUnits, {
      ...STYLES.cellCenter,
      fill: { fgColor: { rgb: hasMaintRate ? 'FFEDD5' : 'E0F2FE' } },
      font: {
        name: 'Meiryo UI',
        sz: 9.5,
        bold: true,
        color: { rgb: hasMaintRate ? '9A3412' : '0369A1' }
      },
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

      // スロット記録に加え、カレンダー日付でも再判定（表示の取りこぼし防止）
      const dateStr = buildDateStr(year, month, d);
      const dayRate = getDailyBasePoints(p, dateStr);
      const isMaintDay = (u > 0) && (
        maintDatesSet.has(d) ||
        (dayRate.isMaintenance === true && dayRate.isCareReduced === true)
      );

      let cellStyle = { ...STYLES.cellUnit };
      if (dayOfWeek === 6) cellStyle.fill = STYLES.cellSatCol;
      else if (dayOfWeek === 0) cellStyle.fill = STYLES.cellSunCol;
      else cellStyle.fill = zebraBg;

      if (u > 0) {
        if (isPlanDay) {
          // 計画書算定日は★を最優先（維持期と重なっても医事課は計画日を先に見る）
          const planVal = isMaintDay ? `${u}★▼` : `${u}★`;
          setStyledCell(ws, curRow, col, planVal, isMaintDay
            ? { ...STYLES.cellPlanStar, fill: { fgColor: { rgb: 'FED7AA' } }, font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '9A3412' } } }
            : STYLES.cellPlanStar);
        } else if (isEarly1Day) {
          setStyledCell(ws, curRow, col, u, STYLES.cellEarly1);
        } else if (isEarly2Day) {
          setStyledCell(ws, curRow, col, u, STYLES.cellEarly2);
        } else if (isMaintDay) {
          // 維持期減算実施日: 橙背景＋▼で切替日を可視化
          setStyledCell(ws, curRow, col, `${u}▼`, STYLE_CELL_MAINT);
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

  // 凡例行（受付・医事課向け）
  const legendRow = curRow + 1;
  setStyledCell(ws, legendRow, 0,
    '凡例: 介列「▼減算」＝当月の実施が維持期減算単価のみ ／「介→減」「支→減」＝当月内に通常→減算へ切替（満了日翌日以降） ／ 日セル「n▼」＝その日の実施が減算単価（運動器102・脳血管60・廃用46）。医療保険のみ（介列「-」）は日数超過後も正規点数のまま。',
    {
      font: { name: 'Meiryo UI', sz: 8, color: { rgb: '64748B' } },
      alignment: { vertical: 'center', wrapText: true }
    }
  );

  // 行高設定：ヘッダーは30ptで改行潰れゼロ、データ行はゆったり25ptで堂々とした見栄えに
  const rHeights = [{ hpt: 30 }, { hpt: 32 }];
  for (let r = 2; r < curRow; r++) {
    rHeights.push({ hpt: 25 });
  }
  while (rHeights.length <= legendRow) {
    rHeights.push({ hpt: 18 });
  }
  rHeights[legendRow] = 36;
  ws['!rows'] = rHeights;

  // ★列幅設定：Excel内部展開比率（約1.165倍）を逆算補正し、目標ピクセルにジャスト調整
  // 介列は「▼減算」「介→減」表示のためやや拡幅
  const colProps = [
    { wpx: 36 },        // ID (目標 42px 狙い: 36 * 1.167 ≒ 42px)
    { wpx: 69 },        // 患者氏名 (目標 80px 狙い: 69 * 1.163 ≒ 80px)
    { wpx: 25 },        // 区分 (目標 29px 狙い: 25 * 1.172 ≒ 29px)
    { wpx: 28 },        // 介 (バッジ文言用に拡幅)
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
