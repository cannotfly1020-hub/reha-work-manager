// js/store/assistantStore.js
// リハビリ助手1・2の氏名

import { writeStorageItem } from './storageWrite.js';

const ASSISTANT_STORAGE_KEY = 'reha_assistant_settings';

/**
 * リハビリ助手の最新設定（助手1・助手2氏名）を取得する
 * @returns {{ assistant1: string, assistant2: string }}
 */
export function getAssistantSettings() {
  try {
    const raw = localStorage.getItem(ASSISTANT_STORAGE_KEY);
    if (!raw) return { assistant1: '', assistant2: '' };
    const parsed = JSON.parse(raw);
    return {
      assistant1: (parsed.assistant1 || '').trim(),
      assistant2: (parsed.assistant2 || '').trim()
    };
  } catch (e) {
    console.error('getAssistantSettings error:', e);
    return { assistant1: '', assistant2: '' };
  }
}

/**
 * リハビリ助手の設定（助手1・助手2氏名）を保存する
 * @param {string} a1 助手1氏名
 * @param {string} a2 助手2氏名
 */
export function saveAssistantSettings(a1 = '', a2 = '') {
  try {
    const data = {
      assistant1: String(a1).trim(),
      assistant2: String(a2).trim()
    };
    return writeStorageItem(ASSISTANT_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('saveAssistantSettings error:', e);
    return false;
  }
}
