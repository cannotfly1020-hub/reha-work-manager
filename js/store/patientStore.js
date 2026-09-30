/**
 * @file patientStore.js
 * @description 患者マスター情報（入院日・早期加算起算日・発症日・疾患区分等）のローカル保存・管理
 * 
 * すべてのデータはブラウザの LocalStorage に暗号化/安全保存され、
 * 外部サーバーやクラウドへの通信は一切行いません（完全オフライン）。
 */

import { normalizePatientId, safeParseInt } from '../core/dataNormalizer.js';

// LocalStorageのキープレフィックス
const STORAGE_KEY_PATIENTS = 'reha_manager_patients_v1';

/**
 * 初期マスターテンプレート（記号 a 〜 y の標準枠）
 * 受付提出ファイル（入院・外来シート）の見出し記号に対応
 */
const DEFAULT_PATIENT_SEEDS = [
  // 入院1（運動器Ⅱ）
  { id: 'a', name: '患者A', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'b', name: '患者B', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'c', name: '患者C', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'd', name: '患者D', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'e', name: '患者E', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'f', name: '患者F', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'g', name: '患者G', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'h', name: '患者H', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'i', name: '患者I', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  { id: 'j', name: '患者J', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1' },
  // 入院(2)（脳血管Ⅲ等）
  { id: 'k', name: '患者K', diseaseType: 'CEREBROVASCULAR', category: 'inpatient_2' },
  { id: 'l', name: '患者L', diseaseType: 'CEREBROVASCULAR', category: 'inpatient_2' },
  { id: 'm', name: '患者M', diseaseType: 'CEREBROVASCULAR', category: 'inpatient_2' },
  // 入院（維持期介護）
  { id: 'n', name: '患者N', diseaseType: 'LOCOMOTIVE', category: 'inpatient_maintenance' },
  { id: 'o', name: '患者O', diseaseType: 'LOCOMOTIVE', category: 'inpatient_maintenance' },
  // 外来
  { id: 'p', name: '外来P', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 'q', name: '外来Q', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 'r', name: '外来R', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 's', name: '外来S', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 't', name: '外来T', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 'u', name: '外来U', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 'v', name: '外来V', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 'w', name: '外来W', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 'x', name: '外来X', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
  { id: 'y', name: '外来Y', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1' },
];


/**
 * 全患者リストを取得（LocalStorageから読み出し、未初期化時はシードデータを保存）
 * @returns {Array<Object>} 患者オブジェクトの配列
 */
export function getAllPatients() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PATIENTS);
    if (!raw) {
      // 初回起動時はデフォルトマスターを保存して返却
      saveAllPatients(DEFAULT_PATIENT_SEEDS);
      return DEFAULT_PATIENT_SEEDS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_PATIENT_SEEDS;
  } catch (error) {
    console.error('[patientStore] 患者データの読み込みに失敗しました:', error);
    return DEFAULT_PATIENT_SEEDS;
  }
}

/**
 * 全患者リストを一括保存
 * @param {Array<Object>} patients - 保存する患者配列
 */
export function saveAllPatients(patients) {
  try {
    localStorage.setItem(STORAGE_KEY_PATIENTS, JSON.stringify(patients));
  } catch (error) {
    console.error('[patientStore] 患者データの保存に失敗しました:', error);
  }
}

/**
 * 患者ID（記号: a, b...）を指定して単一患者情報を取得
 * @param {string} patientId 
 * @returns {Object|null}
 */
export function getPatientById(patientId) {
  const normId = normalizePatientId(patientId);
  if (!normId) return null;

  const list = getAllPatients();
  return list.find((p) => normalizePatientId(p.id) === normId) || null;
}


/**
 * 患者情報を新規追加または更新（Upsert）
 * @param {Object} patientData - 患者オブジェクト
 * @param {string} patientData.id - 患者記号 (例: 'a')
 * @param {string} [patientData.name] - 患者氏名
 * @param {string} [patientData.admissionDate] - 当院入院日 (YYYY-MM-DD)
 * @param {string} [patientData.earlyBonusStartDate] - 早期加算起算日（転院患者は前医入院日）
 * @param {string} [patientData.onsetDate] - 発症日/手術日（疾患別算定上限起算日）
 * @param {string} [patientData.diseaseType] - 疾患区分 ('LOCOMOTIVE' | 'CEREBROVASCULAR' | 'DISUSE' | 'ANALGESIA')
 * @param {string} [patientData.category] - 受付シート区分 ('inpatient_1' | 'inpatient_2' | 'inpatient_maintenance' | 'outpatient_1')
 * @param {string} [patientData.lastPlanDate] - 前回総合実施計画書算定日 (YYYY-MM-DD)
 * @param {boolean} [patientData.isLimitExempt] - 月13単位上限除外フラグ
 * @param {string} [patientData.notes] - 備考メモ
 * @returns {Object} 保存された患者オブジェクト
 */
export function upsertPatient(patientData) {
  const normId = normalizePatientId(patientData.id);
  if (!normId) {
    throw new Error('患者ID（識別記号）は必須です。');
  }

  const list = getAllPatients();
  const index = list.findIndex((p) => normalizePatientId(p.id) === normId);

  const merged = {
    id: normId,
    name: patientData.name || `患者${normId.toUpperCase()}`,
    admissionDate: patientData.admissionDate || '',
    earlyBonusStartDate: patientData.earlyBonusStartDate || patientData.admissionDate || '',
    onsetDate: patientData.onsetDate || patientData.admissionDate || '',
    diseaseType: patientData.diseaseType || 'LOCOMOTIVE',
    category: patientData.category || 'inpatient_1',
    lastPlanDate: patientData.lastPlanDate || '',
    isLimitExempt: Boolean(patientData.isLimitExempt),
    notes: patientData.notes || '',
    updatedAt: new Date().toISOString(),
  };

  if (index >= 0) {
    // 既存レコードをマージ更新
    list[index] = { ...list[index], ...merged };
  } else {
    // 新規レコード追加
    list.push(merged);
  }

  saveAllPatients(list);
  return merged;
}


/**
 * 患者マスターをJSON文字列としてエクスポート（バックアップ用）
 * @returns {string} JSON文字列
 */
export function exportPatientsAsJson() {
  const list = getAllPatients();
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    patients: list,
  }, null, 2);
}

/**
 * JSON文字列から患者マスターをインポート（リストア）
 * @param {string} jsonString - インポートするJSON
 * @returns {{ success: boolean, count: number, error?: string }}
 */
export function importPatientsFromJson(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data || !Array.isArray(data.patients)) {
      return { success: false, count: 0, error: '有効な患者データ形式（JSON）ではありません。' };
    }

    // データの正規化チェック
    const validPatients = data.patients
      .filter((p) => p && p.id)
      .map((p) => ({
        id: normalizePatientId(p.id),
        name: p.name || `患者${normalizePatientId(p.id).toUpperCase()}`,
        admissionDate: p.admissionDate || '',
        earlyBonusStartDate: p.earlyBonusStartDate || p.admissionDate || '',
        onsetDate: p.onsetDate || p.admissionDate || '',
        diseaseType: p.diseaseType || 'LOCOMOTIVE',
        category: p.category || 'inpatient_1',
        lastPlanDate: p.lastPlanDate || '',
        isLimitExempt: Boolean(p.isLimitExempt),
        notes: p.notes || '',
        updatedAt: p.updatedAt || new Date().toISOString(),
      }));

    saveAllPatients(validPatients);
    return { success: true, count: validPatients.length };
  } catch (err) {
    return { success: false, count: 0, error: err.message };
  }
}
