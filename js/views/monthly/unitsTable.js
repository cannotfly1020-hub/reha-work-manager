// js/views/monthly/unitsTable.js
// 月間単位表

import { REHA_RULES } from '../../config/rules.js';
import { sanitizeHtml, normalizeToKatakana } from '../../core/dataNormalizer.js';
import { calculatePatientDeadlines } from '../../core/deadlineCalc.js';
import { monthlyState } from './monthlyState.js';

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

export function renderMonthlyUnitsTable(aggregated) {
  const container = document.getElementById('monthlyTableContainer');
  if (!container) return;

  const { daysInMonth, patientMap } = aggregated;
  const rawPatients = Object.values(patientMap);

  if (rawPatients.length === 0) {
    container.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.85rem;">対象月のデータはありません</div>';
    return;
  }

  const patients = sortPatients(rawPatients, monthlyState.sortKey);

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
