// js/store/therapistStore.js
// セラピストマスター管理・LocalStorage永続化・動的名称変更・増員対応ストア層（200行制限準拠）

import { normalizeString } from '../core/dataNormalizer.js';

const STORAGE_KEY = 'reha_therapists_master';

/**
 * 初期デフォルトセラピスト一覧
 */
const DEFAULT_THERAPISTS = [
  { id: 'A', name: 'PT A', color: '#0284c7' },
  { id: 'B', name: 'PT B', color: '#0d9488' },
  { id: 'C', name: 'PT C', color: '#7c3aed' }
];

/**
 * 現在登録されている全セラピストを取得する（未設定時はデフォルトを初期保存して返す）
 * @returns {Array<{id: string, name: string, color: string}>}
 */
export function getAllTherapists() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveAllTherapists(DEFAULT_THERAPISTS);
      return [...DEFAULT_THERAPISTS];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return [...DEFAULT_THERAPISTS];
  } catch (error) {
    console.error('getAllTherapists error:', error);
    return [...DEFAULT_THERAPISTS];
  }
}

/**
 * ID指定でセラピストを取得する
 * @param {string} id 
 * @returns {{id: string, name: string, color: string}|null}
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
 * 複数のセラピストの名称を一括更新する
 * @param {Object} nameMap { 'A': '山田', 'B': '佐藤', 'C': '鈴木' }
 * @returns {boolean}
 */
export function updateTherapistNames(nameMap) {
  if (!nameMap || typeof nameMap !== 'object') return false;
  const list = getAllTherapists();
  let changed = false;

  list.forEach((t) => {
    if (nameMap[t.id] !== undefined) {
      const clean = normalizeString(nameMap[t.id]);
      if (clean && clean !== t.name) {
        t.name = clean;
        changed = true;
      }
    }
  });

  return changed ? saveAllTherapists(list) : true;
}
