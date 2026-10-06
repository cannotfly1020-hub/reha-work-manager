// js/views/modals/staffModal.js
// セラピストマスター設定モーダル制御層（スタッフ検索・追加・名称変更・休職退職管理・初期復帰）

import { sanitizeHtml } from '../../core/dataNormalizer.js';
import {
  getAllTherapists, addTherapist, updateTherapistSettings,
  saveAllTherapists, THERAPIST_STATUS
} from '../../store/therapistStore.js';
import { showToast } from '../exportView.js';

let onStaffUpdatedCallback = null;

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

  btnOpen?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    renderStaffSettingsFields();
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
    } else {
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
    saveAllTherapists(defaultList);
    renderStaffSettingsFields();
    showToast('セラピスト設定を初期デフォルトに戻しました', 'info');
    if (typeof onStaffUpdatedCallback === 'function') onStaffUpdatedCallback();
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

    updateTherapistSettings(updateMap);
    closeModal();
    showToast('セラピスト設定（名称・ステータス）を更新・保存しました', 'success');
    if (typeof onStaffUpdatedCallback === 'function') onStaffUpdatedCallback();
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
