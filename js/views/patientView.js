// js/views/patientView.js
// VIEW 3: 患者台帳・算定期限管理・患者登録編集モーダル制御層（200行制限準拠）

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';
import { getPatientById, upsertPatient, deletePatient, searchPatients } from '../store/patientStore.js';
import { showToast } from './exportView.js';

let editingPatientId = null;

export function initPatientView() {
  const searchInput = document.getElementById('patientSearchInput');
  const catFilter = document.getElementById('patientCategoryFilter');
  const btnNew = document.getElementById('btnNewPatient');

  searchInput?.addEventListener('input', () => renderPatientView());
  catFilter?.addEventListener('change', () => renderPatientView());
  btnNew?.addEventListener('click', () => openPatientModal(null));

  setupPatientModalListeners();
}

function getPlanStatusBadge(status) {
  if (status === 'PLAN_2_FOLLOW') {
    return '<span style="color:#7c3aed; font-weight:800; background:#f5f3ff; border:1px solid #ddd6fe; padding:2px 5px; border-radius:3px; font-size:0.72rem;">計2継続(196点)</span>';
  }
  if (status === 'PLAN_1_FOLLOW') {
    return '<span style="color:#0369a1; font-weight:700; background:#e0f2fe; padding:2px 5px; border-radius:3px; font-size:0.72rem;">計1継続(240点)</span>';
  }
  return '<span style="color:#64748b; font-size:0.72rem;">未算定(初回)</span>';
}

export function renderPatientView() {
  const container = document.getElementById('patientTableContainer');
  if (!container) return;

  const keyword = document.getElementById('patientSearchInput')?.value || '';
  const category = document.getElementById('patientCategoryFilter')?.value || 'ALL';
  const patients = searchPatients(keyword, category);

  if (patients.length === 0) {
    container.innerHTML = '<div style="padding:32px; text-align:center; color:#94a3b8; font-size:0.85rem;">該当する患者データがありません</div>';
    return;
  }

  let html = `
    <table class="modern-table" style="width:100%; table-layout:auto; font-size:0.78rem;">
      <thead>
        <tr>
          <th style="padding:6px 6px;">ID</th>
          <th style="padding:6px 8px;">患者氏名</th>
          <th style="padding:6px 6px;">疾患名</th>
          <th style="padding:6px 4px; text-align:center;">区分</th>
          <th style="padding:6px 4px; text-align:center;">疾患区分</th>
          <th style="padding:6px 4px; text-align:center;">介護認定</th>
          <th style="padding:6px 6px;">入院日</th>
          <th style="padding:6px 6px;">起算日</th>
          <th style="padding:6px 6px; text-align:center;">早期加算</th>
          <th style="padding:6px 6px;">上限日(残日)</th>
          <th style="padding:6px 6px; text-align:center;">計画書フェーズ</th>
          <th style="padding:6px 6px; text-align:center; width:54px;">操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  const today = new Date();
  patients.forEach((p) => {
    const dl = calculatePatientDeadlines(p, today);
    const isOut = p.category === 'OUTPATIENT';
    const catBadge = isOut ? '<span style="color:#2563eb; font-weight:700;">外</span>' : '<span style="color:#d97706; font-weight:700;">入</span>';

    let earlyBadge = '<span style="color:#94a3b8;">-</span>';
    if (!isOut && dl.earlyBonus && dl.earlyBonus.points > 0) {
      const isP1 = dl.earlyBonus.phase === 'PHASE_1';
      earlyBadge = `<span style="background:${isP1 ? '#d1fae5' : '#e0f2fe'}; color:${isP1 ? '#059669' : '#0284c7'}; padding:1px 5px; border-radius:3px; font-weight:700; font-size:0.72rem;">+${dl.earlyBonus.points}点</span>`;
    }

    let limitDisplay = '<span style="color:#94a3b8;">上限なし</span>';
    if (dl.limitDateStr) {
      if (dl.isLimitExceeded) {
        limitDisplay = `<span style="color:#e11d48; font-weight:700;">超過 (${dl.remainingDays}日)</span>`;
      } else {
        const warnStyle = (dl.remainingDays <= 30) ? 'color:#d97706; font-weight:700;' : 'color:#334155;';
        limitDisplay = `<span style="${warnStyle}">${dl.limitDateStr} (${dl.remainingDays}日)</span>`;
      }
    }

    let careDisplay = '<span style="color:#94a3b8;">なし</span>';
    if (p.careInsuranceType === 'CARE') careDisplay = '<span style="color:#7c3aed; font-weight:700;">要介護</span>';
    else if (p.careInsuranceType === 'SUPPORT') careDisplay = '<span style="color:#059669; font-weight:700;">要支援</span>';

    html += `
      <tr>
        <td style="padding:6px 6px;"><strong>${p.id}</strong></td>
        <td style="padding:6px 8px; white-space:nowrap;"><strong>${sanitizeHtml(p.name)}</strong><br><span style="font-size:0.68rem; color:#64748b;">${sanitizeHtml(p.nameKana || '')}</span></td>
        <td style="padding:6px 6px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${sanitizeHtml(p.diseaseName || '')}">${sanitizeHtml(p.diseaseName || '-')}</td>
        <td style="padding:6px 4px; text-align:center;">${catBadge}</td>
        <td style="padding:6px 4px; text-align:center;"><span style="font-size:0.72rem; background:#f1f5f9; padding:1px 4px; border-radius:3px;">${dl.diseaseLabel}</span></td>
        <td style="padding:6px 4px; text-align:center;">${careDisplay}</td>
        <td style="padding:6px 6px; font-size:0.75rem; white-space:nowrap;">${p.admissionDate || '-'}</td>
        <td style="padding:6px 6px; font-size:0.75rem; white-space:nowrap;">${p.onsetDate || p.admissionDate || '-'}</td>
        <td style="padding:6px 6px; text-align:center;">${earlyBadge}</td>
        <td style="padding:6px 6px; font-size:0.75rem; white-space:nowrap;">${limitDisplay}</td>
        <td style="padding:6px 6px; text-align:center;">${getPlanStatusBadge(p.planStatus)}</td>
        <td style="padding:6px 6px; text-align:center;">
          <button class="btn-edit-patient" data-id="${p.id}" style="padding:2px 6px; font-size:0.72rem; border:1px solid #cbd5e1; background:#fff; border-radius:4px; cursor:pointer;">編集</button>
        </td>
      </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;

  container.querySelectorAll('.btn-edit-patient').forEach((btn) => {
    btn.addEventListener('click', () => openPatientModal(btn.dataset.id));
  });
}

function setupPatientModalListeners() {
  const modal = document.getElementById('modalPatientEdit');
  const btnClose = document.getElementById('btnClosePatientModal');
  const btnDelete = document.getElementById('btnDeletePatient');
  const form = document.getElementById('patientEditForm');

  btnClose?.addEventListener('click', () => modal.classList.remove('active'));

  btnDelete?.addEventListener('click', () => {
    if (!editingPatientId) return;
    deletePatient(editingPatientId);
    modal.classList.remove('active');
    showToast('患者レコードを削除しました', 'warn');
    renderPatientView();
  });

  ['patientFormCareType', 'patientFormDiseaseType', 'patientFormAdmissionDate', 'patientFormOnsetDate'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', updatePlan2GuidePreview);
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const rawData = {
      id: document.getElementById('patientFormId').value,
      name: document.getElementById('patientFormName').value,
      nameKana: document.getElementById('patientFormKana').value,
      diseaseName: document.getElementById('patientFormDiseaseName').value,
      category: document.getElementById('patientFormCategory').value,
      diseaseType: document.getElementById('patientFormDiseaseType').value,
      careInsuranceType: document.getElementById('patientFormCareType').value,
      planStatus: document.getElementById('patientFormPlanStatus')?.value || 'NOT_YET',
      admissionDate: document.getElementById('patientFormAdmissionDate').value,
      earlyBonusStartDate: document.getElementById('patientFormEarlyStartDate').value,
      onsetDate: document.getElementById('patientFormOnsetDate').value,
      force13Limit: document.getElementById('patientFormForce13').checked,
      notes: document.getElementById('patientFormNotes').value
    };

    const res = upsertPatient(rawData);
    if (!res.success) {
      showToast(res.message || '患者情報の登録に失敗しました', 'error');
      return;
    }

    modal.classList.remove('active');
    showToast(`患者情報(${res.patient.name})を保存しました`, 'success');
    renderPatientView();
  });
}

function openPatientModal(patientId) {
  editingPatientId = patientId;
  const modal = document.getElementById('modalPatientEdit');
  const titleEl = document.getElementById('patientModalTitle');
  const btnDelete = document.getElementById('btnDeletePatient');
  const idInput = document.getElementById('patientFormId');

  titleEl.textContent = patientId ? `患者台帳編集 (${patientId})` : '新規患者登録';
  btnDelete.style.display = patientId ? 'block' : 'none';
  idInput.readOnly = Boolean(patientId);

  const p = patientId ? getPatientById(patientId) : null;
  idInput.value = p ? p.id : '';
  document.getElementById('patientFormName').value = p ? p.name : '';
  document.getElementById('patientFormKana').value = p ? (p.nameKana || '') : '';
  document.getElementById('patientFormDiseaseName').value = p ? (p.diseaseName || '') : '';
  document.getElementById('patientFormCategory').value = p ? p.category : 'INPATIENT';
  document.getElementById('patientFormDiseaseType').value = p ? p.diseaseType : 'LOCOMOTIVE';
  document.getElementById('patientFormCareType').value = p ? p.careInsuranceType : 'NONE';
  
  const planSelect = document.getElementById('patientFormPlanStatus');
  if (planSelect) planSelect.value = p ? (p.planStatus || 'NOT_YET') : 'NOT_YET';

  document.getElementById('patientFormAdmissionDate').value = p ? (p.admissionDate || '') : '';
  document.getElementById('patientFormEarlyStartDate').value = p ? (p.earlyBonusStartDate || '') : '';
  document.getElementById('patientFormOnsetDate').value = p ? (p.onsetDate || '') : '';
  document.getElementById('patientFormForce13').checked = Boolean(p?.force13Limit);
  document.getElementById('patientFormNotes').value = p ? (p.notes || '') : '';

  updatePlan2GuidePreview();
  modal.classList.add('active');
}

function updatePlan2GuidePreview() {
  const guideEl = document.getElementById('patientPlan2Guide');
  if (!guideEl) return;

  const careType = document.getElementById('patientFormCareType').value;
  const diseaseType = document.getElementById('patientFormDiseaseType').value;
  const onset = document.getElementById('patientFormOnsetDate').value;
  const admin = document.getElementById('patientFormAdmissionDate').value;
  const base = onset || admin;

  if (careType === 'CARE' && base) {
    const dummyPatient = { diseaseType, careInsuranceType: 'CARE', onsetDate: onset, admissionDate: admin };
    const res = calculatePatientDeadlines(dummyPatient, new Date());
    guideEl.style.display = 'block';
    guideEl.innerHTML = `💡 要介護認定：3分の1経過予定日は <strong>${res.plan2TransitionDateStr}</strong> です（到達後「計画書料2」へ移行）。`;
  } else {
    guideEl.style.display = 'none';
    guideEl.innerHTML = '';
  }
}
