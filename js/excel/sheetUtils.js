// js/excel/sheetUtils.js
// 受付提出用Excelの共通スタイルとセル操作

export const SUMMARY_SHEET = 'レセプト収益サマリー';
export const YEARLY_TREND_SHEET = '年間推移 (入外別)';
export const ANALGESIA_SHEET = '実施ﾘｽﾄ 消炎鎮痛';

export const STYLES = {
  headerNavy: {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  },
  headerSat: {
    font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'DBEAFE' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  },
  headerSun: {
    font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '991B1B' } },
    fill: { fgColor: { rgb: 'FEE2E2' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder()
  },
  cellNormal: {
    font: { name: 'Meiryo UI', sz: 9 },
    alignment: { vertical: 'center' },
    border: thinBorder()
  },
  cellCenter: {
    font: { name: 'Meiryo UI', sz: 9 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellRight: {
    font: { name: 'Meiryo UI', sz: 9 },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder()
  },
  cellSubTotal: {
    font: { name: 'Meiryo UI', sz: 9.5, bold: true, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: 'F1F5F9' } },
    border: {
      top: { style: 'thin', color: { rgb: '64748B' } },
      bottom: { style: 'thin', color: { rgb: '64748B' } },
      left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      right: { style: 'thin', color: { rgb: 'CBD5E1' } }
    }
  },
  cellUnit: {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '0F172A' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellEarly1: {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '065F46' } },
    fill: { fgColor: { rgb: 'D1FAE5' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellEarly2: {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'DBEAFE' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellPlanStar: {
    font: { name: 'Meiryo UI', sz: 9, bold: true, color: { rgb: 'B45309' } },
    fill: { fgColor: { rgb: 'FEF3C7' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellZebra: { fgColor: { rgb: 'F8FAFC' } },
  cellSatCol: { fgColor: { rgb: 'EFF6FF' } },
  cellSunCol: { fgColor: { rgb: 'FFF1F2' } }
};

export function thinBorder() {
  const b = { style: 'thin', color: { rgb: 'CBD5E1' } };
  return { top: b, bottom: b, left: b, right: b };
}

export function getDiseaseInitial(type) {
  switch (type) {
    case 'LOCOMOTIVE': return '運';
    case 'CEREBROVASCULAR': return '脳';
    case 'DISUSE': return '廃';
    case 'ANALGESIA': return '消';
    default: return type ? type.slice(0, 1) : '-';
  }
}

export function getEarlyBaseDate(p) {
  return p.earlyBonusStartDate || p.admissionDate || p.onsetDate || '';
}

export function applyA4LandscapePrintSetup(ws, singlePageOnly = false) {
  ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
  ws['!properties'] = { pageSetUpPr: { fitToPage: true } };
  ws['!pageSetup'] = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToWidth: 1, // 横幅は必ず1ページ幅に自動収容
    fitToHeight: singlePageOnly ? 1 : 0, // サマリーは1枚収容、リスト系は縦の自然改ページを許可
    fitToPage: true
  };
  ws['!margins'] = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 };
}

export function setStyledCell(ws, r, c, val, style = {}) {
  const addr = window.XLSX.utils.encode_cell({ r, c });
  if (val === '' || val === null || val === undefined) {
    ws[addr] = { t: 's', v: '', s: style };
    return;
  }
  const isNum = typeof val === 'number';
  ws[addr] = { t: isNum ? 'n' : 's', v: val, s: style };
}

export function setSheetCols(ws, widthList) {
  ws['!cols'] = widthList.map((w) => ({ wch: w }));
}

export function updateSheetRange(ws) {
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

export function appendOrReplaceSheet(wb, ws, name) {
  const existingIdx = wb.SheetNames.indexOf(name);
  if (existingIdx >= 0) wb.Sheets[name] = ws;
  else window.XLSX.utils.book_append_sheet(wb, ws, name);
}
