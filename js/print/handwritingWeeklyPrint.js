// js/print/handwritingWeeklyPrint.js
// 週間予約受付簿 A4縦（portrait）・午前／午後 2ページ印刷
// ★画面の週間グリッド・予約データには一切干渉しない
// ★外来専用 OUTPATIENT_HOURS からコマ生成し、午前1枚＋午後1枚で午後欠落を根絶
// ★縦向きで行高を確保し、患者名・担当タグ・【消炎】を大きく表示する

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
  const dur = Number(apt.durationMinutes) || 20;
  const vis = resolveDiseaseVisual(patient, apt);

  const diseaseBadge = vis.isAnalgesia
    ? `<span class="badge-analgesia" title="消炎鎮痛">⚡ 消炎鎮痛</span>`
    : `<span class="badge-disease ${vis.diseaseClass}">${sanitizeHtml(vis.diseaseTag)}</span>`;

  return `
    <div class="booked-card${vis.isAnalgesia ? ' is-analgesia' : ''}">
      <div class="bk-staff-row">
        <span class="badge-staff">[${sanitizeHtml(staffLabel)}]</span>
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
        // 左列時間軸があるためセル内の重複時刻は出さない（手書き余白のみ）
        bodyRows += `
          <td class="${tdClass} empty-cell">
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
 * 行高・フォントサイズをページ枠数から算出（A4縦・余白込みで収める）
 * @param {number} slotCount
 */
function computePageMetrics(slotCount) {
  // A4縦: 297 - 5 - 4 = 288mm（横向きより縦幅が広く、患者名の縦並びを収容）
  const pageMm = 288;
  const headerMm = 16;
  const theadMm = 9;
  const footerMm = 5.5;
  const borderFudgeMm = Math.min(12, 2.5 + slotCount * 0.22);
  const dataAreaMm = Math.max(180, pageMm - headerMm - theadMm - footerMm - borderFudgeMm);
  const rawRow = dataAreaMm / Math.max(1, slotCount);
  // 嵩上げ禁止。午前〜12枠／午後〜15枠なら行高 16〜21mm 程度で大文字表示が可能
  const rowMm = Math.min(22, rawRow);
  const namePt = rowMm >= 18 ? 14 : (rowMm >= 15 ? 13 : (rowMm >= 12 ? 12 : 10.5));
  const staffPt = rowMm >= 18 ? 13 : (rowMm >= 15 ? 12 : (rowMm >= 12 ? 11 : 9.5));
  const badgePt = rowMm >= 18 ? 12 : (rowMm >= 15 ? 11 : (rowMm >= 12 ? 10 : 9));
  const analgesiaPt = Math.max(staffPt + 1, badgePt + 1.5);
  const timePt = rowMm >= 16 ? 13 : (rowMm >= 12 ? 12 : 10.5);
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
            <span class="title">外来リハビリ 週間予約受付簿</span>
            <span class="page-badge ${pageBadgeClass}">${sanitizeHtml(pageLabel)}</span>
          </div>
          <div class="period">${periodLabel}</div>
        </div>
        <div class="header-right">
          <div class="legend-chips">
            <span class="chip chip-staff">担当</span>
            <span class="chip chip-analgesia">⚡ 消炎</span>
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
          --badge-pt: ${badgePt}pt;
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
    const rowspanSkip = buildPageRowspanSkip(amSlots, weekDates, slotAptMap);
    const metrics = computePageMetrics(amSlots.length);
    const amFirst = amSlots[0] || '09:00';
    pages.push({
      pageKey: 'am',
      pageLabel: `午前（${amFirst}〜${amEndSetting}）`,
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
    const pmLast = pmSlots[pmSlots.length - 1] || String(OUTPATIENT_HOURS?.pmEnd || '18:00');
    pages.push({
      pageKey: 'pm',
      pageLabel: `午後（${pmSplit}〜${pmLast}）`,
      pageBadgeClass: 'badge-pm',
      pageSlots: pmSlots,
      bodyRows: buildPageBodyRows({
        pageSlots: pmSlots, weekDates, slotAptMap, therapists, rowspanSkip
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
          height: var(--page-mm, 288mm);
          max-height: var(--page-mm, 288mm);
          display: flex;
          flex-direction: column;
          overflow: hidden;
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
          min-height: var(--header-mm, 15mm);
          max-height: 18mm;
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
          background: #eff6ff;
          color: #1d4ed8;
          border-color: #bfdbfe;
        }
        .chip-analgesia {
          background: #fffbeb;
          color: #b45309;
          border-color: #fde68a;
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
          overflow: hidden;
        }
        table.hw-table {
          width: 100%;
          height: 100%;
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
        .hw-table thead th.th-time { width: 14mm; color: #64748b; font-size: 8.5pt; }
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
          height: var(--row-mm, 18mm);
          max-height: var(--row-mm, 18mm);
        }
        .time-col {
          width: 14mm;
          text-align: center;
          font-weight: 700;
          font-size: var(--time-pt, 11pt);
          vertical-align: middle !important;
          background: #f8fafc;
          color: #475569;
          height: var(--row-mm, 18mm);
          max-height: var(--row-mm, 18mm);
          padding: 0;
        }
        .slot-cell {
          height: var(--row-mm, 18mm);
          max-height: var(--row-mm, 18mm);
          padding: 1.2mm 1.6mm;
          position: relative;
          overflow: hidden;
        }
        .slot-cell.sat { background: #fafcff; }
        .slot-cell.holiday { background: #fffafa; }
        .empty-cell { background: #ffffff !important; }
        .write-space {
          height: 100%;
          min-height: 7mm;
          border-radius: 2px;
        }

        .booked-cell {
          background: #ffffff !important;
          vertical-align: middle;
          overflow: hidden;
        }
        .booked-card {
          padding: 0.2mm 0;
          margin: 0;
        }
        /* 消炎：アイボリー＋琥珀色左アクセント */
        .booked-card.is-analgesia {
          background: #fffbeb;
          border: none;
          border-left: 3px solid #d97706;
          border-radius: 0 3px 3px 0;
          padding: 0.8mm 1.4mm 0.8mm 1.8mm;
        }
        .bk-staff-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 3px;
          margin-bottom: 0.8mm;
        }
        .badge-disease,
        .badge-staff,
        .badge-analgesia {
          display: inline-flex;
          align-items: center;
          line-height: 1.2;
          vertical-align: middle;
          white-space: nowrap;
        }
        /* 淡いブルーの担当ピル */
        .badge-staff {
          font-size: var(--staff-pt, 9pt);
          font-weight: 700;
          padding: 1px 7px;
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
          letter-spacing: 0.01em;
        }
        .badge-disease {
          font-size: var(--badge-pt, 8pt);
          font-weight: 600;
          padding: 0 5px;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #64748b;
        }
        .badge-analgesia {
          font-size: var(--analgesia-pt, 8.5pt);
          font-weight: 700;
          padding: 1px 7px;
          border-radius: 999px;
          background: #fffbeb;
          color: #b45309;
          border: 1px solid #fde68a;
          letter-spacing: 0.02em;
        }
        .dtype-loco { background: #f0f9ff; color: #0369a1; border-color: #bae6fd; }
        .dtype-cerebro { background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; }
        .dtype-disuse { background: #fffbeb; color: #a16207; border-color: #fde68a; }

        .bk-main {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 2px 6px;
        }
        .bk-name {
          font-size: var(--name-pt, 12pt);
          font-weight: 700;
          color: #0f172a;
          line-height: 1.25;
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
          letter-spacing: 0.02em;
        }
        .bk-dur {
          font-size: 8pt;
          font-weight: 600;
          color: #94a3b8;
          flex-shrink: 0;
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
            height: var(--page-mm, 288mm) !important;
            max-height: var(--page-mm, 288mm) !important;
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
