// js/print/printNextWeekBookingSheet.js
// 【翌週予約受付表】専用（翌週以降・紙予約用・A4縦 1枚／週）
// ★複数週選択モーダル＋未来週予約の自動反映
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

const WEEK_PICKER_OPTIONS = Object.freeze([
  { id: 'w1', label: '① 翌週（1週先）', weeksOffsets: [1] },
  { id: 'w2', label: '② 翌々週（2週先）', weeksOffsets: [2] },
  { id: 'w3', label: '③ 3週先', weeksOffsets: [3] },
  { id: 'w4', label: '④ 4週先', weeksOffsets: [4] },
  { id: 'b12', label: '⑤ 【一括】翌週〜翌々週（2週間分・各A4縦1枚）', weeksOffsets: [1, 2] },
  { id: 'b13', label: '⑥ 【一括】翌週〜3週先（3週間分・各A4縦1枚）', weeksOffsets: [1, 2, 3] }
]);

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

function filterReservationsForSlot(weekAptList, dateStr, timeStr, allSlotTimes) {
  return weekAptList.filter((apt) => {
    if (!apt || apt.status === 'CANCELLED') return false;
    if (apt.date !== dateStr) return false;
    const snapped = snapToNearestAppointmentSlot(apt.startTime, allSlotTimes);
    return snapped === timeStr;
  });
}

/**
 * 今週月曜を基準に N 週先の月〜土を返す
 * @param {number} weeksOffset 1=翌週, 2=翌々週 …
 * @returns {Date[]}
 */
function resolveWeekDatesByOffset(weeksOffset) {
  const thisMonday = getMondayOfWeek(new Date());
  thisMonday.setHours(0, 0, 0, 0);
  const monday = new Date(thisMonday);
  monday.setDate(thisMonday.getDate() + (Number(weeksOffset) * 7));
  return getWeekDates(monday);
}

function formatSlashYMD(d) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function formatTargetWeekLabel(weekDates) {
  return `対象週: ${formatSlashYMD(weekDates[0])}(月) 〜 ${formatSlashYMD(weekDates[5])}(土)`;
}

function formatOptionSubLabel(weeksOffsets) {
  return weeksOffsets.map((off) => {
    const wd = resolveWeekDatesByOffset(off);
    return `${formatSlashYMD(wd[0])}〜${formatSlashYMD(wd[5])}`;
  }).join(' ／ ');
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
 * 1週分の表本体 HTML（tbody 行）
 */
function buildWeekBodyRows(weekDates, weekAptList, allSlotTimes, therapists, colorMap, amEnd, pmStart, breakMin) {
  let bodyRows = '';
  let lunchBandInserted = false;

  allSlotTimes.forEach((slotTime) => {
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

    bodyRows += `<tr class="slot-row"><td class="time-col">${slotTime}</td>`;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isSat = d.getDay() === 6;
      const holidayName = getJapaneseHolidayName(d);
      const slotResList = filterReservationsForSlot(weekAptList, dateStr, slotTime, allSlotTimes);

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

  if (!lunchBandInserted) {
    bodyRows += `
      <tr class="lunch-band">
        <td colspan="7">── 昼休憩（${amEnd} 〜 ${pmStart}）──</td>
      </tr>`;
  }
  return bodyRows;
}

/**
 * 1週＝A4縦1枚の page-wrapper
 */
function buildPageWrapperHtml(opts) {
  const {
    weekDates, bodyRows, dayNames, periodLabel, outStamp,
    firstSlot, lastSlot, slotCount, weekAptCount, isLast, weeksOffset
  } = opts;

  return `
    <div class="page-wrapper${isLast ? ' page-wrapper-last' : ''}" data-weeks-offset="${weeksOffset}">
      <div class="page-header">
        <div>
          <div class="title">【翌週予約受付表（紙予約用・A4縦1枚）】</div>
          <div class="period">${sanitizeHtml(periodLabel)}</div>
          <div class="legend">担当色分け ／ <span class="lg-anti">⚡ 消炎鎮痛</span> ／ 白枠＝手書き空き（約9mm）</div>
        </div>
        <div class="meta">出力 ${outStamp}<br>${weeksOffset}週先・1枚完結</div>
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
        <span>週予約 ${weekAptCount} 件</span>
      </div>
    </div>
  `;
}

/**
 * 対象週選択モーダル（コンパクト）
 * @returns {Promise<number[]|null>} weeksOffsets またはキャンセル時 null
 */
export function showNextWeekPrintWeekPicker() {
  return new Promise((resolve) => {
    const existing = document.getElementById('nextWeekPrintPickerOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nextWeekPrintPickerOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '翌週予約受付表の対象週選択');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:10050',
      'background:rgba(15,23,42,0.45)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:16px'
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(420px,100%)', 'background:#fff', 'border-radius:10px',
      'box-shadow:0 20px 40px rgba(15,23,42,0.25)',
      'border:1px solid #cbd5e1', 'overflow:hidden'
    ].join(';');

    const optionsHtml = WEEK_PICKER_OPTIONS.map((opt, i) => {
      const sub = formatOptionSubLabel(opt.weeksOffsets);
      const checked = i === 0 ? 'checked' : '';
      return `
        <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;background:#f8fafc;">
          <input type="radio" name="nextWeekPrintOffset" value="${opt.id}" ${checked} style="margin-top:3px;flex-shrink:0;">
          <span style="min-width:0;">
            <span style="display:block;font-size:0.88rem;font-weight:800;color:#0f172a;line-height:1.3;">${opt.label}</span>
            <span style="display:block;font-size:0.72rem;font-weight:600;color:#64748b;margin-top:2px;">${sub}</span>
          </span>
        </label>
      `;
    }).join('');

    panel.innerHTML = `
      <div style="padding:14px 16px 10px;border-bottom:1px solid #e2e8f0;">
        <div style="font-size:1rem;font-weight:800;color:#0f172a;">翌週予約受付表 — 対象週</div>
        <div style="font-size:0.78rem;color:#64748b;margin-top:4px;font-weight:600;">未来週の予約データは自動で印字されます。空き枠は手書き用の白マスです。</div>
      </div>
      <div style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;max-height:min(58vh,420px);overflow:auto;">
        ${optionsHtml}
      </div>
      <div style="padding:12px 16px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f8fafc;">
        <button type="button" data-act="cancel" style="padding:8px 14px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;font-weight:700;cursor:pointer;color:#475569;">キャンセル</button>
        <button type="button" data-act="ok" style="padding:8px 16px;border-radius:6px;border:1px solid #0f766e;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">印刷プレビュー</button>
      </div>
    `;

    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    panel.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));
    panel.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const selected = panel.querySelector('input[name="nextWeekPrintOffset"]:checked');
      const opt = WEEK_PICKER_OPTIONS.find((o) => o.id === selected?.value) || WEEK_PICKER_OPTIONS[0];
      close([...opt.weeksOffsets]);
    });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    panel.querySelector('[data-act="ok"]')?.focus();
  });
}

/**
 * 翌週予約受付表を印刷
 * @param {Date} [_baseDate] 互換用（オフセットは今週月曜基準）
 * @param {{ weeksOffsets?: number[] }} [options]
 */
export function printNextWeekBookingSheet(_baseDate, options = {}) {
  let weeksOffsets = Array.isArray(options.weeksOffsets) && options.weeksOffsets.length
    ? options.weeksOffsets.map((n) => Number(n)).filter((n) => n >= 1 && n <= 12)
    : [1];
  weeksOffsets = [...new Set(weeksOffsets)].sort((a, b) => a - b);
  if (!weeksOffsets.length) weeksOffsets = [1];

  const allSlotTimes = resolvePrintSlotTimes();
  if (!allSlotTimes.length) {
    showToast('外来予約の時間枠が未設定のため印刷できません（スタッフ設定の外来提供時間を確認）', 'warn');
    return;
  }

  const allAppointments = Object.values(getAllAppointments()).filter((apt) => (
    apt && apt.status !== 'CANCELLED'
  ));
  const therapists = getAllTherapists();
  const colorMap = buildStaffColorMap(therapists);
  const dayNames = ['月', '火', '水', '木', '金', '土'];

  const amEnd = String(OUTPATIENT_HOURS?.amEnd || '13:00');
  const pmStart = String(OUTPATIENT_HOURS?.pmStart || '13:00');
  const breakMin = Math.max(0, timeToMin(pmStart) - timeToMin(amEnd));

  const now = new Date();
  const outStamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const pageMm = 285;
  const headerMm = 11;
  const theadMm = 7.5;
  const footerMm = 4.5;
  const lunchMm = 4;
  const slotCount = allSlotTimes.length;
  const dataAreaMm = pageMm - headerMm - theadMm - footerMm - lunchMm;
  const rowMm = dataAreaMm / Math.max(1, slotCount);
  const firstSlot = allSlotTimes[0];
  const lastSlot = allSlotTimes[slotCount - 1];

  const pagesHtml = weeksOffsets.map((off, idx) => {
    const weekDates = resolveWeekDatesByOffset(off);
    const weekDatesSet = new Set(weekDates.map(formatDateYMD));
    // 未来週の予約を filter で漏れなく抽出
    const weekAptList = allAppointments.filter((apt) => weekDatesSet.has(apt.date));
    const bodyRows = buildWeekBodyRows(
      weekDates, weekAptList, allSlotTimes, therapists, colorMap, amEnd, pmStart, breakMin
    );
    return buildPageWrapperHtml({
      weekDates,
      bodyRows,
      dayNames,
      periodLabel: formatTargetWeekLabel(weekDates),
      outStamp,
      firstSlot,
      lastSlot,
      slotCount,
      weekAptCount: weekAptList.length,
      isLast: idx === weeksOffsets.length - 1,
      weeksOffset: off
    });
  }).join('');

  const titleRange = (() => {
    const first = resolveWeekDatesByOffset(weeksOffsets[0]);
    const last = resolveWeekDatesByOffset(weeksOffsets[weeksOffsets.length - 1]);
    return `${formatSlashYMD(first[0])}〜${formatSlashYMD(last[5])}`;
  })();

  const printWindow = window.open('', '_blank', 'width=900,height=1200');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>外来リハビリ 翌週予約受付表 (${titleRange})</title>
  <style>
    @page { size: A4 portrait; margin: 5mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; background: #fff; color: #0f172a;
      font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo UI", Meiryo, sans-serif;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    body { font-size: 9pt; line-height: 1.15; }
    .page-wrapper {
      width: 100%;
      height: 285mm !important;
      max-height: 285mm !important;
      min-height: 285mm !important;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
    }
    .page-wrapper-last {
      page-break-after: auto;
      break-after: auto;
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
      width: 100%; height: 100%; min-height: 9mm; background: #ffffff;
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
      .page-wrapper {
        height: 285mm !important; max-height: 285mm !important; min-height: 285mm !important;
        overflow: hidden !important; page-break-after: always !important;
      }
      .page-wrapper-last { page-break-after: auto !important; }
      table.paper-table { height: 100% !important; }
      tr.slot-row { height: ${rowMm}mm !important; min-height: 9mm !important; }
    }
  </style>
</head>
<body>
  ${pagesHtml}
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`);
  printWindow.document.close();

  if (weeksOffsets.length > 1) {
    showToast(`${weeksOffsets.length}週分の翌週予約受付表を出力します`, 'info');
  }
}

/**
 * モーダルで週を選んでから印刷（カレンダーボタン用）
 * @param {Date} [baseDate]
 */
export async function openNextWeekBookingSheetPrintFlow(baseDate) {
  const weeksOffsets = await showNextWeekPrintWeekPicker();
  if (!weeksOffsets) return;
  printNextWeekBookingSheet(baseDate || new Date(), { weeksOffsets });
}

/** 旧名称互換 */
export const printWeeklyPaperBookingSheet = printNextWeekBookingSheet;
