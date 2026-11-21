// js/views/modals/annualStatsModal.js
// 年度統計（年報）モーダル UI

import { sanitizeHtml } from '../../core/dataNormalizer.js';
import {
  getCurrentFiscalYear,
  buildFiscalYearOptions,
  computeAnnualStats,
  saveHospitalDischargeInputs,
  loadHospitalDischargeInputs
} from '../../core/annualStats.js';
import { downloadAnnualStatsExcel } from '../../excel/annualStatsWriter.js';
import { showToast } from '../../ui/toast.js';

/** @type {object|null} */
let currentStats = null;
let loading = false;

function getModal() {
  return document.getElementById('modalAnnualStats');
}

function formatRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return '－';
  return `${rate.toFixed(1)}%`;
}

function formatAvg(avg) {
  if (avg == null || !Number.isFinite(avg)) return '0.00';
  return Number(avg).toFixed(2);
}

/**
 * サマリーカード・テーブルを描画
 * @param {object} stats
 */
function renderStatsContent(stats) {
  currentStats = stats;
  const s = stats.summary || {};

  const elUnits = document.getElementById('annualStatTotalUnits');
  const elDays = document.getElementById('annualStatPatientDays');
  const elAvg = document.getElementById('annualStatAvgUnits');
  const elDisc = document.getElementById('annualStatRehabDischarges');
  if (elUnits) elUnits.textContent = String(s.totalUnits ?? 0);
  if (elDays) elDays.textContent = String(s.patientDays ?? 0);
  if (elAvg) elAvg.textContent = formatAvg(s.avgUnits);
  if (elDisc) elDisc.textContent = String(s.rehabDischarges ?? 0);

  const tbody = document.getElementById('annualStatsTableBody');
  if (!tbody) return;

  tbody.innerHTML = (stats.months || []).map((m) => `
    <tr data-month-key="${sanitizeHtml(m.key)}">
      <td style="font-weight:700;">${sanitizeHtml(m.label)}</td>
      <td class="num">${m.totalUnits}</td>
      <td class="num">${m.patientDays}</td>
      <td class="num">${formatAvg(m.avgUnits)}</td>
      <td class="num">${m.rehabDischarges}</td>
      <td>
        <input type="number" min="0" step="1" class="annual-hospital-input"
          data-month-key="${sanitizeHtml(m.key)}"
          value="${m.hospitalTotal != null ? m.hospitalTotal : ''}"
          placeholder="手入力"
          style="width:72px; padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem; text-align:right;">
      </td>
      <td class="num annual-rate-cell">${formatRate(m.dischargeRate)}</td>
    </tr>
  `).join('');

  const tfoot = document.getElementById('annualStatsTableFoot');
  if (tfoot) {
    tfoot.innerHTML = `
      <tr style="background:#e0f2fe; font-weight:800;">
        <td>年間合計／平均</td>
        <td class="num">${s.totalUnits ?? 0}</td>
        <td class="num">${s.patientDays ?? 0}</td>
        <td class="num">${formatAvg(s.avgUnits)}</td>
        <td class="num">${s.rehabDischarges ?? 0}</td>
        <td class="num">${s.hospitalTotal != null ? s.hospitalTotal : '－'}</td>
        <td class="num">${formatRate(s.dischargeRate)}</td>
      </tr>`;
  }

  tbody.querySelectorAll('.annual-hospital-input').forEach((input) => {
    input.addEventListener('change', () => persistHospitalInputsFromDom(stats.fiscalYear));
    input.addEventListener('blur', () => persistHospitalInputsFromDom(stats.fiscalYear));
  });
}

/**
 * DOM の病院総退院数を保存し、率だけ再計算表示
 * @param {number} fiscalYear
 */
function persistHospitalInputsFromDom(fiscalYear) {
  const map = {};
  document.querySelectorAll('.annual-hospital-input').forEach((input) => {
    const key = input.getAttribute('data-month-key');
    if (!key) return;
    const raw = String(input.value || '').trim();
    if (raw === '') return;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) map[key] = Math.round(n);
  });
  saveHospitalDischargeInputs(fiscalYear, map);

  if (!currentStats) return;
  const saved = loadHospitalDischargeInputs(fiscalYear);
  currentStats.months = (currentStats.months || []).map((m) => {
    const hospitalTotal = saved[m.key] != null ? Number(saved[m.key]) : null;
    const dischargeRate = (hospitalTotal != null && hospitalTotal > 0)
      ? Math.round((m.rehabDischarges / hospitalTotal) * 1000) / 10
      : null;
    return { ...m, hospitalTotal, dischargeRate };
  });

  const yearRehab = currentStats.months.reduce((s, r) => s + r.rehabDischarges, 0);
  const yearHospital = currentStats.months.reduce(
    (s, r) => s + (r.hospitalTotal != null ? r.hospitalTotal : 0),
    0
  );
  const hasHospital = currentStats.months.some((r) => r.hospitalTotal != null && r.hospitalTotal > 0);
  currentStats.summary = {
    ...currentStats.summary,
    rehabDischarges: yearRehab,
    hospitalTotal: hasHospital ? yearHospital : null,
    dischargeRate: hasHospital
      ? Math.round((yearRehab / yearHospital) * 1000) / 10
      : null
  };

  // 率セルとフッタのみ更新（再集計なし）
  document.querySelectorAll('#annualStatsTableBody tr').forEach((tr) => {
    const key = tr.getAttribute('data-month-key');
    const row = currentStats.months.find((m) => m.key === key);
    const rateCell = tr.querySelector('.annual-rate-cell');
    if (row && rateCell) rateCell.textContent = formatRate(row.dischargeRate);
  });
  const tfoot = document.getElementById('annualStatsTableFoot');
  if (tfoot && currentStats.summary) {
    const s = currentStats.summary;
    tfoot.innerHTML = `
      <tr style="background:#e0f2fe; font-weight:800;">
        <td>年間合計／平均</td>
        <td class="num">${s.totalUnits ?? 0}</td>
        <td class="num">${s.patientDays ?? 0}</td>
        <td class="num">${formatAvg(s.avgUnits)}</td>
        <td class="num">${s.rehabDischarges ?? 0}</td>
        <td class="num">${s.hospitalTotal != null ? s.hospitalTotal : '－'}</td>
        <td class="num">${formatRate(s.dischargeRate)}</td>
      </tr>`;
  }
}

async function loadAndRender(fiscalYear) {
  const statusEl = document.getElementById('annualStatsLoadingStatus');
  if (loading) return;
  loading = true;
  if (statusEl) statusEl.textContent = '集計中（過去月データを読み込み）…';
  try {
    const stats = await computeAnnualStats(fiscalYear);
    renderStatsContent(stats);
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    console.error('[annualStatsModal] compute error:', err);
    showToast('年度統計の集計に失敗しました', 'error');
    if (statusEl) statusEl.textContent = '集計に失敗しました';
  } finally {
    loading = false;
  }
}

export function openAnnualStatsModal(preferredFiscalYear) {
  const modal = getModal();
  const select = document.getElementById('annualStatsFiscalYearSelect');
  if (!modal || !select) {
    showToast('年度統計モーダルが見つかりません', 'error');
    return;
  }

  const center = getCurrentFiscalYear();
  const opts = buildFiscalYearOptions(center, 6);
  select.innerHTML = opts.map((o) => (
    `<option value="${o.value}">${sanitizeHtml(o.label)}</option>`
  )).join('');

  const fy = Number(preferredFiscalYear) || center;
  select.value = String(opts.some((o) => o.value === fy) ? fy : center);

  modal.classList.add('active');
  loadAndRender(Number(select.value));
}

export function closeAnnualStatsModal() {
  getModal()?.classList.remove('active');
}

export function setupAnnualStatsModalListeners() {
  const btnOpen = document.getElementById('btnOpenAnnualStats');
  const btnClose = document.getElementById('btnCloseAnnualStats');
  const btnCloseX = document.getElementById('btnCloseAnnualStatsX');
  const select = document.getElementById('annualStatsFiscalYearSelect');
  const btnExcel = document.getElementById('btnExportAnnualStatsExcel');

  btnOpen?.addEventListener('click', () => {
    // 月間画面の表示年月から診療報酬年度を推定
    const monthInput = document.getElementById('monthPicker')
      || document.getElementById('monthlyMonthInput');
    let preferred = getCurrentFiscalYear();
    if (monthInput?.value) {
      const [y, m] = String(monthInput.value).split('-').map(Number);
      if (y && m) preferred = m >= 4 ? y : y - 1;
    }
    openAnnualStatsModal(preferred);
  });
  btnClose?.addEventListener('click', () => closeAnnualStatsModal());
  btnCloseX?.addEventListener('click', () => closeAnnualStatsModal());

  select?.addEventListener('change', () => {
    const fy = Number(select.value);
    if (fy) loadAndRender(fy);
  });

  btnExcel?.addEventListener('click', () => {
    if (!currentStats) {
      showToast('先に年度統計を表示してください', 'warn');
      return;
    }
    try {
      persistHospitalInputsFromDom(currentStats.fiscalYear);
      downloadAnnualStatsExcel(currentStats);
      showToast(`${currentStats.fiscalYear}年度の統計Excelを出力しました`, 'success');
    } catch (err) {
      console.error('[annualStatsModal] excel error:', err);
      showToast('Excel出力に失敗しました', 'error');
    }
  });
}
