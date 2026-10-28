// js/core/therapistWeeklyUnits.js
// セラピスト週間累計単位（月〜日 / 上限108）集計・メーター表示用メタ

import { REHA_RULES } from '../config/rules.js';
import { safeParseInt } from './dataNormalizer.js';
import { getWeekDateKeysMonSun, formatDateYMD } from './dateUtils.js';
import { getDailySchedule, isNonPatientBlock } from '../store/scheduleStore.js';

/**
 * 対象日付が含まれる週（月曜〜日曜）における指定セラピストの累計単位数を計算
 * ※個別リハ患者コマのみ合算。有休・公休・特別休暇・業務ブロックは含めない。
 * @param {string} therapistId
 * @param {string} currentDateStr YYYY-MM-DD
 * @returns {number}
 */
export function getTherapistWeeklyUnits(therapistId, currentDateStr) {
  const tId = String(therapistId || '').trim();
  if (!tId || !currentDateStr) return 0;

  const dateKeys = getWeekDateKeysMonSun(currentDateStr);
  let totalWeeklyUnits = 0;

  dateKeys.forEach((dateKey) => {
    const schedule = getDailySchedule(dateKey);
    const tSlots = schedule?.[tId] || {};
    Object.values(tSlots).forEach((slot) => {
      if (!slot || isNonPatientBlock(slot) || !slot.patientId) return;
      totalWeeklyUnits += safeParseInt(slot.units, 1);
    });
  });

  return totalWeeklyUnits;
}

/**
 * 週108単位メーター用の表示メタ
 * @param {string} therapistId
 * @param {string} currentDateStr
 * @returns {{
 *   used: number,
 *   max: number,
 *   remain: number,
 *   over: number,
 *   level: 'OK'|'WARN'|'OVER',
 *   labelMain: string,
 *   labelSub: string,
 *   weekStart: string,
 *   weekEnd: string
 * }}
 */
export function getTherapistWeeklyUnitsMeter(therapistId, currentDateStr) {
  const max = REHA_RULES.LIMITS.THERAPIST_WEEKLY_MAX || 108;
  const used = getTherapistWeeklyUnits(therapistId, currentDateStr);
  const remain = Math.max(0, max - used);
  const over = Math.max(0, used - max);
  const keys = getWeekDateKeysMonSun(currentDateStr);
  const weekStart = keys[0] || '';
  const weekEnd = keys[6] || keys[keys.length - 1] || '';

  let level = 'OK';
  if (used > max) level = 'OVER';
  else if (used >= Math.floor(max * 0.85)) level = 'WARN'; // 約92単位〜注意

  return {
    used,
    max,
    remain,
    over,
    level,
    labelMain: `${used}/${max}`,
    labelSub: over > 0 ? `超過+${over}` : `残${remain}`,
    weekStart,
    weekEnd
  };
}

/**
 * メーターHTML断片（時間割ヘッダー用）
 * @param {object} meter getTherapistWeeklyUnitsMeter の戻り
 * @returns {string}
 */
export function buildWeeklyUnitsMeterHtml(meter) {
  if (!meter) return '';
  const levelClass = meter.level === 'OVER'
    ? 'is-over'
    : (meter.level === 'WARN' ? 'is-warn' : 'is-ok');
  const title = `今週（${String(meter.weekStart).replace(/-/g, '/')}〜${String(meter.weekEnd).replace(/-/g, '/')}）累計 ${meter.used} 単位 / 上限 ${meter.max}（診療報酬: 従事者1人週108単位）`;
  return `
    <div class="weekly-units-meter ${levelClass}" title="${title}">
      <span class="wum-label">週</span>
      <span class="wum-main">${meter.labelMain}</span>
      <span class="wum-sub">${meter.labelSub}</span>
    </div>`;
}

/** デバッグ・テスト用に週キー生成を再エクスポート */
export { formatDateYMD, getWeekDateKeysMonSun };
