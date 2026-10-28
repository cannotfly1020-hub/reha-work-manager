// js/views/schedule/timetable.js
// 当日時間割グリッドとドラッグ＆ドロップ
// ★パレットからのドロップ即配置・月13単位スマートブレーキ・カード内クイック単位ボタン

import { TIME_SLOTS, REHA_RULES, AM_SLOT_COUNT, TOTAL_SLOT_COUNT } from '../../config/rules.js';
import { sanitizeHtml, safeParseInt } from '../../core/dataNormalizer.js';
import { getActiveTherapists } from '../../store/therapistStore.js';
import { getPatientById } from '../../store/patientStore.js';
import {
  getDailySchedule, moveScheduleSlot, setScheduleSlot, addAnalgesiaPatient, getAnalgesiaSlotPatients,
  isNonPatientBlock, getSlotSpan, slotRangeOverlaps, getPatientMonthDailyRehaUnitsMap
} from '../../store/scheduleStore.js';
import {
  calculatePatientDeadlines,
  getSuggestedPlacementUnits,
  isMonth13LimitActiveOnDate
} from '../../core/deadlineCalc.js';
import {
  validateTimeConflict, validateDailyLimit, validateTherapistWorkload, validateMonthly13Limit
} from '../../core/validator.js';
import {
  getTherapistWeeklyUnits,
  getTherapistWeeklyUnitsMeter,
  buildWeeklyUnitsMeterHtml
} from '../../core/therapistWeeklyUnits.js';
import { showToast } from '../../ui/toast.js';
import { openSlotModal } from '../modals/slotModal.js';
import { openAnalgesiaModal } from '../modals/analgesiaModal.js';
import { scheduleState } from './scheduleState.js';
import { renderScheduleView } from '../scheduleView.js';

function buildTaskCardHtml(cellData, tId, slotId) {
  const u = Math.min(24, Math.max(1, safeParseInt(cellData.slotsCount || cellData.units, 1)));
  const calculatedHeight = (52 * u) - 5;
  const title = cellData.title || '';
  let cardClass = 'card-task';
  let badgeClass = 'badge-task';
  let badgeText = '業務';
  if (cellData.itemType === 'SPECIAL_LEAVE' || title.includes('特別休暇')) {
    cardClass = 'card-special-leave';
    badgeClass = 'badge-special-leave';
    badgeText = '特別休暇';
  } else if (cellData.itemType === 'LEAVE' || title.includes('有休') || title.includes('有給')) {
    cardClass = 'card-leave';
    badgeClass = 'badge-leave';
    badgeText = '有休';
  } else if (cellData.itemType === 'HOLIDAY' || title.includes('公休')) {
    cardClass = 'card-holiday';
    badgeClass = 'badge-holiday';
    badgeText = '公休';
  }
  const halfSlots = AM_SLOT_COUNT || 12;
  const fullSlots = TOTAL_SLOT_COUNT || 27;
  const durationLabel = u >= fullSlots ? '終日' : (u >= halfSlots ? '半日' : `${u * 20}分`);
  return `
    <div class="cell-slot">
      <div class="reha-slot-card ${cardClass} card-unit-${u}" draggable="true" data-therapist="${tId}" data-slot="${slotId}"
           style="height:${calculatedHeight}px !important; max-height:${calculatedHeight}px !important; box-sizing:border-box; overflow:hidden; cursor:grab;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <span class="${badgeClass}">${badgeText}</span>
            <span style="font-weight:800; font-size:0.8rem; margin-left:4px;">${sanitizeHtml(title || badgeText)}</span>
          </div>
          <span style="font-size:0.68rem; font-weight:700;">${durationLabel}</span>
        </div>
        <div style="font-size:0.68rem; opacity:0.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
          ${sanitizeHtml(cellData.note || '')}
        </div>
      </div>
    </div>`;
}

function buildQuickUnitButtonsHtml(currentUnits) {
  const u = Math.min(4, Math.max(1, safeParseInt(currentUnits, 1)));
  return `
    <div class="slot-quick-units" title="単位をクイック変更">
      <button type="button" class="btn-quick-unit${u === 1 ? ' is-active' : ''}" data-quick-unit="1">1</button>
      <button type="button" class="btn-quick-unit${u === 2 ? ' is-active' : ''}" data-quick-unit="2">2</button>
      <button type="button" class="btn-quick-unit${u === 3 ? ' is-active' : ''}" data-quick-unit="3">3</button>
    </div>`;
}

export function buildSlotCardHtml(p, u, cellData, tId, slotId) {
  const isOut = p.category === 'OUTPATIENT';
  const cardClass = isOut ? 'card-outpatient' : 'card-inpatient';
  const disRule = REHA_RULES.LIMIT_DAYS[p.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
  const diseaseTag = `<span style="font-size:0.65rem; font-weight:700; background:${disRule.tagBg}; color:${disRule.tagColor}; border:1px solid ${disRule.tagBorder}; padding:1px 3px; border-radius:3px;">${disRule.shortLabel}</span>`;

  let planBadge = '';
  if (cellData.billingPlan) {
    const lbl = String(cellData.billingPlan).includes('PLAN_2') ? '📝計2' : '📝計画書';
    planBadge = `<span class="badge-plan" style="margin-left:2px;">${lbl}</span>`;
  }

  let earlyBadge = '';
  if (!isOut) {
    const dl = calculatePatientDeadlines(p, scheduleState.dateStr);
    if (dl.earlyBonus?.isEligible && dl.earlyBonus.shortLabel) {
      const isUrgent = dl.earlyBonus.remainingDays !== null && dl.earlyBonus.remainingDays <= 3;
      const bBg = isUrgent ? '#fef3c7' : '#ecfdf5';
      const bCol = isUrgent ? '#b45309' : '#047857';
      const bBorder = isUrgent ? '#f59e0b' : '#10b981';
      earlyBadge = `<span style="font-size:0.63rem; font-weight:700; background:${bBg}; color:${bCol}; border:1px solid ${bBorder}; padding:1px 4px; border-radius:3px; margin-left:3px;" title="${dl.earlyBonus.shortLabel}">${dl.earlyBonus.shortLabel}</span>`;
    }
  }

  // ★【セル枠完全密着の精密計算】
  // 1セル高さ52pxに対して、u単位（uコマ）分の高さを算出し、下枠線と重ならないよう -5px を適用
  // 1単位: 47px / 2単位: 99px / 3単位: 151px / 4単位: 203px
  const calculatedHeight = (52 * u) - 5;

  return `
    <div class="cell-slot">
      <div class="reha-slot-card ${cardClass} card-unit-${u}" draggable="true" data-therapist="${tId}" data-slot="${slotId}"
           style="height:${calculatedHeight}px !important; max-height:${calculatedHeight}px !important; box-sizing:border-box; overflow:hidden; cursor:grab;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
          <div style="display:flex; align-items:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1;">
            ${diseaseTag}<span style="font-weight:700; font-size:0.8rem; margin-left:3px;">${sanitizeHtml(p.name)}</span>
          </div>
          <div style="display:flex; align-items:center; flex-shrink:0;">
            <span class="badge-unit badge-unit-${u}">${u}単位</span>${planBadge}${earlyBadge}
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:4px; margin-top:2px;">
          <div style="font-size:0.68rem; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1;">
            ${sanitizeHtml(cellData.note || p.diseaseName || '')}
          </div>
          ${buildQuickUnitButtonsHtml(u)}
        </div>
      </div>
    </div>`;
}

export function renderTimetableGrid() {
  const gridEl = document.getElementById('timetableGrid');
  if (!gridEl) return;

  const therapists = getActiveTherapists();
  const schedule = getDailySchedule(scheduleState.dateStr);
  const therapistCount = therapists.length;

  gridEl.style.display = 'grid';
  gridEl.style.gridTemplateColumns = `88px repeat(${therapistCount}, minmax(130px, 1fr)) 100px`;
  gridEl.style.overflowX = 'auto';

  let html = '<div class="timetable-header">時間帯</div>';
  therapists.forEach((t) => {
    const meter = getTherapistWeeklyUnitsMeter(t.id, scheduleState.dateStr);
    html += `
      <div class="timetable-header therapist-col-header" data-therapist-header="${sanitizeHtml(t.id)}">
        <div class="therapist-col-name">${sanitizeHtml(t.name)}</div>
        ${buildWeeklyUnitsMeterHtml(meter)}
      </div>`;
  });
  html += '<div class="timetable-header" style="background:#f0fdf4; color:#166534;">消炎鎮痛</div>';

  const coveredUntil = {};
  therapists.forEach((t) => {
    coveredUntil[t.id] = 0;
  });

  TIME_SLOTS.forEach((slot, index) => {
    const rowGridStyle = `display:contents;`;
    html += `<div class="time-slot-row" style="${rowGridStyle}"><div class="time-col">${slot.label}</div>`;

    therapists.forEach((t) => {
      const tId = t.id;
      const cellData = schedule[tId]?.[slot.id];

      if (coveredUntil[tId] > index) {
        html += `<div class="cell-slot slot-covered-placeholder"></div>`;
        return;
      }

      if (cellData && isNonPatientBlock(cellData)) {
        const u = getSlotSpan(cellData);
        coveredUntil[tId] = index + u;
        html += buildTaskCardHtml(cellData, tId, slot.id);
      } else if (cellData && cellData.patientId) {
        const p = getPatientById(cellData.patientId) || { name: '未登録', category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE' };
        const u = Math.min(4, Math.max(1, safeParseInt(cellData.units, 1)));
        coveredUntil[tId] = index + u;
        html += buildSlotCardHtml(p, u, cellData, tId, slot.id);
      } else {
        html += `<div class="cell-slot" data-therapist="${tId}" data-slot="${slot.id}"><button class="empty-slot-btn" data-therapist="${tId}" data-slot="${slot.id}">＋ 追加</button></div>`;
      }
    });

    const aPatients = getAnalgesiaSlotPatients(scheduleState.dateStr, slot.id);
    const aCount = aPatients.length;
    let bHtml = `<button class="badge-analgesia-count" data-analgesia-slot="${slot.id}" style="color:#94a3b8; font-size:0.75rem;">＋</button>`;
    if (aCount > 0) {
      const inC = aPatients.filter((p) => p.category === 'INPATIENT').length;
      bHtml = `<button class="badge-analgesia-count has-patients" data-analgesia-slot="${slot.id}"><span style="font-weight:800; font-size:0.85rem; color:#15803d;">${aCount}名</span><span style="font-size:0.65rem; color:#64748b; margin-left:4px;">入${inC}/外${aCount - inC}</span></button>`;
    }
    html += `<div class="cell-slot analgesia-slot-cell" data-analgesia-drop="${slot.id}">${bHtml}</div></div>`;
  });

  gridEl.innerHTML = html;
  attachGridEventListeners(gridEl);
}

/**
 * パレットからの新規患者をモーダルなしで即配置する
 * @returns {boolean} 配置成功
 */
function placePatientInstant(targetTId, targetSId, patientId) {
  const patient = getPatientById(patientId);
  if (!patient) {
    showToast('患者マスタに登録がないため配置できません', 'error');
    return false;
  }

  const dateStr = scheduleState.dateStr;
  const [year, month] = dateStr.split('-').map(Number);
  const dailyMap = getPatientMonthDailyRehaUnitsMap(patientId, year, month);
  const suggestion = getSuggestedPlacementUnits(patient, dateStr, dailyMap);

  if (suggestion.blocked || suggestion.units < 1) {
    showToast(suggestion.message || '月13単位制限のため配置できません', 'error');
    return false;
  }

  const units = suggestion.units;
  const dailySchedule = getDailySchedule(dateStr);

  const overlap = slotRangeOverlaps(dailySchedule, targetTId, targetSId, units);
  if (overlap.blocked) {
    showToast(overlap.message, 'warn');
    return false;
  }

  const conflictCheck = validateTimeConflict(dailySchedule, targetTId, targetSId, patientId, units, null, null);
  if (!conflictCheck.valid) {
    showToast(conflictCheck.message, 'error');
    return false;
  }

  const dailyLimitCheck = validateDailyLimit(dailySchedule, patient, dateStr, units, 0);
  if (!dailyLimitCheck.valid) {
    showToast(dailyLimitCheck.message, 'error');
    return false;
  }

  if (isMonth13LimitActiveOnDate(patient, dateStr)) {
    const monthCheck = validateMonthly13Limit(
      suggestion.applicableUnits,
      patient,
      true,
      units,
      0
    );
    if (!monthCheck.valid) {
      showToast(monthCheck.message, 'error');
      return false;
    }
  }

  const weeklyBefore = getTherapistWeeklyUnits(targetTId, dateStr);
  const workloadCheck = validateTherapistWorkload(dailySchedule, targetTId, units, 0, weeklyBefore);
  if (!workloadCheck.valid) {
    showToast(workloadCheck.message, 'error');
    return false;
  }
  if (workloadCheck.message) showToast(workloadCheck.message, 'warn');

  const saved = setScheduleSlot(dateStr, targetTId, targetSId, {
    itemType: 'PATIENT',
    patientId,
    units,
    note: '',
    billingPlan: ''
  });
  if (!saved) return false;

  if (suggestion.capped && suggestion.message) {
    showToast(suggestion.message, 'info');
  } else {
    showToast(`${patient.name} を ${units}単位で配置しました`, 'success');
  }

  if (typeof window.triggerDailyBackup === 'function') {
    window.triggerDailyBackup();
  }
  return true;
}

/**
 * カード右端クイック単位ボタンによる単位変更
 * @returns {boolean}
 */
function changeSlotUnitsQuick(therapistId, slotId, newUnitsRaw) {
  const newUnits = Math.min(3, Math.max(1, safeParseInt(newUnitsRaw, 1)));
  const dateStr = scheduleState.dateStr;
  const dailySchedule = getDailySchedule(dateStr);
  const currentItem = dailySchedule[therapistId]?.[slotId];
  if (!currentItem?.patientId || isNonPatientBlock(currentItem)) return false;

  const currentUnits = Math.min(4, Math.max(1, safeParseInt(currentItem.units, 1)));
  if (newUnits === currentUnits) return true;

  const patient = getPatientById(currentItem.patientId);
  if (!patient) {
    showToast('患者情報が見つかりません', 'error');
    return false;
  }

  const overlap = slotRangeOverlaps(dailySchedule, therapistId, slotId, newUnits, slotId);
  if (overlap.blocked) {
    showToast(overlap.message, 'warn');
    return false;
  }

  const conflictCheck = validateTimeConflict(
    dailySchedule, therapistId, slotId, currentItem.patientId, newUnits, slotId, therapistId
  );
  if (!conflictCheck.valid) {
    showToast(conflictCheck.message, 'error');
    return false;
  }

  const dailyLimitCheck = validateDailyLimit(dailySchedule, patient, dateStr, newUnits, currentUnits);
  if (!dailyLimitCheck.valid) {
    showToast(dailyLimitCheck.message, 'error');
    return false;
  }

  if (isMonth13LimitActiveOnDate(patient, dateStr)) {
    const [year, month] = dateStr.split('-').map(Number);
    const dailyMap = getPatientMonthDailyRehaUnitsMap(currentItem.patientId, year, month);
    const suggestion = getSuggestedPlacementUnits(patient, dateStr, dailyMap);
    const monthCheck = validateMonthly13Limit(
      suggestion.applicableUnits,
      patient,
      true,
      newUnits,
      currentUnits
    );
    if (!monthCheck.valid) {
      showToast(monthCheck.message, 'error');
      return false;
    }
  }

  const weeklyBefore = getTherapistWeeklyUnits(therapistId, dateStr);
  const workloadCheck = validateTherapistWorkload(dailySchedule, therapistId, newUnits, currentUnits, weeklyBefore);
  if (!workloadCheck.valid) {
    showToast(workloadCheck.message, 'error');
    return false;
  }
  if (workloadCheck.message) showToast(workloadCheck.message, 'warn');

  const saved = setScheduleSlot(dateStr, therapistId, slotId, {
    itemType: 'PATIENT',
    patientId: currentItem.patientId,
    units: newUnits,
    note: currentItem.note || '',
    billingPlan: currentItem.billingPlan || ''
  });
  if (!saved) return false;

  showToast(`${newUnits}単位に変更しました`, 'success');
  if (typeof window.triggerDailyBackup === 'function') {
    window.triggerDailyBackup();
  }
  return true;
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
      if (e.target.closest('.btn-quick-unit') || e.target.closest('.slot-quick-units')) {
        return;
      }
      e.stopPropagation();
      const tId = card.dataset.therapist;
      const sId = card.dataset.slot;
      openSlotModal(tId, sId, getDailySchedule(scheduleState.dateStr)[tId]?.[sId]);
    });
    card.addEventListener('dragstart', (e) => {
      if (e.target.closest('.btn-quick-unit')) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      const moveData = { type: 'MOVE_SLOT', fromTherapist: card.dataset.therapist, fromSlot: card.dataset.slot };
      e.dataTransfer.setData('application/json', JSON.stringify(moveData));
      e.dataTransfer.setData('text/plain', card.dataset.therapist + ':' + card.dataset.slot);
    });
  });

  gridEl.querySelectorAll('.btn-quick-unit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = btn.closest('.reha-slot-card');
      if (!card) return;
      const tId = card.dataset.therapist;
      const sId = card.dataset.slot;
      const unit = btn.dataset.quickUnit;
      if (changeSlotUnitsQuick(tId, sId, unit)) {
        renderScheduleView();
      }
    });
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
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
      try {
        rawData = JSON.parse(e.dataTransfer.getData('application/json'));
      } catch (_) {}

      if (rawData?.type === 'MOVE_SLOT') {
        const { fromTherapist, fromSlot } = rawData;
        if (fromTherapist === targetTId && fromSlot === targetSId) return;

        const sched = getDailySchedule(scheduleState.dateStr);
        const sourceItem = sched[fromTherapist]?.[fromSlot];
        if (!sourceItem) return;

        const units = getSlotSpan(sourceItem) || sourceItem.units || 1;
        const excludeSlotId = fromTherapist === targetTId ? fromSlot : null;
        const overlap = slotRangeOverlaps(sched, targetTId, targetSId, units, excludeSlotId);
        if (overlap.blocked) {
          showToast(overlap.message, 'warn');
          return;
        }

        if (!isNonPatientBlock(sourceItem)) {
          const confCheck = validateTimeConflict(
            sched, targetTId, targetSId, sourceItem.patientId, units, fromSlot, fromTherapist
          );
          if (!confCheck.valid) {
            showToast(confCheck.message, 'error');
            return;
          }
        }

        const moved = moveScheduleSlot(scheduleState.dateStr, fromTherapist, fromSlot, targetTId, targetSId);
        if (!moved) {
          renderScheduleView();
          return;
        }
        showToast('コマを移動しました', 'success');

        if (typeof window.triggerDailyBackup === 'function') {
          window.triggerDailyBackup();
        }

        renderScheduleView();
        return;
      }

      // ★パレットからの NEW_PATIENT → モーダルなし即配置
      const patientId = (rawData?.type === 'NEW_PATIENT' && rawData.patientId)
        ? rawData.patientId
        : (rawData?.patientId || e.dataTransfer.getData('text/plain'));
      if (patientId && !String(patientId).includes(':')) {
        if (placePatientInstant(targetTId, targetSId, patientId)) {
          renderScheduleView();
        }
      }
    });
  });

  gridEl.querySelectorAll('.badge-analgesia-count').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openAnalgesiaModal(b.dataset.analgesiaSlot);
    });
  });

  gridEl.querySelectorAll('.cell-slot[data-analgesia-drop]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      let pId = e.dataTransfer.getData('text/plain');
      try {
        const d = JSON.parse(e.dataTransfer.getData('application/json'));
        if (d?.patientId) pId = d.patientId;
      } catch (_) {}
      const sId = cell.dataset.analgesiaDrop;
      if (pId && sId && !pId.includes(':')) {
        const added = addAnalgesiaPatient(scheduleState.dateStr, sId, pId);
        if (!added) {
          renderScheduleView();
          return;
        }
        showToast('消炎鎮痛に患者を追加しました', 'success');

        if (typeof window.triggerDailyBackup === 'function') {
          window.triggerDailyBackup();
        }

        renderScheduleView();
      }
    });
  });
}
