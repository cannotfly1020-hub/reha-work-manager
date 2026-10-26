// js/excel/sheets/patientMonthlyListSheet.js
// 当月実施患者一覧（入院/外来 × 疾患区分グループ / 個人台帳の具体的診断名印字）
// ★受付・医事課提出用。単位・点数・収益は扱わず、氏名と診断名・起算日・算定期限のみ。

import { REHA_RULES } from '../../config/rules.js';
import { calculatePatientDeadlines } from '../../core/deadlineCalc.js';
import {
  thinBorder, setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet
} from '../sheetUtils.js';

export const PATIENT_MONTHLY_LIST_SHEET = '実施患者一覧';

const CATEGORY_ORDER = ['INPATIENT', 'OUTPATIENT'];
const DISEASE_ORDER = ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE', 'ANALGESIA'];

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
 * A4縦・横幅1ページ収容の印刷設定（ZIP注入は !rehaPrintSetup.orientation を参照）
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
 * 個人台帳の具体的診断名。未入力時のみ制度上の正式名称へフォールバック。
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
 * 制度疾患区分キーを正規化
 * @param {Object} patient
 * @returns {string}
 */
function resolveDiseaseKey(patient) {
  const key = patient?.diseaseType;
  if (DISEASE_ORDER.includes(key)) return key;
  return 'LOCOMOTIVE';
}

/**
 * 中項目見出し文言
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
 * 起算日・終了日（算定期限）を算出
 * @param {Object} patient
 * @returns {{ startLabel: string, endLabel: string, startSortKey: string }}
 */
function resolveStartAndEndDates(patient) {
  const diseaseKey = resolveDiseaseKey(patient);
  const deadlines = calculatePatientDeadlines(patient);
  const startLabel = formatSlashDate(deadlines.startDateStr);
  const startSortKey = deadlines.startDateStr || '9999-99-99';

  if (diseaseKey === 'ANALGESIA' || !deadlines.limitDateStr || (deadlines.standardDays || 0) >= 9000) {
    return { startLabel, endLabel: '-', startSortKey };
  }
  return {
    startLabel,
    endLabel: formatSlashDate(deadlines.limitDateStr),
    startSortKey
  };
}

/**
 * 当月に個別リハまたは消炎鎮痛の実績がある患者を抽出・グループ化
 * @param {Object} aggregated
 * @returns {{ category: string, categoryLabel: string, groups: { diseaseKey: string, title: string, rows: object[] }[] }[]}
 */
function collectGroupedPatients(aggregated) {
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
      const dates = resolveStartAndEndDates(p);
      return {
        id: String(p.id || ''),
        name: String(p.name || ''),
        category: p.category === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT',
        diseaseKey: resolveDiseaseKey(p),
        diagnosis: resolveSpecificDiagnosis(p),
        startLabel: dates.startLabel,
        endLabel: dates.endLabel,
        startSortKey: dates.startSortKey
      };
    });

  rows.sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (catDiff !== 0) return catDiff;
    const disDiff = DISEASE_ORDER.indexOf(a.diseaseKey) - DISEASE_ORDER.indexOf(b.diseaseKey);
    if (disDiff !== 0) return disDiff;
    if (a.startSortKey !== b.startSortKey) return a.startSortKey.localeCompare(b.startSortKey);
    return a.id.localeCompare(b.id, 'ja', { numeric: true });
  });

  const sections = [];
  CATEGORY_ORDER.forEach((cat) => {
    const catRows = rows.filter((r) => r.category === cat);
    if (catRows.length === 0) return;
    const groups = [];
    DISEASE_ORDER.forEach((diseaseKey) => {
      const groupRows = catRows.filter((r) => r.diseaseKey === diseaseKey);
      if (groupRows.length === 0) return;
      groups.push({
        diseaseKey,
        title: buildDiseaseSectionTitle(diseaseKey),
        rows: groupRows
      });
    });
    if (groups.length === 0) return;
    sections.push({
      category: cat,
      categoryLabel: cat === 'INPATIENT' ? '■ 入 院' : '■ 外 来',
      groups
    });
  });

  return sections;
}

/**
 * 6列を結合して見出し帯を描画
 * @param {Object} ws
 * @param {number} row
 * @param {string} text
 * @param {Object} style
 * @param {Array} merges
 */
function writeMergedBand(ws, row, text, style, merges) {
  setStyledCell(ws, row, 0, text, style);
  for (let c = 1; c <= 5; c += 1) {
    setStyledCell(ws, row, c, '', style);
  }
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 5 } });
}

/**
 * 当月実施患者一覧シートを生成しブックへ追加する
 * @param {Object} wb
 * @param {Object} aggregated - aggregateFromAppSchedule の結果
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
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } });

  setStyledCell(
    ws,
    1,
    0,
    `対象年月: ${year}年${month}月  |  出力日: ${outDate}  |  作成: リハビリテーション科`,
    STYLE_SUB
  );
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 5 } });

  let curRow = 3;
  let serialNo = 1;
  const sections = collectGroupedPatients(aggregated);

  if (sections.length === 0) {
    setStyledCell(ws, curRow, 0, '※ 当月の個別リハビリ／消炎鎮痛の実施実績はありません。', STYLE_SUB);
    merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: 5 } });
    curRow += 1;
  }

  sections.forEach((section) => {
    writeMergedBand(ws, curRow, section.categoryLabel, STYLE_CAT_HEADER, merges);
    curRow += 1;

    section.groups.forEach((group) => {
      writeMergedBand(ws, curRow, group.title, STYLE_DISEASE_HEADER, merges);
      curRow += 1;

      const headers = ['No.', '患者ID', '氏名', '疾患名 (診断名)', '起算日', '終了日 (算定期限)'];
      headers.forEach((h, c) => setStyledCell(ws, curRow, c, h, STYLE_TABLE_HEADER));
      curRow += 1;

      group.rows.forEach((row, idx) => {
        const zebra = idx % 2 === 1;
        const centerStyle = zebra ? STYLE_CELL_CENTER_ZEBRA : STYLE_CELL_CENTER;
        const leftStyle = zebra ? STYLE_CELL_LEFT_ZEBRA : STYLE_CELL_LEFT;
        setStyledCell(ws, curRow, 0, serialNo, centerStyle);
        setStyledCell(ws, curRow, 1, row.id, centerStyle);
        setStyledCell(ws, curRow, 2, row.name, leftStyle);
        setStyledCell(ws, curRow, 3, row.diagnosis, leftStyle);
        setStyledCell(ws, curRow, 4, row.startLabel, centerStyle);
        setStyledCell(ws, curRow, 5, row.endLabel, centerStyle);
        serialNo += 1;
        curRow += 1;
      });

      curRow += 1; // グループ間の余白行
    });

    curRow += 1; // 区分間の余白行
  });

  setSheetCols(ws, [5, 10, 16, 30, 13, 14]);
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
