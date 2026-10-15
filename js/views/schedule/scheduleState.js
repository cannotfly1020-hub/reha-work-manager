// js/views/schedule/scheduleState.js
// 当日時間割画面の表示日と患者パレットの絞り込み

import { getLocalDateStr } from '../../core/dateUtils.js';

export const scheduleState = {
  dateStr: getLocalDateStr(),
  paletteCategory: 'ALL',
  paletteSortKey: 'KANA',
};
