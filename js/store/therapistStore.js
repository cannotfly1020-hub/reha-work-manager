// js/store/therapistStore.js
// セラピストマスター管理・LocalStorage永続化・ステータス管理（稼働中/休職/退職）・昼休み時間帯・新規追加・増員対応

import { normalizeString } from '../core/dataNormalizer.js';
import { storageGet } from '../core/storageAdapter.js';
import { writeStorageItem } from './storageWrite.js';
import {
  getSavedFacilityHours,
  saveFacilityHours,
  getFacilityDefaultLunchBreak,
  normalizeFacilityHours
} from '../core/timeSlotGenerator.js';

const STORAGE_KEY = 'reha_therapists_master';

/**
 * セラピストのステータス定数定義（日本語管理対応）
 */
export const THERAPIST_STATUS = {
  ACTIVE: '稼働中',
  LEAVE: '休職',
  RETIRED: '退職'
};

/**
 * 昼休み時間帯のデフォルト（交代制未設定時のフォールバック）
 */
export const DEFAULT_LUNCH_BREAK = Object.freeze({
  start: '12:00',
  end: '13:00'
});

/**
 * スタッフ設定UI用・20分刻みの昼休み候補時刻
 */
export const LUNCH_BREAK_TIME_OPTIONS = Object.freeze([
  '11:00', '11:20', '11:40',
  '12:00', '12:20', '12:40',
  '13:00', '13:20', '13:40',
  '14:00', '14:20', '14:40',
  '15:00'
]);

/**
 * 新規追加時のカラーパレット候補
 */
const DEFAULT_COLORS = ['#0284c7', '#0d9488', '#7c3aed', '#ea580c', '#059669', '#d97706', '#dc2626', '#4f46e5'];

/**
 * 初期デフォルトセラピスト一覧
 */
const DEFAULT_THERAPISTS = [
  {
    id: 'A', name: 'PT A', color: '#0284c7', status: THERAPIST_STATUS.ACTIVE,
    lunchStart: DEFAULT_LUNCH_BREAK.start, lunchEnd: DEFAULT_LUNCH_BREAK.end
  },
  {
    id: 'B', name: 'PT B', color: '#0d9488', status: THERAPIST_STATUS.ACTIVE,
    lunchStart: DEFAULT_LUNCH_BREAK.start, lunchEnd: DEFAULT_LUNCH_BREAK.end
  },
  {
    id: 'C', name: 'PT C', color: '#7c3aed', status: THERAPIST_STATUS.ACTIVE,
    lunchStart: DEFAULT_LUNCH_BREAK.start, lunchEnd: DEFAULT_LUNCH_BREAK.end
  }
];

/**
 * HH:MM 形式に正規化（不正は空文字）
 * @param {string} value
 * @returns {string}
 */
function normalizeClockHm(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * 施設標準昼休み（未保存時は定数デフォルト）
 * @returns {{ start: string, end: string }}
 */
function resolveFacilityLunchFallback() {
  try {
    const facility = getFacilityDefaultLunchBreak();
    const start = normalizeClockHm(facility.start) || DEFAULT_LUNCH_BREAK.start;
    const end = normalizeClockHm(facility.end) || DEFAULT_LUNCH_BREAK.end;
    if (end > start) return { start, end };
  } catch (_) { /* ignore */ }
  return { start: DEFAULT_LUNCH_BREAK.start, end: DEFAULT_LUNCH_BREAK.end };
}

/**
 * セラピストの昼休み時間帯を安全に解決
 * （個別未設定・不正時は施設標準 → 定数デフォルト）
 * @param {object|null|undefined} therapistOrPartial
 * @returns {{ start: string, end: string }}
 */
export function resolveTherapistLunchBreak(therapistOrPartial) {
  const facilityFallback = resolveFacilityLunchFallback();
  const hasExplicitStart = Boolean(
    therapistOrPartial?.lunchStart || therapistOrPartial?.breakStartTime
  );
  const hasExplicitEnd = Boolean(
    therapistOrPartial?.lunchEnd || therapistOrPartial?.breakEndTime
  );

  const start = normalizeClockHm(
    hasExplicitStart
      ? (therapistOrPartial?.lunchStart || therapistOrPartial?.breakStartTime)
      : facilityFallback.start
  ) || facilityFallback.start;
  const end = normalizeClockHm(
    hasExplicitEnd
      ? (therapistOrPartial?.lunchEnd || therapistOrPartial?.breakEndTime)
      : facilityFallback.end
  ) || facilityFallback.end;

  // 終了が開始以下（同じ・逆転）の場合は施設標準へフォールバック
  if (end <= start) {
    return { ...facilityFallback };
  }
  return { start, end };
}

/**
 * 施設標準昼休みを全スタッフへ一括適用
 * @param {string} lunchStart
 * @param {string} lunchEnd
 * @param {{ overwriteCustom?: boolean }} [options]
 * @returns {{ success: boolean, updated: number, skipped: number, message: string, lunch: { start: string, end: string } }}
 */
export function applyFacilityLunchToAllTherapists(lunchStart, lunchEnd, options = {}) {
  const overwriteCustom = Boolean(options?.overwriteCustom);
  const prevFacility = getSavedFacilityHours();
  const prevDefault = resolveTherapistLunchBreak({
    lunchStart: prevFacility.defaultLunchStart,
    lunchEnd: prevFacility.defaultLunchEnd
  });
  const newLunch = resolveTherapistLunchBreak({ lunchStart, lunchEnd });

  const hoursToSave = normalizeFacilityHours({
    ...prevFacility,
    defaultLunchStart: newLunch.start,
    defaultLunchEnd: newLunch.end
  });
  const savedHours = saveFacilityHours(hoursToSave);
  if (!savedHours.success) {
    return {
      success: false,
      updated: 0,
      skipped: 0,
      message: savedHours.message || '施設標準昼休みの保存に失敗しました',
      lunch: newLunch
    };
  }

  const list = getAllTherapists();
  let updated = 0;
  let skipped = 0;
  list.forEach((t) => {
    const current = resolveTherapistLunchBreak(t);
    const isCustom = current.start !== prevDefault.start || current.end !== prevDefault.end;
    if (isCustom && !overwriteCustom) {
      skipped += 1;
      return;
    }
    if (t.lunchStart !== newLunch.start || t.lunchEnd !== newLunch.end) {
      t.lunchStart = newLunch.start;
      t.lunchEnd = newLunch.end;
      updated += 1;
    }
  });

  const ok = saveAllTherapists(list);
  if (!ok) {
    return {
      success: false,
      updated: 0,
      skipped,
      message: 'スタッフへの昼休み一括適用の保存に失敗しました',
      lunch: newLunch
    };
  }

  const protectNote = overwriteCustom
    ? ''
    : (skipped > 0 ? `（個別設定 ${skipped} 名は保護）` : '');
  return {
    success: true,
    updated,
    skipped,
    message: `標準昼休み ${newLunch.start}〜${newLunch.end} を ${updated} 名に適用しました${protectNote}`,
    lunch: newLunch
  };
}

/**
 * スロット開始時刻が当該セラピストの昼休み時間帯に含まれるか
 * （[start, end) 半開区間: 12:00〜13:00 → 12:00/12:20/12:40 が対象）
 * @param {object|null|undefined} therapist
 * @param {string} slotStartTime HH:MM
 * @returns {boolean}
 */
export function isTherapistLunchSlot(therapist, slotStartTime) {
  const lunch = resolveTherapistLunchBreak(therapist);
  const start = normalizeClockHm(slotStartTime);
  if (!start) return false;
  return start >= lunch.start && start < lunch.end;
}

/**
 * 読み込み時の正規化（status / color / lunch を補完）
 * @param {object} t
 * @param {number} idx
 * @returns {object}
 */
function normalizeTherapistRecord(t, idx = 0) {
  const lunch = resolveTherapistLunchBreak(t);
  return {
    ...t,
    status: t.status || THERAPIST_STATUS.ACTIVE,
    color: t.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
    lunchStart: lunch.start,
    lunchEnd: lunch.end
  };
}

/**
 * 現在登録されている全セラピストを取得する
 * （既存データに status / lunch がない場合は互換性のため自動補完）
 * @returns {Array<{id: string, name: string, color: string, status: string, lunchStart: string, lunchEnd: string}>}
 */
export function getAllTherapists() {
  try {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) {
      saveAllTherapists(DEFAULT_THERAPISTS);
      return JSON.parse(JSON.stringify(DEFAULT_THERAPISTS)).map((t, idx) => normalizeTherapistRecord(t, idx));
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((t, idx) => normalizeTherapistRecord(t, idx));
    }
    return JSON.parse(JSON.stringify(DEFAULT_THERAPISTS)).map((t, idx) => normalizeTherapistRecord(t, idx));
  } catch (error) {
    console.error('getAllTherapists error:', error);
    return JSON.parse(JSON.stringify(DEFAULT_THERAPISTS)).map((t, idx) => normalizeTherapistRecord(t, idx));
  }
}

/**
 * 稼働中（現役で日常時間割に表示する）セラピストのみを取得する
 * @returns {Array<{id: string, name: string, color: string, status: string}>}
 */
export function getActiveTherapists() {
  return getAllTherapists().filter((t) => t.status === THERAPIST_STATUS.ACTIVE);
}

/**
 * ID指定でセラピストを取得する
 * @param {string} id 
 * @returns {{id: string, name: string, color: string, status: string}|null}
 */
export function getTherapistById(id) {
  if (!id) return null;
  const list = getAllTherapists();
  return list.find((t) => t.id === id) || null;
}

/**
 * 全セラピスト情報をLocalStorageへ保存する
 * @param {Array} list 
 * @returns {boolean}
 */
export function saveAllTherapists(list) {
  try {
    if (!Array.isArray(list)) return false;
    return writeStorageItem(STORAGE_KEY, JSON.stringify(list));
  } catch (error) {
    console.error('saveAllTherapists error:', error);
    return false;
  }
}

/**
 * 新規セラピストを安全に追加する
 * 次の英字ID（A, B, C → D, E, F...）を自動採番して重複を物理的に防止
 * @param {string} name 新規セラピスト氏名
 * @param {string} status 初期ステータス（デフォルト: '稼働中'）
 * @returns {{success: boolean, therapist: Object|null, message?: string}}
 */
export function addTherapist(name = '', status = THERAPIST_STATUS.ACTIVE) {
  const list = getAllTherapists();
  const existingIds = new Set(list.map((t) => t.id));

  // 次の利用可能なアルファベットID（A〜Z）を自動検索
  let nextId = '';
  for (let i = 0; i < 26; i++) {
    const candidate = String.fromCharCode(65 + i); // 'A', 'B', 'C', ...
    if (!existingIds.has(candidate)) {
      nextId = candidate;
      break;
    }
  }

  if (!nextId) {
    nextId = `T${list.length + 1}`;
  }

  const cleanName = normalizeString(name) || `PT ${nextId}`;
  const validStatus = Object.values(THERAPIST_STATUS).includes(status) ? status : THERAPIST_STATUS.ACTIVE;
  const color = DEFAULT_COLORS[list.length % DEFAULT_COLORS.length];
  const facilityLunch = resolveFacilityLunchFallback();

  const newTherapist = {
    id: nextId,
    name: cleanName,
    color,
    status: validStatus,
    lunchStart: facilityLunch.start,
    lunchEnd: facilityLunch.end
  };

  list.push(newTherapist);
  const ok = saveAllTherapists(list);

  return {
    success: ok,
    therapist: ok ? newTherapist : null,
    storageFailed: !ok,
    message: ok ? `セラピスト（枠 ${nextId}: ${cleanName}）を追加しました` : '保存に失敗しました'
  };
}

/**
 * 指定したIDのセラピストの表示名を更新する
 * @param {string} id セラピストID ('A', 'B', 'C' など)
 * @param {string} newName 新しい表示名
 * @returns {boolean}
 */
export function updateTherapistName(id, newName) {
  if (!id) return false;
  const cleanName = normalizeString(newName);
  if (!cleanName) return false;

  const list = getAllTherapists();
  const target = list.find((t) => t.id === id);
  if (!target) return false;

  target.name = cleanName;
  return saveAllTherapists(list);
}

/**
 * 指定したIDのセラピストのステータス（稼働中/休職/退職）を更新する
 * @param {string} id セラピストID
 * @param {'稼働中'|'休職'|'退職'} newStatus 
 * @returns {boolean}
 */
export function updateTherapistStatus(id, newStatus) {
  if (!id || !Object.values(THERAPIST_STATUS).includes(newStatus)) return false;

  const list = getAllTherapists();
  const target = list.find((t) => t.id === id);
  if (!target) return false;

  target.status = newStatus;
  return saveAllTherapists(list);
}

/**
 * 複数のセラピストの名称およびステータスを一括更新する
 * @param {Object} updateMap { 'A': { name: '山田', status: '稼働中' }, 'B': { name: '佐藤', status: '休職' } }
 * @returns {boolean}
 */
export function updateTherapistSettings(updateMap) {
  if (!updateMap || typeof updateMap !== 'object') return false;
  const list = getAllTherapists();
  let changed = false;

  list.forEach((t) => {
    const entry = updateMap[t.id];
    if (entry) {
      if (typeof entry === 'string') {
        const clean = normalizeString(entry);
        if (clean && clean !== t.name) {
          t.name = clean;
          changed = true;
        }
      } else if (typeof entry === 'object') {
        if (entry.name !== undefined) {
          const clean = normalizeString(entry.name);
          if (clean && clean !== t.name) {
            t.name = clean;
            changed = true;
          }
        }
        if (entry.status !== undefined && Object.values(THERAPIST_STATUS).includes(entry.status)) {
          if (entry.status !== t.status) {
            t.status = entry.status;
            changed = true;
          }
        }
        if (entry.lunchStart !== undefined || entry.lunchEnd !== undefined
          || entry.breakStartTime !== undefined || entry.breakEndTime !== undefined) {
          const lunch = resolveTherapistLunchBreak({
            lunchStart: entry.lunchStart !== undefined ? entry.lunchStart : (entry.breakStartTime !== undefined ? entry.breakStartTime : t.lunchStart),
            lunchEnd: entry.lunchEnd !== undefined ? entry.lunchEnd : (entry.breakEndTime !== undefined ? entry.breakEndTime : t.lunchEnd)
          });
          if (lunch.start !== t.lunchStart || lunch.end !== t.lunchEnd) {
            t.lunchStart = lunch.start;
            t.lunchEnd = lunch.end;
            changed = true;
          }
        }
      }
    }
  });

  return changed ? saveAllTherapists(list) : true;
}

/**
 * 従来の名称一括更新関数（後方互換性100%維持）
 * @param {Object} nameMap { 'A': '山田', 'B': '佐藤' }
 * @returns {boolean}
 */
export function updateTherapistNames(nameMap) {
  return updateTherapistSettings(nameMap);
}
