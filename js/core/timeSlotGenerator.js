// js/core/timeSlotGenerator.js
// 施設診療時間から20分刻みスロットを動的生成する単一情報源（Single Source of Truth）
// デフォルト: 午前 09:00〜13:00（12コマ）／午後 13:00〜18:00（15コマ）＝計27コマ（昼休憩なし・完全連続）
// 画面設定の永続化キー: localStorage 'reha_facility_hours'
// 旧既定（pmStart=14:00）は読込時に 13:00 へ自動マイグレーションし、13:00〜14:00 の3コマを復活させる
// ★施設／外来時間は localStorage 正本 + storageAdapter ミラー（共有 pull の孤立削除耐性）

import { storageGet, storageSet } from './storageAdapter.js';

/**
 * 施設の診療時間設定（スタッフ設定モーダル／定数初期値で同じ形）
 * @typedef {{
 *   amStart: string,
 *   amEnd: string,
 *   pmStart: string,
 *   pmEnd: string,
 *   defaultLunchStart: string,
 *   defaultLunchEnd: string
 * }} FacilityHours
 */

/** localStorage キー（施設リハビリ提供時間＝本日の時間割専用） */
export const FACILITY_HOURS_STORAGE_KEY = 'reha_facility_hours';

/** localStorage キー（外来予約カレンダー専用 提供時間・昼休み） */
export const OUTPATIENT_HOURS_STORAGE_KEY = 'reha_outpatient_calendar_hours';

/**
 * 時間設定 JSON を読む（adapter → localStorage）
 * @param {string} key
 * @returns {string|null}
 */
function readHoursRaw(key) {
  try {
    const fromAdapter = storageGet(key, null);
    if (typeof fromAdapter === 'string' && fromAdapter) return fromAdapter;
  } catch (_) { /* ignore */ }
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * 時間設定 JSON を localStorage 正本 + adapter ミラーへ書く
 * @param {string} key
 * @param {string} json
 * @returns {boolean}
 */
function writeHoursRaw(key, json) {
  let ok = false;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, json);
      ok = true;
    }
  } catch (_) {
    ok = false;
  }
  try {
    storageSet(key, json);
    ok = true;
  } catch (_) { /* adapter 未初期化時は LS のみでも可 */ }
  return ok;
}

/**
 * 旧既定（昼休憩で 13:00〜14:00 が欠落していた構成）
 * マイグレーション判定用。現行 DEFAULT とは pmStart のみ異なる。
 * @type {FacilityHours}
 */
const LEGACY_LUNCH_GAP_FACILITY_HOURS = {
  amStart: '09:00',
  amEnd: '13:00',
  pmStart: '14:00',
  pmEnd: '18:00',
  defaultLunchStart: '12:00',
  defaultLunchEnd: '13:00'
};

/** @type {FacilityHours} */
export const DEFAULT_FACILITY_HOURS = {
  amStart: '09:00',
  amEnd: '13:00',   // 午前終了（12コマ: 09:00〜13:00）
  pmStart: '13:00',  // 午後開始＝午前終了（昼休憩なし・完全連続）
  pmEnd: '18:00',    // 業務終了（15コマ: 13:00〜18:00）→ 合計27コマ
  // 施設標準昼休み時間（スタッフ個別未設定・新規登録の初期値／一括適用の基準）
  defaultLunchStart: '12:00',
  defaultLunchEnd: '13:00'
};

/** 外来予約枠の刻み候補（分） */
export const OUTPATIENT_SLOT_INTERVAL_OPTIONS = Object.freeze([15, 20, 30]);

/**
 * @param {unknown} value
 * @returns {15|20|30}
 */
export function normalizeSlotIntervalMinutes(value) {
  const n = Number(value);
  if (n === 15 || n === 20 || n === 30) return n;
  return 20;
}

/**
 * 外来予約カレンダー専用の既定提供時間（施設時間とは独立）
 * ※ slotIntervalMinutes / closedPeriods は外来専用。本日時間割には使わない
 * @type {FacilityHours & {
 *   slotIntervalMinutes: 15|20|30,
 *   closedPeriods: Record<string, { am: boolean, pm: boolean }>
 * }}
 */
export const DEFAULT_OUTPATIENT_HOURS = {
  amStart: '09:00',
  amEnd: '13:00',
  pmStart: '13:00',
  pmEnd: '18:00',
  defaultLunchStart: '12:00',
  defaultLunchEnd: '13:00',
  slotIntervalMinutes: 20,
  closedPeriods: {
    mon: { am: false, pm: false },
    tue: { am: false, pm: false },
    wed: { am: false, pm: false },
    thu: { am: false, pm: true },
    fri: { am: false, pm: false },
    sat: { am: false, pm: true },
    sun: { am: false, pm: false }
  }
};

/**
 * HH:MM または HH:MM:SS を HH:MM に正規化
 * @param {string} timeStr
 * @returns {string}
 */
export function normalizeTimeString(timeStr) {
  if (!timeStr || !String(timeStr).includes(':')) return '';
  const parts = String(timeStr).trim().split(':');
  const h = Math.min(23, Math.max(0, Number(parts[0]) || 0));
  const m = Math.min(59, Math.max(0, Number(parts[1]) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * HH:MM 文字列を通算分（0〜1440）に変換
 * @param {string} timeStr
 * @returns {number}
 */
export function timeToMinutes(timeStr) {
  const normalized = normalizeTimeString(timeStr);
  if (!normalized) return 0;
  const [h, m] = normalized.split(':').map(Number);
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
 * 施設設定を正規化（欠落キーはデフォルトで補完・時刻を HH:MM 化）
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {FacilityHours}
 */
export function normalizeFacilityHours(hours) {
  const defaultLunchStart = normalizeTimeString(hours?.defaultLunchStart)
    || DEFAULT_FACILITY_HOURS.defaultLunchStart;
  let defaultLunchEnd = normalizeTimeString(hours?.defaultLunchEnd)
    || DEFAULT_FACILITY_HOURS.defaultLunchEnd;
  // 終了≦開始の不正値は施設標準デフォルトへフォールバック
  if (defaultLunchEnd <= defaultLunchStart) {
    defaultLunchEnd = DEFAULT_FACILITY_HOURS.defaultLunchEnd;
    if (defaultLunchEnd <= defaultLunchStart) {
      defaultLunchEnd = '13:00';
    }
  }
  return {
    amStart: normalizeTimeString(hours?.amStart) || DEFAULT_FACILITY_HOURS.amStart,
    amEnd: normalizeTimeString(hours?.amEnd) || DEFAULT_FACILITY_HOURS.amEnd,
    pmStart: normalizeTimeString(hours?.pmStart) || DEFAULT_FACILITY_HOURS.pmStart,
    pmEnd: normalizeTimeString(hours?.pmEnd) || DEFAULT_FACILITY_HOURS.pmEnd,
    defaultLunchStart,
    defaultLunchEnd
  };
}

/**
 * 施設標準昼休み時間を取得
 * @returns {{ start: string, end: string }}
 */
export function getFacilityDefaultLunchBreak() {
  const h = getSavedFacilityHours();
  return {
    start: h.defaultLunchStart || DEFAULT_FACILITY_HOURS.defaultLunchStart,
    end: h.defaultLunchEnd || DEFAULT_FACILITY_HOURS.defaultLunchEnd
  };
}

/** 施設時間の旧昼休みギャップを一度だけ連続枠へ寄せた印 */
const FACILITY_HOURS_LEGACY_GAP_MIGRATED_FLAG = 'reha_facility_hours_legacy_gap_migrated_v1';

/**
 * 旧「昼休憩で 13:00〜14:00 欠落」だった施設既定のみ、現行の連続枠へ一度変換する。
 * ★意図的な amEnd=13:00 / pmStart=14:00（昼休みあり）は、移行済みフラグ後は絶対に巻き戻さない。
 * ★外来専用キー（OUTPATIENT_HOURS_STORAGE_KEY）では呼び出さないこと。
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {{ hours: FacilityHours, migrated: boolean }}
 */
export function migrateFacilityHoursIfNeeded(hours) {
  const h = normalizeFacilityHours(hours);
  let alreadyMigrated = false;
  try {
    if (typeof localStorage !== 'undefined') {
      alreadyMigrated = localStorage.getItem(FACILITY_HOURS_LEGACY_GAP_MIGRATED_FLAG) === '1';
    }
  } catch (_) {
    alreadyMigrated = false;
  }

  // 既に一度移行済み → ユーザーが意図的に昼休みギャップを戻しても消さない
  if (alreadyMigrated) {
    return { hours: h, migrated: false };
  }

  const isExactLegacyDefault =
    h.amStart === LEGACY_LUNCH_GAP_FACILITY_HOURS.amStart &&
    h.amEnd === LEGACY_LUNCH_GAP_FACILITY_HOURS.amEnd &&
    h.pmStart === LEGACY_LUNCH_GAP_FACILITY_HOURS.pmStart &&
    h.pmEnd === LEGACY_LUNCH_GAP_FACILITY_HOURS.pmEnd;

  if (isExactLegacyDefault) {
    return {
      hours: {
        ...h,
        pmStart: '13:00'
      },
      migrated: true
    };
  }
  return { hours: h, migrated: false };
}

function markFacilityLegacyGapMigrated() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FACILITY_HOURS_LEGACY_GAP_MIGRATED_FLAG, '1');
    }
  } catch (_) { /* ignore */ }
}

/**
 * 時刻逆転・コマ不足を検証
 * 条件: 午前開始 < 午前終了 <= 午後開始 < 業務終了、かつ午前・午後それぞれ最低1コマ（20分以上）
 * ※ amEnd === pmStart（例: 13:00）は昼休憩なしの完全連続として正常許可する
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {{ ok: boolean, message: string, hours: FacilityHours }}
 */
export function validateFacilityHours(hours) {
  const h = normalizeFacilityHours(hours);
  const amStart = timeToMinutes(h.amStart);
  const amEnd = timeToMinutes(h.amEnd);
  const pmStart = timeToMinutes(h.pmStart);
  const pmEnd = timeToMinutes(h.pmEnd);

  if (!(amStart < amEnd)) {
    return { ok: false, message: '午前開始は午前終了より前である必要があります', hours: h };
  }
  if (!(amEnd <= pmStart)) {
    return { ok: false, message: '午前終了は午後開始以前である必要があります（昼休憩の逆転を禁止）', hours: h };
  }
  if (!(pmStart < pmEnd)) {
    return { ok: false, message: '午後開始は業務終了より前である必要があります', hours: h };
  }
  if (amEnd - amStart < 20) {
    return { ok: false, message: '午前帯は最低20分（1コマ）以上必要です', hours: h };
  }
  if (pmEnd - pmStart < 20) {
    return { ok: false, message: '午後帯は最低20分（1コマ）以上必要です', hours: h };
  }

  return { ok: true, message: '', hours: h };
}

/**
 * バッジ表示用サマリー文字列を生成
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {string}
 */
export function formatFacilityHoursSummary(hours) {
  const check = validateFacilityHours(hours);
  const h = check.hours;
  if (!check.ok) {
    return `⚠ ${check.message}`;
  }
  const am = getAmSlotCount(h);
  const pm = getPmSlotCount(h);
  const total = am + pm;
  const breakMin = timeToMinutes(h.pmStart) - timeToMinutes(h.amEnd);
  const breakLabel = breakMin > 0 ? `昼休憩 ${breakMin}分` : '昼休憩なし（連続）';
  return `午前 ${am}コマ ／ 午後 ${pm}コマ ＝ 計 ${total}コマ（${breakLabel}）`;
}

/**
 * 保存済み施設時間を取得（未保存・破損時はデフォルト）
 * 旧設定（pmStart=14:00 かつ amEnd=13:00）は自動で pmStart=13:00 にマイグレーションし永続化する
 * @returns {FacilityHours}
 */
export function getSavedFacilityHours() {
  try {
    const raw = readHoursRaw(FACILITY_HOURS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FACILITY_HOURS };

    const parsed = JSON.parse(raw);
    const { hours: migratedHours, migrated } = migrateFacilityHoursIfNeeded(parsed);
    const check = validateFacilityHours(migratedHours);
    if (!check.ok) return { ...DEFAULT_FACILITY_HOURS };

    if (migrated) {
      try {
        writeHoursRaw(FACILITY_HOURS_STORAGE_KEY, JSON.stringify(check.hours));
        markFacilityLegacyGapMigrated();
      } catch (_) {
        // 読込側マイグレーション結果は返しつつ、書き込み失敗は握りつぶす
      }
    }
    return check.hours;
  } catch (_) {
    return { ...DEFAULT_FACILITY_HOURS };
  }
}

/**
 * 施設時間を検証して localStorage に保存
 * @param {Partial<FacilityHours>} hours
 * @returns {{ success: boolean, message: string, hours: FacilityHours }}
 */
export function saveFacilityHours(hours) {
  const { hours: migratedHours } = migrateFacilityHoursIfNeeded(hours);
  const check = validateFacilityHours(migratedHours);
  if (!check.ok) {
    return { success: false, message: check.message, hours: check.hours };
  }
  try {
    const json = JSON.stringify(check.hours);
    const ok = writeHoursRaw(FACILITY_HOURS_STORAGE_KEY, json);
    // 保存成功時点で移行フラグを立て、以降の強制巻き戻しを止める（意図的な昼休みを許容）
    markFacilityLegacyGapMigrated();
    if (!ok) {
      return { success: false, message: '施設時間の保存に失敗しました（ストレージ書き込み不可）', hours: check.hours };
    }
    return { success: true, message: '施設リハビリ提供時間を保存しました', hours: check.hours };
  } catch (_) {
    return { success: false, message: '施設時間の保存に失敗しました（ストレージ書き込み不可）', hours: check.hours };
  }
}

/**
 * 外来専用時間を正規化（欠落は DEFAULT_OUTPATIENT_HOURS で補完）
 * @param {Partial<typeof DEFAULT_OUTPATIENT_HOURS>|null|undefined} hours
 * @returns {typeof DEFAULT_OUTPATIENT_HOURS}
 */
export function normalizeOutpatientHours(hours) {
  // ★外来は連続枠（昼休みゼロ＝lunchStart===lunchEnd）を許容する。
  //   normalizeFacilityHours の「終了≦開始ならデフォルトへ戻す」を通すと巻き戻るため独自正規化。
  const defaultLunchStart = normalizeTimeString(hours?.defaultLunchStart)
    || DEFAULT_OUTPATIENT_HOURS.defaultLunchStart;
  let defaultLunchEnd = normalizeTimeString(hours?.defaultLunchEnd)
    || DEFAULT_OUTPATIENT_HOURS.defaultLunchEnd;
  if (defaultLunchEnd < defaultLunchStart) {
    defaultLunchEnd = defaultLunchStart;
  }

  // closedPeriods: 未保存環境でも木PM・土PM デフォルトを適用
  let closedPeriods = DEFAULT_OUTPATIENT_HOURS.closedPeriods;
  try {
    // 遅延 import を避け、同一モジュール内で浅い正規化
    const raw = hours?.closedPeriods;
    if (raw && typeof raw === 'object') {
      const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const next = {};
      keys.forEach((k) => {
        const def = DEFAULT_OUTPATIENT_HOURS.closedPeriods[k] || { am: false, pm: false };
        const row = raw[k];
        if (!row || typeof row !== 'object') {
          next[k] = { ...def };
        } else {
          next[k] = { am: Boolean(row.am), pm: Boolean(row.pm) };
        }
      });
      closedPeriods = next;
    } else {
      closedPeriods = {
        mon: { ...DEFAULT_OUTPATIENT_HOURS.closedPeriods.mon },
        tue: { ...DEFAULT_OUTPATIENT_HOURS.closedPeriods.tue },
        wed: { ...DEFAULT_OUTPATIENT_HOURS.closedPeriods.wed },
        thu: { ...DEFAULT_OUTPATIENT_HOURS.closedPeriods.thu },
        fri: { ...DEFAULT_OUTPATIENT_HOURS.closedPeriods.fri },
        sat: { ...DEFAULT_OUTPATIENT_HOURS.closedPeriods.sat },
        sun: { ...DEFAULT_OUTPATIENT_HOURS.closedPeriods.sun }
      };
    }
  } catch (_) {
    closedPeriods = { ...DEFAULT_OUTPATIENT_HOURS.closedPeriods };
  }

  return {
    amStart: normalizeTimeString(hours?.amStart) || DEFAULT_OUTPATIENT_HOURS.amStart,
    amEnd: normalizeTimeString(hours?.amEnd) || DEFAULT_OUTPATIENT_HOURS.amEnd,
    pmStart: normalizeTimeString(hours?.pmStart) || DEFAULT_OUTPATIENT_HOURS.pmStart,
    pmEnd: normalizeTimeString(hours?.pmEnd) || DEFAULT_OUTPATIENT_HOURS.pmEnd,
    defaultLunchStart,
    defaultLunchEnd,
    slotIntervalMinutes: normalizeSlotIntervalMinutes(
      hours?.slotIntervalMinutes ?? DEFAULT_OUTPATIENT_HOURS.slotIntervalMinutes
    ),
    closedPeriods
  };
}

/**
 * 外来専用時間の検証（刻み幅に応じた最低帯幅）
 * @param {Partial<typeof DEFAULT_OUTPATIENT_HOURS>|null|undefined} hours
 * @returns {{ ok: boolean, message: string, hours: typeof DEFAULT_OUTPATIENT_HOURS }}
 */
export function validateOutpatientHours(hours) {
  const h = normalizeOutpatientHours(hours);
  const amStart = timeToMinutes(h.amStart);
  const amEnd = timeToMinutes(h.amEnd);
  const pmStart = timeToMinutes(h.pmStart);
  const pmEnd = timeToMinutes(h.pmEnd);
  const interval = h.slotIntervalMinutes;

  if (!(amStart < amEnd)) {
    return { ok: false, message: '午前開始は午前終了より前である必要があります', hours: h };
  }
  if (!(amEnd <= pmStart)) {
    return { ok: false, message: '午前終了は午後開始以前である必要があります（昼休憩の逆転を禁止）', hours: h };
  }
  if (!(pmStart < pmEnd)) {
    return { ok: false, message: '午後開始は業務終了より前である必要があります', hours: h };
  }
  if (amEnd - amStart < interval) {
    return { ok: false, message: `午前帯は最低${interval}分（1コマ）以上必要です`, hours: h };
  }
  if (pmEnd - pmStart < interval) {
    return { ok: false, message: `午後帯は最低${interval}分（1コマ）以上必要です`, hours: h };
  }
  return { ok: true, message: '', hours: h };
}

/**
 * 保存済みの外来予約カレンダー専用提供時間を取得
 * ★ migrateFacilityHoursIfNeeded は一切適用しない（意図的な昼休み＝amEnd < pmStart を保持）
 * 未保存時は施設時間の「生値」または既定を1回だけシードし、以後は施設変更の影響を受けない
 * @returns {FacilityHours}
 */
export function getSavedOutpatientHours() {
  try {
    const raw = readHoursRaw(OUTPATIENT_HOURS_STORAGE_KEY);
    if (!raw) {
      // 初回シード: 施設キーの生JSONを優先（施設側マイグレーションの巻き戻しを持ち込まない）
      let seedSource = { ...DEFAULT_OUTPATIENT_HOURS };
      try {
        const facilityRaw = readHoursRaw(FACILITY_HOURS_STORAGE_KEY);
        if (facilityRaw) {
          seedSource = normalizeOutpatientHours(JSON.parse(facilityRaw));
        }
      } catch (_) { /* keep default */ }
      const check = validateOutpatientHours(seedSource);
      const hours = check.ok ? check.hours : { ...DEFAULT_OUTPATIENT_HOURS };
      try {
        writeHoursRaw(OUTPATIENT_HOURS_STORAGE_KEY, JSON.stringify(hours));
      } catch (_) { /* ignore */ }
      return hours;
    }

    const parsed = JSON.parse(raw);
    // ★強制マイグレーションなし。保存された am/pm / 昼休みをそのまま検証・返却
    const check = validateOutpatientHours(parsed);
    if (!check.ok) return { ...DEFAULT_OUTPATIENT_HOURS };
    return check.hours;
  } catch (_) {
    return { ...DEFAULT_OUTPATIENT_HOURS };
  }
}

/**
 * 外来予約カレンダー専用提供時間を検証して保存
 * ★ migrateFacilityHoursIfNeeded は呼ばない（昼休みギャップを消さない）
 * @param {Partial<FacilityHours>} hours
 * @returns {{ success: boolean, message: string, hours: FacilityHours }}
 */
export function saveOutpatientHours(hours) {
  const check = validateOutpatientHours(hours);
  if (!check.ok) {
    return { success: false, message: check.message, hours: check.hours };
  }
  try {
    const json = JSON.stringify(check.hours);
    const ok = writeHoursRaw(OUTPATIENT_HOURS_STORAGE_KEY, json);
    if (!ok) {
      return {
        success: false,
        message: '外来専用時間の保存に失敗しました（ストレージ書き込み不可）',
        hours: check.hours
      };
    }
    return { success: true, message: '外来予約カレンダー専用の提供時間を保存しました', hours: check.hours };
  } catch (_) {
    return { success: false, message: '外来専用時間の保存に失敗しました（ストレージ書き込み不可）', hours: check.hours };
  }
}

/**
 * 外来専用時間のバッジ用サマリー
 * @param {Partial<typeof DEFAULT_OUTPATIENT_HOURS>|null|undefined} hours
 * @returns {string}
 */
export function formatOutpatientHoursSummary(hours) {
  const check = validateOutpatientHours(hours);
  const h = check.hours;
  if (!check.ok) {
    return `⚠ ${check.message}`;
  }
  const am = getAmSlotCount(h);
  const pm = getPmSlotCount(h);
  const total = am + pm;
  const breakMin = timeToMinutes(h.pmStart) - timeToMinutes(h.amEnd);
  const breakLabel = breakMin > 0 ? `昼休憩 ${breakMin}分` : '昼休憩なし（連続）';
  return `${h.slotIntervalMinutes}分刻み ／ 午前 ${am}コマ ／ 午後 ${pm}コマ ＝ 計 ${total}コマ（${breakLabel}）`;
}

/**
 * 診療時間から刻み幅つき TIME_SLOTS 配列を動的生成する。
 * - 本日時間割: intervalMinutes 未指定／hours に slotIntervalMinutes 無し → **常に20分**
 * - 外来カレンダー: hours.slotIntervalMinutes（15/20/30）を使用
 *
 * @param {Partial<FacilityHours>|Partial<typeof DEFAULT_OUTPATIENT_HOURS>} [hours]
 * @param {number|null} [intervalMinutes] 明示指定時はそちら優先（施設側は渡さない）
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
export function generateTimeSlots(hours = DEFAULT_FACILITY_HOURS, intervalMinutes = null) {
  // 外来オブジェクト（slotIntervalMinutes あり）か施設かで正規化を分ける
  const looksOutpatient = hours && Object.prototype.hasOwnProperty.call(hours, 'slotIntervalMinutes');
  const h = looksOutpatient
    ? normalizeOutpatientHours(hours)
    : normalizeFacilityHours(hours);
  const step = intervalMinutes != null
    ? normalizeSlotIntervalMinutes(intervalMinutes)
    : (looksOutpatient
      ? normalizeSlotIntervalMinutes(h.slotIntervalMinutes)
      : 20);

  const slots = [];
  const amStartMin = timeToMinutes(h.amStart);
  const amEndMin = timeToMinutes(h.amEnd);
  const pmStartMin = timeToMinutes(h.pmStart);
  const pmEndMin = timeToMinutes(h.pmEnd);

  let order = 1;
  let amCount = 1;
  for (let t = amStartMin; t + step <= amEndMin; t += step) {
    const startStr = minutesToTime(t);
    const endStr = minutesToTime(t + step);
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

  let pmCount = 1;
  for (let t = pmStartMin; t + step <= pmEndMin; t += step) {
    const startStr = minutesToTime(t);
    const endStr = minutesToTime(t + step);
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
 * 外来予約カレンダー用の開始時刻文字列配列（刻みは hours.slotIntervalMinutes）
 * @param {Partial<typeof DEFAULT_OUTPATIENT_HOURS>|Partial<FacilityHours>} [hours]
 * @returns {string[]}
 */
export function generateAppointmentTimeStrings(hours = DEFAULT_OUTPATIENT_HOURS) {
  const h = normalizeOutpatientHours({
    ...DEFAULT_OUTPATIENT_HOURS,
    ...(hours || {})
  });
  return generateTimeSlots(h).map((slot) => slot.start);
}

/**
 * 午前コマ数（施設時間サマリー・表示用。半日有休/公休の固定12コマとは独立）
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
 * 1日の総コマ数（デフォルト27＝セラピスト日上限・終日休暇と調和）
 * @param {Partial<FacilityHours>} [hours]
 * @returns {number}
 */
export function getTotalSlotCount(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).length;
}

/**
 * スロットが午後帯か（業務日誌の午前／午後休暇判定用）
 * period === 'pm'（既定では 13:00 以降のブロック）を午後出勤欄へ反映する
 * @param {{ period?: string }|null|undefined} slot
 * @returns {boolean}
 */
export function isAfternoonSlot(slot) {
  const p = String(slot?.period || '').toLowerCase();
  return p === 'pm';
}
