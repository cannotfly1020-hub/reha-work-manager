// js/views/appointmentCalendarView.js
// 外来予約カレンダーの初期化・週/月の切り替え
// ★A4縦「週間予約受付簿」へ一本化（旧週間表印刷ボタンは非表示）。画面マス目描画には非干渉。

import { getJapaneseHolidayName } from '../core/holidayCalc.js';
import { formatDateYMD } from '../core/dateUtils.js';
import { openAppointmentModal } from './modals/appointmentModal.js';
import { showToast } from '../ui/toast.js';
import { printDailyAppointmentChecklist } from '../print/dailyChecklistPrint.js';
import { printHandwritingWeeklySheet } from '../print/handwritingWeeklyPrint.js';
import { calendarState } from './appointment/calendarState.js';
import { setupAptPaletteEvents, renderAptPalette } from './appointment/palette.js';
import { renderWeeklyTimetable } from './appointment/weeklyTimetable.js';
import { renderMonthlyCalendar } from './appointment/monthlyCalendar.js';

/**
 * 週間予約受付簿（A4縦・手書き余白完備・1枚ジャスト収容）印刷
 * 画面の週間マス目描画には一切触れず、印刷ポップアップのみ生成する。
 */
export function handlePrintHandwritingWeeklySheet() {
  printHandwritingWeeklySheet(calendarState.baseDate);
}

/**
 * 旧「🖨 週間表 (A4横)」を非表示にし、主要ボタン「📝 週間予約受付簿 (A4縦)」を配置する。
 * index.html は改変せず DOM 操作のみでツールバーを整理する。
 */
function ensureReceptionBookPrintToolbar() {
  const weeklyBtn = document.getElementById('btnAptPrintWeekly');
  const dailyBtn = document.getElementById('btnAptPrintDaily');
  const parent = weeklyBtn?.parentElement || dailyBtn?.parentElement;
  if (!parent) return;

  // 旧週間表印刷（空き行圧縮版）は受付簿へ一本化したためツールバーから外す
  if (weeklyBtn) {
    weeklyBtn.style.display = 'none';
    weeklyBtn.setAttribute('aria-hidden', 'true');
    weeklyBtn.tabIndex = -1;
  }

  let btn = document.getElementById('btnAptPrintHandwritingWeekly');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btnAptPrintHandwritingWeekly';
    btn.type = 'button';
    btn.title = '対面受付・次週案内用。全時間枠を残したA4縦1枚の予約受付簿を印刷します（空き枠は手書き可／画面表示は変わりません）';
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
    btn.addEventListener('click', () => {
      handlePrintHandwritingWeeklySheet();
    });

    // デイリー印刷の直前＝2大印刷ボタンの左側に配置
    if (dailyBtn) {
      parent.insertBefore(btn, dailyBtn);
    } else if (weeklyBtn) {
      parent.insertBefore(btn, weeklyBtn);
    } else {
      parent.appendChild(btn);
    }
  }

  btn.innerHTML = '<span>📝</span><span>週間予約受付簿 (A4縦)</span>';
  btn.style.display = 'flex';
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

  // ★印刷: 本日デイリー予約チェックリスト (A4縦) ※受付簿と並ぶ2大印刷
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
