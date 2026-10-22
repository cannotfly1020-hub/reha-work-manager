// js/core/storageAdapter.js
// IndexedDB 透過的ストレージ層（メモリキャッシュ同期読み取り + IDB非同期永続化）
// View / Store の同期 API は変更せず、容量5MB限界を物理撤廃する。

const DB_NAME = 'reha_work_manager_db';
const DB_VERSION = 1;
const STORE_NAME = 'app_key_value_store';
const KEY_PREFIX = 'reha_';
const META_MIGRATED = '__reha_storage_migrated_v1';

/** @type {Map<string, string>} */
const memoryCache = new Map();

/** @type {IDBDatabase|null} */
let dbInstance = null;

let initPromise = null;
let isReady = false;

/**
 * IndexedDB を開く
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

/**
 * IDB オブジェクトストアの全レコードを取得
 * @param {IDBDatabase} db
 * @returns {Promise<Array<{key: string, value: string}>>}
 */
function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * IDB に単一キーを put
 * @param {IDBDatabase} db
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ key, value: String(value) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB put aborted'));
  });
}

/**
 * IDB から単一キーを削除
 * @param {IDBDatabase} db
 * @param {string} key
 * @returns {Promise<void>}
 */
function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 複数キーを一括 put（マイグレーション用）
 * @param {IDBDatabase} db
 * @param {Array<{key: string, value: string}>} entries
 * @returns {Promise<void>}
 */
function idbPutMany(db, entries) {
  return new Promise((resolve, reject) => {
    if (!entries.length) {
      resolve();
      return;
    }
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    entries.forEach((entry) => {
      store.put({ key: entry.key, value: String(entry.value) });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * localStorage 上の reha_* キーをすべて収集
 * @returns {Array<{key: string, value: string}>}
 */
function collectLocalStorageRehaEntries() {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      entries.push({ key, value });
    }
  } catch (e) {
    console.warn('[storageAdapter] localStorage scan failed:', e);
  }
  return entries;
}

/**
 * localStorage ミラー書き込み（容量超過は握りつぶす）
 * @param {string} key
 * @param {string} value
 */
function tryMirrorLocalStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch (e) {
    // QuotaExceededError 等は無視（IndexedDB が正本）
    if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
      return;
    }
    console.warn('[storageAdapter] localStorage mirror warn:', key, e);
  }
}

/**
 * localStorage ミラー削除
 * @param {string} key
 */
function tryRemoveLocalStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('[storageAdapter] localStorage remove warn:', key, e);
  }
}

/**
 * メモリへロード（起動時）
 * @param {Array<{key: string, value: string}>} records
 */
function loadIntoMemory(records) {
  memoryCache.clear();
  records.forEach((rec) => {
    if (!rec || !rec.key) return;
    if (rec.key === META_MIGRATED) return;
    memoryCache.set(rec.key, String(rec.value ?? ''));
  });
}

/**
 * 起動時初期化: IndexedDB オープン → 初回は localStorage から自動移行 → メモリへ一括ロード
 * 以降の storageGet はメモリから同期即時返却。
 * @returns {Promise<{ migrated: boolean, keyCount: number }>}
 */
export async function initStorage() {
  if (isReady) {
    return { migrated: false, keyCount: memoryCache.size };
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let migrated = false;

    try {
      dbInstance = await openDatabase();
      let records = await idbGetAll(dbInstance);
      const dataRecords = records.filter((r) => r && r.key && r.key !== META_MIGRATED);

      // IDB が空なら localStorage から完全自動マイグレーション
      if (dataRecords.length === 0) {
        const lsEntries = collectLocalStorageRehaEntries();
        if (lsEntries.length > 0) {
          await idbPutMany(dbInstance, lsEntries);
          await idbPut(dbInstance, META_MIGRATED, new Date().toISOString());
          migrated = true;
          console.log(`[storageAdapter] Migrated ${lsEntries.length} keys from localStorage → IndexedDB`);
        }
        records = await idbGetAll(dbInstance);
      } else {
        // IDB にデータがある場合でも、LS にあって IDB に無いキーを補完マージ
        const existing = new Set(dataRecords.map((r) => r.key));
        const missing = collectLocalStorageRehaEntries().filter((e) => !existing.has(e.key));
        if (missing.length > 0) {
          await idbPutMany(dbInstance, missing);
          records = await idbGetAll(dbInstance);
          console.log(`[storageAdapter] Merged ${missing.length} missing localStorage keys into IndexedDB`);
        }
      }

      loadIntoMemory(records);
    } catch (err) {
      console.warn('[storageAdapter] IndexedDB unavailable — falling back to localStorage memory preload:', err);
      dbInstance = null;
      loadIntoMemory(collectLocalStorageRehaEntries());
    }

    isReady = true;
    console.log(`[storageAdapter] Ready. memory keys=${memoryCache.size}, migrated=${migrated}`);
    return { migrated, keyCount: memoryCache.size };
  })();

  try {
    return await initPromise;
  } catch (e) {
    initPromise = null;
    isReady = true;
    loadIntoMemory(collectLocalStorageRehaEntries());
    console.warn('[storageAdapter] init failed hard, LS-only mode:', e);
    return { migrated: false, keyCount: memoryCache.size };
  }
}

/**
 * 同期読み取り（メモリキャッシュ優先、なければ localStorage フォールバック）
 * localStorage.getItem と同等に string | null を返す。
 * @param {string} key
 * @param {string|null} fallback
 * @returns {string|null}
 */
export function storageGet(key, fallback = null) {
  if (!key) return fallback;
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      memoryCache.set(key, raw);
      return raw;
    }
  } catch (_) { /* ignore */ }
  return fallback;
}

/**
 * 同期書き込み入口: メモリ即時更新 + IndexedDB 非同期永続化 + localStorage ミラー試行
 * @param {string} key
 * @param {string} value
 * @returns {boolean} メモリ更新に成功すれば true（UI は即時反映）
 */
export function storageSet(key, value) {
  if (!key) return false;
  const str = value === undefined || value === null ? '' : String(value);

  // 1) メモリ即時更新（0ms・同期 API 維持の核）
  memoryCache.set(key, str);

  // 2) IndexedDB 非同期 put（ギガバイト級）
  if (dbInstance) {
    idbPut(dbInstance, key, str).catch((err) => {
      console.error('[storageAdapter] IndexedDB put failed:', key, err);
    });
  }

  // 3) 容量許す限り localStorage へミラー（失敗は握りつぶし）
  tryMirrorLocalStorage(key, str);

  return true;
}

/**
 * キー削除（メモリ + IDB + localStorage）
 * @param {string} key
 * @returns {boolean}
 */
export function storageRemove(key) {
  if (!key) return false;
  memoryCache.delete(key);

  if (dbInstance) {
    idbDelete(dbInstance, key).catch((err) => {
      console.error('[storageAdapter] IndexedDB delete failed:', key, err);
    });
  }

  tryRemoveLocalStorage(key);
  return true;
}

/**
 * プレフィックス一致キー一覧（メモリキャッシュ基準・同期）
 * @param {string} prefix
 * @returns {string[]}
 */
export function storageKeys(prefix = '') {
  const keys = [];
  memoryCache.forEach((_, key) => {
    if (!prefix || key.startsWith(prefix)) keys.push(key);
  });
  // 初期化前や未ロード時のフォールバック
  if (keys.length === 0 && !isReady) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (!prefix || key.startsWith(prefix))) keys.push(key);
      }
    } catch (_) { /* ignore */ }
  }
  return keys.sort();
}

/**
 * プレフィックス一致キーをすべて削除
 * @param {string} prefix
 */
export function storageRemoveByPrefix(prefix) {
  storageKeys(prefix).forEach((key) => storageRemove(key));
}

/**
 * バックアップ用: メモリ上の全 reha_* スナップショット
 * @returns {Record<string, string>}
 */
export function storageSnapshot(prefix = KEY_PREFIX) {
  const dump = {};
  storageKeys(prefix).forEach((key) => {
    if (key === META_MIGRATED) return;
    const val = memoryCache.get(key);
    if (val !== undefined) dump[key] = val;
  });
  return dump;
}

/**
 * 初期化完了済みか
 * @returns {boolean}
 */
export function isStorageReady() {
  return isReady;
}
