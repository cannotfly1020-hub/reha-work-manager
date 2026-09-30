/**
 * @file rehaRecordParser.js
 * @description リハ記録(A), (B), (C)のExcelファイルを読み込み、
 * 各日付・各患者・各セラピストの実施単位数を集計・正規化するパーサーモジュール
 * 
 * - SheetJS (XLSX) を利用してブラウザ内（ローカル）でバイナリ解析
 * - 午前シート (例: '7(am) ') / 午後シート (例: '7(pm)') の両方を統合
 * - dataNormalizer.js を経由して全角・半角スペースや大文字小文字の揺れを完全吸収
 */

import { parseSessionCell, parseRehaSheetName, normalizePatientId } from '../core/dataNormalizer.js';
import { normalizeDate, formatDate } from '../core/deadlineCalc.js';

/**
 * 単一のワークシート（例: 7(am) や 7(pm)）から日別のリハ実施コマを抽出
 * @param {Object} worksheet - SheetJSのワークシートオブジェクト
 * @param {number} targetMonth - 対象月 (1〜12)
 * @param {string} therapistCode - セラピスト識別記号 ('A', 'B', 'C')
 * @returns {Array<Object>} 抽出されたコマ実施レコード一覧
 */
export function parseRehaWorksheet(worksheet, targetMonth, therapistCode = 'A') {
  if (!worksheet || !worksheet['!ref']) return [];

  const records = [];
  const range = XLSX.utils.decode_range(worksheet['!ref']);

  // 行4以降が日付データ行 (行1〜3は見出し・時間割)
  // 列1: 日付, 列2: '(', 列3: 曜日, 列4: ')', 列5以降: 時間割コマ
  for (let R = 3; R <= range.e.r; ++R) {
    // 日付セル (A列: C = 0)
    const dateCellAddress = XLSX.utils.encode_cell({ r: R, c: 0 });
    const dateCell = worksheet[dateCellAddress];
    if (!dateCell || dateCell.v === undefined || dateCell.v === null) continue;

    const sessionDate = normalizeDate(dateCell.v);
    if (!sessionDate) continue;

    // 対象月と一致しているか確認（1〜12月）
    if (sessionDate.getMonth() + 1 !== targetMonth) continue;

    const dateStr = formatDate(sessionDate);

    // 列5以降（インデックス C = 4 以降）のコマを走査
    for (let C = 4; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = worksheet[cellAddress];
      if (!cell || !cell.v) continue;

      const parsed = parseSessionCell(cell.v);
      if (parsed) {
        records.push({
          date: sessionDate,
          dateStr,
          day: sessionDate.getDate(),
          therapistCode,
          patientId: parsed.patientId,
          units: parsed.units,
          rawCell: parsed.raw,
          cellAddress,
        });
      }
    }
  }

  return records;
}

/**
 * 1人のセラピストのリハ記録ブック（例: R8 ﾘﾊ記録 (A).xlsx）から、
 * 指定された月の午前・午後すべてのデータを抽出
 * 
 * @param {Object} workbook - SheetJSのワークブックオブジェクト
 * @param {number} targetMonth - 対象月 (1〜12)
 * @param {string} therapistCode - セラピスト識別記号 ('A', 'B', 'C')
 * @returns {Array<Object>} 抽出されたレコード配列
 */
export function parseTherapistWorkbook(workbook, targetMonth, therapistCode = 'A') {
  if (!workbook || !workbook.SheetNames) return [];

  const allRecords = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheetInfo = parseRehaSheetName(sheetName);
    if (!sheetInfo) return;

    // 指定月に合致するシートのみ解析 (am / pm 双方)
    if (sheetInfo.month === targetMonth) {
      const ws = workbook.Sheets[sheetName];
      const records = parseRehaWorksheet(ws, targetMonth, therapistCode);
      allRecords.push(...records);
    }
  });

  return allRecords;
}

/**
 * セラピストA, B, Cの全レコードを統合し、
 * 受付提出および業務日誌の出力に必要な多角的な集計オブジェクトを生成
 * 
 * @param {Array<{therapistCode: string, workbook: Object}>} therapistWorkbooks - 読み込んだ各セラピストのブック配列
 * @param {number} targetMonth - 対象月
 * @param {number} targetYear - 対象年 (例: 2026)
 * @returns {Object} 集計結果オブジェクト
 */
export function aggregateRehaRecords(therapistWorkbooks, targetMonth, targetYear = 2026) {
  const rawRecords = [];

  // 1. 各ブックからレコードを抽出
  therapistWorkbooks.forEach(({ therapistCode, workbook }) => {
    if (workbook) {
      const records = parseTherapistWorkbook(workbook, targetMonth, therapistCode);
      rawRecords.push(...records);
    }
  });

  // 2. 日付・患者・セラピスト別のマトリクス集約
  // 構造: byPatientAndDate[patientId][dateStr] = { PT: number, OT: number, total: number, records: [] }
  const byPatientAndDate = {};
  
  // 構造: byDateAndPatient[dateStr][patientId] = { PT: number, OT: number, total: number }
  const byDateAndPatient = {};

  // 構造: patientTotals[patientId] = { totalUnits: number, daysActive: number, dates: Set }
  const patientTotals = {};

  // 構造: dailySummary[dateStr] = { totalUnits: number, patientSet: Set, therapistUnits: { A: 0, B: 0, C: 0 } }
  const dailySummary = {};

  // 月の日数を計算 (対象年月の末日)
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

  // 日付初期化
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(targetYear, targetMonth - 1, d);
    const dateStr = formatDate(dateObj);
    byDateAndPatient[dateStr] = {};
    dailySummary[dateStr] = {
      date: dateObj,
      dateStr,
      day: d,
      totalUnits: 0,
      uniquePatients: new Set(),
      therapistUnits: { A: 0, B: 0, C: 0 },
    };
  }

  // レコードの集計ループ
  rawRecords.forEach((rec) => {
    const pId = normalizePatientId(rec.patientId);
    const dStr = rec.dateStr;
    const tCode = rec.therapistCode; // 'A', 'B', 'C'
    const units = rec.units;

    // 患者別・日付別初期化
    if (!byPatientAndDate[pId]) {
      byPatientAndDate[pId] = {};
      patientTotals[pId] = {
        patientId: pId,
        totalUnits: 0,
        dates: new Set(),
      };
    }
    if (!byPatientAndDate[pId][dStr]) {
      byPatientAndDate[pId][dStr] = {
        PT: 0,
        OT: 0,
        total: 0,
        records: [],
      };
    }

    // 日付別・患者別初期化
    if (byDateAndPatient[dStr] && !byDateAndPatient[dStr][pId]) {
      byDateAndPatient[dStr][pId] = {
        PT: 0,
        OT: 0,
        total: 0,
      };
    }

    // 現在は全員PT（将来OT判定が必要な場合はここで分岐可能）
    byPatientAndDate[pId][dStr].PT += units;
    byPatientAndDate[pId][dStr].total += units;
    byPatientAndDate[pId][dStr].records.push(rec);

    if (byDateAndPatient[dStr]) {
      byDateAndPatient[dStr][pId].PT += units;
      byDateAndPatient[dStr][pId].total += units;
    }

    // 患者トータル加算
    patientTotals[pId].totalUnits += units;
    patientTotals[pId].dates.add(dStr);

    // 日計サマリー加算
    if (dailySummary[dStr]) {
      dailySummary[dStr].totalUnits += units;
      dailySummary[dStr].uniquePatients.add(pId);
      if (dailySummary[dStr].therapistUnits[tCode] !== undefined) {
        dailySummary[dStr].therapistUnits[tCode] += units;
      }
    }
  });

  return {
    targetYear,
    targetMonth,
    daysInMonth,
    rawRecordsCount: rawRecords.length,
    rawRecords,
    byPatientAndDate,
    byDateAndPatient,
    patientTotals,
    dailySummary,
    // 登場した全患者ID一覧（アルファベット順にソート）
    activePatientIds: Object.keys(patientTotals).sort(),
  };
}

/**
 * ブラウザのFileオブジェクトからSheetJSワークブックを非同期で読み込むユーティリティ
 * （完全クライアントサイド実行・外部通信なし）
 * 
 * @param {File} file - input[type="file"] または Drag&Drop で渡されたFileオブジェクト
 * @returns {Promise<Object>} SheetJS ワークブック
 */
export function readWorkbookFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('ファイルが指定されていません。'));
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {
          type: 'array',
          cellDates: true,    // 日付型として自動変換
          cellFormula: false, // 数式は評価せず値のみ高速取得
        });
        resolve(workbook);
      } catch (err) {
        reject(new Error(`Excelファイルの解析に失敗しました: ${err.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('ファイルの読み込み中にエラーが発生しました。'));
    };

    reader.readAsArrayBuffer(file);
  });
}
