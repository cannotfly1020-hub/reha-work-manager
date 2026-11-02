// js/config/appointmentSlots.js
// 外来予約カレンダーの時間軸（外来専用提供時間設定から生成）
// ★本日の時間割（rules.TIME_SLOTS / FACILITY_HOURS）とは独立
// ★単一情報源: timeSlotGenerator → rules.reloadOutpatientTimeSlots → APPOINTMENT_TIME_STRINGS

import { APPOINTMENT_TIME_STRINGS } from './rules.js';

/**
 * 週間タイムテーブル／A4週間印刷が参照する開始時刻文字列配列
 * 例: '09:00','09:20',…（OUTPATIENT_HOURS 由来）
 *
 * 施設リハビリ提供時間（本日時間割）を変更しても、この配列は外来専用設定が変わるまで不変。
 */
export const TIME_SLOTS = APPOINTMENT_TIME_STRINGS;
