// js/backup/localFileBackup.js
// ローカルフォルダ直結セーフティネット（File System Access API + IndexedDB 14日スナップショット）
// フェーズ1 storageAdapter / 同期 API には一切干渉しない独立モジュール
// ★ユーザーが選んだ親フォルダ配下に「リハビリ管理_自動バックアップ」を自動作成し、日次JSONはそこへ格納

import { getLocalDateStr } from '../core/dateUtils.js';
import { storageGet, storageSet } from '../core/storageAdapter.js';

const SAFETY_DB_NAME = 'reha_backup_safety_net_db';
const SAFETY_DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_SNAPSHOTS = 'daily_snapshots';

const META_DIR_HANDLE = 'reha_backup_directory_handle';
const META_AUTO_WRITE = 'auto_write_enabled';

const SETTING_AUTO_KEY = 'reha_backup_folder_auto_enabled';
const SETTING_FOLDER_NAME_KEY = 'reha_backup_folder_display_name';

/** ユーザー選択フォルダ直下に自動作成する専用サブフォルダ名 */
export const BACKUP_SUBFOLDER_NAME = 'リハビリ管理_自動バックアップ';

const KEEP_DAYS = 14;
const FILE_PREFIX = 'reha_backup_';

/** @type {IDBDatabase|null} */
let safetyDb = null;

/** @type {FileSystemDirectoryHandle|null} 実際に JSON を書き込む専用サブフォルダのハンドル */
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

function metaDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).delete(key);
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
 * 親フォルダ配下に専用サブフォルダを作成／取得する
 * @param {FileSystemDirectoryHandle} parentDirHandle
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function ensureBackupSubfolder(parentDirHandle) {
  return parentDirHandle.getDirectoryHandle(BACKUP_SUBFOLDER_NAME, { create: true });
}

/**
 * 表示用パス（親名/専用サブフォルダ）
 * @param {string} parentName
 * @returns {string}
 */
function buildBackupFolderDisplayName(parentName) {
  const parent = (parentName || '').trim() || '選択済みフォルダ';
  return `${parent}/${BACKUP_SUBFOLDER_NAME}`;
}

/**
 * 保存済みハンドルが親（旧仕様）か専用サブフォルダかを判定し、書き込み先を専用サブに正規化
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<{ backupDir: FileSystemDirectoryHandle, displayName: string }>}
 */
async function resolveBackupDirectoryHandle(handle) {
  if (!handle) {
    throw new Error('directory handle is null');
  }

  // すでに専用サブフォルダを指している場合はそのまま使用
  if (handle.name === BACKUP_SUBFOLDER_NAME) {
    return {
      backupDir: handle,
      displayName: getBackupFolderDisplayName() || BACKUP_SUBFOLDER_NAME
    };
  }

  // 旧仕様（親フォルダを直接保存していた場合）→ 配下に専用サブを作成／取得して移行
  const backupDir = await ensureBackupSubfolder(handle);
  const displayName = buildBackupFolderDisplayName(handle.name);
  return { backupDir, displayName };
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
        try {
          const resolved = await resolveBackupDirectoryHandle(handle);
          cachedDirHandle = resolved.backupDir;
          // 移行後ハンドルを永続化（次回以降は専用サブを直接参照）
          if (resolved.backupDir !== handle) {
            await metaPut(safetyDb, META_DIR_HANDLE, resolved.backupDir);
          }
          storageSet(SETTING_FOLDER_NAME_KEY, resolved.displayName);
        } catch (resolveErr) {
          console.warn('[localFileBackup] ensure subfolder on init failed:', resolveErr);
          cachedDirHandle = handle;
          storageSet(
            SETTING_FOLDER_NAME_KEY,
            handle.name === BACKUP_SUBFOLDER_NAME
              ? (getBackupFolderDisplayName() || BACKUP_SUBFOLDER_NAME)
              : buildBackupFolderDisplayName(handle.name)
          );
        }
      } else {
        // 権限未付与でもハンドルは保持（再選択・解除 UI 用）
        cachedDirHandle = handle;
        if (!getBackupFolderDisplayName()) {
          storageSet(
            SETTING_FOLDER_NAME_KEY,
            handle.name === BACKUP_SUBFOLDER_NAME
              ? BACKUP_SUBFOLDER_NAME
              : buildBackupFolderDisplayName(handle.name)
          );
        }
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
 * ユーザー操作でバックアップ先の親フォルダを選択し、
 * 配下に「リハビリ管理_自動バックアップ」を自動作成して永続化する
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

    const parentHandle = await window.showDirectoryPicker({
      id: 'reha-work-manager-backup',
      mode: 'readwrite',
      startIn: 'documents'
    });

    // 選択直後に親フォルダの権限確認
    let perm = await parentHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await parentHandle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') {
      return {
        success: false,
        message: 'フォルダへの書き込み権限が拒否されました。再選択してください。'
      };
    }

    // 専用サブフォルダを自動作成／取得し、そちらを書き込み先として永続化
    const backupDir = await ensureBackupSubfolder(parentHandle);
    cachedDirHandle = backupDir;
    await metaPut(safetyDb, META_DIR_HANDLE, backupDir);

    const displayName = buildBackupFolderDisplayName(parentHandle.name);
    storageSet(SETTING_FOLDER_NAME_KEY, displayName);

    return { success: true, folderName: displayName };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { success: false, message: 'フォルダ選択がキャンセルされました。' };
    }
    console.warn('[localFileBackup] pickBackupDirectory error:', e);
    return { success: false, message: 'フォルダ選択に失敗しました。' };
  }
}

/**
 * フォルダ設定を初期化・削除する（再選択前の解除／誤設定のリセット）
 * 専用DB内のディレクトリハンドルと表示名を消去し、方式B（IDBスナップショット）へ安全にフォールバックする。
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function clearBackupDirectoryHandle() {
  cachedDirHandle = null;
  try {
    storageSet(SETTING_FOLDER_NAME_KEY, '');
  } catch (_) { /* ignore */ }

  try {
    if (!safetyDb) {
      try {
        safetyDb = await openSafetyDb();
      } catch (_) {
        return {
          success: true,
          message: 'フォルダ設定を解除しました（IndexedDBスナップショットは継続稼働します）。'
        };
      }
    }
    await metaDelete(safetyDb, META_DIR_HANDLE);
  } catch (e) {
    console.warn('[localFileBackup] clearBackupDirectoryHandle meta delete failed:', e);
    // メモリ上のハンドルは既に消しているため、UI上は未設定へ戻せる
    return {
      success: true,
      message: 'フォルダ設定を解除しました（一部メタ削除に失敗しましたが、書き込み先は未設定です）。'
    };
  }

  return {
    success: true,
    message: 'フォルダ設定を解除しました。以降は IndexedDB 内14日スナップショットのみが稼働します。'
  };
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
 * ※書き込み先は専用サブフォルダ「リハビリ管理_自動バックアップ」
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
