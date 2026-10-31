// js/excel/yearlyTrendChart.js
// 年間推移シート埋め込み用トレンドチャート（Canvas描画 → PNG）
// 主要疾患（入院＋外来合算）単位数の月次推移 ※マクロ不要・静的画像

/** 暦年 1〜12月（デフォルト） */
const MONTH_LABELS_CALENDAR = Object.freeze([
  '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'
]);

/** 旧・診療報酬年度（4月始まり）互換 */
const MONTH_LABELS_FISCAL = Object.freeze([
  '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'
]);

const DEFAULT_DISEASE_SERIES = Object.freeze([
  { key: 'cerebrovascular', label: '脳血管', color: '#2563EB' },
  { key: 'locomotive', label: '運動器', color: '#EA580C' },
  { key: 'disuse', label: '廃用症候群', color: '#16A34A' }
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
 * 主要疾患（入院＋外来合算）単位数の折れ線チャートを描画
 * @param {{
 *   fiscalStartYear?: number,
 *   calendarYear?: number,
 *   calendarMode?: boolean,
 *   series?: { label: string, color: string, values: number[] }[],
 *   cerebrovascularUnits?: number[],
 *   locomotiveUnits?: number[],
 *   disuseUnits?: number[],
 *   width?: number,
 *   height?: number
 * }} opts
 * @returns {{ png: Uint8Array, widthPx: number, heightPx: number, dataUrl: string }|null}
 */
export function renderYearlyTrendChartPng(opts) {
  if (typeof document === 'undefined') return null;
  const width = Math.max(720, Number(opts?.width) || 960);
  const height = Math.max(320, Number(opts?.height) || 420);
  const calendarMode = opts?.calendarMode !== false;
  const yearLabel = Number(opts?.calendarYear || opts?.fiscalStartYear) || new Date().getFullYear();
  const MONTH_LABELS = calendarMode ? MONTH_LABELS_CALENDAR : MONTH_LABELS_FISCAL;

  let series = Array.isArray(opts?.series) ? opts.series.filter((s) => s && Array.isArray(s.values)) : [];
  if (!series.length) {
    series = [
      {
        label: DEFAULT_DISEASE_SERIES[0].label,
        color: DEFAULT_DISEASE_SERIES[0].color,
        values: Array.isArray(opts?.cerebrovascularUnits) ? opts.cerebrovascularUnits : []
      },
      {
        label: DEFAULT_DISEASE_SERIES[1].label,
        color: DEFAULT_DISEASE_SERIES[1].color,
        values: Array.isArray(opts?.locomotiveUnits) ? opts.locomotiveUnits : []
      },
      {
        label: DEFAULT_DISEASE_SERIES[2].label,
        color: DEFAULT_DISEASE_SERIES[2].color,
        values: Array.isArray(opts?.disuseUnits) ? opts.disuseUnits : []
      }
    ];
  }
  series = series.map((s, idx) => ({
    label: String(s.label || DEFAULT_DISEASE_SERIES[idx]?.label || `系列${idx + 1}`),
    color: String(s.color || DEFAULT_DISEASE_SERIES[idx]?.color || '#334155'),
    values: (s.values || []).map((n) => Number(n) || 0)
  }));

  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  const pad = { top: 52, right: 28, bottom: 56, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = 12;
  const slot = plotW / n;

  const allVals = series.flatMap((s) => s.values.slice(0, n));
  const maxVal = Math.max(1, ...allVals, 1);
  const yMax = maxVal * 1.18;

  const titleYear = calendarMode ? `${yearLabel}年` : `${yearLabel}年度`;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 16px "Meiryo UI", "Hiragino Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${titleYear} 主要疾患別 単位数推移（入院＋外来合算）`, pad.left, 24);

  ctx.font = '11px "Meiryo UI", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('脳血管／運動器／廃用症候群　※静的画像・マクロ不要', pad.left, 42);

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);

  const gridLines = 4;
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

  // 折れ線＋マーカー
  series.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.75;
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const v = s.values[i] || 0;
      const x = pad.left + i * slot + slot / 2;
      const y = pad.top + plotH - (v / yMax) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    for (let i = 0; i < n; i += 1) {
      const v = s.values[i] || 0;
      const x = pad.left + i * slot + slot / 2;
      const y = pad.top + plotH - (v / yMax) * plotH;
      ctx.beginPath();
      ctx.fillStyle = '#FFFFFF';
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = s.color;
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ctx.fillStyle = '#475569';
  ctx.font = '11px "Meiryo UI", sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i += 1) {
    const x = pad.left + i * slot + slot / 2;
    ctx.fillText(MONTH_LABELS[i], x, pad.top + plotH + 20);
  }

  // 凡例
  const legendY = height - 16;
  let legendX = pad.left;
  ctx.font = '12px "Meiryo UI", sans-serif';
  ctx.textAlign = 'left';
  series.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(legendX, legendY - 4);
    ctx.lineTo(legendX + 22, legendY - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = s.color;
    ctx.arc(legendX + 11, legendY - 4, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.fillText(s.label, legendX + 28, legendY);
    legendX += 120;
  });

  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 11px "Meiryo UI", sans-serif';
  ctx.fillText('単位数（入院＋外来）', 0, 0);
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
