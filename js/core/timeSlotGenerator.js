// js/core/timeSlotGenerator.js
// 施設診療時間から20分刻みスロットを動的生成する単一情報源（Single Source of Truth）
// デフォルト: 午前 09:00〜13:00（12コマ）／午後 13:00〜18:00（15コマ）＝計27コマ（昼休憩なし・完全連続）
// 画面設定の永続化キー: localStorage 'reha_facility_hours'
// 旧既定（pmStart=14:00）は読込時に 13:00 へ自動マイグレーションし、13:00〜14:00 の3コマを復活させる

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

/**
 * 外来予約カレンダー専用の既定提供時間（施設時間とは独立）
 * @type {FacilityHours}
 */
export const DEFAULT_OUTPATIENT_HOURS = {
  amStart: '09:00',
  amEnd: '13:00',
  pmStart: '13:00',
  pmEnd: '18:00',
  defaultLunchStart: '12:00',
  defaultLunchEnd: '13:00'
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
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_FACILITY_HOURS };
    }
    const raw = localStorage.getItem(FACILITY_HOURS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FACILITY_HOURS };

    const parsed = JSON.parse(raw);
    const { hours: migratedHours, migrated } = migrateFacilityHoursIfNeeded(parsed);
    const check = validateFacilityHours(migratedHours);
    if (!check.ok) return { ...DEFAULT_FACILITY_HOURS };

    if (migrated) {
      try {
        localStorage.setItem(FACILITY_HOURS_STORAGE_KEY, JSON.stringify(check.hours));
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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FACILITY_HOURS_STORAGE_KEY, JSON.stringify(check.hours));
      // 保存成功時点で移行フラグを立て、以降の強制巻き戻しを止める（意図的な昼休みを許容）
      markFacilityLegacyGapMigrated();
    }
    return { success: true, message: '施設リハビリ提供時間を保存しました', hours: check.hours };
  } catch (_) {
    return { success: false, message: '施設時間の保存に失敗しました（ストレージ書き込み不可）', hours: check.hours };
  }
}

/**
 * 外来専用時間を正規化（欠落は DEFAULT_OUTPATIENT_HOURS で補完）
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {FacilityHours}
 */
export function normalizeOutpatientHours(hours) {
  const base = normalizeFacilityHours({
    ...DEFAULT_OUTPATIENT_HOURS,
    ...(hours || {})
  });
  return {
    amStart: normalizeTimeString(hours?.amStart) || DEFAULT_OUTPATIENT_HOURS.amStart,
    amEnd: normalizeTimeString(hours?.amEnd) || DEFAULT_OUTPATIENT_HOURS.amEnd,
    pmStart: normalizeTimeString(hours?.pmStart) || DEFAULT_OUTPATIENT_HOURS.pmStart,
    pmEnd: normalizeTimeString(hours?.pmEnd) || DEFAULT_OUTPATIENT_HOURS.pmEnd,
    defaultLunchStart: base.defaultLunchStart || DEFAULT_OUTPATIENT_HOURS.defaultLunchStart,
    defaultLunchEnd: base.defaultLunchEnd || DEFAULT_OUTPATIENT_HOURS.defaultLunchEnd
  };
}

/**
 * 外来専用時間の検証（施設時間と同じルール）
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {{ ok: boolean, message: string, hours: FacilityHours }}
 */
export function validateOutpatientHours(hours) {
  const normalized = normalizeOutpatientHours(hours);
  return validateFacilityHours(normalized);
}

/**
 * 保存済みの外来予約カレンダー専用提供時間を取得
 * ★ migrateFacilityHoursIfNeeded は一切適用しない（意図的な昼休み＝amEnd < pmStart を保持）
 * 未保存時は施設時間の「生値」または既定を1回だけシードし、以後は施設変更の影響を受けない
 * @returns {FacilityHours}
 */
export function getSavedOutpatientHours() {
  try {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_OUTPATIENT_HOURS };
    }
    const raw = localStorage.getItem(OUTPATIENT_HOURS_STORAGE_KEY);
    if (!raw) {
      // 初回シード: 施設キーの生JSONを優先（施設側マイグレーションの巻き戻しを持ち込まない）
      let seedSource = { ...DEFAULT_OUTPATIENT_HOURS };
      try {
        const facilityRaw = localStorage.getItem(FACILITY_HOURS_STORAGE_KEY);
        if (facilityRaw) {
          seedSource = normalizeOutpatientHours(JSON.parse(facilityRaw));
        }
      } catch (_) { /* keep default */ }
      const check = validateOutpatientHours(seedSource);
      const hours = check.ok ? check.hours : { ...DEFAULT_OUTPATIENT_HOURS };
      try {
        localStorage.setItem(OUTPATIENT_HOURS_STORAGE_KEY, JSON.stringify(hours));
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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OUTPATIENT_HOURS_STORAGE_KEY, JSON.stringify(check.hours));
    }
    return { success: true, message: '外来予約カレンダー専用の提供時間を保存しました', hours: check.hours };
  } catch (_) {
    return { success: false, message: '外来専用時間の保存に失敗しました（ストレージ書き込み不可）', hours: check.hours };
  }
}

/**
 * 外来専用時間のバッジ用サマリー
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {string}
 */
export function formatOutpatientHoursSummary(hours) {
  return formatFacilityHoursSummary(normalizeOutpatientHours(hours));
}

/**
 * 施設設定に基づいて20分刻みの TIME_SLOTS 配列を動的生成する。
 * 既存画面互換のため period は 'am'|'pm'、label は 'HH:MM - HH:MM'、start/end を必ず付与する。
 * 既定では am_1(09:00)〜am_12(12:40)、pm_1(13:00)〜pm_15(17:40) の27コマ。
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

  // 午前スロット（例: 09:00〜13:00 → 12コマ: am_1…am_12、最終枠 12:40-13:00）
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

  // 午後スロット（例: 13:00〜18:00 → 15コマ: pm_1…pm_15、先頭3枠が 13:00/13:20/13:40）
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
 * 既定では '13:00','13:20','13:40' を含む
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
