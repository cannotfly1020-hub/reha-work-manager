// js/excel/uketsukeWriter.js
// 受付提出用Excel生成層（医事課入力支援・経営レセプト収益サマリー完備・200行制限準拠）

import { REHA_RULES } from '../config/rules.js';
import { calculatePatientDeadlines, evaluateEarlyBonusPhase } from '../core/deadlineCalc.js';

const INPATIENT_SHEET = '実施ﾘｽﾄ 入院';
const OUTPATIENT_SHEET = '実施ﾘｽﾄ 外来';
const SUMMARY_SHEET = 'レセプト収益サマリー';

/**
 * 受付提出用ワークブック生成（事務提出・経営集計対応）
 */
export function generateUketsukeWorkbook(aggregated, templateBuffer = null) {
  if (!window.XLSX) throw new Error('SheetJS (XLSX) が読み込まれていません。');

  let wb;
  if (templateBuffer) {
    wb = window.XLSX.read(templateBuffer, { type: 'array' });
  } else {
    wb = window.XLSX.utils.book_new();
  }

  writeExecutiveSummarySheet(wb, aggregated);
  writeJimuPatientSheet(wb, aggregated, 'INPATIENT', INPATIENT_SHEET);
  writeJimuPatientSheet(wb, aggregated, 'OUTPATIENT', OUTPATIENT_SHEET);

  return wb;
}

/**
 * 経営者向け: レセプト総点数・総売上・加算別サマリーシート
 */
function writeExecutiveSummarySheet(wb, aggregated) {
  const { patientMap, year, month } = aggregated;
  const rows = [
    [`【${year}年${month}月 リハビリテーション科 レセプト・収益確定サマリー】`],
    ['項目 / 区分', '算定対象 (単位/回)', '単価点数', '総点数', '総売上金額 (¥)', '備考']
  ];

  const diseaseStats = { LOCOMOTIVE: 0, CEREBROVASCULAR: 0, DISUSE: 0, ANALGESIA: 0 };
  let early1Count = 0, early2Count = 0;
  const planStats = { PLAN_1_FIRST: 0, PLAN_1_FOLLOW: 0, PLAN_2_FIRST: 0, PLAN_2_FOLLOW: 0 };

  Object.values(patientMap).forEach((item) => {
    const p = item.patient;
    if (diseaseStats[p.diseaseType] !== undefined) {
      diseaseStats[p.diseaseType] += (p.diseaseType === 'ANALGESIA' ? item.slots.length : item.totalUnits);
    }
    item.slots.forEach((s) => {
      if (s.billingPlan && planStats[s.billingPlan] !== undefined) planStats[s.billingPlan]++;
      if (p.category === 'INPATIENT' && !s.isAnalgesia) {
        const ph = evaluateEarlyBonusPhase(p.earlyBonusStartDate || p.admissionDate, s.date, 'INPATIENT');
        if (ph.phase === 'PHASE_1') early1Count++;
        else if (ph.phase === 'PHASE_2') early2Count++;
      }
    });
  });

  const addRow = (label, qty, pts, note = '') => {
    const totalPts = qty * pts;
    rows.push([label, qty, pts, totalPts, totalPts * 10, note]);
    return totalPts;
  };

  let grandTotalPoints = 0;
  grandTotalPoints += addRow('運動器リハビリテーション(Ⅱ)', diseaseStats.LOCOMOTIVE, REHA_RULES.LIMIT_DAYS.LOCOMOTIVE.defaultPoints, '単位');
  grandTotalPoints += addRow('脳血管疾患等リハビリテーション(Ⅲ)', diseaseStats.CEREBROVASCULAR, REHA_RULES.LIMIT_DAYS.CEREBROVASCULAR.defaultPoints, '単位');
  grandTotalPoints += addRow('廃用症候群リハビリテーション(Ⅲ)', diseaseStats.DISUSE, REHA_RULES.LIMIT_DAYS.DISUSE.defaultPoints, '単位');
  grandTotalPoints += addRow('消炎鎮痛等処置 (物療)', diseaseStats.ANALGESIA, 35, '件数 (外来/入院)');
  grandTotalPoints += addRow('早期加算(Ⅰ) 1〜4日目', early1Count, REHA_RULES.EARLY_BONUS.PHASE_1.points, '件数 (入院のみ)');
  grandTotalPoints += addRow('早期加算(Ⅱ) 5〜14日目', early2Count, REHA_RULES.EARLY_BONUS.PHASE_2.points, '件数 (入院のみ)');
  grandTotalPoints += addRow('総合実施計画書1 (初回)', planStats.PLAN_1_FIRST, REHA_RULES.PLAN_POINTS.PLAN_1_FIRST, '件数');
  grandTotalPoints += addRow('総合実施計画書1 (2回目以降)', planStats.PLAN_1_FOLLOW, REHA_RULES.PLAN_POINTS.PLAN_1_FOLLOW, '件数');
  grandTotalPoints += addRow('総合実施計画書2 (初回)', planStats.PLAN_2_FIRST, REHA_RULES.PLAN_POINTS.PLAN_2_FIRST, '件数 (要介護3分の1)');
  grandTotalPoints += addRow('総合実施計画書2 (2回目以降:固定)', planStats.PLAN_2_FOLLOW, REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW, '件数 (要介護3分の1継続)');

  rows.push(['【総合計】', '-', '-', grandTotalPoints, grandTotalPoints * 10, 'レセプト総収益']);

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  setSheetCols(ws, [32, 18, 12, 14, 18, 24]);
  appendOrReplaceSheet(wb, ws, SUMMARY_SHEET);
}

/**
 * 事務（医事課）向け: 患者別日別単位・加算・計画書詳細シート
 */
function writeJimuPatientSheet(wb, aggregated, category, sheetName) {
  const { daysInMonth, patientMap } = aggregated;
  const isInput = category === 'INPATIENT';

  const header = ['患者ID', '患者氏名', '疾患名', '介護認定', '当月総単位'];
  for (let d = 1; d <= daysInMonth; d++) header.push(`${d}日`);
  if (isInput) header.push('早期加算Ⅰ(60点)', '早期加算Ⅱ(25点)');
  header.push('計画書算定日', '計画書区分・点数', '備考');

  const rows = [header];
  const patients = Object.values(patientMap).filter((item) => item.patient.category === category);

  patients.forEach((item) => {
    const p = item.patient;
    const row = [p.id, p.name, p.diseaseName || p.diseaseType, p.careInsuranceType === 'CARE' ? '要介護' : (p.careInsuranceType === 'SUPPORT' ? '要支援' : 'なし'), item.totalUnits];

    for (let d = 1; d <= daysInMonth; d++) {
      const u = item.dailyUnits[d];
      row.push(u > 0 ? u : '');
    }

    let e1 = 0, e2 = 0, planDate = '', planLabel = '';
    item.slots.forEach((s) => {
      if (s.billingPlan) {
        planDate = s.date ? s.date.slice(5) : '';
        planLabel = formatPlanLabel(s.billingPlan);
      }
      if (isInput && !s.isAnalgesia) {
        const ph = evaluateEarlyBonusPhase(p.earlyBonusStartDate || p.admissionDate, s.date, 'INPATIENT');
        if (ph.phase === 'PHASE_1') e1++;
        else if (ph.phase === 'PHASE_2') e2++;
      }
    });

    if (isInput) { row.push(e1 > 0 ? `${e1}日` : '-', e2 > 0 ? `${e2}日` : '-'); }
    row.push(planDate || '-', planLabel || '-', p.notes || '');
    rows.push(row);
  });

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const colWidths = [10, 14, 20, 10, 12];
  for (let d = 1; d <= daysInMonth; d++) colWidths.push(4);
  if (isInput) colWidths.push(14, 14);
  colWidths.push(12, 22, 20);

  setSheetCols(ws, colWidths);
  appendOrReplaceSheet(wb, ws, sheetName);
}

function formatPlanLabel(planKey) {
  switch (planKey) {
    case 'PLAN_1_FIRST': return '計画書1 (初回 300点)';
    case 'PLAN_1_FOLLOW': return '計画書1 (継続 240点)';
    case 'PLAN_2_FIRST': return '計画書2 (初回 240点)';
    case 'PLAN_2_FOLLOW': return '計画書2 (継続 196点)';
    default: return planKey;
  }
}

function setSheetCols(ws, widthList) {
  ws['!cols'] = widthList.map((w) => ({ wch: w }));
}

function appendOrReplaceSheet(wb, ws, name) {
  const existingIdx = wb.SheetNames.indexOf(name);
  if (existingIdx >= 0) {
    wb.Sheets[name] = ws;
  } else {
    window.XLSX.utils.book_append_sheet(wb, ws, name);
  }
}
