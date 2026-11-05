// js/views/modals/dialysisModal.js
// 透析時運動指導等加算（75点）並行レーン用モーダル（コマ別複数患者登録・解除）

import { TIME_SLOTS } from '../../config/rules.js';
import { sanitizeHtml } from '../../core/dataNormalizer.js';
import { getAllPatients, searchPatients } from '../../store/patientStore.js';
import {
  addDialysisPatient, removeDialysisPatient, getDialysisSlotPatients
} from '../../store/scheduleStore.js';
import { getLocalDateStr } from '../../core/dateUtils.js';
import { showToast } from '../../ui/toast.js';

let activeDialysisSlotId = null;
let onScheduleUpdatedCallback = null;

export function setupDialysisModalListeners(onUpdate) {
  onScheduleUpdatedCallback = onUpdate;

  const modal = document.getElementById('modalDialysisEdit');
  const btnClose = document.getElementById('btnCloseDialysisModal');
  const btnAdd = document.getElementById('btnConfirmAddDialysis');
  const searchInput = document.getElementById('dialysisPatientSearchInput');

  btnClose?.addEventListener('click', () => modal?.classList.remove('active'));

  searchInput?.addEventListener('input', () => {
    populateDialysisPatientSelect(searchInput.value || '');
  });

  btnAdd?.addEventListener('click', () => {
    const select = document.getElementById('dialysisAddPatientSelect');
    const pId = select?.value;
    const currentDateStr = getCurrentDateContext();
    if (!pId || !activeDialysisSlotId) {
      showToast('追加する患者を選択してください', 'warn');
      return;
    }

    if (!addDialysisPatient(currentDateStr, activeDialysisSlotId, pId)) return;
    showToast('透析運動加算に患者を追加しました', 'success');
    renderDialysisModalList();
    populateDialysisPatientSelect(searchInput?.value || '');
    if (typeof window.triggerDailyBackup === 'function') {
      window.triggerDailyBackup();
    }
    if (typeof onScheduleUpdatedCallback === 'function') onScheduleUpdatedCallback();
  });
}

/**
 * @param {string} slotId
 */
export function openDialysisModal(slotId) {
  activeDialysisSlotId = slotId;
  const modal = document.getElementById('modalDialysisEdit');
  const slotObj = TIME_SLOTS.find((s) => s.id === slotId);
  const titleEl = document.getElementById('dialysisModalTitle');
  if (titleEl) {
    titleEl.textContent = `⚡ 透析時運動指導等加算 (75点) - コマ登録 [${slotObj?.label || slotId}]`;
  }

  const searchInput = document.getElementById('dialysisPatientSearchInput');
  if (searchInput) searchInput.value = '';
  populateDialysisPatientSelect('');
  renderDialysisModalList();
  modal?.classList.add('active');
}

/**
 * @param {string} keyword
 */
function populateDialysisPatientSelect(keyword = '') {
  const select = document.getElementById('dialysisAddPatientSelect');
  if (!select) return;

  const registeredIds = new Set(
    getDialysisSlotPatients(getCurrentDateContext(), activeDialysisSlotId || '')
      .map((p) => p.id)
  );

  const patients = String(keyword || '').trim()
    ? searchPatients(keyword, 'ALL')
    : getAllPatients();

  const options = patients
    .filter((p) => !registeredIds.has(p.id))
    .map((p) => {
      const cat = p.category === 'INPATIENT' ? '入院' : '外来';
      return `<option value="${p.id}">${p.id} - ${sanitizeHtml(p.name)} (${cat} / ${sanitizeHtml(p.diseaseName || '')})</option>`;
    })
    .join('');

  select.innerHTML =
    `<option value="">-- 追加する患者を選択 --</option>${options}`;
}

function renderDialysisModalList() {
  const currentDateStr = getCurrentDateContext();
  const listEl = document.getElementById('dialysisPatientList');
  if (!listEl || !activeDialysisSlotId) return;

  const patients = getDialysisSlotPatients(currentDateStr, activeDialysisSlotId);
  if (patients.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.78rem; color:#94a3b8; text-align:center; padding:16px;">当コマの透析運動加算患者はいません</div>';
    return;
  }

  listEl.innerHTML = patients
    .map((p) => {
      const catBadge =
        p.category === 'INPATIENT'
          ? '<span style="background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:3px; font-weight:700; font-size:0.7rem;">入院</span>'
          : '<span style="background:#eff6ff; color:#1d4ed8; padding:2px 6px; border-radius:3px; font-weight:700; font-size:0.7rem;">外来</span>';

      return `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #bae6fd; border-radius:4px; padding:6px 10px;">
          <div style="display:flex; align-items:center; gap:8px;">
            ${catBadge}
            <strong style="font-size:0.82rem; color:#0f172a;">${sanitizeHtml(p.name)}</strong>
            <span style="font-size:0.72rem; color:#64748b;">(${p.id})</span>
            <span style="font-size:0.72rem; color:#64748b; margin-left:4px;">${sanitizeHtml(p.diseaseName || '')}</span>
          </div>
          <button type="button" class="btn-remove-dialysis" data-patient-id="${p.id}"
                  style="padding:3px 8px; font-size:0.72rem; background:#fff; border:1px solid #cbd5e1; color:#ef4444; border-radius:4px; cursor:pointer;">解除</button>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.btn-remove-dialysis').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!removeDialysisPatient(currentDateStr, activeDialysisSlotId, btn.dataset.patientId)) return;
      showToast('透析運動加算から患者を解除しました', 'warn');
      renderDialysisModalList();
      populateDialysisPatientSelect(document.getElementById('dialysisPatientSearchInput')?.value || '');
      if (typeof window.triggerDailyBackup === 'function') {
        window.triggerDailyBackup();
      }
      if (typeof onScheduleUpdatedCallback === 'function') onScheduleUpdatedCallback();
    });
  });
}

function getCurrentDateContext() {
  const dateInput = document.getElementById('scheduleDateInput');
  return dateInput?.value || getLocalDateStr();
}
