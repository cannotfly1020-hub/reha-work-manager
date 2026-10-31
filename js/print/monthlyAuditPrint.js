// js/print/monthlyAuditPrint.js
// 月末実務点検・赤ペン照合用「A4横 月間点検チェックシート」印刷
// （正式提出用Excelとは別／カルテ・レセプト・計画書突き合わせ用）

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { REHA_RULES } from '../config/rules.js';
import { calculatePatientDeadlines, evaluateEarlyBonusPhase } from '../core/deadlineCalc.js';
import { getTherapistRole } from '../core/therapistRoleUtil.js';
import { getEarlyBaseDate } from '../excel/sheetUtils.js';
import { getAllTherapists, getTherapistById } from '../store/therapistStore.js';
import { formatOperatorLabel } from '../store/operatorStore.js';
import { showToast } from '../ui/toast.js';

/**
 * 患者の主担当セラピストID（マスター優先 → 当月スロット最多）
 * @param {object} item
 * @returns {string}
 */
function resolvePrimaryTherapistId(item) {
  const p = item?.patient || {};
  const masterId = String(
    p.mainTherapistId || p.assignedTherapistId || p.primaryTherapistId || p.therapistId || ''
  ).trim();
  if (masterId && masterId !== 'NONE' && masterId !== 'ANALGESIA') return masterId;

  /** @type {Record<string, number>} */
  const unitsByTherapist = {};
  (item?.slots || []).forEach((s) => {
    if (!s || s.isAnalgesia) return;
    const sid = String(s.therapist || s.therapistId || '').trim();
    if (!sid || sid === 'NONE' || sid === 'ANALGESIA') return;
    const u = Number(s.units) || 0;
    if (u <= 0) return;
    unitsByTherapist[sid] = (unitsByTherapist[sid] || 0) + u;
  });
  let bestId = '';
  let bestUnits = -1;
  Object.entries(unitsByTherapist).forEach(([id, units]) => {
    if (units > bestUnits
      || (units === bestUnits && bestId && id.localeCompare(bestId, undefined, { numeric: true }) < 0)) {
      bestUnits = units;
      bestId = id;
    }
  });
  return bestId;
}

/**
 * 特定セラピストの当人単位集計
 * @param {object} item
 * @param {string} selectedTherapistId
 * @returns {{ totalUnits: number, dailyUnits: Record<number, number>, planCount: number }|null}
 */
function calculateTherapistSpecificUnits(item, selectedTherapistId) {
  const tid = String(selectedTherapistId || '').trim();
  if (!tid || tid === 'ALL') return null;
  let totalUnits = 0;
  let planCount = 0;
  /** @type {Record<number, number>} */
  const dailyUnits = {};
  (item?.slots || []).forEach((slot) => {
    if (!slot || slot.isAnalgesia) return;
    if (String(slot.therapist || slot.therapistId || '').trim() !== tid) return;
    const u = Number(slot.units || slot.unit || 0);
    if (u <= 0) return;
    totalUnits += u;
    const day = Number(String(slot.date || '').slice(8, 10));
    if (day >= 1 && day <= 31) dailyUnits[day] = (dailyUnits[day] || 0) + u;
    if (slot.billingPlan) planCount += 1;
  });
  return { totalUnits, dailyUnits, planCount };
}

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
 * YYYY-MM-DD → M/D（帳票コンパクト用）
 * @param {string} dateStr
 * @returns {string}
 */
function fmtMd(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return dateStr.trim();
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

/**
 * 日付配列を M/D,M/D 形式に連結（空は空文字）
 * @param {string[]} dates
 * @returns {string}
 */
function fmtMdList(dates) {
  const list = (Array.isArray(dates) ? dates : []).map(fmtMd).filter(Boolean);
  return list.length ? list.join(',') : '';
}

/**
 * 日別スロットから早期加算Ⅰ・Ⅱ算定日および計画書算定日を収集
 * ※個別リハExcel（individualRehaSheet.analyzePatientItem）と同じ判定:
 *   - 早期: getEarlyBaseDate + evaluateEarlyBonusPhase(…, slot.date, 'INPATIENT')
 *   - 計画: slot.billingPlan がある日の slot.date
 * @param {object} item aggregate patientMap entry
 * @param {{ therapistId?: string|null }} [opts]
 * @returns {{ early1Dates: string[], early2Dates: string[], planDates: string[] }}
 */
function collectEarlyAndPlanDatesFromSlots(item, opts = {}) {
  const early1Dates = [];
  const early2Dates = [];
  const planDates = [];
  const seen1 = new Set();
  const seen2 = new Set();
  const seenPlan = new Set();

  const p = item?.patient || {};
  const isIn = p.category === 'INPATIENT';
  const baseEarlyDate = getEarlyBaseDate(p);
  const tidFilter = String(opts?.therapistId || '').trim();
  const filterTherapist = Boolean(tidFilter && tidFilter !== 'ALL');

  (item?.slots || []).forEach((s) => {
    if (!s || s.isAnalgesia || !s.date) return;
    if (filterTherapist) {
      const sid = String(s.therapist || s.therapistId || '').trim();
      if (sid !== tidFilter) return;
    }

    // 計画書算定日: billingPlan 付きスロットの実施日（Excel planByDay と同値源）
    if (s.billingPlan) {
      const d = String(s.date);
      if (!seenPlan.has(d)) {
        seenPlan.add(d);
        planDates.push(d);
      }
    }

    // 早期加算算定日: 入院かつ起算日あり、単位>0 の実施日を PHASE で分類
    if (!isIn || !baseEarlyDate) return;
    const u = Number(s.units || s.unit || 0);
    if (u <= 0) return;
    const ph = evaluateEarlyBonusPhase(baseEarlyDate, s.date, 'INPATIENT');
    if (ph.phase === 'PHASE_1') {
      const d = String(s.date);
      if (!seen1.has(d)) {
        seen1.add(d);
        early1Dates.push(d);
      }
    } else if (ph.phase === 'PHASE_2') {
      const d = String(s.date);
      if (!seen2.has(d)) {
        seen2.add(d);
        early2Dates.push(d);
      }
    }
  });

  early1Dates.sort();
  early2Dates.sort();
  planDates.sort();
  return { early1Dates, early2Dates, planDates };
}

/**
 * 介護認定の帳票表記（なし・未取得は「介護認定なし」）
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
 * 疾患表示ラベル（点検・計画書転記用の短表記）
 * @param {object} patient
 * @returns {{ label: string, isDisuse: boolean }}
 */
function resolveDiseaseLabel(patient) {
  if (!patient) return { label: '—', isDisuse: false };
  const type = String(patient.diseaseType || '').toUpperCase();
  if (type === 'DISUSE') return { label: '廃用', isDisuse: true };
  if (type === 'CEREBROVASCULAR') return { label: '脳血管', isDisuse: false };
  if (type === 'LOCOMOTIVE') return { label: '運動器', isDisuse: false };
  if (type === 'ANALGESIA') return { label: '消炎', isDisuse: false };
  if (type === 'CARDIOVASCULAR' || type === 'CARDIAC') return { label: '心大血管', isDisuse: false };
  if (type === 'RESPIRATORY') return { label: '呼吸器', isDisuse: false };
  const rule = REHA_RULES.LIMIT_DAYS?.[patient.diseaseType];
  const typeLabel = rule?.shortLabel || rule?.label || patient.diseaseType || '';
  const freeName = String(patient.diseaseName || patient.disease || '').trim();
  if (typeLabel) {
    const short = String(typeLabel).replace(/[ⅠⅡⅢIV]/g, '').trim();
    return { label: freeName ? `${short}/${freeName}` : short, isDisuse: false };
  }
  return { label: freeName || '—', isDisuse: false };
}

/**
 * 実施回数（単位>0の日数）と総単位
 * @param {Record<number, number>|Array<number>|null|undefined} dailyUnitsMap
 * @returns {{ totalUnits: number, sessionDays: number }}
 */
function aggregatePatientMonthlyStats(dailyUnitsMap) {
  let totalUnits = 0;
  let sessionDays = 0;
  for (let day = 1; day <= 31; day += 1) {
    const units = Number(dailyUnitsMap?.[day] || 0);
    if (units > 0) {
      totalUnits += units;
      sessionDays += 1;
    }
  }
  return { totalUnits, sessionDays };
}

/**
 * 区分ラベル
 * @param {object} patient
 * @returns {string}
 */
function resolveCategoryLabel(patient) {
  if (!patient) return '—';
  if (patient.diseaseType === 'ANALGESIA') return '消';
  return patient.category === 'OUTPATIENT' ? '外' : '入';
}

/**
 * 担当セラピスト表示
 * @param {object} item
 * @param {string|null} selectedTherapistId
 * @param {Array} therapistsMaster
 * @returns {string}
 */
function resolveTherapistLabel(item, selectedTherapistId, therapistsMaster) {
  const tid = String(selectedTherapistId || resolvePrimaryTherapistId(item) || '').trim();
  if (!tid) return '—';
  const t = getTherapistById(tid) || therapistsMaster.find((x) => String(x.id) === tid);
  const role = getTherapistRole(tid, t?.name || '', therapistsMaster);
  return t?.name ? `${role} ${t.name}` : `${role} ${tid}`;
}

/**
 * 算定期限の短縮表示
 * @param {object} patient
 * @param {string} monthEnd
 * @returns {string}
 */
function resolveLimitLabel(patient, monthEnd) {
  const isAnalgesia = patient?.diseaseType === 'ANALGESIA';
  const deadlines = calculatePatientDeadlines(patient, monthEnd);

  if (isAnalgesia) return '対象外';
  if (deadlines?.limitDateStr) {
    const exceeded = deadlines.isLimitExceeded ? '超' : '';
    return `${fmtSlash(deadlines.limitDateStr)}${exceeded}`;
  }
  return '上限なし';
}

/**
 * 早期加算ⅠまたはⅡの算定日ラベル（列分離用）
 * 対象外・起算未設定・算定なしはすべて「-」
 * @param {object} patient
 * @param {string[]} dates
 * @returns {{ label: string, hasAny: boolean }}
 */
function resolveEarlyPhaseColumnLabel(patient, dates) {
  const isAnalgesia = patient?.diseaseType === 'ANALGESIA';
  const isOut = patient?.category === 'OUTPATIENT';
  if (isOut || isAnalgesia || !getEarlyBaseDate(patient)) {
    return { label: '-', hasAny: false };
  }
  const text = fmtMdList(dates);
  if (!text) return { label: '-', hasAny: false };
  return { label: text, hasAny: true };
}

/**
 * 計画書算定日ラベル（slot.billingPlan の実施日）
 * @param {string[]} planDates
 * @returns {{ label: string, hasAny: boolean }}
 */
function resolvePlanCalcLabel(planDates) {
  const list = Array.isArray(planDates) ? planDates : [];
  if (!list.length) return { label: '未', hasAny: false };
  const text = fmtMdList(list);
  return { label: text || '未', hasAny: true };
}

/**
 * 月間点検チェックシートを印刷する
 * @param {object} options
 * @param {number} options.year
 * @param {number} options.month
 * @param {object[]} options.patients aggregate patientMap entries（絞り込み・ソート済み）
 * @param {number} [options.daysInMonth]
 * @param {string|null} [options.selectedTherapistId]
 * @param {string} [options.quickFilterLabel]
 */
export function printMonthlyAuditSheet({
  year,
  month,
  patients,
  daysInMonth: daysInMonthOpt,
  selectedTherapistId = null,
  quickFilterLabel = '全員'
}) {
  const y = Number(year);
  const m = Number(month);
  const rows = Array.isArray(patients) ? patients : [];
  const daysInMonth = Number(daysInMonthOpt) || new Date(y, m, 0).getDate();
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  const therapistsMaster = getAllTherapists();
  const tid = String(selectedTherapistId || '').trim();
  const therapistFocus = Boolean(tid);

  if (!y || !m) {
    showToast('対象年月が不正です', 'warn');
    return;
  }
  if (rows.length === 0) {
    showToast('印刷対象の患者がいません（絞り込み結果が0件）', 'warn');
    return;
  }

  let sheetSubtitle = `${y}年${m}月分 月間点検チェックシート`;
  let sheetScope = `絞り込み: ${quickFilterLabel}`;
  if (therapistFocus) {
    const t = getTherapistById(tid);
    const role = getTherapistRole(tid, t?.name || '', therapistsMaster);
    const tName = t?.name || tid;
    sheetSubtitle = `${role} ${tName} 担当患者 月間点検シート（${y}年${m}月）`;
    sheetScope = `担当: ${role} ${tName} ／ ${quickFilterLabel}`;
  }

  const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];
  let dayHeaderCells = '';
  let dowHeaderCells = '';
  for (let d = 1; d <= 31; d += 1) {
    if (d > daysInMonth) {
      dayHeaderCells += '<th class="d empty">-</th>';
      dowHeaderCells += '<th class="d empty">-</th>';
      continue;
    }
    const dt = new Date(y, m - 1, d);
    const dow = dt.getDay();
    const cls = dow === 0 ? 'sun' : (dow === 6 ? 'sat' : '');
    dayHeaderCells += `<th class="d ${cls}">${d}</th>`;
    dowHeaderCells += `<th class="d dow ${cls}">${dowLabels[dow]}</th>`;
  }

  let bodyRows = '';
  rows.forEach((item, idx) => {
    const p = item?.patient || {};
    const specific = therapistFocus ? calculateTherapistSpecificUnits(item, tid) : null;
    const daily = specific?.dailyUnits || {};
    const totalOwn = specific ? specific.totalUnits : (item.rehaTotalUnits || item.totalUnits || 0);
    const totalAll = item.rehaTotalUnits || item.totalUnits || 0;
    const auditDates = collectEarlyAndPlanDatesFromSlots(item, {
      therapistId: therapistFocus ? tid : null
    });
    const early1Col = resolveEarlyPhaseColumnLabel(p, auditDates.early1Dates);
    const early2Col = resolveEarlyPhaseColumnLabel(p, auditDates.early2Dates);
    const planCalc = resolvePlanCalcLabel(auditDates.planDates);
    const cat = resolveCategoryLabel(p);
    const diseaseInfo = resolveDiseaseLabel(p);
    const therapistLabel = resolveTherapistLabel(item, tid || null, therapistsMaster);
    const care = resolveCareInsuranceDisplay(p);
    const limitLabel = resolveLimitLabel(p, monthEnd);

    /** @type {Record<number, number>} */
    const statsDaily = {};
    for (let d = 1; d <= daysInMonth; d += 1) {
      statsDaily[d] = therapistFocus
        ? (daily[d] || 0)
        : (item.dailyRehaUnits?.[d] || item.dailyUnits?.[d] || 0);
    }
    const monthlyStats = aggregatePatientMonthlyStats(statsDaily);
    const sessionDays = monthlyStats.sessionDays;

    let dayCells = '';
    for (let d = 1; d <= 31; d += 1) {
      if (d > daysInMonth) {
        dayCells += '<td class="d empty">-</td>';
        continue;
      }
      const u = statsDaily[d] || 0;
      const dt = new Date(y, m - 1, d);
      const dow = dt.getDay();
      const cls = dow === 0 ? 'sun' : (dow === 6 ? 'sat' : '');
      dayCells += u > 0
        ? `<td class="d ${cls} on"><strong>${u}</strong></td>`
        : `<td class="d ${cls}"><span class="dash">·</span></td>`;
    }

    const totalCell = therapistFocus && totalOwn !== totalAll
      ? `<span class="own">${totalOwn}</span><span class="all">/${totalAll}</span>`
      : `<strong>${totalOwn}</strong>`;
    const diseaseCls = diseaseInfo.isDisuse ? 'meta disease disuse' : 'meta disease';

    bodyRows += `
      <tr>
        <td class="chk"><span class="box">□</span><span class="chk-l">点検</span></td>
        <td class="chk"><span class="box">□</span><span class="chk-l">計画</span></td>
        <td class="meta id">${sanitizeHtml(p.id || '')}</td>
        <td class="meta name">${sanitizeHtml(p.name || '—')}</td>
        <td class="meta cat">${sanitizeHtml(cat)}</td>
        <td class="${diseaseCls}">${sanitizeHtml(diseaseInfo.label)}</td>
        <td class="meta sess" title="実施回数 ${sessionDays}回 / 総単位 ${monthlyStats.totalUnits}">${sessionDays}</td>
        <td class="meta th">${sanitizeHtml(therapistLabel)}</td>
        <td class="meta lim">${sanitizeHtml(limitLabel)}</td>
        <td class="meta early e1 ${early1Col.hasAny ? 'ok' : 'empty'}" title="早期加算Ⅰ算定日">${sanitizeHtml(early1Col.label)}</td>
        <td class="meta early e2 ${early2Col.hasAny ? 'ok' : 'empty'}" title="早期加算Ⅱ算定日">${sanitizeHtml(early2Col.label)}</td>
        <td class="meta care">${sanitizeHtml(care)}</td>
        ${dayCells}
        <td class="tot">${totalCell}</td>
        <td class="plan ${planCalc.hasAny ? 'ok' : 'ng'}" title="計画書算定日（billingPlan 付きスロット）">${sanitizeHtml(planCalc.label)}</td>
        <td class="no">${idx + 1}</td>
      </tr>`;
  });

  const printedAt = new Date();
  const printedStr = `${printedAt.getFullYear()}/${String(printedAt.getMonth() + 1).padStart(2, '0')}/${String(printedAt.getDate()).padStart(2, '0')} ${String(printedAt.getHours()).padStart(2, '0')}:${String(printedAt.getMinutes()).padStart(2, '0')}`;
  const operatorLabel = formatOperatorLabel();

  const printWindow = window.open('', '_blank', 'width=1280,height=900');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>月間点検_${y}-${String(m).padStart(2, '0')}${therapistFocus ? `_${tid}` : ''}</title>
  <style>
    @page {
      size: A4 landscape;
      size: 297mm 210mm;
      margin: 6mm 8mm;
    }
    @media print {
      @page {
        size: A4 landscape;
        size: 297mm 210mm;
        margin: 6mm 8mm;
      }
      html, body {
        width: 297mm !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tr { page-break-inside: avoid; break-inside: avoid; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: "Meiryo UI", "Hiragino Sans", "Segoe UI", sans-serif;
      color: #0f172a;
      background: #fff;
      font-size: 7pt;
      line-height: 1.15;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 3px;
      margin-bottom: 4px;
    }
    .sheet-title {
      font-size: 12pt;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .sheet-sub {
      font-size: 7.5pt;
      font-weight: 700;
      color: #475569;
      margin-top: 1px;
    }
    .sheet-meta {
      text-align: right;
      font-size: 7.5pt;
      font-weight: 700;
      color: #334155;
    }
    .badge {
      display: inline-block;
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #7dd3fc;
      border-radius: 3px;
      padding: 1px 6px;
      font-weight: 800;
      font-size: 8pt;
    }
    .hint {
      font-size: 6.5pt;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 3px;
    }
    table.audit {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 6.2pt;
    }
    table.audit th, table.audit td {
      border: 1px solid #64748b;
      vertical-align: middle;
      padding: 1px 1px;
      text-align: center;
      overflow: hidden;
    }
    table.audit thead th {
      background: #1e293b;
      color: #fff;
      font-weight: 800;
      font-size: 5.8pt;
    }
    table.audit thead th.d.sat { background: #1d4ed8; }
    table.audit thead th.d.sun { background: #be123c; }
    table.audit thead th.d.empty { background: #94a3b8; color: #e2e8f0; }
    table.audit thead th.dow { background: #334155; font-weight: 700; font-size: 5.2pt; }
    table.audit thead th.dow.sat { background: #2563eb; }
    table.audit thead th.dow.sun { background: #e11d48; }
    .chk { width: 20px; background: #fffbeb; }
    .chk .box { font-size: 9pt; font-weight: 800; line-height: 1; display: block; }
    .chk .chk-l { font-size: 4.8pt; color: #92400e; font-weight: 800; display: block; }
    .meta { text-align: left !important; padding-left: 2px !important; font-weight: 700; }
    .meta.id { width: 30px; font-size: 5.2pt; color: #64748b; }
    .meta.name { width: 44px; font-size: 6.5pt; font-weight: 800; }
    .meta.cat { width: 12px; text-align: center !important; padding-left: 0 !important; }
    .meta.disease { width: 32px; font-size: 5.2pt; font-weight: 800; }
    .meta.disease.disuse {
      background: #fff7ed !important;
      color: #9a3412 !important;
      border-left: 2px solid #ea580c;
      font-weight: 900;
    }
    .meta.sess {
      width: 18px;
      text-align: center !important;
      padding-left: 0 !important;
      font-size: 6.5pt;
      font-weight: 900;
      color: #0f172a;
      background: #f8fafc;
    }
    .meta.th { width: 32px; font-size: 5pt; color: #0369a1; }
    .meta.lim { width: 38px; font-size: 4.8pt; }
    .meta.early {
      width: 36px;
      font-size: 4.5pt;
      line-height: 1.12;
      white-space: normal;
      word-break: break-all;
      text-align: center !important;
      padding-left: 1px !important;
      padding-right: 1px !important;
    }
    .meta.early.ok { font-weight: 700; }
    .meta.early.e1.ok { background: #ecfdf5; color: #047857; }
    .meta.early.e2.ok { background: #eff6ff; color: #1d4ed8; }
    .meta.early.empty { color: #94a3b8; font-weight: 600; }
    .meta.care { width: 32px; font-size: 4.8pt; }
    td.d, th.d { width: 12.5px; }
    td.d.sat { background: #eff6ff; }
    td.d.sun { background: #fff1f2; }
    td.d.on strong { color: #0f172a; font-weight: 800; }
    td.d .dash { color: #cbd5e1; }
    td.d.empty, th.d.empty { background: #f1f5f9; color: #cbd5e1; }
    .tot { width: 24px; font-weight: 800; background: #f8fafc; }
    .tot .own { color: #0369a1; font-weight: 800; }
    .tot .all { color: #64748b; font-size: 5pt; font-weight: 600; }
    .plan {
      width: 30px;
      font-weight: 800;
      font-size: 4.5pt;
      white-space: normal;
      word-break: break-all;
      line-height: 1.12;
    }
    .plan.ok { background: #e0f2fe; color: #0369a1; }
    .plan.ng { background: #fef2f2; color: #b91c1c; }
    .no { width: 14px; color: #94a3b8; font-size: 5pt; }
    .footer {
      margin-top: 4px;
      display: flex;
      justify-content: space-between;
      font-size: 6.5pt;
      color: #64748b;
      border-top: 1px solid #cbd5e1;
      padding-top: 2px;
    }
    .sign {
      display: flex;
      gap: 10px;
      margin-top: 4px;
      font-size: 7pt;
      font-weight: 700;
      color: #475569;
    }
    .sign .box {
      border: 1px solid #64748b;
      border-radius: 3px;
      padding: 3px 8px;
      min-width: 90px;
      min-height: 28px;
    }
  </style>
</head>
<body>
  <div class="sheet-head">
    <div>
      <div class="sheet-title">${sanitizeHtml(sheetSubtitle)}</div>
      <div class="sheet-sub">実務点検・赤ペン照合用（カルテ／レセプト／実施計画書 突合）／提出用Excelとは別帳票</div>
    </div>
    <div class="sheet-meta">
      <div class="badge">${sanitizeHtml(sheetScope)}</div>
      <div style="margin-top:2px;">対象 ${rows.length} 名 ／ A4横・複数ページ可</div>
    </div>
  </div>
  <div class="hint">
    ※ 左端の「□ 点検」「□ 計画」に赤ペンでチェック。「早期加算Ⅰ／Ⅱ」は当月スロットを PHASE_1 / PHASE_2 で分類した算定日（なしは -）。「計画算定日」は billingPlan 付きスロットの実施日。日別は${therapistFocus ? '選択セラピストの当人実施単位' : '患者の個別リハ単位'}を表示。
  </div>
  <table class="audit">
    <thead>
      <tr>
        <th class="chk" rowspan="2">□点検</th>
        <th class="chk" rowspan="2">□計画</th>
        <th class="meta id" rowspan="2">ID</th>
        <th class="meta name" rowspan="2">氏名</th>
        <th class="meta cat" rowspan="2">区</th>
        <th class="meta disease" rowspan="2">疾患</th>
        <th class="meta sess" rowspan="2" title="実施回数（単位&gt;0の日数）">回数</th>
        <th class="meta th" rowspan="2">担当</th>
        <th class="meta lim" rowspan="2">算定期限</th>
        <th class="meta early e1" rowspan="2" title="早期加算Ⅰ算定日（PHASE_1）">早期加算Ⅰ</th>
        <th class="meta early e2" rowspan="2" title="早期加算Ⅱ算定日（PHASE_2）">早期加算Ⅱ</th>
        <th class="meta care" rowspan="2">介護認定</th>
        ${dayHeaderCells}
        <th class="tot" rowspan="2">計${therapistFocus ? '<br>当/全' : ''}</th>
        <th class="plan" rowspan="2" title="billingPlan 付きスロットの実施日">計画算定日</th>
        <th class="no" rowspan="2">#</th>
      </tr>
      <tr>
        ${dowHeaderCells}
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
  <div class="sign">
    <div class="box">点検者印</div>
    <div class="box">確認者印</div>
    <div class="box">備考</div>
  </div>
  <div class="footer">
    <span>出力: ${printedStr} / 操作者: ${sanitizeHtml(operatorLabel)}</span>
    <span>reha-work-manager · 月間点検チェックシート · A4横</span>
  </div>
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
  showToast(`${y}年${m}月 点検チェックシート（${rows.length}名）を印刷します`, 'success');
}
