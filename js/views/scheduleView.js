// js/views/scheduleView.js
// VIEW 1: 当日時間割（動的CSSグリッド・パレット並び替え・ドラッグ＆ドロップ・KPIストリップ・各モーダル連携・リファクタリング軽量版）

import { TIME_SLOTS, REHA_RULES } from '../config/rules.js';
import { sanitizeHtml, safeParseInt, normalizeToKatakana } from '../core/dataNormalizer.js';
import { getActiveTherapists } from '../store/therapistStore.js';
import { getPatientById, searchPatients } from '../store/patientStore.js';
import {
  getDailySchedule, moveScheduleSlot, getDailyStats,
  addAnalgesiaPatient, getAnalgesiaSlotPatients
} from '../store/scheduleStore.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';
import { validateTimeConflict } from '../core/validator.js';
import { showToast } from './exportView.js';

// 分割したモーダル制御モジュールのインポート
import { setupSlotModalListeners, openSlotModal } from './modals/slotModal.js';
import { setupStaffSettingsModalListeners } from './modals/staffModal.js';
import { setupAnalgesiaModalListeners, openAnalgesiaModal } from './modals/analgesiaModal.js';

function getLocalDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

let currentDateStr = getLocalDateStr();
let paletteCategory = 'ALL';
let paletteSortKey = 'CATEGORY'; // 'CATEGORY' | 'KANA' | 'ID'

export function initScheduleView() {
  const dateInput = document.getElementById('scheduleDateInput');
  const btnToday = document.getElementById('btnTodaySchedule');
  const searchInput = document.getElementById('paletteSearch');
  const sortSelect = document.getElementById('paletteSortSelect');

  if (dateInput) {
    dateInput.value = currentDateStr;
    dateInput.addEventListener('change', (e) => {
      currentDateStr = e.target.value;
      renderScheduleView();
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      currentDateStr = getLocalDateStr();
      if (dateInput) dateInput.value = currentDateStr;
      renderScheduleView();
    });
  }

  if (searchInput) searchInput.addEventListener('input', () => renderPatientPalette());

  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      paletteSortKey = e.target.value;
      renderPatientPalette();
    });
  }

  document.querySelectorAll('.palette-cat-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.palette-cat-btn').forEach((b) => b.classList.remove('active'));
      e.target.classList.add('active');
      paletteCategory = e.target.dataset.cat;
      renderPatientPalette();
    });
  });

  // 各モーダルのリスナーを初期化（更新時コールバックとして再描画関数を渡す）
  setupSlotModalListeners(renderScheduleView);
  setupStaffSettingsModalListeners(renderScheduleView);
  setupAnalgesiaModalListeners(renderScheduleView);
}

export function renderScheduleView() {
  renderDailyKPIStrip();
  renderPatientPalette();
  renderTimetableGrid();
}

function renderDailyKPIStrip() {
  const container = document.getElementById('dailyKpiStrip');
  if (!container) return;
  const stats = getDailyStats(currentDateStr);
  const aTot = stats.analgesia?.total || 0;
  container.innerHTML = `
    <span style="color:#0369a1;">個別リハ総単位: <strong>${stats.totalUnits}</strong> 単位</span>
    <span style="color:#059669;">患者数: <strong>${stats.totalPatients}</strong> 名</span>
    <span style="color:#16a34a; background:#dcfce7; padding:2px 8px; border-radius:4px;">消炎鎮痛: <strong>${aTot}</strong>名 (入${stats.analgesia?.inpatients || 0}/外${stats.analgesia?.outpatients || 0})</span>
    <span style="color:#854d0e;">計画書: <strong>${stats.planCount}</strong> 件</span>
  `;
}

function sortPalettePatients(list, sortKey) {
  return [...list].sort((a, b) => {
    if (sortKey === 'KANA') {
      const kanaA = normalizeToKatakana(a.nameKana || a.name || '');
      const kanaB = normalizeToKatakana(b.nameKana || b.name || '');
      return kanaA.localeCompare(kanaB, 'ja');
    }
    if (sortKey === 'ID') {
      return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
    }
    // デフォルト: CATEGORY (入院 → 外来 → 消炎)
    const getCatScore = (p) => {
      if (p.diseaseType === 'ANALGESIA') return 3;
      if (p.category === 'INPATIENT') return 1;
      return 2;
    };
    const diff = getCatScore(a) - getCatScore(b);
    if (diff !== 0) return diff;
    return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
  });
}

function renderPatientPalette() {
  const listEl = document.getElementById('palettePatientList');
  const searchInput = document.getElementById('paletteSearch');
  if (!listEl) return;

  const keyword = searchInput ? searchInput.value : '';
  const rawPatients = searchPatients(keyword, paletteCategory);

  if (rawPatients.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:16px;">該当する患者がいません</div>';
    return;
  }

  const patients = sortPalettePatients(rawPatients, paletteSortKey);

  listEl.innerHTML = patients
    .map((p) => {
      const isOut = p.category === 'OUTPATIENT';
      const borderCol = isOut ? 'var(--color-outpatient)' : 'var(--color-inpatient)';
      const disRule = REHA_RULES.LIMIT_DAYS[p.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
      const tagHtml = `<span style="font-size:0.65rem; font-weight:700; background:${disRule.tagBg}; color:${disRule.tagColor}; border:1px solid ${disRule.tagBorder}; padding:1px 4px; border-radius:3px;">${disRule.shortLabel}</span> `;

      return `
        <div class="patient-palette-card" draggable="true" data-patient-id="${p.id}"
             style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${borderCol}; border-radius:4px; padding:6px 8px; cursor:grab; font-size:0.78rem;">
          <div style="font-weight:700; display:flex; justify-content:space-between; align-items:center;">
            <div>${tagHtml}<span>${sanitizeHtml(p.name)}</span></div>
            <span style="font-size:0.7rem; color:#64748b;">${p.id}</span>
          </div>
          <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">${sanitizeHtml(p.diseaseName || '')}</div>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.patient-palette-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'NEW_PATIENT', patientId: e.currentTarget.dataset.patientId }));
      e.dataTransfer.setData('text/plain', e.currentTarget.dataset.patientId);
    });
  });
}

function buildSlotCardHtml(p, u, cellData, tId, slotId) {
  const isOut = p.category === 'OUTPATIENT';
  const cardClass = isOut ? 'card-outpatient' : 'card-inpatient';
  const disRule = REHA_RULES.LIMIT_DAYS[p.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
  const diseaseTag = `<span style="font-size:0.65rem; font-weight:700; background:${disRule.tagBg}; color:${disRule.tagColor}; border:1px solid ${disRule.tagBorder}; padding:1px 3px; border-radius:3px;">${disRule.shortLabel}</span>`;

  let planBadge = '';
  if (cellData.billingPlan) {
    const lbl = String(cellData.billingPlan).includes('PLAN_2') ? '📝計2' : '📝計画書';
    planBadge = `<span class="badge-plan" style="margin-left:2px;">${lbl}</span>`;
  }

  let earlyBadge = '';
  if (!isOut) {
    const dl = calculatePatientDeadlines(p, currentDateStr);
    if (dl.earlyBonus?.isEligible && dl.earlyBonus.shortLabel) {
      const isUrgent = dl.earlyBonus.remainingDays !== null && dl.earlyBonus.remainingDays <= 3;
      const bBg = isUrgent ? '#fef3c7' : '#ecfdf5';
      const bCol = isUrgent ? '#b45309' : '#047857';
      const bBorder = isUrgent ? '#f59e0b' : '#10b981';
      earlyBadge = `<span style="font-size:0.63rem; font-weight:700; background:${bBg}; color:${bCol}; border:1px solid ${bBorder}; padding:1px 4px; border-radius:3px; margin-left:3px;" title="${dl.earlyBonus.shortLabel}">${dl.earlyBonus.shortLabel}</span>`;
    }
  }

  return `
    <div class="cell-slot">
      <div class="reha-slot-card ${cardClass} card-unit-${u}" draggable="true" data-therapist="${tId}" data-slot="${slotId}" style="cursor:grab;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${diseaseTag}<span style="font-weight:700; font-size:0.8rem;">${sanitizeHtml(p.name)}</span>
          </div>
          <div style="display:flex; align-items:center; flex-shrink:0;">
            <span class="badge-unit badge-unit-${u}">${u}単位</span>${planBadge}${earlyBadge}
          </div>
        </div>
        <div style="font-size:0.68rem; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
          ${sanitizeHtml(cellData.note || p.diseaseName || '')}
        </div>
      </div>
    </div>`;
}

function renderTimetableGrid() {
  const gridEl = document.getElementById('timetableGrid');
  if (!gridEl) return;

  const therapists = getActiveTherapists();
  const schedule = getDailySchedule(currentDateStr);
  const therapistCount = therapists.length;

  gridEl.style.display = 'grid';
  gridEl.style.gridTemplateColumns = `88px repeat(${therapistCount}, minmax(130px, 1fr)) 100px`;
  gridEl.style.overflowX = 'auto';

  let html = '<div class="timetable-header">時間帯</div>';
  therapists.forEach((t) => {
    html += `<div class="timetable-header">${sanitizeHtml(t.name)}</div>`;
  });
  html += '<div class="timetable-header" style="background:#f0fdf4; color:#166534;">消炎鎮痛</div>';

  const coveredUntil = {};
  therapists.forEach((t) => {
    coveredUntil[t.id] = 0;
  });

  TIME_SLOTS.forEach((slot, index) => {
    const rowGridStyle = `display:contents;`;
    html += `<div class="time-slot-row" style="${rowGridStyle}"><div class="time-col">${slot.label}</div>`;

    therapists.forEach((t) => {
      const tId = t.id;
      const cellData = schedule[tId]?.[slot.id];

      if (coveredUntil[tId] > index) {
        html += `<div class="cell-slot slot-covered-placeholder"></div>`;
        return;
      }

      if (cellData && cellData.patientId) {
        const p = getPatientById(cellData.patientId) || { name: '未登録', category: 'OUTPATIENT', diseaseType: 'LOCOMOTIVE' };
        const u = Math.min(4, Math.max(1, safeParseInt(cellData.units, 1)));
        coveredUntil[tId] = index + u;
        html += buildSlotCardHtml(p, u, cellData, tId, slot.id);
      } else {
        html += `<div class="cell-slot" data-therapist="${tId}" data-slot="${slot.id}"><button class="empty-slot-btn" data-therapist="${tId}" data-slot="${slot.id}">＋ 追加</button></div>`;
      }
    });

    const aPatients = getAnalgesiaSlotPatients(currentDateStr, slot.id);
    const aCount = aPatients.length;
    let bHtml = `<button class="badge-analgesia-count" data-analgesia-slot="${slot.id}" style="color:#94a3b8; font-size:0.75rem;">＋</button>`;
    if (aCount > 0) {
      const inC = aPatients.filter((p) => p.category === 'INPATIENT').length;
      bHtml = `<button class="badge-analgesia-count has-patients" data-analgesia-slot="${slot.id}"><span style="font-weight:800; font-size:0.85rem; color:#15803d;">${aCount}名</span><span style="font-size:0.65rem; color:#64748b; margin-left:4px;">入${inC}/外${aCount - inC}</span></button>`;
    }
    html += `<div class="cell-slot analgesia-slot-cell" data-analgesia-drop="${slot.id}">${bHtml}</div></div>`;
  });

  gridEl.innerHTML = html;
  attachGridEventListeners(gridEl);
}

function attachGridEventListeners(gridEl) {
  gridEl.querySelectorAll('.empty-slot-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSlotModal(btn.dataset.therapist, btn.dataset.slot, null);
    });
  });

  gridEl.querySelectorAll('.reha-slot-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const tId = card.dataset.therapist;
      const sId = card.dataset.slot;
      openSlotModal(tId, sId, getDailySchedule(currentDateStr)[tId]?.[sId]);
    });
    card.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      const moveData = { type: 'MOVE_SLOT', fromTherapist: card.dataset.therapist, fromSlot: card.dataset.slot };
      e.dataTransfer.setData('application/json', JSON.stringify(moveData));
      e.dataTransfer.setData('text/plain', card.dataset.therapist + ':' + card.dataset.slot);
    });
  });

  gridEl.querySelectorAll('.cell-slot[data-therapist]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetTId = cell.dataset.therapist;
      const targetSId = cell.dataset.slot;
      if (!targetTId || !targetSId) return;

      let rawData = null;
      try {
        rawData = JSON.parse(e.dataTransfer.getData('application/json'));
      } catch (_) {}

      if (rawData?.type === 'MOVE_SLOT') {
        const { fromTherapist, fromSlot } = rawData;
        if (fromTherapist === targetTId && fromSlot === targetSId) return;

        const sched = getDailySchedule(currentDateStr);
        if (sched[targetTId]?.[targetSId]) {
          showToast('移動先の時間枠にはすでに患者が配置されています', 'warn');
          return;
        }

        const sourceItem = sched[fromTherapist]?.[fromSlot];
        if (!sourceItem) return;

        const units = sourceItem.units || 1;
        const confCheck = validateTimeConflict(sched, targetTId, targetSId, sourceItem.patientId, units, fromSlot);
        if (!confCheck.valid) {
          showToast(confCheck.message, 'error');
          return;
        }

        moveScheduleSlot(currentDateStr, fromTherapist, fromSlot, targetTId, targetSId);
        showToast('コマを移動しました', 'success');

        // ★ドラッグ移動後の最新確定データを当日バックアップファイルへ自動上書きトリガー
        if (typeof window.triggerDailyBackup === 'function') {
          window.triggerDailyBackup();
        }

        renderScheduleView();
        return;
      }

      const patientId = rawData?.patientId || e.dataTransfer.getData('text/plain');
      if (patientId && !patientId.includes(':')) {
        openSlotModal(targetTId, targetSId, { patientId, units: 1, note: '', billingPlan: '' });
      }
    });
  });

  gridEl.querySelectorAll('.badge-analgesia-count').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openAnalgesiaModal(b.dataset.analgesiaSlot);
    });
  });

  gridEl.querySelectorAll('.cell-slot[data-analgesia-drop]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      let pId = e.dataTransfer.getData('text/plain');
      try {
        const d = JSON.parse(e.dataTransfer.getData('application/json'));
        if (d?.patientId) pId = d.patientId;
      } catch (_) {}
      const sId = cell.dataset.analgesiaDrop;
      if (pId && sId && !pId.includes(':')) {
        addAnalgesiaPatient(currentDateStr, sId, pId);
        showToast('消炎鎮痛に患者を追加しました', 'success');

        // ★消炎鎮痛追加後の最新確定データを当日バックアップファイルへ自動上書きトリガー
        if (typeof window.triggerDailyBackup === 'function') {
          window.triggerDailyBackup();
        }

        renderScheduleView();
      }
    });
  });
}
