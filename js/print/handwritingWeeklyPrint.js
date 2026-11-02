// js/print/handwritingWeeklyPrint.js
// 週間予約受付簿 A4縦（portrait）・午前／午後 2ページ印刷
// ★画面の週間グリッド・予約データには一切干渉しない
// ★外来専用 OUTPATIENT_HOURS からコマ生成し、午前1枚＋午後1枚で午後欠落を根絶
// ★縦向きで行高を確保し、患者名・担当タグ・【消炎】を大きく表示する

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
 * 担当表示（フルネーム可・省略しない）
 * @param {object[]} therapists
 * @param {string} therapistId
 * @returns {string}
 */
function formatStaffBadgeLabel(therapists, therapistId) {
  if (!therapistId || therapistId === 'NONE') return '指定無';
  if (therapistId === 'ANALGESIA') return '物療';
  const staff = therapists.find((t) => t.id === therapistId);
  return String(staff?.name || therapistId).trim() || String(therapistId);
}

/**
 * 消炎鎮痛かどうか（印刷マス内バッジ用）
 * @param {object|null|undefined} patient
 * @param {object} apt
 * @returns {{ isAnalgesia: boolean }}
 */
function resolveDiseaseVisual(patient, apt) {
  const treatment = String(apt?.treatmentType || '').toUpperCase();
  const therapistId = String(apt?.therapistId || '');
  const isAnalgesia = treatment === 'ANALGESIA' || therapistId === 'ANALGESIA'
    || String(patient?.diseaseType || '').toUpperCase() === 'ANALGESIA';
  return { isAnalgesia };
}

/**
 * 同一マス内の1予約分（コンパクト1行ピル）
 * @param {object} apt
 * @param {object[]} therapists
 * @returns {string}
 */
function renderPatientPillRowHtml(apt, therapists) {
  const patient = getPatientById(apt.patientId);
  const patientName = patient?.name || apt.patientId || '';
  const staffName = formatStaffBadgeLabel(therapists, apt.therapistId);
  const isAnti = resolveDiseaseVisual(patient, apt).isAnalgesia;
  const staffTag = isAnti ? '⚡消炎' : (staffName || '担当');

  return `
    <div class="patient-pill-row ${isAnti ? 'anti' : ''}">
      <span class="staff-tag">${sanitizeHtml(staffTag)}</span>
      <span class="name-text">${sanitizeHtml(patientName)}</span>
    </div>
  `;
}

/**
 * 1ページ分の tbody 行HTMLを生成
 * ※週間マトリクス表のまま／rowspan禁止／同一マスの予約は全件描画
 * @param {object} opts
 * @returns {string}
 */
function buildPageBodyRows(opts) {
  const {
    pageSlots, weekDates, slotAptMap, therapists
  } = opts;

  let bodyRows = '';
  pageSlots.forEach((slotTime) => {
    bodyRows += `<tr class="slot-row">`;
    bodyRows += `<td class="time-col">${slotTime}</td>`;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isSat = d.getDay() === 6;
      const holidayName = getJapaneseHolidayName(d);
      const key = `${dateStr}_${slotTime}`;
      // 該当する全予約（配列要素数に関わらず全て描画）
      const slotResList = slotAptMap[key] || [];

      let extraClass = '';
      if (holidayName) extraClass += ' holiday';
      else if (isSat) extraClass += ' sat';

      if (slotResList.length === 0) {
        bodyRows += `<td class="res-slot empty-slot day-col-slot${extraClass}"></td>`;
        return;
      }

      const cardsHtml = slotResList.map((res) => renderPatientPillRowHtml(res, therapists)).join('');
      bodyRows += `
        <td class="res-slot day-col-slot${extraClass}">
          <div class="slot-patients-container">
            ${cardsHtml}
          </div>
        </td>
      `;
    });

    bodyRows += `</tr>`;
  });

  return bodyRows;
}

/**
 * 行高・フォントサイズをページ枠数から算出（A4縦・余白込みで収める）
 * @param {number} slotCount
 */
function computePageMetrics(slotCount) {
  // A4縦: 297 - 5 - 4 = 288mm／午前・午後で枠数が違っても行高を均等分配
  const pageMm = 288;
  const headerMm = 14;
  const theadMm = 8;
  const footerMm = 5;
  const borderFudgeMm = Math.min(10, 2 + slotCount * 0.18);
  const dataAreaMm = Math.max(190, pageMm - headerMm - theadMm - footerMm - borderFudgeMm);
  const rawRow = dataAreaMm / Math.max(1, slotCount);
  // 上下余白を保ちつつマス目を均等に（過剰な嵩上げはしない）
  const rowMm = Math.min(20, Math.max(11.5, rawRow));
  // 患者名〜11pt固定寄り／時間列は10ptに引き締め
  const namePt = rowMm >= 14 ? 11.5 : 11;
  const staffPt = 8;
  const analgesiaPt = 8;
  const timePt = 10;
  return {
    pageMm, headerMm, theadMm, footerMm, rowMm, namePt, staffPt, analgesiaPt, timePt
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
    namePt, staffPt, analgesiaPt, timePt
  } = metrics;

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
            <span class="chip chip-staff">担当</span>
            <span class="chip chip-analgesia">⚡消炎</span>
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
                  ? `<div class="hol-name">${sanitizeHtml(holidayName)}</div>`
                  : '';
                return `<th class="${cls}"><span class="dow">${dayNames[idx]}</span><span class="date">${mmdd}</span>${hol}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
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
          --name-pt: ${namePt}pt;
          --staff-pt: ${staffPt}pt;
          --analgesia-pt: ${analgesiaPt}pt;
          --time-pt: ${timePt}pt;
        }
      </style>
    </section>
  `;
}

/**
 * 週間予約受付簿（A4縦・午前1枚＋午後1枚）を印刷する
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

  // スタッフ設定・外来専用時間を動的反映
  // 午前: 診療開始〜午前終了(amEnd)直前まで／午後: 午後開始(pmStart)〜終了
  const amEndSetting = String(OUTPATIENT_HOURS?.amEnd || DEFAULT_PM_SPLIT);
  const pmSplit = String(OUTPATIENT_HOURS?.pmStart || DEFAULT_PM_SPLIT);
  const amSlots = allSlotTimes.filter((t) => String(t) < pmSplit);
  const pmSlots = allSlotTimes.filter((t) => String(t) >= pmSplit);

  if (!amSlots.length && !pmSlots.length) {
    showToast('印刷可能な時間枠がありません（スタッフ設定の外来提供時間を確認してください）', 'warn');
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
    const metrics = computePageMetrics(amSlots.length);
    const amFirst = amSlots[0] || '09:00';
    pages.push({
      pageKey: 'am',
      pageLabel: `午前（${amFirst}〜${amEndSetting}）`,
      pageBadgeClass: 'badge-am',
      pageSlots: amSlots,
      bodyRows: buildPageBodyRows({
        pageSlots: amSlots, weekDates, slotAptMap, therapists
      }),
      metrics
    });
  }
  if (pmSlots.length) {
    const metrics = computePageMetrics(pmSlots.length);
    const pmLast = pmSlots[pmSlots.length - 1] || String(OUTPATIENT_HOURS?.pmEnd || '18:00');
    pages.push({
      pageKey: 'pm',
      pageLabel: `午後（${pmSplit}〜${pmLast}）`,
      pageBadgeClass: 'badge-pm',
      pageSlots: pmSlots,
      bodyRows: buildPageBodyRows({
        pageSlots: pmSlots, weekDates, slotAptMap, therapists
      }),
      metrics
    });
  }

  const printWindow = window.open('', '_blank', 'width=900,height=1200');
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
          size: A4 portrait;
          margin: 5mm 5mm 4mm 5mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
          width: 100%;
          background: #fff;
          color: #0f172a;
          font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo UI", Meiryo, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body { font-size: 10pt; line-height: 1.25; color: #1e293b; }
        .sheet-page {
          width: 100%;
          min-height: var(--page-mm, 288mm);
          height: auto;
          display: flex;
          flex-direction: column;
          overflow: visible;
          page-break-after: always;
          break-after: page;
        }
        .sheet-page-last { page-break-after: auto; break-after: auto; }

        /* —— ヘッダー（凡例崩れ防止・右上チップ） —— */
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          border-bottom: 1px solid #cbd5e1;
          padding-bottom: 3px;
          margin-bottom: 3px;
          flex: 0 0 auto;
          min-height: var(--header-mm, 14mm);
          max-height: 16mm;
          overflow: visible;
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
          font-weight: 700;
          color: #0f172a;
          letter-spacing: 0.02em;
        }
        .page-badge {
          display: inline-flex;
          align-items: center;
          font-size: 9pt;
          font-weight: 700;
          padding: 2px 10px;
          border-radius: 999px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #334155;
        }
        .page-badge.badge-am {
          background: #eff6ff;
          color: #1d4ed8;
          border-color: #bfdbfe;
        }
        .page-badge.badge-pm {
          background: #fff7ed;
          color: #c2410c;
          border-color: #fed7aa;
        }
        .period {
          margin-top: 2px;
          font-size: 8.5pt;
          font-weight: 600;
          color: #64748b;
        }
        .header-right {
          flex-shrink: 0;
          text-align: right;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 3px;
        }
        .legend-chips {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 4px;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          font-size: 7.5pt;
          font-weight: 700;
          padding: 1px 8px;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #475569;
          white-space: nowrap;
        }
        .chip-staff {
          background: #1d4ed8;
          color: #ffffff;
          border-color: #1d4ed8;
        }
        .chip-analgesia {
          background: #d97706;
          color: #ffffff;
          border-color: #d97706;
        }
        .chip-empty {
          background: #fff;
          color: #64748b;
          border-color: #cbd5e1;
        }
        .meta {
          font-size: 7pt;
          font-weight: 600;
          color: #94a3b8;
          white-space: nowrap;
        }

        .sheet-wrap {
          flex: 1 1 auto;
          min-height: 0;
          overflow: visible;
        }
        table.hw-table {
          width: 100%;
          height: auto;
          border-collapse: collapse;
          table-layout: fixed;
        }
        /* 極細スレートグレー枠線 */
        .hw-table th,
        .hw-table td {
          border: 0.5px solid #cbd5e1;
          vertical-align: top;
        }
        .hw-table thead th {
          background: #f8fafc;
          font-size: 9.5pt;
          font-weight: 700;
          text-align: center;
          padding: 2px 2px;
          height: var(--thead-mm, 9mm);
          max-height: var(--thead-mm, 9mm);
          vertical-align: middle;
          color: #334155;
        }
        .hw-table thead th.th-time {
          width: 9.5%;
          color: #64748b;
          font-size: 8pt;
        }
        .hw-table thead th .dow {
          display: block;
          font-size: 9pt;
          font-weight: 700;
          color: #0f172a;
        }
        .hw-table thead th .date {
          display: block;
          font-size: 8.5pt;
          font-weight: 600;
          color: #64748b;
        }
        .hw-table thead th .hol-name {
          font-size: 6.5pt;
          font-weight: 700;
          color: #e11d48;
        }
        .hw-table thead th.sat { background: #f0f9ff; }
        .hw-table thead th.sat .dow { color: #0369a1; }
        .hw-table thead th.holiday { background: #fff1f2; }
        .hw-table thead th.holiday .dow { color: #e11d48; }

        .slot-row {
          height: auto;
          min-height: var(--row-mm, 12mm);
        }
        /* 時間列：10pt・幅9.5%にスリム化 */
        .time-col {
          width: 9.5%;
          text-align: center;
          font-weight: 700;
          font-size: 10pt;
          font-variant-numeric: tabular-nums;
          vertical-align: middle !important;
          background: #f8fafc;
          color: #64748b;
          height: auto;
          min-height: var(--row-mm, 12mm);
          padding: 0 1mm;
          letter-spacing: 0.01em;
        }
        td.res-slot,
        .day-col-slot {
          vertical-align: top !important;
          padding: 2px !important;
          height: auto;
        }
        .res-slot.sat { background: #fafcff; }
        .res-slot.holiday { background: #fffafa; }
        .empty-slot { background: #ffffff !important; }

        /* 複数患者が入るラッパー */
        .slot-patients-container {
          display: flex;
          flex-direction: column;
          gap: 2px;
          width: 100%;
          height: 100%;
          justify-content: flex-start;
        }

        /* 個別患者の1行コンパクトバブル（複数人対応） */
        .patient-pill-row {
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 1.5px 3px;
          border-radius: 3px;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-left: 3px solid #1d4ed8;
          box-sizing: border-box;
          width: 100%;
          overflow: hidden;
        }

        /* 消炎鎮痛の場合のアクセント */
        .patient-pill-row.anti {
          background: #fffbeb;
          border-color: #fde68a;
          border-left: 3px solid #d97706;
        }

        /* 担当者バッジ */
        .patient-pill-row .staff-tag {
          font-size: 7.5pt;
          font-weight: 800;
          padding: 1px 4px;
          border-radius: 2px;
          background: #1d4ed8;
          color: #ffffff;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .patient-pill-row.anti .staff-tag {
          background: #d97706;
        }

        /* 患者氏名（フルネーム太字・1行で収める） */
        .patient-pill-row .name-text {
          font-size: 9pt;
          font-weight: 800;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-grow: 1;
          line-height: 1.2;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-top: 2mm;
          padding-top: 2px;
          border-top: 1px solid #e2e8f0;
          font-size: 7.5pt;
          font-weight: 600;
          color: #94a3b8;
          flex: 0 0 auto;
          height: var(--footer-mm, 6mm);
          max-height: var(--footer-mm, 6mm);
          overflow: hidden;
        }
        @media print {
          .sheet-page {
            min-height: var(--page-mm, 288mm) !important;
            height: auto !important;
            overflow: visible !important;
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
