// js/views/monthly/unitsTable.js
// 月間単位表（退院予定日バッジ・退院翌日以降セルのグレーアウト対応）

import { REHA_RULES } from '../../config/rules.js';
import { sanitizeHtml, normalizeToKatakana } from '../../core/dataNormalizer.js';
import { checkMonth13UnitsViolation } from '../../core/deadlineCalc.js';
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

/**
 * 対象月における退院日情報（未設定は null）
 * @param {Object} patient
 * @param {number} year
 * @param {number} month
 * @returns {{ day: number, dateStr: string, isPastOrToday: boolean, label: string }|null}
 */
function resolveDischargeInMonth(patient, year, month) {
  const dateStr = patient?.exitDate || patient?.plannedDischargeDate || patient?.discontinuedDate || patient?.endDate;
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (y !== Number(year) || mo !== Number(month)) return null;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isPastOrToday = todayStr >= dateStr;
  const md = `${mo}/${day}`;
  return {
    day,
    dateStr,
    isPastOrToday,
    label: isPastOrToday ? `[${md} 退院]` : `[${md} 退院予定]`
  };
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
  const year = monthlyState.year;
  const month = monthlyState.month;

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
    const dischargeInfo = (!isOut && !isAnalgesia) ? resolveDischargeInMonth(p, year, month) : null;

    let catBadge = isOut
      ? '<span style="color:#2563eb; font-weight:700;">外</span>'
      : '<span style="color:#d97706; font-weight:700;">入</span>';
    if (isAnalgesia) {
      catBadge = '<span style="color:#16a34a; font-weight:700;">消</span>';
    }

    // 月13単位⚠️は介護保険の有無・点数減算と独立。医療保険のみでも期限超過後は警告対象。
    const dailyUnitsMap = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
      dailyUnitsMap[day] = item.dailyRehaUnits?.[day] || 0;
    }
    const violation = checkMonth13UnitsViolation(p, monthlyState.year, monthlyState.month, dailyUnitsMap);
    const isNearLimit = !violation.isOver13
      && violation.reason !== 'WITHIN_LIMIT'
      && violation.reason !== 'NOT_APPLICABLE'
      && violation.reason !== 'NO_LIMIT_RULE'
      && violation.applicableUnits >= 11
      && violation.applicableUnits <= 13;

    let totalTitle = '';
    if (violation.reason === 'EXPIRED_DURING_MONTH') {
      totalTitle = `算定期限超過後(${violation.applicableUnits}単位)が月13単位制限を超えています`;
    } else if (violation.reason === 'EXPIRED_BEFORE_MONTH') {
      totalTitle = '算定期限超過患者のため月13単位制限を超えています';
    } else if (violation.reason === 'FORCE_13_LIMIT') {
      totalTitle = '個別13単位制限設定中';
    }

    let totalBadge = `<strong>${item.totalUnits}</strong>`;
    if (violation.isOver13) {
      totalBadge = `<span style="color:#dc2626; font-weight:800;" title="${sanitizeHtml(totalTitle)}">${item.totalUnits}⚠️</span>`;
    } else if (isNearLimit) {
      totalBadge = `<span style="background:#fef3c7; color:#b45309; padding:1px 3px; border-radius:3px; font-weight:700;" title="${sanitizeHtml(totalTitle)}">${item.totalUnits}</span>`;
    }

    const planBadge = item.planCount > 0
      ? '<span style="background:#e0f2fe; color:#0369a1; padding:1px 4px; border-radius:3px; font-weight:700;">済</span>'
      : '<span style="color:#cbd5e1;">-</span>';

    const hasEarly = item.totalEarlyUnits > 0;
    const earlyBadge = hasEarly
      ? `<span class="toggle-early-btn" style="cursor:pointer; margin-left:4px; font-size:0.65rem; background:#ede9fe; color:#7c3aed; padding:0 3px; border-radius:3px; font-weight:700;" title="早期加算内訳">早▼</span>`
      : '';

    const dischargeBadgeHtml = dischargeInfo
      ? `<span class="${dischargeInfo.isPastOrToday ? 'badge-monthly-discharged' : 'badge-monthly-discharge-planned'}" title="退院予定日: ${sanitizeHtml(dischargeInfo.dateStr)}">${sanitizeHtml(dischargeInfo.label)}</span>`
      : '';

    html += `
      <tr class="${hasEarly ? 'row-has-early' : ''}${dischargeInfo ? ' row-has-discharge' : ''}" data-target-id="early-${p.id}" style="${hasEarly ? 'cursor:pointer;' : ''}">
        <td class="col-fixed"><strong>${sanitizeHtml(p.name)}</strong>${earlyBadge}${dischargeBadgeHtml ? `<br>${dischargeBadgeHtml}` : ''}</td>
        <td>${catBadge}</td>
        <td>${totalBadge}</td>
        <td>${planBadge}</td>
    `;
    for (let d = 1; d <= daysInMonth; d++) {
      const u = item.dailyUnits[d] || 0;
      const isAfterDischarge = dischargeInfo && d > dischargeInfo.day;
      const isDischargeDay = dischargeInfo && d === dischargeInfo.day;
      let cellClass = '';
      if (isAfterDischarge) cellClass = 'cell-after-discharge';
      else if (isDischargeDay) cellClass = 'cell-discharge-day';

      if (isAfterDischarge) {
        html += `<td class="${cellClass}">${u > 0 ? `<span class="unit-after-discharge">${u}</span>` : '<span class="dash-after-discharge">-</span>'}</td>`;
      } else if (u > 0) {
        html += `<td class="${cellClass}"><span style="font-weight:700; color:${isAnalgesia ? '#16a34a' : '#0f172a'};">${u}</span></td>`;
      } else {
        html += `<td class="${cellClass}"><span style="color:#e2e8f0;">-</span></td>`;
      }
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
        const isAfterDischarge = dischargeInfo && d > dischargeInfo.day;
        const cellClass = isAfterDischarge ? 'cell-after-discharge' : '';
        html += `<td class="${cellClass}">${eu > 0 ? `<span style="font-weight:700; color:#7c3aed;">${eu}</span>` : '<span style="color:#e2e8f0;">-</span>'}</td>`;
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
