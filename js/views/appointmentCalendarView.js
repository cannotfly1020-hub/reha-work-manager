// js/views/appointmentCalendarView.js
// 外来予約 月間カレンダー画面制御層（マンスリービュー / 日別時間順カード / マス目即時登録 / モーダル連携）

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import { getAppointmentsByMonth } from '../store/appointmentStore.js';
import { openAppointmentModal } from './modals/appointmentModal.js';

let currentCalendarYear = new Date().getFullYear();
let currentCalendarMonth = new Date().getMonth() + 1; // 1-12

/**
 * 月間カレンダー画面の初期化
 */
export function initAppointmentCalendarView() {
  const monthInput = document.getElementById('aptCalendarMonthInput');
  const btnPrev = document.getElementById('btnAptCalPrevMonth');
  const btnNext = document.getElementById('btnAptCalNextMonth');
  const btnToday = document.getElementById('btnAptCalToday');
  const btnNew = document.getElementById('btnAptCalNew');

  syncMonthInputValue();

  monthInput?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [y, m] = e.target.value.split('-').map(Number);
    if (y && m) {
      currentCalendarYear = y;
      currentCalendarMonth = m;
      renderAppointmentCalendarView();
    }
  });

  btnPrev?.addEventListener('click', () => {
    currentCalendarMonth--;
    if (currentCalendarMonth < 1) {
      currentCalendarMonth = 12;
      currentCalendarYear--;
    }
    syncMonthInputValue();
    renderAppointmentCalendarView();
  });

  btnNext?.addEventListener('click', () => {
    currentCalendarMonth++;
    if (currentCalendarMonth > 12) {
      currentCalendarMonth = 1;
      currentCalendarYear++;
    }
    syncMonthInputValue();
    renderAppointmentCalendarView();
  });

  btnToday?.addEventListener('click', () => {
    const now = new Date();
    currentCalendarYear = now.getFullYear();
    currentCalendarMonth = now.getMonth() + 1;
    syncMonthInputValue();
    renderAppointmentCalendarView();
  });

  btnNew?.addEventListener('click', () => {
    const defaultDate = `${currentCalendarYear}-${String(currentCalendarMonth).padStart(2, '0')}-01`;
    openAppointmentModal(null, defaultDate, '09:00');
  });
}

function syncMonthInputValue() {
  const monthInput = document.getElementById('aptCalendarMonthInput');
  if (monthInput) {
    monthInput.value = `${currentCalendarYear}-${String(currentCalendarMonth).padStart(2, '0')}`;
  }
}

/**
 * 月間カレンダー画面の描画
 */
export function renderAppointmentCalendarView() {
  const container = document.getElementById('aptCalendarGridContainer');
  const countEl = document.getElementById('aptCalendarMonthCountBadge');
  if (!container) return;

  const y = currentCalendarYear;
  const m = currentCalendarMonth;
  const appointments = getAppointmentsByMonth(y, m);

  if (countEl) {
    countEl.textContent = `月間予約: 計 ${appointments.length} 件`;
  }

  // 日付ごとの予約マップを作成 (キー: YYYY-MM-DD)
  const aptByDate = {};
  appointments.forEach((apt) => {
    if (!aptByDate[apt.date]) aptByDate[apt.date] = [];
    aptByDate[apt.date].push(apt);
  });

  const therapists = getAllTherapists();
  const staffColorMap = {};
  therapists.forEach((t) => {
    staffColorMap[t.id] = t.color || '#0284c7';
  });
  staffColorMap['ANALGESIA'] = '#16a34a'; // 消炎鎮痛（物療）専用グリーン
  staffColorMap['NONE'] = '#64748b';

  // 月の日付計算
  const firstDayOfWeek = new Date(y, m - 1, 1).getDay(); // 0:日〜6:土
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  let gridHtml = `
    <div class="calendar-header-row">
      <div class="calendar-header-cell cal-sun">日</div>
      <div class="calendar-header-cell">月</div>
      <div class="calendar-header-cell">火</div>
      <div class="calendar-header-cell">水</div>
      <div class="calendar-header-cell">木</div>
      <div class="calendar-header-cell">金</div>
      <div class="calendar-header-cell cal-sat">土</div>
    </div>
    <div class="calendar-cells-grid">
  `;

  // 前月の空白マス
  for (let i = 0; i < firstDayOfWeek; i++) {
    gridHtml += `<div class="calendar-day-cell cal-empty"></div>`;
  }

  // 当月の日付マス
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, day).getDay();
    const isToday = dateStr === todayStr;

    let dayClass = 'calendar-day-cell';
    if (dayOfWeek === 0) dayClass += ' cal-sun-cell';
    else if (dayOfWeek === 6) dayClass += ' cal-sat-cell';
    if (isToday) dayClass += ' cal-today-cell';

    const dayApts = aptByDate[dateStr] || [];

    gridHtml += `
      <div class="${dayClass}" data-date="${dateStr}">
        <div class="cal-day-header">
          <span class="cal-day-number ${isToday ? 'cal-today-badge' : ''}">${day}</span>
          ${dayApts.length > 0 ? `<span class="cal-day-count">${dayApts.length}件</span>` : ''}
          <button type="button" class="btn-cal-add-day" data-date="${dateStr}" title="この日に予約を追加">＋</button>
        </div>
        <div class="cal-day-body">
    `;

    // 予約カード（時間順）
    dayApts.forEach((apt) => {
      const p = getPatientById(apt.patientId);
      const pName = p ? p.name : apt.patientId;
      const staff = therapists.find((t) => t.id === apt.therapistId);
      let staffLabel = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '物療' : '指定無');
      if (staffLabel.length > 4) staffLabel = staffLabel.slice(0, 4);

      const staffCol = staffColorMap[apt.therapistId] || '#0284c7';
      const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';

      const cardBg = isAnalgesia ? '#f0fdf4' : '#f8fafc';
      const cardBorder = isAnalgesia ? '#86efac' : '#cbd5e1';

      gridHtml += `
        <div class="cal-apt-card" data-apt-id="${apt.id}" style="background:${cardBg}; border:1px solid ${cardBorder}; border-left:4px solid ${staffCol};">
          <div class="cal-apt-time">
            <strong>${apt.startTime}</strong>
            <span class="cal-apt-dur">(${apt.durationMinutes}分)</span>
            <span class="cal-apt-staff" style="color:${staffCol};">${sanitizeHtml(staffLabel)}</span>
          </div>
          <div class="cal-apt-name" title="${sanitizeHtml(pName)} (${apt.patientId})">
            ${sanitizeHtml(pName)}
          </div>
          ${apt.notes ? `<div class="cal-apt-note" title="${sanitizeHtml(apt.notes)}">${sanitizeHtml(apt.notes)}</div>` : ''}
        </div>
      `;
    });

    gridHtml += `
        </div>
      </div>
    `;
  }

  // 翌月の空白マス（7列×行数で末尾を埋める）
  const totalSlots = firstDayOfWeek + daysInMonth;
  const remainder = totalSlots % 7;
  if (remainder > 0) {
    const trailingCount = 7 - remainder;
    for (let i = 0; i < trailingCount; i++) {
      gridHtml += `<div class="calendar-day-cell cal-empty"></div>`;
    }
  }

  gridHtml += `</div>`;
  container.innerHTML = gridHtml;

  // イベントリスナーの付与
  container.querySelectorAll('.btn-cal-add-day').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const date = btn.dataset.date;
      openAppointmentModal(null, date, '09:00');
    });
  });

  container.querySelectorAll('.cal-apt-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const aptId = card.dataset.aptId;
      const targetApt = appointments.find((a) => a.id === aptId);
      if (targetApt) {
        openAppointmentModal(targetApt);
      }
    });
  });

  // マス目の空き余白クリックでも登録を開く
  container.querySelectorAll('.calendar-day-cell:not(.cal-empty)').forEach((cell) => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.cal-apt-card') || e.target.closest('.btn-cal-add-day')) return;
      const date = cell.dataset.date;
      if (date) {
        openAppointmentModal(null, date, '09:00');
      }
    });
  });
}
