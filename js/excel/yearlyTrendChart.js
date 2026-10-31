// js/excel/yearlyTrendChart.js
// 年間推移シート埋め込み用トレンドチャート（Canvas描画 → PNG）
// ①請求点数（棒＋折れ線） ②主要3疾患単位（折れ線） ※マクロ不要・静的画像

/** 暦年 1〜12月 */
const MONTH_LABELS_CALENDAR = Object.freeze([
  '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'
]);

const MONTH_LABELS_FISCAL = Object.freeze([
  '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'
]);

/**
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
 * @param {number} width
 * @param {number} height
 * @returns {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number }|null}
 */
function createHiDpiCanvas(width, height) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  return { canvas, ctx, width, height };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} width
 * @param {number} height
 */
function canvasToResult(canvas, width, height) {
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

function resolveMonthLabels(calendarMode) {
  return calendarMode !== false ? MONTH_LABELS_CALENDAR : MONTH_LABELS_FISCAL;
}

function yearTitle(yearLabel, calendarMode) {
  return calendarMode !== false ? `${yearLabel}年` : `${yearLabel}年度`;
}

function drawPlotFrame(ctx, pad, plotW, plotH) {
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);
}

function drawYGrid(ctx, pad, plotW, plotH, yMax, gridLines = 4) {
  ctx.font = '10px "Meiryo UI", sans-serif';
  ctx.textAlign = 'right';
  for (let g = 0; g <= gridLines; g += 1) {
    const t = g / gridLines;
    const y = pad.top + plotH - t * plotH;
    ctx.strokeStyle = '#F1F5F9';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#64748B';
    ctx.fillText(Math.round(yMax * t).toLocaleString('ja-JP'), pad.left - 8, y + 3);
  }
}

function drawMonthLabels(ctx, pad, plotH, slot, labels) {
  ctx.fillStyle = '#475569';
  ctx.font = '11px "Meiryo UI", sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < 12; i += 1) {
    const x = pad.left + i * slot + slot / 2;
    ctx.fillText(labels[i], x, pad.top + plotH + 18);
  }
}

function drawLineSeries(ctx, values, color, pad, plotH, slot, yMax, markerR = 4) {
  const n = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const v = values[i] || 0;
    const x = pad.left + i * slot + slot / 2;
    const y = pad.top + plotH - (v / yMax) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  for (let i = 0; i < n; i += 1) {
    const v = values[i] || 0;
    const x = pad.left + i * slot + slot / 2;
    const y = pad.top + plotH - (v / yMax) * plotH;
    ctx.beginPath();
    ctx.fillStyle = '#FFFFFF';
    ctx.arc(x, y, markerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, markerR * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * グラフ①: 月別請求点数・収益推移（棒＝総点数／折線＝入院・外来）
 * @param {{
 *   calendarYear?: number,
 *   fiscalStartYear?: number,
 *   calendarMode?: boolean,
 *   grandPointsByMonth?: number[],
 *   inpatientPointsByMonth?: number[],
 *   outpatientPointsByMonth?: number[],
 *   width?: number,
 *   height?: number
 * }} opts
 */
export function renderRevenuePointsChartPng(opts) {
  const width = Math.max(400, Number(opts?.width) || 450);
  const height = Math.max(260, Number(opts?.height) || 320);
  const created = createHiDpiCanvas(width, height);
  if (!created) return null;
  const { canvas, ctx } = created;

  const calendarMode = opts?.calendarMode !== false;
  const yearLabel = Number(opts?.calendarYear || opts?.fiscalStartYear) || new Date().getFullYear();
  const MONTH_LABELS = resolveMonthLabels(calendarMode);

  const grand = (opts?.grandPointsByMonth || []).map((n) => Number(n) || 0);
  const inpatient = (opts?.inpatientPointsByMonth || []).map((n) => Number(n) || 0);
  const outpatient = (opts?.outpatientPointsByMonth || []).map((n) => Number(n) || 0);

  // カード背景
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.fillRect(4, 4, width - 8, height - 8);
  ctx.strokeRect(4.5, 4.5, width - 9, height - 9);

  const pad = { top: 50, right: 14, bottom: 54, left: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = 12;
  const slot = plotW / n;
  const barW = Math.max(10, slot * 0.58);
  const yMax = Math.max(1, ...grand, ...inpatient, ...outpatient) * 1.18;

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 12px "Meiryo UI", "Hiragino Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`【グラフ1】${yearTitle(yearLabel, calendarMode)} 請求点数推移`, pad.left, 22);

  ctx.font = '9.5px "Meiryo UI", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('棒＝請求総点数　／　青線＝入院点数　／　緑線＝外来点数', pad.left, 38);

  drawPlotFrame(ctx, pad, plotW, plotH);
  drawYGrid(ctx, pad, plotW, plotH, yMax);

  // 棒: 請求総点数（グレー〜ライトブルー）
  for (let i = 0; i < n; i += 1) {
    const v = grand[i] || 0;
    const h = (v / yMax) * plotH;
    const x = pad.left + i * slot + (slot - barW) / 2;
    const y = pad.top + plotH - h;
    const grad = ctx.createLinearGradient(0, y, 0, pad.top + plotH);
    grad.addColorStop(0, '#CBD5E1');
    grad.addColorStop(1, '#94A3B8');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, Math.max(0, h));
  }

  drawLineSeries(ctx, inpatient, '#0284C7', pad, plotH, slot, yMax, 3.8);
  drawLineSeries(ctx, outpatient, '#059669', pad, plotH, slot, yMax, 3.8);
  drawMonthLabels(ctx, pad, plotH, slot, MONTH_LABELS);

  const legendY = height - 16;
  let lx = pad.left;
  ctx.font = '10px "Meiryo UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#94A3B8';
  ctx.fillRect(lx, legendY - 8, 12, 8);
  ctx.fillStyle = '#334155';
  ctx.fillText('請求総点数', lx + 16, legendY);
  lx += 90;

  [
    { color: '#0284C7', label: '入院点数' },
    { color: '#059669', label: '外来点数' }
  ].forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(lx, legendY - 4);
    ctx.lineTo(lx + 18, legendY - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = s.color;
    ctx.arc(lx + 9, legendY - 4, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.fillText(s.label, lx + 24, legendY);
    lx += 82;
  });

  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 10px "Meiryo UI", sans-serif';
  ctx.fillText('請求点数（点）', 0, 0);
  ctx.restore();

  return canvasToResult(canvas, width, height);
}

/**
 * グラフ②: 主要3疾患 実施単位推移（入院＋外来合算）
 * @param {{
 *   calendarYear?: number,
 *   fiscalStartYear?: number,
 *   calendarMode?: boolean,
 *   cerebrovascularUnits?: number[],
 *   locomotiveUnits?: number[],
 *   disuseUnits?: number[],
 *   series?: { label: string, color: string, values: number[] }[],
 *   width?: number,
 *   height?: number
 * }} opts
 */
export function renderDiseaseUnitsChartPng(opts) {
  const width = Math.max(400, Number(opts?.width) || 450);
  const height = Math.max(260, Number(opts?.height) || 320);
  const created = createHiDpiCanvas(width, height);
  if (!created) return null;
  const { canvas, ctx } = created;

  const calendarMode = opts?.calendarMode !== false;
  const yearLabel = Number(opts?.calendarYear || opts?.fiscalStartYear) || new Date().getFullYear();
  const MONTH_LABELS = resolveMonthLabels(calendarMode);

  let series = Array.isArray(opts?.series) ? opts.series.filter((s) => s && Array.isArray(s.values)) : [];
  if (!series.length) {
    series = [
      { label: '脳血管', color: '#2563EB', values: opts?.cerebrovascularUnits || [] },
      { label: '運動器', color: '#EA580C', values: opts?.locomotiveUnits || [] },
      { label: '廃用症候群', color: '#16A34A', values: opts?.disuseUnits || [] }
    ];
  }
  series = series.map((s, idx) => {
    const defaults = [
      { label: '脳血管', color: '#2563EB' },
      { label: '運動器', color: '#EA580C' },
      { label: '廃用症候群', color: '#16A34A' }
    ];
    return {
      label: String(s.label || defaults[idx]?.label || `系列${idx + 1}`),
      color: String(s.color || defaults[idx]?.color || '#334155'),
      values: (s.values || []).map((n) => Number(n) || 0)
    };
  });

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.fillRect(4, 4, width - 8, height - 8);
  ctx.strokeRect(4.5, 4.5, width - 9, height - 9);

  const pad = { top: 50, right: 14, bottom: 54, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / 12;
  const allVals = series.flatMap((s) => s.values.slice(0, 12));
  const yMax = Math.max(1, ...allVals, 1) * 1.18;

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 12px "Meiryo UI", "Hiragino Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`【グラフ2】${yearTitle(yearLabel, calendarMode)} 3大疾患 単位推移`, pad.left, 22);

  ctx.font = '9.5px "Meiryo UI", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('青＝脳血管　橙＝運動器　緑＝廃用　（いずれも入院＋外来合算単位）', pad.left, 38);

  drawPlotFrame(ctx, pad, plotW, plotH);
  drawYGrid(ctx, pad, plotW, plotH, yMax);
  series.forEach((s) => drawLineSeries(ctx, s.values, s.color, pad, plotH, slot, yMax, 3.8));
  drawMonthLabels(ctx, pad, plotH, slot, MONTH_LABELS);

  const legendY = height - 16;
  let lx = pad.left;
  ctx.font = '10px "Meiryo UI", sans-serif';
  ctx.textAlign = 'left';
  series.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(lx, legendY - 4);
    ctx.lineTo(lx + 18, legendY - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = s.color;
    ctx.arc(lx + 9, legendY - 4, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.fillText(s.label, lx + 24, legendY);
    lx += 98;
  });

  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 10px "Meiryo UI", sans-serif';
  ctx.fillText('実施単位数', 0, 0);
  ctx.restore();

  return canvasToResult(canvas, width, height);
}

/**
 * 互換: 旧API名 → 疾患単位グラフ
 * @param {Parameters<typeof renderDiseaseUnitsChartPng>[0]} opts
 */
export function renderYearlyTrendChartPng(opts) {
  return renderDiseaseUnitsChartPng(opts);
}
