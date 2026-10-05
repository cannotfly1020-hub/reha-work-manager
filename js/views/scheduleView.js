// js/views/scheduleView.js
// VIEW 1: 当日時間割・コマ移動・消炎鎮痛来院・患者パレット・疾患タグ・早期期限バッジ・計画書4区分自動判定・セラピスト表示名動的連動・台帳同期

import { TIME_SLOTS, REHA_RULES } from '../config/rules.js';
import { sanitizeHtml, safeParseInt } from '../core/dataNormalizer.js';
import { getAllTherapists, updateTherapistNames, saveAllTherapists } from '../store/therapistStore.js';
import { getPatientById, searchPatients, getAllPatients, updatePatientPlanStatus } from '../store/patientStore.js';
import {
  getDailySchedule, setScheduleSlot, clearScheduleSlot, moveScheduleSlot, getDailyStats,
  findPatientMonthlyPlanDate, hasPatientPastPlan, addAnalgesiaPatient, removeAnalgesiaPatient, getAnalgesiaSlotPatients
} from '../store/scheduleStore.js';
import { calculatePatientDeadlines, evaluateRecommendedPlan } from '../core/deadlineCalc.js';
import { validateTimeConflict, validateDailyLimit, validateTherapistWorkload, validateMonthlyPlanLimit } from '../core/validator.js';
import { showToast } from './exportView.js';

let currentDateStr = new Date().toISOString().split('T')[0];
let paletteCategory = 'ALL';
let activeModalSlot = null;
let activeAnalgesiaSlotId = null;

export function initScheduleView() {
  const dateInput = document.getElementById('scheduleDateInput');
  const btnToday = document.getElementById('btnTodaySchedule');
  const searchInput = document.getElementById('paletteSearch');

  if (dateInput) {
    dateInput.value = currentDateStr;
    dateInput.addEventListener('change', (e) => { currentDateStr = e.target.value; renderScheduleView(); });
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
  setupStaffSettingsModalListeners();
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
    const disRule = REHA_RULES.LIMIT_DAYS[p.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
    const tagHtml = `<span style="font-size:0.65rem; font-weight:700; background:${disRule.tagBg}; color:${disRule.tagColor}; border:1px solid ${disRule.tagBorder}; padding:1px 4px; border-radius:3px; margin-right:4px;">${disRule.tag}</span>`;

    return `
      <div class="patient-palette-card" draggable="true" data-patient-id="${p.id}"
           style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${borderCol}; border-radius:4px; padding:6px 8px; cursor:grab; font-size:0.78rem;">
        <div style="font-weight:700; display:flex; justify-content:space-between; align-items:center;">
          <div>${tagHtml}<span>${sanitizeHtml(p.name)}</span></div>
          <span style="font-size:0.7rem; color:#64748b;">${p.id}</span>
        </div>
        <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">${sanitizeHtml(p.diseaseName || '')}</div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.patient-palette-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'NEW_PATIENT', patientId: e.currentTarget.dataset.patientId }));
      e.dataTransfer.setData('text/plain', e.currentTarget.dataset.patientId);
    });
  });
}

function buildSlotCardHtml(p, u, cellData, tId, slotId) {
  const isOut = p.category === 'OUTPATIENT';
  const cardClass = isOut ? 'card-outpatient' : 'card-inpatient';
  const disRule = REHA_RULES.LIMIT_DAYS[p.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
  const diseaseTag = `<span style="font-size:0.65rem; font-weight:700; background:${disRule.tagBg}; color:${disRule.tagColor}; border:1px solid ${disRule.tagBorder}; padding:1px 3px; border-radius:3px; margin-right:4px;">${disRule.tag}</span>`;

  let planBadge = '';
  if (cellData.billingPlan) {
    const lbl = String(cellData.billingPlan).includes('PLAN_2') ? '📝計2' : '📝計画書';
    planBadge = `<span class="badge-plan" style="margin-left:2px;">${lbl}</span>`;
  }

  let earlyBadge = '';
  if (!isOut) {
    const dl = calculatePatientDeadlines(p, currentDateStr);
    if (dl.earlyBonus?.isEligible && dl.earlyBonus.shortLabel) {
      const isUrgent = dl.earlyBonus.remainingDays !== null && dl.earlyBonus.remainingDays <= 3;
      const bBg = isUrgent ? '#fef3c7' : '#ecfdf5';
      const bCol = isUrgent ? '#b45309' : '#047857';
      const bBorder = isUrgent ? '#f59e0b' : '#10b981';
      earlyBadge = `<span style="font-size:0.63rem; font-weight:700; background:${bBg}; color:${bCol}; border:1px solid ${bBorder}; padding:1px 4px; border-radius:3px; margin-left:3px;" title="${dl.earlyBonus.label}">${dl.earlyBonus.shortLabel}</span>`;
    }
  }

  return `
    <div class="cell-slot">
      <div class="reha-slot-card ${cardClass} card-unit-${u}" draggable="true" data-therapist="${tId}" data-slot="${slotId}" style="cursor:grab;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${diseaseTag}<span style="font-weight:700; font-size:0.8rem;">${sanitizeHtml(p.name)}</span>
          </div>
          <div style="display:flex; align-items:center; flex-shrink:0;">
            <span class="badge-unit badge-unit-${u}">${u}単位</span>${planBadge}${earlyBadge}
          </div>
        </div>
        <div style="font-size:0.68rem; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
          ${sanitizeHtml(cellData.note || p.diseaseName || '')}
        </div>
      </div>
    </div>`;
}

function renderTimetableGrid() {
  const gridEl = document.getElementById('timetableGrid');
  if (!gridEl) return;

  const therapists = getAllTherapists();
  const schedule = getDailySchedule(currentDateStr);
  let html = '<div class="timetable-header">時間帯</div>';
  therapists.forEach((t) => { html += `<div class="timetable-header">${sanitizeHtml(t.name)}</div>`; });
  html += '<div class="timetable-header" style="background:#f0fdf4; color:#166534;">消炎鎮痛</div>';

  const coveredUntil = {};
  therapists.forEach((t) => { coveredUntil[t.id] = 0; });

  TIME_SLOTS.forEach((slot, index) => {
    html += `<div class="time-slot-row"><div class="time-col">${slot.label}</div>`;
    therapists.forEach((t) => {
      const tId = t.id;
      const cellData = schedule[tId]?.[slot.id];

      if (coveredUntil[tId] > index) {
        html += `<div class="cell-slot slot-covered-placeholder"></div>`;
        return;
      }

      if (cellData && cellData.patientId) {
        const p = getPatientById(cellData.patientId) || { name: '未登録', category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE' };
        const u = Math.min(4, Math.max(1, safeParseInt(cellData.units, 1)));
        coveredUntil[tId] = index + u;
        html += buildSlotCardHtml(p, u, cellData, tId, slot.id);
      } else {
        html += `<div class="cell-slot" data-therapist="${tId}" data-slot="${slot.id}"><button class="empty-slot-btn" data-therapist="${tId}" data-slot="${slot.id}">＋ 追加</button></div>`;
      }
    });

    const aPatients = getAnalgesiaSlotPatients(currentDateStr, slot.id);
    const aCount = aPatients.length;
    let bHtml = `<button class="badge-analgesia-count" data-analgesia-slot="${slot.id}" style="color:#94a3b8; font-size:0.75rem;">＋</button>`;
    if (aCount > 0) {
      const inC = aPatients.filter((p) => p.category === 'INPATIENT').length;
      bHtml = `<button class="badge-analgesia-count has-patients" data-analgesia-slot="${slot.id}"><span style="font-weight:800; font-size:0.85rem; color:#15803d;">${aCount}名</span><span style="font-size:0.65rem; color:#166534;">(入${inC}/外${aCount - inC})</span></button>`;
    }
    html += `<div class="cell-slot analgesia-slot-cell" data-analgesia-drop="${slot.id}">${bHtml}</div></div>`;
  });

  gridEl.innerHTML = html;
  attachGridEventListeners(gridEl);
}

function attachGridEventListeners(gridEl) {
  gridEl.querySelectorAll('.empty-slot-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openSlotModal(btn.dataset.therapist, btn.dataset.slot, null); });
  });

  gridEl.querySelectorAll('.reha-slot-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const tId = card.dataset.therapist;
      const sId = card.dataset.slot;
      openSlotModal(tId, sId, getDailySchedule(currentDateStr)[tId]?.[sId]);
    });
    card.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      const moveData = { type: 'MOVE_SLOT', fromTherapist: card.dataset.therapist, fromSlot: card.dataset.slot };
      e.dataTransfer.setData('application/json', JSON.stringify(moveData));
      e.dataTransfer.setData('text/plain', card.dataset.therapist + ':' + card.dataset.slot);
    });
  });

  gridEl.querySelectorAll('.cell-slot[data-therapist]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetTId = cell.dataset.therapist;
      const targetSId = cell.dataset.slot;
      if (!targetTId || !targetSId) return;

      let rawData = null;
      try { rawData = JSON.parse(e.dataTransfer.getData('application/json')); } catch (_) {}

      // A: コマ移動のドロップ処理
      if (rawData?.type === 'MOVE_SLOT') {
        const { fromTherapist, fromSlot } = rawData;
        if (fromTherapist === targetTId && fromSlot === targetSId) return;

        const sched = getDailySchedule(currentDateStr);
        if (sched[targetTId]?.[targetSId]) {
          showToast('移動先の時間枠にはすでに患者が配置されています', 'warn');
          return;
        }

        const sourceItem = sched[fromTherapist]?.[fromSlot];
        if (!sourceItem) return;

        const units = sourceItem.units || 1;
        const confCheck = validateTimeConflict(sched, targetTId, targetSId, sourceItem.patientId, units, fromSlot);
        if (!confCheck.valid) { showToast(confCheck.message, 'error'); return; }

        moveScheduleSlot(currentDateStr, fromTherapist, fromSlot, targetTId, targetSId);
        showToast('コマを移動しました', 'success');
        renderScheduleView();
        return;
      }

      // B: 新規患者パレットからのドロップ
      const patientId = rawData?.patientId || e.dataTransfer.getData('text/plain');
      if (patientId && !patientId.includes(':')) {
        openSlotModal(targetTId, targetSId, { patientId, units: 1, note: '', billingPlan: '' });
      }
    });
  });

  gridEl.querySelectorAll('.badge-analgesia-count').forEach((b) => {
    b.addEventListener('click', (e) => { e.stopPropagation(); openAnalgesiaModal(b.dataset.analgesiaSlot); });
  });

  gridEl.querySelectorAll('.cell-slot[data-analgesia-drop]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      let pId = e.dataTransfer.getData('text/plain');
      try { const d = JSON.parse(e.dataTransfer.getData('application/json')); if (d?.patientId) pId = d.patientId; } catch (_) {}
      const sId = cell.dataset.analgesiaDrop;
      if (pId && sId && !pId.includes(':')) {
        addAnalgesiaPatient(currentDateStr, sId, pId);
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

  document.querySelectorAll('.btn-unit-select').forEach((b) => {
    b.addEventListener('click', (e) => {
      document.querySelectorAll('.btn-unit-select').forEach((x) => x.style.background = '#fff');
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
    const planSelect = document.getElementById('slotBillingPlanSelect');
    const billingPlan = planSelect ? planSelect.value : '';

    const newTherapistId = document.getElementById('slotModalTherapistSelect')?.value || activeModalSlot.therapistId;
    const newSlotId = document.getElementById('slotModalSlotSelect')?.value || activeModalSlot.slotId;

    if (!patientId) { showToast('患者が選択されていません', 'error'); return; }

    const dailySchedule = getDailySchedule(currentDateStr);
    const origTherapist = activeModalSlot.therapistId;
    const origSlot = activeModalSlot.slotId;
    const isRelocated = origTherapist !== newTherapistId || origSlot !== newSlotId;

    if (isRelocated && dailySchedule[newTherapistId]?.[newSlotId]) {
      showToast('変更先の時間枠にはすでに患者が配置されています', 'warn');
      return;
    }

    const currentUnits = activeModalSlot.currentItem ? activeModalSlot.currentItem.units : 0;
    const patient = getPatientById(patientId);

    const conflictCheck = validateTimeConflict(dailySchedule, newTherapistId, newSlotId, patientId, units, origSlot);
    if (!conflictCheck.valid) { showToast(conflictCheck.message, 'error'); return; }

    if (patient) {
      const dailyLimitCheck = validateDailyLimit(dailySchedule, patient, currentDateStr, units, currentUnits);
      if (!dailyLimitCheck.valid) { showToast(dailyLimitCheck.message, 'error'); return; }
    }

    if (billingPlan) {
      const [year, month] = currentDateStr.split('-').map(Number);
      const excludeSlot = activeModalSlot.currentItem ? origSlot : '';
      const existingDate = findPatientMonthlyPlanDate(patientId, year, month, currentDateStr, excludeSlot);
      const planCheck = validateMonthlyPlanLimit(billingPlan, existingDate);
      if (!planCheck.valid) { showToast(planCheck.message, 'error'); return; }
    }

    const workloadCheck = validateTherapistWorkload(dailySchedule, newTherapistId, units, isRelocated ? 0 : currentUnits);
    if (!workloadCheck.valid) { showToast(workloadCheck.message, 'error'); return; }
    if (workloadCheck.message) showToast(workloadCheck.message, 'warn');

    if (isRelocated && activeModalSlot.currentItem) {
      clearScheduleSlot(currentDateStr, origTherapist, origSlot);
    }

    setScheduleSlot(currentDateStr, newTherapistId, newSlotId, { patientId, units, note, billingPlan });

    // 計画書算定実績確定に伴い、患者台帳の計画書ステータスを自動更新・昇格
    if (billingPlan) {
      updatePatientPlanStatus(patientId, billingPlan);
    }

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
  const planSelect = document.getElementById('slotBillingPlanSelect');
  const therapistSelect = document.getElementById('slotModalTherapistSelect');
  const slotSelect = document.getElementById('slotModalSlotSelect');

  const therapists = getAllTherapists();
  const currentTherapist = therapists.find((t) => t.id === therapistId);
  const tDisplayName = currentTherapist ? currentTherapist.name : `PT ${therapistId}`;

  titleEl.textContent = `コマ配置 (${tDisplayName} / ${TIME_SLOTS.find((s) => s.id === slotId)?.label || slotId})`;
  btnDelete.style.display = currentItem ? 'block' : 'none';

  if (therapistSelect) {
    therapistSelect.innerHTML = therapists.map((t) => `<option value="${t.id}">${sanitizeHtml(t.name)}</option>`).join('');
    therapistSelect.value = therapistId;
  }
  if (slotSelect) {
    slotSelect.innerHTML = TIME_SLOTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
    slotSelect.value = slotId;
  }

  const pId = currentItem?.patientId || '';
  const patient = pId ? getPatientById(pId) : null;

  document.getElementById('slotPatientId').value = pId;
  document.getElementById('slotTherapistId').value = therapistId;
  document.getElementById('slotId').value = slotId;
  patientInfoEl.textContent = patient ? `患者: ${patient.name} (${patient.id}) / ${patient.diseaseName || ''}` : '患者が未選択です';

  const units = currentItem?.units || 1;
  document.getElementById('slotUnitsInput').value = units;
  document.querySelectorAll('.btn-unit-select').forEach((b) => {
    b.style.background = b.dataset.unit == units ? '#e0f2fe' : '#fff';
  });

  if (!planSelect) return;
  if (!pId) {
    planSelect.value = '';
    planSelect.disabled = true;
  } else {
    const [year, month] = currentDateStr.split('-').map(Number);
    const excludeSlot = currentItem ? slotId : '';
    const existingDate = findPatientMonthlyPlanDate(pId, year, month, currentDateStr, excludeSlot);

    if (existingDate) {
      planSelect.value = '';
      planSelect.disabled = true;
      patientInfoEl.innerHTML += `<div style="color:#e11d48; font-size:0.75rem; margin-top:4px; font-weight:700;">⚠️️ 総合計画評価料は当月 ${existingDate} に算定済みのため選択できません</div>`;
    } else {
      planSelect.disabled = false;
      const rawPlan = currentItem?.billingPlan;
      if (rawPlan) {
        // すでに保存済みの指定がある場合はそれを維持
        planSelect.value = rawPlan === true ? 'PLAN_1_FIRST' : String(rawPlan);
      } else {
        // 未設定時は過去実績と患者台帳属性から自動推奨区分を判定・初期セット
        const hasPastPlan = hasPatientPastPlan(pId, currentDateStr);
        const recommendation = evaluateRecommendedPlan(patient, currentDateStr, hasPastPlan);
        if (recommendation.recommendedPlan) {
          planSelect.value = recommendation.recommendedPlan;
          patientInfoEl.innerHTML += `<div style="color:#0284c7; font-size:0.75rem; margin-top:4px; font-weight:600; background:#f0f9ff; padding:4px 6px; border-radius:4px; border:1px solid #bae6fd;">💡 推奨自動選択: ${recommendation.label} (${recommendation.reason})</div>`;
        } else {
          planSelect.value = '';
        }
      }
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
  if (titleEl) titleEl.textContent = `消炎鎮痛来院一覧 [${slotObj?.label || slotId}]`;

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
    const catBadge = p.category === 'INPATIENT'
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
      removeAnalgesiaPatient(currentDateStr, activeAnalgesiaSlotId, btn.dataset.patientId);
      showToast('消炎鎮痛から患者を解除しました', 'warn');
      renderAnalgesiaModalList();
      renderScheduleView();
    });
  });
}

function setupStaffSettingsModalListeners() {
  const btnOpen = document.getElementById('btnOpenStaffSettings');
  const modal = document.getElementById('modalStaffSettings');
  const btnClose = document.getElementById('btnCloseStaffModal');
  const btnCloseX = document.getElementById('btnCloseStaffModalX');
  const btnReset = document.getElementById('btnResetStaffDefault');
  const form = document.getElementById('staffSettingsForm');
  const listContainer = document.getElementById('staffSettingsListContainer');

  btnOpen?.addEventListener('click', () => {
    renderStaffSettingsFields();
    modal?.classList.add('active');
  });

  const closeModal = () => modal?.classList.remove('active');
  btnClose?.addEventListener('click', closeModal);
  btnCloseX?.addEventListener('click', closeModal);

  btnReset?.addEventListener('click', () => {
    const defaultList = [
      { id: 'A', name: 'PT A', color: '#0284c7' },
      { id: 'B', name: 'PT B', color: '#0d9488' },
      { id: 'C', name: 'PT C', color: '#7c3aed' }
    ];
    saveAllTherapists(defaultList);
    renderStaffSettingsFields();
    showToast('セラピスト名を初期デフォルトに戻しました', 'info');
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameMap = {};
    listContainer?.querySelectorAll('.staff-name-input').forEach((input) => {
      const tId = input.dataset.therapistId;
      if (tId) nameMap[tId] = input.value.trim();
    });

    updateTherapistNames(nameMap);
    closeModal();
    showToast('セラピスト表示名を保存・更新しました', 'success');
    renderScheduleView();
  });
}

function renderStaffSettingsFields() {
  const container = document.getElementById('staffSettingsListContainer');
  if (!container) return;

  const therapists = getAllTherapists();
  container.innerHTML = therapists.map((t) => {
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; background:#fff; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="width:10px; height:10px; border-radius:50%; background:${t.color || '#0284c7'}; display:inline-block;"></span>
          <strong style="font-size:0.85rem; color:#0f172a; min-width:40px;">枠 ${t.id}</strong>
        </div>
        <div style="flex:1;">
          <input type="text" class="staff-name-input" data-therapist-id="${t.id}" value="${sanitizeHtml(t.name)}"
                 placeholder="セラピスト氏名を入力"
                 style="width:100%; padding:6px 10px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.85rem; font-weight:600;">
        </div>
      </div>
    `;
  }).join('');
}
