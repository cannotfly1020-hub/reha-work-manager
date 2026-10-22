// js/views/modals/staffModal.js
// セラピストマスター設定モーダル制御層
// （スタッフ検索・追加・名称変更・休職退職管理・初期復帰 ＋ リハビリ助手1・2設定 ＋ 施設リハビリ提供時間設定・自動保存）

import { sanitizeHtml } from '../../core/dataNormalizer.js';
import {
  getAllTherapists, addTherapist, updateTherapistSettings,
  saveAllTherapists, THERAPIST_STATUS
} from '../../store/therapistStore.js';
import { showToast } from '../../ui/toast.js';
import { getAssistantSettings, saveAssistantSettings } from '../../store/assistantStore.js';
import {
  getSavedFacilityHours,
  saveFacilityHours,
  validateFacilityHours,
  formatFacilityHoursSummary,
  getAmSlotCount,
  getTotalSlotCount,
  DEFAULT_FACILITY_HOURS
} from '../../core/timeSlotGenerator.js';
import { reloadFacilityTimeSlots, AM_SLOT_COUNT, TOTAL_SLOT_COUNT } from '../../config/rules.js';
import { renderAppointmentCalendarView } from '../appointmentCalendarView.js';

let onStaffUpdatedCallback = null;

/**
 * フォームから施設時間オブジェクトを読み取る
 * @returns {{ amStart: string, amEnd: string, pmStart: string, pmEnd: string }}
 */
function readFacilityHoursFromForm() {
  return {
    amStart: document.getElementById('settingAmStartInput')?.value || '',
    amEnd: document.getElementById('settingAmEndInput')?.value || '',
    pmStart: document.getElementById('settingPmStartInput')?.value || '',
    pmEnd: document.getElementById('settingPmEndInput')?.value || ''
  };
}

/**
 * 保存済み（または引数）の施設時間をフォームへセット
 * @param {{ amStart?: string, amEnd?: string, pmStart?: string, pmEnd?: string }|null|undefined} [hours]
 */
function fillFacilityHoursForm(hours) {
  const h = hours || getSavedFacilityHours();
  const amStart = document.getElementById('settingAmStartInput');
  const amEnd = document.getElementById('settingAmEndInput');
  const pmStart = document.getElementById('settingPmStartInput');
  const pmEnd = document.getElementById('settingPmEndInput');
  if (amStart) amStart.value = h.amStart || DEFAULT_FACILITY_HOURS.amStart;
  if (amEnd) amEnd.value = h.amEnd || DEFAULT_FACILITY_HOURS.amEnd;
  if (pmStart) pmStart.value = h.pmStart || DEFAULT_FACILITY_HOURS.pmStart;
  if (pmEnd) pmEnd.value = h.pmEnd || DEFAULT_FACILITY_HOURS.pmEnd;
  updateFacilityHoursSlotSummaryBadge();
}

/**
 * リアルタイムバッジ更新（時刻入力の都度）
 */
function updateFacilityHoursSlotSummaryBadge() {
  const badge = document.getElementById('facilityHoursSlotSummaryBadge');
  if (!badge) return;
  const hours = readFacilityHoursFromForm();
  const summary = formatFacilityHoursSummary(hours);
  const check = validateFacilityHours(hours);
  badge.textContent = summary;
  badge.style.background = check.ok ? '#ecfdf5' : '#fef2f2';
  badge.style.color = check.ok ? '#065f46' : '#b91c1c';
  badge.style.borderColor = check.ok ? '#a7f3d0' : '#fecaca';
}

/**
 * 半日／終日プリセットの data-duration と option を現行コマ数に同期
 * （施設時間変更後もワンタッチ休暇が破綻しないようにする）
 * @param {{ amStart?: string, amEnd?: string, pmStart?: string, pmEnd?: string }|null|undefined} [hours]
 */
function syncLeavePresetDurations(hours) {
  const h = hours || getSavedFacilityHours();
  const half = getAmSlotCount(h) || AM_SLOT_COUNT || 12;
  const full = getTotalSlotCount(h) || TOTAL_SLOT_COUNT || 24;

  document.querySelectorAll('.btn-task-preset').forEach((btn) => {
    const title = btn.getAttribute('data-title') || '';
    if (title.includes('終日')) {
      btn.setAttribute('data-duration', String(full));
    } else if (title.includes('半日')) {
      btn.setAttribute('data-duration', String(half));
    }
  });

  const durationSelect = document.getElementById('slotTaskDurationSelect');
  if (durationSelect) {
    const halfOpt = durationSelect.querySelector('option[data-role="half-day"]');
    const fullOpt = durationSelect.querySelector('option[data-role="full-day"]');
    if (halfOpt) {
      halfOpt.value = String(half);
      halfOpt.textContent = `${half}コマ (半日ブロック・約${half * 20}分)`;
    }
    if (fullOpt) {
      fullOpt.value = String(full);
      fullOpt.textContent = `${full}コマ (終日ブロック・全日)`;
    }
  }
}

/**
 * 施設時間変更後に時間割・外来予約をリロードなしで再描画
 */
function refreshViewsAfterFacilityHoursChange() {
  if (typeof onStaffUpdatedCallback === 'function') {
    onStaffUpdatedCallback();
  }
  try {
    renderAppointmentCalendarView();
  } catch (e) {
    console.warn('[staffModal] renderAppointmentCalendarView soft-fail:', e);
  }
}

export function setupStaffSettingsModalListeners(onUpdate) {
  onStaffUpdatedCallback = onUpdate;

  const btnOpen = document.getElementById('btnOpenStaffSettings');
  const modal = document.getElementById('modalStaffSettings');
  const btnClose = document.getElementById('btnCloseStaffModal');
  const btnCloseX = document.getElementById('btnCloseStaffModalX');
  const btnReset = document.getElementById('btnResetStaffDefault');
  const form = document.getElementById('staffSettingsForm');
  const searchInput = document.getElementById('staffSearchInput');
  const btnAdd = document.getElementById('btnAddNewStaff');
  const newNameInput = document.getElementById('newStaffNameInput');
  const assistant1Input = document.getElementById('assistant1NameInput');
  const assistant2Input = document.getElementById('assistant2NameInput');

  const facilityTimeInputs = [
    document.getElementById('settingAmStartInput'),
    document.getElementById('settingAmEndInput'),
    document.getElementById('settingPmStartInput'),
    document.getElementById('settingPmEndInput')
  ];
  facilityTimeInputs.forEach((el) => {
    el?.addEventListener('input', updateFacilityHoursSlotSummaryBadge);
    el?.addEventListener('change', updateFacilityHoursSlotSummaryBadge);
  });

  // 起動時にも休暇プリセットを現行コマ数へ同期
  syncLeavePresetDurations(getSavedFacilityHours());

  btnOpen?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    renderStaffSettingsFields();

    // ★保存済みのリハビリ助手氏名をフォームに反映
    const assistants = getAssistantSettings();
    if (assistant1Input) assistant1Input.value = assistants.assistant1;
    if (assistant2Input) assistant2Input.value = assistants.assistant2;

    // ★保存済み施設リハビリ提供時間をフォームに反映
    fillFacilityHoursForm(getSavedFacilityHours());

    modal?.classList.add('active');
  });

  const closeModal = () => modal?.classList.remove('active');
  btnClose?.addEventListener('click', closeModal);
  btnCloseX?.addEventListener('click', closeModal);

  searchInput?.addEventListener('input', () => {
    renderStaffSettingsFields();
  });

  const handleAddNewStaff = () => {
    const name = newNameInput ? newNameInput.value.trim() : '';
    if (!name) {
      showToast('セラピスト氏名を入力してください', 'warn');
      newNameInput?.focus();
      return;
    }

    const res = addTherapist(name, THERAPIST_STATUS.ACTIVE);
    if (res.success) {
      showToast(res.message, 'success');
      if (newNameInput) newNameInput.value = '';
      renderStaffSettingsFields();
      if (typeof onStaffUpdatedCallback === 'function') onStaffUpdatedCallback();
    } else if (!res.storageFailed) {
      showToast('セラピストの追加に失敗しました', 'error');
    }
  };

  btnAdd?.addEventListener('click', handleAddNewStaff);
  newNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNewStaff();
    }
  });

  btnReset?.addEventListener('click', () => {
    const defaultList = [
      { id: 'A', name: 'PT A', color: '#0284c7', status: THERAPIST_STATUS.ACTIVE },
      { id: 'B', name: 'PT B', color: '#0d9488', status: THERAPIST_STATUS.ACTIVE },
      { id: 'C', name: 'PT C', color: '#7c3aed', status: THERAPIST_STATUS.ACTIVE }
    ];
    const staffReset = saveAllTherapists(defaultList);
    const assistantReset = saveAssistantSettings('', '');
    if (!staffReset || !assistantReset) return;
    if (assistant1Input) assistant1Input.value = '';
    if (assistant2Input) assistant2Input.value = '';

    // 施設時間も初期デフォルトへ戻す
    const hoursSave = saveFacilityHours({ ...DEFAULT_FACILITY_HOURS });
    if (hoursSave.success) {
      reloadFacilityTimeSlots(hoursSave.hours);
      fillFacilityHoursForm(hoursSave.hours);
      syncLeavePresetDurations(hoursSave.hours);
    }

    renderStaffSettingsFields();
    showToast('セラピスト・助手・施設時間を初期デフォルトに戻しました', 'info');
    refreshViewsAfterFacilityHoursChange();
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const updateMap = {};

    form.querySelectorAll('.staff-item-row').forEach((row) => {
      const tId = row.dataset.therapistId;
      const nameInput = row.querySelector('.staff-name-input');
      const statusSelect = row.querySelector('.staff-status-select');
      if (tId && nameInput && statusSelect) {
        updateMap[tId] = {
          name: nameInput.value.trim(),
          status: statusSelect.value
        };
      }
    });

    // ★施設時間: バリデーション → 保存 → メモリ即時更新（失敗時はスタッフ保存も中断）
    const facilityHours = readFacilityHoursFromForm();
    const hoursCheck = validateFacilityHours(facilityHours);
    if (!hoursCheck.ok) {
      showToast(hoursCheck.message, 'error');
      updateFacilityHoursSlotSummaryBadge();
      return;
    }
    const hoursSave = saveFacilityHours(hoursCheck.hours);
    if (!hoursSave.success) {
      showToast(hoursSave.message || '施設時間の保存に失敗しました', 'error');
      return;
    }
    const reloaded = reloadFacilityTimeSlots(hoursSave.hours);
    if (!reloaded.success) {
      showToast(reloaded.message || '施設時間の反映に失敗しました', 'error');
      return;
    }
    syncLeavePresetDurations(hoursSave.hours);

    const staffSaved = updateTherapistSettings(updateMap);

    const a1Val = assistant1Input ? assistant1Input.value.trim() : '';
    const a2Val = assistant2Input ? assistant2Input.value.trim() : '';
    const assistantSaved = saveAssistantSettings(a1Val, a2Val);
    if (!staffSaved || !assistantSaved) return;

    closeModal();
    showToast(
      `スタッフ設定を保存しました（施設時間: 午前${reloaded.am}／午後${reloaded.pm}＝計${reloaded.total}コマ）`,
      'success'
    );
    refreshViewsAfterFacilityHoursChange();
  });
}

export function renderStaffSettingsFields() {
  const activeContainer = document.getElementById('staffSettingsListContainer');
  const retiredContainer = document.getElementById('retiredStaffListContainer');
  const searchInput = document.getElementById('staffSearchInput');
  if (!activeContainer) return;

  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const allTherapists = getAllTherapists();

  const matchesKeyword = (t) => {
    if (!keyword) return true;
    return t.name.toLowerCase().includes(keyword) || t.id.toLowerCase().includes(keyword);
  };

  const currentStaffList = allTherapists.filter((t) => t.status !== THERAPIST_STATUS.RETIRED && matchesKeyword(t));
  const retiredStaffList = allTherapists.filter((t) => t.status === THERAPIST_STATUS.RETIRED && matchesKeyword(t));

  const buildRowHtml = (t) => {
    const isRetired = t.status === THERAPIST_STATUS.RETIRED;
    const isLeave = t.status === THERAPIST_STATUS.LEAVE;
    const statusBg = isRetired ? '#f1f5f9' : (isLeave ? '#fffbeb' : '#f0fdf4');
    const statusCol = isRetired ? '#64748b' : (isLeave ? '#b45309' : '#15803d');

    return `
      <div class="staff-item-row" data-therapist-id="${t.id}"
           style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:#fff; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px;">
        <div style="display:flex; align-items:center; gap:6px; min-width:56px;">
          <span style="width:10px; height:10px; border-radius:50%; background:${t.color || '#0284c7'}; display:inline-block;"></span>
          <strong style="font-size:0.82rem; color:#0f172a;">枠 ${t.id}</strong>
        </div>
        <div style="flex:1;">
          <input type="text" class="staff-name-input" value="${sanitizeHtml(t.name)}"
                 placeholder="セラピスト氏名"
                 style="width:100%; padding:5px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.82rem; font-weight:600;">
        </div>
        <div style="width:105px;">
          <select class="staff-status-select"
                  style="width:100%; padding:5px 6px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.78rem; font-weight:700; background:${statusBg}; color:${statusCol}; cursor:pointer;">
            <option value="${THERAPIST_STATUS.ACTIVE}" ${t.status === THERAPIST_STATUS.ACTIVE ? 'selected' : ''}>● 稼働中</option>
            <option value="${THERAPIST_STATUS.LEAVE}" ${t.status === THERAPIST_STATUS.LEAVE ? 'selected' : ''}>▲ 休職</option>
            <option value="${THERAPIST_STATUS.RETIRED}" ${t.status === THERAPIST_STATUS.RETIRED ? 'selected' : ''}>■ 退職</option>
          </select>
        </div>
      </div>
    `;
  };

  if (currentStaffList.length === 0) {
    activeContainer.innerHTML = `<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:12px;">該当するスタッフがいません</div>`;
  } else {
    activeContainer.innerHTML = currentStaffList.map(buildRowHtml).join('');
  }

  if (retiredContainer) {
    if (retiredStaffList.length === 0) {
      retiredContainer.innerHTML = `<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:8px;">退職・非表示スタッフはいません</div>`;
    } else {
      retiredContainer.innerHTML = retiredStaffList.map(buildRowHtml).join('');
    }
  }

  document.querySelectorAll('.staff-status-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === THERAPIST_STATUS.ACTIVE) {
        e.target.style.background = '#f0fdf4';
        e.target.style.color = '#15803d';
      } else if (val === THERAPIST_STATUS.LEAVE) {
        e.target.style.background = '#fffbeb';
        e.target.style.color = '#b45309';
      } else {
        e.target.style.background = '#f1f5f9';
        e.target.style.color = '#64748b';
      }
    });
  });
}
