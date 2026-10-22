// js/views/monthly/revenueDashboard.js
// 月間収益の数値と本日内訳モーダル

import { REHA_RULES } from '../../config/rules.js';
import { calculatePatientDeadlines, getDailyBasePoints } from '../../core/deadlineCalc.js';
import { getLocalDateStr } from '../../core/dateUtils.js';
import { monthlyState } from './monthlyState.js';

function getPlanPoints(planKey) {
  if (!planKey) return 0;
  if (typeof planKey === 'string' && REHA_RULES.PLAN_POINTS[planKey]) {
    return REHA_RULES.PLAN_POINTS[planKey];
  }
  // 未知キーは過大計上を避け 0（旧データで true 等の残骸があった場合の防御）
  return 0;
}

export function renderRevenueDashboard(aggregated) {
  const todayStr = getLocalDateStr();
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

      // 実施日単位で単価を判定（当月中期限切れは日割り。医療保険のみは超過後も正規点数）
      const deadlines = calculatePatientDeadlines(p, s.date);
      const rate = getDailyBasePoints(p, s.date);
      const basePoint = rate.points || disease.defaultPoints;
      const earlyBonusPerUnit = (deadlines.earlyBonus && deadlines.earlyBonus.points > 0) ? deadlines.earlyBonus.points : 0;

      let slotPoints = (basePoint + earlyBonusPerUnit) * s.units;
      if (s.billingPlan) {
        slotPoints += getPlanPoints(s.billingPlan);
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
  if (unitsTodayEl) unitsTodayEl.textContent = `(${todayUnits}単位)`;
  if (revMonthEl) revMonthEl.textContent = `¥${monthRevenue.toLocaleString()}`;
  if (unitsMonthEl) unitsMonthEl.textContent = `(${monthUnits}単位)`;
}

export function setupRevenueBreakdownModalListeners() {
  const modal = document.getElementById('modalRevenueBreakdown');
  const btnClose = document.getElementById('btnCloseRevenueModal');
  const btnCloseX = document.getElementById('btnCloseRevenueModalX');

  btnClose?.addEventListener('click', () => modal?.classList.remove('active'));
  btnCloseX?.addEventListener('click', () => modal?.classList.remove('active'));
}

export function openRevenueBreakdownModal() {
  const modal = document.getElementById('modalRevenueBreakdown');
  const tbody = document.getElementById('revenueBreakdownTbody');
  const totalUnitsCell = document.getElementById('breakdownTotalUnitsCell');
  const totalAmountCell = document.getElementById('breakdownTotalAmountCell');
  const titleEl = document.getElementById('revenueBreakdownTitle');

  if (!modal || !tbody || !monthlyState.lastAggregated) return;

  const todayStr = getLocalDateStr();
  if (titleEl) {
    titleEl.textContent = `📊 本日リハビリ収益 内訳明細 (${todayStr})`;
  }

  // 9項目の集計カウンタ定義
  const breakdown = {
    LOCO_STD: { name: '運動器リハ(Ⅱ)', units: 0, points: 170, amount: 0, unitLabel: '単位' },
    LOCO_MAINT: { name: '運動器リハ(Ⅱ) 【維持期減算】', units: 0, points: 102, amount: 0, unitLabel: '単位' },
    CEREBRO_STD: { name: '脳血管等リハ(Ⅲ)', units: 0, points: 100, amount: 0, unitLabel: '単位' },
    CEREBRO_MAINT: { name: '脳血管等リハ(Ⅲ)【維持期減算】', units: 0, points: 60, amount: 0, unitLabel: '単位' },
    DISUSE_STD: { name: '廃用症候群リハ(Ⅲ)', units: 0, points: 77, amount: 0, unitLabel: '単位' },
    DISUSE_MAINT: { name: '廃用症候群リハ(Ⅲ)【維持期減算】', units: 0, points: 46, amount: 0, unitLabel: '単位' },
    ANALGESIA: { name: '消炎鎮痛等処置 (物療)', units: 0, points: 35, amount: 0, unitLabel: '件' },
    EARLY_P1: { name: '早期加算 (入院1〜3日目)', units: 0, points: 60, amount: 0, unitLabel: '単位' },
    EARLY_P2: { name: '早期加算 (入院4〜14日目)', units: 0, points: 25, amount: 0, unitLabel: '単位' },
    PLAN_1_FIRST: { name: '総合実施計画書1 (初回)', units: 0, points: 300, amount: 0, unitLabel: '件' },
    PLAN_1_FOLLOW: { name: '総合実施計画書1 (2回目以降)', units: 0, points: 240, amount: 0, unitLabel: '件' },
    PLAN_2_FIRST: { name: '総合実施計画書2 (初回)', units: 0, points: 240, amount: 0, unitLabel: '件' },
    PLAN_2_FOLLOW: { name: '総合実施計画書2 (2回目以降)', units: 0, points: 196, amount: 0, unitLabel: '件' }
  };

  let totalRehaUnits = 0;
  let grandTotalYen = 0;

  Object.values(monthlyState.lastAggregated.patientMap).forEach((item) => {
    const p = item.patient;

    item.slots.forEach((s) => {
      if (s.date !== todayStr) return;

      if (s.isAnalgesia) {
        breakdown.ANALGESIA.units += 1;
        breakdown.ANALGESIA.amount += 35 * REHA_RULES.POINT_RATE;
        grandTotalYen += 35 * REHA_RULES.POINT_RATE;
        return;
      }

      totalRehaUnits += s.units;
      const deadlines = calculatePatientDeadlines(p, s.date);
      const rate = getDailyBasePoints(p, s.date);
      const isMaint = rate.isCareReduced === true;
      const basePoint = rate.points;

      // 疾患別基本料（点数減算時のみ維持期行へ。医療保険のみ超過は正規点数行）
      if (p.diseaseType === 'LOCOMOTIVE') {
        const target = isMaint ? breakdown.LOCO_MAINT : breakdown.LOCO_STD;
        target.units += s.units;
        const yen = basePoint * s.units * REHA_RULES.POINT_RATE;
        target.amount += yen;
        grandTotalYen += yen;
      } else if (p.diseaseType === 'CEREBROVASCULAR') {
        const target = isMaint ? breakdown.CEREBRO_MAINT : breakdown.CEREBRO_STD;
        target.units += s.units;
        const yen = basePoint * s.units * REHA_RULES.POINT_RATE;
        target.amount += yen;
        grandTotalYen += yen;
      } else if (p.diseaseType === 'DISUSE') {
        const target = isMaint ? breakdown.DISUSE_MAINT : breakdown.DISUSE_STD;
        target.units += s.units;
        const yen = basePoint * s.units * REHA_RULES.POINT_RATE;
        target.amount += yen;
        grandTotalYen += yen;
      }

      // 早期加算判定
      if (deadlines.earlyBonus?.points > 0) {
        const isPhase1 = deadlines.earlyBonus.phase === 'PHASE_1';
        const target = isPhase1 ? breakdown.EARLY_P1 : breakdown.EARLY_P2;
        target.units += s.units;
        const bonusYen = target.points * s.units * REHA_RULES.POINT_RATE;
        target.amount += bonusYen;
        grandTotalYen += bonusYen;
      }

      // 計画書4区分判定
      if (s.billingPlan) {
        const pKey = String(s.billingPlan);
        const target = breakdown[pKey] || breakdown.PLAN_1_FIRST;
        target.units += 1;
        const planYen = target.points * REHA_RULES.POINT_RATE;
        target.amount += planYen;
        grandTotalYen += planYen;
      }
    });
  });

  // テーブルHTML生成
  let rowsHtml = '';
  Object.values(breakdown).forEach((row) => {
    const isZero = row.units === 0;
    const rowStyle = isZero ? 'color:#94a3b8;' : 'font-weight:600; color:#0f172a;';
    const amountStyle = isZero ? 'color:#94a3b8;' : 'font-weight:700; color:#0369a1;';

    rowsHtml += `
      <tr style="${rowStyle}">
        <td style="padding:6px 10px;">${row.name}</td>
        <td style="padding:6px 8px; text-align:center;">${row.units} ${row.unitLabel}</td>
        <td style="padding:6px 8px; text-align:right;">${row.points} 点</td>
        <td style="padding:6px 10px; text-align:right; ${amountStyle}">¥${row.amount.toLocaleString()}</td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;
  if (totalUnitsCell) totalUnitsCell.textContent = `${totalRehaUnits} 単位`;
  if (totalAmountCell) totalAmountCell.textContent = `¥${grandTotalYen.toLocaleString()}`;

  modal.classList.add('active');
}
