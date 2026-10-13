// js/views/appointmentCalendarView.js
// 外来予約カレンダーの初期化・週/月の切り替え

import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { formatDateYMD } from '../core/dateUtils.js';
import { openAppointmentModal } from './modals/appointmentModal.js';
import { showToast } from '../ui/toast.js';
import { printWeeklyAppointmentTable } from '../print/weeklyTablePrint.js';
import { printDailyAppointmentChecklist } from '../print/dailyChecklistPrint.js';
import { calendarState } from './appointment/calendarState.js';
import { setupAptPaletteEvents, renderAptPalette } from './appointment/palette.js';
import { renderWeeklyTimetable } from './appointment/weeklyTimetable.js';
import { renderMonthlyCalendar } from './appointment/monthlyCalendar.js';

/**
 * 外来予約カレンダー画面の初期化
 */
export function initAppointmentCalendarView() {
  const dateInput = document.getElementById('aptCalendarWeekDateInput');
  const btnPrev = document.getElementById('btnAptCalPrevWeek');
  const btnNext = document.getElementById('btnAptCalNextWeek');
  const btnToday = document.getElementById('btnAptCalThisWeek');
  const btnNew = document.getElementById('btnAptCalNew');
  const btnModeWeek = document.getElementById('btnAptViewModeWeek');
  const btnModeMonth = document.getElementById('btnAptViewModeMonth');
  const btnPrintWeekly = document.getElementById('btnAptPrintWeekly');
  const btnPrintDaily = document.getElementById('btnAptPrintDaily');

  syncDateInput();

  dateInput?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [y, m, d] = e.target.value.split('-').map(Number);
    if (y && m && d) {
      calendarState.baseDate = new Date(y, m - 1, d);
      renderAppointmentCalendarView();
    }
  });

  btnPrev?.addEventListener('click', () => {
    if (calendarState.viewMode === 'WEEK') {
      calendarState.baseDate.setDate(calendarState.baseDate.getDate() - 7);
    } else {
      calendarState.baseDate.setMonth(calendarState.baseDate.getMonth() - 1);
    }
    syncDateInput();
    renderAppointmentCalendarView();
  });

  btnNext?.addEventListener('click', () => {
    if (calendarState.viewMode === 'WEEK') {
      calendarState.baseDate.setDate(calendarState.baseDate.getDate() + 7);
    } else {
      calendarState.baseDate.setMonth(calendarState.baseDate.getMonth() + 1);
    }
    syncDateInput();
    renderAppointmentCalendarView();
  });

  btnToday?.addEventListener('click', () => {
    calendarState.baseDate = new Date();
    syncDateInput();
    renderAppointmentCalendarView();
  });

  btnNew?.addEventListener('click', () => {
    const defaultDateStr = formatDateYMD(calendarState.baseDate);
    const holidayName = getJapaneseHolidayName(calendarState.baseDate);
    if (holidayName) {
      showToast(`⚠️ 選択中の日付は祝日（${holidayName}）です`, 'warn');
    }
    openAppointmentModal(null, defaultDateStr, '09:00');
  });

  // モード切替
  btnModeWeek?.addEventListener('click', () => switchViewMode('WEEK'));
  btnModeMonth?.addEventListener('click', () => switchViewMode('MONTH'));

  // ★印刷ボタン 1: 週間タイムテーブル (A4横1枚完結・原本Excel完全同一レイアウト)
  btnPrintWeekly?.addEventListener('click', () => {
    printWeeklyAppointmentTable(calendarState.baseDate);
  });

  // ★印刷ボタン 2: 本日デイリー予約チェックリスト (A4縦1枚・30名以上対応)
  btnPrintDaily?.addEventListener('click', () => {
    printDailyAppointmentChecklist(calendarState.baseDate);
  });

  // 患者パレットの検索・ソート・区分切替イベント
  setupAptPaletteEvents();

  // 初回描画
  renderAppointmentCalendarView();
}

export function syncDateInput() {
  const dateInput = document.getElementById('aptCalendarWeekDateInput');
  if (dateInput) {
    dateInput.value = formatDateYMD(calendarState.baseDate);
  }
}

export function switchViewMode(mode) {
  calendarState.viewMode = mode;
  const btnWeek = document.getElementById('btnAptViewModeWeek');
  const btnMonth = document.getElementById('btnAptViewModeMonth');
  const weekContainer = document.getElementById('aptWeeklyViewContainer');
  const monthContainer = document.getElementById('aptMonthlyViewContainer');

  if (mode === 'WEEK') {
    btnWeek?.classList.add('active');
    if (btnWeek) { btnWeek.style.background = '#0284c7'; btnWeek.style.color = '#fff'; }
    btnMonth?.classList.remove('active');
    if (btnMonth) { btnMonth.style.background = '#fff'; btnMonth.style.color = '#475569'; }
    if (weekContainer) weekContainer.style.display = 'grid';
    if (monthContainer) monthContainer.style.display = 'none';
  } else {
    btnMonth?.classList.add('active');
    if (btnMonth) { btnMonth.style.background = '#0284c7'; btnMonth.style.color = '#fff'; }
    btnWeek?.classList.remove('active');
    if (btnWeek) { btnWeek.style.background = '#fff'; btnWeek.style.color = '#475569'; }
    if (weekContainer) weekContainer.style.display = 'none';
    if (monthContainer) monthContainer.style.display = 'block';
  }

  renderAppointmentCalendarView();
}

/**
 * 画面全体の再描画
 */
export function renderAppointmentCalendarView() {
  renderAptPalette();

  if (calendarState.viewMode === 'WEEK') {
    renderWeeklyTimetable();
  } else {
    renderMonthlyCalendar();
  }
}
