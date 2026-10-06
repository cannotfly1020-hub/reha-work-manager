// js/views/modals/analgesiaModal.js
// 消炎鎮痛（物療）来院モーダル制御層（コマ別来院一覧・患者追加・解除）

import { TIME_SLOTS } from '../../config/rules.js';
import { sanitizeHtml } from '../../core/dataNormalizer.js';
import { getAllPatients } from '../../store/patientStore.js';
import {
  addAnalgesiaPatient, removeAnalgesiaPatient, getAnalgesiaSlotPatients
} from '../../store/scheduleStore.js';
import { showToast } from '../exportView.js';

let activeAnalgesiaSlotId = null;
let onScheduleUpdatedCallback = null;

export function setupAnalgesiaModalListeners(onUpdate) {
  onScheduleUpdatedCallback = onUpdate;

  const modal = document.getElementById('modalAnalgesiaSlot');
  const btnClose = document.getElementById('btnCloseAnalgesiaModal');
  const btnAdd = document.getElementById('btnConfirmAddAnalgesia');

  btnClose?.addEventListener('click', () => modal?.classList.remove('active'));

  btnAdd?.addEventListener('click', () => {
    const select = document.getElementById('analgesiaAddPatientSelect');
    const pId = select?.value;
    const currentDateStr = getCurrentDateContext();
    if (!pId || !activeAnalgesiaSlotId) return;

    addAnalgesiaPatient(currentDateStr, activeAnalgesiaSlotId, pId);
    showToast('消炎鎮痛患者を追加しました', 'success');
    renderAnalgesiaModalList();
    if (typeof onScheduleUpdatedCallback === 'function') onScheduleUpdatedCallback();
  });
}

export function openAnalgesiaModal(slotId) {
  activeAnalgesiaSlotId = slotId;
  const modal = document.getElementById('modalAnalgesiaSlot');
  const slotObj = TIME_SLOTS.find((s) => s.id === slotId);
  const titleEl = document.getElementById('analgesiaModalTitle');
  if (titleEl) titleEl.textContent = `消炎鎮痛来院一覧 [${slotObj?.label || slotId}]`;

  const select = document.getElementById('analgesiaAddPatientSelect');
  if (select) {
    const patients = getAllPatients();
    select.innerHTML =
      '<option value="">-- 追加する患者を選択 --</option>' +
      patients
        .map((p) => {
          const cat = p.category === 'INPATIENT' ? '入院' : '外来';
          return `<option value="${p.id}">${p.id} - ${sanitizeHtml(p.name)} (${cat} / ${sanitizeHtml(p.diseaseName || '')})</option>`;
        })
        .join('');
  }

  renderAnalgesiaModalList();
  modal?.classList.add('active');
}

function renderAnalgesiaModalList() {
  const currentDateStr = getCurrentDateContext();
  const listEl = document.getElementById('analgesiaPatientList');
  if (!listEl || !activeAnalgesiaSlotId) return;

  const patients = getAnalgesiaSlotPatients(currentDateStr, activeAnalgesiaSlotId);
  if (patients.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.78rem; color:#94a3b8; text-align:center; padding:16px;">当コマの消炎鎮痛患者はいません</div>';
    return;
  }

  listEl.innerHTML = patients
    .map((p) => {
      const catBadge =
        p.category === 'INPATIENT'
          ? '<span style="background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:3px; font-weight:700; font-size:0.7rem;">入院</span>'
          : '<span style="background:#eff6ff; color:#1d4ed8; padding:2px 6px; border-radius:3px; font-weight:700; font-size:0.7rem;">外来</span>';

      return `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #e2e8f0; border-radius:4px; padding:6px 10px;">
          <div style="display:flex; align-items:center; gap:8px;">
            ${catBadge}
            <strong style="font-size:0.82rem; color:#0f172a;">${sanitizeHtml(p.name)}</strong>
            <span style="font-size:0.72rem; color:#64748b;">(${p.id})</span>
            <span style="font-size:0.72rem; color:#64748b; margin-left:4px;">${sanitizeHtml(p.diseaseName || '')}</span>
          </div>
          <button class="btn-remove-analgesia" data-patient-id="${p.id}"
                  style="padding:3px 8px; font-size:0.72rem; background:#fff; border:1px solid #cbd5e1; color:#ef4444; border-radius:4px; cursor:pointer;">解除</button>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.btn-remove-analgesia').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeAnalgesiaPatient(currentDateStr, activeAnalgesiaSlotId, btn.dataset.patientId);
      showToast('消炎鎮痛から患者を解除しました', 'warn');
      renderAnalgesiaModalList();
      if (typeof onScheduleUpdatedCallback === 'function') onScheduleUpdatedCallback();
    });
  });
}

function getCurrentDateContext() {
  const dateInput = document.getElementById('scheduleDateInput');
  return dateInput?.value || new Date().toISOString().split('T')[0];
}
