// js/core/dateUtils.js
// 画面共通の日付文字列・週範囲

export function formatDateYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getLocalDateStr(date = new Date()) {
  return formatDateYMD(date);
}

/** 月曜日始まりの月〜土（6日） */
export function getWeekDates(baseDate) {
  const d = new Date(baseDate);
  const day = d.getDay();
  // 月曜日を週の始まりとする（日曜日は前週または翌週扱い）
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  const week = [];
  for (let i = 0; i < 6; i++) { // 月〜土 (6日間)
    const target = new Date(monday);
    target.setDate(monday.getDate() + i);
    week.push(target);
  }
  return week;
}
