// js/excel/yearlyTrendChart.js
// 年間推移シート埋め込み用コンボチャート（Canvas描画 → PNG）
// 棒: 請求総点数 / 折れ線: 総単位数 ※マクロ不要・静的画像

/** 暦年 1〜12月（デフォルト） */
const MONTH_LABELS_CALENDAR = Object.freeze([
  '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'
]);

/** 旧・診療報酬年度（4月始まり）互換 */
const MONTH_LABELS_FISCAL = Object.freeze([
  '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'
]);

/**
 * dataURL (PNG) → Uint8Array
 * @param {string} dataUrl
 * @returns {Uint8Array|null}
 */
export function pngDataUrlToUint8(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1);
  try {
    const bin = typeof atob === 'function' ? atob(b64) : '';
    if (!bin) return null;
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
    return u8;
  } catch (_) {
    return null;
  }
}

/**
 * コンボチャートをオフスクリーンCanvasへ描画し PNG Uint8Array を返す
 * @param {{
 *   fiscalStartYear?: number,
 *   calendarYear?: number,
 *   calendarMode?: boolean,
 *   pointsByMonth: number[],
 *   unitsByMonth: number[],
 *   width?: number,
 *   height?: number
 * }} opts
 * @returns {{ png: Uint8Array, widthPx: number, heightPx: number, dataUrl: string }|null}
 */
export function renderYearlyTrendChartPng(opts) {
  if (typeof document === 'undefined') return null;
  const width = Math.max(640, Number(opts?.width) || 900);
  const height = Math.max(280, Number(opts?.height) || 360);
  const points = Array.isArray(opts?.pointsByMonth) ? opts.pointsByMonth.map((n) => Number(n) || 0) : [];
  const units = Array.isArray(opts?.unitsByMonth) ? opts.unitsByMonth.map((n) => Number(n) || 0) : [];
  const calendarMode = opts?.calendarMode !== false;
  const yearLabel = Number(opts?.calendarYear || opts?.fiscalStartYear) || new Date().getFullYear();
  const MONTH_LABELS = calendarMode ? MONTH_LABELS_CALENDAR : MONTH_LABELS_FISCAL;

  const canvas = document.createElement('canvas');
  // HiDPI
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  const pad = { top: 48, right: 56, bottom: 52, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = 12;
  const gap = 8;
  const barSlot = plotW / n;
  const barW = Math.max(10, barSlot - gap);

  const maxPts = Math.max(1, ...points, 1);
  const maxUnits = Math.max(1, ...units, 1);
  // 上端に余白
  const yMaxPts = maxPts * 1.15;
  const yMaxUnits = maxUnits * 1.15;

  // タイトル
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 15px "Meiryo UI", "Hiragino Sans", sans-serif';
  ctx.textAlign = 'left';
  const titleYear = calendarMode ? `${yearLabel}年` : `${yearLabel}年度`;
  ctx.fillText(`${titleYear} リハビリ科 月次推移（請求総点数 × 総単位数）`, pad.left, 24);

  ctx.font = '11px "Meiryo UI", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('棒＝請求総点数（左軸）／ 折れ線＝総単位数（右軸）　※静的画像・マクロ不要', pad.left, 40);

  // 枠
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);

  // 横グリッド + 左軸目盛（点数）
  ctx.font = '10px "Meiryo UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94A3B8';
  const gridLines = 4;
  for (let g = 0; g <= gridLines; g += 1) {
    const t = g / gridLines;
    const y = pad.top + plotH - t * plotH;
    ctx.strokeStyle = '#F1F5F9';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    const label = Math.round(yMaxPts * t);
    ctx.fillStyle = '#0369A1';
    ctx.fillText(label.toLocaleString('ja-JP'), pad.left - 8, y + 3);
  }

  // 右軸目盛（単位）
  ctx.textAlign = 'left';
  for (let g = 0; g <= gridLines; g += 1) {
    const t = g / gridLines;
    const y = pad.top + plotH - t * plotH;
    const label = Math.round(yMaxUnits * t);
    ctx.fillStyle = '#B45309';
    ctx.fillText(label.toLocaleString('ja-JP'), pad.left + plotW + 8, y + 3);
  }

  // 棒グラフ（点数）
  for (let i = 0; i < n; i += 1) {
    const v = points[i] || 0;
    const h = (v / yMaxPts) * plotH;
    const x = pad.left + i * barSlot + (barSlot - barW) / 2;
    const y = pad.top + plotH - h;
    const grad = ctx.createLinearGradient(0, y, 0, pad.top + plotH);
    grad.addColorStop(0, '#38BDF8');
    grad.addColorStop(1, '#0284C7');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, h);
  }

  // 折れ線（単位）
  ctx.strokeStyle = '#EA580C';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const v = units[i] || 0;
    const x = pad.left + i * barSlot + barSlot / 2;
    const y = pad.top + plotH - (v / yMaxUnits) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 折れ線マーカー
  for (let i = 0; i < n; i += 1) {
    const v = units[i] || 0;
    const x = pad.left + i * barSlot + barSlot / 2;
    const y = pad.top + plotH - (v / yMaxUnits) * plotH;
    ctx.beginPath();
    ctx.fillStyle = '#FFFFFF';
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#EA580C';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // X軸ラベル
  ctx.fillStyle = '#475569';
  ctx.font = '11px "Meiryo UI", sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i += 1) {
    const x = pad.left + i * barSlot + barSlot / 2;
    ctx.fillText(MONTH_LABELS[i], x, pad.top + plotH + 18);
  }

  // 凡例
  const legendY = height - 16;
  ctx.fillStyle = '#0284C7';
  ctx.fillRect(pad.left, legendY - 8, 14, 8);
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'left';
  ctx.font = '11px "Meiryo UI", sans-serif';
  ctx.fillText('請求総点数', pad.left + 20, legendY);

  ctx.strokeStyle = '#EA580C';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(pad.left + 110, legendY - 4);
  ctx.lineTo(pad.left + 130, legendY - 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pad.left + 120, legendY - 4, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#EA580C';
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.fillText('総単位数', pad.left + 138, legendY);

  // 軸タイトル
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0369A1';
  ctx.font = 'bold 10px "Meiryo UI", sans-serif';
  ctx.fillText('請求総点数', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(width - 14, pad.top + plotH / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#C2410C';
  ctx.font = 'bold 10px "Meiryo UI", sans-serif';
  ctx.fillText('総単位数', 0, 0);
  ctx.restore();

  let dataUrl = '';
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (_) {
    return null;
  }
  const png = pngDataUrlToUint8(dataUrl);
  if (!png) return null;
  return { png, widthPx: width, heightPx: height, dataUrl };
}
