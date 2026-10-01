/**
 * @file patientStore.js
 * @description 患者マスター情報（入院日・早期加算起算日・発症日・疾患区分・介護保険認定・疾患名等）のローカル保存・管理
 * 
 * - 完全オフライン（LocalStorage）で安全管理
 * - 介護保険認定区分（careInsuranceType）および 具体的な疾患名（diseaseName）の確実な永続化に対応
 */

import { normalizePatientId, safeParseInt } from '../core/dataNormalizer.js';

// LocalStorageのキープレフィックス
const STORAGE_KEY_PATIENTS = 'reha_manager_patients_v1';

/**
 * 初期マスターテンプレート（記号 a 〜 y の標準枠）
 */
const DEFAULT_PATIENT_SEEDS = [
  // 入院1（運動器Ⅱ）
  { id: 'a', name: '患者A', diseaseName: '大腿骨頸部骨折', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'b', name: '患者B', diseaseName: '変形性膝関節症', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'c', name: '患者C', diseaseName: '腰椎圧迫骨折', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'd', name: '患者D', diseaseName: '胸椎圧迫骨折', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'e', name: '患者E', diseaseName: '大腿骨転子部骨折', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'f', name: '患者F', diseaseName: '肩関節周囲炎', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'g', name: '患者G', diseaseName: '脊柱管狭窄症', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'h', name: '患者H', diseaseName: '大腿骨骨折', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'i', name: '患者I', diseaseName: '骨盤骨折', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  { id: 'j', name: '患者J', diseaseName: '膝周囲骨折', diseaseType: 'LOCOMOTIVE', category: 'inpatient_1', careInsuranceType: 'NONE' },
  // 入院(2)（脳血管Ⅲ等）
  { id: 'k', name: '患者K', diseaseName: '脳梗塞', diseaseType: 'CEREBROVASCULAR', category: 'inpatient_2', careInsuranceType: 'CARE' },
  { id: 'l', name: '患者L', diseaseName: '脳出血', diseaseType: 'CEREBROVASCULAR', category: 'inpatient_2', careInsuranceType: 'CARE' },
  { id: 'm', name: '患者M', diseaseName: 'くも膜下出血', diseaseType: 'CEREBROVASCULAR', category: 'inpatient_2', careInsuranceType: 'CARE' },
  // 入院（維持期介護）
  { id: 'n', name: '患者N', diseaseName: '廃用症候群', diseaseType: 'DISUSE', category: 'inpatient_maintenance', careInsuranceType: 'CARE' },
  { id: 'o', name: '患者O', diseaseName: '廃用症候群', diseaseType: 'DISUSE', category: 'inpatient_maintenance', careInsuranceType: 'CARE' },
  // 外来
  { id: 'p', name: '外来P', diseaseName: '変形性膝関節症', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1', careInsuranceType: 'NONE' },
  { id: 'q', name: '外来Q', diseaseName: '肩関節周囲炎', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1', careInsuranceType: 'NONE' },
  { id: 'r', name: '外来R', diseaseName: '腰痛症', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1', careInsuranceType: 'NONE' },
  { id: 's', name: '外来S', diseaseName: '頚椎症', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1', careInsuranceType: 'NONE' },
  { id: 't', name: '外来T', diseaseName: '足関節捻挫', diseaseType: 'LOCOMOTIVE', category: 'outpatient_1', careInsuranceType: 'NONE' },
];

/**
 * 全患者リストを取得
 */
export function getAllPatients() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PATIENTS);
    if (!raw) {
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
 */
export function saveAllPatients(patients) {
  try {
    localStorage.setItem(STORAGE_KEY_PATIENTS, JSON.stringify(patients));
  } catch (error) {
    console.error('[patientStore] 患者データの保存に失敗しました:', error);
  }
}

/**
 * 患者IDを指定して単一患者情報を取得
 */
export function getPatientById(patientId) {
  const normId = normalizePatientId(patientId);
  if (!normId) return null;

  const list = getAllPatients();
  return list.find((p) => normalizePatientId(p.id) === normId) || null;
}

/**
 * 患者情報を新規追加または更新（Upsert）
 * - careInsuranceType (介護保険区分) および diseaseName (疾患名) を確実に保存
 */
export function upsertPatient(patientData) {
  const normId = normalizePatientId(patientData.id);
  if (!normId) {
    throw new Error('患者ID（識別記号）は必須です。');
  }

  const list = getAllPatients();
  const index = list.findIndex((p) => normalizePatientId(p.id) === normId);

  // 介護保険区分の正規化 (NONE, SUPPORT, CARE)
  let careType = patientData.careInsuranceType || 'NONE';
  if (!['NONE', 'SUPPORT', 'CARE'].includes(careType)) {
    careType = patientData.category?.includes('maintenance') ? 'CARE' : 'NONE';
  }

  const merged = {
    id: normId,
    name: patientData.name || `患者${normId.toUpperCase()}`,
    diseaseName: patientData.diseaseName || '', // ★ 新設: 具体的な疾患名（病名）
    diseaseType: patientData.diseaseType || 'LOCOMOTIVE',
    careInsuranceType: careType, // ★ 確実に保存（データ落ちを完全解消）
    category: patientData.category || 'inpatient_1',
    admissionDate: patientData.admissionDate || '',
    earlyBonusStartDate: patientData.earlyBonusStartDate || patientData.admissionDate || '',
    onsetDate: patientData.onsetDate || patientData.admissionDate || '',
    isLimitExempt: Boolean(patientData.isLimitExempt),
    notes: patientData.notes || '',
    updatedAt: new Date().toISOString(),
  };

  if (index >= 0) {
    list[index] = { ...list[index], ...merged };
  } else {
    list.push(merged);
  }

  saveAllPatients(list);
  return merged;
}

/**
 * 患者マスターをJSON文字列としてエクスポート
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
 * JSON文字列から患者マスターをインポート
 */
export function importPatientsFromJson(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data || !Array.isArray(data.patients)) {
      return { success: false, count: 0, error: '有効な患者データ形式（JSON）ではありません。' };
    }

    const validPatients = data.patients
      .filter((p) => p && p.id)
      .map((p) => ({
        id: normalizePatientId(p.id),
        name: p.name || `患者${normalizePatientId(p.id).toUpperCase()}`,
        diseaseName: p.diseaseName || '',
        diseaseType: p.diseaseType || 'LOCOMOTIVE',
        careInsuranceType: p.careInsuranceType || 'NONE',
        category: p.category || 'inpatient_1',
        admissionDate: p.admissionDate || '',
        earlyBonusStartDate: p.earlyBonusStartDate || p.admissionDate || '',
        onsetDate: p.onsetDate || p.admissionDate || '',
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
