// js/excel/sheetUtils.js
// 受付提出用Excelの共通スタイルとセル操作
// ★印刷デフォルト: A4横向きを OpenXML へ確実注入（xlsx-js-style は !pageSetup を書き出さないため ZIP 後処理で補強）

export const SUMMARY_SHEET = 'レセプト収益サマリー';
export const YEARLY_TREND_SHEET = '年間推移';
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

/**
 * ワークシートにA4横向き・1ページ幅収容の印刷設定を適用する。
 * ※ xlsx-js-style 0.18.x は OOXML へ orientation / paperSize を書き出さないため、
 *    ここでの !pageSetup 設定に加え、write フックで sheet XML へ pageSetup を注入する。
 * @param {Object} ws - SheetJS ワークシートオブジェクト
 * @param {boolean} [fitHeight=false] - 縦も1ページに収めるか（true=サマリー等、false=リスト系は縦自動改ページ）
 */
export function applyA4LandscapePrintSetup(ws, fitHeight = false) {
  if (!ws) return;

  const fitToHeight = fitHeight ? 1 : 0;

  // 1. ページセットアップの有効化フラグ（fitToPage）
  ws['!sheetPr'] = {
    pageSetUpPr: { fitToPage: true }
  };
  ws['!properties'] = {
    pageSetUpPr: { fitToPage: true }
  };

  // 2. 印刷設定マスター（A4・横向き・fitToWidth=1）
  ws['!pageSetup'] = {
    paperSize: 9,              // 9 = A4
    orientation: 'landscape',  // ★確実にデフォルトを「横向き」に固定
    fitToWidth: 1,             // 横幅は必ず1ページに収める
    fitToHeight: fitToHeight,  // 縦のページ収容指定
    scale: 100,
    fitToPage: true
  };

  // 3. 印刷余白（インチ単位・左右約7.6mmで印字幅確保／A4横 fitToWidth=1 前提）
  ws['!margins'] = {
    left: 0.3,
    right: 0.3,
    top: 0.4,
    bottom: 0.4,
    header: 0.2,
    footer: 0.2
  };

  // 4. ZIP後処理用メタ（シート順で fitHeight を復元）
  ws['!rehaPrintSetup'] = {
    paperSize: 9,
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: fitToHeight,
    fitHeight: !!fitHeight,
    scale: 100
  };

  installXlsxA4LandscapeWriteHook();
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

/**
 * Excel シート名の安全化（禁止文字除去・31文字制限）
 * 禁止: : \ / ? * [ ]
 * @param {string} name
 * @param {string} [fallback='Sheet']
 * @returns {string}
 */
export function sanitizeSheetName(name, fallback = 'Sheet') {
  let s = String(name || fallback)
    .replace(/[:\\/?*[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = fallback;
  // Excel シート名上限 31 文字
  if (s.length > 31) s = s.slice(0, 31);
  // 末尾の単一クォート等は避ける
  s = s.replace(/^'+|'+$/g, '');
  if (!s) s = fallback;
  return s;
}

/**
 * ワークブック内で一意なシート名を返す（重複時は末尾に連番）
 * @param {Object} wb
 * @param {string} desiredName
 * @returns {string}
 */
export function uniqueSheetName(wb, desiredName) {
  const base = sanitizeSheetName(desiredName);
  const names = (wb && Array.isArray(wb.SheetNames)) ? wb.SheetNames : [];
  if (names.indexOf(base) < 0) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `(${n})`;
    const truncated = sanitizeSheetName(
      `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`
    );
    if (names.indexOf(truncated) < 0) return truncated;
  }
  return sanitizeSheetName(`${base.slice(0, 24)}_${Date.now().toString(36).slice(-6)}`);
}

export function appendOrReplaceSheet(wb, ws, name) {
  const safeName = uniqueSheetName(wb, name);
  const existingIdx = wb.SheetNames.indexOf(safeName);
  if (existingIdx >= 0) wb.Sheets[safeName] = ws;
  else window.XLSX.utils.book_append_sheet(wb, ws, safeName);
  if (wb) wb.__rehaForceA4Landscape = true;
  installXlsxA4LandscapeWriteHook();
  return safeName;
}

/* -------------------------------------------------------------------------- */
/*  A4 Landscape ZIP 注入（SheetJS が pageSetup を書かない問題の根本対策）      */
/* -------------------------------------------------------------------------- */

const TEXT_ENC = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
const TEXT_DEC = (typeof TextDecoder !== 'undefined') ? new TextDecoder() : null;

/** @type {Uint32Array|null} */
let CRC_TABLE = null;

function getCrcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(u8) {
  const table = getCrcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i += 1) {
    c = table[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u8FromString(str) {
  if (TEXT_ENC) return TEXT_ENC.encode(str);
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) arr[i] = str.charCodeAt(i) & 0xFF;
  return arr;
}

function stringFromU8(u8) {
  if (TEXT_DEC) return TEXT_DEC.decode(u8);
  let s = '';
  for (let i = 0; i < u8.length; i += 1) s += String.fromCharCode(u8[i]);
  return s;
}

/**
 * worksheet XML に A4 landscape の pageSetup / sheetPr を注入・上書きする
 * @param {string} xml
 * @param {boolean} fitHeight
 * @returns {string}
 */
/**
 * worksheet XML に A4 の pageSetup / sheetPr を注入・上書きする
 * @param {string} xml
 * @param {boolean} [fitHeight=false]
 * @param {'landscape'|'portrait'} [orientation='landscape']
 * @returns {string}
 */
export function injectA4LandscapeIntoSheetXml(xml, fitHeight = false, orientation = 'landscape') {
  if (!xml || typeof xml !== 'string') return xml;
  let out = xml;
  const fitH = fitHeight ? 1 : 0;
  const orient = orientation === 'portrait' ? 'portrait' : 'landscape';
  const pageSetupTag =
    `<pageSetup paperSize="9" orientation="${orient}" fitToWidth="1" fitToHeight="${fitH}" scale="100"/>`;
  // 左右0.3"（約7.6mm）で印字幅確保。横はみ出しは fitToWidth=1 で強制抑制
  const pageMarginsTag =
    '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>';

  // sheetPr / pageSetUpPr（fitToPage）
  if (/<sheetPr\b[^>]*\/>/.test(out)) {
    out = out.replace(/<sheetPr\b[^>]*\/>/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  } else if (/<sheetPr\b[^>]*>/.test(out)) {
    if (!/<pageSetUpPr\b/.test(out)) {
      out = out.replace(/<sheetPr\b[^>]*>/, (m) => `${m}<pageSetUpPr fitToPage="1"/>`);
    } else {
      out = out.replace(/<pageSetUpPr\b[^>]*\/>/, '<pageSetUpPr fitToPage="1"/>');
    }
  } else {
    out = out.replace(/<worksheet\b[^>]*>/, (m) => `${m}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
  }

  // pageMargins（既存置換 or pageSetup 直前へ挿入）
  if (/<pageMargins\b[^>]*\/>/.test(out)) {
    out = out.replace(/<pageMargins\b[^>]*\/>/, pageMarginsTag);
  } else if (/<pageMargins\b[^>]*>[\s\S]*?<\/pageMargins>/.test(out)) {
    out = out.replace(/<pageMargins\b[^>]*>[\s\S]*?<\/pageMargins>/, pageMarginsTag);
  } else if (/<pageSetup\b/.test(out)) {
    out = out.replace(/<pageSetup\b/, `${pageMarginsTag}<pageSetup`);
  }

  // pageSetup（既存があれば置換、なければ pageMargins 直後へ挿入）
  if (/<pageSetup\b[^>]*\/>/.test(out)) {
    out = out.replace(/<pageSetup\b[^>]*\/>/, pageSetupTag);
  } else if (/<pageSetup\b[^>]*>[\s\S]*?<\/pageSetup>/.test(out)) {
    out = out.replace(/<pageSetup\b[^>]*>[\s\S]*?<\/pageSetup>/, pageSetupTag);
  } else if (/<pageMargins\b[^>]*\/>/.test(out)) {
    out = out.replace(/(<pageMargins\b[^>]*\/>)/, `$1${pageSetupTag}`);
  } else if (/<ignoredErrors\b/.test(out)) {
    out = out.replace(/<ignoredErrors\b/, `${pageSetupTag}<ignoredErrors`);
  } else {
    out = out.replace(/<\/worksheet>/, `${pageSetupTag}</worksheet>`);
  }

  return out;
}

/**
 * STORE 方式の ZIP をエントリ配列へ展開する（圧縮エントリは非対応）
 * @param {Uint8Array} buf
 * @returns {{ name: string, data: Uint8Array, method: number }[]}
 */
function parseZipEntries(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries = [];
  let off = 0;
  while (off + 30 <= buf.length) {
    const sig = view.getUint32(off, true);
    if (sig !== 0x04034b50) break;
    const method = view.getUint16(off + 8, true);
    const compSize = view.getUint32(off + 18, true);
    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const nameStart = off + 30;
    const name = stringFromU8(buf.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries.push({ name, data: new Uint8Array(data), method });
    off = dataStart + compSize;
  }
  return entries;
}

/**
 * STORE 方式のみの ZIP を再構築する
 * @param {{ name: string, data: Uint8Array }[]} entries
 * @returns {Uint8Array}
 */
function buildStoreZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameU8 = u8FromString(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameU8.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true);  // flags
    lv.setUint16(8, 0, true);  // method = STORE
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0, true); // date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameU8.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameU8, 30);
    local.set(data, 30 + nameU8.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameU8.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameU8.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameU8, 46);
    centrals.push(central);

    offset += local.length;
  });

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  locals.forEach((chunk) => { out.set(chunk, p); p += chunk.length; });
  centrals.forEach((chunk) => { out.set(chunk, p); p += chunk.length; });
  out.set(end, p);
  return out;
}

/**
 * Content_Types / sheet rels / drawing へ PNG 埋め込みを追加
 * @param {{ name: string, data: Uint8Array, method?: number }[]} entries
 * @param {number} sheetIndex 0始まり（sheet1.xml = 0）
 * @param {{ png: Uint8Array, fromCol: number, fromRow: number, widthPx: number, heightPx: number, name?: string }} image
 */
function injectPngDrawingIntoZipEntries(entries, sheetIndex, image) {
  if (!image?.png?.length) return;
  const sheetNum = sheetIndex + 1;
  const sheetPath = `xl/worksheets/sheet${sheetNum}.xml`;
  const sheetEntry = entries.find((e) => e.name === sheetPath);
  if (!sheetEntry) return;

  // 既存 media / drawing の最大番号
  let maxImg = 0;
  let maxDrw = 0;
  entries.forEach((e) => {
    const im = e.name.match(/^xl\/media\/image(\d+)\./i);
    if (im) maxImg = Math.max(maxImg, parseInt(im[1], 10) || 0);
    const dr = e.name.match(/^xl\/drawings\/drawing(\d+)\.xml$/i);
    if (dr) maxDrw = Math.max(maxDrw, parseInt(dr[1], 10) || 0);
  });
  const imgN = maxImg + 1;
  const drwN = maxDrw + 1;
  const mediaName = `xl/media/image${imgN}.png`;
  const drawingName = `xl/drawings/drawing${drwN}.xml`;
  const drawingRelsName = `xl/drawings/_rels/drawing${drwN}.xml.rels`;
  const sheetRelsName = `xl/worksheets/_rels/sheet${sheetNum}.xml.rels`;

  const cx = Math.round((Number(image.widthPx) || 900) * 9525);
  const cy = Math.round((Number(image.heightPx) || 360) * 9525);
  const col = Math.max(0, Number(image.fromCol) || 0);
  const row = Math.max(0, Number(image.fromRow) || 0);
  const picName = String(image.name || `Chart${imgN}`).replace(/[<>&"']/g, '');

  const drawingXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"`
    + ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<xdr:oneCellAnchor>`
    + `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff>`
    + `<xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
    + `<xdr:ext cx="${cx}" cy="${cy}"/>`
    + `<xdr:pic>`
    + `<xdr:nvPicPr><xdr:cNvPr id="1" name="${picName}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
    + `<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
    + `<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>`
    + `</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;

  const drawingRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1"`
    + ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"`
    + ` Target="../media/image${imgN}.png"/>`
    + `</Relationships>`;

  // sheet rels
  let sheetRelsEntry = entries.find((e) => e.name === sheetRelsName);
  let nextRid = 1;
  let sheetRelsXml = '';
  if (sheetRelsEntry) {
    sheetRelsXml = stringFromU8(sheetRelsEntry.data);
    const ids = [...sheetRelsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1], 10) || 0);
    nextRid = (ids.length ? Math.max(...ids) : 0) + 1;
  } else {
    sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  }
  const drawingRelType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
  const drawingRid = `rId${nextRid}`;
  if (!sheetRelsXml.includes(`Target="../drawings/drawing${drwN}.xml"`)) {
    sheetRelsXml = sheetRelsXml.replace(
      '</Relationships>',
      `<Relationship Id="${drawingRid}" Type="${drawingRelType}" Target="../drawings/drawing${drwN}.xml"/>`
      + '</Relationships>'
    );
  }

  // worksheet に drawing 参照を追加（OOXML順: rowBreaks 等の後・extLst の前）
  let sheetXml = stringFromU8(sheetEntry.data);
  // 名前空間 r が無ければ付与（既存属性は維持）
  if (!/\sxmlns:r=/.test(sheetXml)) {
    sheetXml = sheetXml.replace(
      /<worksheet\b([^>]*?)(\/?)>/,
      (m, attrs, selfClose) => {
        if (selfClose) return m;
        const trimmed = String(attrs || '').replace(/\s*$/, '');
        return `<worksheet${trimmed} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
      }
    );
  }
  if (!/<drawing\b/.test(sheetXml)) {
    const drawingTag = `<drawing r:id="${drawingRid}"/>`;
    if (/<legacyDrawing\b/.test(sheetXml)) {
      sheetXml = sheetXml.replace(/<legacyDrawing\b/, `${drawingTag}<legacyDrawing`);
    } else if (/<picture\b/.test(sheetXml)) {
      sheetXml = sheetXml.replace(/<picture\b/, `${drawingTag}<picture`);
    } else if (/<extLst\b/.test(sheetXml)) {
      sheetXml = sheetXml.replace(/<extLst\b/, `${drawingTag}<extLst`);
    } else if (/<\/worksheet>/.test(sheetXml)) {
      sheetXml = sheetXml.replace(/<\/worksheet>/, `${drawingTag}</worksheet>`);
    }
  }

  // Content_Types
  const ctEntry = entries.find((e) => e.name === '[Content_Types].xml');
  if (ctEntry) {
    let ct = stringFromU8(ctEntry.data);
    if (!/Extension="png"/i.test(ct)) {
      ct = ct.replace(
        '</Types>',
        '<Default Extension="png" ContentType="image/png"/></Types>'
      );
    }
    const drawingOverride =
      `<Override PartName="/xl/drawings/drawing${drwN}.xml"`
      + ` ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
    if (!ct.includes(`/xl/drawings/drawing${drwN}.xml`)) {
      ct = ct.replace('</Types>', `${drawingOverride}</Types>`);
    }
    ctEntry.data = u8FromString(ct);
    ctEntry.method = 0;
  }

  sheetEntry.data = u8FromString(sheetXml);
  sheetEntry.method = 0;

  if (sheetRelsEntry) {
    sheetRelsEntry.data = u8FromString(sheetRelsXml);
    sheetRelsEntry.method = 0;
  } else {
    entries.push({ name: sheetRelsName, data: u8FromString(sheetRelsXml), method: 0 });
  }

  entries.push({ name: mediaName, data: image.png, method: 0 });
  entries.push({ name: drawingName, data: u8FromString(drawingXml), method: 0 });
  entries.push({ name: drawingRelsName, data: u8FromString(drawingRelsXml), method: 0 });
}

/**
 * 生成済み xlsx (Uint8Array) の各シートへ A4 landscape を注入する
 * @param {Uint8Array} u8
 * @param {Object} [wb] - SheetJS workbook（シート毎の fitHeight / 埋め込み画像 参照用）
 * @returns {Uint8Array}
 */
export function patchXlsxUint8ForA4Landscape(u8, wb) {
  if (!u8 || !u8.length) return u8;
  const input = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8);
  const entries = parseZipEntries(input);
  if (!entries.length) return input;

  const sheetFiles = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name))
    .sort((a, b) => {
      const na = parseInt((a.name.match(/sheet(\d+)/i) || [])[1] || '0', 10);
      const nb = parseInt((b.name.match(/sheet(\d+)/i) || [])[1] || '0', 10);
      return na - nb;
    });

  // 圧縮エントリが混在する場合は安全のため無改変で返す（通常は compression:false）
  if (sheetFiles.some((e) => e.method !== 0)) {
    console.warn('[reha] xlsx sheet XML が圧縮されているため横向き注入をスキップしました');
    return input;
  }

  sheetFiles.forEach((entry, idx) => {
    const sheetName = wb && Array.isArray(wb.SheetNames) ? wb.SheetNames[idx] : null;
    const ws = (sheetName && wb.Sheets) ? wb.Sheets[sheetName] : null;
    const printSetup = (ws && ws['!rehaPrintSetup']) ? ws['!rehaPrintSetup'] : {};
    const fitHeight = !!printSetup.fitHeight;
    const orientation = printSetup.orientation === 'portrait' ? 'portrait' : 'landscape';
    let xml = stringFromU8(entry.data);
    xml = injectA4LandscapeIntoSheetXml(xml, fitHeight, orientation);
    // ※ rowBreaks / pageBreak の XML 注入は Excel 修復ダイアログの原因になるため行わない
    entry.data = u8FromString(xml);
    entry.method = 0;

    // 年間推移チャート等の静的PNG埋め込み
    const images = (ws && Array.isArray(ws['!rehaEmbeddedImages'])) ? ws['!rehaEmbeddedImages'] : [];
    images.forEach((img) => {
      try {
        injectPngDrawingIntoZipEntries(entries, idx, img);
      } catch (err) {
        console.warn('[reha] sheet image embed failed:', err);
      }
    });
  });

  // 元エントリ順を維持しつつ追加エントリを末尾へ
  const byName = new Map();
  const order = [];
  entries.forEach((e) => {
    if (!byName.has(e.name)) order.push(e.name);
    byName.set(e.name, e);
  });
  const rebuilt = order.map((name) => byName.get(name));
  return buildStoreZip(rebuilt);
}

function convertWriteOutput(u8, type) {
  const t = type || 'base64';
  if (t === 'array' || t === 'arraybuffer') {
    return t === 'arraybuffer' ? u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) : u8;
  }
  if (t === 'buffer' && typeof Buffer !== 'undefined') {
    return Buffer.from(u8);
  }
  if (t === 'binary' || t === 'string') {
    return stringFromU8(u8);
  }
  // base64 default
  let bin = '';
  for (let i = 0; i < u8.length; i += 1) bin += String.fromCharCode(u8[i]);
  if (typeof btoa === 'function') return btoa(bin);
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  return bin;
}

function downloadXlsxUint8(filename, u8) {
  const blob = new Blob([u8], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * window.XLSX.write / writeFile をフックし、出力 xlsx へ A4横向きを強制注入する
 */
export function installXlsxA4LandscapeWriteHook() {
  if (typeof window === 'undefined' || !window.XLSX) return;
  if (window.XLSX.__rehaA4LandscapeHooked) return;

  const X = window.XLSX;
  const origWrite = typeof X.write === 'function' ? X.write.bind(X) : null;
  const origWriteFile = typeof X.writeFile === 'function' ? X.writeFile.bind(X) : null;
  if (!origWrite) return;

  X.write = function rehaWrite(wb, opts) {
    const o = Object.assign({}, opts || {});
    const bookType = o.bookType || 'xlsx';
    if (bookType !== 'xlsx') {
      return origWrite(wb, opts);
    }
    const wantType = o.type || 'base64';
    const writeOpts = Object.assign({}, o, {
      bookType: 'xlsx',
      type: 'array',
      compression: false
    });
    const raw = origWrite(wb, writeOpts);
    const u8 = patchXlsxUint8ForA4Landscape(
      (raw instanceof Uint8Array) ? raw : new Uint8Array(raw),
      wb
    );
    return convertWriteOutput(u8, wantType);
  };

  if (origWriteFile) {
    X.writeFile = function rehaWriteFile(wb, filename, opts) {
      const o = Object.assign({}, opts || {}, {
        bookType: 'xlsx',
        type: 'array',
        compression: false
      });
      const u8 = X.write(wb, o);
      if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
        downloadXlsxUint8(filename, (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8));
        return u8;
      }
      // Node 等: パッチ済み array を元 API へ渡せないため buffer 経由で再試行
      if (typeof Buffer !== 'undefined' && typeof require === 'function') {
        try {
          const fs = require('fs');
          fs.writeFileSync(filename, Buffer.from(u8));
          return u8;
        } catch (_) { /* fall through */ }
      }
      return origWriteFile(wb, filename, opts);
    };
  }

  X.__rehaA4LandscapeHooked = true;
}

// モジュール読込時点で XLSX が既にあればフック（index.html で vendor → module の順）
installXlsxA4LandscapeWriteHook();
