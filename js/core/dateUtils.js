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

/**
 * 対象日を含む週の月曜日（ローカル日付）を返す
 * @param {string|Date} baseDate YYYY-MM-DD または Date
 * @returns {Date}
 */
export function getMondayOfWeek(baseDate) {
  const d = baseDate instanceof Date
    ? new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())
    : (() => {
      const s = String(baseDate || '').trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return new Date();
    })();
  const day = d.getDay(); // 0:日 … 6:土
  const distanceToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + distanceToMonday);
  return monday;
}

/** 月曜日始まりの月〜土（6日）※外来週間表用 */
export function getWeekDates(baseDate) {
  const monday = getMondayOfWeek(baseDate);
  const week = [];
  for (let i = 0; i < 6; i++) { // 月〜土 (6日間)
    const target = new Date(monday);
    target.setDate(monday.getDate() + i);
    week.push(target);
  }
  return week;
}

/**
 * 診療報酬の週単位（月曜〜日曜・7日間）の Date 配列
 * @param {string|Date} baseDate
 * @returns {Date[]}
 */
export function getWeekDatesMonSun(baseDate) {
  const monday = getMondayOfWeek(baseDate);
  const week = [];
  for (let i = 0; i < 7; i += 1) {
    const target = new Date(monday);
    target.setDate(monday.getDate() + i);
    week.push(target);
  }
  return week;
}

/**
 * 月曜〜日曜の YYYY-MM-DD 配列
 * @param {string|Date} baseDate
 * @returns {string[]}
 */
export function getWeekDateKeysMonSun(baseDate) {
  return getWeekDatesMonSun(baseDate).map((d) => formatDateYMD(d));
}
