// js/views/scheduleView.js
// VIEW 1: 当日時間割・消炎鎮痛マルチ来院・患者パレット・計画書月1回ロック制御層（200行制限準拠）

import { TIME_SLOTS, THERAPISTS } from '../config/rules.js';
import { sanitizeHtml, safeParseInt } from '../core/dataNormalizer.js';
import { getPatientById, searchPatients, getAllPatients } from '../store/patientStore.js';
import {
  getDailySchedule, setScheduleSlot, clearScheduleSlot, getDailyStats,
  findPatientMonthlyPlanDate, addAnalgesiaPatient, removeAnalgesiaPatient, getAnalgesiaSlotPatients
} from '../store/scheduleStore.js';
import { validateTimeConflict, validateDailyLimit, validateTherapistWorkload, validateMonthlyPlanLimit } from '../core/validator.js';
import { showToast } from './exportView.js';

let currentDateStr = new Date().toISOString().split('T')[0];
let paletteCategory = 'ALL';
let activeModalSlot = null; // { therapistId, slotId, currentItem }
let activeAnalgesiaSlotId = null;

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
  setupAnalgesiaModalListeners();
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
  const aTot = stats.analgesia?.total || 0;
  container.innerHTML = `
    <span style="color:#0369a1;">個別リハ総単位: <strong>${stats.totalUnits}</strong> 単位</span>
    <span style="color:#059669;">患者数: <strong>${stats.totalPatients}</strong> 名</span>
    <span style="color:#16a34a; background:#dcfce7; padding:2px 8px; border-radius:4px;">消炎鎮痛: <strong>${aTot}</strong>名 (入${stats.analgesia?.inpatients || 0}/外${stats.analgesia?.outpatients || 0})</span>
    <span style="color:#854d0e;">計画書: <strong>${stats.planCount}</strong> 件</span>
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
      </div>`;
  }).join('');

  listEl.querySelectorAll('.patient-palette-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', e.currentTarget.dataset.patientId));
  });
}

function renderTimetableGrid() {
  const gridEl = document.getElementById('timetableGrid');
  if (!gridEl) return;

  const schedule = getDailySchedule(currentDateStr);
  let html = '<div class="timetable-header">時間帯</div>';
  THERAPISTS.forEach((t) => { html += `<div class="timetable-header">${t.name}</div>`; });
  html += '<div class="timetable-header" style="background:#f0fdf4; color:#166534;">消炎鎮痛</div>';

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

    // 消炎鎮痛セル（人数バッジの前面表示）
    const analgesiaPatients = getAnalgesiaSlotPatients(currentDateStr, slot.id);
    const aCount = analgesiaPatients.length;
    let badgeHtml = '';
    if (aCount > 0) {
      const inCount = analgesiaPatients.filter((p) => p.category === 'INPATIENT').length;
      const outCount = aCount - inCount;
      badgeHtml = `
        <button class="badge-analgesia-count has-patients" data-analgesia-slot="${slot.id}">
          <span style="font-weight:800; font-size:0.85rem; color:#15803d;">${aCount}名</span>
          <span style="font-size:0.65rem; color:#166534;">(入${inCount}/外${outCount})</span>
        </button>`;
    } else {
      badgeHtml = `<button class="badge-analgesia-count" data-analgesia-slot="${slot.id}" style="color:#94a3b8; font-size:0.75rem;">＋</button>`;
    }

    html += `<div class="cell-slot analgesia-slot-cell" data-analgesia-drop="${slot.id}">${badgeHtml}</div></div>`;
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

  gridEl.querySelectorAll('.cell-slot[data-therapist]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      const patientId = e.dataTransfer.getData('text/plain');
      const tId = cell.dataset.therapist;
      const sId = cell.dataset.slot;
      if (patientId && tId && sId) openSlotModal(tId, sId, { patientId, units: 1, note: '', billingPlan: false });
    });
  });

  // 消炎鎮痛セルのクリック（内訳モーダル起動）およびドラッグ＆ドロップ登録
  gridEl.querySelectorAll('.badge-analgesia-count').forEach((badge) => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      openAnalgesiaModal(badge.dataset.analgesiaSlot);
    });
  });

  gridEl.querySelectorAll('.cell-slot[data-analgesia-drop]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      const patientId = e.dataTransfer.getData('text/plain');
      const slotId = cell.dataset.analgesiaDrop;
      if (patientId && slotId) {
        addAnalgesiaPatient(currentDateStr, slotId, patientId);
        showToast('消炎鎮痛に患者を追加しました', 'success');
        renderScheduleView();
      }
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

    if (!patientId) {
      showToast('患者が選択されていません', 'error');
      return;
    }

    const dailySchedule = getDailySchedule(currentDateStr);
    const currentUnits = activeModalSlot.currentItem ? activeModalSlot.currentItem.units : 0;
    const patient = getPatientById(patientId);

    const conflictCheck = validateTimeConflict(dailySchedule, activeModalSlot.therapistId, activeModalSlot.slotId, patientId, units, activeModalSlot.slotId);
    if (!conflictCheck.valid) { showToast(conflictCheck.message, 'error'); return; }

    if (patient) {
      const dailyLimitCheck = validateDailyLimit(dailySchedule, patient, currentDateStr, units, currentUnits);
      if (!dailyLimitCheck.valid) { showToast(dailyLimitCheck.message, 'error'); return; }
    }

    if (billingPlan) {
      const [year, month] = currentDateStr.split('-').map(Number);
      const excludeSlot = activeModalSlot.currentItem ? activeModalSlot.slotId : '';
      const existingDate = findPatientMonthlyPlanDate(patientId, year, month, currentDateStr, excludeSlot);
      const planCheck = validateMonthlyPlanLimit(billingPlan, existingDate);
      if (!planCheck.valid) { showToast(planCheck.message, 'error'); return; }
    }

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
  const planInput = document.getElementById('slotBillingPlanInput');

  titleEl.textContent = `コマ配置 (PT ${therapistId} / ${TIME_SLOTS.find((s) => s.id === slotId)?.label || slotId})`;
  btnDelete.style.display = currentItem ? 'block' : 'none';

  const pId = currentItem?.patientId || '';
  const patient = pId ? getPatientById(pId) : null;

  document.getElementById('slotPatientId').value = pId;
  document.getElementById('slotTherapistId').value = therapistId;
  document.getElementById('slotId').value = slotId;
  patientInfoEl.textContent = patient ? `患者: ${patient.name} (${patient.id}) / ${patient.diseaseName || ''}` : '患者が未選択です（パレットからドラッグ＆ドロップしてください）';

  const units = currentItem?.units || 1;
  document.getElementById('slotUnitsInput').value = units;
  document.querySelectorAll('.btn-unit-select').forEach((b) => {
    b.style.background = b.dataset.unit == units ? '#e0f2fe' : '#fff';
  });

  if (!pId) {
    planInput.checked = false;
    planInput.disabled = true;
  } else {
    const [year, month] = currentDateStr.split('-').map(Number);
    const excludeSlot = currentItem ? slotId : '';
    const existingDate = findPatientMonthlyPlanDate(pId, year, month, currentDateStr, excludeSlot);

    if (existingDate) {
      planInput.checked = false;
      planInput.disabled = true;
      patientInfoEl.innerHTML += `<div style="color:#e11d48; font-size:0.75rem; margin-top:4px; font-weight:700;">⚠️ 総合計画評価料は当月 ${existingDate} に算定済みのため選択できません（月1回のみ）</div>`;
    } else {
      planInput.disabled = false;
      planInput.checked = Boolean(currentItem?.billingPlan);
    }
  }

  document.getElementById('slotNoteInput').value = currentItem?.note || '';
  modal.classList.add('active');
}

function setupAnalgesiaModalListeners() {
  const modal = document.getElementById('modalAnalgesiaSlot');
  const btnClose = document.getElementById('btnCloseAnalgesiaModal');
  const btnAdd = document.getElementById('btnConfirmAddAnalgesia');

  btnClose?.addEventListener('click', () => modal.classList.remove('active'));

  btnAdd?.addEventListener('click', () => {
    const select = document.getElementById('analgesiaAddPatientSelect');
    const pId = select?.value;
    if (!pId || !activeAnalgesiaSlotId) return;

    addAnalgesiaPatient(currentDateStr, activeAnalgesiaSlotId, pId);
    showToast('消炎鎮痛患者を追加しました', 'success');
    renderAnalgesiaModalList();
    renderScheduleView();
  });
}

function openAnalgesiaModal(slotId) {
  activeAnalgesiaSlotId = slotId;
  const modal = document.getElementById('modalAnalgesiaSlot');
  const slotObj = TIME_SLOTS.find((s) => s.id === slotId);
  const titleEl = document.getElementById('analgesiaModalTitle');
  if (titleEl) titleEl.textContent = `消炎鎮痛（物療）来院一覧 [${slotObj?.label || slotId}]`;

  // 患者選択プルダウンを更新
  const select = document.getElementById('analgesiaAddPatientSelect');
  if (select) {
    const patients = getAllPatients();
    select.innerHTML = '<option value="">-- 追加する患者を選択 --</option>' +
      patients.map((p) => {
        const cat = p.category === 'INPATIENT' ? '入院' : '外来';
        return `<option value="${p.id}">${p.id} - ${sanitizeHtml(p.name)} (${cat} / ${sanitizeHtml(p.diseaseName || '')})</option>`;
      }).join('');
  }

  renderAnalgesiaModalList();
  modal.classList.add('active');
}

function renderAnalgesiaModalList() {
  const listEl = document.getElementById('analgesiaPatientList');
  if (!listEl || !activeAnalgesiaSlotId) return;

  const patients = getAnalgesiaSlotPatients(currentDateStr, activeAnalgesiaSlotId);
  if (patients.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.78rem; color:#94a3b8; text-align:center; padding:16px;">当コマの消炎鎮痛患者はいません</div>';
    return;
  }

  listEl.innerHTML = patients.map((p) => {
    const isIn = p.category === 'INPATIENT';
    const catBadge = isIn
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
  }).join('');

  listEl.querySelectorAll('.btn-remove-analgesia').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pId = btn.dataset.patientId;
      removeAnalgesiaPatient(currentDateStr, activeAnalgesiaSlotId, pId);
      showToast('消炎鎮痛から患者を解除しました', 'warn');
      renderAnalgesiaModalList();
      renderScheduleView();
    });
  });
}
