// js/store/storageWrite.js
// localStorage への書き込み。失敗したときは画面に出す。

import { showToast } from '../ui/toast.js';

let lastFailureToastAt = 0;

export function writeStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error('localStorage write error:', key, error);
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
