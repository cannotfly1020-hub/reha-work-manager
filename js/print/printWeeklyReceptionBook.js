// js/print/printWeeklyReceptionBook.js
// 【週間予約受付簿】専用（午前・午後 A4縦 2枚）— 完全固定版（以後この帳票は改修しない）
// ★画面カレンダー・予約CRUD・DnD・Excel には一切干渉しない

import { formatDateYMD, getWeekDates } from '../core/dateUtils.js';
import { TIME_SLOTS } from '../config/appointmentSlots.js';
import { snapToNearestAppointmentSlot } from '../core/timeSlotUtil.js';
import { generateAppointmentTimeStrings } from '../core/timeSlotGenerator.js';
import { OUTPATIENT_HOURS } from '../config/rules.js';
import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import { getAllAppointments } from '../store/appointmentStore.js';
import { showToast } from '../ui/toast.js';

const DEFAULT_PM_SPLIT = '13:00';

/** 高コントラスト担当色（登録順に割当） */
const STAFF_PALETTE = Object.freeze([
  { bg: '#1d4ed8', border: '#1e40af', fg: '#ffffff' }, // 青
  { bg: '#059669', border: '#047857', fg: '#ffffff' }, // 緑
  { bg: '#7c3aed', border: '#6d28d9', fg: '#ffffff' }, // 紫
  { bg: '#dc2626', border: '#b91c1c', fg: '#ffffff' }, // 赤
  { bg: '#0891b2', border: '#0e7490', fg: '#ffffff' }, // シアン
  { bg: '#c2410c', border: '#9a3412', fg: '#ffffff' }, // 橙
  { bg: '#4d7c0f', border: '#3f6212', fg: '#ffffff' }, // ライム
  { bg: '#be185d', border: '#9d174d', fg: '#ffffff' }  // ピンク
]);

const ANALGESIA_COLOR = Object.freeze({
  bg: '#d97706', border: '#b45309', fg: '#ffffff', cardBg: '#fffbeb'
});

// ─────────────────────────────────────────────
// 共通ユーティリティ
// ─────────────────────────────────────────────

function resolvePrintSlotTimes() {
  const fromHours = generateAppointmentTimeStrings(OUTPATIENT_HOURS || {});
  if (Array.isArray(fromHours) && fromHours.length > 0) {
    return fromHours.map((t) => String(t));
  }
  if (Array.isArray(TIME_SLOTS) && TIME_SLOTS.length > 0) {
    return TIME_SLOTS.map((t) => String(t));
  }
  return [];
}

function formatStaffLabel(therapists, therapistId) {
  if (!therapistId || therapistId === 'NONE') return '指定無';
  if (therapistId === 'ANALGESIA') return '物療';
  const staff = therapists.find((t) => t.id === therapistId);
  return String(staff?.name || therapistId).trim() || String(therapistId);
}

function isAnalgesiaApt(apt, patient) {
  const treatment = String(apt?.treatmentType || '').toUpperCase();
  const therapistId = String(apt?.therapistId || '');
  return treatment === 'ANALGESIA' || therapistId === 'ANALGESIA'
    || String(patient?.diseaseType || '').toUpperCase() === 'ANALGESIA';
}

/**
 * スタッフ設定（getAllTherapists＝登録順）から色マップを構築
 * @param {object[]} therapists
 * @returns {Record<string, { bg: string, border: string, fg: string, cardBg?: string }>}
 */
function buildStaffColorMap(therapists) {
  const map = Object.create(null);
  (therapists || []).forEach((t, idx) => {
    if (!t?.id) return;
    map[t.id] = STAFF_PALETTE[idx % STAFF_PALETTE.length];
  });
  map.NONE = { bg: '#475569', border: '#334155', fg: '#ffffff' };
  map.ANALGESIA = { ...ANALGESIA_COLOR };
  return map;
}

function resolveStaffColor(colorMap, therapistId, anti) {
  if (anti) return ANALGESIA_COLOR;
  const id = String(therapistId || 'NONE');
  return colorMap[id] || colorMap.NONE || STAFF_PALETTE[0];
}

/**
 * 週内予約を date_HH:mm → Appointment[] に全件マップ（filter 相当・欠落なし）
 * @param {object[]} weekAptList
 * @param {string[]} allSlotTimes
 * @returns {Record<string, object[]>}
 */
function buildSlotAptMap(weekAptList, allSlotTimes) {
  const slotAptMap = Object.create(null);
  weekAptList.forEach((apt) => {
    const snapped = snapToNearestAppointmentSlot(apt.startTime, allSlotTimes);
    const k = `${apt.date}_${snapped}`;
    if (!slotAptMap[k]) slotAptMap[k] = [];
    slotAptMap[k].push(apt);
  });
  Object.keys(slotAptMap).forEach((k) => {
    slotAptMap[k].sort((a, b) => {
      const na = String(getPatientById(a.patientId)?.name || a.patientId || '');
      const nb = String(getPatientById(b.patientId)?.name || b.patientId || '');
      if (na !== nb) return na.localeCompare(nb, 'ja');
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  });
  return slotAptMap;
}

function collectWeekAppointments(weekDates) {
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  return Object.values(getAllAppointments()).filter((apt) => (
    apt && apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date)
  ));
}

/**
 * 縦2段カード（上：担当／消炎バッジ、下：フルネーム）— ellipsis 禁止
 * @param {object} apt
 * @param {object[]} therapists
 * @param {Record<string, object>} colorMap
 * @param {'book'|'paper'} mode
 */
function renderPatientCardHtml(apt, therapists, colorMap) {
  const patient = getPatientById(apt.patientId);
  const name = patient?.name || apt.patientId || '';
  const anti = isAnalgesiaApt(apt, patient);
  const staffLabel = formatStaffLabel(therapists, apt.therapistId);
  const color = resolveStaffColor(colorMap, apt.therapistId, anti);
  const badgeText = anti ? '⚡ 消炎鎮痛' : `[${staffLabel}]`;
  const cardCls = anti ? 'patient-card anti' : 'patient-card';
  const cardStyle = anti
    ? `background:${ANALGESIA_COLOR.cardBg};border-color:#fde68a;border-left-color:${ANALGESIA_COLOR.bg};`
    : `border-left-color:${color.border};`;
  const badgeStyle = `background:${color.bg};color:${color.fg};border-color:${color.border};`;

  return `
    <div class="${cardCls}" style="${cardStyle}">
      <div class="staff-tag" style="${badgeStyle}">${sanitizeHtml(badgeText)}</div>
      <div class="name-text">${sanitizeHtml(name)} 様</div>
    </div>
  `;
}

function openPrintWindow(html) {
  const printWindow = window.open('', '_blank', 'width=900,height=1200');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return null;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  return printWindow;
}


// ─────────────────────────────────────────────
// 帳票1：週間予約受付簿（午前・午後 A4縦 2枚）
// ─────────────────────────────────────────────

function computeBookPageMetrics(slotCount) {
  const pageMm = 280;
  const n = Math.max(1, slotCount);
  let rowMm;
  let headerMm;
  let theadMm;
  let footerMm;
  if (n <= 12) {
    rowMm = 20;
    const chrome = pageMm - (rowMm * n);
    headerMm = Math.max(10, Math.round(chrome * 0.42 * 10) / 10);
    theadMm = Math.max(7, Math.round(chrome * 0.28 * 10) / 10);
    footerMm = Math.max(4, Math.round((chrome - headerMm - theadMm) * 10) / 10);
  } else {
    headerMm = 11;
    theadMm = 7;
    footerMm = 4.5;
    rowMm = (pageMm - headerMm - theadMm - footerMm) / n;
  }
  return { pageMm, headerMm, theadMm, footerMm, rowMm };
}

function buildBookBodyRows(pageSlots, weekDates, slotAptMap, therapists, colorMap) {
  let bodyRows = '';
  pageSlots.forEach((slotTime) => {
    bodyRows += `<tr class="slot-row">`;
    bodyRows += `<td class="time-col">${slotTime}</td>`;
    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isSat = d.getDay() === 6;
      const holidayName = getJapaneseHolidayName(d);
      const key = `${dateStr}_${slotTime}`;
      // 同一日・同一時間の全予約を漏れなく取得（filter 相当）
      const slotResList = slotAptMap[key] || [];

      let extra = '';
      if (holidayName) extra += ' holiday';
      else if (isSat) extra += ' sat';

      if (slotResList.length === 0) {
        bodyRows += `
          <td class="res-slot empty-slot${extra}">
            <div class="write-space" aria-hidden="true"></div>
          </td>`;
        return;
      }

      const multi = slotResList.length >= 2 ? ' is-multi' : '';
      const cards = slotResList
        .map((apt) => renderPatientCardHtml(apt, therapists, colorMap))
        .join('');
      bodyRows += `
        <td class="res-slot${extra}">
          <div class="slot-patients-container${multi}">${cards}</div>
        </td>`;
    });
    bodyRows += `</tr>`;
  });
  return bodyRows;
}

function renderBookSheetPage(opts) {
  const {
    pageKey, pageLabel, pageBadgeClass, periodLabel, outStamp,
    pageSlots, weekDates, dayNames, bodyRows, weekAptCount, metrics, isLast
  } = opts;
  const { pageMm, headerMm, theadMm, footerMm, rowMm } = metrics;
  const first = pageSlots[0] || '-';
  const last = pageSlots[pageSlots.length - 1] || '-';

  return `
    <section class="sheet-page ${isLast ? 'sheet-page-last' : ''}" data-page="${sanitizeHtml(pageKey)}">
      <div class="page-header">
        <div class="title-block">
          <div class="title-line">
            <span class="title">外来リハビリ 週間予約受付簿</span>
            <span class="page-badge ${pageBadgeClass}">${sanitizeHtml(pageLabel)}</span>
          </div>
          <div class="period">${periodLabel}</div>
        </div>
        <div class="header-right">
          <div class="legend-chips">
            <span class="chip chip-staff">担当色分け</span>
            <span class="chip chip-analgesia">⚡ 消炎鎮痛</span>
            <span class="chip chip-empty">白枠＝空き</span>
          </div>
          <div class="meta">出力 ${outStamp} ／ A4縦・全2頁</div>
        </div>
      </div>
      <div class="sheet-wrap">
        <table class="hw-table">
          <thead>
            <tr>
              <th class="th-time">時間</th>
              ${weekDates.map((d, idx) => {
                const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
                const holidayName = getJapaneseHolidayName(d);
                const isSat = d.getDay() === 6;
                let cls = 'th-day';
                if (holidayName) cls += ' holiday';
                else if (isSat) cls += ' sat';
                const hol = holidayName
                  ? `<div class="hol-name">${sanitizeHtml(holidayName)}</div>` : '';
                return `<th class="${cls}"><span class="dow">${dayNames[idx]}</span><span class="date">${mmdd}</span>${hol}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <div class="footer">
        <span>${sanitizeHtml(pageLabel)} ${first}〜${last}（${pageSlots.length}枠）</span>
        <span>週予約 ${weekAptCount} 件</span>
      </div>
      <style>
        .sheet-page[data-page="${sanitizeHtml(pageKey)}"] {
          --row-mm: ${rowMm}mm;
          --header-mm: ${headerMm}mm;
          --thead-mm: ${theadMm}mm;
          --footer-mm: ${footerMm}mm;
          --page-mm: ${pageMm}mm;
        }
      </style>
    </section>
  `;
}

const BOOK_SHARED_CSS = `
  @page { size: A4 portrait; margin: 5mm 5mm 4mm 5mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    background: #fff;
    color: #0f172a;
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo UI", Meiryo, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { font-size: 10pt; line-height: 1.2; color: #1e293b; }
  .sheet-page {
    width: 100%;
    height: 280mm !important;
    max-height: 280mm !important;
    min-height: 280mm !important;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .sheet-page-last { page-break-after: auto; break-after: auto; }
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 3px;
    margin-bottom: 3px;
    flex: 0 0 auto;
    height: var(--header-mm, 12mm);
    max-height: var(--header-mm, 12mm);
  }
  .title-block { min-width: 0; flex: 1; }
  .title-line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
  .title { font-size: 13pt; font-weight: 700; color: #0f172a; }
  .page-badge {
    display: inline-flex; align-items: center;
    font-size: 9pt; font-weight: 700; padding: 2px 10px;
    border-radius: 999px; border: 1px solid #cbd5e1;
    background: #f8fafc; color: #334155;
  }
  .page-badge.badge-am { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
  .page-badge.badge-pm { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
  .period { margin-top: 2px; font-size: 8.5pt; font-weight: 600; color: #64748b; }
  .header-right {
    flex-shrink: 0; text-align: right;
    display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
  }
  .legend-chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
  .chip {
    display: inline-flex; align-items: center;
    font-size: 7.5pt; font-weight: 700; padding: 1px 8px;
    border-radius: 999px; border: 1px solid #e2e8f0; background: #fff; color: #475569;
    white-space: nowrap;
  }
  .chip-staff { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
  .chip-analgesia { background: #d97706; color: #fff; border-color: #d97706; }
  .chip-empty { background: #fff; color: #64748b; border-color: #cbd5e1; }
  .meta { font-size: 7pt; font-weight: 600; color: #94a3b8; white-space: nowrap; }
  .sheet-wrap {
    width: 100%; flex: 1 1 auto; flex-grow: 1; min-height: 0;
    display: flex; flex-direction: column; overflow: hidden;
  }
  table.hw-table {
    width: 100%;
    height: 100% !important;
    flex-grow: 1;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .hw-table th, .hw-table td {
    border: 0.5px solid #cbd5e1;
    vertical-align: middle;
  }
  .hw-table thead th {
    background: #f8fafc; font-size: 10pt; font-weight: 700; text-align: center;
    padding: 2px; height: var(--thead-mm, 8mm); max-height: var(--thead-mm, 8mm);
    vertical-align: middle; color: #334155;
  }
  .hw-table thead th.th-time { width: 9.5%; color: #64748b; font-size: 9pt; }
  .hw-table thead th .dow { display: block; font-size: 10pt; font-weight: 700; color: #0f172a; }
  .hw-table thead th .date { display: block; font-size: 9pt; font-weight: 600; color: #64748b; }
  .hw-table thead th .hol-name { font-size: 7pt; font-weight: 700; color: #e11d48; }
  .hw-table thead th.sat { background: #f0f9ff; }
  .hw-table thead th.sat .dow { color: #0369a1; }
  .hw-table thead th.holiday { background: #fff1f2; }
  .hw-table thead th.holiday .dow { color: #e11d48; }
  .hw-table tbody tr.slot-row { height: var(--row-mm, 20mm) !important; }
  .time-col {
    width: 9.5%; text-align: center; font-weight: 800; font-size: 11pt;
    font-variant-numeric: tabular-nums; vertical-align: middle !important;
    background: #f8fafc; color: #334155;
    height: var(--row-mm, 20mm) !important; padding: 0 1mm;
  }
  td.res-slot {
    vertical-align: middle !important; padding: 1.5px 2px !important;
    height: var(--row-mm, 20mm) !important; overflow: hidden;
  }
  .res-slot.sat { background: #fafcff; }
  .res-slot.holiday { background: #fffafa; }
  .empty-slot { background: #ffffff !important; }
  .write-space { width: 100%; height: 100%; min-height: calc(var(--row-mm, 20mm) - 3px); }
  .slot-patients-container {
    display: flex; flex-direction: column; justify-content: space-around;
    align-items: stretch; gap: 1px; width: 100%; height: 100%;
    min-height: calc(var(--row-mm, 20mm) - 3px); box-sizing: border-box;
  }
  .patient-card {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1px; padding: 1px 2px; border-radius: 3px;
    background: #f8fafc; border: 1px solid #cbd5e1; border-left: 3px solid #1d4ed8;
    box-sizing: border-box; width: 100%; text-align: center; flex: 0 1 auto;
  }
  .patient-card.anti { background: #fffbeb; }
  .patient-card .staff-tag {
    display: inline-block; font-size: 8.5pt; font-weight: 800;
    padding: 1px 5px; border-radius: 3px; line-height: 1.2; text-align: center;
  }
  .patient-card .name-text {
    font-size: 10.5pt; font-weight: 800; color: #0f172a; line-height: 1.2;
    letter-spacing: 0.02em; text-align: center;
    white-space: normal; overflow: visible; text-overflow: clip;
    word-break: break-word; overflow-wrap: anywhere;
  }
  .slot-patients-container.is-multi .patient-card { padding: 0 2px; }
  .slot-patients-container.is-multi .patient-card .staff-tag { font-size: 8pt; padding: 0 4px; }
  .slot-patients-container.is-multi .patient-card .name-text { font-size: 10pt; }
  .footer {
    display: flex; justify-content: space-between; gap: 8px;
    margin-top: 1.5mm; padding-top: 2px; border-top: 1px solid #e2e8f0;
    font-size: 7.5pt; font-weight: 600; color: #94a3b8;
    flex: 0 0 auto; height: var(--footer-mm, 5mm); max-height: var(--footer-mm, 5mm);
    overflow: hidden;
  }
  @media print {
    .sheet-page {
      height: 280mm !important; max-height: 280mm !important; min-height: 280mm !important;
      overflow: hidden !important;
    }
    .sheet-page:not(.sheet-page-last) { page-break-after: always !important; }
    table.hw-table {
      height: 100% !important; border-collapse: collapse !important; table-layout: fixed !important;
    }
    .hw-table tbody tr.slot-row { height: var(--row-mm, 20mm) !important; }
  }
`;

/** @deprecated 互換用。新規は printWeeklyReceptionBook を使用 */
export function printHandwritingWeeklySheet(baseDate) {
  return printWeeklyReceptionBook(baseDate);
}

/**
 * 週間予約受付簿（A4縦・午前1枚＋午後1枚）— 完全固定
 * @param {Date} baseDate
 */
export function printWeeklyReceptionBook(baseDate) {
  const weekDates = getWeekDates(baseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);
  const allSlotTimes = resolvePrintSlotTimes();

  if (!allSlotTimes.length) {
    showToast('外来予約の時間枠が未設定のため印刷できません', 'warn');
    return;
  }

  const amEndSetting = String(OUTPATIENT_HOURS?.amEnd || DEFAULT_PM_SPLIT);
  const pmSplit = String(OUTPATIENT_HOURS?.pmStart || DEFAULT_PM_SPLIT);
  const amSlots = allSlotTimes.filter((t) => String(t) < pmSplit);
  const pmSlots = allSlotTimes.filter((t) => String(t) >= pmSplit);

  if (!amSlots.length && !pmSlots.length) {
    showToast('印刷可能な時間枠がありません（スタッフ設定の外来提供時間を確認してください）', 'warn');
    return;
  }

  const weekAptList = collectWeekAppointments(weekDates);
  const slotAptMap = buildSlotAptMap(weekAptList, allSlotTimes);
  const therapists = getAllTherapists();
  const colorMap = buildStaffColorMap(therapists);
  const dayNames = ['月', '火', '水', '木', '金', '土'];
  const now = new Date();
  const outStamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const periodLabel = `${startStr.slice(0, 4)}年${Number(startStr.slice(5, 7))}月${Number(startStr.slice(8, 10))}日(月) 〜 ${endStr.slice(0, 4)}年${Number(endStr.slice(5, 7))}月${Number(endStr.slice(8, 10))}日(土)`;

  const pages = [];
  if (amSlots.length) {
    const metrics = computeBookPageMetrics(amSlots.length);
    pages.push({
      pageKey: 'am',
      pageLabel: `午前（${amSlots[0] || '09:00'}〜${amEndSetting}）`,
      pageBadgeClass: 'badge-am',
      pageSlots: amSlots,
      bodyRows: buildBookBodyRows(amSlots, weekDates, slotAptMap, therapists, colorMap),
      metrics
    });
  }
  if (pmSlots.length) {
    const metrics = computeBookPageMetrics(pmSlots.length);
    const pmLast = pmSlots[pmSlots.length - 1] || String(OUTPATIENT_HOURS?.pmEnd || '18:00');
    pages.push({
      pageKey: 'pm',
      pageLabel: `午後（${pmSplit}〜${pmLast}）`,
      pageBadgeClass: 'badge-pm',
      pageSlots: pmSlots,
      bodyRows: buildBookBodyRows(pmSlots, weekDates, slotAptMap, therapists, colorMap),
      metrics
    });
  }

  const pagesHtml = pages.map((p, idx) => renderBookSheetPage({
    ...p,
    periodLabel,
    outStamp,
    weekDates,
    dayNames,
    weekAptCount: weekAptList.length,
    isLast: idx === pages.length - 1
  })).join('');

  openPrintWindow(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>外来リハビリ 週間予約受付簿 午前・午後 (${startStr.replace(/-/g, '/')}〜)</title>
  <style>${BOOK_SHARED_CSS}</style>
</head>
<body>
  ${pagesHtml}
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`);
}


