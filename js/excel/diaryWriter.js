// js/excel/diaryWriter.js
// 業務日誌Excelワークブック生成・日別シート（24列目）転記層（200行制限準拠）

import { REHA_RULES } from '../config/rules.js';

const TARGET_COL_INDEX = 23; // 24列目（0-indexed で 23 = ExcelのX列）

/**
 * 業務日誌Excelワークブックを生成する（テンプレートがあれば転記、なければ新規作成）
 * @param {Object} aggregated aggregateFromAppSchedule の集計オブジェクト
 * @param {ArrayBuffer|null} templateBuffer アップロードされた原本テンプレート
 * @returns {Object} XLSX ワークブックオブジェクト
 */
export function generateDiaryWorkbook(aggregated, templateBuffer = null) {
  if (!window.XLSX) {
    throw new Error('SheetJS (XLSX) ライブラリが読み込まれていません。');
  }

  let wb;
  if (templateBuffer) {
    wb = window.XLSX.read(templateBuffer, { type: 'array' });
  } else {
    wb = window.XLSX.utils.book_new();
  }

  const { daysInMonth, year, month } = aggregated;

  // 1日〜当月最終日までの各日シートに対してデータを書き込み
  for (let day = 1; day <= daysInMonth; day++) {
    const sheetName = getDiarySheetName(wb, day);
    let ws = wb.Sheets[sheetName];

    if (!ws) {
      // テンプレートに対象日のシートが存在しない場合はフォールバックシートを作成
      ws = createFallbackDiarySheet(year, month, day);
      window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    writeDailyStatsToSheet(ws, aggregated, day);
  }

  return wb;
}

/**
 * 日付に応じたシート名を取得（"1日", "1", "01日" 等の既存シート名に対応）
 */
function getDiarySheetName(wb, day) {
  const candidates = [`${day}日`, `${day}`, String(day).padStart(2, '0'), `${String(day).padStart(2, '0')}日`];
  const existingNames = wb.SheetNames || [];
  
  for (const name of candidates) {
    if (existingNames.includes(name)) {
      return name;
    }
  }
  return `${day}日`;
}

/**
 * 特定日の集計数値をワークシートの24列目（X列）の定位置ブロックに転記
 */
function writeDailyStatsToSheet(ws, aggregated, day) {
  const dayStr = `${aggregated.year}-${String(aggregated.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // 疾患別 × 入院/外来の集計カウンタ
  const breakdown = {
    INPATIENT: { LOCOMOTIVE: 0, CEREBROVASCULAR: 0, DISUSE: 0, ANALGESIA: 0, total: 0 },
    OUTPATIENT: { LOCOMOTIVE: 0, CEREBROVASCULAR: 0, DISUSE: 0, ANALGESIA: 0, total: 0 },
    plans: 0,
    totalUnits: 0
  };

  Object.values(aggregated.patientMap).forEach((item) => {
    const p = item.patient;
    const cat = p.category === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT';
    const dType = p.diseaseType in breakdown[cat] ? p.diseaseType : 'LOCOMOTIVE';
    
    // 当日実施スロットのみ抽出
    const todaySlots = (item.slots || []).filter((s) => s.date === dayStr);
    todaySlots.forEach((slot) => {
      breakdown[cat][dType] += slot.units;
      breakdown[cat].total += slot.units;
      breakdown.totalUnits += slot.units;
      if (slot.billingPlan) {
        breakdown.plans += 1;
      }
    });
  });

  // 24列目（X列: colIndex = 23）の定位置ブロック（行インデックス 2〜12）へ書き出し
  const c = TARGET_COL_INDEX;
  setCell(ws, 1, c, `当日集計 (${day}日)`);
  setCell(ws, 2, c, breakdown.totalUnits);       // 総実施単位
  setCell(ws, 3, c, breakdown.INPATIENT.total);   // 入院総単位
  setCell(ws, 4, c, breakdown.OUTPATIENT.total);  // 外来総単位
  setCell(ws, 5, c, breakdown.INPATIENT.LOCOMOTIVE);      // 入院 運動器
  setCell(ws, 6, c, breakdown.INPATIENT.CEREBROVASCULAR); // 入院 脳血管
  setCell(ws, 7, c, breakdown.INPATIENT.DISUSE);          // 入院 廃用
  setCell(ws, 8, c, breakdown.OUTPATIENT.LOCOMOTIVE);     // 外来 運動器
  setCell(ws, 9, c, breakdown.OUTPATIENT.CEREBROVASCULAR);// 外来 脳血管
  setCell(ws, 10, c, breakdown.OUTPATIENT.ANALGESIA);     // 外来 消炎鎮痛
  setCell(ws, 11, c, breakdown.plans);                    // 計画書策定件数

  updateSheetRange(ws);
}

/**
 * テンプレート未指定時用の日別フォールバックシート構築
 */
function createFallbackDiarySheet(year, month, day) {
  const rows = [
    [`リハビリテーション業務日誌 - ${year}年${month}月${day}日`],
    ['時間帯', 'PT A', 'PT B', 'PT C']
  ];

  // 22スロット分の空行を確保
  for (let i = 1; i <= 22; i++) {
    rows.push([`第${i}コマ`, '', '', '']);
  }

  const ws = window.XLSX.utils.aoa_to_sheet(rows);

  // 23列目（W列）にラベルを付与
  const labelCol = TARGET_COL_INDEX - 1;
  const labels = [
    '項目',
    '当日総単位数',
    '入院総単位数',
    '外来総単位数',
    '入院 運動器',
    '入院 脳血管',
    '入院 廃用',
    '外来 運動器',
    '外来 脳血管',
    '外来 消炎鎮痛',
    '計画書策定件数'
  ];

  labels.forEach((text, idx) => {
    setCell(ws, idx + 1, labelCol, text);
  });

  return ws;
}

/**
 * ワークシートの特定セル (row, col) に値を設定
 */
function setCell(ws, r, c, val) {
  const addr = window.XLSX.utils.encode_cell({ r, c });
  if (val === '' || val === null || val === undefined) {
    delete ws[addr];
    return;
  }
  const isNum = typeof val === 'number';
  ws[addr] = { t: isNum ? 'n' : 's', v: val };
}

/**
 * ワークシートの !ref を再計算して更新
 */
function updateSheetRange(ws) {
  const keys = Object.keys(ws).filter((k) => !k.startsWith('!'));
  if (keys.length === 0) return;

  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  keys.forEach((k) => {
    const cell = window.XLSX.utils.decode_cell(k);
    if (cell.r < minR) minR = cell.r;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c < minC) minC = cell.c;
    if (cell.c > maxC) maxC = cell.c;
  });

  ws['!ref'] = window.XLSX.utils.encode_range(
    { r: minR, c: minC },
    { r: maxR, c: maxC }
  );
}
