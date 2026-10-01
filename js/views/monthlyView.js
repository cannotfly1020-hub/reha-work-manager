// js/views/monthlyView.js
// VIEW 2: 月間単位表・収益ダッシュボード・業務日誌プレビュー制御層（200行制限準拠）

import { REHA_RULES } from '../config/rules.js';
import { safeParseInt, sanitizeHtml } from '../core/dataNormalizer.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;

export function initMonthlyView() {
  const monthInput = document.getElementById('monthlyMonthInput');
  const btnPrev = document.getElementById('btnPrevMonth');
  const btnNext = document.getElementById('btnNextMonth');

  if (monthInput) {
    monthInput.value = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    monthInput.addEventListener('change', (e) => {
      const [y, m] = e.target.value.split('-').map((v) => safeParseInt(v));
      if (y && m) {
        currentYear = y;
        currentMonth = m;
        renderMonthlyView();
      }
    });
  }

  btnPrev?.addEventListener('click', () => {
    currentMonth -= 1;
    if (currentMonth < 1) { currentMonth = 12; currentYear -= 1; }
    syncMonthInput();
    renderMonthlyView();
  });

  btnNext?.addEventListener('click', () => {
    currentMonth += 1;
    if (currentMonth > 12) { currentMonth = 1; currentYear += 1; }
    syncMonthInput();
    renderMonthlyView();
  });
}

function syncMonthInput() {
  const input = document.getElementById('monthlyMonthInput');
  if (input) input.value = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
}

export function renderMonthlyView() {
  const aggregated = aggregateFromAppSchedule(currentYear, currentMonth);
  renderRevenueDashboard(aggregated);
  renderMonthlyUnitsTable(aggregated);
  renderDailyDiaryPreview(aggregated);
}

function renderRevenueDashboard(aggregated) {
  const todayStr = new Date().toISOString().split('T')[0];
  let todayUnits = 0;
  let todayRevenue = 0;
  let monthUnits = 0;
  let monthRevenue = 0;

  Object.values(aggregated.patientMap).forEach((item) => {
    const p = item.patient;
    const disease = REHA_RULES.LIMIT_DAYS[p.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
    
    // スロット単位の収益計算
    item.slots.forEach((s) => {
      const isToday = s.date === todayStr;
      const deadlines = calculatePatientDeadlines(p, s.date);
      const basePoint = deadlines.isMaintenanceReduction ? disease.maintPoints : disease.defaultPoints;
      
      let slotPoints = basePoint * s.units;
      if (s.billingPlan) slotPoints += REHA_RULES.PLAN_POINTS.PLAN_1;
      if (deadlines.earlyBonus && deadlines.earlyBonus.points > 0) {
        slotPoints += deadlines.earlyBonus.points;
      }
      const slotYen = slotPoints * REHA_RULES.POINT_RATE;

      monthUnits += s.units;
      monthRevenue += slotYen;

      if (isToday) {
        todayUnits += s.units;
        todayRevenue += slotYen;
      }
    });
  });

  const revTodayEl = document.getElementById('kpiTodayRevenue');
  const unitsTodayEl = document.getElementById('kpiTodayUnits');
  const revMonthEl = document.getElementById('kpiMonthRevenue');
  const unitsMonthEl = document.getElementById('kpiMonthUnits');

  if (revTodayEl) revTodayEl.textContent = `¥${todayRevenue.toLocaleString()}`;
  if (unitsTodayEl) unitsTodayEl.textContent = `${todayUnits} 単位`;
  if (revMonthEl) revMonthEl.textContent = `¥${monthRevenue.toLocaleString()}`;
  if (unitsMonthEl) unitsMonthEl.textContent = `${monthUnits} 単位`;
}

function renderMonthlyUnitsTable(aggregated) {
  const container = document.getElementById('monthlyTableContainer');
  if (!container) return;

  const { daysInMonth, patientMap } = aggregated;
  const patients = Object.values(patientMap);

  if (patients.length === 0) {
    container.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.85rem;">対象月のデータはありません</div>';
    return;
  }

  let html = `
    <table class="modern-table">
      <thead>
        <tr>
          <th style="min-width:70px;">ID</th>
          <th style="min-width:110px;">氏名</th>
          <th style="min-width:60px;">区分</th>
          <th style="min-width:80px; text-align:right;">当月計</th>
  `;
  for (let d = 1; d <= daysInMonth; d++) {
    html += `<th style="min-width:32px; padding:6px 2px; text-align:center;">${d}</th>`;
  }
  html += `</tr></thead><tbody>`;

  patients.forEach((item) => {
    const p = item.patient;
    const isOut = p.category === 'OUTPATIENT';
    const catBadge = isOut
      ? '<span style="color:#2563eb; font-weight:700;">外来</span>'
      : '<span style="color:#d97706; font-weight:700;">入院</span>';

    // 13単位制限アラート判定
    const is13Target = p.careInsuranceType === 'CARE' || p.careInsuranceType === 'SUPPORT' || p.force13Limit;
    const isExceeded = is13Target && item.totalUnits > 13;
    const isNearLimit = is13Target && item.totalUnits >= 11 && item.totalUnits <= 13;

    let totalBadge = `<strong>${item.totalUnits}</strong>u`;
    if (isExceeded) {
      totalBadge = `<span style="background:#ffe4e6; color:#e11d48; padding:2px 6px; border-radius:4px; font-weight:700;">${item.totalUnits}u (超過)</span>`;
    } else if (isNearLimit) {
      totalBadge = `<span style="background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-weight:700;">${item.totalUnits}u (注意)</span>`;
    }

    html += `
      <tr>
        <td>${p.id}</td>
        <td><strong>${sanitizeHtml(p.name)}</strong></td>
        <td>${catBadge}</td>
        <td style="text-align:right;">${totalBadge}</td>
    `;

    for (let d = 1; d <= daysInMonth; d++) {
      const u = item.dailyUnits[d] || 0;
      const cellVal = u > 0 ? `<span style="font-weight:600; color:#0f172a;">${u}</span>` : '<span style="color:#cbd5e1;">-</span>';
      html += `<td style="text-align:center; padding:6px 2px;">${cellVal}</td>`;
    }
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function renderDailyDiaryPreview(aggregated) {
  const container = document.getElementById('dailyDiaryPreviewContainer');
  if (!container) return;

  const today = new Date();
  const day = (currentYear === today.getFullYear() && currentMonth === (today.getMonth() + 1))
    ? today.getDate()
    : 1;

  const dayData = aggregated.dailyBreakdown[day] || { totalUnits: 0, inpatients: 0, outpatients: 0, planCount: 0 };

  container.innerHTML = `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:16px; font-size:0.85rem;">
      <div style="font-weight:700; color:#0f172a; margin-bottom:8px;">
        📅 ${currentYear}年${currentMonth}月${day}日 業務日誌集計プレビュー (24列目連携)
      </div>
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; text-align:center;">
        <div style="background:#f8fafc; padding:10px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.75rem;">当日総単位</div>
          <div style="font-size:1.1rem; font-weight:700; color:#0369a1;">${dayData.totalUnits} u</div>
        </div>
        <div style="background:#f8fafc; padding:10px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.75rem;">入院実施単位</div>
          <div style="font-size:1.1rem; font-weight:700; color:#d97706;">${dayData.inpatients} u</div>
        </div>
        <div style="background:#f8fafc; padding:10px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.75rem;">外来実施単位</div>
          <div style="font-size:1.1rem; font-weight:700; color:#2563eb;">${dayData.outpatients} u</div>
        </div>
        <div style="background:#f8fafc; padding:10px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.75rem;">計画書算定</div>
          <div style="font-size:1.1rem; font-weight:700; color:#854d0e;">${dayData.planCount} 件</div>
        </div>
      </div>
    </div>
  `;
}
