// js/print/appointmentTicketPrint.js
// A5 次回予約票の即時印刷

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import { calculateEndTime } from '../store/appointmentStore.js';
import { showToast } from '../ui/toast.js';

export function printAppointmentTicket(appointment) {
  const patient = getPatientById(appointment.patientId);
  const pName = patient ? patient.name : appointment.patientId;
  const therapists = getAllTherapists();
  const staff = therapists.find((t) => t.id === appointment.therapistId);
  const staffName = staff ? staff.name : (appointment.therapistId === 'ANALGESIA' ? '消炎鎮痛 (物療)' : '担当指定なし');
  const endTime = calculateEndTime(appointment.startTime, appointment.durationMinutes);

  const printWindow = window.open('', '_blank', 'width=650,height=700');
  if (!printWindow) {
    showToast('ポップアップがブロックされました。ブラウザの許可設定をご確認ください。', 'warn');
    return;
  }

  const ticketHtml = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>リハビリご予約票 - ${pName}様</title>
      <style>
        @page { size: A5 landscape; margin: 10mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Meiryo", sans-serif; color: #0f172a; margin: 0; padding: 20px; }
        .ticket-box { border: 2px solid #0284c7; border-radius: 8px; padding: 24px; max-width: 540px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 12px; margin-bottom: 16px; }
        .header h1 { font-size: 1.3rem; margin: 0 0 6px 0; color: #0284c7; }
        .patient-name { font-size: 1.25rem; font-weight: 800; margin-bottom: 16px; }
        .date-badge { background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 12px; margin-bottom: 16px; }
        .date-title { font-size: 0.85rem; color: #166534; font-weight: 700; margin-bottom: 4px; }
        .date-main { font-size: 1.4rem; font-weight: 800; color: #15803d; }
        .detail-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.95rem; }
        .notice { font-size: 0.78rem; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 16px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="ticket-box">
        <div class="header">
          <h1>リハビリテーション科 ご予約票</h1>
          <div style="font-size:0.8rem; color:#64748b;">発行日: ${new Date().toLocaleDateString('ja-JP')}</div>
        </div>
        <div class="patient-name">${sanitizeHtml(pName)} 様 <span style="font-size:0.85rem; color:#64748b; font-weight:normal;">(ID: ${appointment.patientId})</span></div>
        <div class="date-badge">
          <div class="date-title">■ 次回ご予約日時</div>
          <div class="date-main">${appointment.date} ${appointment.startTime} 〜 ${endTime}</div>
        </div>
        <div class="detail-row">
          <span>担当セラピスト:</span>
          <strong>${sanitizeHtml(staffName)}</strong>
        </div>
        <div class="detail-row">
          <span>所要時間（予定）:</span>
          <strong>約 ${appointment.durationMinutes} 分</strong>
        </div>
        ${appointment.notes ? `<div class="detail-row"><span>特記メモ:</span><span>${sanitizeHtml(appointment.notes)}</span></div>` : ''}
        <div class="notice">
          ※ ご都合が悪くなられた場合は、前日までにお電話にてご連絡ください。<br>
          ※ 運動しやすい服装とお履き物でお越しください。
        </div>
      </div>
      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(ticketHtml);
  printWindow.document.close();
}
