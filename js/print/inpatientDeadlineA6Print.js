// js/print/inpatientDeadlineA6Print.js
// デスク管理用「A6縦・リハ期限一覧表」印刷（読み取り専用・既存集計非変更）

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { calculatePatientDeadlines } from '../core/deadlineCalc.js';
import { REHA_RULES } from '../config/rules.js';
import {
  getAllPatients,
  evaluatePatientStatus
} from '../store/patientStore.js';
import { showToast } from '../ui/toast.js';

/**
 * 氏名から姓・名を分割（半角/全角スペース区切り。無ければ姓=全体）
 * @param {string} fullName
 * @returns {{ family: string, given: string }}
 */
function splitJapaneseName(fullName) {
  const raw = String(fullName || '').trim().replace(/\s+/g, ' ').replace(/　/g, ' ');
  if (!raw) return { family: '', given: '' };
  const parts = raw.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return { family: parts[0], given: parts.slice(1).join('') };
  }
  return { family: raw, given: '' };
}

/**
 * 同姓が複数いる場合のみ「姓（名1文字）」表記
 * @param {object[]} patients 同一リスト内の患者
 * @returns {Map<string, string>} patientId → 表示名
 */
function buildSurnameDisplayMap(patients) {
  /** @type {Map<string, object[]>} */
  const byFamily = new Map();
  patients.forEach((p) => {
    const { family } = splitJapaneseName(p.name);
    const key = family || String(p.id || '');
    if (!byFamily.has(key)) byFamily.set(key, []);
    byFamily.get(key).push(p);
  });

  /** @type {Map<string, string>} */
  const map = new Map();
  byFamily.forEach((list, family) => {
    const needDisambig = list.length > 1;
    list.forEach((p) => {
      const { given } = splitJapaneseName(p.name);
      if (needDisambig && given) {
        map.set(String(p.id), `${family}（${given.charAt(0)}）`);
      } else {
        map.set(String(p.id), family || String(p.name || p.id));
      }
    });
  });
  return map;
}

/**
 * 介護区分 → 略称（支 / 支1 / 介 / 介3 / －）
 * @param {object} patient
 * @returns {string}
 */
function formatCareAbbrev(patient) {
  const levelRaw = String(patient?.careLevel || patient?.careCertification || '').trim();
  if (levelRaw) {
    const support = levelRaw.match(/要支援\s*([12１２])?/);
    if (support) {
      const n = support[1] ? String(support[1]).replace('１', '1').replace('２', '2') : '';
      return n ? `支${n}` : '支';
    }
    const care = levelRaw.match(/要介護\s*([1-5１-５])?/);
    if (care) {
      const n = care[1]
        ? String(care[1])
          .replace('１', '1').replace('２', '2').replace('３', '3')
          .replace('４', '4').replace('５', '5')
        : '';
      return n ? `介${n}` : '介';
    }
    if (/なし|無し|自立|未設定|NONE/i.test(levelRaw)) return '－';
  }

  const type = String(patient?.careInsuranceType || 'NONE').toUpperCase();
  if (type === 'SUPPORT') return '支';
  if (type === 'CARE') return '介';
  return '－';
}

/**
 * YYYY-MM-DD → M月D日
 * @param {string} dateStr
 * @returns {string}
 */
function formatMonthDayJa(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '－';
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/**
 * 本日の和暦表記（令和）
 * @param {Date} [date]
 * @returns {string}
 */
function formatReiwaToday(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const reiwa = y - 2018; // 2019=令和1
  return `令和${reiwa}年${m}月${d}日現在`;
}

/**
 * 行HTML（氏名｜期限｜介護）
 * @param {{ displayName: string, limitDateStr: string, careAbbrev: string, emphasizeDate?: boolean }} row
 * @returns {string}
 */
function renderPersonRow(row) {
  const dateCls = row.emphasizeDate ? 'date-over' : 'date-ok';
  return `
    <div class="person-row">
      <span class="name">${sanitizeHtml(row.displayName)}</span>
      <span class="${dateCls}">${sanitizeHtml(formatMonthDayJa(row.limitDateStr))}</span>
      <span class="care">${sanitizeHtml(row.careAbbrev)}</span>
    </div>`;
}

/**
 * セクション内リスト
 * @param {object[]} rows
 * @param {boolean} emphasizeDate
 * @returns {string}
 */
function renderList(rows, emphasizeDate) {
  if (!rows.length) {
    return '<div class="empty">該当なし</div>';
  }
  return rows.map((r) => renderPersonRow({ ...r, emphasizeDate })).join('');
}

/**
 * 入院中・疾患別リハ対象患者を抽出し A6縦「リハ期限一覧」を印刷する
 */
export function printInpatientDeadlineA6() {
  const today = new Date();
  const all = getAllPatients(true);

  const eligible = all.filter((p) => {
    if (!p || p.category !== 'INPATIENT') return false;
    if (p.diseaseType === 'ANALGESIA') return false;
    if (!['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE'].includes(p.diseaseType)) return false;
    if (evaluatePatientStatus(p, today).isEffectiveDiscontinued) return false;
    return true;
  });

  if (eligible.length === 0) {
    showToast('印刷対象の入院リハ患者がいません', 'warn');
    return;
  }

  const nameMap = buildSurnameDisplayMap(eligible);

  /** @type {object[]} */
  const enriched = eligible.map((p) => {
    const dl = calculatePatientDeadlines(p, today);
    return {
      id: String(p.id || ''),
      patient: p,
      diseaseType: p.diseaseType,
      displayName: nameMap.get(String(p.id)) || splitJapaneseName(p.name).family || p.name,
      careAbbrev: formatCareAbbrev(p),
      limitDateStr: dl.limitDateStr || '',
      isLimitExceeded: Boolean(dl.isLimitExceeded),
      remainingDays: dl.remainingDays
    };
  }).filter((r) => r.limitDateStr);

  const byLimitAsc = (a, b) => String(a.limitDateStr).localeCompare(String(b.limitDateStr));

  const within = enriched.filter((r) => !r.isLimitExceeded);
  const over = enriched.filter((r) => r.isLimitExceeded);

  const locoOk = within.filter((r) => r.diseaseType === 'LOCOMOTIVE').sort(byLimitAsc);
  const cerebroOk = within.filter((r) => r.diseaseType === 'CEREBROVASCULAR').sort(byLimitAsc);
  const disuseOk = within.filter((r) => r.diseaseType === 'DISUSE').sort(byLimitAsc);

  const overMain = over
    .filter((r) => r.diseaseType === 'LOCOMOTIVE' || r.diseaseType === 'CEREBROVASCULAR')
    .sort(byLimitAsc);
  const overDisuse = over.filter((r) => r.diseaseType === 'DISUSE').sort(byLimitAsc);

  const locoLabel = REHA_RULES.LIMIT_DAYS.LOCOMOTIVE?.shortLabel || '運動器Ⅱ';
  const cerebroLabel = REHA_RULES.LIMIT_DAYS.CEREBROVASCULAR?.shortLabel || '脳血管Ⅲ';
  const disuseLabel = '廃用症候群Ⅲ';
  const asOf = formatReiwaToday(today);

  const printWindow = window.open('', '_blank', 'width=520,height=740');
  if (!printWindow) {
    showToast('印刷ポップアップがブロックされました。ブラウザ設定をご確認ください。', 'warn');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>リハ期限一覧（A6）</title>
  <style>
    @page {
      size: A6 portrait;
      margin: 5mm;
    }
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .sheet {
        box-shadow: none !important;
        margin: 0 !important;
      }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Meiryo UI", "Hiragino Sans", "Yu Gothic", sans-serif;
      background: #e2e8f0;
      color: #0f172a;
      padding: 12px;
    }
    .sheet {
      width: 105mm;
      min-height: 148mm;
      max-height: 148mm;
      margin: 0 auto;
      background: #fff;
      border: 1.5px solid #334155;
      padding: 4mm 4.5mm;
      display: flex;
      flex-direction: column;
      gap: 3mm;
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.18);
    }
    .double-box {
      border: 2.5px double #0f172a;
      padding: 1.5px 6px;
      font-size: 11pt;
      font-weight: 800;
      letter-spacing: 0.06em;
      display: inline-block;
      line-height: 1.2;
    }
    .top-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3mm;
      flex: 1 1 auto;
      min-height: 0;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 2mm;
      min-width: 0;
    }
    .section-title {
      font-size: 8.5pt;
      font-weight: 800;
      border-bottom: 1.5px solid #0f172a;
      padding-bottom: 1px;
      margin-bottom: 1px;
    }
    .person-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 2px 4px;
      align-items: baseline;
      font-size: 8pt;
      line-height: 1.25;
      padding: 0.5px 0;
      border-bottom: 1px dotted #cbd5e1;
    }
    .person-row .name { font-weight: 800; }
    .person-row .date-ok { font-weight: 700; color: #0f172a; white-space: nowrap; }
    .person-row .date-over { font-weight: 800; color: #dc2626; white-space: nowrap; }
    .person-row .care { font-weight: 700; color: #475569; min-width: 1.6em; text-align: right; }
    .empty {
      font-size: 7.5pt;
      color: #94a3b8;
      font-weight: 600;
      padding: 2px 0;
    }
    .lower {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3mm;
      border-top: 1.5px solid #64748b;
      padding-top: 2.5mm;
      flex-shrink: 0;
    }
    .note-sm {
      font-size: 6.5pt;
      font-weight: 700;
      color: #64748b;
      text-align: right;
      margin-bottom: 1px;
    }
    .footer {
      text-align: right;
      font-size: 7.5pt;
      font-weight: 700;
      color: #334155;
      margin-top: auto;
      padding-top: 1mm;
    }
    .hint {
      max-width: 105mm;
      margin: 10px auto 0;
      font-size: 11px;
      color: #475569;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="top-head">
      <div class="double-box">リハ期限</div>
    </div>

    <div class="columns">
      <div class="col">
        <div class="section-title">【${sanitizeHtml(locoLabel)}】</div>
        ${renderList(locoOk, false)}
      </div>
      <div class="col">
        <div class="section-title">【${sanitizeHtml(cerebroLabel)}】</div>
        ${renderList(cerebroOk, false)}
        <div class="section-title" style="margin-top:2mm;">【${sanitizeHtml(disuseLabel)}】</div>
        ${renderList(disuseOk, false)}
      </div>
    </div>

    <div class="lower">
      <div class="col">
        <div class="double-box" style="font-size:10pt; margin-bottom:2px;">１３単位</div>
        ${renderList(overMain, true)}
      </div>
      <div class="col">
        <div class="note-sm">※廃用は1日3単位まで</div>
        <div class="double-box" style="font-size:9.5pt; margin-bottom:2px;">廃用１３単位</div>
        ${renderList(overDisuse, true)}
      </div>
    </div>

    <div class="footer">${sanitizeHtml(asOf)}</div>
  </div>
  <p class="hint no-print">A6縦サイズ枠です。印刷ダイアログで用紙サイズ「A6」または拡大縮小「ページに合わせる」を選択してください。</p>
  <script>
    window.onload = function () { setTimeout(function () { window.print(); }, 180); };
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
  showToast(`リハ期限表(A6)を印刷します（対象 ${enriched.length} 名）`, 'success');
}
