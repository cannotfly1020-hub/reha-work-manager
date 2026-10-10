// js/views/appointmentCalendarView.js
// 外来予約 週間タイムテーブル ＆ ドラッグ＆ドロップ ＆ 月間切替 ＆ A4週間シート印刷 画面制御層
// 本日時間割と同一の操作感（左側患者パレットから月〜土の時間枠へ直感ドラッグ配置・即時保存・同一時間重複対応）
// ★同一患者の重複予約防止ガード完全連動（二重予約を即座に検知し警告トースト通知）
// ★月間カレンダーからの日付ダブルクリックによる週間タイムテーブル即時ジャンプ機能完備

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { getPatientById, getAllPatients } from '../store/patientStore.js';
import { getAllTherapists } from '../store/therapistStore.js';
import {
  getAllAppointments, getAppointmentsByMonth,
  upsertAppointment, calculateEndTime
} from '../store/appointmentStore.js';
import { openAppointmentModal } from './modals/appointmentModal.js';
import { showToast } from './exportView.js';

// 24コマ標準時間枠（本日時間割と完全同期）
const TIME_SLOTS = [
  { id: 1,  time: '08:40' },
  { id: 2,  time: '09:00' },
  { id: 3,  time: '09:20' },
  { id: 4,  time: '09:40' },
  { id: 5,  time: '10:00' },
  { id: 6,  time: '10:20' },
  { id: 7,  time: '10:40' },
  { id: 8,  time: '11:00' },
  { id: 9,  time: '11:20' },
  { id: 10, time: '11:40' },
  { id: 11, time: '12:00' },
  { id: 12, time: '12:20' },
  { id: 13, time: '13:20' },
  { id: 14, time: '13:40' },
  { id: 15, time: '14:00' },
  { id: 16, time: '14:20' },
  { id: 17, time: '14:40' },
  { id: 18, time: '15:00' },
  { id: 19, time: '15:20' },
  { id: 20, time: '15:40' },
  { id: 21, time: '16:00' },
  { id: 22, time: '16:20' },
  { id: 23, time: '16:40' },
  { id: 24, time: '17:00' }
];

// 表示状態管理
let currentBaseDate = new Date(); // 表示基準日（週内の任意の日）
let currentViewMode = 'WEEK';     // 'WEEK' (週間タイムテーブル) | 'MONTH' (月間マス目)
let paletteFilterCat = 'OUTPATIENT'; // 外来優先
let paletteSortOrder = 'CATEGORY';

// ドラッグ中の一時データ退避用（ブラウザのデータ転送消失ガード）
let activeDragPayload = null;

/**
 * 外来予約カレンダー画面の全体初期化
 */
export function initAppointmentCalendarView() {
  initWeekNavigationListeners();
  initPaletteListeners();
  initViewModeListeners();
  initPrintListeners();

  // 初回描画
  renderAppointmentCalendarView();
}

/**
 * 画面全体の再描画（週間/月間モード両対応）
 */
export function renderAppointmentCalendarView() {
  renderPalette();

  if (currentViewMode === 'WEEK') {
    renderWeeklyTimetable();
  } else {
    renderMonthlyCalendar();
  }
}

function initWeekNavigationListeners() {
  const btnPrev = document.getElementById('btnAptCalPrevWeek');
  const btnNext = document.getElementById('btnAptCalNextWeek');
  const btnThisWeek = document.getElementById('btnAptCalThisWeek');
  const dateInput = document.getElementById('aptCalendarWeekDateInput');

  btnPrev?.addEventListener('click', () => {
    currentBaseDate.setDate(currentBaseDate.getDate() - 7);
    renderAppointmentCalendarView();
  });

  btnNext?.addEventListener('click', () => {
    currentBaseDate.setDate(currentBaseDate.getDate() + 7);
    renderAppointmentCalendarView();
  });

  btnThisWeek?.addEventListener('click', () => {
    currentBaseDate = new Date();
    renderAppointmentCalendarView();
  });

  dateInput?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [y, m, d] = e.target.value.split('-').map(Number);
    if (y && m && d) {
      currentBaseDate = new Date(y, m - 1, d);
      renderAppointmentCalendarView();
    }
  });

  const btnNew = document.getElementById('btnAptCalNew');
  btnNew?.addEventListener('click', () => {
    const todayStr = toDateString(currentBaseDate);
    openAppointmentModal(null, todayStr, '09:00');
  });
}

function initViewModeListeners() {
  const btnWeek = document.getElementById('btnAptViewModeWeek');
  const btnMonth = document.getElementById('btnAptViewModeMonth');

  btnWeek?.addEventListener('click', () => {
    switchToWeeklyMode();
  });

  btnMonth?.addEventListener('click', () => {
    switchToMonthlyMode();
  });
}

/**
 * 週間モードへの画面切り替え
 */
function switchToWeeklyMode() {
  currentViewMode = 'WEEK';
  const btnWeek = document.getElementById('btnAptViewModeWeek');
  const btnMonth = document.getElementById('btnAptViewModeMonth');
  const weekContainer = document.getElementById('aptWeeklyViewContainer');
  const monthContainer = document.getElementById('aptMonthlyViewContainer');

  if (btnWeek) {
    btnWeek.classList.add('active');
    btnWeek.style.background = '#0284c7';
    btnWeek.style.color = '#fff';
  }
  if (btnMonth) {
    btnMonth.classList.remove('active');
    btnMonth.style.background = '#fff';
    btnMonth.style.color = '#475569';
  }
  if (weekContainer) weekContainer.style.display = 'grid';
  if (monthContainer) monthContainer.style.display = 'none';

  renderAppointmentCalendarView();
}

/**
 * 月間モードへの画面切り替え
 */
function switchToMonthlyMode() {
  currentViewMode = 'MONTH';
  const btnWeek = document.getElementById('btnAptViewModeWeek');
  const btnMonth = document.getElementById('btnAptViewModeMonth');
  const weekContainer = document.getElementById('aptWeeklyViewContainer');
  const monthContainer = document.getElementById('aptMonthlyViewContainer');

  if (btnMonth) {
    btnMonth.classList.add('active');
    btnMonth.style.background = '#0284c7';
    btnMonth.style.color = '#fff';
  }
  if (btnWeek) {
    btnWeek.classList.remove('active');
    btnWeek.style.background = '#fff';
    btnWeek.style.color = '#475569';
  }
  if (weekContainer) weekContainer.style.display = 'none';
  if (monthContainer) monthContainer.style.display = 'block';

  renderAppointmentCalendarView();
}

/**
 * 基準日を含む「月曜日〜土曜日」の日付リストを算出する
 * @param {Date} baseDate
 * @returns {Array<{ dateStr: string, dayOfWeek: number, dayName: string, label: string, isToday: boolean, monthDay: string }>}
 */
function getWeekDaysList(baseDate) {
  const current = new Date(baseDate);
  const day = current.getDay(); // 0:日, 1:月 ... 6:土
  // 月曜日を起点にする (日曜の場合は前週の月曜、それ以外は当週月曜)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(current);
  monday.setDate(current.getDate() + diffToMonday);

  const dayNames = ['月', '火', '水', '木', '金', '土'];
  const todayStr = toDateString(new Date());
  const list = [];

  for (let i = 0; i < 6; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = toDateString(d);
    list.push({
      dateStr,
      dayOfWeek: d.getDay(),
      dayName: dayNames[i],
      monthDay: `${d.getMonth() + 1}/${d.getDate()}`,
      label: `${d.getMonth() + 1}/${d.getDate()} (${dayNames[i]})`,
      isToday: dateStr === todayStr
    });
  }
  return list;
}

function toDateString(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 週間タイムテーブル（月〜土 × 24コマ）の描画
 */
function renderWeeklyTimetable() {
  const gridContainer = document.getElementById('aptWeeklyGrid');
  const dateInput = document.getElementById('aptCalendarWeekDateInput');
  const rangeLabel = document.getElementById('aptCalendarWeekRangeLabel');
  const badgeEl = document.getElementById('aptCalendarWeekCountBadge');
  if (!gridContainer) return;

  const weekDays = getWeekDaysList(currentBaseDate);
  const startDate = weekDays[0].dateStr;
  const endDate = weekDays[5].dateStr;

  if (dateInput) dateInput.value = toDateString(currentBaseDate);
  if (rangeLabel) rangeLabel.textContent = `【 ${startDate} 〜 ${endDate} 】`;

  // 1週間の全予約データを集計 (日付マップ)
  const allAppointments = getAllAppointments();
  const weekAptList = Object.values(allAppointments).filter(
    (apt) => apt.date >= startDate && apt.date <= endDate && apt.status !== 'CANCELLED'
  );

  if (badgeEl) badgeEl.textContent = `週間予約: 計 ${weekAptList.length} 件`;

  // 日付 ＆ 開始時刻でインデックス化 (key: YYYY-MM-DD_HH:MM)
  const aptBySlot = {};
  weekAptList.forEach((apt) => {
    const slotKey = `${apt.date}_${apt.startTime}`;
    if (!aptBySlot[slotKey]) aptBySlot[slotKey] = [];
    aptBySlot[slotKey].push(apt);
  });

  const therapists = getAllTherapists();
  const staffColorMap = {};
  therapists.forEach((t) => { staffColorMap[t.id] = t.color || '#0284c7'; });
  staffColorMap['ANALGESIA'] = '#16a34a';
  staffColorMap['NONE'] = '#64748b';

  // グリッドHTMLの組み立て
  // ヘッダー行（時間列 ＋ 月〜土の6列）
  let gridHtml = `
    <div class="apt-weekly-header">時間帯</div>
  `;
  weekDays.forEach((wd) => {
    let headerCls = 'apt-weekly-header';
    if (wd.dayOfWeek === 6) headerCls += ' apt-col-sat';
    if (wd.isToday) headerCls += ' apt-col-today';
    gridHtml += `
      <div class="${headerCls}">
        <div>${wd.dayName}曜日</div>
        <div style="font-size:0.72rem; color:${wd.isToday ? '#15803d' : '#64748b'}; font-weight:normal;">${wd.monthDay}</div>
      </div>
    `;
  });

  // 各時間コマ行（24コマ）
  TIME_SLOTS.forEach((slot) => {
    // 左端：時間ラベル
    gridHtml += `<div class="apt-weekly-time-col">${slot.time}</div>`;

    // 月〜土の各セル
    weekDays.forEach((wd) => {
      let cellCls = 'apt-weekly-slot-cell';
      if (wd.dayOfWeek === 6) cellCls += ' apt-sat-cell';
      if (wd.isToday) cellCls += ' apt-today-cell';

      const slotKey = `${wd.dateStr}_${slot.time}`;
      const apts = aptBySlot[slotKey] || [];

      gridHtml += `
        <div class="${cellCls}"
             data-date="${wd.dateStr}"
             data-time="${slot.time}">
      `;

      // 予約カード（同一時間帯に複数名が入っても並列スタック表示）
      apts.forEach((apt) => {
        const p = getPatientById(apt.patientId);
        const pName = p ? p.name : apt.patientId;
        const staff = therapists.find((t) => t.id === apt.therapistId);
        let staffLabel = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '物療' : '指定無');
        if (staffLabel.length > 3) staffLabel = staffLabel.slice(0, 3);

        const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';
        const cardBg = isAnalgesia ? '#f0fdf4' : '#ffffff';
        const cardBorder = isAnalgesia ? '#86efac' : '#cbd5e1';
        const staffCol = staffColorMap[apt.therapistId] || '#0284c7';

        gridHtml += `
          <div class="apt-weekly-card ${isAnalgesia ? 'apt-card-analgesia' : ''}"
               draggable="true"
               data-apt-id="${apt.id}"
               style="background:${cardBg}; border:1px solid ${cardBorder}; border-left:4px solid ${staffCol};">
            <span class="apt-weekly-card-name" title="${sanitizeHtml(pName)} (${apt.patientId}) - ${apt.durationMinutes}分">
              ${sanitizeHtml(pName)}
            </span>
            <span class="apt-weekly-card-tag" style="background:${staffCol};">
              ${sanitizeHtml(staffLabel)}
            </span>
          </div>
        `;
      });

      gridHtml += `</div>`;
    });
  });

  gridContainer.innerHTML = gridHtml;

  // イベントバインド：ドラッグ＆ドロップ受け入れ & セルクリック & カード編集
  attachWeeklyGridEvents();
}

function attachWeeklyGridEvents() {
  const gridContainer = document.getElementById('aptWeeklyGrid');
  if (!gridContainer) return;

  const cells = gridContainer.querySelectorAll('.apt-weekly-slot-cell');
  const cards = gridContainer.querySelectorAll('.apt-weekly-card');

  // セルクリックで新規予約
  cells.forEach((cell) => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.apt-weekly-card')) return;
      const targetCell = e.target.closest('.apt-weekly-slot-cell');
      const date = targetCell?.dataset.date;
      const time = targetCell?.dataset.time;
      if (date && time) {
        openAppointmentModal(null, date, time);
      }
    });

    // ドラッグオーバー（ドロップ可能化）
    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      cell.classList.add('apt-drop-hover');
    });

    cell.addEventListener('dragenter', (e) => {
      e.preventDefault();
      cell.classList.add('apt-drop-hover');
    });

    cell.addEventListener('dragleave', (e) => {
      // 内部子要素への移動による誤消去を防止
      if (!cell.contains(e.relatedTarget)) {
        cell.classList.remove('apt-drop-hover');
      }
    });

    // ドロップ処理（重複予約防止ガード完全連動）
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cell.classList.remove('apt-drop-hover');

      const targetCell = e.target.closest('.apt-weekly-slot-cell');
      const targetDate = targetCell?.dataset.date;
      const targetTime = targetCell?.dataset.time;
      if (!targetDate || !targetTime) return;

      // 転送データの復元（activeDragPayload または dataTransfer から取得）
      let payload = activeDragPayload;
      if (!payload) {
        try {
          const raw = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('application/json');
          if (raw) payload = JSON.parse(raw);
        } catch (_) {}
      }

      if (!payload) return;

      try {
        // パターンA: パレットから患者をドロップした場合（重複ガード連動）
        if (payload.type === 'NEW_PATIENT') {
          const patient = getPatientById(payload.patientId);
          if (!patient) return;

          const isAnalgesia = patient.category === 'ANALGESIA' || patient.diseaseType === 'ANALGESIA';
          const defaultTherapist = isAnalgesia ? 'ANALGESIA' : 'A';
          const defaultTreatment = isAnalgesia ? 'ANALGESIA' : 'INDIVIDUAL';
          const defaultDuration = isAnalgesia ? 20 : 30;

          const res = upsertAppointment({
            patientId: patient.id,
            date: targetDate,
            startTime: targetTime,
            durationMinutes: defaultDuration,
            therapistId: defaultTherapist,
            treatmentType: defaultTreatment,
            notes: ''
          });

          if (res.success) {
            showToast(`${patient.name} 様を ${targetDate} ${targetTime} に配置しました`, 'success');
            renderAppointmentCalendarView();
          } else {
            // ★同一患者の二重予約を物理遮断し、明確なエラーメッセージを表示
            showToast(res.message || '予約の配置に失敗しました', 'error');
          }
        }
        // パターンB: 既存の予約カードを掴んで移動した場合（移動先での二重予約ガード連動）
        else if (payload.type === 'MOVE_APPOINTMENT') {
          const allApts = getAllAppointments();
          const targetApt = allApts[payload.aptId];
          if (targetApt) {
            const updatedApt = {
              ...targetApt,
              date: targetDate,
              startTime: targetTime
            };
            const res = upsertAppointment(updatedApt);
            if (res.success) {
              showToast(`予約を ${targetDate} ${targetTime} へ移動しました`, 'success');
              renderAppointmentCalendarView();
            } else {
              // 移動先で同一患者の別予約と重複した場合も安全に遮断
              showToast(res.message || '予約の移動に失敗しました', 'error');
            }
          }
        }
      } catch (err) {
        console.error('Drop error:', err);
      } finally {
        activeDragPayload = null;
      }
    });
  });

  // 既存予約カードのドラッグ開始 ＆ クリック編集
  cards.forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const aptId = card.dataset.aptId;
      const allApts = getAllAppointments();
      const targetApt = allApts[aptId];
      if (targetApt) {
        openAppointmentModal(targetApt);
      }
    });

    card.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      const aptId = card.dataset.aptId;
      const payload = { type: 'MOVE_APPOINTMENT', aptId };
      activeDragPayload = payload;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    card.addEventListener('dragend', () => {
      activeDragPayload = null;
      document.querySelectorAll('.apt-drop-hover').forEach((el) => el.classList.remove('apt-drop-hover'));
    });
  });
}

function initPaletteListeners() {
  const searchInput = document.getElementById('aptPaletteSearch');
  const sortSelect = document.getElementById('aptPaletteSortSelect');
  const catButtons = document.querySelectorAll('.apt-palette-cat-btn');

  searchInput?.addEventListener('input', () => renderPalette());

  sortSelect?.addEventListener('change', (e) => {
    paletteSortOrder = e.target.value;
    renderPalette();
  });

  catButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      catButtons.forEach((b) => {
        b.classList.remove('active');
        b.style.background = '#fff';
      });
      btn.classList.add('active');
      btn.style.background = '#e0f2fe';
      paletteFilterCat = btn.dataset.cat || 'ALL';
      renderPalette();
    });
  });
}

/**
 * 左側患者パレットの描画
 */
function renderPalette() {
  const container = document.getElementById('aptPalettePatientList');
  if (!container) return;

  const searchInput = document.getElementById('aptPaletteSearch');
  const keyword = (searchInput?.value || '').trim().toLowerCase();

  const allPatients = getAllPatients();
  let list = allPatients.filter((p) => p.status !== 'DISCONTINUED');

  // カテゴリ絞り込み
  if (paletteFilterCat !== 'ALL') {
    if (paletteFilterCat === 'ANALGESIA') {
      list = list.filter((p) => p.diseaseType === 'ANALGESIA');
    } else {
      list = list.filter((p) => p.category === paletteFilterCat);
    }
  }

  // 検索キーワード絞り込み
  if (keyword) {
    list = list.filter((p) =>
      p.id.toLowerCase().includes(keyword) ||
      p.name.toLowerCase().includes(keyword) ||
      (p.nameKana || '').toLowerCase().includes(keyword) ||
      (p.diseaseName || '').toLowerCase().includes(keyword)
    );
  }

  // ソート
  list.sort((a, b) => {
    if (paletteSortOrder === 'KANA') {
      return (a.nameKana || a.name).localeCompare(b.nameKana || b.name, 'ja');
    } else if (paletteSortOrder === 'ID') {
      return a.id.localeCompare(b.id, 'ja', { numeric: true });
    } else {
      // 区分順（外来 → 消炎 → 入院）
      const order = { OUTPATIENT: 1, ANALGESIA: 2, INPATIENT: 3 };
      const rankA = a.diseaseType === 'ANALGESIA' ? 2 : (order[a.category] || 9);
      const rankB = b.diseaseType === 'ANALGESIA' ? 2 : (order[b.category] || 9);
      if (rankA !== rankB) return rankA - rankB;
      return a.id.localeCompare(b.id, 'ja', { numeric: true });
    }
  });

  if (list.length === 0) {
    container.innerHTML = `<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:16px;">該当する患者がいません</div>`;
    return;
  }

  container.innerHTML = list.map((p) => {
    const isAnalgesia = p.diseaseType === 'ANALGESIA';
    const catClass = isAnalgesia ? 'cat-analgesia' : (p.category === 'INPATIENT' ? 'cat-inpatient' : 'cat-outpatient');
    const catBadge = isAnalgesia ? '消炎' : (p.category === 'INPATIENT' ? '入院' : '外来');

    return `
      <div class="apt-palette-item ${catClass}"
           draggable="true"
           data-patient-id="${p.id}">
        <div class="apt-palette-item-name">
          <span>${sanitizeHtml(p.name)}</span>
          <span style="font-size:0.65rem; color:#64748b; font-weight:normal;">${p.id}</span>
        </div>
        <div class="apt-palette-item-sub">
          [${catBadge}] ${sanitizeHtml(p.diseaseName || '疾患名未記入')}
        </div>
      </div>
    `;
  }).join('');

  // パレットアイテムのドラッグイベントバインド
  container.querySelectorAll('.apt-palette-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      const patientId = item.dataset.patientId;
      const payload = { type: 'NEW_PATIENT', patientId };
      activeDragPayload = payload;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'copy';
      }
    });

    item.addEventListener('dragend', () => {
      activeDragPayload = null;
      document.querySelectorAll('.apt-drop-hover').forEach((el) => el.classList.remove('apt-drop-hover'));
    });
  });
}

/**
 * 月間マンスリーカレンダーの描画（切替時のみ）
 */
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
  const todayStr = toDateString(new Date());

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
      <div class="${dayClass}" data-date="${dateStr}" title="ダブルクリックでこの週のタイムテーブルへ移動">
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

      gridHtml += `
        <div class="cal-apt-card" data-apt-id="${apt.id}" style="background:${isAnalgesia ? '#f0fdf4' : '#f8fafc'}; border:1px solid ${isAnalgesia ? '#86efac' : '#cbd5e1'}; border-left:4px solid ${staffCol};">
          <div class="cal-apt-time">
            <strong>${apt.startTime}</strong>
            <span class="cal-apt-staff" style="color:${staffCol};">${sanitizeHtml(staffLabel)}</span>
          </div>
          <div class="cal-apt-name" title="${sanitizeHtml(pName)}">${sanitizeHtml(pName)}</div>
        </div>
      `;
    });

    gridHtml += `</div></div>`;
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

  // モーダルバインド（＋ボタン）
  container.querySelectorAll('.btn-cal-add-day').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAppointmentModal(null, btn.dataset.date, '09:00');
    });
  });

  // モーダルバインド（予約カードクリックで編集）
  container.querySelectorAll('.cal-apt-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const allApts = getAllAppointments();
      const targetApt = allApts[card.dataset.aptId];
      if (targetApt) openAppointmentModal(targetApt);
    });
  });

  // ★日付マスのダブルクリックでその週の週間タイムテーブルへ即時ジャンプ
  container.querySelectorAll('.calendar-day-cell:not(.cal-empty)').forEach((cell) => {
    cell.addEventListener('dblclick', (e) => {
      // 予約カードや＋ボタン自体のクリック時はダブルクリック誤爆を回避
      if (e.target.closest('.cal-apt-card') || e.target.closest('.btn-cal-add-day')) return;

      const targetDateStr = cell.dataset.date;
      if (targetDateStr) {
        const [y, m, d] = targetDateStr.split('-').map(Number);
        if (y && m && d) {
          currentBaseDate = new Date(y, m - 1, d);
          switchToWeeklyMode();
          showToast(`📅 ${targetDateStr} の週間タイムテーブルへ移動しました`, 'info');
        }
      }
    });
  });
}

function initPrintListeners() {
  const btnPrint = document.getElementById('btnAptPrintWeekly');
  btnPrint?.addEventListener('click', () => {
    triggerPrintWeeklySheet();
  });
}

/**
 * 現場のバインダー用 A4週間予約シート（チェックリスト型）の即時印刷プレビュー
 */
function triggerPrintWeeklySheet() {
  const weekDays = getWeekDaysList(currentBaseDate);
  const startDate = weekDays[0].dateStr;
  const endDate = weekDays[5].dateStr;

  const allAppointments = getAllAppointments();
  const weekAptList = Object.values(allAppointments).filter(
    (apt) => apt.date >= startDate && apt.date <= endDate && apt.status !== 'CANCELLED'
  );

  const therapists = getAllTherapists();

  const printWindow = window.open('', '_blank', 'width=900,height=950');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました', 'warn');
    return;
  }

  let daysHtml = '';
  weekDays.forEach((wd) => {
    const dayApts = weekAptList
      .filter((a) => a.date === wd.dateStr)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    daysHtml += `
      <div style="margin-bottom:14px; page-break-inside:avoid;">
        <div style="background:#f1f5f9; padding:4px 8px; border-left:4px solid #0284c7; font-weight:800; font-size:0.85rem; display:flex; justify-content:space-between;">
          <span>■ ${wd.dateStr} (${wd.dayName}曜日)</span>
          <span>計 ${dayApts.length} 名</span>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:0.75rem; margin-top:4px;">
          <thead>
            <tr style="background:#f8fafc; border-bottom:1px solid #cbd5e1;">
              <th style="padding:4px; width:36px; text-align:center; border:1px solid #cbd5e1;">来院</th>
              <th style="padding:4px; width:70px; text-align:center; border:1px solid #cbd5e1;">時間</th>
              <th style="padding:4px; text-align:left; border:1px solid #cbd5e1;">患者氏名 (ID)</th>
              <th style="padding:4px; width:70px; text-align:center; border:1px solid #cbd5e1;">担当</th>
              <th style="padding:4px; width:80px; text-align:center; border:1px solid #cbd5e1;">種別/所要</th>
              <th style="padding:4px; text-align:left; border:1px solid #cbd5e1;">特記メモ</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (dayApts.length === 0) {
      daysHtml += `
        <tr>
          <td colspan="6" style="padding:6px; text-align:center; color:#94a3b8; border:1px solid #cbd5e1;">予約なし</td>
        </tr>
      `;
    } else {
      dayApts.forEach((apt) => {
        const p = getPatientById(apt.patientId);
        const pName = p ? p.name : apt.patientId;
        const staff = therapists.find((t) => t.id === apt.therapistId);
        const staffName = staff ? staff.name : (apt.therapistId === 'ANALGESIA' ? '物療' : '指定無');
        const endTime = calculateEndTime(apt.startTime, apt.durationMinutes);
        const treatType = apt.treatmentType === 'ANALGESIA' ? '消炎鎮痛' : '個別リハ';

        daysHtml += `
          <tr style="border-bottom:1px solid #cbd5e1;">
            <td style="padding:4px; text-align:center; border:1px solid #cbd5e1;">[　]</td>
            <td style="padding:4px; text-align:center; font-weight:700; border:1px solid #cbd5e1;">${apt.startTime}〜${endTime}</td>
            <td style="padding:4px; font-weight:700; border:1px solid #cbd5e1;">${sanitizeHtml(pName)} <span style="font-size:0.68rem; font-weight:normal; color:#64748b;">(${apt.patientId})</span></td>
            <td style="padding:4px; text-align:center; border:1px solid #cbd5e1;">${sanitizeHtml(staffName)}</td>
            <td style="padding:4px; text-align:center; border:1px solid #cbd5e1;">${treatType} (${apt.durationMinutes}分)</td>
            <td style="padding:4px; color:#475569; border:1px solid #cbd5e1;">${sanitizeHtml(apt.notes || '')}</td>
          </tr>
        `;
      });
    }

    daysHtml += `</tbody></table></div>`;
  });

  const printHtml = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>外来リハビリ週間予約表 (${startDate}〜${endDate})</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Meiryo", sans-serif; color: #0f172a; margin: 0; padding: 10px; }
        h1 { font-size: 1.15rem; margin: 0 0 4px 0; }
        .header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>外来リハビリテーション 週間予約表 (現場確認用)</h1>
        <div style="font-size:0.85rem; font-weight:700;">期間: ${startDate} (月) 〜 ${endDate} (土)</div>
      </div>
      ${daysHtml}
      <div style="font-size:0.7rem; color:#64748b; text-align:right; margin-top:8px;">
        発行日時: ${new Date().toLocaleString('ja-JP')} / reha-work-manager
      </div>
      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(printHtml);
  printWindow.document.close();
}
