// js/views/monthly/unitsTable.js
// 月間単位表（退院予定日バッジ・退院翌日以降セルのグレーアウト・臨床クイックフィルター対応）

import { REHA_RULES } from '../../config/rules.js';
import { sanitizeHtml, normalizeToKatakana } from '../../core/dataNormalizer.js';
import { calculatePatientDeadlines, checkMonth13UnitsViolation } from '../../core/deadlineCalc.js';
import { monthlyState, MONTHLY_QUICK_FILTERS } from './monthlyState.js';
import { printPatientMonthlyReport } from '../../print/patientMonthlyReportPrint.js';
import { showToast } from '../../ui/toast.js';

/**
 * 疾患別ソート用ランク（運動器 → 脳血管 → 廃用 → その他個別 → 消炎 → 未設定）
 * diseaseType コードを最優先し、病名テキストからもフォールバック判定する。
 * @param {object} patient
 * @returns {number}
 */
function getDiseaseSortRank(patient) {
  const type = String(patient?.diseaseType || '').toUpperCase();
  if (type === 'LOCOMOTIVE') return 1;
  if (type === 'CEREBROVASCULAR') return 2;
  if (type === 'DISUSE') return 3;
  if (type === 'RESPIRATORY' || type === 'CARDIOVASCULAR' || type === 'CANCER') return 4;
  if (type === 'ANALGESIA') return 8;

  const text = (
    `${patient?.diseaseType || ''} ${patient?.disease || ''} ${patient?.diagnosis || ''} ${patient?.diseaseName || ''} ${patient?.diseaseLabel || ''}`
  ).toLowerCase();

  // 1. 運動器
  if (text.includes('運動') || text.includes('loco') || text.includes('ortho')) {
    return 1;
  }
  // 2. 脳血管等
  if (text.includes('脳') || text.includes('cerebro') || text.includes('neuro')) {
    return 2;
  }
  // 3. 廃用症候群
  if (text.includes('廃用') || text.includes('disuse')) {
    return 3;
  }
  // 4. 呼吸器・心大血管・がん等（その他個別リハ）
  if (text.includes('呼吸') || text.includes('心大') || text.includes('心大血管') || text.includes('がん') || text.includes('癌')) {
    return 4;
  }
  // 5. 消炎鎮痛のみ
  if (patient?.isInflammation || patient?.isInflammationOnly || text.includes('消炎') || text.includes('analges')) {
    return 8;
  }
  // 6. 未設定・その他
  return 9;
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

    // 疾患別 (運動器 → 脳血管 → 廃用 → その他 → 消炎)
    if (sortKey === 'DISEASE' || sortKey === 'disease') {
      const rankDiff = getDiseaseSortRank(pA) - getDiseaseSortRank(pB);
      if (rankDiff !== 0) return rankDiff;
      // 同疾患内は区分（入院→外来）→ ID で安定ソート
      const catA = pA.category === 'INPATIENT' ? 0 : 1;
      const catB = pB.category === 'INPATIENT' ? 0 : 1;
      if (catA !== catB) return catA - catB;
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

/**
 * 維持期・要介護移行期・月13単位制限の管理対象か
 * （算定日数上限超過／当月満了による移行／個別13単位指定）
 * @param {object} item aggregate patientMap entry
 * @param {number} [year]
 * @param {number} [month]
 * @returns {boolean}
 */
export function isMaintenanceTransitionTarget(item, year = monthlyState.year, month = monthlyState.month) {
  const p = item?.patient;
  if (!p || p.diseaseType === 'ANALGESIA') return false;

  const rehaUnits = Number(item?.rehaTotalUnits || 0);
  const hasReha = Boolean(item?.hasRehaSlots) || rehaUnits >= 1;
  if (!hasReha) return false;

  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return false;

  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  if (p.force13Limit === true || p.force13UnitsLimit === true) {
    return true;
  }

  const dailyUnitsMap = {};
  for (let day = 1; day <= daysInMonth; day += 1) {
    dailyUnitsMap[day] = item.dailyRehaUnits?.[day] || 0;
  }
  const violation = checkMonth13UnitsViolation(p, y, m, dailyUnitsMap);
  if (
    violation.reason === 'FORCE_13_LIMIT'
    || violation.reason === 'EXPIRED_BEFORE_MONTH'
    || violation.reason === 'EXPIRED_DURING_MONTH'
  ) {
    return true;
  }

  // 当月末時点で期限超過、または当月内に満了日がある（移行期・月末満了含む）
  const deadlines = calculatePatientDeadlines(p, monthEnd);
  if (deadlines?.isLimitExceeded) return true;
  if (deadlines?.limitDateStr
    && deadlines.limitDateStr >= monthStart
    && deadlines.limitDateStr <= monthEnd) {
    return true;
  }

  return false;
}

/**
 * 集計エントリがクイックフィルター条件に合致するか
 * @param {object} item aggregate patientMap entry
 * @param {string} filterKey
 * @returns {boolean}
 */
export function matchesMonthlyQuickFilter(item, filterKey) {
  const p = item?.patient || {};
  const isOut = p.category === 'OUTPATIENT';
  const isIn = p.category === 'INPATIENT';
  const isAnalgesiaType = p.diseaseType === 'ANALGESIA';
  const rehaUnits = Number(item?.rehaTotalUnits || 0);
  const hasReha = Boolean(item?.hasRehaSlots) || rehaUnits >= 1;
  const hasAnalgesiaOnly = Boolean(item?.hasAnalgesiaSlots) && !hasReha;
  const planCount = Number(item?.planCount || 0);

  switch (filterKey) {
    case MONTHLY_QUICK_FILTERS.PLAN_MISSING:
      // 当月個別リハ実績あり・計画評価料未算定（消炎専任は対象外）
      return hasReha && planCount === 0;
    case MONTHLY_QUICK_FILTERS.INPATIENT:
      // 入院区分（当月退院・退院予定バッジ付き患者も含む。区分は入院のまま）
      return isIn;
    case MONTHLY_QUICK_FILTERS.OUT_ANALGESIA:
      // 外来かつ消炎鎮痛のみ（疾患タイプ or 月内消炎専任実績）
      return isOut && (isAnalgesiaType || hasAnalgesiaOnly);
    case MONTHLY_QUICK_FILTERS.OUT_DISEASE:
      // 外来・疾患別個別リハ（消炎専任を除外）
      return isOut && !isAnalgesiaType && !hasAnalgesiaOnly;
    case MONTHLY_QUICK_FILTERS.MAINTENANCE:
      // 算定日数超過・要介護移行期・月13単位制限の管理対象
      return isMaintenanceTransitionTarget(item, monthlyState.year, monthlyState.month);
    case MONTHLY_QUICK_FILTERS.ALL:
    default:
      return true;
  }
}

/**
 * 各クイックフィルターの該当件数
 * @param {object[]} rawPatients
 * @returns {Record<string, number>}
 */
export function countMonthlyQuickFilters(rawPatients) {
  const counts = {
    [MONTHLY_QUICK_FILTERS.ALL]: rawPatients.length,
    [MONTHLY_QUICK_FILTERS.PLAN_MISSING]: 0,
    [MONTHLY_QUICK_FILTERS.INPATIENT]: 0,
    [MONTHLY_QUICK_FILTERS.OUT_ANALGESIA]: 0,
    [MONTHLY_QUICK_FILTERS.OUT_DISEASE]: 0,
    [MONTHLY_QUICK_FILTERS.MAINTENANCE]: 0,
  };
  rawPatients.forEach((item) => {
    if (matchesMonthlyQuickFilter(item, MONTHLY_QUICK_FILTERS.PLAN_MISSING)) {
      counts[MONTHLY_QUICK_FILTERS.PLAN_MISSING] += 1;
    }
    if (matchesMonthlyQuickFilter(item, MONTHLY_QUICK_FILTERS.INPATIENT)) {
      counts[MONTHLY_QUICK_FILTERS.INPATIENT] += 1;
    }
    if (matchesMonthlyQuickFilter(item, MONTHLY_QUICK_FILTERS.OUT_ANALGESIA)) {
      counts[MONTHLY_QUICK_FILTERS.OUT_ANALGESIA] += 1;
    }
    if (matchesMonthlyQuickFilter(item, MONTHLY_QUICK_FILTERS.OUT_DISEASE)) {
      counts[MONTHLY_QUICK_FILTERS.OUT_DISEASE] += 1;
    }
    if (matchesMonthlyQuickFilter(item, MONTHLY_QUICK_FILTERS.MAINTENANCE)) {
      counts[MONTHLY_QUICK_FILTERS.MAINTENANCE] += 1;
    }
  });
  return counts;
}

/**
 * フィルターバーの件数・アクティブ状態を同期
 * @param {Record<string, number>} counts
 */
export function syncMonthlyQuickFilterBar(counts) {
  const bar = document.getElementById('monthlyQuickFilterBar');
  if (!bar) return;
  const active = monthlyState.quickFilter || MONTHLY_QUICK_FILTERS.ALL;

  bar.querySelectorAll('.monthly-qf-btn').forEach((btn) => {
    const key = btn.getAttribute('data-monthly-filter') || MONTHLY_QUICK_FILTERS.ALL;
    btn.classList.toggle('is-active', key === active);
    const n = counts[key] ?? 0;
    btn.setAttribute('data-count-zero', n === 0 ? '1' : '0');
    const badge = btn.querySelector(`[data-count-for="${key}"]`) || btn.querySelector('.monthly-qf-count');
    if (badge) badge.textContent = String(n);
  });
}

export function renderMonthlyUnitsTable(aggregated) {
  const container = document.getElementById('monthlyTableContainer');
  if (!container) return;

  const { daysInMonth, patientMap } = aggregated;
  const rawPatients = Object.values(patientMap);
  const counts = countMonthlyQuickFilters(rawPatients);
  syncMonthlyQuickFilterBar(counts);

  if (rawPatients.length === 0) {
    container.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.85rem;">対象月のデータはありません</div>';
    return;
  }

  const filterKey = monthlyState.quickFilter || MONTHLY_QUICK_FILTERS.ALL;
  const filtered = rawPatients.filter((item) => matchesMonthlyQuickFilter(item, filterKey));
  const patients = sortPatients(filtered, monthlyState.sortKey);
  const year = monthlyState.year;
  const month = monthlyState.month;

  if (patients.length === 0) {
    const labels = {
      [MONTHLY_QUICK_FILTERS.PLAN_MISSING]: '計画書未算定の該当患者はいません（算定漏れなし）',
      [MONTHLY_QUICK_FILTERS.INPATIENT]: '入院患者の該当はありません',
      [MONTHLY_QUICK_FILTERS.OUT_ANALGESIA]: '外来・消炎鎮痛のみの該当はありません',
      [MONTHLY_QUICK_FILTERS.OUT_DISEASE]: '外来・疾患別リハの該当はありません',
      [MONTHLY_QUICK_FILTERS.MAINTENANCE]: '維持期・移行対象の該当患者はいません',
      [MONTHLY_QUICK_FILTERS.ALL]: '対象月のデータはありません',
    };
    container.innerHTML = `<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.85rem;">${sanitizeHtml(labels[filterKey] || labels.ALL)}</div>`;
    return;
  }

  let html = `
    <table class="modern-table table-monthly">
      <thead>
        <tr>
          <th class="col-fixed" style="width:128px;">氏名</th>
          <th style="width:32px;">区分</th>
          <th style="width:44px;">当月計</th>
          <th style="width:42px;">計画書</th>
          <th style="width:52px;">提出用</th>
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
        <td style="text-align:center; vertical-align:middle;">
          <button type="button" class="btn btn-xs btn-outline-primary btn-print-patient"
            data-patient-id="${sanitizeHtml(p.id)}"
            title="退院・医事課提出用A4印刷"
            style="padding:2px 6px; font-size:0.68rem; font-weight:800; border:1px solid #0284c7; background:#fff; color:#0369a1; border-radius:4px; cursor:pointer; white-space:nowrap;">
            🖨️ 印刷
          </button>
        </td>
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

  // 医事課提出用・患者個人月間実績 A4縦印刷
  container.querySelectorAll('.btn-print-patient').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = btn.getAttribute('data-patient-id');
      if (!pid) {
        showToast('患者IDが取得できません', 'warn');
        return;
      }
      printPatientMonthlyReport(
        pid,
        monthlyState.year,
        monthlyState.month,
        aggregated
      ).catch((err) => {
        console.error('[unitsTable] printPatientMonthlyReport error:', err);
        showToast('印刷の起動に失敗しました', 'error');
      });
    });
  });
}
