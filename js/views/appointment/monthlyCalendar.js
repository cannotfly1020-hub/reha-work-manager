// js/views/appointment/monthlyCalendar.js
// 外来予約の月間カレンダー

import { sanitizeHtml } from '../../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../../core/holidayCalc.js';
import { formatDateYMD } from '../../core/dateUtils.js';
import { getPatientById } from '../../store/patientStore.js';
import { getAllTherapists } from '../../store/therapistStore.js';
import { getAllAppointments, getAppointmentsByMonth } from '../../store/appointmentStore.js';
import { openAppointmentModal } from '../modals/appointmentModal.js';
import { showToast } from '../../ui/toast.js';
import { calendarState } from './calendarState.js';
import {
  renderAppointmentCalendarView, switchViewMode, syncDateInput
} from '../appointmentCalendarView.js';

export function renderMonthlyCalendar() {
  const container = document.getElementById('aptCalendarGridContainer');
  if (!container) return;

  const y = calendarState.baseDate.getFullYear();
  const m = calendarState.baseDate.getMonth() + 1;
  const appointments = getAppointmentsByMonth(y, m);

  const aptByDate = {};
  appointments.forEach((apt) => {
    if (!aptByDate[apt.date]) aptByDate[apt.date] = [];
    aptByDate[apt.date].push(apt);
  });

  const therapists = getAllTherapists();
  const staffColorMap = {};
  therapists.forEach((t) => { staffColorMap[t.id] = t.color || '#0284c7'; });
  staffColorMap['ANALGESIA'] = '#16a34a';
  staffColorMap['NONE'] = '#64748b';

  const firstDayOfWeek = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayStr = formatDateYMD(new Date());

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

  for (let i = 0; i < firstDayOfWeek; i++) {
    gridHtml += `<div class="calendar-day-cell cal-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const curDate = new Date(y, m - 1, day);
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = curDate.getDay();
    const isToday = dateStr === todayStr;
    const holidayName = getJapaneseHolidayName(curDate);
    const isHoliday = !!holidayName;

    let dayClass = 'calendar-day-cell';
    let customStyle = '';

    if (isHoliday) {
      dayClass += ' cal-holiday-cell';
      customStyle = 'background:#fff8f8;';
    } else if (dayOfWeek === 0) {
      dayClass += ' cal-sun-cell';
    } else if (dayOfWeek === 6) {
      dayClass += ' cal-sat-cell';
    }
    if (isToday) {
      dayClass += ' cal-today-cell';
    }

    const dayApts = aptByDate[dateStr] || [];

    gridHtml += `
      <div class="${dayClass}" data-date="${dateStr}" data-is-holiday="${isHoliday ? 'true' : 'false'}" data-holiday-name="${holidayName || ''}" style="${customStyle}" title="💡 ダブルクリックでこの週の週間タイムテーブルへ移動">
        <div class="cal-day-header">
          <div style="display:flex; align-items:center; gap:4px;">
            <span class="cal-day-number ${isToday ? 'cal-today-badge' : ''}" style="${isHoliday ? 'color:#e11d48; font-weight:800;' : ''}">${day}</span>
            ${isHoliday ? `<span style="font-size:0.63rem; font-weight:800; background:#fee2e2; color:#be123c; padding:1px 4px; border-radius:3px;">${sanitizeHtml(holidayName)}</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            ${dayApts.length > 0 ? `<span class="cal-day-count">${dayApts.length}件</span>` : ''}
            <button type="button" class="btn-cal-add-day" data-date="${dateStr}" data-is-holiday="${isHoliday ? 'true' : 'false'}" data-holiday-name="${holidayName || ''}" title="${isHoliday ? '祝日のため追加不可' : 'この日に予約を追加'}" style="${isHoliday ? 'opacity:0.4; cursor:not-allowed;' : ''}">＋</button>
          </div>
        </div>
        <div class="cal-day-body">
    `;

    dayApts.forEach((apt) => {
      const p = getPatientById(apt.patientId);
      const pName = p ? p.name : apt.patientId;
      const staff = therapists.find((t) => t.id === apt.therapistId);
      let staffLabel = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '物療' : '指定無');
      if (staffLabel.length > 3) staffLabel = staffLabel.slice(0, 3);

      const staffCol = staffColorMap[apt.therapistId] || '#0284c7';
      const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';
      const cardBg = isAnalgesia ? '#f0fdf4' : '#f8fafc';
      const cardBorder = isAnalgesia ? '#86efac' : '#cbd5e1';

      gridHtml += `
        <div class="cal-apt-card" data-apt-id="${apt.id}" style="background:${cardBg}; border:1px solid ${cardBorder}; border-left:4px solid ${staffCol};">
          <div class="cal-apt-time">
            <strong>${apt.startTime}</strong>
            <span class="cal-apt-staff" style="color:${staffCol};">${sanitizeHtml(staffLabel)}</span>
          </div>
          <div class="cal-apt-name" title="${sanitizeHtml(pName)} (${apt.patientId})">${sanitizeHtml(pName)}</div>
        </div>
      `;
    });

    gridHtml += `
        </div>
      </div>
    `;
  }

  const totalSlots = firstDayOfWeek + daysInMonth;
  const remainder = totalSlots % 7;
  if (remainder > 0) {
    for (let i = 0; i < (7 - remainder); i++) {
      gridHtml += `<div class="calendar-day-cell cal-empty"></div>`;
    }
  }

  gridHtml += `</div>`;
  container.innerHTML = gridHtml;

  // 月間ビューのイベント（祝日の場合は追加を物理遮断）
  container.querySelectorAll('.btn-cal-add-day').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHoliday = btn.dataset.isHoliday === 'true';
      const holidayName = btn.dataset.holidayName;
      if (isHoliday) {
        showToast(`⚠️ 祝日（${holidayName || '休診日'}）のため予約は追加できません`, 'warn');
        return;
      }
      openAppointmentModal(null, btn.dataset.date, '09:00');
    });
  });

  container.querySelectorAll('.cal-apt-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const all = getAllAppointments();
      const targetApt = all[card.dataset.aptId];
      if (targetApt) openAppointmentModal(targetApt);
    });
  });

  // ★月間カレンダー日付セルのダブルクリックでその週のタイムテーブルへジャンプ
  container.querySelectorAll('.calendar-day-cell:not(.cal-empty)').forEach((cell) => {
    cell.addEventListener('dblclick', (e) => {
      if (e.target.closest('.cal-apt-card') || e.target.closest('.btn-cal-add-day')) return;
      const dateStr = cell.dataset.date;
      if (dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        calendarState.baseDate = new Date(y, m - 1, d);
        syncDateInput();
        switchViewMode('WEEK');
        showToast(`📅 ${dateStr.replace(/-/g, '/')} の週へ移動しました`, 'info');
      }
    });
  });
}
