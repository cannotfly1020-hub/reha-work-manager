// js/views/modals/appointmentModal.js
// 外来予約登録・編集モーダル制御層
// 祝日判定は js/core/holidayCalc.js、予約票印刷は js/print/appointmentTicketPrint.js

import { sanitizeHtml } from '../../core/dataNormalizer.js';
import { getPatientById, searchPatients } from '../../store/patientStore.js';
import { getActiveTherapists } from '../../store/therapistStore.js';
import {
  upsertAppointment, deleteAppointment, calculateEndTime
} from '../../store/appointmentStore.js';
import { showToast } from '../../ui/toast.js';
import { getJapaneseHolidayName } from '../../core/holidayCalc.js';
import { printAppointmentTicket } from '../../print/appointmentTicketPrint.js';
import { APPOINTMENT_TIME_STRINGS } from '../../config/rules.js';
import {
  snapToNearestAppointmentSlot,
  normalizeTimeHHmm
} from '../../core/timeSlotUtil.js';

/**
 * 開始時刻セレクトを正本20分スロットで埋める
 * @param {HTMLSelectElement|null} selectEl
 * @param {string} [selectedTime]
 */
function populateAppointmentStartTimeSelect(selectEl, selectedTime = '09:00') {
  if (!selectEl) return;
  const slots = (APPOINTMENT_TIME_STRINGS && APPOINTMENT_TIME_STRINGS.length)
    ? [...APPOINTMENT_TIME_STRINGS]
    : ['09:00', '09:20', '09:40', '10:00'];
  const snapped = snapToNearestAppointmentSlot(selectedTime || slots[0], slots);
  selectEl.innerHTML = slots
    .map((t) => `<option value="${t}"${t === snapped ? ' selected' : ''}>${t}</option>`)
    .join('');
  selectEl.value = snapped;
}

let activeAppointmentId = null;
let onAppointmentUpdatedCallback = null;


/**
 * 予約日入力欄に応じた祝日チェックとUIの警告・保存ボタン制御
 */
function validateAppointmentDateHoliday(dateValue) {
  const form = document.getElementById('appointmentEditForm');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  const dateInput = document.getElementById('aptDateInput');

  let alertEl = document.getElementById('aptHolidayAlertMessage');
  if (!alertEl && dateInput && dateInput.parentElement) {
    alertEl = document.createElement('div');
    alertEl.id = 'aptHolidayAlertMessage';
    alertEl.style.cssText = 'font-size:0.72rem; font-weight:700; color:#e11d48; margin-top:3px; display:none;';
    dateInput.parentElement.appendChild(alertEl);
  }

  const holidayName = getJapaneseHolidayName(dateValue);

  if (holidayName) {
    if (alertEl) {
      alertEl.textContent = `⚠️ 祝日（${holidayName}）のため登録できません`;
      alertEl.style.display = 'block';
    }
    if (dateInput) {
      dateInput.style.borderColor = '#f43f5e';
      dateInput.style.background = '#fff1f2';
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.45';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.title = `祝日（${holidayName}）のため保存できません`;
    }
    return false;
  } else {
    if (alertEl) {
      alertEl.textContent = '';
      alertEl.style.display = 'none';
    }
    if (dateInput) {
      dateInput.style.borderColor = '#cbd5e1';
      dateInput.style.background = '#fff';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
      submitBtn.title = '';
    }
    return true;
  }
}

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
  const dateInput = document.getElementById('aptDateInput');
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

  startTimeInput?.addEventListener('change', updateEndTime);
  startTimeInput?.addEventListener('input', updateEndTime);
  durationSelect?.addEventListener('change', updateEndTime);

  // 予約日変更時の祝日リアルタイムチェック
  dateInput?.addEventListener('change', (e) => {
    validateAppointmentDateHoliday(e.target.value);
  });
  dateInput?.addEventListener('input', (e) => {
    validateAppointmentDateHoliday(e.target.value);
  });

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
    if (!deleteAppointment(activeAppointmentId)) return;
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

  // ★祝日への登録を物理遮断ガード
  const holidayName = getJapaneseHolidayName(date);
  if (holidayName) {
    showToast(`⚠️ 祝日（${holidayName}）のため外来予約は登録できません`, 'error');
    validateAppointmentDateHoliday(date);
    return;
  }

  const rawStart = normalizeTimeHHmm(startTime) || startTime;
  const snappedStart = snapToNearestAppointmentSlot(rawStart);

  const res = upsertAppointment({
    id: activeAppointmentId,
    patientId,
    date,
    startTime: snappedStart,
    durationMinutes,
    therapistId,
    treatmentType,
    notes
  });

  if (!res.success) {
    if (!res.storageFailed) showToast(res.message || '予約の登録に失敗しました', 'error');
    return;
  }

  modal?.classList.remove('active');
  if (rawStart !== snappedStart) {
    showToast(`開始時刻 ${rawStart} を正本枠 ${snappedStart} に合わせて保存しました`, 'success');
  } else {
    showToast(activeAppointmentId ? '予約を更新しました' : '新規予約を登録しました', 'success');
  }

  // 患者用予約票の即時印刷要求がある場合
  if (shouldPrintTicket && res.appointment) {
    printAppointmentTicket(res.appointment);
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
  const rawTargetTime = appointment?.startTime || defaultTime || '09:00';
  const targetTime = snapToNearestAppointmentSlot(rawTargetTime);
  const targetDuration = appointment?.durationMinutes || 30;
  const pId = appointment?.patientId || '';

  if (dateInput) dateInput.value = targetDate;
  populateAppointmentStartTimeSelect(startTimeInput, targetTime);
  if (durationSelect) durationSelect.value = String(targetDuration);
  if (therapistSelect) therapistSelect.value = appointment?.therapistId || 'A';
  if (treatmentTypeSelect) treatmentTypeSelect.value = appointment?.treatmentType || 'INDIVIDUAL';
  if (notesInput) notesInput.value = appointment?.notes || '';
  if (patientIdInput) patientIdInput.value = pId;
  if (searchInput) searchInput.value = '';
  if (printCheck) printCheck.checked = false;

  const end = calculateEndTime(targetTime, targetDuration);
  if (endTimeDisplay) endTimeDisplay.textContent = `〜 ${end} 終了`;

  // 開いた直後の日付に対する祝日チェック・ボタン制御
  validateAppointmentDateHoliday(targetDate);

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

