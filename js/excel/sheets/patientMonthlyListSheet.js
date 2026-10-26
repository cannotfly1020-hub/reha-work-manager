// js/excel/sheets/patientMonthlyListSheet.js
// 当月実施患者一覧（入院/外来 × 疾患区分 × 算定ステータス【維持期減算／当月切替／医療のみ／通常】）
// ★受付・医事課提出用。単位・点数・収益は扱わず、診断名・起算日・算定期限・算定区分のみ。

import { REHA_RULES } from '../../config/rules.js';
import { addDays, calculatePatientDeadlines } from '../../core/deadlineCalc.js';
import {
  thinBorder, setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet
} from '../sheetUtils.js';

export const PATIENT_MONTHLY_LIST_SHEET = '実施患者一覧';

/** 第1階層: 外来 → 入院（医事課の点検順） */
const CATEGORY_ORDER = ['OUTPATIENT', 'INPATIENT'];

/** 第2階層: 制度疾患区分 */
const DISEASE_ORDER = ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE', 'ANALGESIA'];

/**
 * 第3階層: 算定ステータス（数値が小さいほど上）
 * 1=維持期減算 / 2=当月中切替 / 3=医療のみ継続 / 4=通常 / 5=消炎鎮痛
 */
const STATUS_ORDER = [
  '1_MAINTENANCE_REDUCED',
  '2_MONTH_SWITCH',
  '3_MEDICAL_ONLY_EXPIRED',
  '4_NORMAL',
  '5_ANALGESIA'
];

const STATUS_META = {
  '1_MAINTENANCE_REDUCED': {
    title: '① 【維持期減算】（要介護・要支援 / 算定期限超過）',
    fill: 'FEF3C7',
    font: '92400E'
  },
  '2_MONTH_SWITCH': {
    title: '② 【当月中切替】（当月に算定期限満了 → 通常から減算へ）',
    fill: 'FFEDD5',
    font: '9A3412'
  },
  '3_MEDICAL_ONLY_EXPIRED': {
    title: '③ 【医療保険のみ継続】（算定期限超過 / 介護認定なし・正規満額維持）',
    fill: 'E0E7FF',
    font: '3730A3'
  },
  '4_NORMAL': {
    title: '④ 【通常算定】（標準算定日数以内）',
    fill: 'DCFCE7',
    font: '166534'
  },
  '5_ANALGESIA': {
    title: '【消炎鎮痛等処置】（算定日数制限なし）',
    fill: 'F1F5F9',
    font: '334155'
  }
};

const COL_COUNT = 7; // No.〜算定区分

const STYLE_TITLE = {
  font: { name: 'Meiryo UI', sz: 13, bold: true, color: { rgb: '0F172A' } },
  alignment: { horizontal: 'left', vertical: 'center' }
};

const STYLE_SUB = {
  font: { name: 'Meiryo UI', sz: 8.5, color: { rgb: '475569' } },
  alignment: { horizontal: 'left', vertical: 'center' }
};

const STYLE_CAT_HEADER = {
  font: { name: 'Meiryo UI', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '1E3A8A' } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: thinBorder()
};

const STYLE_DISEASE_HEADER = {
  font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '1E3A8A' } },
  fill: { fgColor: { rgb: 'DBEAFE' } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: thinBorder()
};

const STYLE_TABLE_HEADER = {
  font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '334155' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: thinBorder()
};

const STYLE_CELL_CENTER = {
  font: { name: 'Meiryo UI', sz: 9 },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: thinBorder()
};

const STYLE_CELL_LEFT = {
  font: { name: 'Meiryo UI', sz: 9 },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: thinBorder()
};

const STYLE_CELL_CENTER_ZEBRA = {
  ...STYLE_CELL_CENTER,
  fill: { fgColor: { rgb: 'F8FAFC' } }
};

const STYLE_CELL_LEFT_ZEBRA = {
  ...STYLE_CELL_LEFT,
  fill: { fgColor: { rgb: 'F8FAFC' } }
};

/**
 * A4縦・横幅1ページ収容の印刷設定
 * @param {Object} ws
 */
function applyA4PortraitPrintSetup(ws) {
  if (!ws) return;
  ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
  ws['!properties'] = { pageSetUpPr: { fitToPage: true } };
  ws['!pageSetup'] = {
    paperSize: 9,
    orientation: 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
    scale: 100,
    fitToPage: true
  };
  ws['!margins'] = {
    left: 0.35,
    right: 0.35,
    top: 0.4,
    bottom: 0.4,
    header: 0.1,
    footer: 0.1
  };
  ws['!rehaPrintSetup'] = {
    paperSize: 9,
    orientation: 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
    fitHeight: false,
    scale: 100
  };
}

/**
 * YYYY-MM-DD → YYYY/MM/DD（空は '-'）
 * @param {string} dateStr
 * @returns {string}
 */
function formatSlashDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '-';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  const slash = dateStr.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (slash) return `${slash[1]}/${slash[2]}/${slash[3]}`;
  return dateStr.trim() || '-';
}

/**
 * YYYY-MM-DD → M/D（切替日表示用）
 * @param {string} dateStr
 * @returns {string}
 */
function formatShortMd(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

/**
 * 個人台帳の具体的診断名。未入力時のみ制度名へフォールバック。
 * @param {Object} patient
 * @returns {string}
 */
function resolveSpecificDiagnosis(patient) {
  const specific = String(
    patient?.diagnosis
    || patient?.diseaseName
    || patient?.injuryDiseaseName
    || ''
  ).trim();
  if (specific && specific !== '未記入') return specific;
  const rule = REHA_RULES.LIMIT_DAYS[patient?.diseaseType] || REHA_RULES.LIMIT_DAYS.LOCOMOTIVE;
  return rule.fullName || rule.shortLabel || '-';
}

/**
 * @param {Object} patient
 * @returns {string}
 */
function resolveDiseaseKey(patient) {
  const key = patient?.diseaseType;
  if (DISEASE_ORDER.includes(key)) return key;
  return 'LOCOMOTIVE';
}

/**
 * @param {string} diseaseKey
 * @returns {string}
 */
function buildDiseaseSectionTitle(diseaseKey) {
  const rule = REHA_RULES.LIMIT_DAYS[diseaseKey] || REHA_RULES.LIMIT_DAYS.LOCOMOTIVE;
  if (diseaseKey === 'ANALGESIA' || rule.days >= 9000) {
    return `● ${rule.fullName}（標準算定日数: 制限なし）`;
  }
  return `● ${rule.fullName}（標準算定日数: ${rule.days}日）`;
}

/**
 * @param {Object} patient
 * @returns {string}
 */
function careTypeLabel(patient) {
  if (patient?.careInsuranceType === 'CARE') return '要介護';
  if (patient?.careInsuranceType === 'SUPPORT') return '要支援';
  return '医療のみ';
}

/**
 * @param {Object} patient
 * @returns {boolean}
 */
function isCareInsured(patient) {
  return patient?.careInsuranceType === 'CARE' || patient?.careInsuranceType === 'SUPPORT';
}

/**
 * 対象月の起末日（YYYY-MM-DD）
 * @param {number} year
 * @param {number} month
 * @returns {{ monthStart: string, monthEnd: string }}
 */
function getMonthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  return { monthStart, monthEnd };
}

/**
 * 算定ステータス区分と明細表示ラベルを判定する
 * 優先順: 消炎鎮痛 → 前月以前超過(介護=維持期 / 医療=正規維持) → 当月満了(介護=切替) → 通常
 * @param {Object} patient
 * @param {string} monthStart
 * @param {string} monthEnd
 * @returns {{ statusKey: string, statusLabel: string, startLabel: string, endLabel: string, startSortKey: string }}
 */
function resolveBillingStatus(patient, monthStart, monthEnd) {
  const diseaseKey = resolveDiseaseKey(patient);
  const deadlines = calculatePatientDeadlines(patient, monthEnd);
  const startLabel = formatSlashDate(deadlines.startDateStr);
  const startSortKey = deadlines.startDateStr || '9999-99-99';
  const limitDateStr = deadlines.limitDateStr || '';
  const endLabel = (diseaseKey === 'ANALGESIA' || !limitDateStr || (deadlines.standardDays || 0) >= 9000)
    ? '-'
    : formatSlashDate(limitDateStr);

  if (diseaseKey === 'ANALGESIA' || (deadlines.standardDays || 0) >= 9000) {
    return {
      statusKey: '5_ANALGESIA',
      statusLabel: '消炎鎮痛',
      startLabel,
      endLabel: '-',
      startSortKey
    };
  }

  const care = isCareInsured(patient);
  const careLbl = careTypeLabel(patient);
  const force13 = patient?.force13Limit === true || patient?.force13UnitsLimit === true;

  // 強制13単位制限（要介護・要支援）は維持期減算扱い
  if (force13 && care) {
    return {
      statusKey: '1_MAINTENANCE_REDUCED',
      statusLabel: `維持期減算 (${careLbl}・13単位制限)`,
      startLabel,
      endLabel,
      startSortKey
    };
  }

  if (limitDateStr && limitDateStr < monthStart) {
    if (care) {
      return {
        statusKey: '1_MAINTENANCE_REDUCED',
        statusLabel: `維持期減算 (${careLbl})`,
        startLabel,
        endLabel,
        startSortKey
      };
    }
    return {
      statusKey: '3_MEDICAL_ONLY_EXPIRED',
      statusLabel: '正規維持 (医療のみ)',
      startLabel,
      endLabel,
      startSortKey
    };
  }

  // 満了日が当月内 → 翌日以降が減算開始（介護のみ切替ブロック）
  if (limitDateStr && limitDateStr >= monthStart && limitDateStr <= monthEnd) {
    const switchDateStr = addDays(limitDateStr, 1);
    const switchMd = formatShortMd(switchDateStr) || formatShortMd(limitDateStr);
    if (care) {
      return {
        statusKey: '2_MONTH_SWITCH',
        statusLabel: `${switchMd}〜維持期減算 (${careLbl})`,
        startLabel,
        endLabel,
        startSortKey
      };
    }
    // 医療のみは点数切替なし。当月内に超過へ入る旨を③で明示
    return {
      statusKey: '3_MEDICAL_ONLY_EXPIRED',
      statusLabel: `${switchMd}〜正規維持 (医療のみ)`,
      startLabel,
      endLabel,
      startSortKey
    };
  }

  return {
    statusKey: '4_NORMAL',
    statusLabel: '通常算定',
    startLabel,
    endLabel,
    startSortKey
  };
}

/**
 * 当月実績患者を 区分 × 疾患 × 算定ステータス の3段にグループ化
 * @param {Object} aggregated
 * @returns {object[]}
 */
function collectGroupedPatients(aggregated) {
  const year = aggregated?.year;
  const month = aggregated?.month;
  const { monthStart, monthEnd } = getMonthBounds(year, month);
  const patientMap = aggregated?.patientMap || {};

  const rows = Object.values(patientMap)
    .filter((item) => {
      if (!item?.patient) return false;
      const rehaUnits = item.rehaTotalUnits !== undefined
        ? item.rehaTotalUnits
        : (item.patient.diseaseType !== 'ANALGESIA' ? (item.totalUnits || 0) : 0);
      const anaDays = item.totalAnalgesiaDays !== undefined
        ? item.totalAnalgesiaDays
        : (item.slots ? item.slots.filter((s) => s.isAnalgesia).length : 0);
      const hasReha = (item.hasRehaSlots === true) || rehaUnits > 0;
      const hasAna = (item.hasAnalgesiaSlots === true) || anaDays > 0;
      return hasReha || hasAna;
    })
    .map((item) => {
      const p = item.patient;
      const billing = resolveBillingStatus(p, monthStart, monthEnd);
      return {
        id: String(p.id || ''),
        name: String(p.name || ''),
        category: p.category === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT',
        diseaseKey: resolveDiseaseKey(p),
        diagnosis: resolveSpecificDiagnosis(p),
        startLabel: billing.startLabel,
        endLabel: billing.endLabel,
        startSortKey: billing.startSortKey,
        statusKey: billing.statusKey,
        statusLabel: billing.statusLabel
      };
    });

  rows.sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (catDiff !== 0) return catDiff;
    const disDiff = DISEASE_ORDER.indexOf(a.diseaseKey) - DISEASE_ORDER.indexOf(b.diseaseKey);
    if (disDiff !== 0) return disDiff;
    const stDiff = STATUS_ORDER.indexOf(a.statusKey) - STATUS_ORDER.indexOf(b.statusKey);
    if (stDiff !== 0) return stDiff;
    if (a.startSortKey !== b.startSortKey) return a.startSortKey.localeCompare(b.startSortKey);
    return a.id.localeCompare(b.id, 'ja', { numeric: true });
  });

  const sections = [];
  CATEGORY_ORDER.forEach((cat) => {
    const catRows = rows.filter((r) => r.category === cat);
    if (catRows.length === 0) return;

    const diseaseGroups = [];
    DISEASE_ORDER.forEach((diseaseKey) => {
      const diseaseRows = catRows.filter((r) => r.diseaseKey === diseaseKey);
      if (diseaseRows.length === 0) return;

      const statusBlocks = [];
      STATUS_ORDER.forEach((statusKey) => {
        // 消炎鎮痛疾患は 5_ANALGESIA のみ。他疾患は 5 を出さない
        if (diseaseKey === 'ANALGESIA' && statusKey !== '5_ANALGESIA') return;
        if (diseaseKey !== 'ANALGESIA' && statusKey === '5_ANALGESIA') return;

        const blockRows = diseaseRows.filter((r) => r.statusKey === statusKey);
        if (blockRows.length === 0) return;
        statusBlocks.push({
          statusKey,
          title: STATUS_META[statusKey].title,
          meta: STATUS_META[statusKey],
          rows: blockRows
        });
      });

      if (statusBlocks.length === 0) return;
      diseaseGroups.push({
        diseaseKey,
        title: buildDiseaseSectionTitle(diseaseKey),
        statusBlocks
      });
    });

    if (diseaseGroups.length === 0) return;
    sections.push({
      category: cat,
      categoryLabel: cat === 'INPATIENT' ? '【 入 院 】' : '【 外 来 】',
      diseaseGroups
    });
  });

  return sections;
}

/**
 * 全列結合の見出し帯
 * @param {Object} ws
 * @param {number} row
 * @param {string} text
 * @param {Object} style
 * @param {Array} merges
 */
function writeMergedBand(ws, row, text, style, merges) {
  setStyledCell(ws, row, 0, text, style);
  for (let c = 1; c < COL_COUNT; c += 1) {
    setStyledCell(ws, row, c, '', style);
  }
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: COL_COUNT - 1 } });
}

/**
 * 算定ステータス小見出しスタイル
 * @param {{ fill: string, font: string }} meta
 * @returns {Object}
 */
function buildStatusHeaderStyle(meta) {
  return {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: meta.font } },
    fill: { fgColor: { rgb: meta.fill } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: thinBorder()
  };
}

/**
 * 当月実施患者一覧シートを生成しブックへ追加する
 * @param {Object} wb
 * @param {Object} aggregated
 */
export function buildPatientMonthlyListSheet(wb, aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const year = aggregated?.year;
  const month = aggregated?.month;
  const ws = {};
  const merges = [];
  const today = new Date();
  const outDate = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;

  setStyledCell(
    ws,
    0,
    0,
    `【${year}年${month}月度 リハビリテーション科 実施患者一覧】（受付・医事課 提出用）`,
    STYLE_TITLE
  );
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  setStyledCell(
    ws,
    1,
    0,
    `対象年月: ${year}年${month}月  |  出力日: ${outDate}  |  作成: リハビリテーション科  |  並び: 区分→疾患→算定区分(維持期減算→当月切替→医療のみ→通常)`,
    STYLE_SUB
  );
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: COL_COUNT - 1 } });

  let curRow = 3;
  let serialNo = 1;
  const sections = collectGroupedPatients(aggregated);

  if (sections.length === 0) {
    setStyledCell(ws, curRow, 0, '※ 当月の個別リハビリ／消炎鎮痛の実施実績はありません。', STYLE_SUB);
    merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: COL_COUNT - 1 } });
    curRow += 1;
  }

  const headers = ['No.', '患者ID', '氏名', '疾患名 (診断名)', '起算日', '終了日 (算定期限)', '算定区分'];

  sections.forEach((section) => {
    writeMergedBand(ws, curRow, section.categoryLabel, STYLE_CAT_HEADER, merges);
    curRow += 1;

    section.diseaseGroups.forEach((diseaseGroup) => {
      writeMergedBand(ws, curRow, diseaseGroup.title, STYLE_DISEASE_HEADER, merges);
      curRow += 1;

      diseaseGroup.statusBlocks.forEach((block) => {
        writeMergedBand(
          ws,
          curRow,
          block.title,
          buildStatusHeaderStyle(block.meta),
          merges
        );
        curRow += 1;

        headers.forEach((h, c) => setStyledCell(ws, curRow, c, h, STYLE_TABLE_HEADER));
        curRow += 1;

        block.rows.forEach((row, idx) => {
          const zebra = idx % 2 === 1;
          const centerStyle = zebra ? STYLE_CELL_CENTER_ZEBRA : STYLE_CELL_CENTER;
          const leftStyle = zebra ? STYLE_CELL_LEFT_ZEBRA : STYLE_CELL_LEFT;
          setStyledCell(ws, curRow, 0, serialNo, centerStyle);
          setStyledCell(ws, curRow, 1, row.id, centerStyle);
          setStyledCell(ws, curRow, 2, row.name, leftStyle);
          setStyledCell(ws, curRow, 3, row.diagnosis, leftStyle);
          setStyledCell(ws, curRow, 4, row.startLabel, centerStyle);
          setStyledCell(ws, curRow, 5, row.endLabel, centerStyle);
          setStyledCell(ws, curRow, 6, row.statusLabel, leftStyle);
          serialNo += 1;
          curRow += 1;
        });

        curRow += 1; // ステータスブロック間余白
      });

      curRow += 1; // 疾患グループ間余白
    });

    curRow += 1; // 区分間余白
  });

  // No / ID / 氏名 / 疾患名 / 起算日 / 終了日 / 算定区分
  setSheetCols(ws, [5, 10, 14, 26, 12, 13, 22]);
  ws['!merges'] = merges;
  ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }];
  updateSheetRange(ws);
  applyA4PortraitPrintSetup(ws);
  appendOrReplaceSheet(wb, ws, PATIENT_MONTHLY_LIST_SHEET);
}

/** 既存 write* 命名との互換エイリアス */
export function writePatientMonthlyListSheet(wb, aggregated) {
  return buildPatientMonthlyListSheet(wb, aggregated);
}
