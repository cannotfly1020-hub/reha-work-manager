// js/views/appointmentCalendarView.js
// 外来予約 週間タイムテーブル ＆ ドラッグ＆ドロップ ＆ 2大A4印刷対応 画面制御層
// 1. A4横1枚完結・原本Excel完全同一 週間タイムテーブル印刷
// 2. A4縦1枚完結・1日30名以上対応 本日デイリー予約チェックリスト印刷
// 3. 同一患者二重予約物理遮断トースト連携 ＆ 月間日付ダブルクリック週間ジャンプ完備

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getPatientById, searchPatients } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import {
  getAllAppointments, getAppointmentsByMonth, upsertAppointment
} from '../store/appointmentStore.js';
import { openAppointmentModal } from './modals/appointmentModal.js';
import { showToast } from './exportView.js';

// 基準日（デフォルトは本日）
let currentBaseDate = new Date();
// 表示モード: 'WEEK'（週間タイムテーブル） | 'MONTH'（月間カレンダー）
let currentViewMode = 'WEEK';
// ドラッグ中のペイロード保持（ブラウザのデータ消失対策）
let activeDragPayload = null;

// 時間軸スロット（本日時間割と同一の24コマ構成）
const TIME_SLOTS = [
  '08:40', '09:00', '09:20', '09:40', '10:00', '10:20', '10:40',
  '11:00', '11:20', '11:40', '12:00', '12:20',
  '13:40', '14:00', '14:20', '14:40', '15:00', '15:20', '15:40',
  '16:00', '16:20', '16:40', '17:00'
];

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
      currentBaseDate = new Date(y, m - 1, d);
      renderAppointmentCalendarView();
    }
  });

  btnPrev?.addEventListener('click', () => {
    if (currentViewMode === 'WEEK') {
      currentBaseDate.setDate(currentBaseDate.getDate() - 7);
    } else {
      currentBaseDate.setMonth(currentBaseDate.getMonth() - 1);
    }
    syncDateInput();
    renderAppointmentCalendarView();
  });

  btnNext?.addEventListener('click', () => {
    if (currentViewMode === 'WEEK') {
      currentBaseDate.setDate(currentBaseDate.getDate() + 7);
    } else {
      currentBaseDate.setMonth(currentBaseDate.getMonth() + 1);
    }
    syncDateInput();
    renderAppointmentCalendarView();
  });

  btnToday?.addEventListener('click', () => {
    currentBaseDate = new Date();
    syncDateInput();
    renderAppointmentCalendarView();
  });

  btnNew?.addEventListener('click', () => {
    const defaultDateStr = formatDateYMD(currentBaseDate);
    openAppointmentModal(null, defaultDateStr, '09:00');
  });

  // モード切替
  btnModeWeek?.addEventListener('click', () => switchViewMode('WEEK'));
  btnModeMonth?.addEventListener('click', () => switchViewMode('MONTH'));

  // ★印刷ボタン 1: 週間タイムテーブル (A4横1枚完結・原本Excel完全同一レイアウト)
  btnPrintWeekly?.addEventListener('click', () => {
    handlePrintWeeklyTable();
  });

  // ★印刷ボタン 2: 本日デイリー予約チェックリスト (A4縦1枚・30名以上対応)
  btnPrintDaily?.addEventListener('click', () => {
    handlePrintDailyChecklist();
  });

  // 患者パレットの検索・ソート・区分切替イベント
  setupAptPaletteEvents();

  // 初回描画
  renderAppointmentCalendarView();
}

function syncDateInput() {
  const dateInput = document.getElementById('aptCalendarWeekDateInput');
  if (dateInput) {
    dateInput.value = formatDateYMD(currentBaseDate);
  }
}

function switchViewMode(mode) {
  currentViewMode = mode;
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

  if (currentViewMode === 'WEEK') {
    renderWeeklyTimetable();
  } else {
    renderMonthlyCalendar();
  }
}

/* ==========================================================================
   1. 左側：外来予約用 患者パレット
   ========================================================================== */

let aptPaletteCategory = 'OUTPATIENT'; // 外来優先
let aptPaletteSort = 'CATEGORY';

function setupAptPaletteEvents() {
  const searchInput = document.getElementById('aptPaletteSearch');
  const sortSelect = document.getElementById('aptPaletteSortSelect');
  const catButtons = document.querySelectorAll('.apt-palette-cat-btn');

  searchInput?.addEventListener('input', renderAptPalette);

  sortSelect?.addEventListener('change', (e) => {
    aptPaletteSort = e.target.value;
    renderAptPalette();
  });

  catButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      catButtons.forEach((b) => {
        b.classList.remove('active');
        b.style.background = '#fff';
        b.style.color = '#334155';
      });
      btn.classList.add('active');
      btn.style.background = '#0284c7';
      btn.style.color = '#fff';
      aptPaletteCategory = btn.dataset.cat || 'ALL';
      renderAptPalette();
    });
  });
}

function renderAptPalette() {
  const container = document.getElementById('aptPalettePatientList');
  const searchInput = document.getElementById('aptPaletteSearch');
  if (!container) return;

  const keyword = searchInput ? searchInput.value.trim() : '';
  const patients = searchPatients(keyword, aptPaletteCategory, aptPaletteSort);

  if (patients.length === 0) {
    container.innerHTML = `<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:16px;">該当する患者がいません</div>`;
    return;
  }

  container.innerHTML = patients
    .map((p) => {
      let catClass = 'cat-outpatient';
      let catName = '外来';
      let tagBg = '#2563eb';
      if (p.category === 'INPATIENT') {
        catClass = 'cat-inpatient';
        catName = '入院';
        tagBg = '#d97706';
      } else if (p.diseaseType === 'ANALGESIA') {
        catClass = 'cat-analgesia';
        catName = '消炎';
        tagBg = '#16a34a';
      }

      return `
        <div class="apt-palette-item ${catClass}" draggable="true" data-patient-id="${p.id}" data-patient-name="${sanitizeHtml(p.name)}">
          <div class="apt-palette-item-name">
            <span>${sanitizeHtml(p.name)}</span>
            <span style="font-size:0.65rem; background:${tagBg}; color:#fff; padding:1px 5px; border-radius:3px;">${catName}</span>
          </div>
          <div class="apt-palette-item-sub">
            ID: ${p.id} / ${sanitizeHtml(p.diseaseName || '疾患名未登録')}
          </div>
        </div>
      `;
    })
    .join('');

  // パレットのドラッグ開始イベント
  container.querySelectorAll('.apt-palette-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      const patientId = item.dataset.patientId;
      const patientName = item.dataset.patientName;
      const payload = {
        type: 'NEW_PATIENT',
        patientId,
        patientName
      };
      activeDragPayload = payload;
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
    });

    item.addEventListener('dragend', () => {
      activeDragPayload = null;
    });
  });
}

/* ==========================================================================
   2. 右側：週間タイムテーブル（月〜土 × 時間枠）
   ========================================================================== */

function getWeekDates(baseDate) {
  const d = new Date(baseDate);
  const day = d.getDay();
  // 月曜日を週の始まりとする（日曜日は翌週扱いまたは前週扱い、日本の医療現場慣例）
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  const week = [];
  for (let i = 0; i < 6; i++) { // 月〜土 (6日間)
    const target = new Date(monday);
    target.setDate(monday.getDate() + i);
    week.push(target);
  }
  return week;
}

function renderWeeklyTimetable() {
  const gridEl = document.getElementById('aptWeeklyGrid');
  const rangeLabel = document.getElementById('aptCalendarWeekRangeLabel');
  const countBadge = document.getElementById('aptCalendarWeekCountBadge');
  if (!gridEl) return;

  const weekDates = getWeekDates(currentBaseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);
  const todayStr = formatDateYMD(new Date());

  if (rangeLabel) {
    rangeLabel.textContent = `${startStr.replace(/-/g, '/')} (月) 〜 ${endStr.replace(/-/g, '/')} (土)`;
  }

  // 今週の全予約を取得
  const allAppointments = getAllAppointments();
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  const weekAptList = Object.values(allAppointments).filter((apt) => {
    return apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date);
  });

  if (countBadge) {
    countBadge.textContent = `週間予約: 計 ${weekAptList.length} 件`;
  }

  // 予約マップ [日付][時間帯] -> Appointment[]
  const slotAptMap = {};
  weekAptList.forEach((apt) => {
    const k = `${apt.date}_${apt.startTime}`;
    if (!slotAptMap[k]) slotAptMap[k] = [];
    slotAptMap[k].push(apt);
  });

  const therapists = getAllTherapists();
  const staffColorMap = {};
  therapists.forEach((t) => { staffColorMap[t.id] = t.color || '#0284c7'; });
  staffColorMap['ANALGESIA'] = '#16a34a';
  staffColorMap['NONE'] = '#64748b';

  const dayNames = ['月', '火', '水', '木', '金', '土'];

  // グリッドHTML組み立て
  let html = `
    <div class="apt-weekly-header">時間</div>
  `;

  // 曜日ヘッダー
  weekDates.forEach((d, idx) => {
    const dateStr = formatDateYMD(d);
    const isToday = dateStr === todayStr;
    const isSat = d.getDay() === 6;
    let cls = 'apt-weekly-header';
    if (isSat) cls += ' apt-col-sat';
    if (isToday) cls += ' apt-col-today';

    const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
    html += `
      <div class="${cls}">
        <div>${dayNames[idx]}</div>
        <div style="font-size:0.7rem; font-weight:normal; opacity:0.85;">${mmdd}</div>
      </div>
    `;
  });

  // 時間帯 × 曜日行
  TIME_SLOTS.forEach((slotTime) => {
    html += `<div class="apt-weekly-time-col">${slotTime}</div>`;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isToday = dateStr === todayStr;
      const isSat = d.getDay() === 6;

      let cellCls = 'apt-weekly-slot-cell';
      if (isSat) cellCls += ' apt-sat-cell';
      if (isToday) cellCls += ' apt-today-cell';

      const key = `${dateStr}_${slotTime}`;
      const aptsInSlot = slotAptMap[key] || [];

      html += `<div class="${cellCls}" data-date="${dateStr}" data-time="${slotTime}">`;

      // 同一枠内の予約カードたち
      aptsInSlot.forEach((apt) => {
        const p = getPatientById(apt.patientId);
        const pName = p ? p.name : apt.patientId;
        const staff = therapists.find((t) => t.id === apt.therapistId);
        let staffLabel = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '物療' : '指定無');
        if (staffLabel.length > 3) staffLabel = staffLabel.slice(0, 3);

        const staffCol = staffColorMap[apt.therapistId] || '#0284c7';
        const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';
        const cardCls = isAnalgesia ? 'apt-weekly-card apt-card-analgesia' : 'apt-weekly-card';

        html += `
          <div class="${cardCls}" draggable="true" data-apt-id="${apt.id}" style="border-left:4px solid ${staffCol};">
            <span class="apt-weekly-card-name" title="${sanitizeHtml(pName)} (${apt.patientId})">${sanitizeHtml(pName)}</span>
            <span class="apt-weekly-card-tag" style="background:${staffCol};">${sanitizeHtml(staffLabel)}</span>
          </div>
        `;
      });

      html += `</div>`;
    });
  });

  gridEl.innerHTML = html;

  setupWeeklyDragAndDrop(gridEl);
}

/**
 * 週間タイムテーブルのドラッグ＆ドロップ ＆ クリックイベント
 */
function setupWeeklyDragAndDrop(gridEl) {
  // 配置済み予約カードのドラッグ開始イベント（曜日・時間移動）
  gridEl.querySelectorAll('.apt-weekly-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      const aptId = card.dataset.aptId;
      const payload = {
        type: 'MOVE_APPOINTMENT',
        appointmentId: aptId
      };
      activeDragPayload = payload;
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      activeDragPayload = null;
    });

    // カードクリックで編集モーダルを開く
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const aptId = card.dataset.aptId;
      const all = getAllAppointments();
      const targetApt = all[aptId];
      if (targetApt) {
        openAppointmentModal(targetApt);
      }
    });
  });

  // 各セルのドロップ受け入れイベント
  gridEl.querySelectorAll('.apt-weekly-slot-cell').forEach((cell) => {
    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      cell.classList.add('apt-drop-hover');
    });

    cell.addEventListener('dragleave', (e) => {
      // 子要素への移動による誤発火を防止
      if (!cell.contains(e.relatedTarget)) {
        cell.classList.remove('apt-drop-hover');
      }
    });

    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('apt-drop-hover');

      const targetCell = e.target.closest('.apt-weekly-slot-cell');
      if (!targetCell) return;

      const date = targetCell.dataset.date;
      const time = targetCell.dataset.time;

      let payload = activeDragPayload;
      if (!payload) {
        try {
          const raw = e.dataTransfer.getData('text/plain');
          if (raw) payload = JSON.parse(raw);
        } catch (_) {}
      }

      if (!payload) return;

      if (payload.type === 'NEW_PATIENT') {
        // パレットからの新規配置（即座に保存・配置）
        const p = getPatientById(payload.patientId);
        const isAnalgesia = p?.diseaseType === 'ANALGESIA';
        const defaultTherapist = isAnalgesia ? 'ANALGESIA' : 'A';
        const defaultTreatment = isAnalgesia ? 'ANALGESIA' : 'INDIVIDUAL';
        const defaultDuration = isAnalgesia ? 20 : 30;

        const res = upsertAppointment({
          patientId: payload.patientId,
          date: date,
          startTime: time,
          durationMinutes: defaultDuration,
          therapistId: defaultTherapist,
          treatmentType: defaultTreatment,
          notes: ''
        });

        if (res.success) {
          showToast(`✅ ${payload.patientName} 様を ${date.slice(5)} ${time} に予約配置しました`, 'success');
          renderAppointmentCalendarView();
        } else {
          // ★同一患者重複予約防止ガードのメッセージ表示
          showToast(res.message || '二重予約のため配置できませんでした', 'error');
        }
      } else if (payload.type === 'MOVE_APPOINTMENT') {
        // 配置済み予約の日時移動
        const all = getAllAppointments();
        const existing = all[payload.appointmentId];
        if (existing) {
          const res = upsertAppointment({
            ...existing,
            date: date,
            startTime: time
          });
          if (res.success) {
            showToast(`🔄 予約日時を ${date.slice(5)} ${time} に変更しました`, 'info');
            renderAppointmentCalendarView();
          } else {
            showToast(res.message || '移動先の時間帯が重複しています', 'error');
          }
        }
      }

      activeDragPayload = null;
    });

    // セルの空き余白クリックで新規予約モーダルを開く
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.apt-weekly-card')) return;
      const date = cell.dataset.date;
      const time = cell.dataset.time;
      openAppointmentModal(null, date, time);
    });
  });
}

/* ==========================================================================
   3. 月間カレンダー（マス目）フォールバックビュー ＆ ダブルクリック週間ジャンプ
   ========================================================================== */

function renderMonthlyCalendar() {
  const container = document.getElementById('aptCalendarGridContainer');
  if (!container) return;

  const y = currentBaseDate.getFullYear();
  const m = currentBaseDate.getMonth() + 1;
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
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, day).getDay();
    const isToday = dateStr === todayStr;

    let dayClass = 'calendar-day-cell';
    if (dayOfWeek === 0) dayClass += ' cal-sun-cell';
    else if (dayOfWeek === 6) dayClass += ' cal-sat-cell';
    if (isToday) dayClass += ' cal-today-cell';

    const dayApts = aptByDate[dateStr] || [];

    gridHtml += `
      <div class="${dayClass}" data-date="${dateStr}" title="💡 ダブルクリックでこの週の週間タイムテーブルへ移動">
        <div class="cal-day-header">
          <span class="cal-day-number ${isToday ? 'cal-today-badge' : ''}">${day}</span>
          ${dayApts.length > 0 ? `<span class="cal-day-count">${dayApts.length}件</span>` : ''}
          <button type="button" class="btn-cal-add-day" data-date="${dateStr}" title="この日に予約を追加">＋</button>
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

  // 月間ビューのイベント
  container.querySelectorAll('.btn-cal-add-day').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
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
        currentBaseDate = new Date(y, m - 1, d);
        syncDateInput();
        switchViewMode('WEEK');
        showToast(`📅 ${dateStr.replace(/-/g, '/')} の週へ移動しました`, 'info');
      }
    });
  });
}

/* ==========================================================================
   4. ★2大印刷エンジン（原本Excel完全同一 週間表 ＆ 本日デイリーリスト）
   ========================================================================== */

/**
 * 印刷スタイル 1: 週間タイムテーブル (A4横1枚完結・原本Excel完全同一レイアウト)
 * 月〜土 × 08:40〜17:00 のマトリクスで、週150〜200名規模でもA4横1枚に綺麗に収まります。
 */
function handlePrintWeeklyTable() {
  const weekDates = getWeekDates(currentBaseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);

  const allAppointments = getAllAppointments();
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  const weekAptList = Object.values(allAppointments).filter((apt) => {
    return apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date);
  });

  const slotAptMap = {};
  weekAptList.forEach((apt) => {
    const k = `${apt.date}_${apt.startTime}`;
    if (!slotAptMap[k]) slotAptMap[k] = [];
    slotAptMap[k].push(apt);
  });

  const therapists = getAllTherapists();
  const dayNames = ['月', '火', '水', '木', '金', '土'];

  const printWindow = window.open('', '_blank', 'width=1100,height=780');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  let tableHtml = `
    <table class="weekly-print-table">
      <thead>
        <tr>
          <th style="width: 58px;">時間</th>
  `;

  weekDates.forEach((d, idx) => {
    const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
    const isSat = d.getDay() === 6;
    tableHtml += `
      <th style="${isSat ? 'color:#1e40af; background:#eff6ff;' : ''}">
        ${dayNames[idx]} (${mmdd})
      </th>
    `;
  });

  tableHtml += `
        </tr>
      </thead>
      <tbody>
  `;

  TIME_SLOTS.forEach((slotTime) => {
    tableHtml += `
      <tr>
        <td class="time-header-cell">${slotTime}</td>
    `;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isSat = d.getDay() === 6;
      const key = `${dateStr}_${slotTime}`;
      const apts = slotAptMap[key] || [];

      tableHtml += `<td class="slot-content-cell ${isSat ? 'sat-col' : ''}">`;

      if (apts.length > 0) {
        apts.forEach((apt) => {
          const p = getPatientById(apt.patientId);
          const pName = p ? p.name : apt.patientId;
          const staff = therapists.find((t) => t.id === apt.therapistId);
          let staffLabel = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '物療' : '');
          if (staffLabel.length > 3) staffLabel = staffLabel.slice(0, 3);
          const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';

          tableHtml += `
            <div class="print-card ${isAnalgesia ? 'card-analgesia' : ''}">
              <span class="p-name">${sanitizeHtml(pName)}</span>
              ${staffLabel ? `<span class="p-staff">${sanitizeHtml(staffLabel)}</span>` : ''}
              ${apt.durationMinutes && apt.durationMinutes !== 20 ? `<span class="p-dur">${apt.durationMinutes}m</span>` : ''}
            </div>
          `;
        });
      }

      tableHtml += `</td>`;
    });

    tableHtml += `</tr>`;
  });

  tableHtml += `
      </tbody>
    </table>
  `;

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>外来リハビリ週間予約表 (${startStr.replace(/-/g, '/')}〜${endStr.replace(/-/g, '/')})</title>
      <style>
        @page {
          size: A4 landscape;
          margin: 6mm 6mm 5mm 6mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Meiryo UI", sans-serif;
          color: #0f172a;
          background: #fff;
          font-size: 8.5pt;
          line-height: 1.15;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 4px;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 3px;
        }
        .title { font-size: 13pt; font-weight: 800; color: #0f172a; }
        .sub-info { font-size: 8.5pt; font-weight: 700; color: #475569; }
        .weekly-print-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .weekly-print-table th, .weekly-print-table td {
          border: 1px solid #475569;
          vertical-align: top;
          padding: 1px 2px;
        }
        .weekly-print-table th {
          background: #f1f5f9;
          font-weight: 800;
          font-size: 8pt;
          text-align: center;
          padding: 3px 2px;
        }
        .time-header-cell {
          text-align: center;
          font-weight: 800;
          font-size: 7.5pt;
          background: #f8fafc;
          vertical-align: middle !important;
          color: #334155;
          height: 22px;
        }
        .slot-content-cell {
          height: 22px;
          background: #fff;
        }
        .slot-content-cell.sat-col {
          background: #fafcff;
        }
        .print-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 2px;
          background: #f8fafc;
          border: 1px solid #94a3b8;
          border-left: 3px solid #0284c7;
          border-radius: 2px;
          padding: 1px 3px;
          margin-bottom: 1px;
          font-size: 7pt;
          line-height: 1.1;
        }
        .print-card.card-analgesia {
          background: #f0fdf4;
          border-color: #86efac;
          border-left-color: #16a34a;
        }
        .p-name {
          font-weight: 800;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .p-staff {
          font-size: 6.5pt;
          font-weight: 700;
          color: #0369a1;
          white-space: nowrap;
        }
        .p-dur {
          font-size: 6pt;
          color: #64748b;
          white-space: nowrap;
        }
        .footer-note {
          display: flex;
          justify-content: space-between;
          font-size: 7pt;
          color: #64748b;
          margin-top: 3px;
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div>
          <span class="title">外来リハビリテーション 週間予約管理表</span>
          <span style="font-size:9pt; font-weight:700; color:#0369a1; margin-left:12px;">
            期間: ${startStr.replace(/-/g, '/')} (月) 〜 ${endStr.replace(/-/g, '/')} (土)
          </span>
        </div>
        <div class="sub-info">
          週間予約総数: ${weekAptList.length} 名 / 出力日: ${new Date().toLocaleDateString('ja-JP')}
        </div>
      </div>

      ${tableHtml}

      <div class="footer-note">
        <span>※ 同一時間枠に複数名配置可能（物療並行・担当PT別）。急患・当日キャンセル等は直接追記してください。</span>
        <span>reha-work-manager R8</span>
      </div>
      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * 印刷スタイル 2: 本日デイリー予約チェックリスト (A4縦1枚・30名以上高密度対応)
 * 選択中（または本日）の予約患者を早い順に並べ、毎朝バインダーに挟んで手元でレ点チェックできる専用帳票。
 */
function handlePrintDailyChecklist() {
  const targetDateStr = formatDateYMD(currentBaseDate);
  const allAppointments = getAllAppointments();

  const dailyAptList = Object.values(allAppointments)
    .filter((apt) => apt.date === targetDateStr && apt.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const printWindow = window.open('', '_blank', 'width=900,height=800');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  const therapists = getAllTherapists();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayOfWeek = dayNames[currentBaseDate.getDay()];

  let rowsHtml = '';
  dailyAptList.forEach((apt, idx) => {
    const p = getPatientById(apt.patientId);
    const pName = p ? p.name : apt.patientId;
    const staff = therapists.find((t) => t.id === apt.therapistId);
    const staffLabel = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '消炎(物療)' : '-');

    let typeLabel = '個別リハ';
    if (apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA') typeLabel = '消炎鎮痛(物療)';
    else if (apt.treatmentType === 'EVALUATION') typeLabel = '評価・装具診';
    else if (apt.treatmentType === 'OTHER') typeLabel = 'その他';

    rowsHtml += `
      <tr>
        <td style="text-align:center; font-weight:bold; font-size:10pt;">[　]</td>
        <td style="text-align:center; font-weight:700; color:#64748b;">${idx + 1}</td>
        <td style="text-align:center; font-weight:800; font-size:9.5pt; color:#0f172a;">${apt.startTime}</td>
        <td style="font-weight:800; font-size:9.5pt; color:#0f172a;">
          ${sanitizeHtml(pName)}
          <span style="font-size:7.5pt; font-weight:normal; color:#64748b;">(${apt.patientId})</span>
        </td>
        <td style="text-align:center; font-weight:700; color:#0369a1;">${sanitizeHtml(staffLabel)}</td>
        <td style="font-size:8pt; text-align:center;">${typeLabel} (${apt.durationMinutes || 30}分)</td>
        <td style="font-size:8pt; color:#475569;">${sanitizeHtml(apt.notes || '')}</td>
      </tr>
    `;
  });

  // 予約が少ない場合でも30名分枠を確保して手書き追記可能にする
  const emptyRowsNeeded = Math.max(0, 32 - dailyAptList.length);
  for (let i = 0; i < emptyRowsNeeded; i++) {
    const seq = dailyAptList.length + i + 1;
    rowsHtml += `
      <tr class="empty-memo-row">
        <td style="text-align:center;">[　]</td>
        <td style="text-align:center; color:#94a3b8;">${seq}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      </tr>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>外来リハビリ本日デイリー予約チェック表 (${targetDateStr})</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 7mm 7mm 6mm 7mm;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Meiryo UI", sans-serif;
          color: #0f172a;
          background: #fff;
          font-size: 8.5pt;
          line-height: 1.2;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 6px;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 4px;
        }
        .title { font-size: 13.5pt; font-weight: 800; color: #0f172a; }
        .date-badge {
          font-size: 11pt;
          font-weight: 800;
          color: #15803d;
          background: #f0fdf4;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #86efac;
        }
        .daily-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .daily-table th, .daily-table td {
          border: 1px solid #475569;
          vertical-align: middle;
          padding: 3px 5px;
        }
        .daily-table th {
          background: #f1f5f9;
          font-weight: 800;
          font-size: 8pt;
          text-align: center;
          color: #1e293b;
        }
        .daily-table tr:nth-child(even):not(.empty-memo-row) {
          background: #f8fafc;
        }
        .empty-memo-row td {
          height: 18px;
          background: #fff;
        }
        .footer-note {
          display: flex;
          justify-content: space-between;
          font-size: 7.5pt;
          color: #64748b;
          margin-top: 4px;
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div>
          <span class="title">外来リハビリテーション 来院チェック表</span>
          <span class="date-badge" style="margin-left:8px;">${targetDateStr.replace(/-/g, '/')} (${dayOfWeek})</span>
        </div>
        <div style="font-size:9pt; font-weight:800; color:#334155;">
          予約総数: ${dailyAptList.length} 名
        </div>
      </div>

      <table class="daily-table">
        <thead>
          <tr>
            <th style="width: 32px;">来院</th>
            <th style="width: 26px;">No</th>
            <th style="width: 50px;">時間</th>
            <th style="width: 130px;">患者氏名 (ID)</th>
            <th style="width: 65px;">担当PT</th>
            <th style="width: 95px;">区分 / 所要枠</th>
            <th>院内特記メモ (送迎・診察順等) / 手書き追記</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="footer-note">
        <span>※ 来院時に左端の [ ] にレ点を記入してください。下部の空欄は急患・当日電話予約の受付手書き用です。</span>
        <span>reha-work-manager R8</span>
      </div>
      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * 日付フォーマットヘルパー (YYYY-MM-DD)
 */
function formatDateYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
