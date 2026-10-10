// js/views/modals/appointmentModal.js
// 外来予約登録・編集モーダル制御層
// 自由時間入力・所要時間選択・患者リアルタイム検索・終了時刻自動計算・患者予約票即時印刷連携

import { sanitizeHtml } from '../../core/dataNormalizer.js';
import { getPatientById, searchPatients } from '../../store/patientStore.js';
import { getAllTherapists, getActiveTherapists } from '../../store/therapistStore.js';
import {
  upsertAppointment, deleteAppointment, calculateEndTime
} from '../../store/appointmentStore.js';
import { showToast } from '../exportView.js';

let activeAppointmentId = null;
let onAppointmentUpdatedCallback = null;

/**
 * モーダルの初期化とイベント設定
 * @param {Function} onUpdate - 予約更新・削除時のコールバック
 */
export function setupAppointmentModalListeners(onUpdate) {
  onAppointmentUpdatedCallback = onUpdate;

  const modal = document.getElementById('modalAppointmentEdit');
  const btnClose = document.getElementById('btnCloseAppointmentModal');
  const btnCloseX = document.getElementById('btnCloseAppointmentModalX');
  const btnDelete = document.getElementById('btnDeleteAppointment');
  const form = document.getElementById('appointmentEditForm');
  const searchInput = document.getElementById('aptPatientSearchInput');
  const patientSelect = document.getElementById('aptPatientSelect');
  const startTimeInput = document.getElementById('aptStartTimeInput');
  const durationSelect = document.getElementById('aptDurationSelect');
  const endTimeDisplay = document.getElementById('aptEndTimeDisplay');
  const treatmentTypeSelect = document.getElementById('aptTreatmentTypeSelect');
  const therapistSelect = document.getElementById('aptTherapistSelect');

  const closeModal = () => modal?.classList.remove('active');
  btnClose?.addEventListener('click', closeModal);
  btnCloseX?.addEventListener('click', closeModal);

  // 終了時刻の自動計算
  const updateEndTime = () => {
    const start = startTimeInput?.value || '09:00';
    const dur = Number(durationSelect?.value) || 30;
    const end = calculateEndTime(start, dur);
    if (endTimeDisplay) endTimeDisplay.textContent = `〜 ${end} 終了`;
  };

  startTimeInput?.addEventListener('input', updateEndTime);
  durationSelect?.addEventListener('change', updateEndTime);

  // 治療種別が消炎鎮痛のときは担当者を「物療枠」に切り替えやすくする配慮
  treatmentTypeSelect?.addEventListener('change', (e) => {
    if (e.target.value === 'ANALGESIA' && therapistSelect) {
      if (Array.from(therapistSelect.options).some((opt) => opt.value === 'ANALGESIA')) {
        therapistSelect.value = 'ANALGESIA';
      }
    }
  });

  // モーダル内リアルタイム患者検索
  searchInput?.addEventListener('input', () => {
    populateAppointmentPatientSelect(searchInput.value, document.getElementById('aptPatientId')?.value || '');
  });

  // 患者候補の選択イベント
  patientSelect?.addEventListener('change', () => {
    const selectedId = patientSelect.value;
    const targetInput = document.getElementById('aptPatientId');
    if (targetInput) targetInput.value = selectedId;
    updateAppointmentPatientPreview(selectedId);
  });

  // 削除処理
  btnDelete?.addEventListener('click', () => {
    if (!activeAppointmentId) return;
    deleteAppointment(activeAppointmentId);
    closeModal();
    showToast('予約を削除しました', 'warn');
    if (typeof onAppointmentUpdatedCallback === 'function') {
      onAppointmentUpdatedCallback();
    }
  });

  // 保存処理
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAppointmentFormSubmit();
  });
}

function handleAppointmentFormSubmit() {
  const modal = document.getElementById('modalAppointmentEdit');
  const patientId = document.getElementById('aptPatientId')?.value || '';
  const date = document.getElementById('aptDateInput')?.value || '';
  const startTime = document.getElementById('aptStartTimeInput')?.value || '';
  const durationMinutes = Number(document.getElementById('aptDurationSelect')?.value) || 30;
  const therapistId = document.getElementById('aptTherapistSelect')?.value || 'A';
  const treatmentType = document.getElementById('aptTreatmentTypeSelect')?.value || 'INDIVIDUAL';
  const notes = document.getElementById('aptNotesInput')?.value || '';
  const shouldPrintTicket = Boolean(document.getElementById('aptPrintTicketCheck')?.checked);

  if (!patientId) {
    showToast('患者を選択してください', 'error');
    return;
  }
  if (!date || !startTime) {
    showToast('予約日と開始時刻を入力してください', 'error');
    return;
  }

  const res = upsertAppointment({
    id: activeAppointmentId,
    patientId,
    date,
    startTime,
    durationMinutes,
    therapistId,
    treatmentType,
    notes
  });

  if (!res.success) {
    showToast(res.message || '予約の登録に失敗しました', 'error');
    return;
  }

  modal?.classList.remove('active');
  showToast(activeAppointmentId ? '予約を更新しました' : '新規予約を登録しました', 'success');

  // 患者用予約票の即時印刷要求がある場合
  if (shouldPrintTicket && res.appointment) {
    triggerPrintAppointmentTicket(res.appointment);
  }

  if (typeof onAppointmentUpdatedCallback === 'function') {
    onAppointmentUpdatedCallback();
  }
}

/**
 * 予約登録・編集モーダルを開く
 * @param {Object|null} appointment - 既存予約データ（新規時はnull）
 * @param {string|null} defaultDate - デフォルト日付 (YYYY-MM-DD)
 * @param {string|null} defaultTime - デフォルト時刻 (HH:MM)
 */
export function openAppointmentModal(appointment = null, defaultDate = null, defaultTime = null) {
  activeAppointmentId = appointment ? appointment.id : null;
  const modal = document.getElementById('modalAppointmentEdit');
  const titleEl = document.getElementById('aptModalTitle');
  const btnDelete = document.getElementById('btnDeleteAppointment');
  const dateInput = document.getElementById('aptDateInput');
  const startTimeInput = document.getElementById('aptStartTimeInput');
  const durationSelect = document.getElementById('aptDurationSelect');
  const endTimeDisplay = document.getElementById('aptEndTimeDisplay');
  const therapistSelect = document.getElementById('aptTherapistSelect');
  const treatmentTypeSelect = document.getElementById('aptTreatmentTypeSelect');
  const notesInput = document.getElementById('aptNotesInput');
  const searchInput = document.getElementById('aptPatientSearchInput');
  const patientIdInput = document.getElementById('aptPatientId');
  const printCheck = document.getElementById('aptPrintTicketCheck');

  if (titleEl) {
    titleEl.textContent = appointment ? '外来予約の編集' : '新規 外来予約の登録';
  }
  if (btnDelete) {
    btnDelete.style.display = appointment ? 'block' : 'none';
  }

  // 担当者選択肢の動的生成
  if (therapistSelect) {
    const activeTherapists = getActiveTherapists();
    let optionsHtml = activeTherapists
      .map((t) => `<option value="${t.id}">${sanitizeHtml(t.name)}</option>`)
      .join('');
    optionsHtml += `<option value="ANALGESIA">消炎鎮痛 (物療専属)</option>`;
    optionsHtml += `<option value="NONE">担当指定なし</option>`;
    therapistSelect.innerHTML = optionsHtml;
  }

  const targetDate = appointment?.date || defaultDate || new Date().toISOString().slice(0, 10);
  const targetTime = appointment?.startTime || defaultTime || '09:00';
  const targetDuration = appointment?.durationMinutes || 30;
  const pId = appointment?.patientId || '';

  if (dateInput) dateInput.value = targetDate;
  if (startTimeInput) startTimeInput.value = targetTime;
  if (durationSelect) durationSelect.value = String(targetDuration);
  if (therapistSelect) therapistSelect.value = appointment?.therapistId || 'A';
  if (treatmentTypeSelect) treatmentTypeSelect.value = appointment?.treatmentType || 'INDIVIDUAL';
  if (notesInput) notesInput.value = appointment?.notes || '';
  if (patientIdInput) patientIdInput.value = pId;
  if (searchInput) searchInput.value = '';
  if (printCheck) printCheck.checked = false;

  const end = calculateEndTime(targetTime, targetDuration);
  if (endTimeDisplay) endTimeDisplay.textContent = `〜 ${end} 終了`;

  populateAppointmentPatientSelect('', pId);
  updateAppointmentPatientPreview(pId);

  modal?.classList.add('active');
}

function populateAppointmentPatientSelect(keyword = '', selectId = '') {
  const select = document.getElementById('aptPatientSelect');
  if (!select) return;

  // 外来優先で検索
  const patients = searchPatients(keyword, 'ALL');
  if (patients.length === 0) {
    select.innerHTML = '<option value="" disabled>該当する患者がいません</option>';
    return;
  }

  select.innerHTML = patients
    .map((p) => {
      const cat = p.category === 'INPATIENT' ? '入' : '外';
      const isSel = p.id === selectId ? 'selected' : '';
      return `<option value="${p.id}" ${isSel}>${p.id} : ${sanitizeHtml(p.name)} (${cat} / ${sanitizeHtml(p.diseaseName || '未記入')})</option>`;
    })
    .join('');
}

function updateAppointmentPatientPreview(patientId) {
  const previewEl = document.getElementById('aptPatientPreviewInfo');
  if (!previewEl) return;

  const patient = patientId ? getPatientById(patientId) : null;
  if (!patient) {
    previewEl.innerHTML = '<span style="color:#94a3b8;">患者が選択されていません</span>';
    return;
  }

  const cat = patient.category === 'INPATIENT' ? '入院' : '外来';
  previewEl.innerHTML = `選択中: <strong>${sanitizeHtml(patient.name)}</strong> (${patient.id}) / ${cat} / ${sanitizeHtml(patient.diseaseName || '疾患名未登録')}`;
}

/**
 * 簡易予約票即時印刷トリガー
 * @param {Object} appointment
 */
function triggerPrintAppointmentTicket(appointment) {
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
          <div class="date-main">${appointment.date}　${appointment.startTime} 〜 ${endTime}</div>
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
