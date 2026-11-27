// js/views/modals/monthlyDeadlineModal.js
// 本日時間割「当月期限」一覧モーダル（読み取り専用）

import { REHA_RULES } from '../../config/rules.js';
import { sanitizeHtml } from '../../core/dataNormalizer.js';
import { calculatePatientDeadlines } from '../../core/deadlineCalc.js';
import {
  getAllPatients,
  evaluatePatientStatus
} from '../../store/patientStore.js';
import { scheduleState } from '../schedule/scheduleState.js';
import {
  formatYmdSlash,
  formatCareLabel,
  getDiseaseLimitUrgency
} from '../schedule/deadlineUrgencyUi.js';

function getModal() {
  return document.getElementById('modalMonthlyDeadline');
}

/**
 * 表示中日付の年月（YYYY-MM）
 * @param {string} [dateStr]
 * @returns {string}
 */
export function resolveVisibleYearMonth(dateStr = scheduleState.dateStr) {
  return String(dateStr || '').slice(0, 7);
}

/**
 * 当月に算定満了日を迎える在籍中の疾患別リハ患者一覧
 * @param {string} yearMonth YYYY-MM
 * @param {string} baseDateStr 残り日数判定の基準日
 * @returns {Array<object>}
 */
export function listPatientsWithLimitInMonth(yearMonth, baseDateStr) {
  const ym = String(yearMonth || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return [];

  const base = baseDateStr || `${ym}-01`;
  const patients = getAllPatients(true) || [];

  const rows = [];
  patients.forEach((p) => {
    if (!p || p.diseaseType === 'ANALGESIA') return;
    if (evaluatePatientStatus(p, base).isEffectiveDiscontinued) return;

    const disease = REHA_RULES.LIMIT_DAYS[p.diseaseType];
    if (!disease || !(disease.days < 9000)) return;

    const dl = calculatePatientDeadlines(p, base);
    if (!dl.limitDateStr || !String(dl.limitDateStr).startsWith(ym)) return;

    const urgency = getDiseaseLimitUrgency(p, base);
    rows.push({
      patient: p,
      categoryLabel: p.category === 'OUTPATIENT' ? '外来' : '入院',
      diseaseLabel: dl.diseaseLabel || disease.shortLabel || p.diseaseType || '—',
      startDateStr: dl.startDateStr || '',
      limitDateStr: dl.limitDateStr,
      remainingDays: dl.remainingDays,
      isExceeded: Boolean(dl.isLimitExceeded) || Number(dl.remainingDays) < 0,
      statusText: urgency?.statusText
        || (dl.remainingDays === 0
          ? '本日満了'
          : (Number(dl.remainingDays) < 0
            ? `超過${Math.abs(Number(dl.remainingDays))}日`
            : `残${dl.remainingDays}日`)),
      careLabel: formatCareLabel(p),
      urgencyLevel: urgency?.level || (dl.isLimitExceeded ? 'exceeded' : null)
    });
  });

  rows.sort((a, b) => String(a.limitDateStr).localeCompare(String(b.limitDateStr))
    || String(a.patient?.name || '').localeCompare(String(b.patient?.name || ''), 'ja'));
  return rows;
}

/**
 * ツールバーボタンの件数表示を更新
 * @param {string} [dateStr]
 * @returns {number}
 */
export function updateMonthlyDeadlineButtonCount(dateStr = scheduleState.dateStr) {
  const btn = document.getElementById('btnMonthlyDeadline');
  const countEl = document.getElementById('monthlyDeadlineCountBadge');
  if (!btn && !countEl) return 0;

  const ym = resolveVisibleYearMonth(dateStr);
  const count = listPatientsWithLimitInMonth(ym, dateStr).length;

  if (countEl) {
    countEl.textContent = String(count);
    countEl.style.display = count > 0 ? 'inline-block' : 'none';
  }
  if (btn) {
    const [yy, mm] = ym.split('-');
    const monthLabel = `${yy}年${Number(mm)}月`;
    btn.title = count > 0
      ? `${monthLabel}に算定満了を迎える患者: ${count}名`
      : `${monthLabel}に算定満了を迎える患者はいません`;
    btn.setAttribute('data-count', String(count));
    btn.classList.toggle('has-items', count > 0);
  }
  return count;
}

function statusClass(level, isExceeded) {
  if (isExceeded || level === 'exceeded') return 'status-exceeded';
  if (level === 'today') return 'status-today';
  if (level === 'danger') return 'status-danger';
  if (level === 'warn') return 'status-warn';
  return '';
}

function renderTable(rows, yearMonth, baseDateStr) {
  const titleEl = document.getElementById('monthlyDeadlineModalTitle');
  const subEl = document.getElementById('monthlyDeadlineModalSub');
  const tbody = document.getElementById('monthlyDeadlineTableBody');
  if (!tbody) return;

  const [y, m] = String(yearMonth).split('-');
  if (titleEl) titleEl.textContent = `⏰ 当月期限一覧（${y}年${Number(m)}月）`;
  if (subEl) {
    subEl.textContent = `基準日: ${formatYmdSlash(baseDateStr)} ／ 算定満了日が当月の疾患別リハ患者（消炎・終了済み除外）・満了日の早い順`;
  }

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:24px 12px; color:#64748b; font-size:0.85rem;">
          当月中に算定期限を迎える患者はいません
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r) => {
    const p = r.patient || {};
    const stCls = statusClass(r.urgencyLevel, r.isExceeded);
    return `
      <tr>
        <td>${sanitizeHtml(r.categoryLabel)}</td>
        <td style="font-weight:700;">${sanitizeHtml(p.name || '—')}<div style="font-size:0.68rem; color:#64748b; font-weight:600;">${sanitizeHtml(p.id || '')}</div></td>
        <td>${sanitizeHtml(r.diseaseLabel)}</td>
        <td>${sanitizeHtml(formatYmdSlash(r.startDateStr))}</td>
        <td style="font-weight:800;">${sanitizeHtml(formatYmdSlash(r.limitDateStr))}</td>
        <td><span class="monthly-deadline-status ${stCls}">${sanitizeHtml(r.statusText)}</span></td>
        <td>${sanitizeHtml(r.careLabel)}</td>
      </tr>`;
  }).join('');
}

/**
 * @param {string} [dateStr]
 */
export function openMonthlyDeadlineModal(dateStr = scheduleState.dateStr) {
  const modal = getModal();
  if (!modal) return;

  const base = dateStr || scheduleState.dateStr;
  const ym = resolveVisibleYearMonth(base);
  const rows = listPatientsWithLimitInMonth(ym, base);
  renderTable(rows, ym, base);
  updateMonthlyDeadlineButtonCount(base);
  modal.classList.add('active');
}

export function closeMonthlyDeadlineModal() {
  getModal()?.classList.remove('active');
}

export function setupMonthlyDeadlineModalListeners() {
  const btn = document.getElementById('btnMonthlyDeadline');
  const btnClose = document.getElementById('btnCloseMonthlyDeadline');
  const btnCloseX = document.getElementById('btnCloseMonthlyDeadlineX');
  const modal = getModal();

  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = 'true';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openMonthlyDeadlineModal(scheduleState.dateStr);
    });
  }
  if (btnClose && !btnClose.dataset.bound) {
    btnClose.dataset.bound = 'true';
    btnClose.addEventListener('click', () => closeMonthlyDeadlineModal());
  }
  if (btnCloseX && !btnCloseX.dataset.bound) {
    btnCloseX.dataset.bound = 'true';
    btnCloseX.addEventListener('click', () => closeMonthlyDeadlineModal());
  }
  if (modal && !modal.dataset.boundOverlay) {
    modal.dataset.boundOverlay = 'true';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeMonthlyDeadlineModal();
    });
  }
}
