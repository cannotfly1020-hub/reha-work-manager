// js/core/timeSlotGenerator.js
// 施設診療時間から20分刻みスロットを動的生成する単一情報源（Single Source of Truth）
// デフォルト: 午前 09:00〜13:00（12コマ）／昼休憩／午後 14:00〜18:00（12コマ）＝計24コマ

/**
 * 施設の診療時間設定（将来の施設設定UIからも同じ形で渡す）
 * @typedef {{ amStart: string, amEnd: string, pmStart: string, pmEnd: string }} FacilityHours
 */

/** @type {FacilityHours} */
export const DEFAULT_FACILITY_HOURS = {
  amStart: '09:00',
  amEnd: '13:00',   // 昼休憩開始（午前終了）
  pmStart: '14:00',  // 昼休憩終了（午後開始）
  pmEnd: '18:00'     // 業務終了
};

/**
 * HH:MM 文字列を通算分（0〜1440）に変換
 * @param {string} timeStr
 * @returns {number}
 */
export function timeToMinutes(timeStr) {
  if (!timeStr || !String(timeStr).includes(':')) return 0;
  const [h, m] = String(timeStr).split(':').map(Number);
  return ((Number(h) || 0) * 60) + (Number(m) || 0);
}

/**
 * 通算分を HH:MM 文字列に変換
 * @param {number} minutes
 * @returns {string}
 */
export function minutesToTime(minutes) {
  const total = ((Number(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 施設設定を正規化（欠落キーはデフォルトで補完）
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {FacilityHours}
 */
export function normalizeFacilityHours(hours) {
  return {
    amStart: hours?.amStart || DEFAULT_FACILITY_HOURS.amStart,
    amEnd: hours?.amEnd || DEFAULT_FACILITY_HOURS.amEnd,
    pmStart: hours?.pmStart || DEFAULT_FACILITY_HOURS.pmStart,
    pmEnd: hours?.pmEnd || DEFAULT_FACILITY_HOURS.pmEnd
  };
}

/**
 * 施設設定に基づいて20分刻みの TIME_SLOTS 配列を動的生成する。
 * 既存画面互換のため period は 'am'|'pm'、label は 'HH:MM - HH:MM'、start/end を必ず付与する。
 *
 * @param {Partial<FacilityHours>} [hours]
 * @returns {Array<{
 *   id: string,
 *   label: string,
 *   start: string,
 *   end: string,
 *   startTime: string,
 *   endTime: string,
 *   period: 'am'|'pm',
 *   order: number
 * }>}
 */
export function generateTimeSlots(hours = DEFAULT_FACILITY_HOURS) {
  const h = normalizeFacilityHours(hours);
  const slots = [];

  const amStartMin = timeToMinutes(h.amStart);
  const amEndMin = timeToMinutes(h.amEnd);
  const pmStartMin = timeToMinutes(h.pmStart);
  const pmEndMin = timeToMinutes(h.pmEnd);

  let order = 1;

  // 午前スロット（例: 09:00〜13:00 → 12コマ）
  let amCount = 1;
  for (let t = amStartMin; t + 20 <= amEndMin; t += 20) {
    const startStr = minutesToTime(t);
    const endStr = minutesToTime(t + 20);
    slots.push({
      id: `am_${amCount}`,
      label: `${startStr} - ${endStr}`,
      start: startStr,
      end: endStr,
      startTime: startStr,
      endTime: endStr,
      period: 'am',
      order
    });
    amCount += 1;
    order += 1;
  }

  // 午後スロット（例: 14:00〜18:00 → 12コマ）
  let pmCount = 1;
  for (let t = pmStartMin; t + 20 <= pmEndMin; t += 20) {
    const startStr = minutesToTime(t);
    const endStr = minutesToTime(t + 20);
    slots.push({
      id: `pm_${pmCount}`,
      label: `${startStr} - ${endStr}`,
      start: startStr,
      end: endStr,
      startTime: startStr,
      endTime: endStr,
      period: 'pm',
      order
    });
    pmCount += 1;
    order += 1;
  }

  return slots;
}

/**
 * 外来予約カレンダー用の開始時刻文字列配列（TIME_SLOTS の start と完全一致）
 * @param {Partial<FacilityHours>} [hours]
 * @returns {string[]}
 */
export function generateAppointmentTimeStrings(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).map((slot) => slot.start);
}

/**
 * 午前コマ数（半日有休・公休の既定コマ数に使用）
 * @param {Partial<FacilityHours>} [hours]
 * @returns {number}
 */
export function getAmSlotCount(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).filter((s) => s.period === 'am').length;
}

/**
 * 午後コマ数
 * @param {Partial<FacilityHours>} [hours]
 * @returns {number}
 */
export function getPmSlotCount(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).filter((s) => s.period === 'pm').length;
}

/**
 * 1日の総コマ数（デフォルト24＝セラピスト日上限・終日休暇と調和）
 * @param {Partial<FacilityHours>} [hours]
 * @returns {number}
 */
export function getTotalSlotCount(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).length;
}

/**
 * スロットが午後帯か（業務日誌の午前／午後休暇判定用）
 * @param {{ period?: string }|null|undefined} slot
 * @returns {boolean}
 */
export function isAfternoonSlot(slot) {
  const p = String(slot?.period || '').toLowerCase();
  return p === 'pm';
}
