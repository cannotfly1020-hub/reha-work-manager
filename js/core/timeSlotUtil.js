// js/core/timeSlotUtil.js
// 施設20分スロットへの時刻吸着（端数時刻の画面脱落防止・医療安全ガード）

import { APPOINTMENT_TIME_STRINGS } from '../config/rules.js';
import { TIME_SLOTS as SCHEDULE_TIME_SLOTS } from '../config/rules.js';

/**
 * HH:mm / HH:mm:ss を正規化して HH:mm を返す
 * @param {string} timeStr
 * @returns {string}
 */
export function normalizeTimeHHmm(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10) || 0));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * HH:mm を通算分へ
 * @param {string} timeStr
 * @returns {number|null}
 */
export function timeStringToMinutes(timeStr) {
  const norm = normalizeTimeHHmm(timeStr);
  if (!norm) return null;
  const [h, m] = norm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 分単位の時刻文字列を正本スロットへ吸着する。
 * - 完全一致はそのまま
 * - 端数（例: 10:30）は最寄り20分スロットへ（差が同じなら後ろのスロット）
 * - 画面から絶対に脱落させないための救済ガード
 *
 * @param {string} timeStr
 * @param {string[]} [allowedSlots=APPOINTMENT_TIME_STRINGS]
 * @returns {string}
 */
export function snapToNearestAppointmentSlot(timeStr, allowedSlots = APPOINTMENT_TIME_STRINGS) {
  const slots = (Array.isArray(allowedSlots) && allowedSlots.length > 0)
    ? allowedSlots
    : ['09:00'];
  const normalized = normalizeTimeHHmm(timeStr);
  if (!normalized) return slots[0];
  if (slots.includes(normalized)) return normalized;

  const targetMinutes = timeStringToMinutes(normalized);
  if (targetMinutes === null) return slots[0];

  let closestSlot = slots[0];
  let minDiff = Infinity;
  let closestMinutes = timeStringToMinutes(slots[0]) ?? 0;

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const slotMinutes = timeStringToMinutes(slot);
    if (slotMinutes === null) continue;
    const diff = Math.abs(targetMinutes - slotMinutes);
    // 同差なら後ろ（遅い）スロットを採用（09:10 → 09:20）
    if (diff < minDiff || (diff === minDiff && slotMinutes > closestMinutes)) {
      minDiff = diff;
      closestSlot = slot;
      closestMinutes = slotMinutes;
    }
  }
  return closestSlot;
}

/**
 * 本日時間割用: 開始時刻を TIME_SLOTS の id へ吸着
 * @param {string} timeStr
 * @returns {string} slot.id
 */
export function snapToNearestScheduleSlotId(timeStr) {
  if (!SCHEDULE_TIME_SLOTS.length) return '';
  const aptStrings = SCHEDULE_TIME_SLOTS.map((s) => s.start || s.label || '').filter(Boolean);
  const snappedStart = snapToNearestAppointmentSlot(timeStr, aptStrings);
  const found = SCHEDULE_TIME_SLOTS.find((s) => s.start === snappedStart || s.id === snappedStart);
  return found ? found.id : (SCHEDULE_TIME_SLOTS[0]?.id || '');
}

/**
 * 表示用: 実時刻と吸着時刻が異なる場合の注記ラベル
 * @param {string} rawTime
 * @param {string} [snappedTime]
 * @returns {string} 例: "実10:30→10:20" / 空文字
 */
export function formatOffSlotHint(rawTime, snappedTime = '') {
  const raw = normalizeTimeHHmm(rawTime);
  const snap = snappedTime || snapToNearestAppointmentSlot(raw);
  if (!raw || !snap || raw === snap) return '';
  return `実${raw}→${snap}`;
}
