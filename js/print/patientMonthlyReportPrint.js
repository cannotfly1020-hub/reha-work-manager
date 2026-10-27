// js/print/patientMonthlyReportPrint.js
// 退院時・医事課提出用「患者個人 月間リハビリ実施実績表」A4縦1枚印刷

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { REHA_RULES } from '../config/rules.js';
import { calculatePatientDeadlines, checkMonth13UnitsViolation } from '../core/deadlineCalc.js';
import { getPatientById } from '../store/patientStore.js';
import { getTherapistById } from '../store/therapistStore.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { loadMonthOnDemand } from '../store/archiveManager.js';
import { showToast } from '../ui/toast.js';
import { formatOperatorLabel } from '../store/operatorStore.js';

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
  const diseaseLabel = diseaseRule?.label || patient.diseaseType || '-';

  const exitDate = patient.exitDate || patient.plannedDischargeDate || patient.discontinuedDate || patient.endDate || '';
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  const deadlines = calculatePatientDeadlines(patient, monthEnd);

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
  // 31日未満は空欄で揃える（表幅固定）
  for (let d = daysInMonth + 1; d <= 31; d += 1) {
    dayHeaderCells += '<th class="empty-day">-</th>';
    dowRowCells += '<td class="dow empty-day">-</td>';
  }

  let unitCells = '';
  let earlyCells = '';
  let analgesiaCells = '';
  for (let d = 1; d <= 31; d += 1) {
    if (d > daysInMonth) {
      unitCells += '<td class="empty-day">-</td>';
      earlyCells += '<td class="empty-day">-</td>';
      analgesiaCells += '<td class="empty-day">-</td>';
      continue;
    }
    const u = dailyUnits[d] || 0;
    const eu = dailyEarly[d] || 0;
    const au = dailyAnalgesia[d] || 0;
    const exitDay = exitDate ? Number(String(exitDate).slice(8, 10)) : 0;
    const exitMonthMatch = exitDate && exitDate.startsWith(`${y}-${String(m).padStart(2, '0')}`);
    const afterExit = exitMonthMatch && exitDay > 0 && d > exitDay;
    const onExit = exitMonthMatch && exitDay > 0 && d === exitDay;
    let cellCls = afterExit ? 'after-exit' : (onExit ? 'on-exit' : '');
    unitCells += `<td class="${cellCls}">${u > 0 ? `<strong>${u}</strong>` : '<span class="dash">-</span>'}</td>`;
    earlyCells += `<td class="${cellCls}">${eu > 0 ? `<strong class="early">${eu}</strong>` : '<span class="dash">-</span>'}</td>`;
    analgesiaCells += `<td class="${cellCls}">${au > 0 ? '<strong class="analg">●</strong>' : '<span class="dash">-</span>'}</td>`;
  }

  // 実施明細（コンパクト・最大行で1枚に収める）
  const detailSlots = slots
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.slotId || '').localeCompare(String(b.slotId || '')));
  const maxDetailRows = 18;
  const shownSlots = detailSlots.slice(0, maxDetailRows);
  const omitted = Math.max(0, detailSlots.length - shownSlots.length);

  let detailRows = '';
  shownSlots.forEach((s) => {
    const therapist = s.therapist ? getTherapistById(s.therapist) : null;
    const tName = s.isAnalgesia ? '消炎枠' : (therapist?.name || s.therapist || '-');
    const plan = s.billingPlan
      ? (String(s.billingPlan).includes('PLAN_2') ? '計画書2' : '計画書1')
      : '-';
    detailRows += `
      <tr>
        <td>${sanitizeHtml(String(s.date || '').replace(/-/g, '/'))}</td>
        <td>${sanitizeHtml(tName)}</td>
        <td class="num">${s.isAnalgesia ? '消炎' : (s.units || 0)}</td>
        <td>${plan}</td>
      </tr>`;
  });
  if (shownSlots.length === 0) {
    detailRows = '<tr><td colspan="4" class="empty-msg">当月の実施明細はありません</td></tr>';
  } else if (omitted > 0) {
    detailRows += `<tr><td colspan="4" class="empty-msg">…他 ${omitted} 件（合計は上表の単位に含む）</td></tr>`;
  }

  const careLabel = patient.careInsuranceType === 'CARE'
    ? '要介護'
    : (patient.careInsuranceType === 'SUPPORT' ? '要支援' : '医療のみ');
  const limitStr = deadlines.limitDateStr
    ? `${deadlines.limitDateStr.replace(/-/g, '/')}${deadlines.isLimitExceeded ? '（超過）' : ''}`
    : '上限なし';
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
      font-size: 9pt;
      line-height: 1.25;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 100%;
      max-height: 277mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2.5px solid #0f172a;
      padding-bottom: 4px;
    }
    .head-title {
      font-size: 14pt;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .head-sub {
      font-size: 8pt;
      color: #475569;
      font-weight: 700;
      margin-top: 2px;
    }
    .head-meta {
      text-align: right;
      font-size: 9.5pt;
      font-weight: 800;
    }
    .month-badge {
      display: inline-block;
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #7dd3fc;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11pt;
      font-weight: 800;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr 1fr;
      gap: 4px 8px;
      border: 1px solid #94a3b8;
      border-radius: 4px;
      padding: 6px 8px;
      background: #f8fafc;
      font-size: 8.5pt;
    }
    .info-grid .label {
      color: #64748b;
      font-weight: 700;
      font-size: 7.5pt;
    }
    .info-grid .value {
      font-weight: 800;
      color: #0f172a;
    }
    .kpi-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .kpi {
      flex: 1;
      min-width: 70px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 4px 6px;
      text-align: center;
      background: #fff;
    }
    .kpi .k-label { font-size: 7pt; color: #64748b; font-weight: 700; }
    .kpi .k-value { font-size: 12pt; font-weight: 800; color: #0369a1; }
    .kpi.warn .k-value { color: #dc2626; }
    .section-title {
      font-size: 9pt;
      font-weight: 800;
      color: #0f172a;
      border-left: 4px solid #0284c7;
      padding-left: 6px;
      margin-top: 2px;
    }
    .matrix {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 7pt;
    }
    .matrix th, .matrix td {
      border: 1px solid #64748b;
      text-align: center;
      vertical-align: middle;
      padding: 1px 0;
      height: 14px;
    }
    .matrix th {
      background: #1e293b;
      color: #fff;
      font-weight: 800;
      font-size: 6.5pt;
    }
    .matrix th.sat, .matrix td.sat { background: #eff6ff; color: #1d4ed8; }
    .matrix th.sun, .matrix td.sun { background: #fff1f2; color: #be123c; }
    .matrix th.empty-day, .matrix td.empty-day {
      background: #f1f5f9;
      color: #cbd5e1;
    }
    .matrix td.row-label {
      width: 52px;
      background: #f1f5f9;
      font-weight: 800;
      font-size: 7pt;
      color: #334155;
    }
    .matrix td.on-exit { background: #ffedd5 !important; }
    .matrix td.after-exit { background: #f1f5f9 !important; color: #94a3b8; }
    .matrix .dash { color: #cbd5e1; font-weight: 400; }
    .matrix .early { color: #7c3aed; }
    .matrix .analg { color: #16a34a; }
    .matrix .dow { font-size: 6pt; color: #64748b; height: 11px; background: #f8fafc; }
    .detail-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.5pt;
      table-layout: fixed;
    }
    .detail-table th, .detail-table td {
      border: 1px solid #94a3b8;
      padding: 2px 4px;
    }
    .detail-table th {
      background: #e2e8f0;
      font-weight: 800;
      text-align: center;
      font-size: 7pt;
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
      gap: 8px;
      margin-top: 4px;
    }
    .sign-box {
      border: 1px solid #64748b;
      border-radius: 4px;
      min-height: 48px;
      padding: 4px 6px;
      font-size: 7.5pt;
      font-weight: 700;
      color: #475569;
    }
    .sign-box .line {
      margin-top: 22px;
      border-top: 1px solid #94a3b8;
      font-size: 7pt;
      color: #94a3b8;
      text-align: right;
      padding-top: 2px;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      font-size: 7pt;
      color: #64748b;
      border-top: 1px solid #cbd5e1;
      padding-top: 3px;
      margin-top: auto;
    }
    .warn-banner {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      font-size: 7.5pt;
      font-weight: 800;
      padding: 3px 6px;
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
        <div style="margin-top:3px; font-size:8pt; font-weight:700; color:#475569;">A4縦・1枚完結</div>
      </div>
    </div>

    <div class="info-grid">
      <div>
        <div class="label">患者氏名 (ID)</div>
        <div class="value">${sanitizeHtml(patient.name)} <span style="font-weight:600;color:#64748b;font-size:8pt;">(${sanitizeHtml(patient.id)})</span></div>
      </div>
      <div>
        <div class="label">区分 / 疾患</div>
        <div class="value">${catLabel} / ${sanitizeHtml(diseaseLabel)}</div>
      </div>
      <div>
        <div class="label">介護認定 / 算定期限</div>
        <div class="value">${careLabel} / ${limitStr}</div>
      </div>
      <div>
        <div class="label">終了・退院日</div>
        <div class="value">${exitDate ? sanitizeHtml(exitDate.replace(/-/g, '/')) : '—'}</div>
      </div>
      <div style="grid-column: 1 / -1;">
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

    <div class="section-title">日別実施単位マトリクス（1〜${daysInMonth}日）</div>
    <table class="matrix">
      <thead>
        <tr>
          <th style="width:52px;">項目</th>
          ${dayHeaderCells}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="row-label">曜日</td>
          ${dowRowCells}
        </tr>
        <tr>
          <td class="row-label">実施単位</td>
          ${unitCells}
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

    <div class="section-title">実施明細（セラピスト別・抜粋）</div>
    <table class="detail-table">
      <thead>
        <tr>
          <th style="width:22%;">実施日</th>
          <th style="width:38%;">担当</th>
          <th style="width:18%;">単位/区分</th>
          <th style="width:22%;">計画書</th>
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
