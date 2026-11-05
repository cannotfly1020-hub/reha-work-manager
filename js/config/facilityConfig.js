// js/config/facilityConfig.js
// 多施設展開（フェーズ1）: 施設プロファイル基盤
// 施設ごとの機能ON/OFFを管理する。既存モジュールからは未接続（病院A動作を維持）。

const STORAGE_KEY = 'reha_facility_profile_id';
const DEFAULT_FACILITY_ID = 'HOSPITAL_A';

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
 * LocalStorage から現在の施設IDを取得。未設定時は HOSPITAL_A。
 * @returns {string}
 */
export function getCurrentFacilityId() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && FACILITY_PROFILES[raw]) return raw;
  } catch (_) {
    /* LocalStorage 不可環境ではデフォルト */
  }
  return DEFAULT_FACILITY_ID;
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
 * 施設プロファイルIDを LocalStorage に保存する。
 * @param {string} facilityId
 * @returns {boolean} 保存成功時 true
 */
export function setFacilityProfile(facilityId) {
  if (!FACILITY_PROFILES[facilityId]) return false;
  try {
    localStorage.setItem(STORAGE_KEY, facilityId);
    return true;
  } catch (_) {
    return false;
  }
}
