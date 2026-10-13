// js/views/scheduleView.js
// 当日時間割の初期化と再描画

import { getLocalDateStr } from '../core/dateUtils.js';
import { showToast } from '../ui/toast.js';
import { getAppointmentsForDate, syncAppointmentsToSchedule } from '../store/appointmentSync.js';
import { setupSlotModalListeners } from './modals/slotModal.js';
import { setupStaffSettingsModalListeners } from './modals/staffModal.js';
import { setupAnalgesiaModalListeners } from './modals/analgesiaModal.js';
import { scheduleState } from './schedule/scheduleState.js';
import { setupSchedulePaletteEvents, renderPatientPalette } from './schedule/palette.js';
import { renderDailyKPIStrip } from './schedule/kpiStrip.js';
import { renderTimetableGrid } from './schedule/timetable.js';

/**
 * 本日の外来予約一括反映ボタンの更新・件数バッジ描画
 */
function updateSyncAppointmentsBadge() {
  const badgeEl = document.getElementById('syncAppointmentCountBadge');
  if (!badgeEl) return;
  const appointments = getAppointmentsForDate(scheduleState.dateStr);
  badgeEl.textContent = `${appointments.length}件`;
  if (appointments.length === 0) {
    badgeEl.style.background = '#94a3b8';
  } else {
    badgeEl.style.background = '#3b82f6';
  }
}

/**
 * 外来予約一括反映ボタンのイベントリスナー自己回復バインド
 */
function bindSyncButtonListener() {
  const btnSyncAppointments = document.getElementById('btnSyncAppointmentsToSchedule');
  if (btnSyncAppointments && !btnSyncAppointments.dataset.bound) {
    btnSyncAppointments.dataset.bound = 'true';
    btnSyncAppointments.addEventListener('click', (e) => {
      e.preventDefault();
      syncAppointmentsToSchedule(scheduleState.dateStr, renderScheduleView);
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

  setupSchedulePaletteEvents();

  // 各モーダルのリスナーを初期化（更新時コールバックとして再描画関数を渡す）
  setupSlotModalListeners(renderScheduleView);
  setupStaffSettingsModalListeners(renderScheduleView);
  setupAnalgesiaModalListeners(renderScheduleView);
}

export function renderScheduleView() {
  bindSyncButtonListener();
  renderDailyKPIStrip();
  updateSyncAppointmentsBadge();
  renderPatientPalette();
  renderTimetableGrid();
}
