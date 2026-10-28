// js/print/patientMonthlyReportPrint.js
// 退院時・医事課提出用「患者個人 月間リハビリ実施実績表」A4縦1枚印刷
// （入院日・算定期限・早期加算期限・介護認定なし表記・評価料種別を記載）

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { REHA_RULES } from '../config/rules.js';
import {
  calculatePatientDeadlines,
  checkMonth13UnitsViolation,
  evaluateRecommendedPlan
} from '../core/deadlineCalc.js';
import { buildDailyUnitsByRole, getTherapistRole } from '../core/therapistRoleUtil.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists, getTherapistById } from '../store/therapistStore.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { loadMonthOnDemand } from '../store/archiveManager.js';
import { showToast } from '../ui/toast.js';
import { formatOperatorLabel } from '../store/operatorStore.js';

/**
 * YYYY-MM-DD → YYYY/MM/DD（空は —）
 * @param {string} dateStr
 * @returns {string}
 */
function fmtSlash(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '—';
  const s = dateStr.trim();
  if (!s) return '—';
  return s.replace(/-/g, '/');
}

/**
 * 介護認定の帳票表記（なし・未取得は「介護認定なし」。医療のみ表記は使わない）
 * @param {object} patient
 * @returns {string}
 */
function resolveCareInsuranceDisplay(patient) {
  const careLevel = String(patient?.careLevel || patient?.careCertification || '').trim();
  if (careLevel
    && careLevel !== 'なし'
    && careLevel !== '無し'
    && careLevel !== '自立'
    && careLevel !== 'NONE'
    && careLevel !== '介護認定なし') {
    return careLevel;
  }

  const type = String(patient?.careInsuranceType || 'NONE').toUpperCase();
  if (type === 'CARE') {
    return REHA_RULES.CARE_INSURANCE?.CARE?.label || '要介護';
  }
  if (type === 'SUPPORT') {
    return REHA_RULES.CARE_INSURANCE?.SUPPORT?.label || '要支援';
  }

  const insuranceType = String(patient?.insuranceType || '');
  if (insuranceType.includes('介護') && !insuranceType.includes('なし')) {
    return '介護保険あり';
  }

  return '介護認定なし';
}

/**
 * 評価表（リハ総合計画評価料）の台帳分類ラベル
 * @param {object} patient
 * @returns {string}
 */
function resolvePlanStatusLabel(patient) {
  const status = patient?.planStatus || 'NOT_YET';
  if (status === 'PLAN_2_FOLLOW') return '計画書2継続中（196点固定）';
  if (status === 'PLAN_1_FOLLOW') return '計画書1継続中（2回目以降）';
  if (status === 'NOT_YET') return '未算定（初回対象）';
  return String(status);
}

/**
 * スロットの billingPlan を短い評価料種別へ
 * @param {string} billingPlan
 * @returns {string}
 */
function resolveBillingPlanShort(billingPlan) {
  if (!billingPlan) return '—';
  const key = String(billingPlan);
  const opt = (REHA_RULES.PLAN_OPTIONS || []).find((o) => o.value === key);
  if (opt?.label) {
    // 「総合実施計画書1 (初回: 300点)」→「計1初回300」
    if (key === 'PLAN_1_FIRST') return '計1初回300';
    if (key === 'PLAN_1_FOLLOW') return '計1継続240';
    if (key === 'PLAN_2_FIRST') return '計2初回240';
    if (key === 'PLAN_2_FOLLOW') return '計2継続196';
    return opt.label;
  }
  if (key.includes('PLAN_2')) return '計画書2';
  if (key.includes('PLAN_1')) return '計画書1';
  return key;
}

/**
 * @param {string} patientId
 * @param {number} year
 * @param {number} month
 * @param {object} [preAggregated] aggregateFromAppSchedule の結果（あれば再利用）
 */
export async function printPatientMonthlyReport(patientId, year, month, preAggregated = null) {
  const y = Number(year);
  const m = Number(month);
  const pId = String(patientId || '').trim();
  if (!pId || !y || !m) {
    showToast('患者または対象月が不正です', 'warn');
    return;
  }

  try {
    await loadMonthOnDemand(y, m);
  } catch (e) {
    console.warn('[patientMonthlyReport] loadMonthOnDemand soft-fail:', e);
  }

  const aggregated = preAggregated || aggregateFromAppSchedule(y, m);
  const entry = aggregated?.patientMap?.[pId];
  const patient = entry?.patient || getPatientById(pId);
  if (!patient) {
    showToast('患者マスターに該当がありません', 'error');
    return;
  }

  const daysInMonth = aggregated?.daysInMonth || new Date(y, m, 0).getDate();
  const dailyUnits = entry?.dailyUnits || Array(daysInMonth + 1).fill(0);
  const dailyReha = entry?.dailyRehaUnits || dailyUnits;
  const dailyEarly = entry?.dailyEarlyUnits || Array(daysInMonth + 1).fill(0);
  const dailyAnalgesia = entry?.dailyAnalgesia || Array(daysInMonth + 1).fill(0);
  const slots = Array.isArray(entry?.slots) ? entry.slots : [];
  const totalUnits = entry?.totalUnits ?? dailyUnits.reduce((s, v, i) => (i === 0 ? s : s + (v || 0)), 0);
  const rehaTotal = entry?.rehaTotalUnits ?? totalUnits;
  const planCount = entry?.planCount || 0;
  const earlyTotal = entry?.totalEarlyUnits || 0;
  const analgesiaDays = entry?.totalAnalgesiaDays || 0;

  const isAnalgesia = patient.diseaseType === 'ANALGESIA';
  const isOut = patient.category === 'OUTPATIENT';
  const catLabel = isAnalgesia ? '消炎鎮痛' : (isOut ? '外来' : '入院');
  const diseaseRule = REHA_RULES.LIMIT_DAYS[patient.diseaseType] || REHA_RULES.LIMIT_DAYS.LOCOMOTIVE;
  const diseaseLabel = diseaseRule?.label || diseaseRule?.fullName || patient.diseaseType || '-';
  const standardDays = diseaseRule?.days;
  const standardDaysLabel = (standardDays && standardDays < 9000) ? `${standardDays}日` : '上限なし';

  const exitDate = patient.exitDate || patient.plannedDischargeDate || patient.discontinuedDate || patient.endDate || '';
  const admissionDate = patient.admissionDate || '';
  const onsetDate = patient.onsetDate || '';
  const earlyStartDate = patient.earlyBonusStartDate || patient.admissionDate || '';
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  const deadlines = calculatePatientDeadlines(patient, monthEnd);

  const careInsuranceDisplay = resolveCareInsuranceDisplay(patient);
  const planStatusLabel = resolvePlanStatusLabel(patient);

  // 当月末時点の推奨評価料（台帳分類＋推奨区分）
  const hasPastPlan = planCount > 0 || patient.planStatus === 'PLAN_1_FOLLOW' || patient.planStatus === 'PLAN_2_FOLLOW';
  const recommendedPlan = evaluateRecommendedPlan(patient, monthEnd, hasPastPlan);
  const planEvalDisplay = isAnalgesia
    ? '対象外（消炎鎮痛）'
    : `${planStatusLabel} ／ 推奨: ${recommendedPlan.label || '—'}`;

  // 疾患別リハ算定期限
  let diseaseLimitDisplay = '上限なし';
  if (!isAnalgesia && deadlines.limitDateStr) {
    const exceeded = deadlines.isLimitExceeded ? '（超過）' : '';
    diseaseLimitDisplay = `${fmtSlash(deadlines.limitDateStr)}${exceeded}（起算${standardDaysLabel}）`;
  } else if (isAnalgesia) {
    diseaseLimitDisplay = '対象外（消炎）';
  }

  // 早期加算Ⅰ・Ⅱ期限（令和8年度: Ⅰ=通算3日・60点 / Ⅱ=通算14日・25点）
  const earlyP1Days = REHA_RULES.EARLY_BONUS?.PHASE_1?.maxDays ?? 3;
  const earlyP2Days = REHA_RULES.EARLY_BONUS?.PHASE_2?.maxDays ?? 14;
  const earlyP1Pts = REHA_RULES.EARLY_BONUS?.PHASE_1?.points ?? 60;
  const earlyP2Pts = REHA_RULES.EARLY_BONUS?.PHASE_2?.points ?? 25;
  let early1Display = '—';
  let early2Display = '—';
  if (isOut || isAnalgesia) {
    early1Display = '対象外（外来/消炎）';
    early2Display = '対象外（外来/消炎）';
  } else if (deadlines.earlyPhase1EndDateStr || deadlines.earlyPhase2EndDateStr) {
    early1Display = `${fmtSlash(deadlines.earlyPhase1EndDateStr)}（Ⅰ:〜${earlyP1Days}日・${earlyP1Pts}点）`;
    early2Display = `${fmtSlash(deadlines.earlyPhase2EndDateStr)}（Ⅱ:〜${earlyP2Days}日・${earlyP2Pts}点）`;
  } else if (!earlyStartDate && !admissionDate) {
    early1Display = '起算日未設定';
    early2Display = '起算日未設定';
  }

  const dailyMap = {};
  for (let d = 1; d <= daysInMonth; d += 1) dailyMap[d] = dailyReha[d] || 0;
  const violation = checkMonth13UnitsViolation(patient, y, m, dailyMap);

  // 曜日ヘッダー
  const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];
  let dayHeaderCells = '';
  let dowRowCells = '';
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dt = new Date(y, m - 1, d);
    const dow = dt.getDay();
    const isSun = dow === 0;
    const isSat = dow === 6;
    const cls = isSun ? 'sun' : (isSat ? 'sat' : '');
    dayHeaderCells += `<th class="${cls}">${d}</th>`;
    dowRowCells += `<td class="dow ${cls}">${dowLabels[dow]}</td>`;
  }
  for (let d = daysInMonth + 1; d <= 31; d += 1) {
    dayHeaderCells += '<th class="empty-day">-</th>';
    dowRowCells += '<td class="dow empty-day">-</td>';
  }

  // ★印刷時のみ PT / OT /（ST）/ 総計 に日別分離（画面マトリクスは1患者1行のまま）
  const therapistsMaster = getAllTherapists();
  const roleAgg = buildDailyUnitsByRole(slots, daysInMonth, therapistsMaster);
  const dailyPt = roleAgg.dailyByRole.PT;
  const dailyOt = roleAgg.dailyByRole.OT;
  const dailySt = roleAgg.dailyByRole.ST;
  const showStRow = roleAgg.hasRole.ST;
  // スロット無しフォールバック: 合計を PT に寄せる
  const roleSlotTotal = (roleAgg.totalsByRole.PT || 0) + (roleAgg.totalsByRole.OT || 0) + (roleAgg.totalsByRole.ST || 0);
  if (roleSlotTotal === 0) {
    for (let d = 1; d <= daysInMonth; d += 1) {
      dailyPt[d] = dailyUnits[d] || 0;
    }
  }

  let ptCells = '';
  let otCells = '';
  let stCells = '';
  let totalCells = '';
  let earlyCells = '';
  let analgesiaCells = '';
  for (let d = 1; d <= 31; d += 1) {
    if (d > daysInMonth) {
      ptCells += '<td class="empty-day">-</td>';
      otCells += '<td class="empty-day">-</td>';
      stCells += '<td class="empty-day">-</td>';
      totalCells += '<td class="empty-day">-</td>';
      earlyCells += '<td class="empty-day">-</td>';
      analgesiaCells += '<td class="empty-day">-</td>';
      continue;
    }
    const ptU = dailyPt[d] || 0;
    const otU = dailyOt[d] || 0;
    const stU = dailySt[d] || 0;
    const totU = (dailyUnits[d] || 0) || (ptU + otU + stU);
    const eu = dailyEarly[d] || 0;
    const au = dailyAnalgesia[d] || 0;
    const exitDay = exitDate ? Number(String(exitDate).slice(8, 10)) : 0;
    const exitMonthMatch = exitDate && exitDate.startsWith(`${y}-${String(m).padStart(2, '0')}`);
    const afterExit = exitMonthMatch && exitDay > 0 && d > exitDay;
    const onExit = exitMonthMatch && exitDay > 0 && d === exitDay;
    const cellCls = afterExit ? 'after-exit' : (onExit ? 'on-exit' : '');
    ptCells += `<td class="${cellCls}">${ptU > 0 ? `<strong class="pt">${ptU}</strong>` : '<span class="dash">-</span>'}</td>`;
    otCells += `<td class="${cellCls}">${otU > 0 ? `<strong class="ot">${otU}</strong>` : '<span class="dash">-</span>'}</td>`;
    stCells += `<td class="${cellCls}">${stU > 0 ? `<strong class="st">${stU}</strong>` : '<span class="dash">-</span>'}</td>`;
    totalCells += `<td class="${cellCls}">${totU > 0 ? `<strong>${totU}</strong>` : '<span class="dash">-</span>'}</td>`;
    earlyCells += `<td class="${cellCls}">${eu > 0 ? `<strong class="early">${eu}</strong>` : '<span class="dash">-</span>'}</td>`;
    analgesiaCells += `<td class="${cellCls}">${au > 0 ? '<strong class="analg">●</strong>' : '<span class="dash">-</span>'}</td>`;
  }

  const stMatrixRow = showStRow ? `
        <tr>
          <td class="row-label role-st">ST</td>
          ${stCells}
        </tr>` : '';

  // 実施明細（PT/OT行追加に合わせ行数を抑制しA4縦1枚厳守）
  const detailSlots = slots
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.slotId || '').localeCompare(String(b.slotId || '')));
  const maxDetailRows = showStRow ? 8 : 10;
  const shownSlots = detailSlots.slice(0, maxDetailRows);
  const omitted = Math.max(0, detailSlots.length - shownSlots.length);

  let detailRows = '';
    shownSlots.forEach((s) => {
    const therapist = s.therapist ? getTherapistById(s.therapist) : null;
    const tName = s.isAnalgesia ? '消炎枠' : (therapist?.name || s.therapist || '-');
    const roleSuffix = s.isAnalgesia
      ? ''
      : ` [${getTherapistRole(s.therapist || '', therapist?.name || '', therapistsMaster)}]`;
    const plan = s.isAnalgesia ? '—' : resolveBillingPlanShort(s.billingPlan);
    detailRows += `
      <tr>
        <td>${sanitizeHtml(String(s.date || '').replace(/-/g, '/'))}</td>
        <td>${sanitizeHtml(tName)}${sanitizeHtml(roleSuffix)}</td>
        <td class="num">${s.isAnalgesia ? '消炎' : (s.units || 0)}</td>
        <td>${sanitizeHtml(plan)}</td>
      </tr>`;
  });
  if (shownSlots.length === 0) {
    detailRows = '<tr><td colspan="4" class="empty-msg">当月の実施明細はありません</td></tr>';
  } else if (omitted > 0) {
    detailRows += `<tr><td colspan="4" class="empty-msg">…他 ${omitted} 件（合計は上表の単位に含む）</td></tr>`;
  }

  const over13Note = violation.isOver13
    ? `⚠️ 月13単位制限超過（対象${violation.applicableUnits}単位）`
    : '';

  const printedAt = new Date();
  const printedStr = `${printedAt.getFullYear()}/${String(printedAt.getMonth() + 1).padStart(2, '0')}/${String(printedAt.getDate()).padStart(2, '0')} ${String(printedAt.getHours()).padStart(2, '0')}:${String(printedAt.getMinutes()).padStart(2, '0')}`;
  const operatorLabel = formatOperatorLabel();

  const printWindow = window.open('', '_blank', 'width=900,height=1100');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>月間リハ実施実績_${sanitizeHtml(patient.name)}_${y}-${String(m).padStart(2, '0')}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      font-family: "Meiryo UI", "Hiragino Sans", "Segoe UI", sans-serif;
      color: #0f172a;
      background: #fff;
      font-size: 8.5pt;
      line-height: 1.2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 100%;
      max-height: 277mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 3px;
    }
    .head-title {
      font-size: 13pt;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .head-sub {
      font-size: 7.5pt;
      color: #475569;
      font-weight: 700;
      margin-top: 1px;
    }
    .head-meta { text-align: right; font-size: 9pt; font-weight: 800; }
    .month-badge {
      display: inline-block;
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #7dd3fc;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 10pt;
      font-weight: 800;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2px 6px;
      border: 1px solid #94a3b8;
      border-radius: 3px;
      padding: 5px 6px;
      background: #f8fafc;
      font-size: 7.5pt;
    }
    .info-grid .cell { min-width: 0; }
    .info-grid .label {
      color: #64748b;
      font-weight: 700;
      font-size: 6.5pt;
      line-height: 1.1;
    }
    .info-grid .value {
      font-weight: 800;
      color: #0f172a;
      font-size: 7.5pt;
      line-height: 1.2;
      word-break: break-all;
    }
    .info-grid .span-2 { grid-column: span 2; }
    .info-grid .span-4 { grid-column: 1 / -1; }
    .kpi-row { display: flex; gap: 4px; flex-wrap: nowrap; }
    .kpi {
      flex: 1;
      min-width: 0;
      border: 1px solid #cbd5e1;
      border-radius: 3px;
      padding: 2px 4px;
      text-align: center;
      background: #fff;
    }
    .kpi .k-label { font-size: 6.5pt; color: #64748b; font-weight: 700; }
    .kpi .k-value { font-size: 11pt; font-weight: 800; color: #0369a1; }
    .kpi.warn .k-value { color: #dc2626; }
    .section-title {
      font-size: 8pt;
      font-weight: 800;
      color: #0f172a;
      border-left: 3px solid #0284c7;
      padding-left: 5px;
      margin-top: 1px;
    }
    .matrix {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 6.5pt;
    }
    .matrix th, .matrix td {
      border: 1px solid #64748b;
      text-align: center;
      vertical-align: middle;
      padding: 0;
      height: 11px;
    }
    .matrix th {
      background: #1e293b;
      color: #fff;
      font-weight: 800;
      font-size: 6pt;
    }
    .matrix th.sat, .matrix td.sat { background: #eff6ff; color: #1d4ed8; }
    .matrix th.sun, .matrix td.sun { background: #fff1f2; color: #be123c; }
    .matrix th.empty-day, .matrix td.empty-day { background: #f1f5f9; color: #cbd5e1; }
    .matrix td.row-label {
      width: 48px;
      background: #f1f5f9;
      font-weight: 800;
      font-size: 6.5pt;
      color: #334155;
    }
    .matrix td.on-exit { background: #ffedd5 !important; }
    .matrix td.after-exit { background: #f1f5f9 !important; color: #94a3b8; }
    .matrix .dash { color: #cbd5e1; font-weight: 400; }
    .matrix .early { color: #7c3aed; }
    .matrix .analg { color: #16a34a; }
    .matrix .pt { color: #1d4ed8; }
    .matrix .ot { color: #047857; }
    .matrix .st { color: #6d28d9; }
    .matrix td.row-label.role-pt { background: #dbeafe; color: #1d4ed8; }
    .matrix td.row-label.role-ot { background: #d1fae5; color: #047857; }
    .matrix td.row-label.role-st { background: #ede9fe; color: #6d28d9; }
    .matrix td.row-label.role-total { background: #e2e8f0; color: #0f172a; }
    .matrix .dow { font-size: 5.5pt; color: #64748b; height: 10px; background: #f8fafc; }
    .detail-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7pt;
      table-layout: fixed;
    }
    .detail-table th, .detail-table td {
      border: 1px solid #94a3b8;
      padding: 1px 3px;
    }
    .detail-table th {
      background: #e2e8f0;
      font-weight: 800;
      text-align: center;
      font-size: 6.5pt;
    }
    .detail-table .num { text-align: center; font-weight: 800; }
    .detail-table .empty-msg {
      text-align: center;
      color: #94a3b8;
      font-weight: 600;
    }
    .sign-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
      margin-top: 2px;
    }
    .sign-box {
      border: 1px solid #64748b;
      border-radius: 3px;
      min-height: 40px;
      padding: 3px 5px;
      font-size: 7pt;
      font-weight: 700;
      color: #475569;
    }
    .sign-box .line {
      margin-top: 16px;
      border-top: 1px solid #94a3b8;
      font-size: 6.5pt;
      color: #94a3b8;
      text-align: right;
      padding-top: 1px;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      font-size: 6.5pt;
      color: #64748b;
      border-top: 1px solid #cbd5e1;
      padding-top: 2px;
      margin-top: auto;
    }
    .warn-banner {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      font-size: 7pt;
      font-weight: 800;
      padding: 2px 5px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div>
        <div class="head-title">リハビリテーション実施実績表（患者個人）</div>
        <div class="head-sub">医事課提出・カルテ挟込用 / 令和8年度改定準拠</div>
      </div>
      <div class="head-meta">
        <div class="month-badge">${y}年 ${m}月分</div>
        <div style="margin-top:2px; font-size:7pt; font-weight:700; color:#475569;">A4縦・1枚完結</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="cell">
        <div class="label">患者氏名 (ID)</div>
        <div class="value">${sanitizeHtml(patient.name)} <span style="font-weight:600;color:#64748b;">(${sanitizeHtml(patient.id)})</span></div>
      </div>
      <div class="cell">
        <div class="label">区分 / 疾患</div>
        <div class="value">${catLabel} / ${sanitizeHtml(diseaseLabel)}</div>
      </div>
      <div class="cell">
        <div class="label">介護認定</div>
        <div class="value">${sanitizeHtml(careInsuranceDisplay)}</div>
      </div>
      <div class="cell">
        <div class="label">終了・退院日</div>
        <div class="value">${fmtSlash(exitDate)}</div>
      </div>

      <div class="cell">
        <div class="label">入院日</div>
        <div class="value">${fmtSlash(admissionDate)}</div>
      </div>
      <div class="cell">
        <div class="label">発症日・手術日（起算）</div>
        <div class="value">${fmtSlash(onsetDate)}</div>
      </div>
      <div class="cell span-2">
        <div class="label">疾患別リハ算定期限（満了日）</div>
        <div class="value">${sanitizeHtml(diseaseLimitDisplay)}</div>
      </div>

      <div class="cell span-2">
        <div class="label">早期加算Ⅰ 算定期限（起算: ${fmtSlash(earlyStartDate)}）</div>
        <div class="value">${sanitizeHtml(early1Display)}</div>
      </div>
      <div class="cell span-2">
        <div class="label">早期加算Ⅱ 算定期限</div>
        <div class="value">${sanitizeHtml(early2Display)}</div>
      </div>

      <div class="cell span-4">
        <div class="label">評価表（リハビリテーション総合計画評価料）分類・種別</div>
        <div class="value">${sanitizeHtml(planEvalDisplay)}</div>
      </div>

      <div class="cell span-4">
        <div class="label">病名（自由記述）</div>
        <div class="value" style="font-weight:700;">${sanitizeHtml(patient.diseaseName || '—')}</div>
      </div>
    </div>

    ${over13Note ? `<div class="warn-banner">${sanitizeHtml(over13Note)}</div>` : ''}

    <div class="kpi-row">
      <div class="kpi${violation.isOver13 ? ' warn' : ''}">
        <div class="k-label">当月総単位</div>
        <div class="k-value">${totalUnits}</div>
      </div>
      <div class="kpi">
        <div class="k-label">個別リハ単位</div>
        <div class="k-value">${rehaTotal}</div>
      </div>
      <div class="kpi">
        <div class="k-label">計画書算定</div>
        <div class="k-value">${planCount}</div>
      </div>
      <div class="kpi">
        <div class="k-label">早期加算単位</div>
        <div class="k-value">${earlyTotal}</div>
      </div>
      <div class="kpi">
        <div class="k-label">消炎来院日</div>
        <div class="k-value">${analgesiaDays}</div>
      </div>
    </div>

    <div class="section-title">日別実施単位マトリクス（PT / OT 分離・1〜${daysInMonth}日）</div>
    <table class="matrix">
      <thead>
        <tr>
          <th style="width:48px;">項目</th>
          ${dayHeaderCells}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="row-label">曜日</td>
          ${dowRowCells}
        </tr>
        <tr>
          <td class="row-label role-pt">PT</td>
          ${ptCells}
        </tr>
        <tr>
          <td class="row-label role-ot">OT</td>
          ${otCells}
        </tr>
        ${stMatrixRow}
        <tr>
          <td class="row-label role-total">総計</td>
          ${totalCells}
        </tr>
        <tr>
          <td class="row-label">早期加算</td>
          ${earlyCells}
        </tr>
        <tr>
          <td class="row-label">消炎</td>
          ${analgesiaCells}
        </tr>
      </tbody>
    </table>

    <div class="section-title">実施明細（セラピスト別・抜粋）／評価料種別</div>
    <table class="detail-table">
      <thead>
        <tr>
          <th style="width:18%;">実施日</th>
          <th style="width:34%;">担当</th>
          <th style="width:16%;">単位/区分</th>
          <th style="width:32%;">評価料種別</th>
        </tr>
      </thead>
      <tbody>
        ${detailRows}
      </tbody>
    </table>

    <div class="sign-row">
      <div class="sign-box">理学療法士 確認印<div class="line">印</div></div>
      <div class="sign-box">医事課 受領印<div class="line">印</div></div>
      <div class="sign-box">備考・特記<div class="line">&nbsp;</div></div>
    </div>

    <div class="footer">
      <span>出力: ${printedStr} / 操作者: ${sanitizeHtml(operatorLabel)}</span>
      <span>reha-work-manager · 患者個人月間実績 · A4縦1枚</span>
    </div>
  </div>
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
  showToast(`${patient.name} 様の ${y}年${m}月 実績表を印刷します`, 'success');
}
