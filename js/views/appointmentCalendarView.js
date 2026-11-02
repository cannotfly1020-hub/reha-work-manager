// js/views/appointmentCalendarView.js
// 外来予約カレンダーの初期化・週/月の切り替え
// ★印刷: ①受付簿（午前・午後2枚）②紙予約用週間表（A4縦1枚）③デイリー — 画面マス目描画には非干渉

import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { formatDateYMD } from '../core/dateUtils.js';
import { openAppointmentModal } from './modals/appointmentModal.js';
import { showToast } from '../ui/toast.js';
import { printDailyAppointmentChecklist } from '../print/dailyChecklistPrint.js';
import { printHandwritingWeeklySheet } from '../print/handwritingWeeklyPrint.js';
import { printWeeklyPaperBookingSheet } from '../print/weeklyPaperBookingPrint.js';
import { calendarState } from './appointment/calendarState.js';
import { setupAptPaletteEvents, renderAptPalette } from './appointment/palette.js';
import { renderWeeklyTimetable } from './appointment/weeklyTimetable.js';
import { renderMonthlyCalendar } from './appointment/monthlyCalendar.js';

/**
 * 週間予約受付簿（A4縦・午前／午後 2ページ）印刷
 */
export function handlePrintHandwritingWeeklySheet() {
  printHandwritingWeeklySheet(calendarState.baseDate);
}

/**
 * 翌週紙予約用・週間予約表（A4縦1枚完結）印刷
 */
export function handlePrintWeeklyPaperBookingSheet() {
  printWeeklyPaperBookingSheet(calendarState.baseDate);
}

/**
 * 印刷ボタン群を配置する（旧 A4横週間表は非表示）。
 * index.html は改変せず DOM 操作のみでツールバーを整理する。
 */
function ensureReceptionBookPrintToolbar() {
  const weeklyBtn = document.getElementById('btnAptPrintWeekly');
  const dailyBtn = document.getElementById('btnAptPrintDaily');
  const parent = weeklyBtn?.parentElement || dailyBtn?.parentElement;
  if (!parent) return;

  // 旧週間表印刷（空き行圧縮版）は専用2ボタンへ分離したためツールバーから外す
  if (weeklyBtn) {
    weeklyBtn.style.display = 'none';
    weeklyBtn.setAttribute('aria-hidden', 'true');
    weeklyBtn.tabIndex = -1;
  }

  const btnStyleGreen = [
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

  const btnStyleTeal = [
    'display:flex',
    'align-items:center',
    'gap:4px',
    'padding:6px 12px',
    'background:#0f766e',
    'color:#fff',
    'border:1px solid #0d9488',
    'border-radius:6px',
    'font-size:0.82rem',
    'font-weight:700',
    'cursor:pointer',
    'white-space:nowrap'
  ].join(';');

  // ① 週間予約受付簿（午前・午後 2枚）
  let btnBook = document.getElementById('btnAptPrintHandwritingWeekly');
  if (!btnBook) {
    btnBook = document.createElement('button');
    btnBook.id = 'btnAptPrintHandwritingWeekly';
    btnBook.type = 'button';
    btnBook.style.cssText = btnStyleGreen;
    btnBook.addEventListener('click', () => {
      handlePrintHandwritingWeeklySheet();
    });
    if (dailyBtn) parent.insertBefore(btnBook, dailyBtn);
    else if (weeklyBtn) parent.insertBefore(btnBook, weeklyBtn);
    else parent.appendChild(btnBook);
  }
  btnBook.innerHTML = '<span>📝</span><span>週間予約受付簿 (午前・午後)</span>';
  btnBook.title = '対面受付用。A4縦で午前1枚＋午後1枚の予約受付簿を印刷します（画面表示は変わりません）';
  btnBook.style.display = 'flex';

  // ② 翌週紙予約用・週間予約表（A4縦1枚）— 受付簿とは独立
  let btnPaper = document.getElementById('btnAptPrintWeeklyPaperBooking');
  if (!btnPaper) {
    btnPaper = document.createElement('button');
    btnPaper.id = 'btnAptPrintWeeklyPaperBooking';
    btnPaper.type = 'button';
    btnPaper.style.cssText = btnStyleTeal;
    btnPaper.addEventListener('click', () => {
      handlePrintWeeklyPaperBookingSheet();
    });
    // 受付簿の直後・デイリーの直前
    if (dailyBtn) parent.insertBefore(btnPaper, dailyBtn);
    else parent.insertBefore(btnPaper, btnBook.nextSibling);
  }
  btnPaper.innerHTML = '<span>🗓️</span><span>週間予約表 (A4縦1枚・紙予約)</span>';
  btnPaper.title = '翌週以降の紙予約用。日付・曜日・時間・昼休み1行圧縮・手書き枠つきのA4縦1枚を印刷します（受付簿とは別）';
  btnPaper.style.display = 'flex';
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
  const btnPrintDaily = document.getElementById('btnAptPrintDaily');

  syncDateInput();
  ensureReceptionBookPrintToolbar();

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

  // ★印刷: 本日デイリー予約チェックリスト (A4縦)
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
  ensureReceptionBookPrintToolbar();
  renderAptPalette();

  if (calendarState.viewMode === 'WEEK') {
    renderWeeklyTimetable();
  } else {
    renderMonthlyCalendar();
  }
}
