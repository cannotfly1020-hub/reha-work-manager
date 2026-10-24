// js/views/appointment/calendarState.js
// 外来予約カレンダーの表示日・表示モード・ドラッグ中データ

export const calendarState = {
  baseDate: new Date(),
  viewMode: 'WEEK',
  dragPayload: null,
  paletteCategory: 'OUTPATIENT',
  paletteSort: 'KANA',
  /** true: 週間表で予約ゼロ行を詰めて行高・文字を拡大 / false: 全時間枠を表示（空き枠クリック用） */
  compactEmptyRows: true,
};
