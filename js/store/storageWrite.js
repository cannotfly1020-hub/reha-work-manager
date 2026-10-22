// js/store/storageWrite.js
// 透過的ストレージ書き込み（メモリ + IndexedDB + localStorage ミラー）
// 失敗時のみトースト通知。Store API の同期戻り値契約は維持。

import { storageSet } from '../core/storageAdapter.js';
import { showToast } from '../ui/toast.js';

let lastFailureToastAt = 0;

/**
 * キー・値を永続化する（同期的にメモリ反映し、裏で IndexedDB へ保存）
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function writeStorageItem(key, value) {
  try {
    const ok = storageSet(key, value);
    if (!ok) {
      notifyStorageWriteFailure(new Error('storageSet returned false'));
      return false;
    }
    return true;
  } catch (error) {
    console.error('storage write error:', key, error);
    notifyStorageWriteFailure(error);
    return false;
  }
}

function notifyStorageWriteFailure(error) {
  const now = Date.now();
  if (now - lastFailureToastAt < 2500) return;
  lastFailureToastAt = now;

  const quota = error && (
    error.name === 'QuotaExceededError' ||
    error.code === 22 ||
    error.code === 1014
  );
  showToast(
    quota
      ? '保存できませんでした。保存容量がいっぱいです。バックアップを取るか、不要なデータを消してください。'
      : '保存できませんでした。この変更は記録されていません。',
    'error'
  );
}
