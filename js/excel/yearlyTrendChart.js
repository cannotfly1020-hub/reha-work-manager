// js/excel/yearlyTrendChart.js
// 年間推移シート埋め込み用トレンドチャート（Canvas描画 → PNG）
// ①請求点数（棒＋折れ線） ②主要3疾患点数（折れ線） ※マクロ不要・静的画像・通年「点数」統一

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
 * 表示サイズで描画し、内部は scale 倍（既定2倍＝920×680 等）で鮮明化。
 * Excel 貼付の ext は表示サイズ（width/height）を返す。
 * @param {number} width 表示幅 px
 * @param {number} height 表示高さ px
 * @param {number} [scale=2]
 * @returns {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number }|null}
 */
function createHiDpiCanvas(width, height, scale = 2) {
  if (typeof document === 'undefined') return null;
  const s = Math.max(1, Number(scale) || 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * s);
  canvas.height = Math.round(height * s);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(s, s);
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

/**
 * null/undefined/NaN は「未集計月」扱い：折れ線を切る（0 へ急降下させない）
 * 実数の 0 は正当なデータとしてプロットする
 */
function isPlottable(v) {
  return v != null && Number.isFinite(Number(v));
}

function drawLineSeries(ctx, values, color, pad, plotH, slot, yMax, markerR = 4) {
  const n = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < n; i += 1) {
    if (!isPlottable(values[i])) {
      started = false;
      continue;
    }
    const v = Number(values[i]) || 0;
    const x = pad.left + i * slot + slot / 2;
    const y = pad.top + plotH - (v / yMax) * plotH;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  for (let i = 0; i < n; i += 1) {
    if (!isPlottable(values[i])) continue;
    const v = Number(values[i]) || 0;
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

function maxPlottable(...series) {
  let m = 0;
  series.forEach((arr) => {
    (arr || []).forEach((v) => {
      if (isPlottable(v)) m = Math.max(m, Number(v) || 0);
    });
  });
  return Math.max(1, m);
}

/**
 * グラフ①: 請求総点数推移（表「請求総点数」行と完全一致）
 * 既定: 棒＋折れ線とも請求総点数のみ（入外線は表に無いため描かない＝10月の急変ズレ防止）
 * @param {{
 *   calendarYear?: number,
 *   fiscalStartYear?: number,
 *   calendarMode?: boolean,
 *   grandPointsByMonth?: (number|null)[],
 *   inpatientPointsByMonth?: (number|null)[],
 *   outpatientPointsByMonth?: (number|null)[],
 *   showInOutLines?: boolean,
 *   width?: number,
 *   height?: number
 * }} opts
 */
export function renderRevenuePointsChartPng(opts) {
  const width = Math.max(400, Number(opts?.width) || 460);
  const height = Math.max(260, Number(opts?.height) || 340);
  const created = createHiDpiCanvas(width, height, Number(opts?.pixelRatio) || 2);
  if (!created) return null;
  const { canvas, ctx } = created;

  const calendarMode = opts?.calendarMode !== false;
  const yearLabel = Number(opts?.calendarYear || opts?.fiscalStartYear) || new Date().getFullYear();
  const MONTH_LABELS = resolveMonthLabels(calendarMode);

  /** 未集計月は null のまま残す（0 埋めしない） */
  const normalizeSeries = (arr) => (arr || []).map((n) => (isPlottable(n) ? Number(n) : null));
  const grand = normalizeSeries(opts?.grandPointsByMonth);
  const inpatient = normalizeSeries(opts?.inpatientPointsByMonth);
  const outpatient = normalizeSeries(opts?.outpatientPointsByMonth);
  const showInOut = opts?.showInOutLines === true
    && (inpatient.some(isPlottable) || outpatient.some(isPlottable));

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
  const yMax = maxPlottable(grand, showInOut ? inpatient : [], showInOut ? outpatient : []) * 1.18;

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 12px "Meiryo UI", "Hiragino Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`【グラフ1】${yearTitle(yearLabel, calendarMode)} 請求点数推移`, pad.left, 22);

  ctx.font = '9.5px "Meiryo UI", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(
    showInOut
      ? '棒＝請求総点数　／　青線＝入院点数　／　緑線＝外来点数'
      : '棒・折れ線＝表「請求総点数」行と同一（未集計月は描画しない）',
    pad.left,
    38
  );

  drawPlotFrame(ctx, pad, plotW, plotH);
  drawYGrid(ctx, pad, plotW, plotH, yMax);

  // 棒: 請求総点数（未集計月は棒なし）
  for (let i = 0; i < n; i += 1) {
    if (!isPlottable(grand[i])) continue;
    const v = Number(grand[i]) || 0;
    const h = (v / yMax) * plotH;
    const x = pad.left + i * slot + (slot - barW) / 2;
    const y = pad.top + plotH - h;
    const grad = ctx.createLinearGradient(0, y, 0, pad.top + plotH);
    grad.addColorStop(0, '#CBD5E1');
    grad.addColorStop(1, '#94A3B8');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, Math.max(0, h));
  }

  // 表同期: 請求総点数の折れ線（棒と同じ系列）
  drawLineSeries(ctx, grand, '#0369A1', pad, plotH, slot, yMax, 3.8);
  if (showInOut) {
    drawLineSeries(ctx, inpatient, '#0284C7', pad, plotH, slot, yMax, 3.8);
    drawLineSeries(ctx, outpatient, '#059669', pad, plotH, slot, yMax, 3.8);
  }
  drawMonthLabels(ctx, pad, plotH, slot, MONTH_LABELS);

  const legendY = height - 16;
  let lx = pad.left;
  ctx.font = '10px "Meiryo UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#94A3B8';
  ctx.fillRect(lx, legendY - 8, 12, 8);
  ctx.strokeStyle = '#0369A1';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(lx, legendY - 4);
  ctx.lineTo(lx + 12, legendY - 4);
  ctx.stroke();
  ctx.fillStyle = '#334155';
  ctx.fillText('請求総点数', lx + 16, legendY);
  lx += 100;

  if (showInOut) {
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
  }

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
 * グラフ②: 主要3疾患 点数推移（入院＋外来合算・通年点数）
 * @param {{
 *   calendarYear?: number,
 *   fiscalStartYear?: number,
 *   calendarMode?: boolean,
 *   metricLabel?: string,
 *   cerebrovascularPoints?: number[],
 *   locomotivePoints?: number[],
 *   disusePoints?: number[],
 *   cerebrovascularUnits?: number[],
 *   locomotiveUnits?: number[],
 *   disuseUnits?: number[],
 *   series?: { label: string, color: string, values: number[] }[],
 *   width?: number,
 *   height?: number
 * }} opts
 */
export function renderDiseaseUnitsChartPng(opts) {
  const width = Math.max(400, Number(opts?.width) || 460);
  const height = Math.max(260, Number(opts?.height) || 340);
  const created = createHiDpiCanvas(width, height, Number(opts?.pixelRatio) || 2);
  if (!created) return null;
  const { canvas, ctx } = created;

  const calendarMode = opts?.calendarMode !== false;
  const yearLabel = Number(opts?.calendarYear || opts?.fiscalStartYear) || new Date().getFullYear();
  const MONTH_LABELS = resolveMonthLabels(calendarMode);
  const metricLabel = String(opts?.metricLabel || '点数');

  /** points 配列を優先し、無ければ units（互換） */
  const pickSeriesValues = (pointsArr, unitsArr) => {
    const p = Array.isArray(pointsArr) ? pointsArr : null;
    const u = Array.isArray(unitsArr) ? unitsArr : null;
    if (p && p.some((n) => Number(n) !== 0)) return p;
    if (u && u.some((n) => Number(n) !== 0)) return u;
    return p || u || [];
  };

  let series = Array.isArray(opts?.series) ? opts.series.filter((s) => s && Array.isArray(s.values)) : [];
  if (!series.length) {
    series = [
      {
        label: '脳血管',
        color: '#2563EB',
        values: pickSeriesValues(opts?.cerebrovascularPoints, opts?.cerebrovascularUnits)
      },
      {
        label: '運動器',
        color: '#EA580C',
        values: pickSeriesValues(opts?.locomotivePoints, opts?.locomotiveUnits)
      },
      {
        label: '廃用症候群',
        color: '#16A34A',
        values: pickSeriesValues(opts?.disusePoints, opts?.disuseUnits)
      }
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
      // 未集計月は null のまま（0 埋め禁止 → 未来月への急降下防止）
      values: (s.values || []).map((n) => (isPlottable(n) ? Number(n) : null))
    };
  });

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
  const slot = plotW / 12;
  const yMax = maxPlottable(...series.map((s) => s.values)) * 1.18;

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 12px "Meiryo UI", "Hiragino Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`【グラフ2】${yearTitle(yearLabel, calendarMode)} 3大疾患 ${metricLabel}推移`, pad.left, 22);

  ctx.font = '9.5px "Meiryo UI", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(`表の運動器・脳血管・廃用と同一　（未集計月は線を切る）`, pad.left, 38);

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
  ctx.fillText(`${metricLabel}（点）`, 0, 0);
  ctx.restore();

  return canvasToResult(canvas, width, height);
}

/**
 * 互換: 旧API名 → 疾患点数グラフ
 * @param {Parameters<typeof renderDiseaseUnitsChartPng>[0]} opts
 */
export function renderYearlyTrendChartPng(opts) {
  return renderDiseaseUnitsChartPng(opts);
}
