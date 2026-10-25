// js/print/handwritingWeeklyPrint.js
// 手書き受付用 A4横「予約受付簿」印刷
// ★画面の週間グリッドには一切干渉しない。全 TIME_SLOTS を歯抜けなく印字し、空き枠は手書き余白にする。

import { formatDateYMD, getWeekDates } from '../core/dateUtils.js';
import { TIME_SLOTS } from '../config/appointmentSlots.js';
import { FACILITY_HOURS } from '../config/rules.js';
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
 * 担当表示名（短く）
 * @param {object[]} therapists
 * @param {string} therapistId
 * @returns {string}
 */
function formatStaffLabel(therapists, therapistId) {
  const staff = therapists.find((t) => t.id === therapistId);
  let label = staff ? staff.name : (therapistId === 'ANALGESIA' ? '物療' : (therapistId === 'NONE' ? '指定無' : ''));
  if (label.length > 4) label = label.slice(0, 4);
  return label;
}

/**
 * 手書き受付用 A4横印刷を起動する
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

  // 開始時刻キー → 予約配列
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
      // 単一予約かつ複数コマのみ rowspan（同一枠複数名は重ね書き欄として結合しない）
      if (apts.length === 1) {
        const span = getAptSlotSpan(apts[0]);
        if (span > 1) {
          for (let i = 1; i < span; i += 1) {
            const next = allSlotTimes[idx + i];
            if (!next) break;
            const nextKey = `${dateStr}_${next}`;
            // 次枠に別予約の開始があればそこで結合終了
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

  // 行高: 全枠をA4横に収める（余白は空きセル内に確保）
  const slotCount = allSlotTimes.length;
  let rowPx = 22;
  let namePt = 8.5;
  if (slotCount <= 22) {
    rowPx = 26;
    namePt = 9.5;
  } else if (slotCount <= 24) {
    rowPx = 24;
    namePt = 9;
  } else {
    rowPx = 21;
    namePt = 8.5;
  }

  const printWindow = window.open('', '_blank', 'width=1200,height=800');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  let bodyRows = '';
  let lunchBandInserted = false;

  allSlotTimes.forEach((slotTime, slotIdx) => {
    // 午後開始直前に昼休憩／境界帯（歯抜け削除はしない・全スロットは必ず印字）
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
        return; // rowspan で上セルがカバー
      }

      const apts = slotAptMap[key] || [];
      let tdClass = 'slot-cell';
      if (holidayName) tdClass += ' holiday';
      else if (isSat) tdClass += ' sat';

      if (apts.length === 0) {
        // 空き枠: 白地＋左上に薄い時刻＋手書き余白
        bodyRows += `
          <td class="${tdClass} empty-cell">
            <span class="empty-time">${slotTime}</span>
            <div class="write-space"></div>
          </td>
        `;
        return;
      }

      // 予約あり
      let rowspan = 1;
      if (apts.length === 1) {
        const span = getAptSlotSpan(apts[0]);
        let actual = 1;
        for (let i = 1; i < span; i += 1) {
          const next = allSlotTimes[slotIdx + i];
          if (!next) break;
          const nextKey = `${dateStr}_${next}`;
          if ((slotAptMap[nextKey] || []).length > 0) break;
          if (!rowspanSkip.has(nextKey) && i > 0) {
            // skip set に入っているはず
          }
          if (rowspanSkip.has(nextKey)) actual += 1;
          else break;
        }
        rowspan = Math.max(1, actual);
      }

      const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : '';
      let cardsHtml = '';
      apts.forEach((apt) => {
        const p = getPatientById(apt.patientId);
        const pName = p ? p.name : apt.patientId;
        const staffLabel = formatStaffLabel(therapists, apt.therapistId);
        const dur = Number(apt.durationMinutes) || 20;
        const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';
        cardsHtml += `
          <div class="booked-card${isAnalgesia ? ' analgesia' : ''}">
            <span class="bk-name">${sanitizeHtml(pName)} 様</span>
            <span class="bk-meta">(${dur}分${staffLabel ? `／${sanitizeHtml(staffLabel)}` : ''})</span>
          </div>
        `;
      });

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
      <title>外来リハビリ予約 受付管理簿 (${startStr.replace(/-/g, '/')}〜)</title>
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
          line-height: 1.2;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          display: flex;
          flex-direction: column;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 12px;
          border-bottom: 2.5px solid #0f172a;
          padding-bottom: 4px;
          margin-bottom: 5px;
          flex-shrink: 0;
        }
        .title {
          font-size: 13.5pt;
          font-weight: 800;
          color: #0f172a;
        }
        .period {
          font-size: 10pt;
          font-weight: 700;
          color: #047857;
          margin-left: 10px;
        }
        .meta {
          font-size: 8.5pt;
          font-weight: 700;
          color: #334155;
          text-align: right;
          white-space: nowrap;
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
          border: 1px solid #64748b;
          vertical-align: top;
        }
        .hw-table thead th {
          background: #e2e8f0;
          font-size: 9.5pt;
          font-weight: 800;
          text-align: center;
          padding: 4px 2px;
          height: 26px;
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
          width: 54px;
          text-align: center;
          font-weight: 800;
          font-size: 9pt;
          vertical-align: middle !important;
          background: #f8fafc;
          color: #0f172a;
          height: ${rowPx}px;
        }
        .slot-cell {
          height: ${rowPx}px;
          min-height: ${rowPx}px;
          padding: 2px 3px;
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
          left: 3px;
          font-size: 6.5pt;
          font-weight: 600;
          color: #cbd5e1;
          letter-spacing: 0.02em;
        }
        .write-space {
          height: 100%;
          min-height: ${Math.max(14, rowPx - 6)}px;
        }
        .booked-cell {
          background: #f1f5f9 !important;
          vertical-align: middle;
        }
        .booked-card {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 2px 6px;
          padding: 1px 2px;
        }
        .booked-card.analgesia {
          background: #ecfdf5;
          border-left: 3px solid #059669;
          padding-left: 4px;
          border-radius: 2px;
        }
        .bk-name {
          font-size: ${namePt}pt;
          font-weight: 800;
          color: #000000;
        }
        .bk-meta {
          font-size: ${Math.max(7, namePt - 1)}pt;
          font-weight: 700;
          color: #1e293b;
        }
        tr.lunch-band td {
          background: #e2e8f0;
          text-align: center;
          font-size: 7.5pt;
          font-weight: 800;
          color: #475569;
          letter-spacing: 0.12em;
          padding: 2px 0;
          height: 14px;
          border: 1px solid #64748b;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          margin-top: 4px;
          font-size: 7.5pt;
          font-weight: 600;
          color: #475569;
          flex-shrink: 0;
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div>
          <span class="title">【外来リハビリ予約 受付管理簿】</span>
          <span class="period">対象期間: ${periodLabel}</span>
        </div>
        <div class="meta">
          出力日時: ${outStamp}<br>
          リハビリテーション科 ／ 手書き受付用（全時間枠）
        </div>
      </div>

      <div class="sheet-wrap">
        <table class="hw-table">
          <thead>
            <tr>
              <th style="width:54px;">時間</th>
              ${weekDates.map((d, idx) => {
                const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
                const holidayName = getJapaneseHolidayName(d);
                const isSat = d.getDay() === 6;
                let cls = '';
                if (holidayName) cls = 'holiday';
                else if (isSat) cls = 'sat';
                const hol = holidayName ? `<div style="font-size:7pt;font-weight:800;">${sanitizeHtml(holidayName)}</div>` : '';
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
        <span>※ 白い空き枠に患者名・メモを手書きし、後からPCへ入力してください。薄い青枠は予約済です。コピー機の白黒印刷でも枠線が残るよう濃色罫線を使用しています。</span>
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
