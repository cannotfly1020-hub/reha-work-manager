// js/print/weeklyPaperBookingPrint.js
// 翌週以降の紙予約用・週間予約表 A4縦（portrait）1枚完結印刷
// ★受付簿（午前・午後2枚）とは独立。画面グリッド・予約データには一切干渉しない
// ★外来専用 OUTPATIENT_HOURS から全日コマを生成／昼休みは全列結合1行で圧縮
// ★予約枠＝担当・患者名・【消炎】／空き枠＝手書き余白

import { formatDateYMD, getWeekDates } from '../core/dateUtils.js';
import { TIME_SLOTS } from '../config/appointmentSlots.js';
import { snapToNearestAppointmentSlot } from '../core/timeSlotUtil.js';
import { generateAppointmentTimeStrings } from '../core/timeSlotGenerator.js';
import { OUTPATIENT_HOURS, REHA_RULES } from '../config/rules.js';
import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import { getAllAppointments } from '../store/appointmentStore.js';
import { showToast } from '../ui/toast.js';

/**
 * 印刷用スロット開始時刻（外来専用時間から午前〜午後を漏れなく生成）
 * @returns {string[]}
 */
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

/**
 * @param {{ durationMinutes?: number }} apt
 * @returns {number}
 */
function getAptSlotSpan(apt) {
  const duration = Math.max(1, Number(apt?.durationMinutes) || 20);
  return Math.max(1, Math.ceil(duration / 20));
}

const STAFF_BADGE_PALETTE = Object.freeze([
  { bg: '#1d4ed8', fg: '#ffffff', border: '#1e3a8a' },
  { bg: '#b45309', fg: '#ffffff', border: '#92400e' },
  { bg: '#6d28d9', fg: '#ffffff', border: '#4c1d95' },
  { bg: '#be123c', fg: '#ffffff', border: '#9f1239' },
  { bg: '#0f766e', fg: '#ffffff', border: '#115e59' },
  { bg: '#c2410c', fg: '#ffffff', border: '#9a3412' },
  { bg: '#0369a1', fg: '#ffffff', border: '#075985' },
  { bg: '#4d7c0f', fg: '#ffffff', border: '#3f6212' }
]);

/**
 * @param {object[]} therapists
 * @param {string} therapistId
 * @returns {string}
 */
function formatStaffBadgeLabel(therapists, therapistId) {
  if (!therapistId || therapistId === 'NONE') return '指定無';
  if (therapistId === 'ANALGESIA') return '物療';
  const staff = therapists.find((t) => t.id === therapistId);
  let label = staff?.name || therapistId;
  label = String(label).replace(/\s+/g, '');
  if (label.length > 6) label = label.slice(0, 6);
  return label;
}

/**
 * @param {string} therapistId
 * @returns {{ bg: string, fg: string, border: string }}
 */
function resolveStaffBadgeColor(therapistId) {
  if (!therapistId || therapistId === 'NONE') {
    return { bg: '#475569', fg: '#ffffff', border: '#334155' };
  }
  if (therapistId === 'ANALGESIA') {
    return { bg: '#047857', fg: '#ffffff', border: '#065f46' };
  }
  const id = String(therapistId);
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return STAFF_BADGE_PALETTE[Math.abs(hash) % STAFF_BADGE_PALETTE.length];
}

/**
 * @param {object|null|undefined} patient
 * @param {object} apt
 */
function resolveDiseaseVisual(patient, apt) {
  const treatment = String(apt?.treatmentType || '').toUpperCase();
  const therapistId = String(apt?.therapistId || '');
  const isAnalgesia = treatment === 'ANALGESIA' || therapistId === 'ANALGESIA'
    || String(patient?.diseaseType || '').toUpperCase() === 'ANALGESIA';

  if (isAnalgesia) {
    return {
      isAnalgesia: true,
      diseaseType: 'ANALGESIA',
      diseaseTag: '消炎',
      diseaseClass: 'dtype-analgesia'
    };
  }

  const raw = String(patient?.diseaseType || '').toUpperCase();
  const known = ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE'];
  const diseaseType = known.includes(raw) ? raw : 'LOCOMOTIVE';
  const rule = REHA_RULES.LIMIT_DAYS[diseaseType] || REHA_RULES.LIMIT_DAYS.LOCOMOTIVE;
  const tagMap = { LOCOMOTIVE: '運', CEREBROVASCULAR: '脳', DISUSE: '廃' };
  const classMap = {
    LOCOMOTIVE: 'dtype-loco',
    CEREBROVASCULAR: 'dtype-cerebro',
    DISUSE: 'dtype-disuse'
  };

  return {
    isAnalgesia: false,
    diseaseType,
    diseaseTag: tagMap[diseaseType] || rule.tag || '運',
    diseaseClass: classMap[diseaseType] || 'dtype-loco'
  };
}

/**
 * @param {object} apt
 * @param {object[]} therapists
 * @returns {string}
 */
function renderBookedCardHtml(apt, therapists) {
  const patient = getPatientById(apt.patientId);
  const pName = patient?.name || apt.patientId || '（氏名不明）';
  const staffLabel = formatStaffBadgeLabel(therapists, apt.therapistId);
  const staffColor = resolveStaffBadgeColor(apt.therapistId);
  const dur = Number(apt.durationMinutes) || 20;
  const vis = resolveDiseaseVisual(patient, apt);

  const diseaseBadge = vis.isAnalgesia
    ? `<span class="badge-analgesia" title="消炎鎮痛">【消炎】</span>`
    : `<span class="badge-disease ${vis.diseaseClass}">[${sanitizeHtml(vis.diseaseTag)}]</span>`;

  const staffStyle = `background:${staffColor.bg};color:${staffColor.fg};border-color:${staffColor.border};`;

  return `
    <div class="booked-card${vis.isAnalgesia ? ' is-analgesia' : ''}">
      <div class="bk-staff-row">
        <span class="badge-staff" style="${staffStyle}">${sanitizeHtml(staffLabel)}</span>
        ${diseaseBadge}
      </div>
      <div class="bk-main">
        <span class="bk-name">${sanitizeHtml(pName)} 様</span>
        <span class="bk-dur">${dur}分</span>
      </div>
    </div>
  `;
}

/**
 * HH:MM → 通算分
 * @param {string} t
 * @returns {number}
 */
function timeToMin(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * 翌週紙予約用・週間予約表（A4縦・1枚完結）を印刷する
 * ※ 受付簿（午前・午後2枚）とは別機能
 * @param {Date} baseDate
 */
export function printWeeklyPaperBookingSheet(baseDate) {
  const weekDates = getWeekDates(baseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);
  const allSlotTimes = resolvePrintSlotTimes();

  if (!allSlotTimes.length) {
    showToast('外来予約の時間枠が未設定のため印刷できません', 'warn');
    return;
  }

  const allAppointments = getAllAppointments();
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  const weekAptList = Object.values(allAppointments).filter((apt) => {
    return apt && apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date);
  });

  const slotAptMap = {};
  weekAptList.forEach((apt) => {
    const snapped = snapToNearestAppointmentSlot(apt.startTime, allSlotTimes);
    const k = `${apt.date}_${snapped}`;
    if (!slotAptMap[k]) slotAptMap[k] = [];
    slotAptMap[k].push(apt);
  });

  const rowspanSkip = new Set();
  weekDates.forEach((d) => {
    const dateStr = formatDateYMD(d);
    allSlotTimes.forEach((slotTime, idx) => {
      const key = `${dateStr}_${slotTime}`;
      if (rowspanSkip.has(key)) return;
      const apts = slotAptMap[key] || [];
      if (apts.length !== 1) return;
      const span = getAptSlotSpan(apts[0]);
      if (span <= 1) return;
      for (let i = 1; i < span; i += 1) {
        const next = allSlotTimes[idx + i];
        if (!next) break;
        const nextKey = `${dateStr}_${next}`;
        if ((slotAptMap[nextKey] || []).length > 0) break;
        rowspanSkip.add(nextKey);
      }
    });
  });

  const therapists = getAllTherapists();
  const dayNames = ['月', '火', '水', '木', '金', '土'];

  // 昼休み帯: 外来 amEnd〜pmStart（例 12:00〜13:00 / 13:00〜13:00＝帯のみの境界表示）
  const amEnd = String(OUTPATIENT_HOURS?.amEnd || '13:00');
  const pmStart = String(OUTPATIENT_HOURS?.pmStart || '13:00');
  // ユーザー指定の「12:00〜13:00」表示を優先しつつ、設定値があればそれを使う
  const lunchLabelStart = amEnd <= '12:00' ? amEnd : (amEnd < pmStart ? amEnd : '12:00');
  const lunchLabelEnd = pmStart >= '13:00' ? pmStart : (pmStart > amEnd ? pmStart : '13:00');
  const breakMin = Math.max(0, timeToMin(pmStart) - timeToMin(amEnd));
  const showLunchBand = true; // 常に1行圧縮帯を入れ、縦高を節約しつつ午前／午後を視覚分離

  const now = new Date();
  const outStamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const periodLabel = `${startStr.slice(0, 4)}年${Number(startStr.slice(5, 7))}月${Number(startStr.slice(8, 10))}日(月) 〜 ${endStr.slice(0, 4)}年${Number(endStr.slice(5, 7))}月${Number(endStr.slice(8, 10))}日(土)`;

  // A4縦 1枚: 297 - 5 - 4 = 288mm
  const slotCount = allSlotTimes.length;
  const pageMm = 288;
  const headerMm = 12;
  const theadMm = 8;
  const footerMm = 5.5;
  const lunchMm = 4.2; // 昼休みは全列結合の薄い1行
  const borderFudgeMm = Math.min(12, 2.2 + slotCount * 0.2);
  const dataAreaMm = Math.max(160, pageMm - headerMm - theadMm - footerMm - lunchMm - borderFudgeMm);
  const rawRow = dataAreaMm / Math.max(1, slotCount);
  // 嵩上げ禁止＝1枚からはみ出して午後が消えるのを防ぐ
  const rowMm = Math.min(11, rawRow);
  const namePt = rowMm >= 9.5 ? 9.2 : (rowMm >= 8 ? 8.4 : (rowMm >= 6.5 ? 7.6 : 6.8));
  const staffPt = rowMm >= 9.5 ? 8.4 : (rowMm >= 8 ? 7.6 : 6.8);
  const badgePt = rowMm >= 9.5 ? 7.6 : (rowMm >= 8 ? 7.0 : 6.2);
  const analgesiaPt = Math.max(staffPt + 0.4, badgePt + 0.8);
  const timePt = rowMm >= 9 ? 8.8 : (rowMm >= 7 ? 7.8 : 7.0);

  const printWindow = window.open('', '_blank', 'width=900,height=1200');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  let bodyRows = '';
  let lunchBandInserted = false;

  allSlotTimes.forEach((slotTime, slotIdx) => {
    // 午後最初のコマの直前に昼休み帯（全列結合1行）を挿入
    if (showLunchBand && !lunchBandInserted && String(slotTime) >= pmStart) {
      lunchBandInserted = true;
      const breakText = breakMin > 0
        ? `── 昼休み（${lunchLabelStart} 〜 ${lunchLabelEnd} / ${breakMin}分）──`
        : `── 昼休み帯（${lunchLabelStart} 〜 ${lunchLabelEnd}）／午前／午後境界 ──`;
      bodyRows += `
        <tr class="lunch-band">
          <td colspan="7">${breakText}</td>
        </tr>
      `;
    }

    bodyRows += `<tr class="slot-row">`;
    bodyRows += `<td class="time-col">${slotTime}</td>`;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isSat = d.getDay() === 6;
      const holidayName = getJapaneseHolidayName(d);
      const key = `${dateStr}_${slotTime}`;

      if (rowspanSkip.has(key)) return;

      const apts = slotAptMap[key] || [];
      let tdClass = 'slot-cell';
      if (holidayName) tdClass += ' holiday';
      else if (isSat) tdClass += ' sat';

      if (apts.length === 0) {
        bodyRows += `
          <td class="${tdClass} empty-cell">
            <span class="empty-time">${slotTime}</span>
            <div class="write-space" aria-hidden="true"></div>
          </td>
        `;
        return;
      }

      let rowspan = 1;
      if (apts.length === 1) {
        const span = getAptSlotSpan(apts[0]);
        let actual = 1;
        for (let i = 1; i < span; i += 1) {
          const next = allSlotTimes[slotIdx + i];
          if (!next) break;
          const nextKey = `${dateStr}_${next}`;
          if ((slotAptMap[nextKey] || []).length > 0) break;
          if (rowspanSkip.has(nextKey)) actual += 1;
          else break;
        }
        rowspan = Math.max(1, actual);
      }

      const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : '';
      const cardsHtml = apts.map((apt) => renderBookedCardHtml(apt, therapists)).join('');
      bodyRows += `
        <td class="${tdClass} booked-cell"${rowspanAttr}>
          ${cardsHtml}
        </td>
      `;
    });

    bodyRows += `</tr>`;
  });

  // 午後コマが無くても昼休み帯を末尾に出す（午前のみ設定時）
  if (showLunchBand && !lunchBandInserted) {
    const breakText = `── 昼休み（${lunchLabelStart} 〜 ${lunchLabelEnd}）──`;
    bodyRows += `
      <tr class="lunch-band">
        <td colspan="7">${breakText}</td>
      </tr>
    `;
  }

  const firstSlot = allSlotTimes[0];
  const lastSlot = allSlotTimes[slotCount - 1];

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>外来リハビリ 週間予約表・紙予約用 (${startStr.replace(/-/g, '/')}〜)</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 5mm 5mm 4mm 5mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
          width: 100%;
          height: 100%;
        }
        body {
          font-family: "Meiryo UI", Meiryo, system-ui, -apple-system, sans-serif;
          color: #0f172a;
          background: #fff;
          font-size: 9pt;
          line-height: 1.12;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          display: flex;
          flex-direction: column;
          height: ${pageMm}mm;
          max-height: ${pageMm}mm;
          overflow: hidden;
          page-break-after: avoid;
          page-break-inside: avoid;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 6px;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 1px;
          margin-bottom: 1px;
          flex: 0 0 auto;
          height: ${headerMm}mm;
          max-height: ${headerMm}mm;
          overflow: hidden;
        }
        .title-block { min-width: 0; flex: 1; }
        .title {
          font-size: 12pt;
          font-weight: 900;
          color: #0f172a;
        }
        .period {
          font-size: 8.5pt;
          font-weight: 800;
          color: #047857;
          margin-left: 6px;
        }
        .legend {
          margin-top: 1px;
          font-size: 7pt;
          font-weight: 700;
          color: #334155;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .legend .lg {
          display: inline-block;
          border: 1px solid #475569;
          padding: 0 3px;
          margin-right: 2px;
          border-radius: 2px;
          font-weight: 900;
        }
        .legend .lg-loco { background: #dbeafe; }
        .legend .lg-cerebro { background: #e9e5f5; }
        .legend .lg-disuse { background: #fef3c7; }
        .legend .lg-analgesia {
          background: #059669;
          color: #fff;
          border-color: #065f46;
        }
        .legend .lg-staff {
          background: #1d4ed8;
          color: #fff;
          border-color: #1e3a8a;
        }
        .meta {
          font-size: 7.5pt;
          font-weight: 700;
          color: #334155;
          text-align: right;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .sheet-wrap {
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
        }
        table.hw-table {
          width: 100%;
          height: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          page-break-inside: avoid;
        }
        .hw-table th,
        .hw-table td {
          border: 1px solid #334155;
          vertical-align: top;
        }
        .hw-table thead th {
          background: #e2e8f0;
          font-size: 9.5pt;
          font-weight: 900;
          text-align: center;
          padding: 1px 1px;
          height: ${theadMm}mm;
          max-height: ${theadMm}mm;
          vertical-align: middle;
          color: #0f172a;
        }
        .hw-table thead th .dow {
          font-size: 10pt;
          font-weight: 900;
          letter-spacing: 0.04em;
        }
        .hw-table thead th .date {
          font-size: 9pt;
          font-weight: 900;
        }
        .hw-table thead th .hol-name {
          font-size: 6.5pt;
          font-weight: 900;
        }
        .hw-table thead th.sat {
          background: #dbeafe;
          color: #1e3a8a;
        }
        .hw-table thead th.holiday {
          background: #fecdd3;
          color: #9f1239;
        }
        .slot-row {
          height: ${rowMm}mm;
          max-height: ${rowMm}mm;
        }
        .time-col {
          width: 13mm;
          text-align: center;
          font-weight: 900;
          font-size: ${timePt}pt;
          vertical-align: middle !important;
          background: #e2e8f0;
          color: #0f172a;
          height: ${rowMm}mm;
          max-height: ${rowMm}mm;
          padding: 0;
        }
        .slot-cell {
          height: ${rowMm}mm;
          max-height: ${rowMm}mm;
          padding: 0.5mm 0.7mm;
          position: relative;
          overflow: hidden;
        }
        .slot-cell.sat { background: #f8fbff; }
        .slot-cell.holiday { background: #fff7f7; }
        .empty-cell {
          background: #ffffff !important;
        }
        .empty-time {
          position: absolute;
          top: 0.3mm;
          left: 0.5mm;
          font-size: 6pt;
          font-weight: 700;
          color: #cbd5e1;
        }
        .write-space {
          height: 100%;
          min-height: ${Math.max(3.2, rowMm - 1.5)}mm;
          border-bottom: 1px dotted #e2e8f0;
        }
        .booked-cell {
          background: #f8fafc !important;
          vertical-align: middle;
          overflow: hidden;
        }
        .booked-card {
          padding: 0.15mm 0;
          margin: 0;
        }
        .booked-card.is-analgesia {
          background: repeating-linear-gradient(
            -45deg,
            #ecfdf5,
            #ecfdf5 1.6px,
            #a7f3d0 1.6px,
            #a7f3d0 3.2px
          );
          border: 1.4px solid #047857;
          border-radius: 2px;
          padding: 0.2mm 0.8mm;
        }
        .bk-staff-row {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-bottom: 0.2mm;
          overflow: hidden;
        }
        .badge-disease,
        .badge-staff,
        .badge-analgesia {
          display: inline-block;
          line-height: 1.1;
          padding: 0.15mm 2px;
          border-radius: 2px;
          border: 1.1px solid #0f172a;
          white-space: nowrap;
          vertical-align: middle;
        }
        .badge-staff {
          font-size: ${staffPt}pt;
          font-weight: 900;
        }
        .badge-disease {
          font-size: ${badgePt}pt;
          font-weight: 800;
        }
        .badge-analgesia {
          font-size: ${analgesiaPt}pt;
          font-weight: 900;
          background: #059669;
          color: #fff;
          border-color: #065f46;
          border-width: 1.4px;
          letter-spacing: 0.04em;
          padding: 0.1mm 3px;
        }
        .dtype-loco {
          background: #dbeafe;
          color: #0f172a;
          border-color: #1e40af;
        }
        .dtype-cerebro {
          background: #e9e5f5;
          color: #0f172a;
          border-color: #5b21b6;
        }
        .dtype-disuse {
          background: #fef3c7;
          color: #0f172a;
          border-color: #b45309;
        }
        .bk-main {
          display: flex;
          flex-wrap: nowrap;
          align-items: baseline;
          gap: 2px 4px;
          overflow: hidden;
        }
        .bk-name {
          font-size: ${namePt}pt;
          font-weight: 900;
          color: #000;
          line-height: 1.05;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .bk-dur {
          font-size: ${Math.max(6.2, namePt - 1)}pt;
          font-weight: 800;
          color: #334155;
          flex-shrink: 0;
        }
        tr.lunch-band td {
          background: #cbd5e1;
          text-align: center;
          font-size: 7.5pt;
          font-weight: 900;
          color: #1e293b;
          letter-spacing: 0.1em;
          padding: 0;
          height: ${lunchMm}mm;
          max-height: ${lunchMm}mm;
          border: 1px solid #334155;
          vertical-align: middle;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          gap: 6px;
          margin-top: 0.8mm;
          font-size: 6.5pt;
          font-weight: 600;
          color: #334155;
          flex: 0 0 auto;
          height: ${footerMm}mm;
          max-height: ${footerMm}mm;
          overflow: hidden;
          page-break-inside: avoid;
        }
        @media print {
          html, body {
            height: ${pageMm}mm !important;
            max-height: ${pageMm}mm !important;
            overflow: hidden !important;
          }
          .sheet-wrap, .hw-table, .slot-row, .slot-cell {
            page-break-inside: avoid;
          }
          body {
            page-break-after: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div class="title-block">
          <div>
            <span class="title">【外来リハビリ 週間予約表（紙予約用）】</span>
            <span class="period">${periodLabel}</span>
          </div>
          <div class="legend">
            【凡例】
            <span class="lg lg-staff">担当名</span>セラピスト
            <span class="lg lg-loco">[運]</span>運動器
            <span class="lg lg-cerebro">[脳]</span>脳血管
            <span class="lg lg-disuse">[廃]</span>廃用
            <span class="lg lg-analgesia">【消炎】</span>消炎鎮痛
            ｜白い空き枠＝手書き可
          </div>
        </div>
        <div class="meta">
          出力: ${outStamp}<br>
          紙予約用／A4縦1枚完結
        </div>
      </div>

      <div class="sheet-wrap">
        <table class="hw-table">
          <thead>
            <tr>
              <th style="width:13mm;">時間</th>
              ${weekDates.map((d, idx) => {
                const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
                const holidayName = getJapaneseHolidayName(d);
                const isSat = d.getDay() === 6;
                let cls = '';
                if (holidayName) cls = 'holiday';
                else if (isSat) cls = 'sat';
                const hol = holidayName
                  ? `<div class="hol-name">${sanitizeHtml(holidayName)}</div>`
                  : '';
                return `<th class="${cls}"><div class="dow">${dayNames[idx]}</div><div class="date">${mmdd}</div>${hol}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>

      <div class="footer">
        <span>※ 予約枠＝担当タグ・患者名・【消炎】　／　空き枠＝手書き余白　／　昼休みは1行圧縮</span>
        <span>予約 ${weekAptList.length} 件／${firstSlot}〜${lastSlot} ${slotCount}枠／行高 ${rowMm.toFixed(1)}mm</span>
      </div>
      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}
