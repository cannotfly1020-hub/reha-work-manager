// js/print/dailyChecklistPrint.js
// A4縦1枚 本日デイリー予約チェック表の印刷

import { formatDateYMD } from '../core/dateUtils.js';
import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import { getAllAppointments } from '../store/appointmentStore.js';
import { showToast } from '../ui/toast.js';

export function printDailyAppointmentChecklist(baseDate) {
  const targetDateStr = formatDateYMD(baseDate);
  const allAppointments = getAllAppointments();

  const dailyAptList = Object.values(allAppointments)
    .filter((apt) => apt.date === targetDateStr && apt.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const printWindow = window.open('', '_blank', 'width=900,height=800');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  const therapists = getAllTherapists();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayOfWeek = dayNames[baseDate.getDay()];
  const holidayName = getJapaneseHolidayName(baseDate);

  let rowsHtml = '';
  dailyAptList.forEach((apt, idx) => {
    const p = getPatientById(apt.patientId);
    const pName = p ? p.name : apt.patientId;
    const staff = therapists.find((t) => t.id === apt.therapistId);
    const staffLabel = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '消炎(物療)' : '-');

    let typeLabel = '個別リハ';
    if (apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA') typeLabel = '消炎鎮痛(物療)';
    else if (apt.treatmentType === 'EVALUATION') typeLabel = '評価・装具診';
    else if (apt.treatmentType === 'OTHER') typeLabel = 'その他';

    rowsHtml += `
      <tr>
        <td style="text-align:center; font-weight:bold; font-size:10pt;">[ ]</td>
        <td style="text-align:center; font-weight:700; color:#64748b;">${idx + 1}</td>
        <td style="text-align:center; font-weight:800; font-size:9.5pt; color:#0f172a;">${apt.startTime}</td>
        <td style="font-weight:800; font-size:9.5pt; color:#0f172a;">
          ${sanitizeHtml(pName)}
          <span style="font-size:7.5pt; font-weight:normal; color:#64748b;">(${apt.patientId})</span>
        </td>
        <td style="text-align:center; font-weight:700; color:#0369a1;">${sanitizeHtml(staffLabel)}</td>
        <td style="font-size:8pt; text-align:center;">${typeLabel} (${apt.durationMinutes || 30}分)</td>
        <td style="font-size:8pt; color:#475569;">${sanitizeHtml(apt.notes || '')}</td>
      </tr>
    `;
  });

  // 予約が少ない場合でも32名分枠を確保して手書き追記可能にする
  const emptyRowsNeeded = Math.max(0, 32 - dailyAptList.length);
  for (let i = 0; i < emptyRowsNeeded; i++) {
    const seq = dailyAptList.length + i + 1;
    rowsHtml += `
      <tr class="empty-memo-row">
        <td style="text-align:center;">[ ]</td>
        <td style="text-align:center; color:#94a3b8;">${seq}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      </tr>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>外来リハビリ本日デイリー予約チェック表 (${targetDateStr})</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 7mm 7mm 6mm 7mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Meiryo UI", sans-serif;
          color: #0f172a;
          background: #fff;
          font-size: 8.5pt;
          line-height: 1.2;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 6px;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 4px;
        }
        .title { font-size: 13.5pt; font-weight: 800; color: #0f172a; }
        .date-badge {
          font-size: 11pt;
          font-weight: 800;
          color: ${holidayName ? '#be123c' : '#15803d'};
          background: ${holidayName ? '#fff1f2' : '#f0fdf4'};
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid ${holidayName ? '#fecdd3' : '#86efac'};
        }
        .daily-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .daily-table th, .daily-table td {
          border: 1px solid #475569;
          vertical-align: middle;
          padding: 3px 5px;
        }
        .daily-table th {
          background: #f1f5f9;
          font-weight: 800;
          font-size: 8pt;
          text-align: center;
          color: #1e293b;
        }
        .daily-table tr:nth-child(even):not(.empty-memo-row) {
          background: #f8fafc;
        }
        .empty-memo-row td {
          height: 18px;
          background: #fff;
        }
        .footer-note {
          display: flex;
          justify-content: space-between;
          font-size: 7.5pt;
          color: #64748b;
          margin-top: 4px;
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div>
          <span class="title">外来リハビリテーション 来院チェック表</span>
          <span class="date-badge" style="margin-left:8px;">
            ${targetDateStr.replace(/-/g, '/')} (${dayOfWeek}) ${holidayName ? `[${holidayName}]` : ''}
          </span>
        </div>
        <div style="font-size:9pt; font-weight:800; color:#334155;">
          予約総数: ${dailyAptList.length} 名
        </div>
      </div>

      <table class="daily-table">
        <thead>
          <tr>
            <th style="width: 32px;">来院</th>
            <th style="width: 26px;">No</th>
            <th style="width: 50px;">時間</th>
            <th style="width: 130px;">患者氏名 (ID)</th>
            <th style="width: 65px;">担当PT</th>
            <th style="width: 95px;">区分 / 所要枠</th>
            <th>院内特記メモ (送迎・診察順等) / 手書き追記</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="footer-note">
        <span>※ 来院時に左端の [ ] にレ点を記入してください。下部の空欄は急患・当日電話予約の受付手書き用です。</span>
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
