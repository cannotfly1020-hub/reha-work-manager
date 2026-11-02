// js/print/handwritingWeeklyPrint.js
// 週間予約受付簿 A4縦印刷（手書き余白完備・疾患／消炎／担当の視認性強化）
// ★画面の週間グリッドには一切干渉しない。
// ★外来専用 OUTPATIENT_HOURS から午前〜午後の全コマを生成し、A4縦1枚に収めて午後切れを防ぐ。

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
 * メモリ配列が空／欠落していても OUTPATIENT_HOURS から再生成する
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
 * 所要時間（分）→ 20分コマ数
 * @param {{ durationMinutes?: number }} apt
 * @returns {number}
 */
function getAptSlotSpan(apt) {
  const duration = Math.max(1, Number(apt?.durationMinutes) || 20);
  return Math.max(1, Math.ceil(duration / 20));
}

/** 担当セラピスト識別用カラーパレット（印刷でも判別しやすい濃色） */
const STAFF_BADGE_PALETTE = Object.freeze([
  { bg: '#1d4ed8', fg: '#ffffff', border: '#1e3a8a' }, // 青
  { bg: '#b45309', fg: '#ffffff', border: '#92400e' }, // 琥珀
  { bg: '#6d28d9', fg: '#ffffff', border: '#4c1d95' }, // 紫
  { bg: '#be123c', fg: '#ffffff', border: '#9f1239' }, // 薔薇
  { bg: '#0f766e', fg: '#ffffff', border: '#115e59' }, // ティール
  { bg: '#c2410c', fg: '#ffffff', border: '#9a3412' }, // 橙
  { bg: '#0369a1', fg: '#ffffff', border: '#075985' }, // 空
  { bg: '#4d7c0f', fg: '#ffffff', border: '#3f6212' }  // オリーブ
]);

/**
 * 担当表示ラベル（バッジ用）
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
 * 担当IDから安定したバッジ色を返す（同一担当＝常に同色）
 * @param {string} therapistId
 * @returns {{ bg: string, fg: string, border: string, special?: string }}
 */
function resolveStaffBadgeColor(therapistId) {
  if (!therapistId || therapistId === 'NONE') {
    return { bg: '#475569', fg: '#ffffff', border: '#334155', special: 'none' };
  }
  if (therapistId === 'ANALGESIA') {
    return { bg: '#047857', fg: '#ffffff', border: '#065f46', special: 'analgesia-staff' };
  }
  const id = String(therapistId);
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % STAFF_BADGE_PALETTE.length;
  return STAFF_BADGE_PALETTE[idx];
}

/**
 * 患者マスター＋予約から疾患／消炎を安全に解決する
 * @param {object|null|undefined} patient
 * @param {object} apt
 * @returns {{ isAnalgesia: boolean, diseaseType: string, diseaseTag: string, diseaseClass: string }}
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
  const tagMap = {
    LOCOMOTIVE: '運',
    CEREBROVASCULAR: '脳',
    DISUSE: '廃'
  };
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
 * 予約1件分のカードHTML（担当色バッジ＋消炎強調・大文字）
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
 * 週間予約受付簿（A4縦・1枚ジャスト収容）を印刷する
 * @param {Date} baseDate
 */
export function printHandwritingWeeklySheet(baseDate) {
  const weekDates = getWeekDates(baseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);
  // 外来専用設定から 09:00〜18:00 等の全日コマを取得（午前のみ切り捨て防止）
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
      if (apts.length === 1) {
        const span = getAptSlotSpan(apts[0]);
        if (span > 1) {
          for (let i = 1; i < span; i += 1) {
            const next = allSlotTimes[idx + i];
            if (!next) break;
            const nextKey = `${dateStr}_${next}`;
            if ((slotAptMap[nextKey] || []).length > 0) break;
            rowspanSkip.add(nextKey);
          }
        }
      }
    });
  });

  const therapists = getAllTherapists();
  const dayNames = ['月', '火', '水', '木', '金', '土'];
  // 昼休み帯は外来専用設定のみ参照（本日時間割の施設時間とは独立）
  const pmStart = String(OUTPATIENT_HOURS?.pmStart || '13:00');
  const amEnd = String(OUTPATIENT_HOURS?.amEnd || '13:00');
  const breakMin = (() => {
    const toMin = (t) => {
      const [h, m] = String(t).split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    return Math.max(0, toMin(pmStart) - toMin(amEnd));
  })();

  const now = new Date();
  const outStamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const periodLabel = `${startStr.slice(0, 4)}年${Number(startStr.slice(5, 7))}月${Number(startStr.slice(8, 10))}日(月) 〜 ${endStr.slice(0, 4)}年${Number(endStr.slice(5, 7))}月${Number(endStr.slice(8, 10))}日(土)`;

  // A4縦 印字可能高さ ≈ 297 - 5 - 4 = 288mm
  // ★午後切れの主因: 行高下限(6.8mm等)＋罫線余白で合計が288mm超 → overflow:hidden で午後がクリップ
  // → ヘッダー／thead／昼帯／footer／罫線分を差し引き、残りをスロット数で均等分割（下限で押し上げない）
  const slotCount = allSlotTimes.length;
  const pageMm = 288;
  const headerMm = 11.5;
  const theadMm = 6.8;
  const footerMm = 5.2;
  const lunchMm = breakMin > 0 ? 3.2 : 2.6;
  const borderFudgeMm = Math.min(14, 2.5 + slotCount * 0.22); // collapse罫線の実効厚み
  const dataAreaMm = Math.max(160, pageMm - headerMm - theadMm - footerMm - lunchMm - borderFudgeMm);
  const rawRow = dataAreaMm / Math.max(1, slotCount);
  // 行高は予算内に厳密に収める（嵩上げ禁止＝午後クリップ防止）。極端に狭いときだけ 3.6mm 下限。
  const rowMm = rawRow < 3.6 ? 3.6 : Math.min(9.2, rawRow);
  const namePt = rowMm >= 8.2 ? 9.0 : (rowMm >= 6.5 ? 8.0 : (rowMm >= 5.2 ? 7.2 : 6.4));
  const badgePt = rowMm >= 8.2 ? 7.0 : (rowMm >= 6.5 ? 6.4 : 5.6);
  const staffPt = rowMm >= 8.2 ? 7.6 : (rowMm >= 6.5 ? 6.8 : 6.0);
  const timePt = rowMm >= 8.0 ? 8.4 : (rowMm >= 6.0 ? 7.4 : 6.6);
  const analgesiaPt = Math.max(staffPt, badgePt + 0.4);
  const firstSlot = allSlotTimes[0];
  const lastSlot = allSlotTimes[slotCount - 1];
  const hasAfternoon = allSlotTimes.some((t) => String(t) >= pmStart);

  const printWindow = window.open('', '_blank', 'width=900,height=1200');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  let bodyRows = '';
  let lunchBandInserted = false;

  allSlotTimes.forEach((slotTime, slotIdx) => {
    if (!lunchBandInserted && slotTime >= pmStart) {
      lunchBandInserted = true;
      const breakText = breakMin > 0
        ? `── 昼休憩（${amEnd} 〜 ${pmStart} / ${breakMin}分）──`
        : `── 午前／午後境界（${pmStart}〜）──`;
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

      if (rowspanSkip.has(key)) {
        return;
      }

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

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>外来リハビリ 週間予約受付簿 (${startStr.replace(/-/g, '/')}〜)</title>
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
          font-size: 8.5pt;
          line-height: 1.1;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          display: flex;
          flex-direction: column;
          height: 288mm; /* 297 - 5 - 4 */
          max-height: 288mm;
          overflow: hidden; /* 行高を枠数で均等分割済みのため午後は切れない */
          page-break-after: avoid;
          page-break-inside: avoid;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 6px;
          border-bottom: 1.6px solid #0f172a;
          padding-bottom: 1px;
          margin-bottom: 1px;
          flex: 0 0 auto;
          height: ${headerMm}mm;
          max-height: ${headerMm}mm;
          overflow: hidden;
        }
        .title-block { min-width: 0; flex: 1; }
        .title {
          font-size: 11pt;
          font-weight: 900;
          color: #0f172a;
        }
        .period {
          font-size: 8pt;
          font-weight: 800;
          color: #047857;
          margin-left: 6px;
        }
        .legend {
          margin-top: 1px;
          font-size: 6.6pt;
          font-weight: 700;
          color: #334155;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .legend .lg {
          display: inline-block;
          border: 1.2px solid #475569;
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
          color: #ffffff;
          border-color: #065f46;
          font-weight: 900;
        }
        .legend .lg-staff {
          background: #1d4ed8;
          color: #ffffff;
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
          border: 1px solid #475569;
          vertical-align: top;
        }
        .hw-table thead th {
          background: #e2e8f0;
          font-size: 8pt;
          font-weight: 900;
          text-align: center;
          padding: 0 1px;
          height: ${theadMm}mm;
          max-height: ${theadMm}mm;
          vertical-align: middle;
          color: #0f172a;
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
          width: 12.5mm;
          text-align: center;
          font-weight: 900;
          font-size: ${timePt}pt;
          vertical-align: middle !important;
          background: #e2e8f0;
          color: #0f172a;
          height: ${rowMm}mm;
          max-height: ${rowMm}mm;
          padding: 0;
          letter-spacing: 0.02em;
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
          top: 0.4mm;
          left: 0.6mm;
          font-size: 6.5pt;
          font-weight: 700;
          color: #94a3b8;
        }
        .write-space {
          height: 100%;
          min-height: ${Math.max(3.8, rowMm - 1.4)}mm;
        }
        .booked-cell {
          background: #f8fafc !important;
          vertical-align: middle;
          overflow: hidden;
        }
        .booked-card {
          padding: 0.2mm 0;
          margin: 0;
        }
        .booked-card.is-analgesia {
          background: repeating-linear-gradient(
            -45deg,
            #ecfdf5,
            #ecfdf5 1.8px,
            #a7f3d0 1.8px,
            #a7f3d0 3.6px
          );
          border: 1.6px solid #047857;
          border-radius: 2px;
          padding: 0.3mm 0.8mm;
          box-shadow: inset 0 0 0 0.4px #10b981;
        }
        .bk-staff-row {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          flex-wrap: nowrap;
          gap: 1.5px;
          margin-bottom: 0.3mm;
          overflow: hidden;
        }
        .badge-disease,
        .badge-staff,
        .badge-analgesia {
          display: inline-block;
          line-height: 1.1;
          padding: 0.2mm 1.8px;
          border-radius: 2px;
          border: 1.2px solid #0f172a;
          white-space: nowrap;
          vertical-align: middle;
        }
        .badge-staff {
          font-size: ${staffPt}pt;
          font-weight: 900;
          letter-spacing: 0.02em;
          /* 色はインライン（担当ごと固定パレット） */
        }
        .badge-disease {
          font-size: ${badgePt}pt;
          font-weight: 800;
        }
        .badge-analgesia {
          font-size: ${analgesiaPt}pt;
          font-weight: 900;
          background: #059669;
          color: #ffffff;
          border-color: #065f46;
          border-width: 1.5px;
          letter-spacing: 0.04em;
          padding: 0.15mm 2.5px;
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
          color: #000000;
          line-height: 1.08;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .bk-dur {
          font-size: ${Math.max(6.8, namePt - 1.0)}pt;
          font-weight: 800;
          color: #334155;
          flex-shrink: 0;
        }
        tr.lunch-band td {
          background: #cbd5e1;
          text-align: center;
          font-size: 7pt;
          font-weight: 900;
          color: #1e293b;
          letter-spacing: 0.08em;
          padding: 0;
          height: ${lunchMm}mm;
          max-height: ${lunchMm}mm;
          border: 1px solid #475569;
          vertical-align: middle;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          gap: 6px;
          margin-top: 0.8mm;
          font-size: 6pt;
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
            height: 288mm !important;
            max-height: 288mm !important;
            overflow: hidden !important;
          }
          .sheet-wrap, .hw-table, .slot-row, .slot-cell {
            page-break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div class="title-block">
          <div>
            <span class="title">【外来リハビリ 週間予約受付簿】</span>
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
          リハビリテーション科／A4縦1枚
        </div>
      </div>

      <div class="sheet-wrap">
        <table class="hw-table">
          <thead>
            <tr>
              <th style="width:12.5mm;">時間</th>
              ${weekDates.map((d, idx) => {
                const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
                const holidayName = getJapaneseHolidayName(d);
                const isSat = d.getDay() === 6;
                let cls = '';
                if (holidayName) cls = 'holiday';
                else if (isSat) cls = 'sat';
                const hol = holidayName ? `<div style="font-size:6.5pt;font-weight:900;">${sanitizeHtml(holidayName)}</div>` : '';
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
        <span>※ 色付き担当バッジ＝セラピスト　／　【消炎】＝消炎鎮痛　／　空き枠は手書き可</span>
        <span>予約 ${weekAptList.length} 件／${firstSlot}〜${lastSlot} ${slotCount}枠${hasAfternoon ? '（午後含む）' : ''}／行高 ${rowMm.toFixed(1)}mm</span>
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
