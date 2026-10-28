// js/core/therapistWeeklyUnits.js
// セラピスト週間累計単位（月〜日 / 上限108）＋本日単位（表示のみ・制限なし）

import { REHA_RULES } from '../config/rules.js';
import { safeParseInt } from './dataNormalizer.js';
import { getWeekDateKeysMonSun, formatDateYMD } from './dateUtils.js';
import { getDailySchedule, isNonPatientBlock } from '../store/scheduleStore.js';

/**
 * 選択日における指定セラピストの本日取得単位数（表示専用）
 * ※個別リハ患者コマのみ。有休・公休・特別休暇・業務ブロックは除外。
 * ※配置制限・バリデーションには使用しないこと。
 * @param {string} therapistId
 * @param {string} currentDateStr YYYY-MM-DD
 * @returns {number}
 */
export function getTherapistDailyUnits(therapistId, currentDateStr) {
  const tId = String(therapistId || '').trim();
  const dateKey = String(currentDateStr || '').trim();
  if (!tId || !dateKey) return 0;

  const schedule = getDailySchedule(dateKey);
  const tSlots = schedule?.[tId] || {};
  let dailyUnits = 0;
  Object.values(tSlots).forEach((slot) => {
    if (!slot || isNonPatientBlock(slot) || !slot.patientId) return;
    dailyUnits += safeParseInt(slot.units, 1);
  });
  return dailyUnits;
}

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
 *   weekEnd: string,
 *   dailyUnits: number
 * }}
 */
export function getTherapistWeeklyUnitsMeter(therapistId, currentDateStr) {
  const max = REHA_RULES.LIMITS.THERAPIST_WEEKLY_MAX || 108;
  const used = getTherapistWeeklyUnits(therapistId, currentDateStr);
  const dailyUnits = getTherapistDailyUnits(therapistId, currentDateStr);
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
    labelMain: `${used}/${max}単位`,
    labelSub: over > 0 ? `超過+${over}` : `残${remain}`,
    weekStart,
    weekEnd,
    dailyUnits
  };
}

/**
 * 本日単位バッジ（表示のみ・色警告なし）
 * @param {number} dailyUnits
 * @param {string} [dateStr]
 * @returns {string}
 */
export function buildDailyUnitsBadgeHtml(dailyUnits, dateStr = '') {
  const n = Number(dailyUnits) || 0;
  const dateHint = dateStr
    ? String(dateStr).replace(/-/g, '/')
    : '選択日';
  return `
    <div class="daily-units-badge" title="本日（${dateHint}）の個別リハ取得単位（表示のみ・配置制限なし）">
      <span class="dum-label">本日:</span>
      <span class="dum-main">${n}単位</span>
    </div>`;
}

/**
 * ヘッダー用フル表示: 本日単位 ＋ 週108メーター
 * @param {object} meter getTherapistWeeklyUnitsMeter の戻り
 * @param {string} [dateStr]
 * @returns {string}
 */
export function buildWeeklyUnitsMeterHtml(meter, dateStr = '') {
  if (!meter) return '';
  const levelClass = meter.level === 'OVER'
    ? 'is-over'
    : (meter.level === 'WARN' ? 'is-warn' : 'is-ok');
  const title = `今週（${String(meter.weekStart).replace(/-/g, '/')}〜${String(meter.weekEnd).replace(/-/g, '/')}）累計 ${meter.used} 単位 / 上限 ${meter.max}（診療報酬: 従事者1人週108単位）`;
  const daily = Number.isFinite(meter.dailyUnits) ? meter.dailyUnits : 0;
  return `
    <div class="therapist-units-meters">
      ${buildDailyUnitsBadgeHtml(daily, dateStr)}
      <div class="weekly-units-meter ${levelClass}" title="${title}">
        <span class="wum-label">週:</span>
        <span class="wum-main">${meter.labelMain}</span>
        <span class="wum-sub">(${meter.labelSub})</span>
      </div>
    </div>`;
}

/**
 * 幅狭時コンパクトバッジ（例: 📊 18/84単位）
 * @param {object} meter
 * @returns {string}
 */
export function buildCompactUnitsBadgeHtml(meter) {
  if (!meter) return '';
  const daily = Number.isFinite(meter.dailyUnits) ? meter.dailyUnits : 0;
  const levelClass = meter.level === 'OVER'
    ? 'is-over'
    : (meter.level === 'WARN' ? 'is-warn' : 'is-ok');
  return `
    <button type="button" class="therapist-units-compact-btn ${levelClass}"
      aria-expanded="false" aria-haspopup="true"
      title="クリックで本日・週間単位の詳細を表示">
      <span class="tuc-ico" aria-hidden="true">📊</span>
      <span class="tuc-text">${daily}/${meter.used}単位</span>
    </button>`;
}

/**
 * アコーディオン詳細パネル（absolute オーバーレイ・グリッド非押し下げ）
 * @param {object} meter
 * @param {string} [dateStr]
 * @param {string} [therapistName]
 * @returns {string}
 */
export function buildUnitsDropdownHtml(meter, dateStr = '', therapistName = '') {
  if (!meter) return '';
  const daily = Number.isFinite(meter.dailyUnits) ? meter.dailyUnits : 0;
  const pct = meter.max > 0 ? Math.min(100, Math.round((meter.used / meter.max) * 100)) : 0;
  const barClass = meter.level === 'OVER' ? 'is-over' : (meter.level === 'WARN' ? 'is-warn' : 'is-ok');
  const dateHint = dateStr ? String(dateStr).replace(/-/g, '/') : '選択日';
  const weekRange = `${String(meter.weekStart).replace(/-/g, '/')}〜${String(meter.weekEnd).replace(/-/g, '/')}`;
  const remainLine = meter.over > 0
    ? `(超過! ${meter.over} 単位)`
    : `(週上限まで 残り ${meter.remain} 単位)`;
  const remainClass = meter.over > 0 ? 'is-over-text' : 'is-remain-text';
  return `
    <div class="therapist-units-dropdown" role="dialog" aria-label="単位詳細">
      <div class="tud-title">${therapistName ? `<strong>${therapistName}</strong> ` : ''}単位詳細</div>
      <div class="tud-row">
        <span class="tud-line">・本日実施: <strong>${daily}</strong> 単位</span>
      </div>
      <div class="tud-note">※本日単位は表示のみ（配置制限なし）／${dateHint}</div>
      <div class="tud-row">
        <span class="tud-line">・今週累計: <strong>${meter.used}</strong> / ${meter.max} 単位</span>
      </div>
      <div class="tud-row">
        <span class="tud-line ${remainClass}">${remainLine}</span>
      </div>
      <div class="tud-week-range">対象週: ${weekRange}</div>
      <div class="tud-bar" aria-hidden="true">
        <div class="tud-bar-fill ${barClass}" style="width:${pct}%;"></div>
      </div>
      <div class="tud-bar-label">週上限到達度 ${pct}%</div>
    </div>`;
}

/**
 * 適応型ヘッダー本体（フル表示＋コンパクト＋ドロップダウン）
 * @param {string} therapistName
 * @param {object} meter
 * @param {string} [dateStr]
 * @returns {string}
 */
export function buildTherapistHeaderUnitsHtml(therapistName, meter, dateStr = '') {
  const name = therapistName || '';
  return `
    <div class="therapist-header-full">
      <div class="therapist-col-name">${name}</div>
      ${buildWeeklyUnitsMeterHtml(meter, dateStr)}
    </div>
    <div class="therapist-header-compact">
      <div class="therapist-col-name therapist-col-name-compact">${name}</div>
      ${buildCompactUnitsBadgeHtml(meter)}
    </div>
    ${buildUnitsDropdownHtml(meter, dateStr, name)}`;
}

/** デバッグ・テスト用に週キー生成を再エクスポート */
export { formatDateYMD, getWeekDateKeysMonSun };
