// js/core/storageAdapter.js
// IndexedDB 透過的ストレージ層（メモリキャッシュ同期読み取り + IDB非同期永続化）
// フェーズ3: 過去月スケジュールの選択的ハイドレーション／メモリパージ連携

const DB_NAME = 'reha_work_manager_db';
const DB_VERSION = 1;
const STORE_NAME = 'app_key_value_store';
const KEY_PREFIX = 'reha_';
const SCHEDULE_PREFIX = 'reha_schedule_';
const META_MIGRATED = '__reha_storage_migrated_v1';

/** @type {Map<string, string>} */
const memoryCache = new Map();

/** IndexedDB 上に存在する全キーの索引（値は持たない・アーカイブ件数把握用） */
const keyIndex = new Set();

/** @type {IDBDatabase|null} */
let dbInstance = null;

let initPromise = null;
let isReady = false;

/**
 * スケジュールキーをメモリに載せるかの判定関数（archiveManager が設定）
 * @type {((key: string) => boolean)|null}
 */
let scheduleHydrationFilter = null;

/**
 * 起動前にアーカイブ窓フィルタを登録する
 * @param {(key: string) => boolean} fn
 */
export function setScheduleHydrationFilter(fn) {
  scheduleHydrationFilter = typeof fn === 'function' ? fn : null;
}

function shouldHydrateIntoMemory(key) {
  if (!key || key === META_MIGRATED) return false;
  if (!key.startsWith(SCHEDULE_PREFIX)) return true;
  if (typeof scheduleHydrationFilter === 'function') {
    return scheduleHydrationFilter(key);
  }
  return true;
}

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

function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      const row = request.result;
      resolve(row && row.value !== undefined ? String(row.value) : null);
    };
    request.onerror = () => reject(request.error);
  });
}

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

function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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

function tryMirrorLocalStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
      return;
    }
    console.warn('[storageAdapter] localStorage mirror warn:', key, e);
  }
}

function tryRemoveLocalStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('[storageAdapter] localStorage remove warn:', key, e);
  }
}

/**
 * レコードを索引登録し、フィルタに合うものだけメモリへ載せる
 * @param {Array<{key: string, value: string}>} records
 */
function loadIntoMemorySelective(records) {
  memoryCache.clear();
  keyIndex.clear();
  let hydrated = 0;
  let skippedSchedule = 0;

  records.forEach((rec) => {
    if (!rec || !rec.key) return;
    if (rec.key === META_MIGRATED) return;
    keyIndex.add(rec.key);
    if (shouldHydrateIntoMemory(rec.key)) {
      memoryCache.set(rec.key, String(rec.value ?? ''));
      hydrated += 1;
    } else if (rec.key.startsWith(SCHEDULE_PREFIX)) {
      skippedSchedule += 1;
    }
  });

  console.log(
    `[storageAdapter] Memory hydrate: ${hydrated} keys (archived schedules kept cold: ${skippedSchedule})`
  );
}

/**
 * 起動時初期化
 * @returns {Promise<{ migrated: boolean, keyCount: number, memoryCount: number }>}
 */
export async function initStorage() {
  if (isReady) {
    return { migrated: false, keyCount: keyIndex.size, memoryCount: memoryCache.size };
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let migrated = false;

    try {
      dbInstance = await openDatabase();
      let records = await idbGetAll(dbInstance);
      const dataRecords = records.filter((r) => r && r.key && r.key !== META_MIGRATED);

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
        const existing = new Set(dataRecords.map((r) => r.key));
        const missing = collectLocalStorageRehaEntries().filter((e) => !existing.has(e.key));
        if (missing.length > 0) {
          await idbPutMany(dbInstance, missing);
          records = await idbGetAll(dbInstance);
          console.log(`[storageAdapter] Merged ${missing.length} missing localStorage keys into IndexedDB`);
        }
      }

      loadIntoMemorySelective(records);
    } catch (err) {
      console.warn('[storageAdapter] IndexedDB unavailable — falling back to localStorage memory preload:', err);
      dbInstance = null;
      loadIntoMemorySelective(collectLocalStorageRehaEntries());
    }

    isReady = true;
    console.log(`[storageAdapter] Ready. index=${keyIndex.size}, memory=${memoryCache.size}, migrated=${migrated}`);
    return { migrated, keyCount: keyIndex.size, memoryCount: memoryCache.size };
  })();

  try {
    return await initPromise;
  } catch (e) {
    initPromise = null;
    isReady = true;
    loadIntoMemorySelective(collectLocalStorageRehaEntries());
    console.warn('[storageAdapter] init failed hard, LS-only mode:', e);
    return { migrated: false, keyCount: keyIndex.size, memoryCount: memoryCache.size };
  }
}

/**
 * 同期読み取り（メモリ → localStorage フォールバック）
 * アーカイブ済みスケジュールは loadMonthOnDemand 後にメモリへ載る。
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
      keyIndex.add(key);
      return raw;
    }
  } catch (_) { /* ignore */ }
  return fallback;
}

/**
 * 同期書き込み: メモリ即時 + IDB 非同期 + LS ミラー
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function storageSet(key, value) {
  if (!key) return false;
  const str = value === undefined || value === null ? '' : String(value);

  keyIndex.add(key);
  memoryCache.set(key, str);

  if (dbInstance) {
    idbPut(dbInstance, key, str).catch((err) => {
      console.error('[storageAdapter] IndexedDB put failed:', key, err);
    });
  }

  tryMirrorLocalStorage(key, str);
  return true;
}

/**
 * キー完全削除（メモリ + IDB + LS）
 * @param {string} key
 * @returns {boolean}
 */
export function storageRemove(key) {
  if (!key) return false;
  memoryCache.delete(key);
  keyIndex.delete(key);

  if (dbInstance) {
    idbDelete(dbInstance, key).catch((err) => {
      console.error('[storageAdapter] IndexedDB delete failed:', key, err);
    });
  }

  tryRemoveLocalStorage(key);
  return true;
}

/**
 * メモリからのみ外す（IDB・索引は維持＝アーカイブ退避）
 * @param {string} key
 */
export function storagePurgeFromMemory(key) {
  if (!key) return;
  memoryCache.delete(key);
}

/**
 * @param {string[]} keys
 * @returns {number} パージ件数
 */
export function storagePurgeKeysFromMemory(keys) {
  let n = 0;
  (keys || []).forEach((key) => {
    if (memoryCache.has(key)) {
      memoryCache.delete(key);
      n += 1;
    }
  });
  return n;
}

/**
 * IndexedDB から指定キーをメモリへオンデマンド復元
 * @param {string[]} keys
 * @returns {Promise<number>} 新規ハイドレート件数
 */
export async function storageHydrateKeys(keys) {
  if (!keys || keys.length === 0) return 0;
  let loaded = 0;

  for (const key of keys) {
    if (!key || memoryCache.has(key)) continue;
    keyIndex.add(key);

    if (dbInstance) {
      try {
        const val = await idbGet(dbInstance, key);
        if (val !== null) {
          memoryCache.set(key, val);
          loaded += 1;
          continue;
        }
      } catch (e) {
        console.warn('[storageAdapter] hydrate idb get failed:', key, e);
      }
    }

    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        memoryCache.set(key, raw);
        loaded += 1;
      }
    } catch (_) { /* ignore */ }
  }

  return loaded;
}

/**
 * 既知キー一覧（索引ベース・アーカイブ分も含む）
 * @param {string} prefix
 * @returns {string[]}
 */
export function storageKeys(prefix = '') {
  const keys = [];
  keyIndex.forEach((key) => {
    if (!prefix || key.startsWith(prefix)) keys.push(key);
  });
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
 * メモリ上に載っているキーのみ
 * @param {string} prefix
 * @returns {string[]}
 */
export function storageMemoryKeys(prefix = '') {
  const keys = [];
  memoryCache.forEach((_, key) => {
    if (!prefix || key.startsWith(prefix)) keys.push(key);
  });
  return keys.sort();
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function storageMemoryHas(key) {
  return memoryCache.has(key);
}

/**
 * プレフィックス一致キーを完全削除
 * @param {string} prefix
 */
export function storageRemoveByPrefix(prefix) {
  storageKeys(prefix).forEach((key) => storageRemove(key));
}

/**
 * 同期スナップショット（メモリ上のみ — バックアップには storageFullSnapshotAsync を使う）
 * @param {string} prefix
 * @returns {Record<string, string>}
 */
export function storageSnapshot(prefix = KEY_PREFIX) {
  const dump = {};
  storageMemoryKeys(prefix).forEach((key) => {
    if (key === META_MIGRATED) return;
    const val = memoryCache.get(key);
    if (val !== undefined) dump[key] = val;
  });
  return dump;
}

/**
 * バックアップ用: IndexedDB 全件（アーカイブ含む）を非同期取得
 * @param {string} prefix
 * @returns {Promise<Record<string, string>>}
 */
export async function storageFullSnapshotAsync(prefix = KEY_PREFIX) {
  const dump = {};

  if (dbInstance) {
    try {
      const records = await idbGetAll(dbInstance);
      records.forEach((rec) => {
        if (!rec || !rec.key || rec.key === META_MIGRATED) return;
        if (prefix && !rec.key.startsWith(prefix)) return;
        dump[rec.key] = String(rec.value ?? '');
        keyIndex.add(rec.key);
      });
      return dump;
    } catch (e) {
      console.warn('[storageAdapter] full snapshot IDB failed, falling back to memory:', e);
    }
  }

  return { ...storageSnapshot(prefix) };
}

/**
 * @returns {boolean}
 */
export function isStorageReady() {
  return isReady;
}

/**
 * 統計（アーカイブ UI 用）
 * @returns {{ indexCount: number, memoryCount: number, scheduleIndex: number, scheduleMemory: number }}
 */
export function getStorageStats() {
  let scheduleIndex = 0;
  let scheduleMemory = 0;
  keyIndex.forEach((key) => {
    if (key.startsWith(SCHEDULE_PREFIX)) scheduleIndex += 1;
  });
  memoryCache.forEach((_, key) => {
    if (key.startsWith(SCHEDULE_PREFIX)) scheduleMemory += 1;
  });
  return {
    indexCount: keyIndex.size,
    memoryCount: memoryCache.size,
    scheduleIndex,
    scheduleMemory
  };
}

export { SCHEDULE_PREFIX };
