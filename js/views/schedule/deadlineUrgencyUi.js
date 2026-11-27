// js/views/schedule/deadlineUrgencyUi.js
// 疾患別リハ算定期限の接近バッジ／ツールチップ（読み取り専用・deadlineCalc 利用）

import { REHA_RULES } from '../../config/rules.js';
import { calculatePatientDeadlines } from '../../core/deadlineCalc.js';
import { sanitizeHtml } from '../../core/dataNormalizer.js';
import { evaluatePatientStatus } from '../../store/patientStore.js';

/** 残り日数の視覚強調レンジ（当日0〜14日前） */
export const DEADLINE_URGENCY_MAX_DAYS = 14;

/**
 * YYYY-MM-DD → YYYY/MM/DD
 * @param {string} ymd
 * @returns {string}
 */
export function formatYmdSlash(ymd) {
  const s = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
  return s.replace(/-/g, '/');
}

/**
 * 介護度の短表記
 * @param {object} patient
 * @returns {string}
 */
export function formatCareLabel(patient) {
  const level = String(patient?.careLevel || patient?.careCertification || '').trim();
  if (level
    && level !== 'なし'
    && level !== '無し'
    && level !== '自立'
    && level !== 'NONE'
    && level !== '介護認定なし') {
    return level;
  }
  const type = String(patient?.careInsuranceType || 'NONE').toUpperCase();
  if (type === 'CARE') return REHA_RULES.CARE_INSURANCE?.CARE?.label || '要介護';
  if (type === 'SUPPORT') return REHA_RULES.CARE_INSURANCE?.SUPPORT?.label || '要支援';
  return 'なし';
}

/**
 * 疾患別リハの算定期限接近情報（消炎・終了済み・上限なしは null）
 * @param {object} patient
 * @param {string} baseDateStr YYYY-MM-DD（表示中の時間割日付）
 * @returns {null|{
 *   remainingDays: number,
 *   limitDateStr: string,
 *   startDateStr: string,
 *   diseaseLabel: string,
 *   isExceeded: boolean,
 *   level: 'warn'|'danger'|'today'|null,
 *   cardClass: string,
 *   badgeText: string,
 *   statusText: string,
 *   title: string
 * }}
 */
export function getDiseaseLimitUrgency(patient, baseDateStr) {
  if (!patient || patient.diseaseType === 'ANALGESIA') return null;
  if (evaluatePatientStatus(patient, baseDateStr).isEffectiveDiscontinued) return null;

  const disease = REHA_RULES.LIMIT_DAYS[patient.diseaseType];
  if (!disease || !(disease.days < 9000)) return null;

  const dl = calculatePatientDeadlines(patient, baseDateStr);
  if (!dl.limitDateStr || dl.remainingDays === null || dl.remainingDays === undefined) return null;

  const remainingDays = Number(dl.remainingDays);
  const isExceeded = Boolean(dl.isLimitExceeded) || remainingDays < 0;
  const diseaseLabel = dl.diseaseLabel || disease.shortLabel || patient.diseaseType || '';
  const limitSlash = formatYmdSlash(dl.limitDateStr);

  let level = null;
  let badgeText = '';
  let statusText = '';
  let cardClass = '';

  if (isExceeded) {
    const over = Math.abs(remainingDays);
    statusText = over > 0 ? `超過${over}日` : '超過';
    // 超過は枠線バッジを出さず title のみ（月13単位表示との重複回避）
    level = null;
    badgeText = '';
    cardClass = '';
  } else if (remainingDays === 0) {
    level = 'today';
    badgeText = '本日満了';
    statusText = '本日満了';
    cardClass = 'deadline-urgent-today';
  } else if (remainingDays >= 1 && remainingDays <= 7) {
    level = 'danger';
    badgeText = `残${remainingDays}日`;
    statusText = `残${remainingDays}日`;
    cardClass = 'deadline-urgent-danger';
  } else if (remainingDays >= 8 && remainingDays <= DEADLINE_URGENCY_MAX_DAYS) {
    level = 'warn';
    badgeText = `残${remainingDays}日`;
    statusText = `残${remainingDays}日`;
    cardClass = 'deadline-urgent-warn';
  } else {
    statusText = `残${remainingDays}日`;
  }

  const remainLabel = isExceeded
    ? statusText
    : (remainingDays === 0 ? '残り0日・本日満了' : `残り${remainingDays}日`);
  const title = `${diseaseLabel} / 算定満了日: ${limitSlash}（${remainLabel}）`;

  return {
    remainingDays,
    limitDateStr: dl.limitDateStr,
    startDateStr: dl.startDateStr || '',
    diseaseLabel,
    isExceeded,
    level,
    cardClass,
    badgeText,
    statusText,
    title
  };
}

/**
 * バッジ HTML（接近時のみ）
 * @param {{ level?: string|null, badgeText?: string }|null} urgency
 * @returns {string}
 */
export function buildDeadlineBadgeHtml(urgency) {
  if (!urgency?.level || !urgency.badgeText) return '';
  const cls = urgency.level === 'today'
    ? 'badge-deadline badge-deadline-today'
    : (urgency.level === 'danger'
      ? 'badge-deadline badge-deadline-danger'
      : 'badge-deadline badge-deadline-warn');
  return `<span class="${cls}" title="${sanitizeHtml(urgency.title || '')}">${sanitizeHtml(urgency.badgeText)}</span>`;
}
