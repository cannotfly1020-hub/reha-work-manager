// js/views/patientView.js
// VIEW 3: 患者台帳・算定期限管理・計画書2行表示・通院中/終了ステータス管理・患者登録編集モーダル制御層
// ★終了・退院日はモーダルの明示入力 exitDate を正本とし、Excel「退」マークへ連動

import { sanitizeHtml, normalizeToKatakana } from '../core/dataNormalizer.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';
import {
  getPatientById, upsertPatient, deletePatient, searchPatients, PATIENT_STATUS
} from '../store/patientStore.js';
import { showToast } from '../ui/toast.js';

let editingPatientId = null;
let patientSortKey = 'ID_ASC';

export function initPatientView() {
  const searchInput = document.getElementById('patientSearchInput');
  const catFilter = document.getElementById('patientCategoryFilter');
  const statusFilter = document.getElementById('patientStatusFilter');
  const sortSelect = document.getElementById('patientSortSelect');
  const btnNew = document.getElementById('btnNewPatient');

  searchInput?.addEventListener('input', () => renderPatientView());
  catFilter?.addEventListener('change', () => renderPatientView());
  statusFilter?.addEventListener('change', () => renderPatientView());
  sortSelect?.addEventListener('change', (e) => {
    patientSortKey = e.target.value;
    renderPatientView();
  });
  btnNew?.addEventListener('click', () => openPatientModal(null));

  setupPatientModalListeners();
}

/** YYYY-MM-DD → YYYY/MM/DD */
function formatSlashDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return dateStr.trim();
}

/** YYYY-MM-DD → M/D */
function formatShortMd(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

/**
 * 終了・退院日（正本 exitDate）。旧フィールドは下位互換で読取のみ
 * @param {Object} patient
 * @returns {string} YYYY-MM-DD
 */
function resolvePatientExitDate(patient) {
  if (!patient) return '';
  const raw = patient.exitDate
    || patient.discontinuedDate
    || patient.endDate
    || patient.dischargeDate
    || patient.finishDate
    || patient.stoppedDate
    || patient.plannedDischargeDate
    || '';
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw.trim().slice(0, 10);
}

/**
 * 基準日時点で退院・終了済みか（exitDate 当日以降）
 * @param {Object} patient
 * @param {Date|string} [asOf=new Date()]
 * @returns {boolean}
 */
export function isPatientDischarged(patient, asOf = new Date()) {
  const discharge = resolvePatientExitDate(patient);
  if (!discharge || typeof discharge !== 'string') return false;
  let asOfStr = '';
  if (asOf instanceof Date && !isNaN(asOf.getTime())) {
    asOfStr = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;
  } else if (typeof asOf === 'string') {
    asOfStr = asOf.trim().slice(0, 10);
  }
  if (!asOfStr) return false;
  return asOfStr >= discharge.slice(0, 10);
}

/**
 * 計画書フェーズ＋総合計画評価料2切替日セル
 * @param {Object} patient
 * @param {Object} deadlines
 * @returns {string}
 */
function getPlanPhaseCellHtml(patient, deadlines) {
  let badgeHtml = '<span style="color:#64748b; font-size:0.72rem;">未算定(初回)</span>';
  if (patient.planStatus === 'PLAN_2_FOLLOW') {
    badgeHtml = '<span style="color:#7c3aed; font-weight:800; background:#f5f3ff; border:1px solid #ddd6fe; padding:2px 5px; border-radius:3px; font-size:0.72rem;">計2継続(196点)</span>';
  } else if (patient.planStatus === 'PLAN_1_FOLLOW') {
    badgeHtml = '<span style="color:#0369a1; font-weight:700; background:#e0f2fe; padding:2px 5px; border-radius:3px; font-size:0.72rem;">計1継続(240点)</span>';
  }

  let subTextHtml = '';
  if (patient.careInsuranceType === 'CARE' && deadlines.plan2TransitionDateStr) {
    const switchSlash = formatSlashDate(deadlines.plan2TransitionDateStr);
    if (deadlines.isPlan2Required || patient.planStatus === 'PLAN_2_FOLLOW') {
      subTextHtml = `<div class="plan2-switch-date" style="font-size:0.68rem; color:#7c3aed; font-weight:700; margin-top:3px; line-height:1.3;">評価2切替日: ${switchSlash} <span style="font-weight:600;">(到達済)</span></div>`;
    } else {
      const remain = deadlines.plan2RemainingDays !== null ? ` <span style="color:#0284c7; font-weight:600;">(残${deadlines.plan2RemainingDays}日)</span>` : '';
      subTextHtml = `<div class="plan2-switch-date" style="font-size:0.68rem; color:#5b21b6; font-weight:700; margin-top:3px; line-height:1.3;">評価2切替日: ${switchSlash}${remain}</div>`;
    }
  }

  return `<div class="plan-phase-cell">${badgeHtml}${subTextHtml}</div>`;
}

/**
 * 早期加算セル（ステータス＋60点／25点満了日）
 * @param {Object} patient
 * @param {Object} deadlines
 * @returns {string}
 */
function getEarlyBonusCellHtml(patient, deadlines) {
  const isOut = patient.category === 'OUTPATIENT';
  if (isOut) {
    return '<span class="text-muted" style="color:#94a3b8; font-size:0.72rem;">- (外来対象外)</span>';
  }

  const earlyStart = deadlines.earlyStartDateStr || patient.earlyBonusStartDate || patient.admissionDate || '';
  if (!earlyStart) {
    return '<span class="text-muted" style="color:#94a3b8; font-size:0.72rem;">起算日未設定</span>';
  }

  const eb = deadlines.earlyBonus || {};
  let badgeHtml = '';
  if (eb.phase === 'PHASE_1' && eb.points > 0) {
    badgeHtml = '<span class="early-badge early-badge-60" style="background:#d1fae5; color:#059669; padding:1px 5px; border-radius:3px; font-weight:700; font-size:0.72rem;">早60点</span>';
  } else if (eb.phase === 'PHASE_2' && eb.points > 0) {
    badgeHtml = '<span class="early-badge early-badge-25" style="background:#e0f2fe; color:#0284c7; padding:1px 5px; border-radius:3px; font-weight:700; font-size:0.72rem;">早25点</span>';
  } else {
    badgeHtml = '<span class="early-badge early-badge-done" style="background:#f1f5f9; color:#64748b; padding:1px 5px; border-radius:3px; font-weight:700; font-size:0.72rem;">満了</span>';
  }

  const p1Slash = formatSlashDate(deadlines.earlyPhase1EndDateStr || eb.phase1EndDateStr);
  const p2Slash = formatSlashDate(deadlines.earlyPhase2EndDateStr || eb.phase2EndDateStr);
  const datesHtml = (p1Slash || p2Slash)
    ? `<div class="early-bonus-dates" style="font-size:0.68rem; color:#475569; margin-top:3px; line-height:1.35; text-align:left;">
        <div><span style="color:#0284c7; font-weight:600;">60点満了:</span> ${p1Slash || '-'}</div>
        <div><span style="color:#64748b; font-weight:600;">25点満了:</span> ${p2Slash || '-'}</div>
      </div>`
    : '';

  return `<div class="early-bonus-cell" style="display:inline-flex; flex-direction:column; align-items:center;">${badgeHtml}${datesHtml}</div>`;
}

function comparePatientId(a, b) {
  return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
}

function compareDateDesc(aDate, bDate) {
  const a = aDate || '';
  const b = bDate || '';
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.localeCompare(a);
}

function sortPatientList(list, sortKey) {
  const today = new Date();
  return [...list].sort((a, b) => {
    let diff = 0;
    if (sortKey === 'KANA_ASC') {
      const kanaA = normalizeToKatakana(a.nameKana || a.name || '');
      const kanaB = normalizeToKatakana(b.nameKana || b.name || '');
      diff = kanaA.localeCompare(kanaB, 'ja');
    } else if (sortKey === 'DEADLINE_URGENT') {
      const remainA = calculatePatientDeadlines(a, today).remainingDays;
      const remainB = calculatePatientDeadlines(b, today).remainingDays;
      const scoreA = typeof remainA === 'number' ? remainA : 9999;
      const scoreB = typeof remainB === 'number' ? remainB : 9999;
      diff = scoreA - scoreB;
    } else if (sortKey === 'ONSET_DESC') {
      diff = compareDateDesc(a.onsetDate, b.onsetDate);
    } else if (sortKey === 'ADMISSION_DESC') {
      diff = compareDateDesc(a.admissionDate, b.admissionDate);
    } else {
      diff = comparePatientId(a, b);
    }
    return diff || comparePatientId(a, b);
  });
}

export function renderPatientView() {
  const container = document.getElementById('patientTableContainer');
  if (!container) return;

  const keyword = document.getElementById('patientSearchInput')?.value || '';
  const category = document.getElementById('patientCategoryFilter')?.value || 'ALL';
  const statusFilter = document.getElementById('patientStatusFilter')?.value || 'ACTIVE';

  const includeDiscontinued = statusFilter !== 'ACTIVE';
  let patients = searchPatients(keyword, category, includeDiscontinued);

  if (statusFilter === 'ACTIVE') {
    patients = patients.filter((p) => p.status !== PATIENT_STATUS.DISCONTINUED);
  } else if (statusFilter === 'DISCONTINUED') {
    patients = patients.filter((p) => p.status === PATIENT_STATUS.DISCONTINUED);
  }

  patients = sortPatientList(patients, patientSortKey);

  if (patients.length === 0) {
    container.innerHTML = '<div style="padding:32px; text-align:center; color:#94a3b8; font-size:0.85rem;">該当する患者データがありません</div>';
    return;
  }

  let html = `
    <table class="modern-table" style="width:100%; table-layout:auto; font-size:0.78rem;">
      <thead>
        <tr>
          <th style="padding:6px 6px; text-align:center; width:64px;">状態</th>
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
          <th style="padding:6px 6px; text-align:center;">計画書フェーズ / 移行予定</th>
          <th style="padding:6px 6px; text-align:center; width:54px;">操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  const today = new Date();
  patients.forEach((p) => {
    const dl = calculatePatientDeadlines(p, today);
    const isOut = p.category === 'OUTPATIENT';
    const isDiscontinued = p.status === PATIENT_STATUS.DISCONTINUED;
    const exitDate = resolvePatientExitDate(p);
    const discharged = !isOut && isPatientDischarged(p, today);

    let statusBadge = isDiscontinued
      ? '<span style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1; padding:2px 5px; border-radius:3px; font-weight:700; font-size:0.68rem;">■ 終了</span>'
      : '<span style="background:#dcfce7; color:#15803d; border:1px solid #86efac; padding:2px 5px; border-radius:3px; font-weight:700; font-size:0.68rem;">● 継続</span>';
    if (discharged && !isDiscontinued) {
      statusBadge = '<span class="badge-discharged" style="background:#ffedd5; color:#9a3412; border:1px solid #fdba74; padding:2px 5px; border-radius:3px; font-weight:700; font-size:0.68rem;">退院済</span>';
    }

    const catBadge = isOut ? '<span style="color:#2563eb; font-weight:700;">外</span>' : '<span style="color:#d97706; font-weight:700;">入</span>';

    // 氏名横バッジ: 終了・退院日（exitDate）
    let nameSideBadge = '';
    if (exitDate) {
      const md = formatShortMd(exitDate);
      if (isDiscontinued || discharged) {
        nameSideBadge = `<span class="badge-discharge-date" title="終了・退院日">${md} ${isOut ? '終了' : '退院'}</span>`;
      } else {
        nameSideBadge = `<span class="badge-discharge-planned" title="終了・退院日">${md} 予定</span>`;
      }
    }

    const earlyCellHtml = getEarlyBonusCellHtml(p, dl);

    let limitDisplay = '<span style="color:#94a3b8;">上限なし</span>';
    if (dl.limitDateStr) {
      if (dl.isLimitExceeded) {
        limitDisplay = `<span style="color:#e11d48; font-weight:700;">超過 (${dl.remainingDays}日)</span>`;
      } else {
        const warnStyle = (dl.remainingDays <= 30) ? 'color:#d97706; font-weight:700;' : 'color:#334155;';
        limitDisplay = `<span style="${warnStyle}">${formatSlashDate(dl.limitDateStr)} (${dl.remainingDays}日)</span>`;
      }
    }

    let careDisplay = '<span style="color:#94a3b8;">なし</span>';
    if (p.careInsuranceType === 'CARE') careDisplay = '<span style="color:#7c3aed; font-weight:700;">要介護</span>';
    else if (p.careInsuranceType === 'SUPPORT') careDisplay = '<span style="color:#059669; font-weight:700;">要支援</span>';

    const rowStyle = isDiscontinued ? 'opacity:0.68; background:#f8fafc;' : '';

    html += `
      <tr style="${rowStyle}">
        <td style="padding:6px 6px; text-align:center;">${statusBadge}</td>
        <td style="padding:6px 6px;"><strong>${p.id}</strong></td>
        <td style="padding:6px 8px; white-space:nowrap;"><strong>${sanitizeHtml(p.name)}</strong>${nameSideBadge ? ` ${nameSideBadge}` : ''}<br><span style="font-size:0.68rem; color:#64748b;">${sanitizeHtml(p.nameKana || '')}</span></td>
        <td style="padding:6px 6px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${sanitizeHtml(p.diseaseName || '')}">${sanitizeHtml(p.diseaseName || '-')}</td>
        <td style="padding:6px 4px; text-align:center;">${catBadge}</td>
        <td style="padding:6px 4px; text-align:center;"><span style="font-size:0.72rem; background:#f1f5f9; padding:1px 4px; border-radius:3px;">${dl.diseaseLabel}</span></td>
        <td style="padding:6px 4px; text-align:center;">${careDisplay}</td>
        <td style="padding:6px 6px; font-size:0.75rem; white-space:nowrap;">${formatSlashDate(p.admissionDate) || '-'}</td>
        <td style="padding:6px 6px; font-size:0.75rem; white-space:nowrap;">${formatSlashDate(p.onsetDate || p.admissionDate) || '-'}</td>
        <td style="padding:6px 6px; text-align:center; vertical-align:middle;">${earlyCellHtml}</td>
        <td style="padding:6px 6px; font-size:0.75rem; white-space:nowrap;">${limitDisplay}</td>
        <td style="padding:6px 6px; text-align:center; vertical-align:middle;">${getPlanPhaseCellHtml(p, dl)}</td>
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
  const statusSelect = document.getElementById('patientFormStatus');
  const exitDateInput = document.getElementById('patientFormExitDate');

  btnClose?.addEventListener('click', () => modal.classList.remove('active'));

  btnDelete?.addEventListener('click', () => {
    if (!editingPatientId) return;
    if (!deletePatient(editingPatientId)) return;
    modal.classList.remove('active');
    showToast('患者レコードを削除しました', 'warn');

    if (typeof window.triggerDailyBackup === 'function') {
      window.triggerDailyBackup();
    }

    renderPatientView();
  });

  // ★状態 ↔ 終了・退院日の双方向リアルタイム連動
  statusSelect?.addEventListener('change', (e) => {
    const isDisc = e.target.value === PATIENT_STATUS.DISCONTINUED;
    if (exitDateInput) {
      if (isDisc) {
        // 終了にした際、日付が空なら今日の日付を自動セット
        if (!exitDateInput.value) {
          const today = new Date();
          const y = today.getFullYear();
          const m = String(today.getMonth() + 1).padStart(2, '0');
          const d = String(today.getDate()).padStart(2, '0');
          exitDateInput.value = `${y}-${m}-${d}`;
        }
      } else {
        // 継続（ACTIVE）に戻した際、日付をクリア
        exitDateInput.value = '';
      }
    }
    syncStatusSelectStyle(e.target);
  });

  exitDateInput?.addEventListener('input', (e) => {
    if (!statusSelect) return;
    const dateVal = e.target.value;
    if (dateVal) {
      // 日付が入ったら自動的に「終了」へ（未来の退院予定も含む）
      statusSelect.value = PATIENT_STATUS.DISCONTINUED;
    } else {
      // 日付をクリアしたら「継続」へ復帰
      statusSelect.value = PATIENT_STATUS.ACTIVE;
    }
    syncStatusSelectStyle(statusSelect);
  });

  ['patientFormCareType', 'patientFormDiseaseType', 'patientFormAdmissionDate', 'patientFormOnsetDate'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', updatePlan2GuidePreview);
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const category = document.getElementById('patientFormCategory').value;
    const status = document.getElementById('patientFormStatus')?.value || PATIENT_STATUS.ACTIVE;
    // モーダル連動後の値をそのまま保存（状態と exitDate は常に整合）
    const exitDate = document.getElementById('patientFormExitDate')?.value || '';

    const rawData = {
      id: document.getElementById('patientFormId').value,
      name: document.getElementById('patientFormName').value,
      nameKana: document.getElementById('patientFormKana').value,
      diseaseName: document.getElementById('patientFormDiseaseName').value,
      category,
      status,
      diseaseType: document.getElementById('patientFormDiseaseType').value,
      careInsuranceType: document.getElementById('patientFormCareType').value,
      planStatus: document.getElementById('patientFormPlanStatus')?.value || 'NOT_YET',
      admissionDate: document.getElementById('patientFormAdmissionDate').value,
      earlyBonusStartDate: document.getElementById('patientFormEarlyStartDate').value,
      onsetDate: document.getElementById('patientFormOnsetDate').value,
      exitDate,
      force13Limit: document.getElementById('patientFormForce13').checked,
      defaultUnits: document.getElementById('patientFormDefaultUnits')?.value || 3,
      notes: document.getElementById('patientFormNotes').value
    };

    const res = upsertPatient(rawData);
    if (!res.success) {
      if (!res.storageFailed) showToast(res.message || '患者情報の登録に失敗しました', 'error');
      return;
    }

    modal.classList.remove('active');
    showToast(`患者情報(${res.patient.name})を保存しました`, 'success');

    if (typeof window.triggerDailyBackup === 'function') {
      window.triggerDailyBackup();
    }

    renderPatientView();
  });
}

function syncStatusSelectStyle(selectEl) {
  if (!selectEl) return;
  const isDisc = selectEl.value === PATIENT_STATUS.DISCONTINUED;
  selectEl.style.background = isDisc ? '#f1f5f9' : '#f0fdf4';
  selectEl.style.color = isDisc ? '#64748b' : '#15803d';
}

function openPatientModal(patientId) {
  editingPatientId = patientId;
  const modal = document.getElementById('modalPatientEdit');
  const titleEl = document.getElementById('patientModalTitle');
  const btnDelete = document.getElementById('btnDeletePatient');
  const idInput = document.getElementById('patientFormId');
  const statusSelect = document.getElementById('patientFormStatus');

  titleEl.textContent = patientId ? `患者台帳編集 (${patientId})` : '新規患者登録';
  btnDelete.style.display = patientId ? 'block' : 'none';
  idInput.readOnly = Boolean(patientId);

  const p = patientId ? getPatientById(patientId) : null;
  idInput.value = p ? p.id : '';
  document.getElementById('patientFormName').value = p ? p.name : '';
  document.getElementById('patientFormKana').value = p ? (p.nameKana || '') : '';
  document.getElementById('patientFormDiseaseName').value = p ? (p.diseaseName || '') : '';
  document.getElementById('patientFormCategory').value = p ? p.category : 'INPATIENT';

  if (statusSelect) {
    statusSelect.value = p ? (p.status || PATIENT_STATUS.ACTIVE) : PATIENT_STATUS.ACTIVE;
    syncStatusSelectStyle(statusSelect);
  }

  document.getElementById('patientFormDiseaseType').value = p ? p.diseaseType : 'LOCOMOTIVE';
  document.getElementById('patientFormCareType').value = p ? p.careInsuranceType : 'NONE';

  const planSelect = document.getElementById('patientFormPlanStatus');
  if (planSelect) planSelect.value = p ? (p.planStatus || 'NOT_YET') : 'NOT_YET';

  document.getElementById('patientFormAdmissionDate').value = p ? (p.admissionDate || '') : '';
  document.getElementById('patientFormEarlyStartDate').value = p ? (p.earlyBonusStartDate || '') : '';
  document.getElementById('patientFormOnsetDate').value = p ? (p.onsetDate || '') : '';
  const exitInput = document.getElementById('patientFormExitDate');
  if (exitInput) {
    exitInput.value = p ? resolvePatientExitDate(p) : '';
  }
  document.getElementById('patientFormForce13').checked = Boolean(p?.force13Limit);
  const defaultUnitsSelect = document.getElementById('patientFormDefaultUnits');
  if (defaultUnitsSelect) {
    const du = Number(p?.defaultUnits);
    defaultUnitsSelect.value = String(
      Number.isFinite(du) ? Math.min(4, Math.max(1, Math.round(du))) : 3
    );
  }
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
