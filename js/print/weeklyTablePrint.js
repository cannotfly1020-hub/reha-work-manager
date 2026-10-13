// js/print/weeklyTablePrint.js
// A4横1枚 外来リハビリ週間予約表の印刷

import { formatDateYMD, getWeekDates } from '../core/dateUtils.js';
import { TIME_SLOTS } from '../config/appointmentSlots.js';
import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import { getAllAppointments } from '../store/appointmentStore.js';
import { showToast } from '../ui/toast.js';

export function printWeeklyAppointmentTable(baseDate) {
  const weekDates = getWeekDates(baseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);

  const allAppointments = getAllAppointments();
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  const weekAptList = Object.values(allAppointments).filter((apt) => {
    return apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date);
  });

  const slotAptMap = {};
  weekAptList.forEach((apt) => {
    const k = `${apt.date}_${apt.startTime}`;
    if (!slotAptMap[k]) slotAptMap[k] = [];
    slotAptMap[k].push(apt);
  });

  const therapists = getAllTherapists();
  const dayNames = ['月', '火', '水', '木', '金', '土'];

  const printWindow = window.open('', '_blank', 'width=1100,height=780');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  let tableHtml = `
    <table class="weekly-print-table">
      <thead>
        <tr>
          <th style="width: 58px;">時間</th>
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

  TIME_SLOTS.forEach((slotTime) => {
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
          margin: 6mm 6mm 5mm 6mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Meiryo UI", sans-serif;
          color: #0f172a;
          background: #fff;
          font-size: 8.5pt;
          line-height: 1.15;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 4px;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 3px;
        }
        .title { font-size: 13pt; font-weight: 800; color: #0f172a; }
        .sub-info { font-size: 8.5pt; font-weight: 700; color: #475569; }
        .weekly-print-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .weekly-print-table th, .weekly-print-table td {
          border: 1px solid #475569;
          vertical-align: top;
          padding: 1px 2px;
        }
        .weekly-print-table th {
          background: #f1f5f9;
          font-weight: 800;
          font-size: 8pt;
          text-align: center;
          padding: 3px 2px;
        }
        .time-header-cell {
          text-align: center;
          font-weight: 800;
          font-size: 7.5pt;
          background: #f8fafc;
          vertical-align: middle !important;
          color: #334155;
          height: 22px;
        }
        .slot-content-cell {
          height: 22px;
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
          gap: 2px;
          background: #f8fafc;
          border: 1px solid #94a3b8;
          border-left: 3px solid #0284c7;
          border-radius: 2px;
          padding: 1px 3px;
          margin-bottom: 1px;
          font-size: 7pt;
          line-height: 1.1;
        }
        .print-card.card-analgesia {
          background: #f0fdf4;
          border-color: #86efac;
          border-left-color: #16a34a;
        }
        .p-name {
          font-weight: 800;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .p-staff {
          font-size: 6.5pt;
          font-weight: 700;
          color: #0369a1;
          white-space: nowrap;
        }
        .p-dur {
          font-size: 6pt;
          color: #64748b;
          white-space: nowrap;
        }
        .footer-note {
          display: flex;
          justify-content: space-between;
          font-size: 7pt;
          color: #64748b;
          margin-top: 3px;
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div>
          <span class="title">外来リハビリテーション 週間予約管理表</span>
          <span style="font-size:9pt; font-weight:700; color:#0369a1; margin-left:12px;">
            期間: ${startStr.replace(/-/g, '/')} (月) 〜 ${endStr.replace(/-/g, '/')} (土)
          </span>
        </div>
        <div class="sub-info">
          週間予約総数: ${weekAptList.length} 名 / 出力日: ${new Date().toLocaleDateString('ja-JP')}
        </div>
      </div>

      ${tableHtml}

      <div class="footer-note">
        <span>※ 同一時間枠に複数名配置可能（物療並行・担当PT別）。急患・当日キャンセル等は直接追記してください。</span>
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
