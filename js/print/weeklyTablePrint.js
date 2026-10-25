// js/print/weeklyTablePrint.js
// A4横1枚 外来リハビリ週間予約表の印刷
// ★画面の週間グリッドは全枠表示のまま。印刷時のみ空き行をスキップし行高・フォントを最大化する。

import { formatDateYMD, getWeekDates } from '../core/dateUtils.js';
import { TIME_SLOTS } from '../config/appointmentSlots.js';
import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import { getAllAppointments } from '../store/appointmentStore.js';
import { showToast } from '../ui/toast.js';

/**
 * 予約の所要時間が覆う開始時刻スロット列（20分刻み）。印刷用の途中欠落防止。
 * @param {string[]} allSlotTimes
 * @param {{ startTime?: string, durationMinutes?: number }} apt
 * @returns {string[]}
 */
function getCoveredSlotTimesForPrint(allSlotTimes, apt) {
  const start = String(apt?.startTime || '');
  if (!start) return [];
  const startIdx = allSlotTimes.indexOf(start);
  const duration = Math.max(1, Number(apt?.durationMinutes) || 20);
  const slotCount = Math.max(1, Math.ceil(duration / 20));
  if (startIdx < 0) return [start];
  return allSlotTimes.slice(startIdx, startIdx + slotCount);
}

/**
 * 印刷専用: その週のいずれかの曜日に有効予約がある時刻行だけを残す
 * @param {Date[]} weekDates
 * @param {object[]} weekAptList
 * @returns {string[]}
 */
function resolvePrintVisibleTimeSlots(weekDates, weekAptList) {
  const active = new Set();
  weekAptList.forEach((apt) => {
    getCoveredSlotTimesForPrint(TIME_SLOTS, apt).forEach((t) => active.add(t));
  });
  const visible = TIME_SLOTS.filter((t) => active.has(t));
  // 予約ゼロ週は空表にならないよう全枠を印字
  return visible.length > 0 ? visible : [...TIME_SLOTS];
}

export function printWeeklyAppointmentTable(baseDate) {
  const weekDates = getWeekDates(baseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);

  const allAppointments = getAllAppointments();
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  const weekAptList = Object.values(allAppointments).filter((apt) => {
    return apt && apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date);
  });

  // ★印刷時のみ: 空き行圧縮（画面表示ロジックには一切触れない）
  const visibleSlots = resolvePrintVisibleTimeSlots(weekDates, weekAptList);

  const slotAptMap = {};
  weekAptList.forEach((apt) => {
    const k = `${apt.date}_${apt.startTime}`;
    if (!slotAptMap[k]) slotAptMap[k] = [];
    slotAptMap[k].push(apt);
  });

  const therapists = getAllTherapists();
  const dayNames = ['月', '火', '水', '木', '金', '土'];

  // 行数に応じて行高・フォントを段階拡大（少ないほど大きく／A4横1枚収まり優先）
  const rowCount = Math.max(1, visibleSlots.length);
  let rowPx = 40;
  let namePt = 11;
  let bodyPt = 10;
  let staffPt = 9;
  let timePt = 10;
  if (rowCount <= 10) {
    rowPx = 52;
    namePt = 12.5;
    bodyPt = 11;
    staffPt = 10;
    timePt = 11;
  } else if (rowCount <= 14) {
    rowPx = 44;
    namePt = 11.5;
    bodyPt = 10.5;
    staffPt = 9.5;
    timePt = 10.5;
  } else if (rowCount <= 18) {
    rowPx = 38;
    namePt = 10.5;
    bodyPt = 10;
    staffPt = 9;
    timePt = 10;
  } else {
    rowPx = 32;
    namePt = 9.5;
    bodyPt = 9;
    staffPt = 8;
    timePt = 9;
  }

  const printWindow = window.open('', '_blank', 'width=1100,height=780');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  let tableHtml = `
    <table class="weekly-print-table">
      <thead>
        <tr>
          <th style="width: 72px;">時間</th>
  `;

  weekDates.forEach((d, idx) => {
    const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
    const isSat = d.getDay() === 6;
    const holidayName = getJapaneseHolidayName(d);
    let thStyle = '';
    if (holidayName) {
      thStyle = 'color:#be123c; background:#fff1f2;';
    } else if (isSat) {
      thStyle = 'color:#1e40af; background:#eff6ff;';
    }

    tableHtml += `
      <th style="${thStyle}">
        ${dayNames[idx]} (${mmdd})${holidayName ? ` [${holidayName}]` : ''}
      </th>
    `;
  });

  tableHtml += `
        </tr>
      </thead>
      <tbody>
  `;

  visibleSlots.forEach((slotTime) => {
    tableHtml += `
      <tr>
        <td class="time-header-cell">${slotTime}</td>
    `;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isSat = d.getDay() === 6;
      const holidayName = getJapaneseHolidayName(d);
      const key = `${dateStr}_${slotTime}`;
      const apts = slotAptMap[key] || [];

      let colClass = 'slot-content-cell';
      if (holidayName) colClass += ' holiday-col';
      else if (isSat) colClass += ' sat-col';

      tableHtml += `<td class="${colClass}">`;

      if (apts.length > 0) {
        apts.forEach((apt) => {
          const p = getPatientById(apt.patientId);
          const pName = p ? p.name : apt.patientId;
          const staff = therapists.find((t) => t.id === apt.therapistId);
          let staffLabel = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '物療' : '');
          if (staffLabel.length > 3) staffLabel = staffLabel.slice(0, 3);
          const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';

          tableHtml += `
            <div class="print-card ${isAnalgesia ? 'card-analgesia' : ''}">
              <span class="p-name">${sanitizeHtml(pName)}</span>
              ${staffLabel ? `<span class="p-staff">${sanitizeHtml(staffLabel)}</span>` : ''}
              ${apt.durationMinutes && apt.durationMinutes !== 20 ? `<span class="p-dur">${apt.durationMinutes}m</span>` : ''}
            </div>
          `;
        });
      }

      tableHtml += `</td>`;
    });

    tableHtml += `</tr>`;
  });

  tableHtml += `
      </tbody>
    </table>
  `;

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>外来リハビリ週間予約表 (${startStr.replace(/-/g, '/')}〜${endStr.replace(/-/g, '/')})</title>
      <style>
        @page {
          size: A4 landscape;
          margin: 5mm 5mm 4mm 5mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
          height: 100%;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Meiryo UI", sans-serif;
          color: #0f172a;
          background: #fff;
          font-size: ${bodyPt}pt;
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
          margin-bottom: 4px;
          border-bottom: 2.5px solid #0f172a;
          padding-bottom: 3px;
          flex-shrink: 0;
        }
        .title { font-size: 15pt; font-weight: 800; color: #0f172a; }
        .sub-info { font-size: 9.5pt; font-weight: 700; color: #475569; }
        .table-wrap {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .weekly-print-table {
          width: 100%;
          height: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .weekly-print-table th, .weekly-print-table td {
          border: 1.5px solid #334155;
          vertical-align: middle;
          padding: 2px 4px;
        }
        .weekly-print-table th {
          background: #f1f5f9;
          font-weight: 800;
          font-size: 10pt;
          text-align: center;
          padding: 5px 3px;
          height: 28px;
        }
        .time-header-cell {
          text-align: center;
          font-weight: 800;
          font-size: ${timePt}pt;
          background: #f8fafc;
          vertical-align: middle !important;
          color: #0f172a;
          height: ${rowPx}px;
        }
        .slot-content-cell {
          height: ${rowPx}px;
          min-height: ${rowPx}px;
          background: #fff;
        }
        .slot-content-cell.sat-col {
          background: #fafcff;
        }
        .slot-content-cell.holiday-col {
          background: #fff5f5;
        }
        .print-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          background: #f8fafc;
          border: 1px solid #64748b;
          border-left: 4px solid #0284c7;
          border-radius: 3px;
          padding: 3px 5px;
          margin-bottom: 2px;
          font-size: ${bodyPt}pt;
          line-height: 1.15;
        }
        .print-card.card-analgesia {
          background: #f0fdf4;
          border-color: #86efac;
          border-left-color: #16a34a;
        }
        .p-name {
          font-weight: 800;
          font-size: ${namePt}pt;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .p-staff {
          font-size: ${staffPt}pt;
          font-weight: 800;
          color: #0369a1;
          white-space: nowrap;
          background: #e0f2fe;
          border-radius: 3px;
          padding: 1px 5px;
        }
        .p-dur {
          font-size: ${staffPt - 0.5}pt;
          font-weight: 700;
          color: #475569;
          white-space: nowrap;
        }
        .footer-note {
          display: flex;
          justify-content: space-between;
          font-size: 8pt;
          color: #64748b;
          margin-top: 3px;
          flex-shrink: 0;
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div>
          <span class="title">外来リハビリテーション 週間予約管理表</span>
          <span style="font-size:10.5pt; font-weight:700; color:#0369a1; margin-left:12px;">
            期間: ${startStr.replace(/-/g, '/')} (月) 〜 ${endStr.replace(/-/g, '/')} (土)
          </span>
        </div>
        <div class="sub-info">
          週間予約総数: ${weekAptList.length} 名 ／ 表示枠: ${rowCount} 行（印刷時のみ空き行除外） ／ 出力日: ${new Date().toLocaleDateString('ja-JP')}
        </div>
      </div>

      <div class="table-wrap">
        ${tableHtml}
      </div>

      <div class="footer-note">
        <span>※ 印刷時のみ空き時間行を自動除外し文字を拡大。画面の週間表は全枠表示のままです。急患・当日キャンセル等は直接追記してください。</span>
        <span>reha-work-manager R8</span>
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
