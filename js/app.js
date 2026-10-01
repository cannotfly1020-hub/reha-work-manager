/**
 * @file app.js
 * @description リハビリ業務管理Webアプリ（reha-work-manager）メインコントローラー
 * 
 * - コマ保存・時間割再描画（renderTimetable）の安全性を徹底強化（画面反映ストップを完全解消）
 * - 疾患名（diseaseName）および介護保険区分（careInsuranceType）の画面即時反映
 * - 要介護者の「総合実施計画書料2 移行日（3分の1経過日）」自動計算
 * - 本日の収益 ＆ 当月累計収益リアルタイムダッシュボード（1点＝10円）
 * - 同時間帯重複防止・患者1日上限・月13単位制限ガード
 */

import { REHA_RULES } from './config/rules.js';
import { calculatePatientDeadlines, formatDate, getDiffDays, normalizeDate, getOneThirdDays } from './core/deadlineCalc.js';
import { normalizePatientId, normalizeString } from './core/dataNormalizer.js';
import { exportUketsukeSubmissionWorkbook } from './excel/uketsukeWriter.js';
import { exportDiaryWorkbook } from './excel/diaryWriter.js';
import { getAllPatients, upsertPatient } from './store/patientStore.js';
import { getAllLoans, registerLoan, markAsReturned, deleteLoan } from './store/loanStore.js';
import {
  TIME_SLOTS,
  getAllSchedules,
  getDailySchedule,
  setScheduleSlot,
  clearScheduleSlot,
  getDailyStats,
  aggregateFromAppSchedule,
} from './store/scheduleStore.js';

/**
 * 患者が月13単位制限（算定日数上限超過・要介護/要支援・個別制限）の対象か判定
 */
function isPatientRestrictedTo13Units(patient, dateObj) {
  if (!patient) return false;
  if (patient.isLimitExempt) return false;

  const careType = patient.careInsuranceType || (patient.category?.includes('maintenance') ? 'CARE' : 'NONE');
  if (careType === 'CARE' || careType === 'SUPPORT') {
    return true;
  }

  if (patient.is13UnitLimited) {
    return true;
  }

  try {
    const deadlines = calculatePatientDeadlines(patient, dateObj);
    if (deadlines && deadlines.isOverLimit) {
      return true;
    }
  } catch (err) {
    console.warn('[app.js] calculatePatientDeadlines error:', err);
  }

  return false;
}

/**
 * 患者の1日あたりの算定上限単位数を取得（原則6単位、発症14日以内の脳血管/廃用は9単位）
 */
function getPatientDailyMaxUnits(patient, dateObj) {
  if (!patient) return 6;
  const dType = patient.diseaseType || 'LOCOMOTIVE';

  if (dType === 'CEREBROVASCULAR' || dType === 'DISUSE') {
    const onsetOrAdmin = normalizeDate(patient.onsetDate) || normalizeDate(patient.admissionDate);
    if (onsetOrAdmin) {
      const elapsedDays = getDiffDays(onsetOrAdmin, normalizeDate(dateObj)) + 1;
      if (elapsedDays >= 1 && elapsedDays <= 14) {
        return 9;
      }
    }
  }

  return 6;
}

/**
 * 特定日において、該当患者が全セラピストで合計何単位取得しているか算出
 */
function getPatientUnitsOnDate(dateStr, patientId, excludeTherapist = null, excludeSlotId = null) {
  const normId = normalizePatientId(patientId);
  const schedule = getDailySchedule(dateStr);
  let total = 0;

  for (const tCode of ['A', 'B', 'C']) {
    const slots = schedule[tCode] || {};
    for (const [sId, slot] of Object.entries(slots)) {
      if (!slot || !slot.patientId || slot.units <= 0) continue;
      if (excludeTherapist && excludeSlotId && tCode === excludeTherapist && sId === excludeSlotId) {
        continue;
      }
      if (normalizePatientId(slot.patientId) === normId) {
        total += Number(slot.units) || 0;
      }
    }
  }

  return total;
}

/**
 * 同一時間帯に他のセラピストで既に同じ患者が配置されていないか重複検証（ダブルブッキング防止）
 */
function validatePatientTimeConflict(dateStr, targetTherapist, targetSlotId, patientId, newUnits, origTherapist = null, origSlotId = null) {
  const normId = normalizePatientId(patientId);
  const patient = getAllPatients().find((p) => normalizePatientId(p.id) === normId);
  const pName = patient?.name || String(patientId).toUpperCase();

  const targetIdx = TIME_SLOTS.findIndex((s) => s.id === targetSlotId);
  if (targetIdx === -1) return true;

  const targetSlot = TIME_SLOTS[targetIdx];
  const targetCoveredSlotIds = new Set();
  for (let i = 0; i < newUnits; i++) {
    const s = TIME_SLOTS[targetIdx + i];
    if (s && s.period === targetSlot.period) {
      targetCoveredSlotIds.add(s.id);
    }
  }

  const schedule = getDailySchedule(dateStr);

  for (const tCode of ['A', 'B', 'C']) {
    const slots = schedule[tCode] || {};
    for (let idx = 0; idx < TIME_SLOTS.length; idx++) {
      const slot = TIME_SLOTS[idx];
      const slotData = slots[slot.id];
      if (!slotData || !slotData.patientId || slotData.units <= 0) continue;

      if (origTherapist && origSlotId && tCode === origTherapist && slot.id === origSlotId) {
        continue;
      }

      if (normalizePatientId(slotData.patientId) === normId) {
        const occupiedCount = Math.max(1, Number(slotData.units) || 1);
        for (let u = 0; u < occupiedCount; u++) {
          const occSlot = TIME_SLOTS[idx + u];
          if (occSlot && occSlot.period === slot.period && targetCoveredSlotIds.has(occSlot.id)) {
            const conflictTime = occSlot.time;
            showToast(
              `⚠️【重複エラー】${pName} 様は、同時間帯（${conflictTime}）に既に PT ${tCode} でリハビリが予定されています。重複配置はできません。`,
              'error'
            );
            return false;
          }
        }
      }
    }
  }

  return true;
}

/**
 * 患者の1日算定上限（6単位または9単位）の検証
 */
function validatePatientDailyUnitsLimit(dateStr, patientId, newUnits, origTherapist = null, origSlotId = null) {
  const normId = normalizePatientId(patientId);
  const patient = getAllPatients().find((p) => normalizePatientId(p.id) === normId);
  const pName = patient?.name || String(patientId).toUpperCase();
  const dateObj = new Date(dateStr);

  const maxAllowed = getPatientDailyMaxUnits(patient, dateObj);
  const currentDaily = getPatientUnitsOnDate(dateStr, patientId, origTherapist, origSlotId);
  const projectedTotal = currentDaily + newUnits;

  if (projectedTotal > maxAllowed) {
    const diseaseName = patient?.diseaseType === 'CEREBROVASCULAR' ? '脳血管疾患' : patient?.diseaseType === 'DISUSE' ? '廃用症候群' : '運動器等';
    showToast(
      `⚠️【1日上限エラー】${pName} 様（${diseaseName}）の1日算定上限は ${maxAllowed}単位 です。本日現在 ${currentDaily}単位 のため、${newUnits}単位を追加すると上限を超過 (${projectedTotal}単位) します。`,
      'error'
    );
    return false;
  }

  return true;
}

/**
 * コマ配置時に月13単位制限を超過しないかバリデーション検証
 */
function validateMonthly13UnitsLimit(dateStr, therapistCode, slotId, patientId, newUnits, isEditMode = false) {
  const normId = normalizePatientId(patientId);
  const patient = getAllPatients().find((p) => normalizePatientId(p.id) === normId);
  if (!patient) return true;

  const dateObj = new Date(dateStr);
  const isRestricted = isPatientRestrictedTo13Units(patient, dateObj);
  if (!isRestricted) {
    return true;
  }

  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;
  const aggregated = aggregateFromAppSchedule(year, month);
  let currentMonthUnits = aggregated.patientTotals[normId]?.totalUnits || 0;

  if (isEditMode) {
    const schedule = getDailySchedule(dateStr);
    const existingSlot = schedule[therapistCode]?.[slotId];
    if (existingSlot && normalizePatientId(existingSlot.patientId) === normId) {
      currentMonthUnits -= (Number(existingSlot.units) || 0);
    }
  }

  const projectedTotal = currentMonthUnits + newUnits;
  if (projectedTotal > 13) {
    const pName = patient.name || String(patientId).toUpperCase();
    showToast(
      `⚠【13単位制限エラー】${pName} 様は月13単位上限の対象です。当月現在 ${currentMonthUnits}単位のため、${newUnits}単位を追加すると13単位を超過 (${projectedTotal}単位) します。配置できません。`,
      'error'
    );
    return false;
  }

  return true;
}

/**
 * 指定週のセラピスト実施単位数を集計
 */
function getTherapistWeeklyUnits(dateStr, therapistCode) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  const allSchedules = getAllSchedules();
  let weeklyTotal = 0;

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const curStr = formatDate(cur);
    const daySchedule = allSchedules[curStr]?.[therapistCode] || {};

    for (const slot of Object.values(daySchedule)) {
      if (slot && slot.units > 0 && slot.patientId) {
        weeklyTotal += Number(slot.units) || 0;
      }
    }
  }

  return weeklyTotal;
}

/**
 * セラピストの人員基準上限（1日18単位/特例24単位、週108単位）の検証
 */
function validateTherapistWorkloadLimit(dateStr, therapistCode, newUnits, origTherapist = null, origSlotId = null) {
  const dailyStats = getDailyStats(dateStr);
  let currentDaily = dailyStats.therapistStats[therapistCode]?.totalUnits || 0;

  if (origTherapist === therapistCode && origSlotId) {
    const schedule = getDailySchedule(dateStr);
    const origSlot = schedule[origTherapist]?.[origSlotId];
    if (origSlot) currentDaily -= (Number(origSlot.units) || 0);
  }

  const projectedDaily = currentDaily + newUnits;

  if (projectedDaily > 24) {
    showToast(
      `⚠️【人員基準エラー】PT ${therapistCode} の本日の実施単位が24単位を超過 (${projectedDaily}単位) します。法令上の1日最大特例上限（24単位）を超えるため配置できません。`,
      'error'
    );
    return false;
  }

  if (projectedDaily > 18) {
    showToast(
      `ℹ️【注意】PT ${therapistCode} は本日標準上限（18単位）を超えて ${projectedDaily}単位 となります（特例枠内）。`,
      'warning'
    );
  }

  const currentWeekly = getTherapistWeeklyUnits(dateStr, therapistCode);
  const projectedWeekly = currentWeekly + newUnits;
  if (projectedWeekly > 108) {
    showToast(
      `⚠️【人員基準警告】PT ${therapistCode} は今週の実施単位が週108単位を超過 (${projectedWeekly}/108単位) します。過重業務および人員基準にご注意ください。`,
      'warning'
    );
  }

  return true;
}

// 起動時の初期日付
const initialToday = new Date();
const initialTodayStr = formatDate(initialToday);

const state = {
  currentTab: 'view-daily-schedule',
  selectedDate: initialTodayStr,
  targetYear: initialToday.getFullYear(),
  targetMonth: initialToday.getMonth() + 1,
  paletteFilter: 'ALL',
  paletteSearchTerm: '',
  paletteKanaFilter: 'ALL',
  activeSlotModal: null,
  draggedPatientId: null,
};

document.addEventListener('DOMContentLoaded', () => {
  try {
    initNavigationTabs();
    initDateControls();
    initPaletteFiltersAndSearch();
    initSlotEditModal();
    initPatientMasterModal();
    initLoanModal();
    initMonthlyViews();
    initExportActionButtons();

    updateYearMonthFromSelectedDate();
    renderAll();
  } catch (err) {
    console.error('[DOMContentLoaded] 起動時エラー:', err);
  }
});

function renderAll() {
  try { renderPalette(); } catch (e) { console.error('renderPalette error:', e); }
  try { renderTimetable(); } catch (e) { console.error('renderTimetable error:', e); }
  try { renderDailyKPIs(); } catch (e) { console.error('renderDailyKPIs error:', e); }
  try { renderMonthlyUnitsTable(); } catch (e) { console.error('renderMonthlyUnitsTable error:', e); }
  try { renderDailyDiaryPreview(); } catch (e) { console.error('renderDailyDiaryPreview error:', e); }
  try { renderRevenueDashboard(); } catch (e) { console.error('renderRevenueDashboard error:', e); }
  try { renderPatientDeadlines(); } catch (e) { console.error('renderPatientDeadlines error:', e); }
  try { renderLoansTable(); } catch (e) { console.error('renderLoansTable error:', e); }
}

function initNavigationTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.view-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target;
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
      state.currentTab = targetId;

      if (targetId === 'view-daily-schedule') {
        renderTimetable();
        renderDailyKPIs();
      } else if (targetId === 'view-monthly-units') {
        renderMonthlyUnitsTable();
        renderDailyDiaryPreview();
        renderRevenueDashboard();
      } else if (targetId === 'view-patients') {
        renderPatientDeadlines();
      } else if (targetId === 'view-equipment') {
        renderLoansTable();
      }
    });
  });
}

function initDateControls() {
  const dateInput = document.getElementById('schedule-target-date');
  const btnPrev = document.getElementById('btn-prev-day');
  const btnNext = document.getElementById('btn-next-day');
  const btnToday = document.getElementById('btn-today');

  if (dateInput) {
    dateInput.value = state.selectedDate;
    dateInput.addEventListener('change', (e) => {
      state.selectedDate = e.target.value;
      updateYearMonthFromSelectedDate();
      renderAll();
    });
  }

  btnPrev?.addEventListener('click', () => {
    const cur = new Date(state.selectedDate);
    cur.setDate(cur.getDate() - 1);
    state.selectedDate = formatDate(cur);
    if (dateInput) dateInput.value = state.selectedDate;
    updateYearMonthFromSelectedDate();
    renderAll();
  });

  btnNext?.addEventListener('click', () => {
    const cur = new Date(state.selectedDate);
    cur.setDate(cur.getDate() + 1);
    state.selectedDate = formatDate(cur);
    if (dateInput) dateInput.value = state.selectedDate;
    updateYearMonthFromSelectedDate();
    renderAll();
  });

  btnToday?.addEventListener('click', () => {
    const today = new Date();
    state.selectedDate = formatDate(today);
    if (dateInput) dateInput.value = state.selectedDate;
    updateYearMonthFromSelectedDate();
    renderAll();
  });
}

function updateYearMonthFromSelectedDate() {
  const d = new Date(state.selectedDate);
  state.targetYear = d.getFullYear();
  state.targetMonth = d.getMonth() + 1;

  const yearSelect = document.getElementById('monthly-target-year');
  const monthSelect = document.getElementById('monthly-target-month');
  if (yearSelect) yearSelect.value = String(state.targetYear);
  if (monthSelect) monthSelect.value = String(state.targetMonth);
}

function initPaletteFiltersAndSearch() {
  const segButtons = document.querySelectorAll('.segment-btn');
  segButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      segButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.paletteFilter = btn.dataset.filter;
      renderPalette();
    });
  });

  const searchInput = document.getElementById('patient-palette-search');
  const clearBtn = document.getElementById('btn-clear-palette-search');

  searchInput?.addEventListener('input', (e) => {
    state.paletteSearchTerm = normalizeString(e.target.value).toLowerCase();
    renderPalette();
  });

  clearBtn?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      state.paletteSearchTerm = '';
      renderPalette();
    }
  });

  const kanaChips = document.querySelectorAll('.kana-chip');
  kanaChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      kanaChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.paletteKanaFilter = chip.dataset.kana;
      renderPalette();
    });
  });

  const btnQuickAdd = document.getElementById('btn-quick-add-patient');
  btnQuickAdd?.addEventListener('click', () => {
    openPatientMasterModal();
  });
}

function matchesKanaGroup(kana, group) {
  if (!kana || group === 'ALL') return true;
  const first = kana.trim().charAt(0);
  const groups = {
    'ア': ['あ', 'い', 'う', 'え', 'お', 'ア', 'イ', 'ウ', 'エ', 'オ'],
    'カ': ['か', 'き', 'く', 'け', 'こ', 'が', 'ぎ', 'ぐ', 'げ', 'ご', 'カ', 'キ', 'ク', 'ケ', 'コ'],
    'サ': ['さ', 'し', 'す', 'せ', 'そ', 'ざ', 'じ', 'ず', 'ぜ', 'ぞ', 'サ', 'シ', 'ス', 'セ', 'ソ'],
    'タ': ['た', 'ち', 'つ', 'て', 'と', 'だ', 'ぢ', 'づ', 'で', 'ど', 'タ', 'チ', 'ツ', 'テ', 'ト'],
    'ナ': ['な', 'に', 'ぬ', 'ね', 'の', 'ナ', 'ニ', 'ヌ', 'ネ', 'ノ'],
    'ハ': ['は', 'ひ', 'ふ', 'へ', 'ほ', 'ば', 'び', 'ぶ', 'べ', 'ぼ', 'ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ', 'ハ', 'ヒ', 'フ', 'ヘ', 'ホ'],
    'マ': ['ま', 'み', 'む', 'め', 'も', 'マ', 'ミ', 'ム', 'メ', 'モ'],
    'ヤ': ['や', 'ゆ', 'よ', 'ヤ', 'ユ', 'ヨ'],
    'ラ': ['ら', 'り', 'る', 'れ', 'ろ', 'ラ', 'リ', 'ル', 'レ', 'ロ'],
    'ワ': ['わ', 'を', 'ん', 'ワ', 'ヲ', 'ン'],
  };
  return groups[group] ? groups[group].includes(first) : true;
}

function renderPalette() {
  const container = document.getElementById('patient-palette-list');
  if (!container) return;

  const all = getAllPatients();
  let inpCount = 0;
  let outCount = 0;

  all.forEach((p) => {
    const isOut = p.category && p.category.startsWith('outpatient');
    if (isOut) outCount++;
    else inpCount++;
  });

  const badgeAll = document.getElementById('badge-count-all');
  const badgeIn = document.getElementById('badge-count-inpatient');
  const badgeOut = document.getElementById('badge-count-outpatient');
  if (badgeAll) badgeAll.textContent = String(all.length);
  if (badgeIn) badgeIn.textContent = String(inpCount);
  if (badgeOut) badgeOut.textContent = String(outCount);

  const filtered = all.filter((p) => {
    const isOut = p.category && p.category.startsWith('outpatient');
    if (state.paletteFilter === 'INPATIENT' && isOut) return false;
    if (state.paletteFilter === 'OUTPATIENT' && !isOut) return false;

    if (state.paletteKanaFilter !== 'ALL') {
      const match = matchesKanaGroup(p.kana || p.name, state.paletteKanaFilter);
      if (!match) return false;
    }

    if (state.paletteSearchTerm) {
      const term = state.paletteSearchTerm;
      const targetStr = `${p.id} ${p.name || ''} ${p.kana || ''} ${p.diseaseName || ''}`.toLowerCase();
      if (!targetStr.includes(term)) return false;
    }

    return true;
  });

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: span 2; padding: 1.5rem; text-align: center; color: var(--text-dim); font-size: 0.8rem;">該当する患者が見つかりません</div>`;
    return;
  }

  filtered.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'patient-palette-card';
    card.draggable = true;
    card.dataset.patientId = p.id;

    const isOut = p.category && p.category.startsWith('outpatient');
    const tagClass = isOut ? 'tag-outpatient' : 'tag-inpatient';
    const tagLabel = isOut ? '外来' : '入院';
    const displayPId = String(p.id).toUpperCase();

    card.innerHTML = `
      <div class="palette-card-top">
        <span class="palette-patient-badge">${displayPId}</span>
        <span class="palette-category-tag ${tagClass}">${tagLabel}</span>
      </div>
      <div class="palette-patient-name" title="${p.name || p.id}">${p.name || `患者${displayPId}`}</div>
    `;

    card.addEventListener('dragstart', (e) => {
      state.draggedPatientId = p.id;
      e.dataTransfer.setData('text/plain', p.id);
      e.dataTransfer.effectAllowed = 'copy';
      card.style.opacity = '0.5';
    });

    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
      state.draggedPatientId = null;
    });

    card.addEventListener('click', () => {
      showToast(`${p.name || displayPId} を選択中。配置したいコマをクリックしてください。`, 'info');
    });

    container.appendChild(card);
  });
}

function getSlotDurationText(startTimeStr, units) {
  if (!startTimeStr) return `${units * 20}分`;
  const parts = String(startTimeStr).split(':');
  if (parts.length < 2) return `${startTimeStr} (${units * 20}分)`;

  const startH = parseInt(parts[0], 10);
  const startM = parseInt(parts[1], 10);
  const totalDurationMinutes = units * 20;

  const totalEndMinutes = startH * 60 + startM + totalDurationMinutes;
  const endH = Math.floor(totalEndMinutes / 60);
  const endM = totalEndMinutes % 60;
  const endMStr = String(endM).padStart(2, '0');

  return `${startH}:${String(startM).padStart(2, '0')}～${endH}:${endMStr}`;
}

function renderTimetable() {
  const dayLabel = document.getElementById('schedule-day-label');
  if (dayLabel) {
    const cur = new Date(state.selectedDate);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    dayLabel.textContent = `${cur.getFullYear()}年${cur.getMonth() + 1}月${cur.getDate()}日 (${days[cur.getDay()]})`;
  }

  const container = document.getElementById('timetable-grid');
  if (!container) return;

  container.innerHTML = '';

  const schedule = getDailySchedule(state.selectedDate);
  const patientMap = {};
  getAllPatients().forEach((p) => {
    patientMap[normalizePatientId(p.id)] = p;
  });

  const occupiedSlots = { A: new Map(), B: new Map(), C: new Map() };

  ['A', 'B', 'C'].forEach((tCode) => {
    const slots = schedule[tCode] || {};
    TIME_SLOTS.forEach((slot, idx) => {
      const slotData = slots[slot.id];
      if (slotData && slotData.patientId && slotData.units > 0) {
        const units = Math.max(1, Math.min(6, Number(slotData.units) || 1));
        for (let i = 1; i < units; i++) {
          const nextSlot = TIME_SLOTS[idx + i];
          if (nextSlot && nextSlot.period === slot.period) {
            occupiedSlots[tCode].set(nextSlot.id, {
              rootSlotId: slot.id,
              rootSlotData: slotData,
            });
          }
        }
      }
    });
  });

  TIME_SLOTS.forEach((slot) => {
    const row = document.createElement('div');
    row.className = 'slot-row';
    row.dataset.slotId = slot.id;

    const timeCell = document.createElement('div');
    timeCell.className = 'slot-time-cell';
    timeCell.textContent = slot.time;
    row.appendChild(timeCell);

    ['A', 'B', 'C'].forEach((tCode) => {
      const cell = document.createElement('div');
      cell.className = 'slot-drop-cell';
      cell.dataset.therapist = tCode;
      cell.dataset.slotId = slot.id;

      const slotData = schedule[tCode]?.[slot.id];
      const isOccupiedByPrior = occupiedSlots[tCode].has(slot.id);

      if (slotData && slotData.patientId && Number(slotData.units) > 0) {
        const units = Math.max(1, Number(slotData.units) || 1);
        const pNormId = normalizePatientId(slotData.patientId);
        const pInfo = patientMap[pNormId];
        const displayPId = String(slotData.patientId).toUpperCase();
        const pName = pInfo?.name || `患者${displayPId}`;
        const isOutpatient = pInfo?.category && pInfo.category.startsWith('outpatient');
        const durationText = getSlotDurationText(slot.label, units);

        const typeClass = isOutpatient ? 'patient-type-outpatient' : 'patient-type-inpatient';
        const unitThemeClass = units >= 4 ? 'unit-theme-4' : `unit-theme-${units}`;
        const spanClass = `span-units-${Math.min(units, 4)}`;

        const card = document.createElement('div');
        card.className = `slot-pill-card ${typeClass} ${unitThemeClass} ${spanClass}`;

        const planBadgeHtml = slotData.billingPlan
          ? `<span style="font-size: 0.65rem; background: #fef08a; color: #854d0e; padding: 0.05rem 0.35rem; border-radius: 4px; font-weight: 800;">📝計画書</span>`
          : '';

        card.innerHTML = `
          <div class="slot-patient-title" style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.1rem;">
              <span class="slot-id-badge">${displayPId}</span>
              <span class="slot-name-label" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${pName}</span>
              ${planBadgeHtml}
            </div>
            <div class="slot-time-sub">
              🕒 ${durationText} (${units * 20}分)
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; flex-shrink: 0; margin-left: 0.35rem;">
            <span class="slot-unit-tag">${units}単位</span>
          </div>
        `;

        card.addEventListener('click', (e) => {
          e.stopPropagation();
          openSlotEditModal(state.selectedDate, tCode, slot.id);
        });

        cell.appendChild(card);
      } else if (isOccupiedByPrior) {
        const parentInfo = occupiedSlots[tCode].get(slot.id);
        const parentPId = String(parentInfo.rootSlotData.patientId).toUpperCase();
        cell.classList.add('slot-covered-placeholder');
        cell.title = `前のコマ（${parentInfo.rootSlotId}）により ${parentPId} さんが実施中`;
        cell.addEventListener('click', () => {
          openSlotEditModal(state.selectedDate, tCode, parentInfo.rootSlotId);
        });
      } else {
        const hint = document.createElement('span');
        hint.className = 'slot-empty-hint';
        hint.textContent = '＋ 追加';
        cell.appendChild(hint);

        cell.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          cell.classList.add('drag-hover');
        });

        cell.addEventListener('dragleave', () => {
          cell.classList.remove('drag-hover');
        });

        cell.addEventListener('drop', (e) => {
          e.preventDefault();
          cell.classList.remove('drag-hover');
          const pId = e.dataTransfer.getData('text/plain') || state.draggedPatientId;
          if (pId) {
            handleSlotDropped(state.selectedDate, tCode, slot.id, pId);
          }
        });

        cell.addEventListener('click', () => {
          openSlotEditModal(state.selectedDate, tCode, slot.id);
        });
      }

      row.appendChild(cell);
    });

    container.appendChild(row);
  });
}

function handleSlotDropped(dateStr, therapistCode, slotId, patientId) {
  const normId = normalizePatientId(patientId);
  const p = getAllPatients().find((item) => normalizePatientId(item.id) === normId);
  const pName = p?.name || String(patientId).toUpperCase();
  const defaultUnits = 2;

  // 1. 同時間帯の重複防止
  if (!validatePatientTimeConflict(dateStr, therapistCode, slotId, patientId, defaultUnits)) {
    return;
  }

  // 2. 患者の1日上限検証
  if (!validatePatientDailyUnitsLimit(dateStr, patientId, defaultUnits)) {
    return;
  }

  // 3. セラピスト上限検証
  if (!validateTherapistWorkloadLimit(dateStr, therapistCode, defaultUnits)) {
    return;
  }

  // 4. 月13単位制限検証
  if (!validateMonthly13UnitsLimit(dateStr, therapistCode, slotId, patientId, defaultUnits, false)) {
    return;
  }

  setScheduleSlot(dateStr, therapistCode, slotId, {
    patientId: normId,
    units: defaultUnits,
    note: '',
    billingPlan: false,
  });

  renderAll();
  showToast(`${pName} を PT ${therapistCode} に配置しました (2単位 / 40分)`, 'success');
}

function renderDailyKPIs() {
  const stats = getDailyStats(state.selectedDate);

  const kpiA = document.getElementById('kpi-therapist-A');
  const kpiB = document.getElementById('kpi-therapist-B');
  const kpiC = document.getElementById('kpi-therapist-C');
  const patA = document.getElementById('kpi-patients-A');
  const patB = document.getElementById('kpi-patients-B');
  const patC = document.getElementById('kpi-patients-C');
  const kpiTotal = document.getElementById('kpi-clinic-total');
  const patTotal = document.getElementById('kpi-clinic-patients');

  const weekA = getTherapistWeeklyUnits(state.selectedDate, 'A');
  const weekB = getTherapistWeeklyUnits(state.selectedDate, 'B');
  const weekC = getTherapistWeeklyUnits(state.selectedDate, 'C');

  if (kpiA) kpiA.textContent = String(stats.therapistStats.A.totalUnits);
  if (kpiB) kpiB.textContent = String(stats.therapistStats.B.totalUnits);
  if (kpiC) kpiC.textContent = String(stats.therapistStats.C.totalUnits);

  if (patA) patA.textContent = `${stats.therapistStats.A.patientCount}名 (週${weekA}/108)`;
  if (patB) patB.textContent = `${stats.therapistStats.B.patientCount}名 (週${weekB}/108)`;
  if (patC) patC.textContent = `${stats.therapistStats.C.patientCount}名 (週${weekC}/108)`;

  if (kpiTotal) kpiTotal.textContent = String(stats.grandTotalUnits);
  if (patTotal) patTotal.textContent = `実人数 ${stats.grandPatientCount}名`;
}

function initSlotEditModal() {
  const modal = document.getElementById('slot-modal');
  const closeBtn = document.getElementById('modal-close-slot');
  const cancelBtn = document.getElementById('btn-cancel-slot');
  const saveBtn = document.getElementById('btn-save-slot');
  const clearBtn = document.getElementById('btn-clear-slot');
  const customUnitInput = document.getElementById('slot-modal-units');
  const presetChips = document.querySelectorAll('.preset-chip');
  const patientSelect = document.getElementById('slot-modal-patient-select');
  const patientInput = document.getElementById('slot-modal-patient');
  const timeSelect = document.getElementById('slot-modal-time');
  const therapistSelect = document.getElementById('slot-modal-therapist');
  const billingPlanCheckbox = document.getElementById('slot-modal-billing-plan');

  const closeModal = () => modal?.classList.remove('show');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      presetChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      if (customUnitInput) {
        customUnitInput.value = chip.dataset.unit;
        updateModalDurationHint(parseInt(chip.dataset.unit, 10));
      }
    });
  });

  customUnitInput?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10) || 1;
    updateModalDurationHint(val);
  });

  timeSelect?.addEventListener('change', () => {
    const val = parseInt(customUnitInput?.value, 10) || 2;
    updateModalDurationHint(val);
  });

  therapistSelect?.addEventListener('change', () => {
    const val = parseInt(customUnitInput?.value, 10) || 2;
    updateModalDurationHint(val);
  });

  patientSelect?.addEventListener('change', (e) => {
    if (e.target.value && patientInput) {
      patientInput.value = e.target.value;
      updatePlanEvaluationHint(e.target.value);
    }
  });

  patientInput?.addEventListener('input', (e) => {
    updatePlanEvaluationHint(e.target.value);
  });

  billingPlanCheckbox?.addEventListener('change', () => {
    updatePlanEvaluationHint(patientInput?.value || '');
  });

  saveBtn?.addEventListener('click', () => {
    try {
      if (!state.activeSlotModal) return;
      const { dateStr, therapistCode: origTherapist, slotId: origSlotId } = state.activeSlotModal;
      const targetSlotId = timeSelect?.value || origSlotId;
      const targetTherapist = therapistSelect?.value || origTherapist;

      const patientId = patientInput?.value?.trim();
      const units = parseInt(customUnitInput?.value, 10) || 0;
      const note = document.getElementById('slot-modal-note')?.value?.trim() || '';
      const billingPlan = Boolean(billingPlanCheckbox?.checked);

      if (!patientId) {
        showToast('患者記号または氏名を入力してください。', 'warning');
        return;
      }
      if (units <= 0) {
        showToast('有効な単位数を指定してください。', 'warning');
        return;
      }

      // 1. 同時間帯重複防止
      if (!validatePatientTimeConflict(dateStr, targetTherapist, targetSlotId, patientId, units, origTherapist, origSlotId)) {
        return;
      }

      // 2. 1日上限チェック
      if (!validatePatientDailyUnitsLimit(dateStr, patientId, units, origTherapist, origSlotId)) {
        return;
      }

      // 3. セラピスト上限チェック
      if (!validateTherapistWorkloadLimit(dateStr, targetTherapist, units, origTherapist, origSlotId)) {
        return;
      }

      // 4. 月13単位制限チェック
      const isSameSlot = (targetSlotId === origSlotId && targetTherapist === origTherapist);
      if (!validateMonthly13UnitsLimit(dateStr, origTherapist, origSlotId, patientId, units, isSameSlot)) {
        return;
      }

      if (targetSlotId !== origSlotId || targetTherapist !== origTherapist) {
        clearScheduleSlot(dateStr, origTherapist, origSlotId);
      }

      setScheduleSlot(dateStr, targetTherapist, targetSlotId, {
        patientId,
        units,
        note,
        billingPlan,
      });

      closeModal();
      renderAll();
      showToast(`PT ${targetTherapist} のコマを設定しました (${units}単位 / ${units * 20}分)`, 'success');
    } catch (err) {
      console.error('[saveBtn error]', err);
      showToast(`設定エラー: ${err.message}`, 'error');
    }
  });

  clearBtn?.addEventListener('click', () => {
    try {
      if (!state.activeSlotModal) return;
      const { dateStr, therapistCode, slotId } = state.activeSlotModal;
      clearScheduleSlot(dateStr, therapistCode, slotId);
      closeModal();
      renderAll();
      showToast('コマを空にしました。', 'info');
    } catch (err) {
      console.error('[clearBtn error]', err);
      showToast(`解除エラー: ${err.message}`, 'error');
    }
  });
}

function updatePlanEvaluationHint(patientId) {
  const hintEl = document.getElementById('slot-modal-plan-hint');
  const chk = document.getElementById('slot-modal-billing-plan');
  if (!hintEl) return;

  if (!chk || !chk.checked) {
    hintEl.style.display = 'none';
    return;
  }

  const p = getAllPatients().find((item) => normalizePatientId(item.id) === normalizePatientId(patientId));
  if (!p) {
    hintEl.innerHTML = `<span style="color: var(--text-muted);">患者情報を読み込み中...</span>`;
    hintEl.style.display = 'block';
    return;
  }

  const deadlines = calculatePatientDeadlines(p, new Date(state.selectedDate));
  let planTypeLabel = '総合実施計画書料 1';
  let points = 240;
  let explanation = '';

  if (deadlines.isCarePatient && deadlines.isPlan2Active) {
    planTypeLabel = '総合実施計画書料 2';
    points = 240;
    explanation = `要介護認定者（起算日から3分の1経過: ${deadlines.plan2TransitionDateStr}〜）のため【料2】対象です。`;
  } else if (deadlines.isCarePatient) {
    explanation = `要介護認定者ですが、3分の1（${deadlines.plan2TransitionDateStr}）到達前のため【料1】を算定します。`;
  } else {
    explanation = `医療保険のみ（要介護認定なし）のため【料1】を算定します。`;
  }

  hintEl.innerHTML = `
    <div style="font-weight: 800; color: #15803d;">✅ 算定判定: ${planTypeLabel}（${points}点 / ¥${(points * 10).toLocaleString()}）</div>
    <div style="font-size: 0.725rem; color: var(--text-secondary); margin-top: 0.2rem;">${explanation}</div>
  `;
  hintEl.style.display = 'block';
}

function updateModalDurationHint(units) {
  if (!state.activeSlotModal) return;
  const timeSelect = document.getElementById('slot-modal-time');
  const therapistSelect = document.getElementById('slot-modal-therapist');

  const selectedSlotId = timeSelect?.value || state.activeSlotModal.slotId;
  const selectedTherapist = therapistSelect?.value || state.activeSlotModal.therapistCode;

  const slotInfo = TIME_SLOTS.find((s) => s.id === selectedSlotId);
  if (!slotInfo) return;

  const durationStr = getSlotDurationText(slotInfo.label, units);
  const title = document.getElementById('slot-modal-title');
  if (title) {
    title.textContent = `PT ${selectedTherapist} | ${durationStr} (${units * 20}分)`;
  }
}

function openSlotEditModal(dateStr, therapistCode, slotId) {
  const modal = document.getElementById('slot-modal');
  if (!modal) return;

  state.activeSlotModal = { dateStr, therapistCode, slotId };

  const timeSelect = document.getElementById('slot-modal-time');
  if (timeSelect) {
    timeSelect.innerHTML = '';
    TIME_SLOTS.forEach((slot) => {
      const opt = document.createElement('option');
      opt.value = slot.id;
      opt.textContent = `${slot.period === 'am' ? '午前' : '午後'} ${slot.time}`;
      if (slot.id === slotId) opt.selected = true;
      timeSelect.appendChild(opt);
    });
  }

  const therapistSelect = document.getElementById('slot-modal-therapist');
  if (therapistSelect) {
    therapistSelect.value = therapistCode;
  }

  const select = document.getElementById('slot-modal-patient-select');
  if (select) {
    const list = getAllPatients();
    select.innerHTML = `<option value="">登録患者から選択</option>`;
    list.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${String(p.id).toUpperCase()}: ${p.name || ''}`;
      select.appendChild(opt);
    });
  }

  const schedule = getDailySchedule(dateStr);
  const curSlot = schedule[therapistCode]?.[slotId];

  const pInput = document.getElementById('slot-modal-patient');
  const uInput = document.getElementById('slot-modal-units');
  const nInput = document.getElementById('slot-modal-note');
  const planCheck = document.getElementById('slot-modal-billing-plan');

  const currentUnits = curSlot ? (Number(curSlot.units) || 2) : 2;
  const currentPatientId = curSlot ? String(curSlot.patientId).toUpperCase() : '';

  if (pInput) pInput.value = currentPatientId;
  if (uInput) uInput.value = String(currentUnits);
  if (nInput) nInput.value = curSlot ? curSlot.note || '' : '';
  if (planCheck) planCheck.checked = Boolean(curSlot?.billingPlan);

  document.querySelectorAll('.preset-chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.unit === String(currentUnits));
  });

  updateModalDurationHint(currentUnits);
  updatePlanEvaluationHint(currentPatientId);
  modal.classList.add('show');
}

function initMonthlyViews() {
  const yearSelect = document.getElementById('monthly-target-year');
  const monthSelect = document.getElementById('monthly-target-month');

  if (yearSelect) {
    yearSelect.innerHTML = '';
    for (let y = 2025; y <= 2028; y++) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `${y}年 (R${y - 2018})`;
      if (y === state.targetYear) opt.selected = true;
      yearSelect.appendChild(opt);
    }
    yearSelect.addEventListener('change', (e) => {
      state.targetYear = parseInt(e.target.value, 10);
      renderMonthlyUnitsTable();
      renderRevenueDashboard();
    });
  }

  if (monthSelect) {
    monthSelect.value = String(state.targetMonth);
    monthSelect.addEventListener('change', (e) => {
      state.targetMonth = parseInt(e.target.value, 10);
      renderMonthlyUnitsTable();
      renderRevenueDashboard();
    });
  }
}

function renderMonthlyUnitsTable() {
  const tbody = document.getElementById('monthly-patient-units-tbody');
  if (!tbody) return;

  const aggregated = aggregateFromAppSchedule(state.targetYear, state.targetMonth);
  const allPatients = getAllPatients();
  const patientMap = {};
  allPatients.forEach((p) => {
    patientMap[normalizePatientId(p.id)] = p;
  });

  tbody.innerHTML = '';

  const activeIds = Object.keys(aggregated.patientTotals);
  if (activeIds.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">当月の実施データはまだありません。時間割に入力してください。</td></tr>`;
    return;
  }

  activeIds.forEach((pId) => {
    const totals = aggregated.patientTotals[pId];
    const p = patientMap[pId] || { id: pId, name: `患者${String(pId).toUpperCase()}`, category: 'inpatient_1', diseaseType: 'LOCOMOTIVE' };
    const units = totals.totalUnits;
    const isRestricted = isPatientRestrictedTo13Units(p, new Date(state.selectedDate));

    const tr = document.createElement('tr');
    const isOut = p.category && p.category.startsWith('outpatient');
    const catLabel = isOut ? '外来' : '入院';
    const disLabel = REHA_RULES.LIMIT_DAYS[p.diseaseType]?.shortLabel || '運動器Ⅱ';

    let statusBadge = '';
    if (!isRestricted) {
      statusBadge = `<span style="color: var(--success); font-weight: 700; background: var(--success-light); padding: 0.15rem 0.5rem; border-radius: var(--radius-pill); border: 1px solid var(--success-border);">通常算定中 (上限期限内)</span>`;
    } else {
      if (units > 13) {
        statusBadge = `<span style="color: var(--danger); font-weight: 800; background: var(--danger-light); padding: 0.15rem 0.5rem; border-radius: var(--radius-pill); border: 1px solid var(--danger-border);">⚠️ 13単位超過 (${units}単位)</span>`;
      } else if (units >= 11) {
        statusBadge = `<span style="color: var(--warning); font-weight: 700; background: var(--warning-light); padding: 0.15rem 0.5rem; border-radius: var(--radius-pill); border: 1px solid var(--warning-border);">残枠わずか (${units}/13)</span>`;
      } else {
        statusBadge = `<span style="color: var(--text-secondary); font-weight: 700; background: var(--bg-surface-subtle); padding: 0.15rem 0.5rem; border-radius: var(--radius-pill);">算定枠内 (${units}/13)</span>`;
      }
    }

    tr.innerHTML = `
      <td><strong>${String(p.id).toUpperCase()}</strong>: ${p.name || ''}</td>
      <td><span class="palette-category-tag ${isOut ? 'tag-outpatient' : 'tag-inpatient'}">${catLabel}</span></td>
      <td>${disLabel}</td>
      <td><strong style="font-size: 1.05rem; color: var(--primary);">${units}</strong> 単位</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderRevenueDashboard() {
  const patientMap = {};
  getAllPatients().forEach((p) => {
    patientMap[normalizePatientId(p.id)] = p;
  });

  // 1. 本日の収益集計
  const todaySchedule = getDailySchedule(state.selectedDate);
  const todayDateObj = new Date(state.selectedDate);
  let todayRehaPoints = 0;
  let todayPlanPoints = 0;
  let todayEarlyPoints = 0;

  ['A', 'B', 'C'].forEach((tCode) => {
    const slots = todaySchedule[tCode] || {};
    for (const slot of Object.values(slots)) {
      if (!slot || !slot.patientId || Number(slot.units) <= 0) continue;
      const p = patientMap[normalizePatientId(slot.patientId)];
      if (!p) continue;

      const deadlines = calculatePatientDeadlines(p, todayDateObj);
      const isMaintDiscount = (p.careInsuranceType === 'CARE' || p.careInsuranceType === 'SUPPORT') && deadlines.isOverLimit;

      let unitPoints = REHA_RULES.LIMIT_DAYS[p.diseaseType]?.defaultPoints || 170;
      if (isMaintDiscount) {
        if (p.diseaseType === 'LOCOMOTIVE') unitPoints = 102;
        else if (p.diseaseType === 'CEREBROVASCULAR') unitPoints = 60;
        else if (p.diseaseType === 'DISUSE') unitPoints = 46;
      }
      todayRehaPoints += (unitPoints * Number(slot.units));

      const earlyStart = p.earlyBonusStartDate || p.admissionDate;
      if (earlyStart && p.category && !p.category.startsWith('outpatient')) {
        const elapsed = getDiffDays(normalizeDate(earlyStart), todayDateObj) + 1;
        if (elapsed >= 1 && elapsed <= 4) todayEarlyPoints += 60;
        else if (elapsed <= 14) todayEarlyPoints += 25;
      }

      if (slot.billingPlan) {
        if (deadlines.isCarePatient && deadlines.isPlan2Active) {
          todayPlanPoints += 240;
        } else {
          todayPlanPoints += 240;
        }
      }
    }
  });

  const todayTotalPoints = todayRehaPoints + todayPlanPoints + todayEarlyPoints;
  const todayTotalAmount = todayTotalPoints * 10;

  const todayAmountEl = document.getElementById('revenue-today-amount');
  const todayPointsEl = document.getElementById('revenue-today-points');
  const todayBreakdownEl = document.getElementById('revenue-today-breakdown');
  const todayDateBadge = document.getElementById('revenue-today-date-badge');

  if (todayDateBadge) todayDateBadge.textContent = state.selectedDate;
  if (todayAmountEl) todayAmountEl.textContent = `¥ ${todayTotalAmount.toLocaleString()}`;
  if (todayPointsEl) todayPointsEl.textContent = `(${todayTotalPoints.toLocaleString()} 点)`;
  if (todayBreakdownEl) {
    todayBreakdownEl.textContent = `リハ基本料: ¥${(todayRehaPoints * 10).toLocaleString()} | 総合計画書: ¥${(todayPlanPoints * 10).toLocaleString()} | 早期加算: ¥${(todayEarlyPoints * 10).toLocaleString()}`;
  }

  // 2. 当月累計の収益集計
  const allSchedules = getAllSchedules();
  const daysInMonth = new Date(state.targetYear, state.targetMonth, 0).getDate();
  let monthTotalUnits = 0;
  let monthRehaPoints = 0;
  let monthPlanCount = 0;
  let monthPlanPoints = 0;
  let monthEarlyCount = 0;
  let monthEarlyPoints = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(state.targetYear, state.targetMonth - 1, d);
    const curDateStr = formatDate(curDate);
    const daySchedule = allSchedules[curDateStr] || {};

    ['A', 'B', 'C'].forEach((tCode) => {
      const slots = daySchedule[tCode] || {};
      for (const slot of Object.values(slots)) {
        if (!slot || !slot.patientId || Number(slot.units) <= 0) continue;
        const p = patientMap[normalizePatientId(slot.patientId)];
        if (!p) continue;

        monthTotalUnits += Number(slot.units);
        const deadlines = calculatePatientDeadlines(p, curDate);
        const isMaintDiscount = (p.careInsuranceType === 'CARE' || p.careInsuranceType === 'SUPPORT') && deadlines.isOverLimit;

        let unitPoints = REHA_RULES.LIMIT_DAYS[p.diseaseType]?.defaultPoints || 170;
        if (isMaintDiscount) {
          if (p.diseaseType === 'LOCOMOTIVE') unitPoints = 102;
          else if (p.diseaseType === 'CEREBROVASCULAR') unitPoints = 60;
          else if (p.diseaseType === 'DISUSE') unitPoints = 46;
        }
        monthRehaPoints += (unitPoints * Number(slot.units));

        const earlyStart = p.earlyBonusStartDate || p.admissionDate;
        if (earlyStart && p.category && !p.category.startsWith('outpatient')) {
          const elapsed = getDiffDays(normalizeDate(earlyStart), curDate) + 1;
          if (elapsed >= 1 && elapsed <= 4) {
            monthEarlyCount += 1;
            monthEarlyPoints += 60;
          } else if (elapsed <= 14) {
            monthEarlyCount += 1;
            monthEarlyPoints += 25;
          }
        }

        if (slot.billingPlan) {
          monthPlanCount += 1;
          monthPlanPoints += 240;
        }
      }
    });
  }

  const monthTotalPoints = monthRehaPoints + monthPlanPoints + monthEarlyPoints;
  const monthTotalAmount = monthTotalPoints * 10;

  const monthAmountEl = document.getElementById('revenue-month-amount');
  const monthPointsEl = document.getElementById('revenue-month-points');
  const monthBreakdownEl = document.getElementById('revenue-month-breakdown');
  const monthBadgeEl = document.getElementById('revenue-month-badge');

  if (monthBadgeEl) monthBadgeEl.textContent = `${state.targetYear}年${state.targetMonth}月累計`;
  if (monthAmountEl) monthAmountEl.textContent = `¥ ${monthTotalAmount.toLocaleString()}`;
  if (monthPointsEl) monthPointsEl.textContent = `(${monthTotalPoints.toLocaleString()} 点)`;
  if (monthBreakdownEl) {
    monthBreakdownEl.textContent = `総実施: ${monthTotalUnits}単位 | 総合計画書: ${monthPlanCount}件 | 早期加算: ${monthEarlyCount}件`;
  }
}

function renderDailyDiaryPreview() {
  const container = document.getElementById('daily-diary-preview-container');
  const badge = document.getElementById('diary-preview-date-badge');
  if (!container) return;

  if (badge) {
    badge.textContent = state.selectedDate;
  }

  const schedule = getDailySchedule(state.selectedDate);
  const patientMap = {};
  getAllPatients().forEach((p) => {
    patientMap[normalizePatientId(p.id)] = p;
  });

  const diary = {
    inpatient: { loco: 0, cerebro: 0, disuse: 0, pain: 0, totalUnits: 0, patients: new Set() },
    outpatient: { loco: 0, cerebro: 0, disuse: 0, pain: 0, totalUnits: 0, patients: new Set() },
  };

  ['A', 'B', 'C'].forEach((tCode) => {
    const slots = schedule[tCode] || {};
    for (const s of Object.values(slots)) {
      if (s && s.patientId && Number(s.units) > 0) {
        const p = patientMap[normalizePatientId(s.patientId)];
        const isOut = p?.category && p.category.startsWith('outpatient');
        const target = isOut ? diary.outpatient : diary.inpatient;
        const dType = p?.diseaseType || 'LOCOMOTIVE';
        const units = Number(s.units);

        target.patients.add(s.patientId);
        target.totalUnits += units;

        if (dType === 'LOCOMOTIVE') target.loco += units;
        else if (dType === 'CEREBROVASCULAR') target.cerebro += units;
        else if (dType === 'DISUSE') target.disuse += units;
        else if (dType === 'ANALGESIA') target.pain += units;
      }
    }
  });

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem; font-size: 0.85rem;">
      <div style="background: #f8fafc; padding: 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--border-light);">
        <div style="font-weight: 800; color: var(--text-main); margin-bottom: 0.4rem; display: flex; justify-content: space-between;">
          <span>🏥 入院リハビリ</span>
          <span style="color: var(--primary);">${diary.inpatient.patients.size} 名 / ${diary.inpatient.totalUnits} 単位</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.35rem; color: var(--text-secondary); font-size: 0.8rem;">
          <div>運動器Ⅱ: <strong>${diary.inpatient.loco}</strong> 単位</div>
          <div>脳血管Ⅲ: <strong>${diary.inpatient.cerebro}</strong> 単位</div>
          <div>廃用Ⅲ: <strong>${diary.inpatient.disuse}</strong> 単位</div>
          <div>消炎鎮痛: <strong>${diary.inpatient.pain}</strong> 単位</div>
        </div>
      </div>

      <div style="background: #f8fafc; padding: 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--border-light);">
        <div style="font-weight: 800; color: var(--text-main); margin-bottom: 0.4rem; display: flex; justify-content: space-between;">
          <span>🚶 外来リハビリ</span>
          <span style="color: var(--primary);">${diary.outpatient.patients.size} 名 / ${diary.outpatient.totalUnits} 単位</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.35rem; color: var(--text-secondary); font-size: 0.8rem;">
          <div>運動器Ⅱ: <strong>${diary.outpatient.loco}</strong> 単位</div>
          <div>脳血管Ⅲ: <strong>${diary.outpatient.cerebro}</strong> 単位</div>
          <div>消炎鎮痛: <strong>${diary.outpatient.pain}</strong> 単位</div>
          <div>その他: <strong>0</strong> 単位</div>
        </div>
      </div>
    </div>
  `;
}

function initPatientMasterModal() {
  const modal = document.getElementById('patient-modal');
  const openBtn = document.getElementById('btn-add-patient-master');
  const closeBtn = document.getElementById('modal-close-patient');
  const cancelBtn = document.getElementById('btn-cancel-patient');
  const saveBtn = document.getElementById('btn-save-patient');

  const careSelect = document.getElementById('patient-modal-care-insurance');
  const onsetInput = document.getElementById('patient-modal-onset');
  const diseaseSelect = document.getElementById('patient-modal-disease');

  const closeModal = () => modal?.classList.remove('show');
  openBtn?.addEventListener('click', () => openPatientMasterModal());
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  const updateCareInsuranceHint = () => {
    const hintEl = document.getElementById('patient-modal-care-hint');
    if (!hintEl) return;

    const careVal = careSelect?.value;
    const onsetVal = onsetInput?.value;
    const disVal = diseaseSelect?.value || 'LOCOMOTIVE';

    if (careVal === 'CARE' && onsetVal) {
      const onsetDate = normalizeDate(onsetVal);
      const oneThird = getOneThirdDays(disVal);
      const transitionDate = new Date(onsetDate.getTime());
      transitionDate.setDate(transitionDate.getDate() + oneThird);
      hintEl.textContent = `ℹ️ 要介護認定: 起算日より${oneThird}日後（${formatDate(transitionDate)}）に「計画書料2」へ移行します。`;
      hintEl.style.display = 'block';
    } else {
      hintEl.style.display = 'none';
    }
  };

  careSelect?.addEventListener('change', updateCareInsuranceHint);
  onsetInput?.addEventListener('input', updateCareInsuranceHint);
  diseaseSelect?.addEventListener('change', updateCareInsuranceHint);

  saveBtn?.addEventListener('click', () => {
    const id = document.getElementById('patient-modal-id')?.value?.trim();
    const name = document.getElementById('patient-modal-name')?.value?.trim();
    const diseaseName = document.getElementById('patient-modal-disease-name')?.value?.trim() || '';
    const category = document.getElementById('patient-modal-category')?.value;
    const diseaseType = document.getElementById('patient-modal-disease')?.value;
    const careInsuranceType = careSelect?.value || 'NONE';
    const admissionDate = document.getElementById('patient-modal-admission')?.value;
    const earlyBonusStartDate = document.getElementById('patient-modal-early-start')?.value;
    const onsetDate = onsetInput?.value;
    const notes = document.getElementById('patient-modal-notes')?.value?.trim();

    if (!id) {
      showToast('患者記号は必須です。', 'warning');
      return;
    }

    upsertPatient({
      id,
      name,
      diseaseName,
      category,
      diseaseType,
      careInsuranceType,
      admissionDate,
      earlyBonusStartDate,
      onsetDate,
      notes,
    });

    closeModal();
    renderAll();
    showToast(`患者 ${String(id).toUpperCase()} を保存しました。`, 'success');
  });
}

function openPatientMasterModal(existingId = null) {
  const modal = document.getElementById('patient-modal');
  if (!modal) return;

  const p = existingId ? getAllPatients().find((item) => normalizePatientId(item.id) === normalizePatientId(existingId)) : null;

  const idInput = document.getElementById('patient-modal-id');
  const nameInput = document.getElementById('patient-modal-name');
  const disNameInput = document.getElementById('patient-modal-disease-name');
  const catInput = document.getElementById('patient-modal-category');
  const disInput = document.getElementById('patient-modal-disease');
  const careInput = document.getElementById('patient-modal-care-insurance');
  const admInput = document.getElementById('patient-modal-admission');
  const earlyInput = document.getElementById('patient-modal-early-start');
  const onsetInput = document.getElementById('patient-modal-onset');
  const noteInput = document.getElementById('patient-modal-notes');

  if (idInput) idInput.value = p ? p.id : '';
  if (nameInput) nameInput.value = p ? p.name || '' : '';
  if (disNameInput) disNameInput.value = p ? p.diseaseName || '' : '';
  if (catInput) catInput.value = p ? p.category || 'inpatient_1' : 'inpatient_1';
  if (disInput) disInput.value = p ? p.diseaseType || 'LOCOMOTIVE' : 'LOCOMOTIVE';
  if (careInput) careInput.value = p ? p.careInsuranceType || (p.category?.includes('maintenance') ? 'CARE' : 'NONE') : 'NONE';
  if (admInput) admInput.value = p ? p.admissionDate || '' : '';
  if (earlyInput) earlyInput.value = p ? p.earlyBonusStartDate || '' : '';
  if (onsetInput) onsetInput.value = p ? p.onsetDate || '' : '';
  if (noteInput) noteInput.value = p ? p.notes || '' : '';

  const hintEl = document.getElementById('patient-modal-care-hint');
  if (hintEl) {
    if (careInput?.value === 'CARE' && onsetInput?.value) {
      const onsetDate = normalizeDate(onsetInput.value);
      const oneThird = getOneThirdDays(disInput?.value || 'LOCOMOTIVE');
      const transitionDate = new Date(onsetDate.getTime());
      transitionDate.setDate(transitionDate.getDate() + oneThird);
      hintEl.textContent = `ℹ️ 要介護認定: 起算日より${oneThird}日後（${formatDate(transitionDate)}）に「計画書料2」へ移行します。`;
      hintEl.style.display = 'block';
    } else {
      hintEl.style.display = 'none';
    }
  }

  modal.classList.add('show');
}

function renderPatientDeadlines() {
  const tbody = document.getElementById('patient-deadlines-tbody');
  if (!tbody) return;

  const patients = getAllPatients();
  tbody.innerHTML = '';

  patients.forEach((p) => {
    const calc = calculatePatientDeadlines(p, new Date(state.selectedDate));
    const tr = document.createElement('tr');

    const isOut = p.category && p.category.startsWith('outpatient');
    const catLabel = isOut ? '外来' : '入院';
    const displayPId = String(p.id).toUpperCase();

    let earlyBadge = '<span style="color: var(--text-dim);">-</span>';
    if (calc.earlyBonusStatus === 'PHASE_1_ACTIVE') {
      earlyBadge = '<span class="status-pill" style="background: #eff6ff; color: #1d4ed8; font-weight: 700;">第1期 (4日以内)</span>';
    } else if (calc.earlyBonusStatus === 'PHASE_2_ACTIVE') {
      earlyBadge = '<span class="status-pill" style="background: #f0fdf4; color: #15803d; font-weight: 700;">第2期 (14日以内)</span>';
    } else if (calc.earlyBonusStatus === 'EXPIRED') {
      earlyBadge = '<span style="color: var(--text-dim); font-size: 0.75rem;">加算終了</span>';
    }

    let careBadge = '<span style="color: var(--text-muted); font-size: 0.8rem;">なし (医療)</span>';
    if (calc.careType === 'CARE') {
      careBadge = '<span class="status-pill" style="background: #fef3c7; color: #92400e; font-weight: 800;">要介護</span>';
    } else if (calc.careType === 'SUPPORT') {
      careBadge = '<span class="status-pill" style="background: #e0e7ff; color: #3730a3; font-weight: 800;">要支援</span>';
    }

    let plan2Badge = '<span style="color: var(--text-dim); font-size: 0.8rem;">対象外(料1)</span>';
    if (calc.isCarePatient) {
      if (calc.isPlan2Active) {
        plan2Badge = `<span style="color: #92400e; font-weight: 800;">${calc.plan2TransitionDateStr}</span> <span class="status-pill" style="background: #fef08a; color: #854d0e; font-size: 0.7rem;">料2適用中</span>`;
      } else {
        plan2Badge = `<span>${calc.plan2TransitionDateStr}</span> <span style="font-size: 0.725rem; color: var(--text-muted);">(あと${calc.daysUntilPlan2}日)</span>`;
      }
    }

    tr.innerHTML = `
      <td><strong>${displayPId}</strong></td>
      <td>${p.name || ''}</td>
      <td style="color: var(--primary); font-weight: 700;">${p.diseaseName || '-'}</td>
      <td><span class="palette-category-tag ${isOut ? 'tag-outpatient' : 'tag-inpatient'}">${catLabel}</span></td>
      <td>${calc.diseaseLabel || '運動器Ⅱ'}</td>
      <td>${careBadge}</td>
      <td>${p.admissionDate || '-'}</td>
      <td>${p.earlyBonusStartDate || '-'}</td>
      <td>${p.onsetDate || '-'}</td>
      <td>${earlyBadge}</td>
      <td>${calc.rehaLimitDateStr || '上限なし'}</td>
      <td>${plan2Badge}</td>
      <td style="position: sticky; right: 0; background-color: inherit; text-align: center;">
        <button type="button" class="btn-secondary-compact btn-edit-patient" data-id="${p.id}" style="font-weight: 800;">編集</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-edit-patient').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const patientId = btn.getAttribute('data-id');
      if (patientId) {
        openPatientMasterModal(patientId);
      }
    });
  });
}

function initLoanModal() {
  const modal = document.getElementById('loan-modal');
  const openBtn = document.getElementById('btn-add-loan');
  const closeBtn = document.getElementById('modal-close-loan');
  const cancelBtn = document.getElementById('btn-cancel-loan');
  const saveBtn = document.getElementById('btn-save-loan');
  const ownerType = document.getElementById('loan-owner-type');
  const vendorGroup = document.getElementById('vendor-name-group');

  const closeModal = () => modal?.classList.remove('show');
  openBtn?.addEventListener('click', () => {
    const loanDateInput = document.getElementById('loan-date');
    if (loanDateInput) loanDateInput.value = state.selectedDate;
    const itemInput = document.getElementById('loan-item-name');
    if (itemInput) itemInput.value = '';
    const patInput = document.getElementById('loan-patient-id');
    if (patInput) patInput.value = '';
    const venInput = document.getElementById('loan-vendor-name');
    if (venInput) venInput.value = '';
    const noteInput = document.getElementById('loan-notes');
    if (noteInput) noteInput.value = '';
    modal?.classList.add('show');
  });

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  ownerType?.addEventListener('change', (e) => {
    if (vendorGroup) {
      vendorGroup.style.display = e.target.value === 'VENDOR' ? 'block' : 'none';
    }
  });

  saveBtn?.addEventListener('click', () => {
    const itemName = document.getElementById('loan-item-name')?.value?.trim();
    const patientId = document.getElementById('loan-patient-id')?.value?.trim();
    const oType = ownerType?.value;
    const vendorName = document.getElementById('loan-vendor-name')?.value?.trim();
    const loanDate = document.getElementById('loan-date')?.value;
    const dueDate = document.getElementById('loan-due-date')?.value;
    const notes = document.getElementById('loan-notes')?.value?.trim();

    if (!itemName) {
      showToast('物品名を入力してください。', 'warning');
      return;
    }

    registerLoan({ itemName, patientId, ownerType: oType, vendorName, loanDate, dueDate, notes });
    closeModal();
    renderLoansTable();
    showToast('貸出を登録しました。', 'success');
  });
}

function renderLoansTable() {
  const tbody = document.getElementById('loans-tbody');
  if (!tbody) return;

  const loans = getAllLoans();
  tbody.innerHTML = '';

  if (loans.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">現在、貸出中の物品はありません。</td></tr>`;
    return;
  }

  loans.forEach((l) => {
    const tr = document.createElement('tr');
    const isVendor = l.ownerType === 'VENDOR';
    const isLoaned = l.status === 'LOANED';

    const ownerBadge = isVendor
      ? `<span class="palette-category-tag tag-outpatient">業者借用 (${l.vendorName || '外部業者'})</span>`
      : `<span class="palette-category-tag tag-inpatient">当院備品</span>`;

    const statusBadge = isLoaned
      ? `<span class="status-pill" style="background: var(--warning-light); color: var(--warning-text); font-weight: 700;">貸出中</span>`
      : `<span class="status-pill" style="background: var(--success-light); color: var(--success-text); font-weight: 700;">返却済</span>`;

    tr.innerHTML = `
      <td><strong>${l.itemName}</strong></td>
      <td>${l.patientId ? String(l.patientId).toUpperCase() : '-'}</td>
      <td>${ownerBadge}</td>
      <td>${l.loanDate || '-'}</td>
      <td>${l.dueDate || '-'}</td>
      <td>${statusBadge}</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${l.notes || ''}</td>
      <td>
        ${isLoaned ? `<button class="btn-secondary-compact btn-return-loan" data-id="${l.id}">返却完了</button>` : ''}
        <button class="btn-secondary-compact btn-delete-loan" data-id="${l.id}" style="color: var(--danger);">削除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-return-loan').forEach((btn) => {
    btn.addEventListener('click', () => {
      markAsReturned(btn.dataset.id);
      renderLoansTable();
      showToast('物品の返却完了を記録しました。', 'success');
    });
  });

  tbody.querySelectorAll('.btn-delete-loan').forEach((btn) => {
    btn.addEventListener('click', () => {
      deleteLoan(btn.dataset.id);
      renderLoansTable();
      showToast('貸出記録を削除しました。', 'info');
    });
  });
}

function initExportActionButtons() {
  const btnExportUketsuke = document.getElementById('btn-export-uketsuke');
  const btnExportDiary = document.getElementById('btn-export-diary');

  btnExportUketsuke?.addEventListener('click', () => {
    showToast('受付提出用Excelを生成中...', 'info');
    try {
      const aggregated = aggregateFromAppSchedule(state.targetYear, state.targetMonth);
      if (aggregated.rawRecordsCount === 0) {
        showToast('当月のリハビリ実施データがまだありません。時間割に入力してください。', 'warning');
        return;
      }

      const wb = XLSX.utils.book_new();
      const wsInpatient = XLSX.utils.aoa_to_sheet([
        ['受付提出用 単位管理', '', '', '', ''],
        ['年月:', `${state.targetYear}年${state.targetMonth}月度`],
        [],
        ['日付', '曜日', '天候', '午前', '午後', 'a', '', 'b', '', 'c'],
        ['', '', '', '', '', 'PT', 'OT', 'PT', 'OT', 'PT', 'OT'],
      ]);
      XLSX.utils.book_append_sheet(wb, wsInpatient, '実施ﾘｽﾄ 入院');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['外来']]), '  外来');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['レセプト合計']]), '(レセプト合計)入院');

      exportUketsukeSubmissionWorkbook(wb, aggregated);
      showToast('受付提出用Excelのダウンロードが完了しました。', 'success');
    } catch (err) {
      console.error(err);
      showToast(`出力エラー: ${err.message}`, 'error');
    }
  });

  btnExportDiary?.addEventListener('click', () => {
    showToast('業務日誌Excelを生成中...', 'info');
    try {
      const aggregated = aggregateFromAppSchedule(state.targetYear, state.targetMonth);
      if (aggregated.rawRecordsCount === 0) {
        showToast('当月のリハビリ実施データがまだありません。時間割に入力してください。', 'warning');
        return;
      }

      const wb = XLSX.utils.book_new();
      for (let d = 1; d <= 31; d++) {
        const ws = XLSX.utils.aoa_to_sheet([
          [`業務日誌 ${state.targetMonth}月${d}日`],
          [],
          ['区分', '項目', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '集計値'],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, `${d}日`);
      }

      exportDiaryWorkbook(wb, aggregated);
      showToast('業務日誌Excelのダウンロードが完了しました。', 'success');
    } catch (err) {
      console.error(err);
      showToast(`出力エラー: ${err.message}`, 'error');
    }
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}
