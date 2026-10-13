// js/core/holidayCalc.js
// 日本の祝日・振替休日・国民の休日オフライン判定（画面から共通化）

/**
 * 日本の祝日・振替休日・国民の休日オフライン高精度判定エンジン
 * @param {Date|string|null|undefined} dateInput
 * @returns {string|null}
 */
export function getJapaneseHolidayName(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;

  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const date = d.getDate();
  const day = d.getDay();

  // 単独祝日の判定
  const checkBaseHoliday = (year, month, dayOfMonth) => {
    const curDate = new Date(year, month - 1, dayOfMonth);
    const dayOfWeek = curDate.getDay();
    const nth = Math.floor((dayOfMonth - 1) / 7) + 1;

    // 天文計算式による春分の日・秋分の日の算出 (1980〜2099年対応)
    const vEq = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    const aEq = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));

    if (month === 1) {
      if (dayOfMonth === 1) return '元日';
      if (dayOfWeek === 1 && nth === 2) return '成人の日';
    } else if (month === 2) {
      if (dayOfMonth === 11) return '建国記念の日';
      if (dayOfMonth === 23 && year >= 2020) return '天皇誕生日';
    } else if (month === 3) {
      if (dayOfMonth === vEq) return '春分の日';
    } else if (month === 4) {
      if (dayOfMonth === 29) return '昭和の日';
    } else if (month === 5) {
      if (dayOfMonth === 3) return '憲法記念日';
      if (dayOfMonth === 4) return 'みどりの日';
      if (dayOfMonth === 5) return 'こどもの日';
    } else if (month === 7) {
      if (dayOfWeek === 1 && nth === 3) return '海の日';
    } else if (month === 8) {
      if (dayOfMonth === 11 && year >= 2016) return '山の日';
    } else if (month === 9) {
      if (dayOfWeek === 1 && nth === 3) return '敬老の日';
      if (dayOfMonth === aEq) return '秋分の日';
    } else if (month === 10) {
      if (dayOfWeek === 1 && nth === 2) return 'スポーツの日';
    } else if (month === 11) {
      if (dayOfMonth === 3) return '文化の日';
      if (dayOfMonth === 23) return '勤労感謝の日';
    }
    return null;
  };

  const baseName = checkBaseHoliday(y, m, date);
  if (baseName) return baseName;

  // 国民の休日判定（祝日と祝日に挟まれた平日）
  if (day !== 0) {
    const prevDate = new Date(y, m - 1, date - 1);
    const nextDate = new Date(y, m - 1, date + 1);
    const prevHoliday = checkBaseHoliday(prevDate.getFullYear(), prevDate.getMonth() + 1, prevDate.getDate());
    const nextHoliday = checkBaseHoliday(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
    if (prevHoliday && nextHoliday) {
      return '国民の休日';
    }
  }

  // 振替休日判定（日曜日に祝日があり、その直後の連続した平日）
  if (day !== 0) {
    for (let back = 1; back <= 6; back++) {
      const checkD = new Date(y, m - 1, date - back);
      const isSunday = checkD.getDay() === 0;
      const hName = checkBaseHoliday(checkD.getFullYear(), checkD.getMonth() + 1, checkD.getDate());
      if (!hName) {
        break;
      }
      if (isSunday) {
        return '振替休日';
      }
    }
  }

  return null;
}
