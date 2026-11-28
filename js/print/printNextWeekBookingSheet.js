// js/print/printNextWeekBookingSheet.js
// 【翌週予約受付表】専用（翌週以降・紙予約用・A4縦 1枚／週）
// ★ weeksOffset で対象週を完全切替／プレビュー内で週めくり確認
// ★週間予約受付簿（printWeeklyReceptionBook.js）とは完全独立

import { formatDateYMD, getWeekDates, getMondayOfWeek } from '../core/dateUtils.js';
import { TIME_SLOTS } from '../config/appointmentSlots.js';
import { snapToFloorAppointmentSlot } from '../core/timeSlotUtil.js';
import { generateAppointmentTimeStrings } from '../core/timeSlotGenerator.js';
import { OUTPATIENT_HOURS } from '../config/rules.js';
import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { isClinicClosed, getClinicClosedReason } from '../core/clinicClosedUtil.js';
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
  bg: '#ea580c', border: '#c2410c', fg: '#ffffff', cardBg: '#fff7ed'
});

const REHA_CARD = Object.freeze({
  bg: '#eff6ff', border: '#93c5fd', accent: '#2563eb'
});

const WEEK_PICKER_OPTIONS = Object.freeze([
  { id: 'w0', label: '① 表示中の週（当週）', weeksOffsets: [0] },
  { id: 'w1', label: '② 翌週（1週先）', weeksOffsets: [1] },
  { id: 'w2', label: '③ 翌々週（2週先）', weeksOffsets: [2] },
  { id: 'w3', label: '④ 3週先', weeksOffsets: [3] },
  { id: 'w4', label: '⑤ 4週先', weeksOffsets: [4] },
  { id: 'b12', label: '⑥ 【一括】翌週〜翌々週（2週間分・各A4縦1枚）', weeksOffsets: [1, 2] },
  { id: 'b13', label: '⑦ 【一括】翌週〜3週先（3週間分・各A4縦1枚）', weeksOffsets: [1, 2, 3] }
]);

/** @type {{ win: Window|null, baseDate: Date, mode: 'single'|'batch', offset: number, offsets: number[] }} */
const previewSession = {
  win: null,
  baseDate: new Date(),
  mode: 'single',
  offset: 1,
  offsets: [1]
};

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
 * カレンダー基準日の月曜から weeksOffset 週先の月〜土
 * @param {Date} baseDate
 * @param {number} weeksOffset 0=当週, 1=翌週, 2=翌々週 …
 * @returns {Date[]}
 */
function resolveWeekDatesByOffset(baseDate, weeksOffset) {
  const baseMonday = getMondayOfWeek(baseDate || new Date());
  baseMonday.setHours(0, 0, 0, 0);
  const monday = new Date(baseMonday.getFullYear(), baseMonday.getMonth(), baseMonday.getDate());
  monday.setDate(monday.getDate() + (Number(weeksOffset) * 7));
  return getWeekDates(monday);
}

function formatSlashYMD(d) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function weekOffsetShortLabel(off) {
  if (Number(off) === 0) return '当週';
  if (Number(off) === 1) return '翌週';
  if (Number(off) === 2) return '翌々週';
  return `${off}週先`;
}

/**
 * 印刷用フルネーム正規化（文字は省略せず、空白のみ半角スペース1つへ）
 * @param {string} fullName
 * @returns {string}
 */
function normalizeFullNameForPrint(fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) return '—';
  const parts = raw.split(/[\s\u3000]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts.slice(1).join('')}`;
  return raw;
}

function resolveSlotIntervalMinutes() {
  const n = Number(OUTPATIENT_HOURS?.slotIntervalMinutes);
  return (n === 15 || n === 20 || n === 30) ? n : 20;
}

function calcSpanCount(durationMinutes, intervalMinutes) {
  const interval = Math.max(1, Number(intervalMinutes) || 20);
  const dur = Number(durationMinutes);
  const d = Number.isFinite(dur) && dur > 0 ? dur : interval;
  return Math.max(1, Math.ceil(d / interval));
}

function isHourSlot(slotTime) {
  return /:00$/.test(String(slotTime || ''));
}

/**
 * 昼休みギャップをまたぐか（AM開始 → PM枠へは継続しない）
 * @param {string} startSlot
 * @param {string} nextSlot
 * @param {string} amEnd
 * @param {string} pmStart
 */
function crossesLunchGap(startSlot, nextSlot, amEnd, pmStart) {
  if (!(String(amEnd) < String(pmStart))) return false;
  return String(startSlot) < String(pmStart) && String(nextSlot) >= String(pmStart);
}

function formatNavWeekLabel(weeksOffset, weekDates) {
  return `【${weekOffsetShortLabel(weeksOffset)}】${formatSlashYMD(weekDates[0])}(月) 〜 ${formatSlashYMD(weekDates[5])}(土)`;
}

function formatTargetWeekLabel(weekDates) {
  return `対象週: ${formatSlashYMD(weekDates[0])}(月) 〜 ${formatSlashYMD(weekDates[5])}(土)`;
}

function formatOptionSubLabel(baseDate, weeksOffsets) {
  return weeksOffsets.map((off) => {
    const wd = resolveWeekDatesByOffset(baseDate, off);
    return `${formatSlashYMD(wd[0])}〜${formatSlashYMD(wd[5])}`;
  }).join(' ／ ');
}

/**
 * 日付×スロット×ゾーンの開始／継続占有マップを構築
 * @returns {Map<string, { rehaStarts: object[], rehaCont: object[], antiStarts: object[], antiCont: object[] }>}
 */
function buildOccupancyMap(weekAptList, allSlotTimes, interval, amEnd, pmStart) {
  /** @type {Map<string, { rehaStarts: object[], rehaCont: object[], antiStarts: object[], antiCont: object[] }>} */
  const map = new Map();
  const ensure = (key) => {
    if (!map.has(key)) {
      map.set(key, { rehaStarts: [], rehaCont: [], antiStarts: [], antiCont: [] });
    }
    return map.get(key);
  };

  (weekAptList || []).forEach((apt) => {
    if (!apt || apt.status === 'CANCELLED') return;
    const dateStr = String(apt.date || '').replace(/\//g, '-').slice(0, 10);
    if (!dateStr) return;
    const startSlot = snapToFloorAppointmentSlot(apt.startTime, allSlotTimes);
    const startIdx = allSlotTimes.indexOf(startSlot);
    if (startIdx < 0) return;

    const patient = getPatientById(apt.patientId);
    const anti = isAnalgesiaApt(apt, patient);
    const span = calcSpanCount(apt.durationMinutes, interval);
    const startKey = `${dateStr}|${startSlot}`;
    const bucket = ensure(startKey);
    if (anti) bucket.antiStarts.push(apt);
    else bucket.rehaStarts.push(apt);

    for (let i = 1; i < span; i += 1) {
      const nextSlot = allSlotTimes[startIdx + i];
      if (!nextSlot) break;
      if (crossesLunchGap(startSlot, nextSlot, amEnd, pmStart)) break;
      if (isClinicClosed(dateStr, nextSlot)) break;
      const contKey = `${dateStr}|${nextSlot}`;
      const contBucket = ensure(contKey);
      if (anti) contBucket.antiCont.push(apt);
      else contBucket.rehaCont.push(apt);
    }
  });

  return map;
}

/**
 * @param {object} apt
 * @param {object[]} therapists
 * @param {object} colorMap
 * @param {boolean} anti
 * @returns {string}
 */
function renderStartCardHtml(apt, therapists, colorMap, anti) {
  const patient = getPatientById(apt.patientId);
  const fullName = normalizeFullNameForPrint(patient?.name || apt.patientId || '');
  const staffLabel = formatStaffLabel(therapists, apt.therapistId);
  const color = resolveStaffColor(colorMap, apt.therapistId, anti);
  const head = (() => {
    const raw = String(staffLabel || '').replace(/\s+/g, '');
    return raw ? raw.charAt(0) : '・';
  })();
  const cardCls = anti ? 'patient-card anti' : 'patient-card reha';
  const badgeStyle = anti
    ? `background:${ANALGESIA_COLOR.bg};color:#fff;`
    : `background:${color.bg};color:${color.fg};`;

  if (anti) {
    return `
      <div class="${cardCls}" title="${sanitizeHtml(fullName)}">
        <div class="name-text">${sanitizeHtml(fullName)}</div>
      </div>`;
  }
  return `
    <div class="${cardCls}" title="${sanitizeHtml(fullName)}">
      <div class="staff-tag" style="${badgeStyle}">${sanitizeHtml(head)}</div>
      <div class="name-text">${sanitizeHtml(fullName)}</div>
    </div>`;
}

/**
 * 継続占有カード
 * @param {object} apt
 * @param {boolean} anti
 */
function renderContinuationCardHtml(apt, anti) {
  const patient = getPatientById(apt.patientId);
  const fullName = normalizeFullNameForPrint(patient?.name || apt.patientId || '');
  const cls = anti ? 'cont-card anti' : 'cont-card reha';
  return `
    <div class="${cls}" title="継続予約: ${sanitizeHtml(fullName)}">
      <span class="cont-mark">↳</span>
      <span class="cont-text">継続（${sanitizeHtml(fullName)}）</span>
    </div>`;
}

/**
 * ゾーン内HTML（開始＋継続）
 * @param {object[]} starts
 * @param {object[]} conts
 * @param {boolean} anti
 * @param {object[]} therapists
 * @param {object} colorMap
 */
function renderZoneInnerHtml(starts, conts, anti, therapists, colorMap) {
  const s = Array.isArray(starts) ? starts : [];
  const c = Array.isArray(conts) ? conts : [];
  if (s.length === 0 && c.length === 0) {
    return `<div class="write-space ${anti ? 'write-anti' : 'write-reha'}" aria-hidden="true"></div>`;
  }
  const multi = (s.length + c.length) >= 2 ? ' is-multi' : '';
  const cards = [
    ...s.map((apt) => renderStartCardHtml(apt, therapists, colorMap, anti)),
    ...c.map((apt) => renderContinuationCardHtml(apt, anti))
  ].join('');
  return `<div class="slot-patients-container${multi}">${cards}</div>`;
}

/**
 * 縦2段セル（上：個別／下：消炎）
 */
function renderVerticalSlotCellHtml(opts) {
  const {
    occupancy, therapists, colorMap, extraCls = '', closed = false, closedReason = '', holidayName = ''
  } = opts;

  if (closed) {
    const reason = closedReason || holidayName || '休診';
    const holExtra = holidayName && closedReason && !String(closedReason).includes(holidayName)
      ? `<div class="closed-sub">${sanitizeHtml(holidayName)}</div>`
      : '';
    return `
      <td class="res-slot closed-slot${extraCls}">
        <div class="closed-unified">
          <div class="closed-label">休診</div>
          ${holExtra || (reason && reason !== '休診' ? `<div class="closed-sub">${sanitizeHtml(reason)}</div>` : '')}
        </div>
      </td>`;
  }

  const occ = occupancy || { rehaStarts: [], rehaCont: [], antiStarts: [], antiCont: [] };
  const rehaInner = renderZoneInnerHtml(occ.rehaStarts, occ.rehaCont, false, therapists, colorMap);
  const antiInner = renderZoneInnerHtml(occ.antiStarts, occ.antiCont, true, therapists, colorMap);

  return `
    <td class="res-slot v-split${extraCls}">
      <div class="slot-stack">
        <div class="zone zone-reha">${rehaInner}</div>
        <div class="zone zone-anti">${antiInner}</div>
      </div>
    </td>`;
}

function buildWeekBodyRows(weekDates, weekAptList, allSlotTimes, therapists, colorMap, amEnd, pmStart, breakMin) {
  let bodyRows = '';
  let lunchBandInserted = false;
  const interval = resolveSlotIntervalMinutes();
  const occupancyMap = buildOccupancyMap(weekAptList, allSlotTimes, interval, amEnd, pmStart);

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

    const hourCls = isHourSlot(slotTime) ? ' hour-slot' : '';
    bodyRows += `<tr class="slot-row${hourCls}"><td class="time-col">${slotTime}</td>`;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isSat = d.getDay() === 6;
      const holidayName = getJapaneseHolidayName(d);
      const closed = isClinicClosed(dateStr, slotTime);
      const closedReason = getClinicClosedReason(dateStr, slotTime);
      const key = `${dateStr}|${slotTime}`;
      const occupancy = occupancyMap.get(key);

      let extra = '';
      if (closed) extra += ' closed';
      else if (isSat) extra += ' sat';
      if (hourCls) extra += ' hour-border';

      bodyRows += renderVerticalSlotCellHtml({
        occupancy,
        therapists,
        colorMap,
        extraCls: extra,
        closed,
        closedReason: closed ? (closedReason || '') : '',
        holidayName: holidayName || ''
      });
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

function buildPageWrapperHtml(opts) {
  const {
    weekDates, bodyRows, dayNames, periodLabel, outStamp,
    firstSlot, lastSlot, slotCount, weekAptCount, isLast, weeksOffset, intervalMinutes
  } = opts;

  return `
    <div class="page-wrapper${isLast ? ' page-wrapper-last' : ''}" data-weeks-offset="${weeksOffset}">
      <div class="page-header">
        <div class="header-main">
          <div class="title">翌週予約受付表（紙予約用・A4縦1枚）</div>
          <div class="period">${sanitizeHtml(periodLabel)}</div>
          <div class="legend-row">
            <span class="lg-chip lg-reha">上段・青 個別リハ</span>
            <span class="lg-chip lg-anti">下段・橙 消炎鎮痛</span>
            <span class="lg-chip lg-cont">斜線 継続予約中</span>
            <span class="lg-chip lg-closed">赤網 休診</span>
          </div>
        </div>
        <div class="meta">出力 ${outStamp}<br>${weekOffsetShortLabel(weeksOffset)}・${intervalMinutes || 20}分刻み・1枚完結</div>
      </div>
      <div class="sheet-wrap">
        <table class="paper-table">
          <thead>
            <tr>
              <th class="th-time">時間<div class="th-time-hint">上：個別／下：消炎</div></th>
              ${weekDates.map((d, idx) => {
                const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
                const holidayName = getJapaneseHolidayName(d);
                const isSat = d.getDay() === 6;
                let cls = 'th-day';
                if (holidayName) cls += ' holiday';
                else if (isSat) cls += ' sat';
                const hol = holidayName
                  ? `<span class="hol-name">${sanitizeHtml(holidayName)}</span>` : '';
                return `<th class="${cls}"><span class="dow">${dayNames[idx]}</span> <span class="date">${mmdd}</span>${hol}</th>`;
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

function collectPrintContext() {
  const allSlotTimes = resolvePrintSlotTimes();
  const allAppointments = Object.values(getAllAppointments()).filter((apt) => (
    apt && apt.status !== 'CANCELLED'
  ));
  const therapists = getAllTherapists();
  const colorMap = buildStaffColorMap(therapists);
  const amEnd = String(OUTPATIENT_HOURS?.amEnd || '13:00');
  const pmStart = String(OUTPATIENT_HOURS?.pmStart || '13:00');
  const breakMin = Math.max(0, timeToMin(pmStart) - timeToMin(amEnd));
  const intervalMinutes = resolveSlotIntervalMinutes();
  const now = new Date();
  const outStamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  // A4縦 有効高 ~284mm（margin 5–6mm 想定）
  const pageMm = 284;
  const headerMm = 12;
  const theadMm = 7;
  const footerMm = 4;
  const lunchMm = 3.2;
  const slotCount = allSlotTimes.length;
  const dataAreaMm = pageMm - headerMm - theadMm - footerMm - lunchMm;
  const rowMm = dataAreaMm / Math.max(1, slotCount || 1);
  // 行が多いほど文字を小さく
  const namePt = slotCount >= 36 ? 5.4 : (slotCount >= 28 ? 5.8 : (slotCount >= 22 ? 6.2 : 6.5));
  const antiPt = Math.max(5.2, namePt - 0.3);
  const multiPt = Math.max(5.0, namePt - 1.0);
  return {
    allSlotTimes,
    allAppointments,
    therapists,
    colorMap,
    amEnd,
    pmStart,
    breakMin,
    intervalMinutes,
    outStamp,
    dayNames: ['月', '火', '水', '木', '金', '土'],
    pageMm,
    headerMm,
    theadMm,
    footerMm,
    lunchMm,
    slotCount,
    rowMm,
    namePt,
    antiPt,
    multiPt,
    firstSlot: allSlotTimes[0] || '-',
    lastSlot: allSlotTimes[allSlotTimes.length - 1] || '-'
  };
}

function buildPagesHtmlForOffsets(baseDate, weeksOffsets, ctx) {
  return weeksOffsets.map((off, idx) => {
    const weekDates = resolveWeekDatesByOffset(baseDate, off);
    const weekDatesSet = new Set(weekDates.map(formatDateYMD));
    const weekAptList = ctx.allAppointments.filter((apt) => {
      const aptDate = String(apt.date || '').replace(/\//g, '-').slice(0, 10);
      return weekDatesSet.has(aptDate);
    });
    const bodyRows = buildWeekBodyRows(
      weekDates,
      weekAptList,
      ctx.allSlotTimes,
      ctx.therapists,
      ctx.colorMap,
      ctx.amEnd,
      ctx.pmStart,
      ctx.breakMin
    );
    return buildPageWrapperHtml({
      weekDates,
      bodyRows,
      dayNames: ctx.dayNames,
      periodLabel: formatTargetWeekLabel(weekDates),
      outStamp: ctx.outStamp,
      firstSlot: ctx.firstSlot,
      lastSlot: ctx.lastSlot,
      slotCount: ctx.slotCount,
      weekAptCount: weekAptList.length,
      isLast: idx === weeksOffsets.length - 1,
      weeksOffset: off,
      intervalMinutes: ctx.intervalMinutes
    });
  }).join('');
}

function buildSharedCss(ctx) {
  const {
    headerMm, theadMm, footerMm, lunchMm, rowMm, pageMm, namePt, antiPt, multiPt
  } = ctx;
  const pageH = pageMm || 284;
  return `
    @page { size: A4 portrait; margin: 5mm 6mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; background: #f1f5f9; color: #0f172a;
      font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo UI", Meiryo, sans-serif;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    body { font-size: 9pt; line-height: 1.15; }
    .preview-toolbar {
      position: sticky; top: 0; z-index: 50;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 12px; background: #0f766e; color: #fff;
      box-shadow: 0 2px 8px rgba(15,23,42,0.2);
    }
    .preview-toolbar .tb-left, .preview-toolbar .tb-right {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    }
    .preview-toolbar .week-label {
      font-size: 0.92rem; font-weight: 800; letter-spacing: 0.02em;
      background: rgba(255,255,255,0.12); padding: 6px 10px; border-radius: 6px;
    }
    .preview-toolbar button {
      appearance: none; border: 1px solid rgba(255,255,255,0.35);
      background: rgba(255,255,255,0.14); color: #fff;
      font-weight: 800; font-size: 0.85rem; padding: 7px 12px; border-radius: 6px; cursor: pointer;
    }
    .preview-toolbar button:hover { background: rgba(255,255,255,0.28); }
    .preview-toolbar button.primary { background: #fff; color: #0f766e; border-color: #fff; }
    .preview-toolbar button:disabled { opacity: 0.45; cursor: not-allowed; }
    .preview-stage { padding: 12px; display: flex; flex-direction: column; gap: 14px; align-items: center; }
    .page-wrapper {
      width: 100%; max-width: 210mm;
      height: ${pageH}mm !important; max-height: ${pageH}mm !important; min-height: ${pageH}mm !important;
      background: #fff;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 4px 16px rgba(15,23,42,0.12);
      page-break-after: always; break-after: page; page-break-inside: avoid;
    }
    .page-wrapper-last { page-break-after: auto; break-after: auto; }
    .page-header {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
      border-bottom: 1px solid #cbd5e1; padding: 3px 4px 2px; margin: 0 2px 1px;
      flex: 0 0 auto; height: ${headerMm}mm; max-height: ${headerMm}mm;
    }
    .title { font-size: 11pt; font-weight: 800; color: #0f172a; letter-spacing: 0.02em; }
    .period { font-size: 8pt; font-weight: 700; color: #0f766e; margin-top: 1px; }
    .meta { font-size: 6.5pt; font-weight: 600; color: #94a3b8; text-align: right; white-space: nowrap; }
    .legend-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
    .lg-chip {
      display: inline-block; font-size: 5.8pt; font-weight: 800; padding: 1px 5px;
      border-radius: 3px; border: 0.5px solid #cbd5e1; line-height: 1.2;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .lg-reha { background: #eff6ff; color: #1d4ed8; border-color: #93c5fd; }
    .lg-anti { background: #fff7ed; color: #c2410c; border-color: #fdba74; }
    .lg-cont { background: #f8fafc; color: #475569; border-color: #94a3b8;
      background-image: repeating-linear-gradient(-45deg, transparent, transparent 1px, rgba(148,163,184,0.35) 1px, rgba(148,163,184,0.35) 2px);
    }
    .lg-closed { background: #fee2e2; color: #be123c; border-color: #fecaca; }
    .sheet-wrap { flex: 1 1 auto; min-height: 0; overflow: hidden; padding: 0 2px; }
    table.paper-table {
      width: 100%; height: 100% !important;
      border-collapse: collapse; table-layout: fixed;
    }
    .paper-table th, .paper-table td { border: 0.5px solid #cbd5e1; vertical-align: middle; }
    .paper-table thead th {
      background: #f8fafc; font-size: 8.5pt; font-weight: 700; text-align: center;
      height: ${theadMm}mm; max-height: ${theadMm}mm; padding: 1px 2px; color: #334155;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .paper-table thead th.th-time {
      width: 11mm; color: #64748b; font-size: 7pt; line-height: 1.15;
    }
    .th-time-hint { display: block; font-size: 5pt; font-weight: 700; color: #94a3b8; margin-top: 1px; }
    .paper-table thead th .dow { font-weight: 800; }
    .paper-table thead th .date { font-size: 7pt; font-weight: 600; color: #64748b; }
    .paper-table thead th .hol-name {
      display: inline-block; margin-left: 2px; font-size: 5.5pt; color: #e11d48; font-weight: 800;
    }
    .paper-table thead th.sat { background: #eff6ff; }
    .paper-table thead th.sat .dow { color: #1d4ed8; }
    .paper-table thead th.holiday { background: #fff1f2; }
    .paper-table thead th.holiday .dow { color: #be123c; }
    tr.lunch-band td {
      height: ${lunchMm}mm; max-height: ${lunchMm}mm;
      background: #f1f5f9; color: #64748b; font-size: 6.5pt; font-weight: 800;
      text-align: center; vertical-align: middle; letter-spacing: 0.08em;
      border: 0.5px solid #cbd5e1;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    tr.slot-row { height: ${rowMm}mm !important; }
    tr.slot-row.hour-slot td { border-top-color: #94a3b8; border-top-width: 1px; }
    .time-col {
      width: 11mm; text-align: center; font-weight: 800; font-size: 7.5pt;
      background: #f8fafc; color: #475569; height: ${rowMm}mm !important;
      vertical-align: middle !important; font-variant-numeric: tabular-nums;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    td.res-slot {
      height: ${rowMm}mm !important; padding: 0 !important;
      vertical-align: top !important; overflow: hidden;
    }
    td.res-slot.sat { background: #fafcff; }
    td.res-slot.hour-border { border-top-color: #94a3b8; border-top-width: 1px; }
    .slot-stack {
      display: flex; flex-direction: column; width: 100%; height: 100%;
      min-height: 0;
    }
    .zone {
      display: flex; flex-direction: column; justify-content: center;
      min-width: 0; min-height: 0; overflow: hidden; padding: 0.3px 1.5px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .zone-reha {
      flex: 0 0 54%; height: 54%;
      background: #ffffff;
      border-bottom: 1px dotted #cbd5e1;
    }
    .zone-anti {
      flex: 0 0 46%; height: 46%;
      background: #f8fafc;
    }
    .write-space {
      width: 100%; height: 100%; min-height: 2.5mm; background: transparent;
    }
    .write-reha { background: #ffffff; }
    .write-anti { background: transparent; }
    td.res-slot.closed-slot, td.closed-slot {
      background: #fee2e2 !important;
      background-image: repeating-linear-gradient(
        -45deg, transparent, transparent 2px, rgba(248,113,113,0.18) 2px, rgba(248,113,113,0.18) 4px
      ) !important;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .closed-unified {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      width: 100%; height: 100%; gap: 0;
    }
    .closed-label {
      font-size: 7pt; font-weight: 800; color: #be123c; letter-spacing: 0.12em;
    }
    .closed-sub { font-size: 5pt; font-weight: 700; color: #e11d48; line-height: 1.1; }
    .slot-patients-container {
      display: flex; flex-direction: column; justify-content: center; align-items: stretch;
      width: 100%; height: 100%; gap: 0.5px; min-height: 0;
    }
    .slot-patients-container.is-multi {
      flex-direction: row; flex-wrap: wrap; align-content: center; gap: 0.5px;
    }
    .patient-card {
      display: flex; flex-direction: row; align-items: center; justify-content: flex-start;
      gap: 1.5px; padding: 0.5px 2px; border-radius: 2px;
      width: 100%; min-width: 0; box-sizing: border-box;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .slot-patients-container.is-multi .patient-card,
    .slot-patients-container.is-multi .cont-card {
      width: auto; flex: 1 1 45%; max-width: 100%;
    }
    .patient-card.reha {
      background: ${REHA_CARD.bg}; border: 0.5px solid ${REHA_CARD.border};
      border-left: 2px solid ${REHA_CARD.accent};
    }
    .patient-card.anti {
      background: ${ANALGESIA_COLOR.cardBg}; border: 0.5px solid #fdba74;
      border-left: 2px solid ${ANALGESIA_COLOR.bg};
    }
    .patient-card .staff-tag {
      display: inline-flex; align-items: center; justify-content: center;
      flex: 0 0 auto; min-width: 7px; font-size: 5pt; font-weight: 800;
      padding: 0 2px; border-radius: 2px; line-height: 1.05; color: #fff;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .patient-card .name-text {
      flex: 1 1 auto; min-width: 0;
      font-size: ${namePt}pt; font-weight: 800; color: #0f172a; line-height: 1.05;
      white-space: nowrap; overflow: visible; text-overflow: clip;
      letter-spacing: -0.015em;
    }
    .patient-card.anti .name-text {
      font-size: ${antiPt}pt; text-align: left;
    }
    .cont-card {
      display: flex; flex-direction: row; align-items: center; gap: 1px;
      padding: 0.5px 2px; border-radius: 2px; width: 100%; min-width: 0;
      font-size: ${Math.max(4.8, multiPt)}pt; font-weight: 700; line-height: 1.0;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .cont-card.reha {
      color: #1e40af; border: 0.5px solid #bfdbfe;
      background: repeating-linear-gradient(
        -45deg, #eff6ff, #eff6ff 2px, #dbeafe 2px, #dbeafe 4px
      );
    }
    .cont-card.anti {
      color: #9a3412; border: 0.5px solid #fed7aa;
      background: repeating-linear-gradient(
        -45deg, #fff7ed, #fff7ed 2px, #ffedd5 2px, #ffedd5 4px
      );
    }
    .cont-mark { flex: 0 0 auto; font-weight: 800; }
    .cont-text {
      flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: visible; text-overflow: clip;
    }
    .slot-patients-container.is-multi .patient-card .name-text,
    .slot-patients-container.is-multi .cont-text {
      font-size: ${multiPt}pt; line-height: 1.0;
    }
    .footer {
      display: flex; justify-content: space-between; gap: 8px;
      margin: 0.5mm 4px 1px; padding-top: 1px; border-top: 1px solid #e2e8f0;
      font-size: 6.5pt; font-weight: 600; color: #94a3b8;
      flex: 0 0 auto; height: ${footerMm}mm; max-height: ${footerMm}mm; overflow: hidden;
    }
    @media print {
      html, body {
        background: #fff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .preview-toolbar { display: none !important; }
      .preview-stage { padding: 0 !important; gap: 0 !important; }
      .page-wrapper {
        max-width: none !important; box-shadow: none !important;
        height: ${pageH}mm !important; max-height: ${pageH}mm !important; min-height: ${pageH}mm !important;
        overflow: hidden !important; page-break-after: always !important;
      }
      .page-wrapper-last { page-break-after: auto !important; }
      table.paper-table { height: 100% !important; }
      tr.slot-row { height: ${rowMm}mm !important; }
      .zone-reha { background: #ffffff !important; }
      .zone-anti { background: #f8fafc !important; }
      .patient-card.reha { background: ${REHA_CARD.bg} !important; }
      .patient-card.anti { background: ${ANALGESIA_COLOR.cardBg} !important; }
      td.closed-slot {
        background: #fee2e2 !important;
        background-image: repeating-linear-gradient(
          -45deg, transparent, transparent 2px, rgba(248,113,113,0.18) 2px, rgba(248,113,113,0.18) 4px
        ) !important;
      }
    }
  `;
}

function buildPreviewToolbarHtml(mode, offset, weekDates, batchOffsets, baseDate) {
  if (mode === 'batch') {
    const labels = batchOffsets.map((off, i) => {
      const wd = resolveWeekDatesByOffset(baseDate, off);
      return `Page${i + 1} ${weekOffsetShortLabel(off)} ${formatSlashYMD(wd[0])}〜${formatSlashYMD(wd[5])}`;
    }).join(' ／ ');
    return `
      <div class="preview-toolbar" id="previewToolbar">
        <div class="tb-left">
          <span class="week-label">【一括プレビュー】${sanitizeHtml(labels)}（スクロールで全週確認）</span>
        </div>
        <div class="tb-right">
          <button type="button" class="primary" onclick="window.print()">印刷する</button>
        </div>
      </div>
    `;
  }

  const label = formatNavWeekLabel(offset, weekDates);
  const prevDisabled = offset <= 0 ? 'disabled' : '';
  const nextDisabled = offset >= 12 ? 'disabled' : '';
  return `
    <div class="preview-toolbar" id="previewToolbar">
      <div class="tb-left">
        <button type="button" id="btnPrevWeek" ${prevDisabled}>◀ 前の週</button>
        <span class="week-label" id="weekNavLabel">${sanitizeHtml(label)}</span>
        <button type="button" id="btnNextWeek" ${nextDisabled}>次の週 ▶</button>
      </div>
      <div class="tb-right">
        <button type="button" class="primary" onclick="window.print()">印刷する</button>
      </div>
    </div>
  `;
}

function writePreviewDocument(printWindow, opts) {
  const {
    baseDate, mode, weeksOffsets, titleRange, pagesHtml, ctx, navOffset, navWeekDates
  } = opts;

  const toolbar = buildPreviewToolbarHtml(
    mode,
    navOffset,
    navWeekDates,
    weeksOffsets,
    baseDate
  );

  printWindow.document.open();
  printWindow.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>外来リハビリ 翌週予約受付表 (${titleRange})</title>
  <style>${buildSharedCss(ctx)}</style>
</head>
<body>
  ${toolbar}
  <div class="preview-stage" id="previewStage">
    ${pagesHtml}
  </div>
  <script>
    (function() {
      function bindNav() {
        var prev = document.getElementById('btnPrevWeek');
        var next = document.getElementById('btnNextWeek');
        if (prev) prev.onclick = function() {
          if (window.opener && window.opener.__rehaNextWeekPreviewNavigate) {
            window.opener.__rehaNextWeekPreviewNavigate(-1);
          }
        };
        if (next) next.onclick = function() {
          if (window.opener && window.opener.__rehaNextWeekPreviewNavigate) {
            window.opener.__rehaNextWeekPreviewNavigate(1);
          }
        };
      }
      bindNav();
      window.__rehaBindNextWeekNav = bindNav;
    })();
  </script>
</body>
</html>`);
  printWindow.document.close();

  // baseDate をセッションに保持（ナビ用）
  previewSession.baseDate = baseDate instanceof Date ? new Date(baseDate) : new Date();
  previewSession.win = printWindow;
  previewSession.mode = mode;
  previewSession.offsets = [...weeksOffsets];
  previewSession.offset = navOffset;

  // opener 側ナビAPI
  window.__rehaNextWeekPreviewNavigate = (delta) => {
    if (previewSession.mode !== 'single') return;
    const next = Math.min(12, Math.max(0, Number(previewSession.offset) + Number(delta)));
    if (next === previewSession.offset) return;
    previewSession.offset = next;
    renderPreviewIntoSessionWindow();
  };
}

function renderPreviewIntoSessionWindow() {
  const win = previewSession.win;
  if (!win || win.closed) return;

  const baseDate = previewSession.baseDate;
  const ctx = collectPrintContext();
  if (!ctx.allSlotTimes.length) {
    showToast('外来予約の時間枠が未設定のため表示できません', 'warn');
    return;
  }

  const mode = previewSession.mode;
  const weeksOffsets = mode === 'batch'
    ? previewSession.offsets
    : [previewSession.offset];

  const pagesHtml = buildPagesHtmlForOffsets(baseDate, weeksOffsets, ctx);
  const firstWd = resolveWeekDatesByOffset(baseDate, weeksOffsets[0]);
  const lastWd = resolveWeekDatesByOffset(baseDate, weeksOffsets[weeksOffsets.length - 1]);
  const titleRange = `${formatSlashYMD(firstWd[0])}〜${formatSlashYMD(lastWd[5])}`;
  const navWeekDates = resolveWeekDatesByOffset(baseDate, previewSession.offset);

  writePreviewDocument(win, {
    baseDate,
    mode,
    weeksOffsets,
    titleRange,
    pagesHtml,
    ctx,
    navOffset: previewSession.offset,
    navWeekDates
  });

  try {
    win.focus();
  } catch (_) { /* ignore */ }
}

/**
 * 対象週選択モーダル
 * @param {Date} [baseDate]
 * @returns {Promise<number[]|null>}
 */
export function showNextWeekPrintWeekPicker(baseDate = new Date()) {
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
      'width:min(440px,100%)', 'background:#fff', 'border-radius:10px',
      'box-shadow:0 20px 40px rgba(15,23,42,0.25)',
      'border:1px solid #cbd5e1', 'overflow:hidden'
    ].join(';');

    const optionsHtml = WEEK_PICKER_OPTIONS.map((opt, i) => {
      const sub = formatOptionSubLabel(baseDate, opt.weeksOffsets);
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
        <div style="font-size:0.78rem;color:#64748b;margin-top:4px;font-weight:600;">表示中の当週、または基準週から先の週を選択。プレビューで予約状況を確認してから印刷できます。</div>
      </div>
      <div style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;max-height:min(58vh,420px);overflow:auto;">
        ${optionsHtml}
      </div>
      <div style="padding:12px 16px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f8fafc;">
        <button type="button" data-act="cancel" style="padding:8px 14px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;font-weight:700;cursor:pointer;color:#475569;">キャンセル</button>
        <button type="button" data-act="ok" style="padding:8px 16px;border-radius:6px;border:1px solid #0f766e;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">プレビュー表示</button>
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
 * 翌週予約受付表プレビュー／印刷
 * @param {Date} baseDate カレンダー基準日
 * @param {{ weeksOffsets?: number[], weeksOffset?: number }} [options]
 */
export function printNextWeekBookingSheet(baseDate, options = {}) {
  let weeksOffsets = [];
  if (Array.isArray(options.weeksOffsets) && options.weeksOffsets.length) {
    weeksOffsets = options.weeksOffsets.map((n) => Number(n));
  } else if (options.weeksOffset != null) {
    weeksOffsets = [Number(options.weeksOffset)];
  } else {
    weeksOffsets = [1];
  }
  // 0=表示中の当週を許可（1〜12は従来どおり）
  weeksOffsets = [...new Set(weeksOffsets.filter((n) => Number.isFinite(n) && n >= 0 && n <= 12))]
    .sort((a, b) => a - b);
  if (!weeksOffsets.length) weeksOffsets = [1];

  const ctx = collectPrintContext();
  if (!ctx.allSlotTimes.length) {
    showToast('外来予約の時間枠が未設定のため印刷できません（スタッフ設定の外来提供時間を確認）', 'warn');
    return;
  }

  const mode = weeksOffsets.length > 1 ? 'batch' : 'single';
  const anchor = baseDate instanceof Date ? new Date(baseDate) : new Date();

  previewSession.baseDate = anchor;
  previewSession.mode = mode;
  previewSession.offsets = [...weeksOffsets];
  previewSession.offset = weeksOffsets[0];

  let printWindow = previewSession.win;
  if (!printWindow || printWindow.closed) {
    printWindow = window.open('', '_blank', 'width=980,height=1200');
    if (!printWindow) {
      showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
      return;
    }
    previewSession.win = printWindow;
  }

  renderPreviewIntoSessionWindow();

  if (mode === 'batch') {
    showToast(`${weeksOffsets.length}週分をプレビュー表示中（スクロールで確認）`, 'info');
  } else {
    const wd = resolveWeekDatesByOffset(anchor, weeksOffsets[0]);
    showToast(`${formatNavWeekLabel(weeksOffsets[0], wd)} を表示`, 'info');
  }
}

/**
 * モーダルで週選択 → プレビュー
 * @param {Date} [baseDate]
 */
export async function openNextWeekBookingSheetPrintFlow(baseDate) {
  const anchor = baseDate instanceof Date ? new Date(baseDate) : new Date();
  const weeksOffsets = await showNextWeekPrintWeekPicker(anchor);
  if (!weeksOffsets) return;
  printNextWeekBookingSheet(anchor, { weeksOffsets });
}

/** 旧名称互換 */
export const printWeeklyPaperBookingSheet = printNextWeekBookingSheet;
