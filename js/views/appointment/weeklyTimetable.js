// js/views/appointment/weeklyTimetable.js
// 外来予約の週間タイムテーブル
// ★空き行圧縮: 週内に有効予約が1件もない時刻行をスキップし、行高・フォントを拡大表示できる

import { sanitizeHtml } from '../../core/dataNormalizer.js';
import { getJapaneseHolidayName } from '../../core/holidayCalc.js';
import { formatDateYMD, getWeekDates } from '../../core/dateUtils.js';
import { TIME_SLOTS } from '../../config/appointmentSlots.js';
import { getPatientById } from '../../store/patientStore.js';
import { getAllTherapists } from '../../store/therapistStore.js';
import { getAllAppointments, upsertAppointment } from '../../store/appointmentStore.js';
import { openAppointmentModal } from '../modals/appointmentModal.js';
import { showToast } from '../../ui/toast.js';
import { calendarState } from './calendarState.js';
import { renderAppointmentCalendarView } from '../appointmentCalendarView.js';

/**
 * 予約の所要時間（分）が覆う開始時刻スロット列を返す（途中欠落防止）
 * 施設スロットは20分刻み前提。duration 未設定時は1コマ。
 * @param {string[]} allSlotTimes
 * @param {{ startTime?: string, durationMinutes?: number }} apt
 * @returns {string[]}
 */
export function getCoveredSlotTimes(allSlotTimes, apt) {
  const start = String(apt?.startTime || '');
  if (!start) return [];
  const startIdx = allSlotTimes.indexOf(start);
  const duration = Math.max(1, Number(apt?.durationMinutes) || 20);
  const slotCount = Math.max(1, Math.ceil(duration / 20));
  if (startIdx < 0) return [start];
  return allSlotTimes.slice(startIdx, startIdx + slotCount);
}

/**
 * その週の有効予約から「表示すべき時刻行」を抽出する。
 * compact=false のときは全 TIME_SLOTS を返す。
 * @param {Date} baseDate
 * @param {{ forceCompact?: boolean, appointments?: object }} [opts]
 * @returns {{ visibleSlots: string[], weekAptList: object[], weekDates: Date[] }}
 */
export function resolveVisibleWeekTimeSlots(baseDate, opts = {}) {
  const weekDates = getWeekDates(baseDate);
  const weekDatesSet = new Set(weekDates.map(formatDateYMD));
  const allAppointments = opts.appointments || getAllAppointments();
  const weekAptList = Object.values(allAppointments).filter((apt) => {
    return apt && apt.status !== 'CANCELLED' && weekDatesSet.has(apt.date);
  });

  const forceCompact = opts.forceCompact === true;
  const compact = forceCompact || calendarState.compactEmptyRows === true;

  if (!compact) {
    return { visibleSlots: [...TIME_SLOTS], weekAptList, weekDates };
  }

  const active = new Set();
  weekAptList.forEach((apt) => {
    getCoveredSlotTimes(TIME_SLOTS, apt).forEach((t) => active.add(t));
  });

  // 予約が1件もない週は、操作不能にならないよう全枠を残す
  const visibleSlots = TIME_SLOTS.filter((t) => active.has(t));
  return {
    visibleSlots: visibleSlots.length > 0 ? visibleSlots : [...TIME_SLOTS],
    weekAptList,
    weekDates
  };
}

export function renderWeeklyTimetable() {
  const gridEl = document.getElementById('aptWeeklyGrid');
  const rangeLabel = document.getElementById('aptCalendarWeekRangeLabel');
  const countBadge = document.getElementById('aptCalendarWeekCountBadge');
  if (!gridEl) return;

  const { visibleSlots, weekAptList, weekDates } = resolveVisibleWeekTimeSlots(calendarState.baseDate);
  const startStr = formatDateYMD(weekDates[0]);
  const endStr = formatDateYMD(weekDates[5]);
  const todayStr = formatDateYMD(new Date());
  const isCompact = calendarState.compactEmptyRows === true
    && visibleSlots.length < TIME_SLOTS.length;

  if (rangeLabel) {
    rangeLabel.textContent = `${startStr.replace(/-/g, '/')} (月) 〜 ${endStr.replace(/-/g, '/')} (土)`;
  }

  if (countBadge) {
    const rowHint = calendarState.compactEmptyRows
      ? `／ 表示 ${visibleSlots.length}/${TIME_SLOTS.length} 枠`
      : '';
    countBadge.textContent = `週間予約: 計 ${weekAptList.length} 件${rowHint}`;
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

  // 曜日ヘッダー（祝日の場合は赤色バッジとピンク背景で強調表示）
  weekDates.forEach((d, idx) => {
    const dateStr = formatDateYMD(d);
    const isToday = dateStr === todayStr;
    const isSat = d.getDay() === 6;
    const holidayName = getJapaneseHolidayName(d);
    const isHoliday = !!holidayName;

    let cls = 'apt-weekly-header';
    let headerStyle = '';

    if (isHoliday) {
      cls += ' apt-col-holiday';
      headerStyle = 'background:#fff1f2; color:#be123c; border-bottom:2px solid #f43f5e;';
    } else if (isSat) {
      cls += ' apt-col-sat';
    }
    if (isToday) {
      cls += ' apt-col-today';
    }

    const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
    const holidayBadgeHtml = isHoliday
      ? `<div style="font-size:0.62rem; font-weight:800; background:#ffe4e6; color:#e11d48; border:1px solid #fecdd3; border-radius:3px; padding:1px 3px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${sanitizeHtml(holidayName)}">${sanitizeHtml(holidayName)}</div>`
      : '';

    html += `
      <div class="${cls}" style="${headerStyle}">
        <div style="font-weight:800;">${dayNames[idx]}</div>
        <div style="font-size:0.7rem; font-weight:normal; opacity:0.85;">${mmdd}</div>
        ${holidayBadgeHtml}
      </div>
    `;
  });

  // 時間帯 × 曜日行（空き圧縮時は visibleSlots のみ）
  visibleSlots.forEach((slotTime) => {
    html += `<div class="apt-weekly-time-col">${slotTime}</div>`;

    weekDates.forEach((d) => {
      const dateStr = formatDateYMD(d);
      const isToday = dateStr === todayStr;
      const isSat = d.getDay() === 6;
      const holidayName = getJapaneseHolidayName(d);
      const isHoliday = !!holidayName;

      let cellCls = 'apt-weekly-slot-cell';
      let cellStyle = '';

      if (isHoliday) {
        cellCls += ' apt-holiday-cell';
        cellStyle = 'background:#fff5f5; border-left:1px dashed #fecdd3; border-right:1px dashed #fecdd3;';
      } else if (isSat) {
        cellCls += ' apt-sat-cell';
      }
      if (isToday) {
        cellCls += ' apt-today-cell';
      }

      const key = `${dateStr}_${slotTime}`;
      const aptsInSlot = slotAptMap[key] || [];

      html += `<div class="${cellCls}" data-date="${dateStr}" data-time="${slotTime}" data-is-holiday="${isHoliday ? 'true' : 'false'}" data-holiday-name="${holidayName || ''}" style="${cellStyle}">`;

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
  gridEl.classList.toggle('apt-weekly-compact', isCompact || (calendarState.compactEmptyRows === true && weekAptList.length > 0));

  setupWeeklyDragAndDrop(gridEl);
}

/**
 * 週間タイムテーブルのドラッグ＆ドロップ ＆ クリックイベント（祝日遮断ガード完備）
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
      calendarState.dragPayload = payload;
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      calendarState.dragPayload = null;
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
      const isHoliday = cell.dataset.isHoliday === 'true';
      if (isHoliday) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.dataTransfer.dropEffect = 'copy';
      cell.classList.add('apt-drop-hover');
    });

    cell.addEventListener('dragleave', (e) => {
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
      const isHoliday = targetCell.dataset.isHoliday === 'true';
      const holidayName = targetCell.dataset.holidayName;

      // ★祝日へのドロップを物理遮断
      if (isHoliday) {
        showToast(`⚠️ 祝日（${holidayName || '休診日'}）のため予約は配置できません`, 'error');
        calendarState.dragPayload = null;
        return;
      }

      let payload = calendarState.dragPayload;
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
        } else if (!res.storageFailed) {
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
          } else if (!res.storageFailed) {
            showToast(res.message || '移動先の時間帯が重複しています', 'error');
          }
        }
      }

      calendarState.dragPayload = null;
    });

    // セルの空き余白クリックで新規予約モーダルを開く（祝日の場合は物理遮断）
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.apt-weekly-card')) return;
      const isHoliday = cell.dataset.isHoliday === 'true';
      const holidayName = cell.dataset.holidayName;

      // ★祝日セルのクリックを物理遮断
      if (isHoliday) {
        showToast(`⚠️ 祝日（${holidayName || '休診日'}）のため外来予約は登録できません`, 'warn');
        return;
      }

      const date = cell.dataset.date;
      const time = cell.dataset.time;
      openAppointmentModal(null, date, time);
    });
  });
}
