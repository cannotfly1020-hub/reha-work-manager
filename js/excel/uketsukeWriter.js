/**
 * @file uketsukeWriter.js
 * @description 受付提出用Excelブック（実施リスト 入院・外来・維持期介護・レセプト合計）を
 * テンプレートに忠実に生成・出力するモジュール
 * 
 * - SheetJS (XLSX) を利用し、クライアントブラウザ内（ローカル）でExcelバイナリを構築
 * - 各患者の日別・職種別（PT/OT）単位数を正確にマッピング
 * - 令和8年度改定の早期加算（4日以内/14日以内）および総合実施計画書料を自動算出・転記
 * - 完全オフライン動作（外部サーバー通信なし）
 */

import { REHA_RULES } from '../config/rules.js';
import { normalizePatientId } from '../core/dataNormalizer.js';
import { evaluateEarlyBonusPhase, formatDate } from '../core/deadlineCalc.js';
import { getAllPatients } from '../store/patientStore.js';

/**
 * セルへの値書き込み安全ヘルパー
 * @param {Object} ws - ワークシート
 * @param {number} r - 行インデックス (0-based)
 * @param {number} c - 列インデックス (0-based)
 * @param {any} value - 設定する値
 * @param {string} [type] - セル型 ('n': 数値, 's': 文字列, 'd': 日付)
 */
function setCellValue(ws, r, c, value, type = null) {
  const address = XLSX.utils.encode_cell({ r, c });
  if (value === null || value === undefined || value === '') {
    delete ws[address];
    return;
  }

  let cellType = type;
  if (!cellType) {
    if (typeof value === 'number') cellType = 'n';
    else if (typeof value === 'boolean') cellType = 'b';
    else if (value instanceof Date) cellType = 'd';
    else cellType = 's';
  }

  ws[address] = {
    v: value,
    t: cellType,
  };

  // ワークシートの参照範囲 (!ref) を自動拡張
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
 * 実施リスト系シートの4行目（患者記号）と5行目（PT/OT）から
 * 各患者のPT列・OT列インデックスを自動検出
 * 
 * @param {Object} ws - ワークシート
 * @returns {Object<string, { ptCol: number, otCol: number }>} 患者IDをキーとする列番号マップ
 */
function mapPatientColumns(ws) {
  const patientMap = {};
  if (!ws || !ws['!ref']) return patientMap;

  const range = XLSX.utils.decode_range(ws['!ref']);
  const maxCol = Math.min(range.e.c, 60);

  // 4行目（0-based r=3）を走査して患者記号を探索
  for (let c = 4; c <= maxCol; c++) {
    const pAddress = XLSX.utils.encode_cell({ r: 3, c });
    const pCell = ws[pAddress];
    if (pCell && pCell.v) {
      const pId = normalizePatientId(pCell.v);
      if (pId) {
        // デフォルトではその列がPT、隣がOT
        if (!patientMap[pId]) {
          patientMap[pId] = { ptCol: c, otCol: c + 1 };
        }
      }
    }
  }

  // 5行目（0-based r=4: 職種行）があればより厳密にPT/OTの列を照合
  for (const pId in patientMap) {
    const baseCol = patientMap[pId].ptCol;
    const c1Addr = XLSX.utils.encode_cell({ r: 4, c: baseCol });
    const c2Addr = XLSX.utils.encode_cell({ r: 4, c: baseCol + 1 });
    const v1 = ws[c1Addr]?.v ? String(ws[c1Addr].v).toUpperCase().trim() : '';
    const v2 = ws[c2Addr]?.v ? String(ws[c2Addr].v).toUpperCase().trim() : '';

    if (v1 === 'PT') patientMap[pId].ptCol = baseCol;
    if (v1 === 'OT') patientMap[pId].otCol = baseCol;
    if (v2 === 'PT') patientMap[pId].ptCol = baseCol + 1;
    if (v2 === 'OT') patientMap[pId].otCol = baseCol + 1;
  }

  return patientMap;
}

/**
 * 単一の実施リストシート（例: '実施ﾘｽﾄ 入院'）に日別のリハビリ単位数を流し込む
 * 
 * @param {Object} ws - 対象ワークシート
 * @param {Object} aggregated - rehaRecordParser による集計オブジェクト
 * @param {Array<Object>} patientMasters - 患者マスターリスト
 */
export function populateImplementationSheet(ws, aggregated, patientMasters) {
  if (!ws || !ws['!ref']) return;

  const colMap = mapPatientColumns(ws);
  const { targetYear, targetMonth, daysInMonth, byPatientAndDate } = aggregated;

  // 患者マスターをマップ化
  const masterMap = {};
  patientMasters.forEach((p) => {
    masterMap[normalizePatientId(p.id)] = p;
  });

  // 日付行は 行6（0-based r=5）〜 行36（0-based r=35）が 1日〜31日
  for (let d = 1; d <= daysInMonth; d++) {
    const rowIndex = 4 + d; // 1日目は r=5
    const dateObj = new Date(targetYear, targetMonth - 1, d);
    const dateStr = formatDate(dateObj);

    // シート上の該当日付を登録している患者列に単位数を記入
    for (const [pId, cols] of Object.entries(colMap)) {
      const dayData = byPatientAndDate[pId]?.[dateStr];

      // PT列に書き込み
      if (dayData && dayData.PT > 0) {
        setCellValue(ws, rowIndex, cols.ptCol, dayData.PT, 'n');
      } else {
        // データがない場合は空欄（既存の不要数値をクリア）
        setCellValue(ws, rowIndex, cols.ptCol, null);
      }

      // OT列に書き込み
      if (dayData && dayData.OT > 0) {
        setCellValue(ws, rowIndex, cols.otCol, dayData.OT, 'n');
      } else {
        setCellValue(ws, rowIndex, cols.otCol, null);
      }
    }
  }

  // 37行目（r=36）: 月間合計行
  // 42行目〜45行目: 令和8年改定 早期加算（4日以内: 60点 / 14日以内: 25点）
  // 46行目: 総合実施計画書 期限
  const sumRowIndex = 36;
  const earlyP1RowIndex = 42; // 早期加算(60)
  const earlyP2RowIndex = 44; // 早期加算(25)
  const planDueRowIndex = 45; // 実施1期限

  for (const [pId, cols] of Object.entries(colMap)) {
    const pMaster = masterMap[pId] || {};
    const patientMonthData = byPatientAndDate[pId] || {};

    let ptTotal = 0;
    let otTotal = 0;
    let phase1Count = 0;
    let phase2Count = 0;

    // 早期加算の起算日（転院患者は前医入院日、未指定時は当院入院日）
    const earlyStartDate = pMaster.earlyBonusStartDate || pMaster.admissionDate;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(targetYear, targetMonth - 1, d);
      const dateStr = formatDate(dateObj);
      const dayData = patientMonthData[dateStr];

      if (dayData && dayData.total > 0) {
        ptTotal += dayData.PT || 0;
        otTotal += dayData.OT || 0;

        // 早期加算の判定（実施日と起算日の比較）
        if (earlyStartDate) {
          const phase = evaluateEarlyBonusPhase(earlyStartDate, dateObj);
          if (phase === 'PHASE_1') phase1Count += 1;
          else if (phase === 'PHASE_2') phase2Count += 1;
        }
      }
    }

    // 合計書き込み
    setCellValue(ws, sumRowIndex, cols.ptCol, ptTotal, 'n');
    if (otTotal > 0) {
      setCellValue(ws, sumRowIndex, cols.otCol, otTotal, 'n');
    }

    // 早期加算回数書き込み
    if (phase1Count > 0) {
      setCellValue(ws, earlyP1RowIndex, cols.ptCol, phase1Count, 'n');
    }
    if (phase2Count > 0) {
      setCellValue(ws, earlyP2RowIndex, cols.ptCol, phase2Count, 'n');
    }

    // 計画書期限
    if (pMaster.lastPlanDate) {
      setCellValue(ws, planDueRowIndex, cols.ptCol, pMaster.lastPlanDate, 's');
    }
  }
}

/**
 * レセプト合計シート（(レセプト合計)入院、(レセプト合計)外来）に
 * 疾患別単位数・早期加算合計・計画書料を反映
 * 
 * @param {Object} ws - レセプト合計シート
 * @param {Object} aggregated - 集計データ
 * @param {Array<Object>} patientMasters - 患者マスターリスト
 * @param {'inpatient'|'outpatient'} sheetType - 入院または外来区分
 */
export function populateReceiptSummarySheet(ws, aggregated, patientMasters, sheetType = 'inpatient') {
  if (!ws || !ws['!ref']) return;

  const { byPatientAndDate, daysInMonth, targetYear, targetMonth } = aggregated;
  const masterMap = {};
  patientMasters.forEach((p) => {
    masterMap[normalizePatientId(p.id)] = p;
  });

  // 対象カテゴリの患者のみ抽出
  const targetPatients = patientMasters.filter((p) => {
    if (sheetType === 'inpatient') {
      return p.category && p.category.startsWith('inpatient');
    } else {
      return p.category && p.category.startsWith('outpatient');
    }
  });

  let totalPhase1Sessions = 0;
  let totalPhase2Sessions = 0;
  const diseaseTotals = {
    LOCOMOTIVE: 0,
    CEREBROVASCULAR: 0,
    DISUSE: 0,
    ANALGESIA: 0,
  };

  targetPatients.forEach((p) => {
    const pId = normalizePatientId(p.id);
    const pData = byPatientAndDate[pId] || {};
    const earlyStartDate = p.earlyBonusStartDate || p.admissionDate;

    let pTotalUnits = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dObj = new Date(targetYear, targetMonth - 1, d);
      const dStr = formatDate(dObj);
      const dayVal = pData[dStr];

      if (dayVal && dayVal.total > 0) {
        pTotalUnits += dayVal.total;
        if (earlyStartDate) {
          const phase = evaluateEarlyBonusPhase(earlyStartDate, dObj);
          if (phase === 'PHASE_1') totalPhase1Sessions += 1;
          else if (phase === 'PHASE_2') totalPhase2Sessions += 1;
        }
      }
    }

    const dType = p.diseaseType || 'LOCOMOTIVE';
    if (diseaseTotals[dType] !== undefined) {
      diseaseTotals[dType] += pTotalUnits;
    }
  });

  // レセプト合計シートの定位置へサマリー値を書き込み
  // 早期加算60点（4日以内）
  setCellValue(ws, 10, 17, totalPhase1Sessions, 'n');
  setCellValue(ws, 10, 18, totalPhase1Sessions * REHA_RULES.EARLY_BONUS.PHASE_1.points, 'n');

  // 早期加算25点（14日以内）
  setCellValue(ws, 11, 17, totalPhase2Sessions, 'n');
  setCellValue(ws, 11, 18, totalPhase2Sessions * REHA_RULES.EARLY_BONUS.PHASE_2.points, 'n');
}

/**
 * 受付提出用Excelテンプレートに全集計データを反映し、
 * クライアントのブラウザでファイルダウンロードを実行
 * 
 * @param {Object} templateWorkbook - 元の受付提出用テンプレートブック (SheetJS workbook)
 * @param {Object} aggregated - 集計データ
 * @param {string} [filename] - ダウンロード保存ファイル名
 */
export function exportUketsukeSubmissionWorkbook(templateWorkbook, aggregated, filename = '') {
  if (!templateWorkbook) {
    throw new Error('受付提出用のテンプレートブックが読み込まれていません。');
  }

  const patientMasters = getAllPatients();
  const wb = templateWorkbook;

  // 各対象シートにデータを反映
  const sheetNames = wb.SheetNames;

  sheetNames.forEach((name) => {
    const ws = wb.Sheets[name];
    const cleanName = name.trim();

    if (cleanName === '実施ﾘｽﾄ 入院' || cleanName === '入院(2)' || cleanName === '入院 （維持期介護)' || cleanName === '外来' || cleanName === '外来 (運2)') {
      populateImplementationSheet(ws, aggregated, patientMasters);
    } else if (cleanName === '(レセプト合計)入院') {
      populateReceiptSummarySheet(ws, aggregated, patientMasters, 'inpatient');
    } else if (cleanName === '(レセプト合計)外来') {
      populateReceiptSummarySheet(ws, aggregated, patientMasters, 'outpatient');
    }
  });

  // ファイル名決定 (例: 受付提出_単位管理_2026年7月度.xlsx)
  const defaultFilename = `受付提出_単位管理_${aggregated.targetYear}年${aggregated.targetMonth}月度.xlsx`;
  const finalFilename = filename || defaultFilename;

  // SheetJSでバイナリを書き出し、ブラウザで直接保存
  XLSX.writeFile(wb, finalFilename, {
    bookType: 'xlsx',
    cellDates: true,
  });

  return {
    success: true,
    filename: finalFilename,
  };
}
