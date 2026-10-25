// js/views/appointmentCalendarView.js
// 外来予約カレンダーの初期化・週/月の切り替え
// ★手書き受付用 A4横印刷ボタンは DOM 動的追加（index.html 非改変）・画面グリッド描画には非干渉

import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { formatDateYMD } from '../core/dateUtils.js';
import { openAppointmentModal } from './modals/appointmentModal.js';
import { showToast } from '../ui/toast.js';
import { printWeeklyAppointmentTable } from '../print/weeklyTablePrint.js';
import { printDailyAppointmentChecklist } from '../print/dailyChecklistPrint.js';
import { printHandwritingWeeklySheet } from '../print/handwritingWeeklyPrint.js';
import { calendarState } from './appointment/calendarState.js';
import { setupAptPaletteEvents, renderAptPalette } from './appointment/palette.js';
import { renderWeeklyTimetable } from './appointment/weeklyTimetable.js';
import { renderMonthlyCalendar } from './appointment/monthlyCalendar.js';

/**
 * 手書き受付専用印刷（予約受付簿モード）
 * 画面の週間マス目描画には一切触れず、印刷ポップアップのみ生成する。
 */
export function handlePrintHandwritingWeeklySheet() {
  printHandwritingWeeklySheet(calendarState.baseDate);
}

/**
 * 「📝 手書き受付用印刷 (A4横)」ボタンを既存「週間表」ボタンの隣へ動的配置
 */
function ensureHandwritingPrintButton() {
  if (document.getElementById('btnAptPrintHandwritingWeekly')) return;

  const weeklyBtn = document.getElementById('btnAptPrintWeekly');
  if (!weeklyBtn || !weeklyBtn.parentElement) return;

  const btn = document.createElement('button');
  btn.id = 'btnAptPrintHandwritingWeekly';
  btn.type = 'button';
  btn.title = '次週案内・対面受付用。全時間枠を残したA4横の手書き受付簿を印刷します（画面表示は変わりません）';
  btn.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:4px',
    'padding:6px 12px',
    'background:#059669',
    'color:#fff',
    'border:1px solid #047857',
    'border-radius:6px',
    'font-size:0.82rem',
    'font-weight:700',
    'cursor:pointer',
    'white-space:nowrap'
  ].join(';');
  btn.innerHTML = '<span>📝</span><span>手書き受付用印刷 (A4横)</span>';

  btn.addEventListener('click', () => {
    handlePrintHandwritingWeeklySheet();
  });

  // 既存「週間表 (A4横)」の直後へ挿入
  if (weeklyBtn.nextSibling) {
    weeklyBtn.parentElement.insertBefore(btn, weeklyBtn.nextSibling);
  } else {
    weeklyBtn.parentElement.appendChild(btn);
  }
}

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
  ensureHandwritingPrintButton();

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

  // ★印刷ボタン 1: 週間タイムテーブル (A4横・空き行圧縮の閲覧用)
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
  ensureHandwritingPrintButton();
  renderAptPalette();

  if (calendarState.viewMode === 'WEEK') {
    renderWeeklyTimetable();
  } else {
    renderMonthlyCalendar();
  }
}
