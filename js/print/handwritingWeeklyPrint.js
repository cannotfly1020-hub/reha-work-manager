// js/print/handwritingWeeklyPrint.js
// 週間予約受付簿 A4横印刷（手書き余白完備・疾患／消炎／担当の視認性強化）
// ★画面の週間グリッドには一切干渉しない。全 TIME_SLOTS を歯抜けなく印字する。

import { formatDateYMD, getWeekDates } from '../core/dateUtils.js';
import { TIME_SLOTS } from '../config/appointmentSlots.js';
import { FACILITY_HOURS, REHA_RULES } from '../config/rules.js';
import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import { getAllAppointments } from '../store/appointmentStore.js';
import { showToast } from '../ui/toast.js';

/**
 * 所要時間（分）→ 20分コマ数
 * @param {{ durationMinutes?: number }} apt
 * @returns {number}
 */
function getAptSlotSpan(apt) {
  const duration = Math.max(1, Number(apt?.durationMinutes) || 20);
  return Math.max(1, Math.ceil(duration / 20));
}

/**
 * 担当表示ラベル（バッジ用・短く）
 * @param {object[]} therapists
 * @param {string} therapistId
 * @returns {string}
 */
function formatStaffBadgeLabel(therapists, therapistId) {
  if (!therapistId || therapistId === 'NONE') return '指定無';
  if (therapistId === 'ANALGESIA') return '物療';
  const staff = therapists.find((t) => t.id === therapistId);
  let label = staff?.name || therapistId;
  // 「PT 佐藤」→「PT佐藤」寄りに圧縮
  label = String(label).replace(/\s+/g, '');
  if (label.length > 5) label = label.slice(0, 5);
  return label;
}

/**
 * 患者マスター＋予約から疾患／消炎を安全に解決する
 * 優先: 予約が ANALGESIA → 消炎。それ以外は patient.diseaseType（不正時は LOCOMOTIVE）
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
 * 予約1件分のカードHTML
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
    ? `<span class="badge-disease ${vis.diseaseClass}">[消炎]</span>`
    : `<span class="badge-disease ${vis.diseaseClass}">[${sanitizeHtml(vis.diseaseTag)}]</span>`;

  return `
    <div class="booked-card${vis.isAnalgesia ? ' is-analgesia' : ''}">
      <div class="bk-top">
        ${diseaseBadge}
        <span class="badge-staff">[${sanitizeHtml(staffLabel)}]</span>
      </div>
      <div class="bk-main">
        <span class="bk-name">${sanitizeHtml(pName)} 様</span>
        <span class="bk-dur">(${dur}分)</span>
      </div>
    </div>
  `;
}

/**
 * 週間予約受付簿（A4横）を印刷する
 * @param {Date} baseDate
 */
export function printHandwritingWeeklySheet(baseDate) {
  const weekDates = getWeekDates(baseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);
  const allSlotTimes = [...TIME_SLOTS];

  if (!allSlotTimes.length) {
    showToast('施設時間枠が未設定のため印刷できません', 'warn');
    return;
  }

  const allAppointments = getAllAppointments();
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  const weekAptList = Object.values(allAppointments).filter((apt) => {
    return apt && apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date);
  });

  const slotAptMap = {};
  weekAptList.forEach((apt) => {
    const k = `${apt.date}_${apt.startTime}`;
    if (!slotAptMap[k]) slotAptMap[k] = [];
    slotAptMap[k].push(apt);
  });

  // 縦結合でスキップするセル（date_slotTime）
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
  const pmStart = String(FACILITY_HOURS?.pmStart || '13:00');
  const amEnd = String(FACILITY_HOURS?.amEnd || '13:00');
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

  // A4横1枚収容: 枠数に応じて行高・氏名ptを調整（バッジ込みでも収まるサイズ）
  const slotCount = allSlotTimes.length;
  let rowPx = 22;
  let namePt = 8.5;
  let badgePt = 6.5;
  if (slotCount <= 22) {
    rowPx = 26;
    namePt = 9.5;
    badgePt = 7;
  } else if (slotCount <= 24) {
    rowPx = 24;
    namePt = 9;
    badgePt = 6.8;
  } else {
    rowPx = 21;
    namePt = 8.5;
    badgePt = 6.5;
  }

  const printWindow = window.open('', '_blank', 'width=1200,height=800');
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

    bodyRows += `<tr>`;
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
          size: A4 landscape;
          margin: 6mm 8mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        body {
          font-family: "Meiryo UI", Meiryo, system-ui, -apple-system, sans-serif;
          color: #0f172a;
          background: #fff;
          font-size: 9pt;
          line-height: 1.15;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          display: flex;
          flex-direction: column;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          border-bottom: 2.5px solid #0f172a;
          padding-bottom: 4px;
          margin-bottom: 4px;
          flex-shrink: 0;
        }
        .title-block { min-width: 0; }
        .title {
          font-size: 13pt;
          font-weight: 800;
          color: #0f172a;
        }
        .period {
          font-size: 9.5pt;
          font-weight: 700;
          color: #047857;
          margin-left: 8px;
        }
        .legend {
          margin-top: 3px;
          font-size: 7.5pt;
          font-weight: 700;
          color: #334155;
          letter-spacing: 0.01em;
        }
        .legend .lg {
          display: inline-block;
          border: 1px solid #475569;
          padding: 0 4px;
          margin-right: 2px;
          border-radius: 2px;
          font-weight: 800;
        }
        .legend .lg-loco { background: #dbeafe; }
        .legend .lg-cerebro { background: #e9e5f5; }
        .legend .lg-disuse { background: #fef3c7; }
        .legend .lg-analgesia {
          background: repeating-linear-gradient(
            -45deg, #ecfdf5, #ecfdf5 2px, #d1fae5 2px, #d1fae5 4px
          );
        }
        .meta {
          font-size: 8pt;
          font-weight: 700;
          color: #334155;
          text-align: right;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .sheet-wrap {
          flex: 1 1 auto;
          min-height: 0;
        }
        table.hw-table {
          width: 100%;
          height: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .hw-table th,
        .hw-table td {
          border: 1px solid #475569;
          vertical-align: top;
        }
        .hw-table thead th {
          background: #e2e8f0;
          font-size: 9pt;
          font-weight: 800;
          text-align: center;
          padding: 3px 2px;
          height: 24px;
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
        .time-col {
          width: 52px;
          text-align: center;
          font-weight: 800;
          font-size: 8.5pt;
          vertical-align: middle !important;
          background: #f8fafc;
          color: #0f172a;
          height: ${rowPx}px;
        }
        .slot-cell {
          height: ${rowPx}px;
          min-height: ${rowPx}px;
          padding: 1px 2px;
          position: relative;
        }
        .slot-cell.sat { background: #f8fbff; }
        .slot-cell.holiday { background: #fff7f7; }
        .empty-cell {
          background: #ffffff !important;
        }
        .empty-time {
          position: absolute;
          top: 1px;
          left: 2px;
          font-size: 6pt;
          font-weight: 600;
          color: #cbd5e1;
        }
        .write-space {
          height: 100%;
          min-height: ${Math.max(12, rowPx - 5)}px;
        }
        .booked-cell {
          background: #f1f5f9 !important;
          vertical-align: middle;
          padding: 1px 2px;
        }
        .booked-card {
          padding: 1px 2px;
          margin-bottom: 1px;
        }
        .booked-card.is-analgesia {
          background: repeating-linear-gradient(
            -45deg,
            #ecfdf5,
            #ecfdf5 2px,
            #d1fae5 2px,
            #d1fae5 4px
          );
          border: 1px solid #059669;
          border-radius: 2px;
          padding: 1px 3px;
        }
        .bk-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 2px;
          margin-bottom: 1px;
        }
        .badge-disease,
        .badge-staff {
          display: inline-block;
          font-size: ${badgePt}pt;
          font-weight: 800;
          line-height: 1.15;
          padding: 0 3px;
          border-radius: 2px;
          border: 1px solid #0f172a;
          white-space: nowrap;
        }
        .badge-staff {
          background: #0f172a;
          color: #ffffff;
          border-color: #0f172a;
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
        .dtype-analgesia {
          background: #ffffff;
          color: #065f46;
          border-color: #059669;
          border-style: solid;
          border-width: 1.5px;
        }
        .bk-main {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 2px 4px;
        }
        .bk-name {
          font-size: ${namePt}pt;
          font-weight: 800;
          color: #000000;
          line-height: 1.1;
        }
        .bk-dur {
          font-size: ${Math.max(7, namePt - 1)}pt;
          font-weight: 700;
          color: #1e293b;
        }
        tr.lunch-band td {
          background: #e2e8f0;
          text-align: center;
          font-size: 7pt;
          font-weight: 800;
          color: #334155;
          letter-spacing: 0.1em;
          padding: 1px 0;
          height: 12px;
          border: 1px solid #475569;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-top: 3px;
          font-size: 7pt;
          font-weight: 600;
          color: #334155;
          flex-shrink: 0;
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div class="title-block">
          <div>
            <span class="title">【外来リハビリ 週間予約受付簿】</span>
            <span class="period">対象期間: ${periodLabel}</span>
          </div>
          <div class="legend">
            【凡例】
            <span class="lg lg-loco">[運]</span> 運動器
            <span class="lg lg-cerebro">[脳]</span> 脳血管
            <span class="lg lg-disuse">[廃]</span> 廃用
            <span class="lg lg-analgesia">[消炎]</span> 消炎鎮痛(物療)
            ｜ 黒地白文字 = 担当セラピスト
            ｜ 白い空き枠 = 手書き予約可
          </div>
        </div>
        <div class="meta">
          出力日時: ${outStamp}<br>
          リハビリテーション科
        </div>
      </div>

      <div class="sheet-wrap">
        <table class="hw-table">
          <thead>
            <tr>
              <th style="width:52px;">時間</th>
              ${weekDates.map((d, idx) => {
                const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
                const holidayName = getJapaneseHolidayName(d);
                const isSat = d.getDay() === 6;
                let cls = '';
                if (holidayName) cls = 'holiday';
                else if (isSat) cls = 'sat';
                const hol = holidayName ? `<div style="font-size:6.5pt;font-weight:800;">${sanitizeHtml(holidayName)}</div>` : '';
                return `<th class="${cls}">${dayNames[idx]} (${mmdd})${hol}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>

      <div class="footer">
        <span>※ 白い空き枠に患者名・メモを手書きし、後からPCへ入力してください。罫線は白黒コピーでも掠れにくい濃色です。</span>
        <span>予約 ${weekAptList.length} 件 ／ ${slotCount} 枠全表示 ／ reha-work-manager</span>
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
