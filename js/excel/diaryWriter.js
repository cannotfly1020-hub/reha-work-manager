/**
 * @file diaryWriter.js
 * @description 業務日誌Excel（1日〜31日の日別シート構成）に
 * 各日のリハビリ実施人数・単位数・疾患別内訳・早期加算人数を集計して反映するモジュール
 * 
 * - SheetJS (XLSX) を用いてクライアントローカルで高速処理
 * - 日付ごとに「入院／外来」×「疾患別（脳血管・廃用・運動器・消炎鎮痛・維持期介護）」の実人数と単位数を正確に集計
 * - 業務日誌原本の24列目（X列）の定位置へ自動転記
 * - 完全オフライン動作（外部通信なし）
 */

import { normalizePatientId } from '../core/dataNormalizer.js';
import { evaluateEarlyBonusPhase, formatDate } from '../core/deadlineCalc.js';
import { getAllPatients } from '../store/patientStore.js';

/**
 * セル値安全書き込みヘルパー
 * @param {Object} ws - 対象ワークシート
 * @param {number} r - 行インデックス (0-based)
 * @param {number} c - 列インデックス (0-based)
 * @param {any} value - 設定する値
 * @param {string} [type='n'] - セル型
 */
function setCellValue(ws, r, c, value, type = 'n') {
  const address = XLSX.utils.encode_cell({ r, c });
  if (value === null || value === undefined) {
    delete ws[address];
    return;
  }

  ws[address] = {
    v: value,
    t: type,
  };

  // ワークシートの表示・データ範囲 (!ref) を安全に拡張
  if (!ws['!ref']) {
    ws['!ref'] = address;
  } else {
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (r < range.s.r) range.s.r = r;
    if (r > range.e.r) range.e.r = r;
    if (c < range.s.c) range.s.c = c;
    if (c > range.e.c) range.e.c = c;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
}

/**
 * 業務日誌シートにおける集計値の書き込み行定義 (0-based 行インデックス)
 * 対象列: 24列目 (0-based c = 23, X列)
 */
const DIARY_ROWS = {
  // 入院
  INPATIENT: {
    CEREBROVASCULAR: {
      COUNT: 7,       // 行8: 脳血管Ⅲ 人数
      UNITS: 8,       // 行9: 単位数(100)
      MAINT_COUNT: 9, // 行10: 維持期リハ介護人数
      MAINT_UNITS: 10,// 行11: 維持期ﾘﾊ介護単位数(60)
      EARLY_BONUS: 11,// 行12: 早期加算(60)
    },
    DISUSE: {
      COUNT: 12,      // 行13: 廃用Ⅲ 人数
      UNITS: 13,      // 行14: 単位数(77)
      MAINT_COUNT: 14,// 行15: 持期ﾘﾊ介護人数
      MAINT_UNITS: 15,// 行16: 維持期ﾘﾊ介護単位数(46)
      EARLY_BONUS: 16,// 行17: 早期加算(60)
    },
    LOCOMOTIVE: {
      COUNT: 17,      // 行18: 運動器Ⅱ 人数
      UNITS: 18,      // 行19: 単位数(170)
      MAINT_COUNT: 19,// 行20: 維持期リハ介護人数
      MAINT_UNITS: 20,// 行21: 維持期リハ介護単位数(102)
      EARLY_BONUS: 21,// 行22: 早期加算(60)
    },
    ANALGESIA: 22,    // 行23: 消炎鎮痛
  },
  // 外来
  OUTPATIENT: {
    CEREBROVASCULAR: {
      COUNT: 23,      // 行24: 脳血管Ⅲ 人数
      UNITS: 24,      // 行25: 単位数(100)
      MAINT_COUNT: 25,// 行26: 維持期リハ介護人数
      MAINT_UNITS: 26,// 行27: 維持期ﾘﾊ介護単位数(60)
      EARLY_BONUS: 27,// 行28: 早期加算(60)
    },
    DISUSE: {
      COUNT: 28,      // 行29: 廃用Ⅲ 人数
      UNITS: 29,      // 行30: 単位数(77)
      MAINT_COUNT: 30,// 行31: 持期ﾘﾊ介護人数
      MAINT_UNITS: 31,// 行32: 維持期ﾘﾊ介護単位数(46)
      EARLY_BONUS: 32,// 行33: 早期加算(60)
    },
    LOCOMOTIVE: {
      COUNT: 33,      // 行34: 運動器Ⅱ 人数
      UNITS: 34,      // 行35: 単位数(170)
      MAINT_COUNT: 35,// 行36: 維持期リハ介護人数
      MAINT_UNITS: 36,// 行37: 維持期リハ介護単位数(102)
      EARLY_BONUS: 37,// 行38: 早期加算(60)
    },
    ANALGESIA: 38,    // 行39: 消炎鎮痛
  },
  // 合計
  TOTAL: {
    COUNT: 42,        // 行43: 合計 人数
    UNITS: 43,        // 行44: 合計 単位数
  },
  // 集計値の書き込み列 (24列目: 0-based c = 23)
  TARGET_COL: 23,
};

/**
 * 指定日の患者別実施データから、業務日誌の各集計カテゴリ数値を集計
 * 
 * @param {string} dateStr - 対象日文字列 (YYYY-MM-DD)
 * @param {Date} dateObj - 対象日Dateオブジェクト
 * @param {Object} byDatePatientData - 集計オブジェクト (byDateAndPatient[dateStr])
 * @param {Object<string, Object>} masterMap - 患者IDをキーとする患者マスター辞書
 * @returns {Object} 業務日誌シート転記用集計オブジェクト
 */
export function calculateDailyDiaryStats(dateStr, dateObj, byDatePatientData = {}, masterMap = {}) {
  const stats = {
    inpatient: {
      LOCOMOTIVE: { count: 0, units: 0, maintCount: 0, maintUnits: 0, earlyBonusCount: 0 },
      CEREBROVASCULAR: { count: 0, units: 0, maintCount: 0, maintUnits: 0, earlyBonusCount: 0 },
      DISUSE: { count: 0, units: 0, maintCount: 0, maintUnits: 0, earlyBonusCount: 0 },
      ANALGESIA: 0,
    },
    outpatient: {
      LOCOMOTIVE: { count: 0, units: 0, maintCount: 0, maintUnits: 0, earlyBonusCount: 0 },
      CEREBROVASCULAR: { count: 0, units: 0, maintCount: 0, maintUnits: 0, earlyBonusCount: 0 },
      DISUSE: { count: 0, units: 0, maintCount: 0, maintUnits: 0, earlyBonusCount: 0 },
      ANALGESIA: 0,
    },
    totalCount: 0,
    totalUnits: 0,
  };

  const processedPatients = new Set();

  for (const [pId, dayRec] of Object.entries(byDatePatientData)) {
    if (!dayRec || dayRec.total <= 0) continue;

    const patient = masterMap[pId] || {
      id: pId,
      category: pId >= 'p' ? 'outpatient_1' : 'inpatient_1',
      diseaseType: 'LOCOMOTIVE',
    };

    const isOutpatient = patient.category && patient.category.startsWith('outpatient');
    const isMaintenance = patient.category && patient.category.includes('maintenance');
    const diseaseType = patient.diseaseType || 'LOCOMOTIVE';
    const section = isOutpatient ? stats.outpatient : stats.inpatient;
    const units = dayRec.total;

    // 実人数カウント（重複防止）
    if (!processedPatients.has(pId)) {
      processedPatients.add(pId);
      stats.totalCount += 1;
    }
    stats.totalUnits += units;

    // 消炎鎮痛の判定
    if (diseaseType === 'ANALGESIA') {
      section.ANALGESIA += units;
      continue;
    }

    const dStats = section[diseaseType] || section.LOCOMOTIVE;

    if (isMaintenance) {
      // 維持期介護
      dStats.maintCount += 1;
      dStats.maintUnits += units;
    } else {
      // 通常リハビリ
      dStats.count += 1;
      dStats.units += units;

      // 早期加算の判定（入院日／前医起算日から14日以内）
      const earlyStartDate = patient.earlyBonusStartDate || patient.admissionDate;
      if (earlyStartDate && !isOutpatient) {
        const bonusPhase = evaluateEarlyBonusPhase(earlyStartDate, dateObj);
        if (bonusPhase === 'PHASE_1' || bonusPhase === 'PHASE_2') {
          dStats.earlyBonusCount += 1;
        }
      }
    }
  }

  return stats;
}

/**
 * 単一日付の集計結果を該当シート（1日〜31日）へ書き込み
 * 
 * @param {Object} ws - 該当日のワークシート
 * @param {Object} stats - calculateDailyDiaryStats の集計結果
 */
export function populateDailyDiarySheet(ws, stats) {
  if (!ws) return;
  const col = DIARY_ROWS.TARGET_COL;

  // 1. 入院
  const inStats = stats.inpatient;
  ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE'].forEach((type) => {
    const rowDef = DIARY_ROWS.INPATIENT[type];
    const data = inStats[type];
    if (rowDef && data) {
      setCellValue(ws, rowDef.COUNT, col, data.count);
      setCellValue(ws, rowDef.UNITS, col, data.units);
      setCellValue(ws, rowDef.MAINT_COUNT, col, data.maintCount);
      setCellValue(ws, rowDef.MAINT_UNITS, col, data.maintUnits);
      setCellValue(ws, rowDef.EARLY_BONUS, col, data.earlyBonusCount);
    }
  });
  setCellValue(ws, DIARY_ROWS.INPATIENT.ANALGESIA, col, inStats.ANALGESIA);

  // 2. 外来
  const outStats = stats.outpatient;
  ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE'].forEach((type) => {
    const rowDef = DIARY_ROWS.OUTPATIENT[type];
    const data = outStats[type];
    if (rowDef && data) {
      setCellValue(ws, rowDef.COUNT, col, data.count);
      setCellValue(ws, rowDef.UNITS, col, data.units);
      setCellValue(ws, rowDef.MAINT_COUNT, col, data.maintCount);
      setCellValue(ws, rowDef.MAINT_UNITS, col, data.maintUnits);
      setCellValue(ws, rowDef.EARLY_BONUS, col, data.earlyBonusCount);
    }
  });
  setCellValue(ws, DIARY_ROWS.OUTPATIENT.ANALGESIA, col, outStats.ANALGESIA);

  // 3. 合計
  setCellValue(ws, DIARY_ROWS.TOTAL.COUNT, col, stats.totalCount);
  setCellValue(ws, DIARY_ROWS.TOTAL.UNITS, col, stats.totalUnits);
}

/**
 * 業務日誌テンプレートブック（31日分シート）に全日付データを反映し、
 * クライアントのブラウザでファイルダウンロードを実行
 * 
 * @param {Object} diaryTemplateWorkbook - 元の業務日誌テンプレートブック (SheetJS workbook)
 * @param {Object} aggregated - rehaRecordParser による集計オブジェクト
 * @param {string} [filename=''] - 保存ファイル名
 * @returns {{ success: boolean, filename: string }}
 */
export function exportDiaryWorkbook(diaryTemplateWorkbook, aggregated, filename = '') {
  if (!diaryTemplateWorkbook) {
    throw new Error('業務日誌の原本テンプレートブックが読み込まれていません。');
  }

  const wb = diaryTemplateWorkbook;
  const patientMasters = getAllPatients();
  const masterMap = {};
  patientMasters.forEach((p) => {
    masterMap[normalizePatientId(p.id)] = p;
  });

  const { targetYear, targetMonth, daysInMonth, byDateAndPatient } = aggregated;

  // 業務日誌の各シート（通常は sheet 0 = 1日, sheet 1 = 2日 ... 最大31シート）を走査
  const sheetNames = wb.SheetNames;

  for (let d = 1; d <= daysInMonth; d++) {
    const sheetIndex = d - 1;
    if (sheetIndex >= sheetNames.length) break;

    const sheetName = sheetNames[sheetIndex];
    const ws = wb.Sheets[sheetName];

    const dateObj = new Date(targetYear, targetMonth - 1, d);
    const dateStr = formatDate(dateObj);
    const dayData = byDateAndPatient[dateStr] || {};

    // 指定日の集計
    const dailyStats = calculateDailyDiaryStats(dateStr, dateObj, dayData, masterMap);

    // シートへ流し込み
    populateDailyDiarySheet(ws, dailyStats);
  }

  // ファイル名決定 (例: 業務日誌_2026年7月度.xlsx)
  const defaultFilename = `業務日誌_${targetYear}年${targetMonth}月度.xlsx`;
  const finalFilename = filename || defaultFilename;

  // ローカル保存実行（ブラウザ内完結）
  XLSX.writeFile(wb, finalFilename, {
    bookType: 'xlsx',
    cellDates: true,
  });

  return {
    success: true,
    filename: finalFilename,
  };
}
