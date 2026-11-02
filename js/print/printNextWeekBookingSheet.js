// js/print/printNextWeekBookingSheet.js
// 【翌週予約受付表】専用（翌週以降・紙予約用・A4縦 1枚完結）
// ★週間予約受付簿（printWeeklyReceptionBook.js）とは完全独立
// ★画面カレンダー・予約CRUD・DnD・Excel には一切干渉しない

import { formatDateYMD, getWeekDates, getMondayOfWeek } from '../core/dateUtils.js';
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

const STAFF_PALETTE = Object.freeze([
  { bg: '#1d4ed8', border: '#1e40af', fg: '#ffffff' },
  { bg: '#059669', border: '#047857', fg: '#ffffff' },
  { bg: '#7c3aed', border: '#6d28d9', fg: '#ffffff' },
  { bg: '#dc2626', border: '#b91c1c', fg: '#ffffff' },
  { bg: '#0891b2', border: '#0e7490', fg: '#ffffff' },
  { bg: '#c2410c', border: '#9a3412', fg: '#ffffff' },
  { bg: '#4d7c0f', border: '#3f6212', fg: '#ffffff' },
  { bg: '#be185d', border: '#9d174d', fg: '#ffffff' }
]);

const ANALGESIA_COLOR = Object.freeze({
  bg: '#d97706', border: '#b45309', fg: '#ffffff', cardBg: '#fffbeb'
});

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

function timeToMin(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
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
 * 同一日・同一時間の全予約を抽出（.find 禁止・.filter 相当で欠落なし）
 * @param {object[]} weekAptList
 * @param {string} dateStr
 * @param {string} timeStr
 * @param {string[]} allSlotTimes
 * @returns {object[]}
 */
function filterReservationsForSlot(weekAptList, dateStr, timeStr, allSlotTimes) {
  return weekAptList.filter((apt) => {
    if (!apt || apt.status === 'CANCELLED') return false;
    if (apt.date !== dateStr) return false;
    const snapped = snapToNearestAppointmentSlot(apt.startTime, allSlotTimes);
    return snapped === timeStr;
  });
}

function resolveNextWeekOrLater(baseDate) {
  const selectedMonday = getMondayOfWeek(baseDate || new Date());
  const thisMonday = getMondayOfWeek(new Date());
  selectedMonday.setHours(0, 0, 0, 0);
  thisMonday.setHours(0, 0, 0, 0);

  if (selectedMonday.getTime() <= thisMonday.getTime()) {
    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(thisMonday.getDate() + 7);
    return {
      weekDates: getWeekDates(nextMonday),
      bumped: true,
      reason: '選択中の週は今週以前のため、翌週の予約表を出力します'
    };
  }
  return { weekDates: getWeekDates(selectedMonday), bumped: false, reason: '' };
}

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

/**
 * 翌週予約受付表（紙予約用・A4縦1枚完結）
 * @param {Date} baseDate
 */
export function printNextWeekBookingSheet(baseDate) {
  const resolved = resolveNextWeekOrLater(baseDate);
  const weekDates = resolved.weekDates;
  if (resolved.bumped) showToast(resolved.reason, 'info');

  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);
  const allSlotTimes = resolvePrintSlotTimes();

  if (!allSlotTimes.length) {
    showToast('外来予約の時間枠が未設定のため印刷できません（スタッフ設定の外来提供時間を確認）', 'warn');
    return;
  }

  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  // 週内予約を filter で全件抽出（欠落なし）
  const weekAptList = Object.values(getAllAppointments()).filter((apt) => (
    apt && apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date)
  ));

  const therapists = getAllTherapists();
  const colorMap = buildStaffColorMap(therapists);
  const dayNames = ['月', '火', '水', '木', '金', '土'];

  const amEnd = String(OUTPATIENT_HOURS?.amEnd || '13:00');
  const pmStart = String(OUTPATIENT_HOURS?.pmStart || '13:00');
  const breakMin = Math.max(0, timeToMin(pmStart) - timeToMin(amEnd));

  const now = new Date();
  const outStamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const periodLabel = `【翌週以降】${startStr.slice(0, 4)}年${Number(startStr.slice(5, 7))}月${Number(startStr.slice(8, 10))}日(月) 〜 ${endStr.slice(0, 4)}年${Number(endStr.slice(5, 7))}月${Number(endStr.slice(8, 10))}日(土)`;

  // A4縦 1枚完結：高さ 285mm 固定・改ページなし
  const pageMm = 285;
  const headerMm = 11;
  const theadMm = 7.5;
  const footerMm = 4.5;
  const lunchMm = 4;
  const slotCount = allSlotTimes.length;
  const dataAreaMm = pageMm - headerMm - theadMm - footerMm - lunchMm;
  // 1枚に均等分配（空き枠の手書きスペースは CSS で min-height: 9mm）
  const rowMm = dataAreaMm / Math.max(1, slotCount);

  let bodyRows = '';
  let lunchBandInserted = false;

  allSlotTimes.forEach((slotTime) => {
    // 昼休憩：午前終了〜午後開始を全7列結合1行で圧縮
    if (!lunchBandInserted && String(slotTime) >= pmStart) {
      lunchBandInserted = true;
      const breakText = breakMin > 0
        ? `── 昼休憩（${amEnd} 〜 ${pmStart} / ${breakMin}分）──`
        : `── 昼休憩（${amEnd} 〜 ${pmStart}）──`;
      bodyRows += `
        <tr class="lunch-band">
          <td colspan="7">${breakText}</td>
        </tr>`;
    }

    bodyRows += `<tr class="slot-row">`;
    bodyRows += `<td class="time-col">${slotTime}</td>`;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isSat = d.getDay() === 6;
      const holidayName = getJapaneseHolidayName(d);
      // .filter で同一日・同一時間の全予約を取得（.find による切り捨て禁止）
      const slotResList = filterReservationsForSlot(weekAptList, dateStr, slotTime, allSlotTimes);

      let extra = '';
      if (holidayName) extra += ' holiday';
      else if (isSat) extra += ' sat';

      if (slotResList.length === 0) {
        // 空き枠：真っ白な手書き可能スペース（高さ約9mm）
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

  if (!lunchBandInserted) {
    bodyRows += `
      <tr class="lunch-band">
        <td colspan="7">── 昼休憩（${amEnd} 〜 ${pmStart}）──</td>
      </tr>`;
  }

  const firstSlot = allSlotTimes[0];
  const lastSlot = allSlotTimes[slotCount - 1];

  const printWindow = window.open('', '_blank', 'width=900,height=1200');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>外来リハビリ 翌週予約受付表 (${startStr.replace(/-/g, '/')}〜)</title>
  <style>
    @page { size: A4 portrait; margin: 5mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; background: #fff; color: #0f172a;
      font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo UI", Meiryo, sans-serif;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    body {
      font-size: 9pt; line-height: 1.15;
      height: 285mm !important;
      max-height: 285mm !important;
      min-height: 285mm !important;
      display: flex; flex-direction: column; overflow: hidden;
      page-break-after: avoid; page-break-inside: avoid;
    }
    .page-header {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
      border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin-bottom: 2px;
      flex: 0 0 auto; height: ${headerMm}mm; max-height: ${headerMm}mm;
    }
    .title { font-size: 12pt; font-weight: 800; color: #0f172a; }
    .period { font-size: 8.5pt; font-weight: 700; color: #0f766e; margin-top: 1px; }
    .meta { font-size: 7pt; font-weight: 600; color: #94a3b8; text-align: right; }
    .legend { font-size: 7pt; font-weight: 700; color: #475569; margin-top: 1px; }
    .lg-anti { color: #d97706; font-weight: 800; }
    .sheet-wrap { flex: 1 1 auto; min-height: 0; overflow: hidden; }
    table.paper-table {
      width: 100%; height: 100% !important;
      border-collapse: collapse; table-layout: fixed;
    }
    .paper-table th, .paper-table td {
      border: 0.5px solid #cbd5e1; vertical-align: middle;
    }
    .paper-table thead th {
      background: #f8fafc; font-size: 9pt; font-weight: 700; text-align: center;
      height: ${theadMm}mm; max-height: ${theadMm}mm; padding: 1px; color: #334155;
    }
    .paper-table thead th.th-time { width: 9%; color: #64748b; font-size: 8pt; }
    .paper-table thead th .dow { display: block; font-weight: 800; }
    .paper-table thead th .date { display: block; font-size: 8pt; color: #64748b; }
    .paper-table thead th .hol-name { font-size: 6.5pt; color: #e11d48; font-weight: 800; }
    .paper-table thead th.sat { background: #f0f9ff; }
    .paper-table thead th.holiday { background: #fff1f2; }
    tr.lunch-band td {
      height: ${lunchMm}mm; max-height: ${lunchMm}mm;
      background: #f1f5f9; color: #475569; font-size: 8pt; font-weight: 800;
      text-align: center; vertical-align: middle; letter-spacing: 0.06em;
      border: 0.5px solid #cbd5e1;
    }
    tr.slot-row { height: ${rowMm}mm !important; min-height: 9mm; }
    .time-col {
      width: 9%; text-align: center; font-weight: 800; font-size: 9pt;
      background: #f8fafc; color: #475569; height: ${rowMm}mm !important;
      vertical-align: middle !important;
    }
    td.res-slot {
      height: ${rowMm}mm !important; min-height: 9mm; padding: 1px 2px !important;
      vertical-align: middle !important; overflow: hidden;
    }
    .res-slot.sat { background: #fafcff; }
    .res-slot.holiday { background: #fffafa; }
    .empty-slot { background: #ffffff !important; }
    .write-space {
      width: 100%;
      height: 100%;
      min-height: 9mm;
      background: #ffffff;
    }
    .slot-patients-container {
      display: flex; flex-direction: column; justify-content: space-around;
      width: 100%; height: 100%; gap: 1px;
    }
    .patient-card {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 0; padding: 0 2px; border-radius: 2px;
      background: #f8fafc; border: 1px solid #e2e8f0; border-left: 2.5px solid #1d4ed8;
      width: 100%; text-align: center; box-sizing: border-box;
    }
    .patient-card.anti { background: #fffbeb; }
    .patient-card .staff-tag {
      display: inline-block; font-size: 7pt; font-weight: 800;
      padding: 0 3px; border-radius: 2px; line-height: 1.15;
    }
    .patient-card .name-text {
      font-size: 8pt; font-weight: 800; color: #0f172a; line-height: 1.15;
      text-align: center; white-space: normal; overflow: visible; text-overflow: clip;
      word-break: break-word; overflow-wrap: anywhere;
    }
    .slot-patients-container.is-multi .patient-card .name-text { font-size: 7.5pt; }
    .slot-patients-container.is-multi .patient-card .staff-tag { font-size: 6.5pt; }
    .footer {
      display: flex; justify-content: space-between; gap: 8px;
      margin-top: 1mm; padding-top: 1px; border-top: 1px solid #e2e8f0;
      font-size: 7pt; font-weight: 600; color: #94a3b8;
      flex: 0 0 auto; height: ${footerMm}mm; max-height: ${footerMm}mm; overflow: hidden;
    }
    @media print {
      body {
        height: 285mm !important; max-height: 285mm !important; min-height: 285mm !important;
        overflow: hidden !important; page-break-after: avoid !important;
      }
      table.paper-table { height: 100% !important; }
      tr.slot-row { height: ${rowMm}mm !important; min-height: 9mm !important; }
    }
  </style>
</head>
<body>
  <div class="page-header">
    <div>
      <div class="title">【翌週予約受付表（紙予約用・A4縦1枚）】</div>
      <div class="period">${periodLabel}</div>
      <div class="legend">担当色分け ／ <span class="lg-anti">⚡ 消炎鎮痛</span> ／ 白枠＝手書き空き（約9mm）</div>
    </div>
    <div class="meta">出力 ${outStamp}<br>改ページなし・1枚完結</div>
  </div>
  <div class="sheet-wrap">
    <table class="paper-table">
      <thead>
        <tr>
          <th class="th-time">時間</th>
          ${weekDates.map((d, idx) => {
            const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
            const holidayName = getJapaneseHolidayName(d);
            const isSat = d.getDay() === 6;
            let cls = '';
            if (holidayName) cls = 'holiday';
            else if (isSat) cls = 'sat';
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
    <span>${firstSlot}〜${lastSlot}（${slotCount}枠）＋昼休憩1行</span>
    <span>週予約 ${weekAptList.length} 件</span>
  </div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`);
  printWindow.document.close();
}

/** 旧名称互換 */
export const printWeeklyPaperBookingSheet = printNextWeekBookingSheet;
