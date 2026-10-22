// js/backup/localFileBackup.js
// ローカルフォルダ直結セーフティネット（File System Access API + IndexedDB 14日スナップショット）
// フェーズ1 storageAdapter / 同期 API には一切干渉しない独立モジュール

import { getLocalDateStr } from '../core/dateUtils.js';
import { storageGet, storageSet } from '../core/storageAdapter.js';
import { showToast } from '../ui/toast.js';

const SAFETY_DB_NAME = 'reha_backup_safety_net_db';
const SAFETY_DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_SNAPSHOTS = 'daily_snapshots';

const META_DIR_HANDLE = 'reha_backup_directory_handle';
const META_AUTO_WRITE = 'auto_write_enabled';

const SETTING_AUTO_KEY = 'reha_backup_folder_auto_enabled';
const SETTING_FOLDER_NAME_KEY = 'reha_backup_folder_display_name';

const KEEP_DAYS = 14;
const FILE_PREFIX = 'reha_backup_';

/** @type {IDBDatabase|null} */
let safetyDb = null;

/** @type {FileSystemDirectoryHandle|null} */
let cachedDirHandle = null;

let initDone = false;

function openSafetyDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(SAFETY_DB_NAME, SAFETY_DB_VERSION);
    req.onerror = () => reject(req.error || new Error('safety DB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'date' });
      }
    };
  });
}

function metaGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = () => reject(req.error);
  });
}

function metaPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function snapshotPut(db, dateStr, jsonText) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    tx.objectStore(STORE_SNAPSHOTS).put({
      date: dateStr,
      json: jsonText,
      savedAt: new Date().toISOString()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function snapshotGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const req = tx.objectStore(STORE_SNAPSHOTS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function snapshotDelete(db, dateStr) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    tx.objectStore(STORE_SNAPSHOTS).delete(dateStr);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * File System Access API が使えるか
 * @returns {boolean}
 */
export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined'
    && typeof window.showDirectoryPicker === 'function';
}

/**
 * 自動書き出し設定（同期・storageAdapter 経由で UI 表示用）
 * @returns {boolean}
 */
export function isAutoWriteEnabled() {
  const v = storageGet(SETTING_AUTO_KEY, '1');
  return v !== '0' && v !== 'false';
}

/**
 * @param {boolean} enabled
 */
export function setAutoWriteEnabled(enabled) {
  storageSet(SETTING_AUTO_KEY, enabled ? '1' : '0');
  if (safetyDb) {
    metaPut(safetyDb, META_AUTO_WRITE, enabled).catch(() => {});
  }
}

/**
 * 表示用フォルダ名
 * @returns {string}
 */
export function getBackupFolderDisplayName() {
  return storageGet(SETTING_FOLDER_NAME_KEY, '') || '';
}

/**
 * セーフティネット DB・フォルダハンドルの初期化（非ブロッキング前提で await 可）
 * @returns {Promise<{ hasFolder: boolean, permission: string }>}
 */
export async function initLocalFileBackup() {
  if (initDone) {
    return {
      hasFolder: Boolean(cachedDirHandle),
      permission: cachedDirHandle ? 'granted' : 'none'
    };
  }

  try {
    safetyDb = await openSafetyDb();
  } catch (e) {
    console.warn('[localFileBackup] safety DB unavailable:', e);
    initDone = true;
    return { hasFolder: false, permission: 'unavailable' };
  }

  // 設定の同期（IDB meta → storageAdapter 表示キー）
  try {
    const autoMeta = await metaGet(safetyDb, META_AUTO_WRITE);
    if (typeof autoMeta === 'boolean') {
      storageSet(SETTING_AUTO_KEY, autoMeta ? '1' : '0');
    } else if (storageGet(SETTING_AUTO_KEY) === null) {
      storageSet(SETTING_AUTO_KEY, '1');
    }
  } catch (_) { /* ignore */ }

  let permission = 'none';
  try {
    const handle = await metaGet(safetyDb, META_DIR_HANDLE);
    if (handle && typeof handle.queryPermission === 'function') {
      cachedDirHandle = handle;
      permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'prompt') {
        // 起動時はユーザー操作なしで request できない場合がある → 失敗しても落とさない
        try {
          permission = await handle.requestPermission({ mode: 'readwrite' });
        } catch (_) {
          permission = 'prompt';
        }
      }
      if (permission === 'granted') {
        storageSet(SETTING_FOLDER_NAME_KEY, handle.name || '選択済みフォルダ');
      }
    }
  } catch (e) {
    console.warn('[localFileBackup] restore directory handle failed:', e);
    cachedDirHandle = null;
    permission = 'none';
  }

  initDone = true;
  return { hasFolder: Boolean(cachedDirHandle), permission };
}

/**
 * ユーザー操作でバックアップ先フォルダを選択・永続化
 * @returns {Promise<{ success: boolean, folderName?: string, message?: string }>}
 */
export async function pickBackupDirectory() {
  if (!isFileSystemAccessSupported()) {
    return {
      success: false,
      message: 'この環境ではフォルダ自動保存に未対応です（Chrome / Edge / Electron 推奨）。IndexedDB内スナップショットは引き続き稼働します。'
    };
  }

  try {
    if (!safetyDb) safetyDb = await openSafetyDb();

    const handle = await window.showDirectoryPicker({
      id: 'reha-work-manager-backup',
      mode: 'readwrite',
      startIn: 'documents'
    });

    cachedDirHandle = handle;
    await metaPut(safetyDb, META_DIR_HANDLE, handle);
    storageSet(SETTING_FOLDER_NAME_KEY, handle.name || '選択済みフォルダ');

    // 選択直後に権限確認
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') {
      return {
        success: false,
        message: 'フォルダへの書き込み権限が拒否されました。再選択してください。'
      };
    }

    return { success: true, folderName: handle.name || '選択済みフォルダ' };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { success: false, message: 'フォルダ選択がキャンセルされました。' };
    }
    console.warn('[localFileBackup] pickBackupDirectory error:', e);
    return { success: false, message: 'フォルダ選択に失敗しました。' };
  }
}

/**
 * IndexedDB 内に日次スナップショットを保存し、14日超を削除（方式 B・常時）
 * @param {Object} dump
 * @param {string} dateStr
 */
export async function saveIdbDailySnapshot(dump, dateStr) {
  if (!safetyDb) {
    try {
      safetyDb = await openSafetyDb();
    } catch (_) {
      return false;
    }
  }

  try {
    const jsonText = JSON.stringify(dump);
    await snapshotPut(safetyDb, dateStr, jsonText);

    const all = await snapshotGetAll(safetyDb);
    const sorted = all.map((r) => r.date).filter(Boolean).sort();
    while (sorted.length > KEEP_DAYS) {
      const oldest = sorted.shift();
      if (oldest) await snapshotDelete(safetyDb, oldest);
    }
    return true;
  } catch (e) {
    console.warn('[localFileBackup] IDB snapshot save failed:', e);
    return false;
  }
}

/**
 * フォルダ内の古い reha_backup_*.json を14日ローテーション削除
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} todayStr
 */
async function rotateFolderBackupFiles(dirHandle, todayStr) {
  const today = new Date(`${todayStr}T00:00:00`);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);

  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file') continue;
      const name = entry.name || '';
      if (!name.startsWith(FILE_PREFIX) || !name.endsWith('.json')) continue;
      const datePart = name.slice(FILE_PREFIX.length, FILE_PREFIX.length + 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue;
      const fileDate = new Date(`${datePart}T00:00:00`);
      if (fileDate < cutoff) {
        try {
          await dirHandle.removeEntry(name);
        } catch (rmErr) {
          console.warn('[localFileBackup] remove old file failed:', name, rmErr);
        }
      }
    }
  } catch (e) {
    console.warn('[localFileBackup] folder rotation skip:', e);
  }
}

/**
 * 指定フォルダへ当日 JSON を書き出し（方式 A）
 * @param {Object} dump
 * @param {string} dateStr
 * @returns {Promise<{ success: boolean, reason?: string, fileName?: string }>}
 */
export async function autoWriteDailyBackupToFile(dump, dateStr) {
  if (!isAutoWriteEnabled()) {
    return { success: false, reason: 'disabled' };
  }

  if (!isFileSystemAccessSupported()) {
    return { success: false, reason: 'unsupported' };
  }

  if (!cachedDirHandle) {
    return { success: false, reason: 'no_folder' };
  }

  try {
    let perm = await cachedDirHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'prompt') {
      try {
        perm = await cachedDirHandle.requestPermission({ mode: 'readwrite' });
      } catch (_) {
        return { success: false, reason: 'permission_prompt' };
      }
    }
    if (perm !== 'granted') {
      return { success: false, reason: 'permission_denied' };
    }

    const fileName = `${FILE_PREFIX}${dateStr}.json`;
    const fileHandle = await cachedDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dump, null, 2));
    await writable.close();

    await rotateFolderBackupFiles(cachedDirHandle, dateStr);

    return { success: true, fileName };
  } catch (e) {
    console.warn('[localFileBackup] autoWriteDailyBackupToFile failed:', e);
    return { success: false, reason: 'write_error', message: e?.message };
  }
}

/**
 * UI ステータス用スナップショット
 * @returns {{ supported: boolean, folderName: string, autoEnabled: boolean, hasHandle: boolean }}
 */
export function getLocalBackupUiState() {
  return {
    supported: isFileSystemAccessSupported(),
    folderName: getBackupFolderDisplayName(),
    autoEnabled: isAutoWriteEnabled(),
    hasHandle: Boolean(cachedDirHandle)
  };
}

/**
 * 起動時・終了時用の軽量ステータスログ
 * @param {string} todayStr
 */
export function logBackupNetStatus(todayStr = getLocalDateStr()) {
  const state = getLocalBackupUiState();
  console.log(
    `[localFileBackup] ${todayStr} supported=${state.supported} folder=${state.folderName || '(未設定)'} auto=${state.autoEnabled} handle=${state.hasHandle}`
  );
}
