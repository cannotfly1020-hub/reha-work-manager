// js/views/modals/slotModal.js
// コマ配置モーダル制御層（患者リアルタイム検索・単位数選択・計画書チェックボックス連動・各種制約バリデーション・保存解除・日次自動バックアップ連携）

import { TIME_SLOTS } from '../../config/rules.js';
import { sanitizeHtml, safeParseInt } from '../../core/dataNormalizer.js';
import { getAllTherapists, getActiveTherapists } from '../../store/therapistStore.js';
import { getPatientById, searchPatients, updatePatientPlanStatus } from '../../store/patientStore.js';
import {
  getDailySchedule, setScheduleSlot, clearScheduleSlot,
  findPatientMonthlyPlanDate, hasPatientPastPlan
} from '../../store/scheduleStore.js';
import { evaluateRecommendedPlan } from '../../core/deadlineCalc.js';
import {
  validateTimeConflict, validateDailyLimit, validateTherapistWorkload, validateMonthlyPlanLimit
} from '../../core/validator.js';
import { showToast } from '../exportView.js';

let activeModalSlot = null;
let onScheduleUpdatedCallback = null;

function getLocalDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function setupSlotModalListeners(onUpdate) {
  onScheduleUpdatedCallback = onUpdate;

  const modal = document.getElementById('modalSlotEdit');
  const btnClose = document.getElementById('btnCloseSlotModal');
  const btnDelete = document.getElementById('btnDeleteSlot');
  const form = document.getElementById('slotEditForm');
  const patientSelect = document.getElementById('slotPatientSelect');
  const searchInput = document.getElementById('slotPatientSearchInput');
  const planCheck = document.getElementById('slotBillingPlanCheck');
  const planSelect = document.getElementById('slotBillingPlanSelect');

  btnClose?.addEventListener('click', () => modal?.classList.remove('active'));

  btnDelete?.addEventListener('click', () => {
    if (!activeModalSlot) return;
    const currentDateStr = getCurrentDateContext();
    clearScheduleSlot(currentDateStr, activeModalSlot.therapistId, activeModalSlot.slotId);
    modal?.classList.remove('active');
    showToast('コマの配置を解除しました', 'warn');

    // ★解除後の最新確定データを当日バックアップファイルへ自動上書きトリガー
    if (typeof window.triggerDailyBackup === 'function') {
      window.triggerDailyBackup();
    }

    if (typeof onScheduleUpdatedCallback === 'function') onScheduleUpdatedCallback();
  });

  // モーダル内リアルタイム患者検索
  searchInput?.addEventListener('input', () => {
    populateModalPatientSelect(searchInput.value, document.getElementById('slotPatientId')?.value || '');
  });

  // モーダル内セレクトボックスから患者選択時のイベント連動
  patientSelect?.addEventListener('change', () => {
    const selectedId = patientSelect.value;
    const targetInput = document.getElementById('slotPatientId');
    if (targetInput) targetInput.value = selectedId;
    updateModalPatientPlanRecommendation(selectedId);
  });

  // 計画書チェックボックスの切り替えイベント（チェックONでのみセレクトボックス有効化）
  planCheck?.addEventListener('change', () => {
    const pId = document.getElementById('slotPatientId')?.value || '';
    const currentDateStr = getCurrentDateContext();

    if (planCheck.checked) {
      const [year, month] = currentDateStr.split('-').map(Number);
      const excludeSlot = activeModalSlot?.currentItem ? activeModalSlot.slotId : '';
      const existingDate = pId ? findPatientMonthlyPlanDate(pId, year, month, currentDateStr, excludeSlot) : null;

      if (existingDate) {
        showToast(`⚠ 総合計画評価料は当月 ${existingDate} に算定済みのためチェックできません`, 'warn');
        planCheck.checked = false;
        if (planSelect) {
          planSelect.value = '';
          planSelect.disabled = true;
          planSelect.style.background = '#f1f5f9';
        }
        return;
      }

      if (planSelect) {
        planSelect.disabled = false;
        planSelect.style.background = '#fff';
        planSelect.style.color = '#0f172a';

        const patient = getPatientById(pId);
        if (patient) {
          const hasPastPlan = hasPatientPastPlan(pId, currentDateStr);
          const recommendation = evaluateRecommendedPlan(patient, currentDateStr, hasPastPlan);
          planSelect.value = recommendation.recommendedPlan || 'PLAN_1_FIRST';
        } else {
          planSelect.value = 'PLAN_1_FIRST';
        }
      }
    } else {
      if (planSelect) {
        planSelect.value = '';
        planSelect.disabled = true;
        planSelect.style.background = '#f1f5f9';
        planSelect.style.color = '#64748b';
      }
    }
  });

  // 単位数ボタングループの選択
  document.querySelectorAll('.btn-unit-select').forEach((b) => {
    b.addEventListener('click', (e) => {
      document.querySelectorAll('.btn-unit-select').forEach((x) => (x.style.background = '#fff'));
      e.target.style.background = '#e0f2fe';
      const unitInput = document.getElementById('slotUnitsInput');
      if (unitInput) unitInput.value = e.target.dataset.unit;
    });
  });

  // コマ保存処理
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSlotFormSubmit();
  });
}

function handleSlotFormSubmit() {
  if (!activeModalSlot) return;

  const currentDateStr = getCurrentDateContext();
  const modal = document.getElementById('modalSlotEdit');
  const planSelect = document.getElementById('slotBillingPlanSelect');
  const patientId = document.getElementById('slotPatientId')?.value || '';
  const units = safeParseInt(document.getElementById('slotUnitsInput')?.value, 1);
  const note = document.getElementById('slotNoteInput')?.value || '';

  // 厳格防御：チェックボックスがONの時のみ計画書区分を採用
  const isPlanChecked = Boolean(document.getElementById('slotBillingPlanCheck')?.checked);
  const billingPlan = isPlanChecked && planSelect ? planSelect.value : '';

  const newTherapistId = document.getElementById('slotModalTherapistSelect')?.value || activeModalSlot.therapistId;
  const newSlotId = document.getElementById('slotModalSlotSelect')?.value || activeModalSlot.slotId;

  if (!patientId) {
    showToast('患者が選択されていません。上部リストから患者を選択してください', 'error');
    return;
  }

  const dailySchedule = getDailySchedule(currentDateStr);
  const origTherapist = activeModalSlot.therapistId;
  const origSlot = activeModalSlot.slotId;
  const isRelocated = origTherapist !== newTherapistId || origSlot !== newSlotId;

  if (isRelocated && dailySchedule[newTherapistId]?.[newSlotId]) {
    showToast('変更先の時間枠にはすでに患者が配置されています', 'warn');
    return;
  }

  const currentUnits = activeModalSlot.currentItem ? activeModalSlot.currentItem.units : 0;
  const patient = getPatientById(patientId);

  const conflictCheck = validateTimeConflict(dailySchedule, newTherapistId, newSlotId, patientId, units, origSlot);
  if (!conflictCheck.valid) {
    showToast(conflictCheck.message, 'error');
    return;
  }

  if (patient) {
    const dailyLimitCheck = validateDailyLimit(dailySchedule, patient, currentDateStr, units, currentUnits);
    if (!dailyLimitCheck.valid) {
      showToast(dailyLimitCheck.message, 'error');
      return;
    }
  }

  if (billingPlan) {
    const [year, month] = currentDateStr.split('-').map(Number);
    const excludeSlot = activeModalSlot.currentItem ? origSlot : '';
    const existingDate = findPatientMonthlyPlanDate(patientId, year, month, currentDateStr, excludeSlot);
    const planCheckRes = validateMonthlyPlanLimit(billingPlan, existingDate);
    if (!planCheckRes.valid) {
      showToast(planCheckRes.message, 'error');
      return;
    }
  }

  const workloadCheck = validateTherapistWorkload(dailySchedule, newTherapistId, units, isRelocated ? 0 : currentUnits);
  if (!workloadCheck.valid) {
    showToast(workloadCheck.message, 'error');
    return;
  }
  if (workloadCheck.message) showToast(workloadCheck.message, 'warn');

  if (isRelocated && activeModalSlot.currentItem) {
    clearScheduleSlot(currentDateStr, origTherapist, origSlot);
  }

  setScheduleSlot(currentDateStr, newTherapistId, newSlotId, { patientId, units, note, billingPlan });

  if (billingPlan) {
    updatePatientPlanStatus(patientId, billingPlan);
  }

  modal?.classList.remove('active');
  showToast('スケジュールを保存しました', 'success');

  // ★時間割保存後の最新データを当日バックアップファイルへ自動上書きトリガー
  if (typeof window.triggerDailyBackup === 'function') {
    window.triggerDailyBackup();
  }

  if (typeof onScheduleUpdatedCallback === 'function') onScheduleUpdatedCallback();
}

export function openSlotModal(therapistId, slotId, currentItem) {
  activeModalSlot = { therapistId, slotId, currentItem };
  const modal = document.getElementById('modalSlotEdit');
  const titleEl = document.getElementById('slotModalTitle');
  const btnDelete = document.getElementById('btnDeleteSlot');
  const therapistSelect = document.getElementById('slotModalTherapistSelect');
  const slotSelect = document.getElementById('slotModalSlotSelect');
  const searchInput = document.getElementById('slotPatientSearchInput');
  const planCheck = document.getElementById('slotBillingPlanCheck');
  const planSelect = document.getElementById('slotBillingPlanSelect');

  const allTherapists = getAllTherapists();
  const activeTherapists = getActiveTherapists();
  const currentTherapist = allTherapists.find((t) => t.id === therapistId);
  const tDisplayName = currentTherapist ? currentTherapist.name : `PT ${therapistId}`;

  if (titleEl) {
    titleEl.textContent = `コマ配置 (${tDisplayName} / ${TIME_SLOTS.find((s) => s.id === slotId)?.label || slotId})`;
  }
  if (btnDelete) btnDelete.style.display = currentItem ? 'block' : 'none';

  if (therapistSelect) {
    const selectCandidates = [...activeTherapists];
    if (currentTherapist && !selectCandidates.some((t) => t.id === currentTherapist.id)) {
      selectCandidates.push(currentTherapist);
    }
    therapistSelect.innerHTML = selectCandidates.map((t) => `<option value="${t.id}">${sanitizeHtml(t.name)}</option>`).join('');
    therapistSelect.value = therapistId;
  }
  if (slotSelect) {
    slotSelect.innerHTML = TIME_SLOTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
    slotSelect.value = slotId;
  }

  const pId = currentItem?.patientId || '';
  const pInput = document.getElementById('slotPatientId');
  const tInput = document.getElementById('slotTherapistId');
  const sInput = document.getElementById('slotId');
  if (pInput) pInput.value = pId;
  if (tInput) tInput.value = therapistId;
  if (sInput) sInput.value = slotId;

  if (searchInput) searchInput.value = '';
  populateModalPatientSelect('', pId);

  // 計画書チェックボックスの初期化：既存コマに billingPlan がある時のみチェックON
  const hasBillingPlan = Boolean(currentItem?.billingPlan);
  if (planCheck) {
    planCheck.checked = hasBillingPlan;
    planCheck.disabled = !pId;
  }
  if (planSelect) {
    planSelect.disabled = !hasBillingPlan;
    planSelect.style.background = hasBillingPlan ? '#fff' : '#f1f5f9';
    planSelect.style.color = hasBillingPlan ? '#0f172a' : '#64748b';
    planSelect.value = hasBillingPlan ? String(currentItem.billingPlan) : '';
  }

  updateModalPatientPlanRecommendation(pId);

  const units = currentItem?.units || 1;
  const unitsInput = document.getElementById('slotUnitsInput');
  if (unitsInput) unitsInput.value = units;
  document.querySelectorAll('.btn-unit-select').forEach((b) => {
    b.style.background = b.dataset.unit == units ? '#e0f2fe' : '#fff';
  });

  const noteInput = document.getElementById('slotNoteInput');
  if (noteInput) noteInput.value = currentItem?.note || '';

  modal?.classList.add('active');
}

function populateModalPatientSelect(keyword = '', selectId = '') {
  const patientSelect = document.getElementById('slotPatientSelect');
  if (!patientSelect) return;

  const patients = searchPatients(keyword, 'ALL');
  if (patients.length === 0) {
    patientSelect.innerHTML = '<option value="" disabled>該当する患者がいません</option>';
    return;
  }

  patientSelect.innerHTML = patients
    .map((p) => {
      const cat = p.category === 'INPATIENT' ? '入' : '外';
      const isSel = p.id === selectId ? 'selected' : '';
      return `<option value="${p.id}" ${isSel}>${p.id} : ${sanitizeHtml(p.name)} (${cat} / ${sanitizeHtml(p.diseaseName || '未記入')})</option>`;
    })
    .join('');
}

function updateModalPatientPlanRecommendation(pId) {
  const currentDateStr = getCurrentDateContext();
  const patientInfoEl = document.getElementById('slotPatientInfo');
  const planCheck = document.getElementById('slotBillingPlanCheck');
  const planSelect = document.getElementById('slotBillingPlanSelect');
  const patient = pId ? getPatientById(pId) : null;

  if (!patient) {
    if (patientInfoEl) patientInfoEl.textContent = '患者が未選択です';
    if (planCheck) {
      planCheck.checked = false;
      planCheck.disabled = true;
    }
    if (planSelect) {
      planSelect.value = '';
      planSelect.disabled = true;
      planSelect.style.background = '#f1f5f9';
    }
    return;
  }

  const cat = patient.category === 'INPATIENT' ? '入院' : '外来';
  if (patientInfoEl) {
    patientInfoEl.innerHTML = `選択中: <strong>${sanitizeHtml(patient.name)}</strong> (${patient.id}) / ${cat} / ${sanitizeHtml(patient.diseaseName || '')}`;
  }

  const [year, month] = currentDateStr.split('-').map(Number);
  const excludeSlot = activeModalSlot?.currentItem ? activeModalSlot.slotId : '';
  const existingDate = findPatientMonthlyPlanDate(pId, year, month, currentDateStr, excludeSlot);

  if (existingDate) {
    if (planCheck) {
      planCheck.checked = false;
      planCheck.disabled = true;
    }
    if (planSelect) {
      planSelect.value = '';
      planSelect.disabled = true;
      planSelect.style.background = '#f1f5f9';
    }
    if (patientInfoEl) {
      patientInfoEl.innerHTML += `<div style="color:#e11d48; font-size:0.75rem; margin-top:4px; font-weight:700;">⚠ 総合計画評価料は当月 ${existingDate} に算定済みのため選択できません</div>`;
    }
  } else {
    if (planCheck) planCheck.disabled = false;
    const hasPastPlan = hasPatientPastPlan(pId, currentDateStr);
    const recommendation = evaluateRecommendedPlan(patient, currentDateStr, hasPastPlan);

    if (planCheck && planCheck.checked) {
      if (planSelect) {
        planSelect.disabled = false;
        planSelect.style.background = '#fff';
        planSelect.style.color = '#0f172a';
        planSelect.value = recommendation.recommendedPlan || 'PLAN_1_FIRST';
      }
    } else {
      if (planSelect) {
        planSelect.value = '';
        planSelect.disabled = true;
        planSelect.style.background = '#f1f5f9';
        planSelect.style.color = '#64748b';
      }
    }

    if (recommendation.recommendedPlan && patientInfoEl) {
      patientInfoEl.innerHTML += `<div style="color:#0284c7; font-size:0.75rem; margin-top:4px; font-weight:600; background:#f0f9ff; padding:3px 6px; border-radius:4px; border:1px solid #bae6fd;">💡 算定時の推奨: ${recommendation.label}</div>`;
    }
  }
}

function getCurrentDateContext() {
  const dateInput = document.getElementById('scheduleDateInput');
  return dateInput?.value || getLocalDateStr();
}
