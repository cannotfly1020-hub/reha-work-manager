// js/excel/sheets/patientMonthlyListSheet.js
// 当月実施患者一覧（【入院→外来→消炎鎮痛】× 疾患 × 算定区分【通常→医療のみ→当月切替→維持期減算】）
// ★受付・医事課提出用。単位・点数・収益は扱わず、診断名・起算日・算定期限・算定区分のみ。

import { REHA_RULES } from '../../config/rules.js';
import { addDays, calculatePatientDeadlines } from '../../core/deadlineCalc.js';
import {
  thinBorder, setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet
} from '../sheetUtils.js';

export const PATIENT_MONTHLY_LIST_SHEET = '実施患者一覧';

/** 第1階層: 入院 → 外来 → 消炎鎮痛 */
const SECTION_ORDER = ['INPATIENT', 'OUTPATIENT', 'ANALGESIA'];

/** 第2階層（入院・外来内）: 運動器 → 脳血管 → 廃用 */
const DISEASE_ORDER = ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE'];

/**
 * 第3階層: 通常算定 → 医療のみ継続 → 当月中切替 → 維持期減算
 * （数値が小さいほど上。消炎鎮痛セクションは 0_ANALGESIA のみ）
 */
const STATUS_ORDER = [
  '0_ANALGESIA',
  '1_NORMAL',
  '2_MEDICAL_ONLY_EXPIRED',
  '3_MONTH_SWITCH',
  '4_MAINTENANCE_REDUCED'
];

const STATUS_META = {
  '0_ANALGESIA': {
    title: '【消炎鎮痛等処置】（算定日数制限なし）',
    fill: 'F1F5F9',
    font: '334155'
  },
  '1_NORMAL': {
    title: '① 【通常算定】（標準算定日数以内）',
    fill: 'DCFCE7',
    font: '166534'
  },
  '2_MEDICAL_ONLY_EXPIRED': {
    title: '② 【医療保険のみ継続】（算定期限超過 / 介護認定なし・正規満額維持）',
    fill: 'F1F5F9',
    font: '075985'
  },
  '3_MONTH_SWITCH': {
    title: '③ 【当月中切替】（当月に算定期限満了 → 満了日翌日以降減算）',
    fill: 'FEF3C7',
    font: '92400E'
  },
  '4_MAINTENANCE_REDUCED': {
    title: '④ 【維持期減算】（要介護・要支援 / 算定期限超過）',
    fill: 'FEE2E2',
    font: '991B1B'
  }
};

const COL_COUNT = 7;

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
 * 制度疾患区分（消炎鎮痛以外）
 * @param {Object} patient
 * @returns {string}
 */
function resolveDiseaseKey(patient) {
  const key = patient?.diseaseType;
  if (DISEASE_ORDER.includes(key)) return key;
  if (key === 'ANALGESIA') return 'ANALGESIA';
  return 'LOCOMOTIVE';
}

/**
 * @param {string} diseaseKey
 * @returns {string}
 */
function buildDiseaseSectionTitle(diseaseKey) {
  const rule = REHA_RULES.LIMIT_DAYS[diseaseKey] || REHA_RULES.LIMIT_DAYS.LOCOMOTIVE;
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
function isCareInsuredPatient(patient) {
  return patient?.careInsuranceType === 'CARE' || patient?.careInsuranceType === 'SUPPORT';
}

/**
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
 * 算定ステータス別ソート優先度（通常算定が先頭、維持期減算が末尾）
 * @param {Object} patient
 * @param {string} limitDateStr
 * @param {boolean} careInsured
 * @param {boolean} isLimitExceededBeforeMonth 満了日が当月開始より前
 * @param {boolean} isMidMonth 満了日が当月内
 * @returns {number} 0=消炎 / 1=通常 / 2=医療のみ / 3=当月切替 / 4=維持期減算
 */
function getStatusOrder(patient, limitDateStr, careInsured, isLimitExceededBeforeMonth, isMidMonth) {
  if (patient?.diseaseType === 'ANALGESIA') return 0;

  // 1. 通常算定（期限内・当月切替でもない）
  if (!isLimitExceededBeforeMonth && !isMidMonth) {
    return 1;
  }
  // 2. 医療保険のみ継続（前月以前に超過・介護なし）
  if (isLimitExceededBeforeMonth && !careInsured) {
    return 2;
  }
  // 3. 当月中切替（当月に期限満了）※介護は減算切替、医療のみも当月満了としてここに寄せない（下で分岐）
  if (isMidMonth && careInsured) {
    return 3;
  }
  // 医療のみ＋当月満了 → 医療保険のみ継続側（点数切替なし）
  if (isMidMonth && !careInsured) {
    return 2;
  }
  // 4. 維持期減算（要介護・超過）
  if (isLimitExceededBeforeMonth && careInsured) {
    return 4;
  }
  return 1;
}

/**
 * ソート優先度 → statusKey
 * @param {number} order
 * @returns {string}
 */
function statusKeyFromOrder(order) {
  switch (order) {
    case 0: return '0_ANALGESIA';
    case 2: return '2_MEDICAL_ONLY_EXPIRED';
    case 3: return '3_MONTH_SWITCH';
    case 4: return '4_MAINTENANCE_REDUCED';
    case 1:
    default: return '1_NORMAL';
  }
}

/**
 * 算定ステータス区分と明細表示ラベルを判定する
 * @param {Object} patient
 * @param {string} monthStart
 * @param {string} monthEnd
 * @returns {{ statusKey: string, statusLabel: string, startLabel: string, endLabel: string, startSortKey: string, sectionKey: string, diseaseKey: string }}
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

  // 大項目「消炎鎮痛」: diseaseType=ANALGESIA、または消炎実績のみの物療扱い
  if (diseaseKey === 'ANALGESIA' || (deadlines.standardDays || 0) >= 9000) {
    return {
      sectionKey: 'ANALGESIA',
      diseaseKey: 'ANALGESIA',
      statusKey: '0_ANALGESIA',
      statusLabel: '消炎鎮痛',
      startLabel,
      endLabel: '-',
      startSortKey
    };
  }

  const care = isCareInsuredPatient(patient);
  const careLbl = careTypeLabel(patient);
  const force13 = patient?.force13Limit === true || patient?.force13UnitsLimit === true;
  const isLimitExceededBeforeMonth = !!(limitDateStr && limitDateStr < monthStart);
  const isMidMonth = !!(limitDateStr && limitDateStr >= monthStart && limitDateStr <= monthEnd);

  // 強制13単位制限（要介護）は維持期減算
  if (force13 && care) {
    return {
      sectionKey: patient?.category === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT',
      diseaseKey,
      statusKey: '4_MAINTENANCE_REDUCED',
      statusLabel: `維持期減算 (${careLbl}・13単位制限)`,
      startLabel,
      endLabel,
      startSortKey
    };
  }

  const order = getStatusOrder(patient, limitDateStr, care, isLimitExceededBeforeMonth, isMidMonth);
  const statusKey = statusKeyFromOrder(order);

  let statusLabel = '通常算定';
  if (statusKey === '4_MAINTENANCE_REDUCED') {
    statusLabel = `維持期減算 (${careLbl})`;
  } else if (statusKey === '3_MONTH_SWITCH') {
    const switchDateStr = limitDateStr ? addDays(limitDateStr, 1) : '';
    const switchMd = formatShortMd(switchDateStr) || formatShortMd(limitDateStr);
    statusLabel = `${switchMd}〜維持期減算 (${careLbl})`;
  } else if (statusKey === '2_MEDICAL_ONLY_EXPIRED') {
    if (isMidMonth) {
      const switchDateStr = limitDateStr ? addDays(limitDateStr, 1) : '';
      const switchMd = formatShortMd(switchDateStr) || formatShortMd(limitDateStr);
      statusLabel = `${switchMd}〜正規維持 (医療のみ)`;
    } else {
      statusLabel = '正規維持 (医療のみ)';
    }
  }

  return {
    sectionKey: patient?.category === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT',
    diseaseKey,
    statusKey,
    statusLabel,
    startLabel,
    endLabel,
    startSortKey
  };
}

/**
 * 当月実績患者を 【入院→外来→消炎鎮痛】× 疾患 × 算定区分 でグループ化
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
      // 消炎鎮痛疾患、または個別リハなしで消炎のみ → 大項目「消炎鎮痛」
      const isAnaDisease = p.diseaseType === 'ANALGESIA';
      const rehaUnits = item.rehaTotalUnits || 0;
      const hasReha = (item.hasRehaSlots === true) || rehaUnits > 0;
      const hasAna = (item.hasAnalgesiaSlots === true) || (item.totalAnalgesiaDays || 0) > 0;
      const forceAnalgesiaSection = isAnaDisease || (!hasReha && hasAna);

      const billing = forceAnalgesiaSection
        ? {
            ...resolveBillingStatus({ ...p, diseaseType: 'ANALGESIA' }, monthStart, monthEnd),
            sectionKey: 'ANALGESIA',
            diseaseKey: 'ANALGESIA'
          }
        : resolveBillingStatus(p, monthStart, monthEnd);

      return {
        id: String(p.id || ''),
        name: String(p.name || ''),
        sectionKey: billing.sectionKey,
        diseaseKey: billing.diseaseKey,
        diagnosis: resolveSpecificDiagnosis(p),
        startLabel: billing.startLabel,
        endLabel: billing.endLabel,
        startSortKey: billing.startSortKey,
        statusKey: billing.statusKey,
        statusLabel: billing.statusLabel
      };
    });

  rows.sort((a, b) => {
    const secDiff = SECTION_ORDER.indexOf(a.sectionKey) - SECTION_ORDER.indexOf(b.sectionKey);
    if (secDiff !== 0) return secDiff;
    if (a.sectionKey !== 'ANALGESIA') {
      const disDiff = DISEASE_ORDER.indexOf(a.diseaseKey) - DISEASE_ORDER.indexOf(b.diseaseKey);
      if (disDiff !== 0) return disDiff;
    }
    const stDiff = STATUS_ORDER.indexOf(a.statusKey) - STATUS_ORDER.indexOf(b.statusKey);
    if (stDiff !== 0) return stDiff;
    if (a.startSortKey !== b.startSortKey) return a.startSortKey.localeCompare(b.startSortKey);
    return a.id.localeCompare(b.id, 'ja', { numeric: true });
  });

  const sections = [];

  // 【入院】【外来】
  ['INPATIENT', 'OUTPATIENT'].forEach((sec) => {
    const secRows = rows.filter((r) => r.sectionKey === sec);
    if (secRows.length === 0) return;

    const diseaseGroups = [];
    DISEASE_ORDER.forEach((diseaseKey) => {
      const diseaseRows = secRows.filter((r) => r.diseaseKey === diseaseKey);
      if (diseaseRows.length === 0) return;

      const statusBlocks = [];
      ['1_NORMAL', '2_MEDICAL_ONLY_EXPIRED', '3_MONTH_SWITCH', '4_MAINTENANCE_REDUCED'].forEach((statusKey) => {
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
      sectionKey: sec,
      categoryLabel: sec === 'INPATIENT' ? '【 入 院 】' : '【 外 来 】',
      diseaseGroups,
      isAnalgesiaSection: false
    });
  });

  // 【消炎鎮痛等処置（物療）】
  const anaRows = rows.filter((r) => r.sectionKey === 'ANALGESIA');
  if (anaRows.length > 0) {
    sections.push({
      sectionKey: 'ANALGESIA',
      categoryLabel: '【 消炎鎮痛等処置（物療） 】',
      diseaseGroups: [{
        diseaseKey: 'ANALGESIA',
        title: '● 消炎鎮痛等処置（標準算定日数: 制限なし）',
        statusBlocks: [{
          statusKey: '0_ANALGESIA',
          title: STATUS_META['0_ANALGESIA'].title,
          meta: STATUS_META['0_ANALGESIA'],
          rows: anaRows
        }]
      }],
      isAnalgesiaSection: true
    });
  }

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
    `対象年月: ${year}年${month}月  |  出力日: ${outDate}  |  作成: リハビリテーション科  |  並び: 入院→外来→消炎鎮痛／通常算定→医療のみ→当月切替→維持期減算`,
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

        curRow += 1;
      });

      curRow += 1;
    });

    curRow += 1;
  });

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
