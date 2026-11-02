// js/print/handwritingWeeklyPrint.js
// 週間予約受付簿 A4横・午前／午後 2ページ印刷
// ★画面の週間グリッド・予約データには一切干渉しない
// ★外来専用 OUTPATIENT_HOURS からコマ生成し、午前1枚＋午後1枚で午後欠落を根絶

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

/** 午前／午後の分割境界（既定 13:00＝ユーザー指定の午後開始） */
const DEFAULT_PM_SPLIT = '13:00';

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
 * ページ内スロット用の rowspan スキップ集合を構築（ページ境界をまたがない）
 * @param {string[]} pageSlots
 * @param {Date[]} weekDates
 * @param {Record<string, object[]>} slotAptMap
 * @returns {Set<string>}
 */
function buildPageRowspanSkip(pageSlots, weekDates, slotAptMap) {
  const rowspanSkip = new Set();
  weekDates.forEach((d) => {
    const dateStr = formatDateYMD(d);
    pageSlots.forEach((slotTime, idx) => {
      const key = `${dateStr}_${slotTime}`;
      if (rowspanSkip.has(key)) return;
      const apts = slotAptMap[key] || [];
      if (apts.length !== 1) return;
      const span = getAptSlotSpan(apts[0]);
      if (span <= 1) return;
      for (let i = 1; i < span; i += 1) {
        const next = pageSlots[idx + i];
        if (!next) break;
        const nextKey = `${dateStr}_${next}`;
        if ((slotAptMap[nextKey] || []).length > 0) break;
        rowspanSkip.add(nextKey);
      }
    });
  });
  return rowspanSkip;
}

/**
 * 1ページ分の tbody 行HTMLを生成
 * @param {object} opts
 * @returns {string}
 */
function buildPageBodyRows(opts) {
  const {
    pageSlots, weekDates, slotAptMap, therapists, rowspanSkip
  } = opts;

  let bodyRows = '';
  pageSlots.forEach((slotTime, slotIdx) => {
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
            <div class="write-space"></div>
          </td>
        `;
        return;
      }

      let rowspan = 1;
      if (apts.length === 1) {
        const span = getAptSlotSpan(apts[0]);
        let actual = 1;
        for (let i = 1; i < span; i += 1) {
          const next = pageSlots[slotIdx + i];
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

  return bodyRows;
}

/**
 * 行高・フォントサイズをページ枠数から算出（A4横・余白込みで収める）
 * @param {number} slotCount
 */
function computePageMetrics(slotCount) {
  // A4横: 210 - 5 - 5 = 200mm
  const pageMm = 200;
  const headerMm = 14;
  const theadMm = 8;
  const footerMm = 6;
  const borderFudgeMm = Math.min(10, 2 + slotCount * 0.2);
  const dataAreaMm = Math.max(120, pageMm - headerMm - theadMm - footerMm - borderFudgeMm);
  const rawRow = dataAreaMm / Math.max(1, slotCount);
  // 嵩上げ禁止（ページ内クリップ防止）。2枚分割で通常 11mm超の行高になる
  const rowMm = Math.min(16, rawRow);
  const namePt = rowMm >= 13 ? 12.5 : (rowMm >= 11 ? 11.5 : (rowMm >= 9 ? 10.5 : 9.5));
  const staffPt = rowMm >= 13 ? 11.5 : (rowMm >= 11 ? 10.5 : (rowMm >= 9 ? 9.5 : 8.5));
  const badgePt = rowMm >= 13 ? 10.5 : (rowMm >= 11 ? 9.5 : 8.5);
  const analgesiaPt = Math.max(staffPt + 0.8, badgePt + 1.2);
  const timePt = rowMm >= 12 ? 11.5 : (rowMm >= 9 ? 10.5 : 9.5);
  return {
    pageMm, headerMm, theadMm, footerMm, rowMm, namePt, staffPt, badgePt, analgesiaPt, timePt
  };
}

/**
 * @param {object} opts
 * @returns {string}
 */
function renderSheetPage(opts) {
  const {
    pageKey, pageLabel, pageBadgeClass, periodLabel, outStamp,
    pageSlots, weekDates, dayNames, bodyRows, weekAptCount, metrics, isLast
  } = opts;

  const first = pageSlots[0] || '-';
  const last = pageSlots[pageSlots.length - 1] || '-';
  const {
    pageMm, headerMm, theadMm, footerMm, rowMm,
    namePt, staffPt, badgePt, analgesiaPt, timePt
  } = metrics;

  return `
    <section class="sheet-page ${isLast ? 'sheet-page-last' : ''}" data-page="${sanitizeHtml(pageKey)}">
      <div class="page-header">
        <div class="title-block">
          <div class="title-line">
            <span class="title">【外来リハビリ 週間予約受付簿】</span>
            <span class="page-badge ${pageBadgeClass}">${sanitizeHtml(pageLabel)}</span>
            <span class="period">${periodLabel}</span>
          </div>
          <div class="legend">
            【凡例】
            <span class="lg lg-staff">担当名</span>色分け＝セラピスト
            <span class="lg lg-loco">[運]</span>運動器
            <span class="lg lg-cerebro">[脳]</span>脳血管
            <span class="lg lg-disuse">[廃]</span>廃用
            <span class="lg lg-analgesia">【消炎】</span>消炎鎮痛
            ｜白い空き枠＝手書き可
          </div>
        </div>
        <div class="meta">
          出力: ${outStamp}<br>
          A4横・${sanitizeHtml(pageLabel)}／全2頁
        </div>
      </div>

      <div class="sheet-wrap">
        <table class="hw-table">
          <thead>
            <tr>
              <th style="width:14mm;">時間</th>
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
                return `<th class="${cls}">${dayNames[idx]} ${mmdd}${hol}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>

      <div class="footer">
        <span>※ 色付き担当バッジ＝セラピスト即時把握　／　【消炎】＝消炎鎮痛　／　空き枠は手書き可</span>
        <span>${sanitizeHtml(pageLabel)} ${first}〜${last}（${pageSlots.length}枠）／週予約 ${weekAptCount} 件／行高 ${rowMm.toFixed(1)}mm</span>
      </div>
      <style>
        .sheet-page[data-page="${sanitizeHtml(pageKey)}"] {
          --row-mm: ${rowMm}mm;
          --header-mm: ${headerMm}mm;
          --thead-mm: ${theadMm}mm;
          --footer-mm: ${footerMm}mm;
          --page-mm: ${pageMm}mm;
          --name-pt: ${namePt}pt;
          --staff-pt: ${staffPt}pt;
          --badge-pt: ${badgePt}pt;
          --analgesia-pt: ${analgesiaPt}pt;
          --time-pt: ${timePt}pt;
        }
      </style>
    </section>
  `;
}

/**
 * 週間予約受付簿（A4横・午前1枚＋午後1枚）を印刷する
 * @param {Date} baseDate
 */
export function printHandwritingWeeklySheet(baseDate) {
  const weekDates = getWeekDates(baseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);
  const allSlotTimes = resolvePrintSlotTimes();

  if (!allSlotTimes.length) {
    showToast('外来予約の時間枠が未設定のため印刷できません', 'warn');
    return;
  }

  // 分割境界: 外来 pmStart（既定13:00）。午前＝境界未満／午後＝境界以上
  const pmSplit = String(OUTPATIENT_HOURS?.pmStart || DEFAULT_PM_SPLIT);
  const amSlots = allSlotTimes.filter((t) => String(t) < pmSplit);
  const pmSlots = allSlotTimes.filter((t) => String(t) >= pmSplit);

  if (!amSlots.length && !pmSlots.length) {
    showToast('印刷可能な時間枠がありません', 'warn');
    return;
  }

  const allAppointments = getAllAppointments();
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  const weekAptList = Object.values(allAppointments).filter((apt) => {
    return apt && apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date);
  });

  // 吸着は全日スロット基準（ページ分割で予約が落ちない）
  const slotAptMap = {};
  weekAptList.forEach((apt) => {
    const snapped = snapToNearestAppointmentSlot(apt.startTime, allSlotTimes);
    const k = `${apt.date}_${snapped}`;
    if (!slotAptMap[k]) slotAptMap[k] = [];
    slotAptMap[k].push(apt);
  });

  const therapists = getAllTherapists();
  const dayNames = ['月', '火', '水', '木', '金', '土'];
  const now = new Date();
  const outStamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const periodLabel = `${startStr.slice(0, 4)}年${Number(startStr.slice(5, 7))}月${Number(startStr.slice(8, 10))}日(月) 〜 ${endStr.slice(0, 4)}年${Number(endStr.slice(5, 7))}月${Number(endStr.slice(8, 10))}日(土)`;

  const pages = [];
  if (amSlots.length) {
    const rowspanSkip = buildPageRowspanSkip(amSlots, weekDates, slotAptMap);
    const metrics = computePageMetrics(amSlots.length);
    const amEndLabel = amSlots[amSlots.length - 1] || '12:00';
    pages.push({
      pageKey: 'am',
      pageLabel: `午前（〜${amEndLabel}）`,
      pageBadgeClass: 'badge-am',
      pageSlots: amSlots,
      bodyRows: buildPageBodyRows({
        pageSlots: amSlots, weekDates, slotAptMap, therapists, rowspanSkip
      }),
      metrics
    });
  }
  if (pmSlots.length) {
    const rowspanSkip = buildPageRowspanSkip(pmSlots, weekDates, slotAptMap);
    const metrics = computePageMetrics(pmSlots.length);
    const pmLast = pmSlots[pmSlots.length - 1] || '18:00';
    pages.push({
      pageKey: 'pm',
      pageLabel: `午後（${pmSlots[0] || pmSplit}〜${pmLast}）`,
      pageBadgeClass: 'badge-pm',
      pageSlots: pmSlots,
      bodyRows: buildPageBodyRows({
        pageSlots: pmSlots, weekDates, slotAptMap, therapists, rowspanSkip
      }),
      metrics
    });
  }

  const printWindow = window.open('', '_blank', 'width=1200,height=900');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  const pagesHtml = pages.map((p, idx) => renderSheetPage({
    ...p,
    periodLabel,
    outStamp,
    weekDates,
    dayNames,
    weekAptCount: weekAptList.length,
    isLast: idx === pages.length - 1
  })).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>外来リハビリ 週間予約受付簿 午前・午後 (${startStr.replace(/-/g, '/')}〜)</title>
      <style>
        @page {
          size: A4 landscape;
          margin: 5mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
          width: 100%;
          background: #fff;
          color: #0f172a;
          font-family: "Meiryo UI", Meiryo, system-ui, -apple-system, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body {
          font-size: 10pt;
          line-height: 1.15;
        }
        .sheet-page {
          width: 100%;
          height: var(--page-mm, 200mm);
          max-height: var(--page-mm, 200mm);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          page-break-after: always;
          break-after: page;
        }
        .sheet-page-last {
          page-break-after: auto;
          break-after: auto;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 2px;
          margin-bottom: 2px;
          flex: 0 0 auto;
          height: var(--header-mm, 14mm);
          max-height: var(--header-mm, 14mm);
          overflow: hidden;
        }
        .title-block { min-width: 0; flex: 1; }
        .title-line {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px 8px;
        }
        .title {
          font-size: 13pt;
          font-weight: 900;
          color: #0f172a;
        }
        .page-badge {
          display: inline-block;
          font-size: 11pt;
          font-weight: 900;
          padding: 1px 10px;
          border-radius: 4px;
          border: 1.5px solid #0f172a;
          letter-spacing: 0.04em;
        }
        .page-badge.badge-am {
          background: #dbeafe;
          color: #1e3a8a;
          border-color: #1d4ed8;
        }
        .page-badge.badge-pm {
          background: #ffedd5;
          color: #9a3412;
          border-color: #ea580c;
        }
        .period {
          font-size: 9.5pt;
          font-weight: 800;
          color: #047857;
        }
        .legend {
          margin-top: 2px;
          font-size: 8pt;
          font-weight: 700;
          color: #334155;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .legend .lg {
          display: inline-block;
          border: 1.2px solid #475569;
          padding: 0 4px;
          margin-right: 2px;
          border-radius: 2px;
          font-weight: 900;
        }
        .legend .lg-loco { background: #dbeafe; }
        .legend .lg-cerebro { background: #e9e5f5; }
        .legend .lg-disuse { background: #fef3c7; }
        .legend .lg-analgesia {
          background: #059669;
          color: #ffffff;
          border-color: #065f46;
        }
        .legend .lg-staff {
          background: #1d4ed8;
          color: #ffffff;
          border-color: #1e3a8a;
        }
        .meta {
          font-size: 8.5pt;
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
        }
        .hw-table th,
        .hw-table td {
          border: 1.2px solid #334155;
          vertical-align: top;
        }
        .hw-table thead th {
          background: #e2e8f0;
          font-size: 10pt;
          font-weight: 900;
          text-align: center;
          padding: 1px 2px;
          height: var(--thead-mm, 8mm);
          max-height: var(--thead-mm, 8mm);
          vertical-align: middle;
          color: #0f172a;
        }
        .hw-table thead th .hol-name {
          font-size: 7.5pt;
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
          height: var(--row-mm, 12mm);
          max-height: var(--row-mm, 12mm);
        }
        .time-col {
          width: 14mm;
          text-align: center;
          font-weight: 900;
          font-size: var(--time-pt, 11pt);
          vertical-align: middle !important;
          background: #e2e8f0;
          color: #0f172a;
          height: var(--row-mm, 12mm);
          max-height: var(--row-mm, 12mm);
          padding: 0;
        }
        .slot-cell {
          height: var(--row-mm, 12mm);
          max-height: var(--row-mm, 12mm);
          padding: 0.8mm 1.2mm;
          position: relative;
          overflow: hidden;
        }
        .slot-cell.sat { background: #f8fbff; }
        .slot-cell.holiday { background: #fff7f7; }
        .empty-cell { background: #ffffff !important; }
        .empty-time {
          position: absolute;
          top: 0.5mm;
          left: 0.8mm;
          font-size: 8pt;
          font-weight: 700;
          color: #94a3b8;
        }
        .write-space { height: 100%; min-height: 6mm; }
        .booked-cell {
          background: #f8fafc !important;
          vertical-align: middle;
          overflow: hidden;
        }
        .booked-card {
          padding: 0.3mm 0;
          margin: 0;
        }
        .booked-card.is-analgesia {
          background: repeating-linear-gradient(
            -45deg,
            #ecfdf5,
            #ecfdf5 2px,
            #a7f3d0 2px,
            #a7f3d0 4px
          );
          border: 2px solid #047857;
          border-radius: 3px;
          padding: 0.5mm 1.2mm;
        }
        .bk-staff-row {
          display: flex;
          align-items: center;
          gap: 3px;
          margin-bottom: 0.6mm;
          overflow: hidden;
        }
        .badge-disease,
        .badge-staff,
        .badge-analgesia {
          display: inline-block;
          line-height: 1.15;
          padding: 0.4mm 3px;
          border-radius: 3px;
          border: 1.4px solid #0f172a;
          white-space: nowrap;
          vertical-align: middle;
        }
        .badge-staff {
          font-size: var(--staff-pt, 10pt);
          font-weight: 900;
          letter-spacing: 0.03em;
        }
        .badge-disease {
          font-size: var(--badge-pt, 9pt);
          font-weight: 800;
        }
        .badge-analgesia {
          font-size: var(--analgesia-pt, 11pt);
          font-weight: 900;
          background: #059669;
          color: #ffffff;
          border-color: #065f46;
          border-width: 1.8px;
          letter-spacing: 0.06em;
          padding: 0.4mm 5px;
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
          gap: 4px 6px;
          overflow: hidden;
        }
        .bk-name {
          font-size: var(--name-pt, 11pt);
          font-weight: 900;
          color: #000000;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .bk-dur {
          font-size: 9pt;
          font-weight: 800;
          color: #334155;
          flex-shrink: 0;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-top: 1mm;
          font-size: 7.5pt;
          font-weight: 600;
          color: #334155;
          flex: 0 0 auto;
          height: var(--footer-mm, 6mm);
          max-height: var(--footer-mm, 6mm);
          overflow: hidden;
        }
        @media print {
          .sheet-page {
            height: var(--page-mm, 200mm) !important;
            max-height: var(--page-mm, 200mm) !important;
            overflow: hidden !important;
          }
          .sheet-page:not(.sheet-page-last) {
            page-break-after: always !important;
          }
        }
      </style>
    </head>
    <body>
      ${pagesHtml}
      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}
