/**
 * 共有マスター「キー単位差分マージ」＆「端末間競合遮断」単体テスト
 * Node.js 標準: node:test / node:assert/strict のみ（外部FWなし）
 *
 * ★本番コード（js/ 以下）は一切変更しない。
 * ★マージ／競合の判定本体は app.js 内の非 export 関数と同一アルゴリズムを
 *   本ファイルに「契約テスト用純粋関数」として移植し検証する。
 * ★storageAdapter の dirtyKeys / 端末ID / dirty抑制は本番 export を直接検証する。
 *
 * 実行: npm test
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─── Node 環境用 localStorage ポリフィル（本番コード非改変のためテスト側のみ） ───
const lsStore = new Map();
globalThis.localStorage = {
  getItem(key) {
    return lsStore.has(key) ? lsStore.get(key) : null;
  },
  setItem(key, value) {
    lsStore.set(String(key), String(value));
  },
  removeItem(key) {
    lsStore.delete(key);
  },
  clear() {
    lsStore.clear();
  },
  key(i) {
    return [...lsStore.keys()][i] ?? null;
  },
  get length() {
    return lsStore.size;
  }
};

const {
  storageSet,
  storageGet,
  storageRemove,
  storageKeys,
  getDeviceClientId,
  getDirtyStorageKeys,
  clearDirtyStorageKeys,
  runWithoutDirtyTracking,
  markStorageKeyDirty,
  DEVICE_CLIENT_ID_KEY
} = await import('../js/core/storageAdapter.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = join(__dirname, '../js/app.js');

beforeEach(() => {
  clearDirtyStorageKeys();
  // テスト用キーのみ掃除（adapter メモリ）
  for (const key of storageKeys('reha_')) {
    if (
      key.startsWith('reha_schedule_')
      || key === 'reha_patients_master'
      || key === 'reha_audit_logs'
      || key === 'reha_therapists_master'
    ) {
      runWithoutDirtyTracking(() => storageRemove(key));
    }
  }
  clearDirtyStorageKeys();
});

// ═══════════════════════════════════════════════════════════
// app.js と同一契約の純粋アルゴリズム（本番非 export のためテスト側に移植）
// ═══════════════════════════════════════════════════════════

/**
 * @param {object|null|undefined} prev
 * @param {string} deviceId
 * @param {number} nowMs
 */
function bumpKeyMeta(prev, deviceId, nowMs) {
  const prevRev = prev && Number.isFinite(Number(prev.rev)) ? Number(prev.rev) : 0;
  return {
    deviceId,
    updatedAt: nowMs,
    rev: prevRev + 1
  };
}

/**
 * 監査ログ配列マージ（app.js mergeAuditLogStorageStrings と同契約）
 * @param {string|null|undefined} remoteRaw
 * @param {string|null|undefined} localRaw
 * @returns {string}
 */
function mergeAuditLogStorageStrings(remoteRaw, localRaw) {
  let remote = [];
  let local = [];
  try {
    if (typeof remoteRaw === 'string' && remoteRaw) {
      const p = JSON.parse(remoteRaw);
      if (Array.isArray(p)) remote = p;
    }
  } catch (_) { /* ignore */ }
  try {
    if (typeof localRaw === 'string' && localRaw) {
      const p = JSON.parse(localRaw);
      if (Array.isArray(p)) local = p;
    }
  } catch (_) { /* ignore */ }

  const byId = new Map();
  [...remote, ...local].forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return;
    const id = entry.id != null
      ? String(entry.id)
      : `__idx_${idx}_${entry.ts || entry.createdAt || ''}`;
    byId.set(id, entry);
  });
  return JSON.stringify(Array.from(byId.values()));
}

/**
 * pull 時の孤立キー抽出（全消去せず、マスターに無い非保護キーのみ）
 * app.js applySharedMasterDump の削除候補ロジックと同契約
 * @param {string[]} localKeys
 * @param {Record<string, string>} masterStorage
 * @param {(key: string) => boolean} isProtected
 * @returns {string[]}
 */
function listOrphanKeysForInPlacePull(localKeys, masterStorage, isProtected) {
  const masterKeySet = new Set(Object.keys(masterStorage || {}));
  return localKeys.filter((key) => {
    if (masterKeySet.has(key)) return false;
    if (isProtected(key)) return false;
    return true;
  });
}

function isSharedSyncProtectedLocalKey(key) {
  if (!key || typeof key !== 'string') return true;
  if (key.startsWith('reha_autobackup_')) return true;
  if (key.startsWith('reha_backup_folder_')) return true;
  if (key.startsWith('reha_facility_profile')) return true;
  if (key === 'reha_local_operator') return true;
  if (key === 'reha_audit_logs') return true;
  if (key === 'reha_last_shared_sync_timestamp') return true;
  if (key === 'reha_shared_key_meta_snapshot') return true;
  return false;
}

/**
 * push 差分マージのコア判定（app.js pushLocalDumpToSharedMaster のマージ部と同契約）
 * @param {object} args
 */
function computeSharedMasterDiffMerge(args) {
  const {
    deviceId,
    dirtyKeys,
    remoteStorage,
    remoteKeyMeta,
    localStorageMap,
    lastSharedSyncTimestampMs,
    nowMs,
    force = false
  } = args;

  if ((!dirtyKeys || dirtyKeys.length === 0) && !force) {
    return { skipped: true, conflict: false, conflicts: [], mergedStorage: null, mergedKeyMeta: null };
  }

  const conflicts = [];
  for (const key of dirtyKeys) {
    if (key === 'reha_audit_logs') continue;
    const remoteMeta = remoteKeyMeta[key];
    if (!remoteMeta || typeof remoteMeta !== 'object') continue;
    const remoteDevice = String(remoteMeta.deviceId || '');
    const remoteUpdated = Number(remoteMeta.updatedAt) || 0;
    if (!remoteDevice || remoteDevice === deviceId) continue;
    if (remoteUpdated > lastSharedSyncTimestampMs) {
      conflicts.push({
        key,
        remoteDeviceId: remoteDevice,
        remoteUpdatedAt: remoteUpdated
      });
    }
  }

  if (conflicts.length > 0 && !force) {
    return {
      skipped: false,
      conflict: true,
      conflicts,
      mergedStorage: null,
      mergedKeyMeta: null
    };
  }

  const mergedStorage = { ...remoteStorage };
  const mergedKeyMeta = { ...remoteKeyMeta };

  for (const key of dirtyKeys) {
    if (key.startsWith('reha_autobackup_') || key.startsWith('reha_backup_folder_')) continue;

    if (key === 'reha_audit_logs') {
      const localRaw = localStorageMap[key] ?? null;
      mergedStorage[key] = mergeAuditLogStorageStrings(remoteStorage[key], localRaw);
      mergedKeyMeta[key] = bumpKeyMeta(mergedKeyMeta[key], deviceId, nowMs);
      continue;
    }

    const localVal = Object.prototype.hasOwnProperty.call(localStorageMap, key)
      ? localStorageMap[key]
      : null;
    if (localVal === null || localVal === undefined) {
      delete mergedStorage[key];
      delete mergedKeyMeta[key];
      continue;
    }
    mergedStorage[key] = localVal;
    mergedKeyMeta[key] = bumpKeyMeta(mergedKeyMeta[key], deviceId, nowMs);
  }

  return {
    skipped: false,
    conflict: false,
    conflicts: [],
    mergedStorage,
    mergedKeyMeta
  };
}

// ═══════════════════════════════════════════════════════════
// 0. 本番 app.js にアルゴリズムが残っていることのソース契約ガード
// ═══════════════════════════════════════════════════════════
describe('app.js ソース契約ガード（本番非改変の前提確認）', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');

  test('差分マージ・dirtyKeys スキップ・競合判定・監査除外が実装されている', () => {
    assert.match(src, /dirtyKeys\.length === 0/);
    assert.match(src, /remoteUpdated > lastSharedSyncTimestampMs/);
    assert.match(src, /reha_audit_logs/);
    assert.match(src, /_keyMeta/);
    assert.match(src, /bumpKeyMeta/);
    assert.match(src, /runWithoutDirtyTracking/);
    assert.doesNotMatch(src, /storageRemoveByPrefix\('reha_'/);
  });
});

// ═══════════════════════════════════════════════════════════
// storageAdapter: dirtyKeys / 端末ID
// ═══════════════════════════════════════════════════════════
describe('storageAdapter: 端末IDと dirtyKeys 追跡', () => {
  test('getDeviceClientId は PC- で始まるIDを永続化する', () => {
    lsStore.delete(DEVICE_CLIENT_ID_KEY);
    const id1 = getDeviceClientId();
    const id2 = getDeviceClientId();
    assert.match(id1, /^PC-[a-z0-9]+$/i);
    assert.equal(id1, id2);
    assert.equal(localStorage.getItem(DEVICE_CLIENT_ID_KEY), id1);
  });

  test('storageSet は dirtyKeys に登録する', () => {
    clearDirtyStorageKeys();
    storageSet('reha_schedule_2026-11-06', '{"A":{}}');
    assert.deepEqual(getDirtyStorageKeys(), ['reha_schedule_2026-11-06']);
  });

  test('runWithoutDirtyTracking 中の書込は dirty にならない', () => {
    clearDirtyStorageKeys();
    runWithoutDirtyTracking(() => {
      storageSet('reha_patients_master', '[]');
    });
    assert.deepEqual(getDirtyStorageKeys(), []);
  });

  test('clearDirtyStorageKeys で空になる', () => {
    markStorageKeyDirty('reha_schedule_2026-11-06');
    assert.ok(getDirtyStorageKeys().length >= 1);
    clearDirtyStorageKeys();
    assert.deepEqual(getDirtyStorageKeys(), []);
  });
});

// ═══════════════════════════════════════════════════════════
// 1. スマート差分マージ（他日・他キー保護）
// ═══════════════════════════════════════════════════════════
describe('スマート差分マージ（他日・他キーの完全保護）', () => {
  test('PC-A が 11/6 のみ dirty のとき 11/7 と患者台帳は1文字も欠損しない', () => {
    const remoteStorage = {
      'reha_schedule_2026-11-06': 'SERVER_NOV6_OLD',
      'reha_schedule_2026-11-07': 'SERVER_NOV7_KEEP_EXACT',
      reha_patients_master: 'SERVER_PATIENTS_KEEP_EXACT'
    };
    const remoteKeyMeta = {
      'reha_schedule_2026-11-06': { deviceId: 'PC-server', updatedAt: 1000, rev: 2 },
      'reha_schedule_2026-11-07': { deviceId: 'PC-server', updatedAt: 1000, rev: 1 },
      reha_patients_master: { deviceId: 'PC-server', updatedAt: 1000, rev: 3 }
    };
    const result = computeSharedMasterDiffMerge({
      deviceId: 'PC-A',
      dirtyKeys: ['reha_schedule_2026-11-06'],
      remoteStorage,
      remoteKeyMeta,
      localStorageMap: {
        'reha_schedule_2026-11-06': 'PC_A_NOV6_NEW'
      },
      lastSharedSyncTimestampMs: 2000,
      nowMs: 3000
    });

    assert.equal(result.conflict, false);
    assert.equal(result.skipped, false);
    assert.equal(result.mergedStorage['reha_schedule_2026-11-06'], 'PC_A_NOV6_NEW');
    assert.equal(result.mergedStorage['reha_schedule_2026-11-07'], 'SERVER_NOV7_KEEP_EXACT');
    assert.equal(result.mergedStorage.reha_patients_master, 'SERVER_PATIENTS_KEEP_EXACT');
    assert.equal(result.mergedKeyMeta['reha_schedule_2026-11-06'].deviceId, 'PC-A');
    assert.equal(result.mergedKeyMeta['reha_schedule_2026-11-06'].rev, 3);
    assert.equal(result.mergedKeyMeta['reha_schedule_2026-11-07'].rev, 1);
    assert.equal(result.mergedKeyMeta.reha_patients_master.rev, 3);
  });
});

// ═══════════════════════════════════════════════════════════
// 2. 同時競合の遮断
// ═══════════════════════════════════════════════════════════
describe('先行更新による同時競合の遮断', () => {
  test('最終同期10:00・PC-Bが10:05に同キー更新済み → PC-A push は conflict', () => {
    const t1000 = Date.parse('2026-11-06T10:00:00.000Z');
    const t1005 = Date.parse('2026-11-06T10:05:00.000Z');
    const result = computeSharedMasterDiffMerge({
      deviceId: 'PC-A',
      dirtyKeys: ['reha_schedule_2026-11-06'],
      remoteStorage: {
        'reha_schedule_2026-11-06': 'FROM_PC_B'
      },
      remoteKeyMeta: {
        'reha_schedule_2026-11-06': {
          deviceId: 'PC-B',
          updatedAt: t1005,
          rev: 5
        }
      },
      localStorageMap: {
        'reha_schedule_2026-11-06': 'FROM_PC_A'
      },
      lastSharedSyncTimestampMs: t1000,
      nowMs: Date.parse('2026-11-06T10:10:00.000Z')
    });

    assert.equal(result.conflict, true);
    assert.equal(result.mergedStorage, null);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].key, 'reha_schedule_2026-11-06');
    assert.equal(result.conflicts[0].remoteDeviceId, 'PC-B');
    assert.equal(result.conflicts[0].remoteUpdatedAt, t1005);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. 自己端末の連続更新は許容
// ═══════════════════════════════════════════════════════════
describe('自己端末による連続更新の許容', () => {
  test('remote.deviceId が自端末なら時刻が新しくても競合せず rev+1', () => {
    const tPull = Date.parse('2026-11-06T10:00:00.000Z');
    const tLater = Date.parse('2026-11-06T12:00:00.000Z');
    const nowMs = Date.parse('2026-11-06T12:05:00.000Z');
    const result = computeSharedMasterDiffMerge({
      deviceId: 'PC-A',
      dirtyKeys: ['reha_schedule_2026-11-06'],
      remoteStorage: {
        'reha_schedule_2026-11-06': 'OWN_PREV'
      },
      remoteKeyMeta: {
        'reha_schedule_2026-11-06': {
          deviceId: 'PC-A',
          updatedAt: tLater,
          rev: 7
        }
      },
      localStorageMap: {
        'reha_schedule_2026-11-06': 'OWN_NEXT'
      },
      lastSharedSyncTimestampMs: tPull,
      nowMs
    });

    assert.equal(result.conflict, false);
    assert.equal(result.mergedStorage['reha_schedule_2026-11-06'], 'OWN_NEXT');
    assert.equal(result.mergedKeyMeta['reha_schedule_2026-11-06'].rev, 8);
    assert.equal(result.mergedKeyMeta['reha_schedule_2026-11-06'].deviceId, 'PC-A');
    assert.equal(result.mergedKeyMeta['reha_schedule_2026-11-06'].updatedAt, nowMs);
  });
});

// ═══════════════════════════════════════════════════════════
// 4. 日付違いの並行更新は非競合
// ═══════════════════════════════════════════════════════════
describe('他キー（日付違い）の並行更新における非競合', () => {
  test('PC-A=11/6 dirty・PC-Bが11/7更新 → 衝突せず共存', () => {
    const tPull = Date.parse('2026-11-06T09:00:00.000Z');
    const tB = Date.parse('2026-11-06T09:30:00.000Z');
    const nowMs = Date.parse('2026-11-06T09:40:00.000Z');
    const result = computeSharedMasterDiffMerge({
      deviceId: 'PC-A',
      dirtyKeys: ['reha_schedule_2026-11-06'],
      remoteStorage: {
        'reha_schedule_2026-11-06': 'OLD_6',
        'reha_schedule_2026-11-07': 'FROM_PC_B_7'
      },
      remoteKeyMeta: {
        'reha_schedule_2026-11-06': { deviceId: 'PC-A', updatedAt: tPull, rev: 1 },
        'reha_schedule_2026-11-07': { deviceId: 'PC-B', updatedAt: tB, rev: 4 }
      },
      localStorageMap: {
        'reha_schedule_2026-11-06': 'FROM_PC_A_6'
      },
      lastSharedSyncTimestampMs: tPull,
      nowMs
    });

    assert.equal(result.conflict, false);
    assert.equal(result.mergedStorage['reha_schedule_2026-11-06'], 'FROM_PC_A_6');
    assert.equal(result.mergedStorage['reha_schedule_2026-11-07'], 'FROM_PC_B_7');
    assert.equal(result.mergedKeyMeta['reha_schedule_2026-11-07'].deviceId, 'PC-B');
    assert.equal(result.mergedKeyMeta['reha_schedule_2026-11-07'].rev, 4);
  });
});

// ═══════════════════════════════════════════════════════════
// 5. dirtyKeys 空ならスキップ
// ═══════════════════════════════════════════════════════════
describe('変更なし（dirtyKeys 空）のプッシュスキップ', () => {
  test('dirtyKeys=[] なら skipped かつサーバー相当データは触らない', () => {
    const remoteStorage = {
      reha_patients_master: 'DO_NOT_TOUCH'
    };
    const result = computeSharedMasterDiffMerge({
      deviceId: 'PC-A',
      dirtyKeys: [],
      remoteStorage,
      remoteKeyMeta: {
        reha_patients_master: { deviceId: 'PC-B', updatedAt: 9999, rev: 9 }
      },
      localStorageMap: {},
      lastSharedSyncTimestampMs: 1000,
      nowMs: 2000
    });

    assert.equal(result.skipped, true);
    assert.equal(result.conflict, false);
    assert.equal(result.mergedStorage, null);
  });
});

// ═══════════════════════════════════════════════════════════
// 6. 監査ログ配列マージ（競合対象外）
// ═══════════════════════════════════════════════════════════
describe('監査ログ（reha_audit_logs）の配列マージ', () => {
  test('監査は競合遮断せず remote+local を id 重複なく合体', () => {
    const tPull = 1000;
    const remoteAudit = JSON.stringify([
      { id: 'a1', ts: 1, msg: 'remote-1' },
      { id: 'a2', ts: 2, msg: 'remote-2' }
    ]);
    const localAudit = JSON.stringify([
      { id: 'a2', ts: 2, msg: 'local-dup-a2' },
      { id: 'a3', ts: 3, msg: 'local-3' }
    ]);

    // 他端末が監査を更新していても競合にしない
    const result = computeSharedMasterDiffMerge({
      deviceId: 'PC-A',
      dirtyKeys: ['reha_audit_logs'],
      remoteStorage: {
        reha_audit_logs: remoteAudit,
        'reha_schedule_2026-11-06': 'KEEP'
      },
      remoteKeyMeta: {
        reha_audit_logs: { deviceId: 'PC-B', updatedAt: 99999, rev: 5 },
        'reha_schedule_2026-11-06': { deviceId: 'PC-B', updatedAt: 500, rev: 1 }
      },
      localStorageMap: {
        reha_audit_logs: localAudit
      },
      lastSharedSyncTimestampMs: tPull,
      nowMs: 2000
    });

    assert.equal(result.conflict, false);
    const merged = JSON.parse(result.mergedStorage.reha_audit_logs);
    const ids = merged.map((e) => e.id).sort();
    assert.deepEqual(ids, ['a1', 'a2', 'a3']);
    assert.equal(result.mergedStorage['reha_schedule_2026-11-06'], 'KEEP');
  });

  test('mergeAuditLogStorageStrings 単体: 重複 id は後勝ちで1件', () => {
    const out = mergeAuditLogStorageStrings(
      JSON.stringify([{ id: 'x', msg: 'r' }]),
      JSON.stringify([{ id: 'x', msg: 'l' }, { id: 'y', msg: 'l2' }])
    );
    const arr = JSON.parse(out);
    assert.equal(arr.length, 2);
    assert.equal(arr.find((e) => e.id === 'x').msg, 'l');
  });
});

// ═══════════════════════════════════════════════════════════
// 7. 孤立キー抽出（インプレース・全消去しない）
// ═══════════════════════════════════════════════════════════
describe('孤立キーの安全な差分抽出（インプレース更新の保証）', () => {
  test('マスターに無いキーだけが削除候補（保護キー・存在キーは残す）', () => {
    const localKeys = [
      'reha_schedule_2026-11-06',
      'reha_schedule_2026-11-07',
      'reha_patients_master',
      'reha_audit_logs',
      'reha_local_operator',
      'reha_orphaned_old_key'
    ];
    const masterStorage = {
      'reha_schedule_2026-11-06': '{}',
      reha_patients_master: '[]',
      reha_audit_logs: '[]'
    };
    const orphans = listOrphanKeysForInPlacePull(
      localKeys,
      masterStorage,
      isSharedSyncProtectedLocalKey
    );
    assert.deepEqual(orphans.sort(), [
      'reha_orphaned_old_key',
      'reha_schedule_2026-11-07'
    ].sort());
    assert.ok(!orphans.includes('reha_patients_master'));
    assert.ok(!orphans.includes('reha_audit_logs'));
    assert.ok(!orphans.includes('reha_local_operator'));
  });

  test('本番 adapter で pull 相当の抑制書込→孤立削除しても removeByPrefix 相当の全滅にならない', () => {
    runWithoutDirtyTracking(() => {
      storageSet('reha_schedule_2026-11-06', 'KEEP');
      storageSet('reha_schedule_2026-11-07', 'ORPHAN');
      storageSet('reha_patients_master', 'KEEP_PATIENTS');
    });
    clearDirtyStorageKeys();

    const masterStorage = {
      'reha_schedule_2026-11-06': 'FROM_MASTER_6',
      reha_patients_master: 'FROM_MASTER_P'
    };
    const orphans = listOrphanKeysForInPlacePull(
      storageKeys('reha_'),
      masterStorage,
      isSharedSyncProtectedLocalKey
    );

    runWithoutDirtyTracking(() => {
      storageSet('reha_schedule_2026-11-06', masterStorage['reha_schedule_2026-11-06']);
      storageSet('reha_patients_master', masterStorage.reha_patients_master);
      for (const key of orphans) {
        if (key === 'reha_schedule_2026-11-07' || key === 'reha_orphaned_old_key') {
          storageRemove(key);
        }
      }
    });

    assert.equal(storageGet('reha_schedule_2026-11-06'), 'FROM_MASTER_6');
    assert.equal(storageGet('reha_patients_master'), 'FROM_MASTER_P');
    assert.equal(storageGet('reha_schedule_2026-11-07'), null);
    assert.deepEqual(getDirtyStorageKeys(), []);
  });
});

// ═══════════════════════════════════════════════════════════
// 追加: bumpKeyMeta / 複合シナリオ
// ═══════════════════════════════════════════════════════════
describe('世代メタと複合シナリオ', () => {
  test('bumpKeyMeta は prev.rev+1（未定義は 1）', () => {
    assert.deepEqual(bumpKeyMeta(null, 'PC-A', 100), {
      deviceId: 'PC-A',
      updatedAt: 100,
      rev: 1
    });
    assert.equal(bumpKeyMeta({ rev: 5, deviceId: 'PC-B' }, 'PC-A', 200).rev, 6);
  });

  test('患者台帳 dirty でも他日時間割は保護、競合なしなら台帳だけ更新', () => {
    const result = computeSharedMasterDiffMerge({
      deviceId: 'PC-A',
      dirtyKeys: ['reha_patients_master'],
      remoteStorage: {
        'reha_schedule_2026-11-06': 'S6',
        'reha_schedule_2026-11-07': 'S7',
        reha_patients_master: 'OLD_P'
      },
      remoteKeyMeta: {
        'reha_schedule_2026-11-06': { deviceId: 'PC-B', updatedAt: 50, rev: 2 },
        'reha_schedule_2026-11-07': { deviceId: 'PC-B', updatedAt: 50, rev: 2 },
        reha_patients_master: { deviceId: 'PC-A', updatedAt: 40, rev: 1 }
      },
      localStorageMap: { reha_patients_master: 'NEW_P' },
      lastSharedSyncTimestampMs: 100,
      nowMs: 200
    });
    assert.equal(result.conflict, false);
    assert.equal(result.mergedStorage.reha_patients_master, 'NEW_P');
    assert.equal(result.mergedStorage['reha_schedule_2026-11-06'], 'S6');
    assert.equal(result.mergedStorage['reha_schedule_2026-11-07'], 'S7');
  });
});
