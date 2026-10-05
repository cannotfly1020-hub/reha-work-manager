// js/excel/diaryWriter.js
// 業務日誌Excel生成層（原本R8.6準拠 / 検印欄 / 時間割撤廃 / セラピスト増員動的対応 / 入外別実績 / 担当別実績 / A4横1枚収容 / 200行制限準拠）

import { THERAPISTS, REHA_RULES } from '../config/rules.js';
import { getDailySchedule } from '../store/scheduleStore.js';
import { getPatientById } from '../store/patientStore.js';

const STYLES = {
  headerNavy: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  },
  headerSub: {
    font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: '1E293B' } },
    fill: { fgColor: { rgb: 'F1F5F9' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellLabel: {
    font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: '334155' } },
    fill: { fgColor: { rgb: 'F8FAFC' } },
    alignment: { vertical: 'center' },
    border: thinBorder()
  },
  cellVal: {
    font: { name: 'Meiryo UI', sz: 7.5 },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder()
  },
  cellCenter: {
    font: { name: 'Meiryo UI', sz: 7.5 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  }
};

function thinBorder() {
  const b = { style: 'thin', color: { rgb: 'CBD5E1' } };
  return { top: b, bottom: b, left: b, right: b };
}

export function generateDiaryWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();
  const { year, month, daysInMonth } = aggregated;

  for (let day = 1; day <= daysInMonth; day++) {
    const ws = {};
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const reiwaYear = year - 2018;

    // 1. タイトル & 日付 & 検印枠（右上）
    setStyledCell(ws, 0, 0, 'リハビリテーション科 業務日誌', {
      font: { name: 'Meiryo UI', sz: 12, bold: true, color: { rgb: '0F172A' } }
    });
    setStyledCell(ws, 1, 0, `令和${reiwaYear}年 ${month}月 ${day}日 (${dayNames[dayOfWeek]})`, {
      font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '334155' } }
    });

    const sealTitles = ['院 長', '事務長', '科 長', '担 当'];
    sealTitles.forEach((title, idx) => {
      const c = 4 + idx;
      setStyledCell(ws, 0, c, title, STYLES.headerSub);
      setStyledCell(ws, 1, c, '', { border: thinBorder(), alignment: { horizontal: 'center', vertical: 'center' } });
    });

    // 2. データ集計（セラピスト増員に自動対応する動的マップ）
    const schedule = getDailySchedule(dateStr);
    const ptStats = {};
    THERAPISTS.forEach((t) => {
      ptStats[t.id] = { name: t.name, units: 0, pSet: new Set() };
    });

    const breakdown = {
      IN: { LOCOMOTIVE: { u: 0, p: new Set() }, CEREBROVASCULAR: { u: 0, p: new Set() }, DISUSE: { u: 0, p: new Set() } },
      OUT: { LOCOMOTIVE: { u: 0, p: new Set() }, CEREBROVASCULAR: { u: 0, p: new Set() }, DISUSE: { u: 0, p: new Set() } }
    };
    let planCount = 0;

    THERAPISTS.forEach((t) => {
      const slots = schedule[t.id] || {};
      Object.values(slots).forEach((item) => {
        if (item?.patientId) {
          const p = getPatientById(item.patientId);
          const u = item.units || 1;
          if (ptStats[t.id]) {
            ptStats[t.id].units += u;
            ptStats[t.id].pSet.add(item.patientId);
          }

          const isInput = p?.category === 'INPATIENT';
          const catKey = isInput ? 'IN' : 'OUT';
          const dKey = p?.diseaseType in breakdown[catKey] ? p.diseaseType : 'LOCOMOTIVE';
          breakdown[catKey][dKey].u += u;
          breakdown[catKey][dKey].p.add(item.patientId);

          if (item.billingPlan) planCount++;
        }
      });
    });

    // 3. 左側上部：勤務状況・出勤確認（セラピスト増員に応じて自動伸縮）
    setStyledCell(ws, 3, 0, '職種 / 担当', STYLES.headerNavy);
    setStyledCell(ws, 3, 1, '出欠・勤務区分', STYLES.headerNavy);
    setStyledCell(ws, 3, 2, '備考', STYLES.headerNavy);

    let curLeftRow = 4;
    THERAPISTS.forEach((t) => {
      const isWorking = ptStats[t.id]?.units > 0;
      setStyledCell(ws, curLeftRow, 0, t.name, STYLES.cellLabel);
      setStyledCell(ws, curLeftRow, 1, isWorking ? '出勤' : '公休 / -', STYLES.cellCenter);
      setStyledCell(ws, curLeftRow, 2, '', STYLES.cellCenter);
      curLeftRow++;
    });

    ['リハビリ助手 1', 'リハビリ助手 2'].forEach((aide) => {
      setStyledCell(ws, curLeftRow, 0, aide, STYLES.cellLabel);
      setStyledCell(ws, curLeftRow, 1, '出勤 [　　]', STYLES.cellCenter);
      setStyledCell(ws, curLeftRow, 2, '', STYLES.cellCenter);
      curLeftRow++;
    });

    // 4. 左側下部：担当セラピスト別実績（増員時も自動展開）
    curLeftRow++;
    setStyledCell(ws, curLeftRow, 0, '担当セラピスト', STYLES.headerNavy);
    setStyledCell(ws, curLeftRow, 1, '実施単位', STYLES.headerNavy);
    setStyledCell(ws, curLeftRow, 2, '実施患者数', STYLES.headerNavy);
    curLeftRow++;

    THERAPISTS.forEach((t) => {
      const stats = ptStats[t.id] || { units: 0, pSet: new Set() };
      setStyledCell(ws, curLeftRow, 0, t.name, STYLES.cellLabel);
      setStyledCell(ws, curLeftRow, 1, `${stats.units} 単位`, STYLES.cellVal);
      setStyledCell(ws, curLeftRow, 2, `${stats.pSet.size} 名`, STYLES.cellVal);
      curLeftRow++;
    });

    // 5. 右側：入院・外来別 実績集計表
    setStyledCell(ws, 3, 4, '区分 / 疾患項目', STYLES.headerNavy);
    setStyledCell(ws, 3, 5, '単位数', STYLES.headerNavy);
    setStyledCell(ws, 3, 6, '実施人数', STYLES.headerNavy);
    setStyledCell(ws, 3, 7, '備考', STYLES.headerNavy);

    const inUnits = breakdown.IN.LOCOMOTIVE.u + breakdown.IN.CEREBROVASCULAR.u + breakdown.IN.DISUSE.u;
    const inPatients = new Set([...breakdown.IN.LOCOMOTIVE.p, ...breakdown.IN.CEREBROVASCULAR.p, ...breakdown.IN.DISUSE.p]).size;
    const outUnits = breakdown.OUT.LOCOMOTIVE.u + breakdown.OUT.CEREBROVASCULAR.u + breakdown.OUT.DISUSE.u;
    const outPatients = new Set([...breakdown.OUT.LOCOMOTIVE.p, ...breakdown.OUT.CEREBROVASCULAR.p, ...breakdown.OUT.DISUSE.p]).size;

    const aPatients = Object.values(schedule.analgesia || {}).flat();
    const aInCount = aPatients.filter((id) => getPatientById(id)?.category === 'INPATIENT').length;
    const aOutCount = aPatients.length - aInCount;

    const summaryGrid = [
      ['【入院】運動器リハ(Ⅱ)', `${breakdown.IN.LOCOMOTIVE.u} 単位`, `${breakdown.IN.LOCOMOTIVE.p.size} 名`, ''],
      ['【入院】脳血管等リハ(Ⅲ)', `${breakdown.IN.CEREBROVASCULAR.u} 単位`, `${breakdown.IN.CEREBROVASCULAR.p.size} 名`, ''],
      ['【入院】廃用症候群(Ⅲ)', `${breakdown.IN.DISUSE.u} 単位`, `${breakdown.IN.DISUSE.p.size} 名`, ''],
      ['【入院】小計', `${inUnits} 単位`, `${inPatients} 名`, ''],
      ['【外来】運動器リハ(Ⅱ)', `${breakdown.OUT.LOCOMOTIVE.u} 単位`, `${breakdown.OUT.LOCOMOTIVE.p.size} 名`, ''],
      ['【外来】脳血管等リハ(Ⅲ)', `${breakdown.OUT.CEREBROVASCULAR.u} 単位`, `${breakdown.OUT.CEREBROVASCULAR.p.size} 名`, ''],
      ['【外来】廃用症候群(Ⅲ)', `${breakdown.OUT.DISUSE.u} 単位`, `${breakdown.OUT.DISUSE.p.size} 名`, ''],
      ['【外来】小計', `${outUnits} 単位`, `${outPatients} 名`, ''],
      ['消炎鎮痛処置 (物療)', `${aPatients.length} 件`, `${aPatients.length} 名`, `入院${aInCount} / 外来${aOutCount}`],
      ['総合計画書策定件数', `${planCount} 件`, '-', ''],
      ['個別リハ 合計実績', `${inUnits + outUnits} 単位`, `${inPatients + outPatients} 名`, '']
    ];

    summaryGrid.forEach((row, idx) => {
      const r = 4 + idx;
      const isSub = row[0].includes('小計') || row[0].includes('合計');
      const styleLbl = isSub ? { ...STYLES.cellLabel, font: { ...STYLES.cellLabel.font, bold: true }, fill: { fgColor: { rgb: 'F1F5F9' } } } : STYLES.cellLabel;
      const styleVal = isSub ? { ...STYLES.cellVal, font: { ...STYLES.cellVal.font, bold: true } } : STYLES.cellVal;
      setStyledCell(ws, r, 4, row[0], styleLbl);
      setStyledCell(ws, r, 5, row[1], styleVal);
      setStyledCell(ws, r, 6, row[2], styleVal);
      setStyledCell(ws, r, 7, row[3], STYLES.cellCenter);
    });

    // 6. 下部：記事・申し送り事項（横幅いっぱいの専用エリア）
    const noteStartRow = Math.max(curLeftRow, 16) + 1;
    setStyledCell(ws, noteStartRow, 0, '記事・申し送り事項', STYLES.headerNavy);
    for (let c = 1; c <= 7; c++) setStyledCell(ws, noteStartRow, c, '', STYLES.headerNavy);

    for (let rOffset = 1; rOffset <= 3; rOffset++) {
      const nr = noteStartRow + rOffset;
      for (let c = 0; c <= 7; c++) {
        setStyledCell(ws, nr, c, '', { border: thinBorder(), fill: { fgColor: { rgb: 'FFFFFF' } } });
      }
    }

    // 7. 列幅設定（時間割撤廃に伴う8列バランス調整）
    setSheetCols(ws, [18, 13, 12, 2, 20, 11, 11, 16]);

    applyA4LandscapePrintSetup(ws);
    updateSheetRange(ws);
    window.XLSX.utils.book_append_sheet(wb, ws, `${day}日`);
  }

  return wb;
}

function applyA4LandscapePrintSetup(ws) {
  ws['!properties'] = { pageSetUpPr: { fitToPage: true } };
  ws['!pageSetup'] = {
    paperSize: 9, // A4
    orientation: 'landscape', // 原本通りの横向き
    fitToWidth: 1, // 横1ページ
    fitToHeight: 1, // 縦1ページ（1日＝1枚完全収容）
    fitToPage: true
  };
  ws['!margins'] = { left: 0.15, right: 0.15, top: 0.25, bottom: 0.25, header: 0.05, footer: 0.05 };
}

function setStyledCell(ws, r, c, val, style = {}) {
  const addr = window.XLSX.utils.encode_cell({ r, c });
  if (val === '' || val === null || val === undefined) {
    ws[addr] = { t: 's', v: '', s: style };
    return;
  }
  const isNum = typeof val === 'number';
  ws[addr] = { t: isNum ? 'n' : 's', v: val, s: style };
}

function setSheetCols(ws, widthList) {
  ws['!cols'] = widthList.map((w) => ({ wch: w }));
}

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
  ws['!ref'] = window.XLSX.utils.encode_range({ r: minR, c: minC }, { r: maxR, c: maxC });
}
