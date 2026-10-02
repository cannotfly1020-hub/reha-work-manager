// js/views/monthlyView.js
// VIEW 2: 月間単位表・収益ダッシュボード・消炎鎮痛35点加算・3種ソート制御層（200行制限準拠）

import { REHA_RULES } from '../config/rules.js';
import { safeParseInt, sanitizeHtml, normalizeToKatakana } from '../core/dataNormalizer.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let currentSortKey = 'CATEGORY'; // 'CATEGORY' | 'KANA' | 'ID'

function getLocalTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function initMonthlyView() {
  const monthInput = document.getElementById('monthlyMonthInput');
  const btnPrev = document.getElementById('btnPrevMonth');
  const btnNext = document.getElementById('btnNextMonth');
  const sortSelect = document.getElementById('monthlySortSelect');

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

  sortSelect?.addEventListener('change', (e) => {
    currentSortKey = e.target.value;
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
  const todayStr = getLocalTodayString();
  let todayUnits = 0;
  let todayRevenue = 0;
  let monthUnits = 0;
  let monthRevenue = 0;

  Object.values(aggregated.patientMap).forEach((item) => {
    const p = item.patient;
    const disease = REHA_RULES.LIMIT_DAYS[p.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;

    item.slots.forEach((s) => {
      const isToday = s.date === todayStr;

      // 消炎鎮痛（物療）は1日35点(350円)
      if (s.isAnalgesia) {
        const analgesiaYen = (s.points || 35) * REHA_RULES.POINT_RATE;
        monthRevenue += analgesiaYen;
        if (isToday) todayRevenue += analgesiaYen;
        return;
      }

      // 個別リハビリ単位・加算計算
      const deadlines = calculatePatientDeadlines(p, s.date);
      const basePoint = deadlines.isMaintenanceReduction ? disease.maintPoints : disease.defaultPoints;
      const earlyBonusPerUnit = (deadlines.earlyBonus && deadlines.earlyBonus.points > 0) ? deadlines.earlyBonus.points : 0;

      let slotPoints = (basePoint + earlyBonusPerUnit) * s.units;
      if (s.billingPlan) slotPoints += REHA_RULES.PLAN_POINTS.PLAN_1;

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
  if (unitsTodayEl) unitsTodayEl.textContent = `(${todayUnits}u)`;
  if (revMonthEl) revMonthEl.textContent = `¥${monthRevenue.toLocaleString()}`;
  if (unitsMonthEl) unitsMonthEl.textContent = `(${monthUnits}u)`;
}

function sortPatients(patients, sortKey) {
  return [...patients].sort((a, b) => {
    const pA = a.patient;
    const pB = b.patient;

    if (sortKey === 'KANA') {
      const kanaA = normalizeToKatakana(pA.nameKana || pA.name);
      const kanaB = normalizeToKatakana(pB.nameKana || pB.name);
      return kanaA.localeCompare(kanaB, 'ja');
    }

    if (sortKey === 'ID') {
      return (pA.id || '').localeCompare(pB.id || '', undefined, { numeric: true });
    }

    // デフォルト: CATEGORY (入院 → 外来 → 消炎)
    const getCatScore = (p) => {
      if (p.diseaseType === 'ANALGESIA') return 3;
      if (p.category === 'INPATIENT') return 1;
      return 2;
    };
    const scoreDiff = getCatScore(pA) - getCatScore(pB);
    if (scoreDiff !== 0) return scoreDiff;
    return (pA.id || '').localeCompare(pB.id || '', undefined, { numeric: true });
  });
}

function renderMonthlyUnitsTable(aggregated) {
  const container = document.getElementById('monthlyTableContainer');
  if (!container) return;

  const { daysInMonth, patientMap } = aggregated;
  const rawPatients = Object.values(patientMap);

  if (rawPatients.length === 0) {
    container.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.85rem;">対象月のデータはありません</div>';
    return;
  }

  const patients = sortPatients(rawPatients, currentSortKey);

  let html = `
    <table class="modern-table table-monthly">
      <thead>
        <tr>
          <th class="col-fixed" style="width:110px;">氏名</th>
          <th style="width:32px;">区分</th>
          <th style="width:44px;">当月計</th>
          <th style="width:42px;">計画書</th>
  `;
  for (let d = 1; d <= daysInMonth; d++) {
    html += `<th>${d}</th>`;
  }
  html += `</tr></thead><tbody>`;

  patients.forEach((item) => {
    const p = item.patient;
    const isAnalgesia = p.diseaseType === 'ANALGESIA';
    const isOut = p.category === 'OUTPATIENT';

    let catBadge = isOut
      ? '<span style="color:#2563eb; font-weight:700;">外</span>'
      : '<span style="color:#d97706; font-weight:700;">入</span>';
    if (isAnalgesia) {
      catBadge = '<span style="color:#16a34a; font-weight:700;">消</span>';
    }

    // 13単位制限判定
    const is13Target = !isAnalgesia && (p.careInsuranceType === 'CARE' || p.careInsuranceType === 'SUPPORT' || p.force13Limit);
    const isExceeded = is13Target && item.totalUnits > 13;
    const isNearLimit = is13Target && item.totalUnits >= 11 && item.totalUnits <= 13;

    let totalBadge = `<strong>${item.totalUnits}</strong>`;
    if (isExceeded) {
      totalBadge = `<span style="background:#ffe4e6; color:#e11d48; padding:1px 3px; border-radius:3px; font-weight:700;">${item.totalUnits}!</span>`;
    } else if (isNearLimit) {
      totalBadge = `<span style="background:#fef3c7; color:#b45309; padding:1px 3px; border-radius:3px; font-weight:700;">${item.totalUnits}</span>`;
    }

    const planBadge = item.planCount > 0
      ? '<span style="background:#e0f2fe; color:#0369a1; padding:1px 4px; border-radius:3px; font-weight:700;">済</span>'
      : '<span style="color:#cbd5e1;">-</span>';

    const hasEarly = item.totalEarlyUnits > 0;
    const earlyBadge = hasEarly
      ? `<span class="toggle-early-btn" style="cursor:pointer; margin-left:4px; font-size:0.65rem; background:#ede9fe; color:#7c3aed; padding:0 3px; border-radius:3px; font-weight:700;" title="早期加算内訳">早▼</span>`
      : '';

    html += `
      <tr class="${hasEarly ? 'row-has-early' : ''}" data-target-id="early-${p.id}" style="${hasEarly ? 'cursor:pointer;' : ''}">
        <td class="col-fixed"><strong>${sanitizeHtml(p.name)}</strong>${earlyBadge}</td>
        <td>${catBadge}</td>
        <td>${totalBadge}</td>
        <td>${planBadge}</td>
    `;
    for (let d = 1; d <= daysInMonth; d++) {
      const u = item.dailyUnits[d] || 0;
      html += `<td>${u > 0 ? `<span style="font-weight:700; color:${isAnalgesia ? '#16a34a' : '#0f172a'};">${u}</span>` : '<span style="color:#e2e8f0;">-</span>'}</td>`;
    }
    html += `</tr>`;

    if (hasEarly) {
      html += `
        <tr id="early-${p.id}" class="sub-row-early" style="display:none;">
          <td class="col-fixed" style="font-size:0.72rem; color:#7c3aed; font-weight:700; padding-left:14px;">↳ 早</td>
          <td style="font-size:0.7rem; color:#7c3aed;">加</td>
          <td style="font-weight:700; color:#7c3aed;">${item.totalEarlyUnits}</td>
          <td style="color:#cbd5e1;">-</td>
      `;
      for (let d = 1; d <= daysInMonth; d++) {
        const eu = item.dailyEarlyUnits[d] || 0;
        html += `<td>${eu > 0 ? `<span style="font-weight:700; color:#7c3aed;">${eu}</span>` : '<span style="color:#e2e8f0;">-</span>'}</td>`;
      }
      html += `</tr>`;
    }
  });

  html += `</tbody></table>`;
  container.innerHTML = html;

  container.querySelectorAll('.row-has-early').forEach((row) => {
    row.addEventListener('click', () => {
      const targetId = row.dataset.targetId;
      const subRow = document.getElementById(targetId);
      const btn = row.querySelector('.toggle-early-btn');
      if (subRow) {
        const isHidden = subRow.style.display === 'none';
        subRow.style.display = isHidden ? 'table-row' : 'none';
        if (btn) btn.textContent = isHidden ? '早▲' : '早▼';
      }
    });
  });
}

function renderDailyDiaryPreview(aggregated) {
  const container = document.getElementById('dailyDiaryPreviewContainer');
  if (!container) return;

  const today = new Date();
  const day = (currentYear === today.getFullYear() && currentMonth === (today.getMonth() + 1)) ? today.getDate() : 1;
  const dayData = aggregated.dailyBreakdown[day] || { totalUnits: 0, inpatients: 0, outpatients: 0, planCount: 0, analgesiaTotal: 0 };

  container.innerHTML = `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; font-size:0.85rem;">
      <div style="font-weight:700; color:#0f172a; margin-bottom:6px;">
        📅 ${currentYear}年${currentMonth}月${day}日 業務日誌集計プレビュー (24列目連携)
      </div>
      <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:10px; text-align:center;">
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">当日総単位</div>
          <div style="font-size:1.05rem; font-weight:700; color:#0369a1;">${dayData.totalUnits} u</div>
        </div>
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">入院実施単位</div>
          <div style="font-size:1.05rem; font-weight:700; color:#d97706;">${dayData.inpatients} u</div>
        </div>
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">外来実施単位</div>
          <div style="font-size:1.05rem; font-weight:700; color:#2563eb;">${dayData.outpatients} u</div>
        </div>
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">消炎鎮痛来院</div>
          <div style="font-size:1.05rem; font-weight:700; color:#16a34a;">${dayData.analgesiaTotal || 0} 名</div>
        </div>
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">計画書算定</div>
          <div style="font-size:1.05rem; font-weight:700; color:#854d0e;">${dayData.planCount} 件</div>
        </div>
      </div>
    </div>
  `;
}
