// js/views/modals/appointmentModal.js
// 外来予約登録・編集モーダル制御層
// 自由時間入力・所要時間選択・患者リアルタイム検索・終了時刻自動計算・患者予約票即時印刷連携
// ★祝日・振替休日のリアルタイム検知 ＆ 予約登録物理遮断ガード完全対応版

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
 * 日本の祝日・振替休日・国民の休日オフライン高精度判定エンジン
 */
function getJapaneseHolidayName(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;

  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const date = d.getDate();
  const day = d.getDay();

  // 単独祝日の判定
  const checkBaseHoliday = (year, month, dayOfMonth) => {
    const curDate = new Date(year, month - 1, dayOfMonth);
    const dayOfWeek = curDate.getDay();
    const nth = Math.floor((dayOfMonth - 1) / 7) + 1;

    // 天文計算式による春分の日・秋分の日の算出 (1980〜2099年対応)
    const vEq = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    const aEq = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));

    if (month === 1) {
      if (dayOfMonth === 1) return '元日';
      if (dayOfWeek === 1 && nth === 2) return '成人の日';
    } else if (month === 2) {
      if (dayOfMonth === 11) return '建国記念の日';
      if (dayOfMonth === 23 && year >= 2020) return '天皇誕生日';
    } else if (month === 3) {
      if (dayOfMonth === vEq) return '春分の日';
    } else if (month === 4) {
      if (dayOfMonth === 29) return '昭和の日';
    } else if (month === 5) {
      if (dayOfMonth === 3) return '憲法記念日';
      if (dayOfMonth === 4) return 'みどりの日';
      if (dayOfMonth === 5) return 'こどもの日';
    } else if (month === 7) {
      if (dayOfWeek === 1 && nth === 3) return '海の日';
    } else if (month === 8) {
      if (dayOfMonth === 11 && year >= 2016) return '山の日';
    } else if (month === 9) {
      if (dayOfWeek === 1 && nth === 3) return '敬老の日';
      if (dayOfMonth === aEq) return '秋分の日';
    } else if (month === 10) {
      if (dayOfWeek === 1 && nth === 2) return 'スポーツの日';
    } else if (month === 11) {
      if (dayOfMonth === 3) return '文化の日';
      if (dayOfMonth === 23) return '勤労感謝の日';
    }
    return null;
  };

  const baseName = checkBaseHoliday(y, m, date);
  if (baseName) return baseName;

  // 国民の休日判定（祝日と祝日に挟まれた平日）
  if (day !== 0) {
    const prevDate = new Date(y, m - 1, date - 1);
    const nextDate = new Date(y, m - 1, date + 1);
    const prevHoliday = checkBaseHoliday(prevDate.getFullYear(), prevDate.getMonth() + 1, prevDate.getDate());
    const nextHoliday = checkBaseHoliday(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
    if (prevHoliday && nextHoliday) {
      return '国民の休日';
    }
  }

  // 振替休日判定（日曜日に祝日があり、その直後の連続した平日）
  if (day !== 0) {
    for (let back = 1; back <= 6; back++) {
      const checkD = new Date(y, m - 1, date - back);
      const isSunday = checkD.getDay() === 0;
      const hName = checkBaseHoliday(checkD.getFullYear(), checkD.getMonth() + 1, checkD.getDate());
      if (!hName) {
        break;
      }
      if (isSunday) {
        return '振替休日';
      }
    }
  }

  return null;
}

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

  // ★祝日への登録を物理遮断ガード
  const holidayName = getJapaneseHolidayName(date);
  if (holidayName) {
    showToast(`⚠️ 祝日（${holidayName}）のため外来予約は登録できません`, 'error');
    validateAppointmentDateHoliday(date);
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
