// js/config/appointmentSlots.js
// 外来予約カレンダーの時間軸（本日時間割と同一の施設設定から生成）
// ★単一情報源: js/core/timeSlotGenerator.js → rules.js 経由で配給

import { APPOINTMENT_TIME_STRINGS } from './rules.js';

/**
 * 週間タイムテーブル／A4週間印刷が参照する開始時刻文字列配列
 * 例（デフォルト）: '09:00','09:20',…,'12:40','14:00',…,'17:40'
 *
 * 旧手書き配列（08:40 / 13:40 混在）は廃止し、施設設定由来のスロット開始時刻に統一。
 */
export const TIME_SLOTS = APPOINTMENT_TIME_STRINGS;
