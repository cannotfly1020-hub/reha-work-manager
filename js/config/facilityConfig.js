// js/config/facilityConfig.js
// 多施設展開（フェーズ1）: 施設プロファイル基盤
// ★Windows/Electron 向け: LocalStorage 書込検証・診断ログ・確実な再読込

const STORAGE_KEY = 'reha_facility_profile_id';
const STORAGE_BACKUP_KEY = 'reha_facility_profile_id_backup';
const DEFAULT_FACILITY_ID = 'HOSPITAL_A';
const LOG_PREFIX = '[facilityConfig]';

/**
 * 施設プロファイルマスター
 * @type {Record<string, { id: string, name: string, shortName: string, features: Record<string, boolean> }>}
 */
export const FACILITY_PROFILES = {
  HOSPITAL_A: {
    id: 'HOSPITAL_A',
    name: '伊藤内科（外来予約・物品あり）',
    shortName: '伊藤内科',
    features: {
      hasOutpatientReservation: true,   // 外来予約あり
      hasInventoryManagement: true,     // 物品管理あり
      hasAnalgesia: true,               // 消炎鎮痛あり
      hasDialysisReha: false,
      hasOrthoticsBilling: false
    }
  },
  HOSPITAL_B: {
    id: 'HOSPITAL_B',
    name: 'いとう腎クリニック（透析運動加算・装具採型あり）',
    shortName: 'いとう腎クリニック',
    features: {
      hasOutpatientReservation: false,  // 外来予約なし
      hasInventoryManagement: false,    // 物品管理なし
      hasAnalgesia: true,               // 消炎鎮痛あり
      hasDialysisReha: true,            // 透析時運動指導等加算あり
      hasOrthoticsBilling: true         // 装具採型採寸料あり
    }
  }
};

/**
 * 実行環境の簡易診断情報
 * @returns {{ isDesktop: boolean, platform: string, hasElectronBridge: boolean, href: string }}
 */
function getRuntimeDiag() {
  const bridge = (typeof window !== 'undefined')
    ? (window.desktopApp || window.electronBackup || null)
    : null;
  return {
    isDesktop: Boolean(bridge?.isDesktop),
    platform: String(bridge?.platform || (typeof navigator !== 'undefined' ? navigator.platform : 'unknown')),
    hasElectronBridge: Boolean(bridge),
    href: (typeof window !== 'undefined' && window.location) ? String(window.location.href) : ''
  };
}

/**
 * LocalStorage / sessionStorage から生値を安全に読む
 * @param {Storage|null|undefined} store
 * @param {string} key
 * @returns {{ ok: boolean, value: string|null, error: string|null }}
 */
function safeGetItem(store, key) {
  try {
    if (!store || typeof store.getItem !== 'function') {
      return { ok: false, value: null, error: 'store_unavailable' };
    }
    return { ok: true, value: store.getItem(key), error: null };
  } catch (err) {
    return { ok: false, value: null, error: String(err?.name || err?.message || err) };
  }
}

/**
 * LocalStorage / sessionStorage へ安全に書く
 * @param {Storage|null|undefined} store
 * @param {string} key
 * @param {string} value
 * @returns {{ ok: boolean, error: string|null }}
 */
function safeSetItem(store, key, value) {
  try {
    if (!store || typeof store.setItem !== 'function') {
      return { ok: false, error: 'store_unavailable' };
    }
    store.setItem(key, value);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: String(err?.name || err?.message || err) };
  }
}

/**
 * LocalStorage から現在の施設IDを取得。未設定時は HOSPITAL_A。
 * @returns {string}
 */
export function getCurrentFacilityId() {
  const runtime = getRuntimeDiag();
  let raw = null;
  let source = 'default';

  try {
    const ls = safeGetItem(
      (typeof localStorage !== 'undefined') ? localStorage : null,
      STORAGE_KEY
    );
    console.info(`${LOG_PREFIX} getCurrentFacilityId: localStorage.getItem('${STORAGE_KEY}') =>`, {
      ok: ls.ok,
      value: ls.value,
      error: ls.error,
      runtime
    });

    if (ls.ok && ls.value && FACILITY_PROFILES[ls.value]) {
      raw = ls.value;
      source = 'localStorage';
    } else {
      // バックアップ（sessionStorage）フォールバック — 診断・Windows書込遅延対策
      const ss = safeGetItem(
        (typeof sessionStorage !== 'undefined') ? sessionStorage : null,
        STORAGE_KEY
      );
      console.info(`${LOG_PREFIX} getCurrentFacilityId: sessionStorage fallback =>`, {
        ok: ss.ok,
        value: ss.value,
        error: ss.error
      });
      if (ss.ok && ss.value && FACILITY_PROFILES[ss.value]) {
        raw = ss.value;
        source = 'sessionStorage';
        // localStorage へ再同期を試行
        const rewrite = safeSetItem(
          (typeof localStorage !== 'undefined') ? localStorage : null,
          STORAGE_KEY,
          ss.value
        );
        console.info(`${LOG_PREFIX} re-sync session → localStorage:`, rewrite);
      }
    }

    // URLクエリ診断（ハードリロード後の期待値）
    try {
      if (typeof window !== 'undefined' && window.location?.search) {
        const sp = new URLSearchParams(window.location.search);
        const urlFacility = sp.get('_facility');
        if (urlFacility) {
          console.info(`${LOG_PREFIX} URL _facility=`, urlFacility, 'resolved=', raw || DEFAULT_FACILITY_ID, 'source=', source);
        }
      }
    } catch (_) { /* ignore */ }
  } catch (err) {
    console.error(`${LOG_PREFIX} getCurrentFacilityId unexpected error:`, err);
  }

  const resolved = (raw && FACILITY_PROFILES[raw]) ? raw : DEFAULT_FACILITY_ID;
  console.info(`${LOG_PREFIX} getCurrentFacilityId resolved:`, { resolved, source });
  return resolved;
}

/**
 * 現在の施設プロファイルオブジェクトを返す。
 * @returns {{ id: string, name: string, shortName: string, features: Record<string, boolean> }}
 */
export function getCurrentFacilityProfile() {
  const id = getCurrentFacilityId();
  return FACILITY_PROFILES[id] || FACILITY_PROFILES[DEFAULT_FACILITY_ID];
}

/**
 * 指定機能フラグが現在の施設で有効か。
 * @param {string} featureKey
 * @returns {boolean}
 */
export function isFeatureEnabled(featureKey) {
  const profile = getCurrentFacilityProfile();
  return Boolean(profile?.features?.[featureKey]);
}

/**
 * 施設プロファイルIDを LocalStorage に保存する（書込直後の読戻し検証付き）。
 * @param {string} facilityId
 * @returns {boolean} 保存かつ検証成功時 true
 */
export function setFacilityProfile(facilityId) {
  const runtime = getRuntimeDiag();
  console.info(`${LOG_PREFIX} setFacilityProfile called:`, { facilityId, runtime });

  if (!FACILITY_PROFILES[facilityId]) {
    console.warn(`${LOG_PREFIX} setFacilityProfile REJECTED: unknown id`, facilityId);
    return false;
  }

  const lsWrite = safeSetItem(
    (typeof localStorage !== 'undefined') ? localStorage : null,
    STORAGE_KEY,
    facilityId
  );
  console.info(`${LOG_PREFIX} localStorage.setItem result:`, lsWrite);

  // sessionStorage バックアップ（ディスクフラッシュ前リロード対策）
  const ssWrite = safeSetItem(
    (typeof sessionStorage !== 'undefined') ? sessionStorage : null,
    STORAGE_KEY,
    facilityId
  );
  console.info(`${LOG_PREFIX} sessionStorage.setItem (backup) result:`, ssWrite);

  // 第2バックアップキー
  safeSetItem(
    (typeof localStorage !== 'undefined') ? localStorage : null,
    STORAGE_BACKUP_KEY,
    facilityId
  );

  // 書込直後の読戻し検証
  const lsRead = safeGetItem(
    (typeof localStorage !== 'undefined') ? localStorage : null,
    STORAGE_KEY
  );
  const verified = Boolean(lsWrite.ok && lsRead.ok && lsRead.value === facilityId);
  console.info(`${LOG_PREFIX} post-write verify:`, {
    expected: facilityId,
    readBack: lsRead.value,
    verified,
    lsWriteOk: lsWrite.ok,
    lsWriteError: lsWrite.error,
    lsReadOk: lsRead.ok,
    lsReadError: lsRead.error,
    ssWriteOk: ssWrite.ok
  });

  if (!verified) {
    console.error(`${LOG_PREFIX} setFacilityProfile FAILED verification`, {
      facilityId,
      lsWrite,
      lsRead,
      ssWrite
    });
    // sessionStorage だけ成功していれば、暫定 true（リロード後フォールバックで復元）
    if (ssWrite.ok) {
      console.warn(`${LOG_PREFIX} localStorage verify failed but sessionStorage backup OK — returning true with warning`);
      return true;
    }
    return false;
  }

  console.info(`${LOG_PREFIX} setFacilityProfile SUCCESS:`, facilityId);
  return true;
}

/**
 * 施設切替後の確実な画面再読込（キャッシュ回避・書込検証後）
 * Windows/Electron では location.reload() のレースを避けるため、
 * タイムスタンプ付き URL へ replace する。
 * @param {{ delayMs?: number, expectedId?: string }} [opts]
 */
// モジュール読込時の起動診断（リロード後の DevTools 確認用）
if (typeof window !== 'undefined') {
  try {
    const bootLs = safeGetItem(
      (typeof localStorage !== 'undefined') ? localStorage : null,
      STORAGE_KEY
    );
    const bootSs = safeGetItem(
      (typeof sessionStorage !== 'undefined') ? sessionStorage : null,
      STORAGE_KEY
    );
    console.info(`${LOG_PREFIX} MODULE_LOAD boot snapshot:`, {
      localStorage: bootLs,
      sessionStorage: bootSs,
      runtime: getRuntimeDiag()
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} MODULE_LOAD diagnostic failed:`, err);
  }
}

export function reloadForFacilityProfileChange(opts = {}) {
  const delayMs = Number(opts.delayMs) >= 0 ? Number(opts.delayMs) : 700;
  const expectedId = opts.expectedId || getCurrentFacilityId();
  const runtime = getRuntimeDiag();

  console.info(`${LOG_PREFIX} reloadForFacilityProfileChange scheduled:`, {
    delayMs,
    expectedId,
    runtime
  });

  // 最終確認ログ
  const ls = safeGetItem(
    (typeof localStorage !== 'undefined') ? localStorage : null,
    STORAGE_KEY
  );
  const ss = safeGetItem(
    (typeof sessionStorage !== 'undefined') ? sessionStorage : null,
    STORAGE_KEY
  );
  console.info(`${LOG_PREFIX} pre-reload storage snapshot:`, {
    localStorage: ls,
    sessionStorage: ss,
    expectedId
  });

  setTimeout(() => {
    // ナビ直前にもう一度確認
    const ls2 = safeGetItem(
      (typeof localStorage !== 'undefined') ? localStorage : null,
      STORAGE_KEY
    );
    console.info(`${LOG_PREFIX} immediate-before-navigate localStorage:`, ls2);

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('_facility', expectedId);
      url.searchParams.set('_facilityReload', String(Date.now()));
      // キャッシュ回避のため replace（履歴に汚さない）
      console.info(`${LOG_PREFIX} navigating via location.replace:`, url.toString());
      window.location.replace(url.toString());
    } catch (err) {
      console.error(`${LOG_PREFIX} location.replace failed, fallback reload:`, err);
      try {
        window.location.reload();
      } catch (err2) {
        console.error(`${LOG_PREFIX} location.reload also failed:`, err2);
        // Electron ブリッジに reload があれば試す（現状 preload には未実装）
        try {
          const bridge = window.desktopApp || window.electronBackup;
          if (bridge && typeof bridge.reload === 'function') {
            console.info(`${LOG_PREFIX} calling bridge.reload()`);
            bridge.reload();
          }
        } catch (err3) {
          console.error(`${LOG_PREFIX} bridge.reload failed:`, err3);
        }
      }
    }
  }, delayMs);
}
