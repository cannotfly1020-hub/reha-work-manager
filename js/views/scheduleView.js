// js/views/scheduleView.js
// 当日時間割の初期化と再描画、外来予約の自動吸着・一括反映

import { TIME_SLOTS } from '../config/rules.js';
import { snapToNearestScheduleSlotId } from '../core/timeSlotUtil.js';
import { getLocalDateStr } from '../core/dateUtils.js';
import { showToast } from '../ui/toast.js';
import { getAppointmentsByDate } from '../store/appointmentStore.js';
import { getActiveTherapists } from '../store/therapistStore.js';
import { getPatientById } from '../store/patientStore.js';
import {
  getDailySchedule,
  setScheduleSlot,
  addAnalgesiaPatient,
  getAnalgesiaSlotPatients,
  slotRangeOverlaps
} from '../store/scheduleStore.js';
import { setupSlotModalListeners } from './modals/slotModal.js';
import { setupStaffSettingsModalListeners } from './modals/staffModal.js';
import { setupAnalgesiaModalListeners } from './modals/analgesiaModal.js';
import { scheduleState } from './schedule/scheduleState.js';
import { setupSchedulePaletteEvents, renderPatientPalette } from './schedule/palette.js';
import { renderDailyKPIStrip } from './schedule/kpiStrip.js';
import { renderTimetableGrid } from './schedule/timetable.js';

/**
 * 表示中日付の有効予約件数をバッジへ反映し、0件と1件以上でボタンのトーンを切り替える
 */
function updateSyncAppointmentBadge() {
  const badgeEl = document.getElementById('syncAppointmentCountBadge');
  const btn = document.getElementById('btnSyncAppointmentsToSchedule');
  const appointments = getAppointmentsByDate(scheduleState.dateStr);
  const count = appointments.length;

  if (badgeEl) {
    badgeEl.textContent = `${count}件`;
    badgeEl.style.background = count === 0 ? '#94a3b8' : '#3b82f6';
    badgeEl.style.color = '#ffffff';
  }

  if (!btn) return;
  if (count === 0) {
    btn.style.background = '#f8fafc';
    btn.style.borderColor = '#cbd5e1';
    btn.style.color = '#64748b';
  } else {
    btn.style.background = '#eff6ff';
    btn.style.borderColor = '#3b82f6';
    btn.style.color = '#1d4ed8';
  }
}

/**
 * 実時間（HH:MM）を、最も近い20分コマへ吸着する。
 * 差が同じときは後ろのコマを採用する（09:10 は 09:20）。
 * @param {string} startTimeStr
 * @returns {string}
 */
export function findNearestTimeSlot(startTimeStr) {
  return snapToNearestScheduleSlotId(startTimeStr);
}

/**
 * 所要分を20分1単位へ換算する（1〜4単位）
 * 〜25分=1、26〜40分=2、41〜65分=3（45分・60分）、66分以上=4
 * @param {number} durationMinutes
 * @returns {number}
 */
export function durationToUnits(durationMinutes) {
  const minutes = parseInt(durationMinutes, 10);
  const dur = Number.isFinite(minutes) ? minutes : 20;
  if (dur <= 25) return 1;
  if (dur <= 40) return 2;
  if (dur <= 65) return 3;
  return 4;
}

function patientAlreadyOnSchedule(schedule, patientId, therapists) {
  for (const therapist of therapists) {
    const slots = schedule[therapist.id] || {};
    for (const item of Object.values(slots)) {
      if (item?.patientId === patientId) return true;
    }
  }
  return false;
}

/**
 * 本日の外来予約を、空いている20分コマへ吸着して時間割へ流し込む。
 * 既存の患者配置と業務・有休ブロックは上書きしない。
 */
function handleSyncAppointmentsToSchedule() {
  const currentDateStr = scheduleState.dateStr;
  const appointments = getAppointmentsByDate(currentDateStr);

  if (appointments.length === 0) {
    showToast('本日の予約はありません', 'info');
    return;
  }

  const activeTherapists = getActiveTherapists();
  if (activeTherapists.length === 0) {
    showToast('稼働中のセラピストが設定されていません', 'error');
    return;
  }

  const schedule = getDailySchedule(currentDateStr);
  let appliedCount = 0;
  let skippedCount = 0;

  appointments.forEach((apt) => {
    if (!apt?.patientId || !getPatientById(apt.patientId)) {
      skippedCount += 1;
      return;
    }

    const slotId = findNearestTimeSlot(apt.startTime);
    const slotIndex = TIME_SLOTS.findIndex((slot) => slot.id === slotId);
    if (slotIndex < 0) {
      skippedCount += 1;
      return;
    }

    const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';
    if (isAnalgesia) {
      const existing = getAnalgesiaSlotPatients(currentDateStr, slotId);
      const alreadyAdded = existing.some((patient) => patient && patient.id === apt.patientId);
      if (alreadyAdded) {
        skippedCount += 1;
        return;
      }
      const added = addAnalgesiaPatient(currentDateStr, slotId, apt.patientId);
      if (!added) {
        skippedCount += 1;
        return;
      }
      if (!schedule.analgesia) schedule.analgesia = {};
      if (!Array.isArray(schedule.analgesia[slotId])) schedule.analgesia[slotId] = [];
      if (!schedule.analgesia[slotId].includes(apt.patientId)) {
        schedule.analgesia[slotId].push(apt.patientId);
      }
      appliedCount += 1;
      return;
    }

    let targetTherapistId = apt.therapistId;
    const therapistValid = activeTherapists.some((therapist) => therapist.id === targetTherapistId);
    if (!therapistValid) {
      targetTherapistId = activeTherapists[0].id;
    }

    if (patientAlreadyOnSchedule(schedule, apt.patientId, activeTherapists)) {
      skippedCount += 1;
      return;
    }

    const units = durationToUnits(apt.durationMinutes);
    const overlap = slotRangeOverlaps(schedule, targetTherapistId, slotId, units);
    if (overlap.blocked) {
      skippedCount += 1;
      return;
    }

    const timeNote = `[予約 ${apt.startTime}〜] ${apt.notes || ''}`.trim();
    const cellData = {
      itemType: 'PATIENT',
      patientId: apt.patientId,
      units,
      billingPlan: '',
      note: timeNote
    };
    const saved = setScheduleSlot(currentDateStr, targetTherapistId, slotId, cellData);
    if (!saved) {
      skippedCount += 1;
      return;
    }

    if (!schedule[targetTherapistId]) schedule[targetTherapistId] = {};
    for (let offset = 0; offset < units; offset += 1) {
      const idx = slotIndex + offset;
      if (idx >= TIME_SLOTS.length) break;
      const coveredId = TIME_SLOTS[idx].id;
      schedule[targetTherapistId][coveredId] = offset === 0 ? cellData : { ...cellData, units: 1 };
    }
    appliedCount += 1;
  });

  showToast(
    `✅ 外来予約 ${appointments.length}件中 ${appliedCount}件を時間割に反映しました（${skippedCount}件スキップ）`,
    appliedCount > 0 ? 'success' : 'warn'
  );

  if (appliedCount > 0 && typeof window.triggerDailyBackup === 'function') {
    window.triggerDailyBackup();
  }
  renderScheduleView();
}

function bindSyncButtonListener() {
  const btnSyncAppointments = document.getElementById('btnSyncAppointmentsToSchedule');
  if (btnSyncAppointments && !btnSyncAppointments.dataset.bound) {
    btnSyncAppointments.dataset.bound = 'true';
    btnSyncAppointments.addEventListener('click', (e) => {
      e.preventDefault();
      handleSyncAppointmentsToSchedule();
    });
  }
}

export function initScheduleView() {
  const dateInput = document.getElementById('scheduleDateInput');
  const btnToday = document.getElementById('btnTodaySchedule');
  const btnRefresh = document.getElementById('btnRefreshSchedule');

  if (dateInput) {
    dateInput.value = scheduleState.dateStr;
    dateInput.addEventListener('change', (e) => {
      scheduleState.dateStr = e.target.value;
      renderScheduleView();
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      scheduleState.dateStr = getLocalDateStr();
      if (dateInput) dateInput.value = scheduleState.dateStr;
      renderScheduleView();
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      renderScheduleView();
      showToast('時間割を最新状態に更新しました', 'info');
    });
  }

  bindSyncButtonListener();
  updateSyncAppointmentBadge();

  setupSchedulePaletteEvents();

  setupSlotModalListeners(renderScheduleView);
  setupStaffSettingsModalListeners(renderScheduleView);
  setupAnalgesiaModalListeners(renderScheduleView);
}

export function renderScheduleView() {
  bindSyncButtonListener();
  renderDailyKPIStrip();
  updateSyncAppointmentBadge();
  renderPatientPalette();
  renderTimetableGrid();
}
