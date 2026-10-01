// js/views/scheduleView.js
// VIEW 1: 当日時間割・患者パレット・コマ編集モーダル制御層（200行制限準拠）

import { TIME_SLOTS, THERAPISTS } from '../config/rules.js';
import { sanitizeHtml, safeParseInt } from '../core/dataNormalizer.js';
import { getPatientById, searchPatients } from '../store/patientStore.js';
import { getDailySchedule, setScheduleSlot, clearScheduleSlot, getDailyStats } from '../store/scheduleStore.js';
import { validateTimeConflict, validateDailyLimit, validateTherapistWorkload } from '../core/validator.js';
import { showToast } from './exportView.js';

let currentDateStr = new Date().toISOString().split('T')[0];
let paletteCategory = 'ALL';
let activeModalSlot = null; // { therapistId, slotId, currentItem }

export function initScheduleView() {
  const dateInput = document.getElementById('scheduleDateInput');
  const btnToday = document.getElementById('btnTodaySchedule');
  const searchInput = document.getElementById('paletteSearch');

  if (dateInput) {
    dateInput.value = currentDateStr;
    dateInput.addEventListener('change', (e) => {
      currentDateStr = e.target.value;
      renderScheduleView();
    });
  }
  if (btnToday) {
    btnToday.addEventListener('click', () => {
      currentDateStr = new Date().toISOString().split('T')[0];
      if (dateInput) dateInput.value = currentDateStr;
      renderScheduleView();
    });
  }
  if (searchInput) searchInput.addEventListener('input', () => renderPatientPalette());

  document.querySelectorAll('.palette-cat-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.palette-cat-btn').forEach((b) => b.classList.remove('active'));
      e.target.classList.add('active');
      paletteCategory = e.target.dataset.cat;
      renderPatientPalette();
    });
  });

  setupSlotModalListeners();
}

export function renderScheduleView() {
  renderDailyKPIStrip();
  renderPatientPalette();
  renderTimetableGrid();
}

function renderDailyKPIStrip() {
  const container = document.getElementById('dailyKpiStrip');
  if (!container) return;
  const stats = getDailyStats(currentDateStr);
  container.innerHTML = `
    <span style="color:#0369a1;">本日総単位: <strong>${stats.totalUnits}</strong> 単位</span>
    <span style="color:#059669;">患者数: <strong>${stats.totalPatients}</strong> 名</span>
    <span style="color:#854d0e;">計画書: <strong>${stats.planCount}</strong> 件</span>
    <span style="color:#64748b; font-size:0.8rem;">(A: ${stats.therapists.A.units}u / B: ${stats.therapists.B.units}u / C: ${stats.therapists.C.units}u)</span>
  `;
}

function renderPatientPalette() {
  const listEl = document.getElementById('palettePatientList');
  const searchInput = document.getElementById('paletteSearch');
  if (!listEl) return;

  const keyword = searchInput ? searchInput.value : '';
  const patients = searchPatients(keyword, paletteCategory);

  if (patients.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:16px;">該当する患者がいません</div>';
    return;
  }

  listEl.innerHTML = patients.map((p) => {
    const isOut = p.category === 'OUTPATIENT';
    const borderCol = isOut ? 'var(--color-outpatient)' : 'var(--color-inpatient)';
    return `
      <div class="patient-palette-card" draggable="true" data-patient-id="${p.id}"
           style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${borderCol}; border-radius:4px; padding:6px 8px; cursor:grab; font-size:0.78rem;">
        <div style="font-weight:700; display:flex; justify-content:space-between;">
          <span>${sanitizeHtml(p.name)}</span>
          <span style="font-size:0.7rem; color:#64748b;">${p.id}</span>
        </div>
        <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">${sanitizeHtml(p.diseaseName || '')}</div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.patient-palette-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', e.currentTarget.dataset.patientId);
    });
  });
}

function renderTimetableGrid() {
  const gridEl = document.getElementById('timetableGrid');
  if (!gridEl) return;

  const schedule = getDailySchedule(currentDateStr);
  let html = '<div class="timetable-header">時間帯</div>';
  THERAPISTS.forEach((t) => { html += `<div class="timetable-header">${t.name}</div>`; });

  const coveredUntil = { A: 0, B: 0, C: 0 };

  TIME_SLOTS.forEach((slot, index) => {
    html += `<div class="time-slot-row"><div class="time-col">${slot.label}</div>`;
    THERAPISTS.forEach((t) => {
      const tId = t.id;
      const cellData = schedule[tId]?.[slot.id];

      if (coveredUntil[tId] > index) {
        html += `<div class="cell-slot slot-covered-placeholder"></div>`;
        return;
      }

      if (cellData && cellData.patientId) {
        const p = getPatientById(cellData.patientId) || { name: '未登録', category: 'OUTPATIENT' };
        const u = Math.min(4, Math.max(1, safeParseInt(cellData.units, 1)));
        coveredUntil[tId] = index + u;
        const isOut = p.category === 'OUTPATIENT';
        const cardClass = isOut ? 'card-outpatient' : 'card-inpatient';

        html += `
          <div class="cell-slot">
            <div class="reha-slot-card ${cardClass} card-unit-${u}" data-therapist="${tId}" data-slot="${slot.id}">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <span style="font-weight:700; font-size:0.8rem;">${sanitizeHtml(p.name)}</span>
                <div>
                  <span class="badge-unit badge-unit-${u}">${u}単位</span>
                  ${cellData.billingPlan ? '<span class="badge-plan">📝計画書</span>' : ''}
                </div>
              </div>
              <div style="font-size:0.7rem; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${sanitizeHtml(cellData.note || p.diseaseName || '')}
              </div>
            </div>
          </div>`;
      } else {
        html += `
          <div class="cell-slot" data-therapist="${tId}" data-slot="${slot.id}">
            <button class="empty-slot-btn" data-therapist="${tId}" data-slot="${slot.id}">＋ 追加</button>
          </div>`;
      }
    });
    html += `</div>`;
  });

  gridEl.innerHTML = html;
  attachGridEventListeners(gridEl);
}

function attachGridEventListeners(gridEl) {
  gridEl.querySelectorAll('.empty-slot-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSlotModal(btn.dataset.therapist, btn.dataset.slot, null);
    });
  });

  gridEl.querySelectorAll('.reha-slot-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const tId = card.dataset.therapist;
      const sId = card.dataset.slot;
      const cur = getDailySchedule(currentDateStr)[tId]?.[sId];
      openSlotModal(tId, sId, cur);
    });
  });

  gridEl.querySelectorAll('.cell-slot:not(.slot-covered-placeholder)').forEach((cell) => {
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      const patientId = e.dataTransfer.getData('text/plain');
      const tId = cell.dataset.therapist;
      const sId = cell.dataset.slot;
      if (patientId && tId && sId) openSlotModal(tId, sId, { patientId, units: 1, note: '', billingPlan: false });
    });
  });
}

function setupSlotModalListeners() {
  const modal = document.getElementById('modalSlotEdit');
  const btnClose = document.getElementById('btnCloseSlotModal');
  const btnDelete = document.getElementById('btnDeleteSlot');
  const form = document.getElementById('slotEditForm');

  btnClose?.addEventListener('click', () => modal.classList.remove('active'));
  btnDelete?.addEventListener('click', () => {
    if (!activeModalSlot) return;
    clearScheduleSlot(currentDateStr, activeModalSlot.therapistId, activeModalSlot.slotId);
    modal.classList.remove('active');
    showToast('コマの配置を解除しました', 'warn');
    renderScheduleView();
  });

  document.querySelectorAll('.btn-unit-select').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.btn-unit-select').forEach((b) => b.style.background = '#fff');
      e.target.style.background = '#e0f2fe';
      document.getElementById('slotUnitsInput').value = e.target.dataset.unit;
    });
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!activeModalSlot) return;

    const patientId = document.getElementById('slotPatientId').value;
    const units = safeParseInt(document.getElementById('slotUnitsInput').value, 1);
    const note = document.getElementById('slotNoteInput').value;
    const billingPlan = document.getElementById('slotBillingPlanInput').checked;

    const dailySchedule = getDailySchedule(currentDateStr);
    const currentUnits = activeModalSlot.currentItem ? activeModalSlot.currentItem.units : 0;
    const patient = getPatientById(patientId);

    // 1. 重複ガード
    const conflictCheck = validateTimeConflict(dailySchedule, activeModalSlot.therapistId, activeModalSlot.slotId, patientId, units, activeModalSlot.slotId);
    if (!conflictCheck.valid) { showToast(conflictCheck.message, 'error'); return; }

    // 2. 患者1日上限ガード
    if (patient) {
      const dailyLimitCheck = validateDailyLimit(dailySchedule, patient, currentDateStr, units, currentUnits);
      if (!dailyLimitCheck.valid) { showToast(dailyLimitCheck.message, 'error'); return; }
    }

    // 3. セラピスト上限ガード
    const workloadCheck = validateTherapistWorkload(dailySchedule, activeModalSlot.therapistId, units, currentUnits);
    if (!workloadCheck.valid) { showToast(workloadCheck.message, 'error'); return; }
    if (workloadCheck.message) showToast(workloadCheck.message, 'warn');

    setScheduleSlot(currentDateStr, activeModalSlot.therapistId, activeModalSlot.slotId, { patientId, units, note, billingPlan });
    modal.classList.remove('active');
    showToast('スケジュールを保存しました', 'success');
    renderScheduleView();
  });
}

function openSlotModal(therapistId, slotId, currentItem) {
  activeModalSlot = { therapistId, slotId, currentItem };
  const modal = document.getElementById('modalSlotEdit');
  const titleEl = document.getElementById('slotModalTitle');
  const patientInfoEl = document.getElementById('slotPatientInfo');
  const btnDelete = document.getElementById('btnDeleteSlot');

  titleEl.textContent = `コマ配置 (PT ${therapistId} / ${TIME_SLOTS.find((s) => s.id === slotId)?.label || slotId})`;
  btnDelete.style.display = currentItem ? 'block' : 'none';

  const pId = currentItem?.patientId || document.querySelector('.patient-palette-card')?.dataset.patientId || '';
  const patient = getPatientById(pId);

  document.getElementById('slotPatientId').value = pId;
  document.getElementById('slotTherapistId').value = therapistId;
  document.getElementById('slotId').value = slotId;
  patientInfoEl.textContent = patient ? `患者: ${patient.name} (${patient.id}) / ${patient.diseaseName || ''}` : '患者が選択されていません';

  const units = currentItem?.units || 1;
  document.getElementById('slotUnitsInput').value = units;
  document.querySelectorAll('.btn-unit-select').forEach((b) => {
    b.style.background = b.dataset.unit == units ? '#e0f2fe' : '#fff';
  });

  document.getElementById('slotBillingPlanInput').checked = Boolean(currentItem?.billingPlan);
  document.getElementById('slotNoteInput').value = currentItem?.note || '';

  modal.classList.add('active');
}
