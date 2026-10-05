// js/store/therapistStore.js
// セラピストマスター管理・LocalStorage永続化・ステータス管理（稼働中/休職/退職）・新規追加・増員対応（200行制限準拠）

import { normalizeString } from '../core/dataNormalizer.js';

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
 * 新規追加時のカラーパレット候補
 */
const DEFAULT_COLORS = ['#0284c7', '#0d9488', '#7c3aed', '#ea580c', '#059669', '#d97706', '#dc2626', '#4f46e5'];

/**
 * 初期デフォルトセラピスト一覧
 */
const DEFAULT_THERAPISTS = [
  { id: 'A', name: 'PT A', color: '#0284c7', status: THERAPIST_STATUS.ACTIVE },
  { id: 'B', name: 'PT B', color: '#0d9488', status: THERAPIST_STATUS.ACTIVE },
  { id: 'C', name: 'PT C', color: '#7c3aed', status: THERAPIST_STATUS.ACTIVE }
];

/**
 * 現在登録されている全セラピストを取得する
 * （既存データに status がない場合は互換性のため自動で '稼働中' を補完）
 * @returns {Array<{id: string, name: string, color: string, status: string}>}
 */
export function getAllTherapists() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveAllTherapists(DEFAULT_THERAPISTS);
      return JSON.parse(JSON.stringify(DEFAULT_THERAPISTS));
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((t, idx) => ({
        ...t,
        status: t.status || THERAPIST_STATUS.ACTIVE,
        color: t.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
      }));
    }
    return JSON.parse(JSON.stringify(DEFAULT_THERAPISTS));
  } catch (error) {
    console.error('getAllTherapists error:', error);
    return JSON.parse(JSON.stringify(DEFAULT_THERAPISTS));
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
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

  const newTherapist = {
    id: nextId,
    name: cleanName,
    color,
    status: validStatus
  };

  list.push(newTherapist);
  const ok = saveAllTherapists(list);

  return {
    success: ok,
    therapist: ok ? newTherapist : null,
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
