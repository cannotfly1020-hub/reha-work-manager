// js/store/patientStore.js
// 患者マスターCRUD・LocalStorage永続化・ステータス管理(継続/終了・退院)・計画書ステータス同期・消炎鎮痛制御層
// ★検索: ひらがな⇄カタカナ・全角⇄半角英数の相互一致対応

import {
  normalizeString, normalizePatientId, normalizeDateString, normalizeToKatakana
} from '../core/dataNormalizer.js';
import { storageGet } from '../core/storageAdapter.js';
import { writeStorageItem } from './storageWrite.js';

const STORAGE_KEY = 'reha_patients_master';

/**
 * 患者の通院・入院ステータス定数
 */
export const PATIENT_STATUS = {
  ACTIVE: 'ACTIVE',           // 通院・入院中（継続）
  DISCONTINUED: 'DISCONTINUED' // 終了・退院（中止）
};

/**
 * 初期シードデータ（未登録時のフォールバック用サンプル）
 */
const DEFAULT_PATIENTS = [
  {
    id: 'P001',
    name: '田中 太郎',
    nameKana: 'タナカ タロウ',
    diseaseName: '右大腿骨頸部骨折 術後',
    category: 'INPATIENT',
    status: PATIENT_STATUS.ACTIVE,
    diseaseType: 'LOCOMOTIVE',
    careInsuranceType: 'CARE',
    planStatus: 'PLAN_2_FOLLOW',
    admissionDate: '2026-09-01',
    earlyBonusStartDate: '2026-09-01',
    onsetDate: '2026-08-28',
    notes: '歩行訓練中心。疼痛注意。'
  },
  {
    id: 'P002',
    name: '佐藤 花子',
    nameKana: 'サトウ ハナコ',
    diseaseName: '脳梗塞後遺症（左片麻痺）',
    category: 'INPATIENT',
    status: PATIENT_STATUS.ACTIVE,
    diseaseType: 'CEREBROVASCULAR',
    careInsuranceType: 'NONE',
    planStatus: 'NOT_YET',
    admissionDate: '2026-09-15',
    earlyBonusStartDate: '2026-09-15',
    onsetDate: '2026-09-10',
    notes: '上肢機能訓練およびADL練習'
  },
  {
    id: 'P003',
    name: '鈴木 一郎',
    nameKana: 'スズキ イチロウ',
    diseaseName: '腰部脊柱管狭窄症',
    category: 'OUTPATIENT',
    status: PATIENT_STATUS.ACTIVE,
    diseaseType: 'LOCOMOTIVE',
    careInsuranceType: 'SUPPORT',
    planStatus: 'PLAN_1_FOLLOW',
    admissionDate: '',
    earlyBonusStartDate: '',
    onsetDate: '2026-06-01',
    notes: '維持期・外来リハビリ'
  },
  {
    id: 'P004',
    name: '高橋 健二',
    nameKana: 'タカハシ ケンジ',
    diseaseName: '変形性膝関節症（物療）',
    category: 'OUTPATIENT',
    status: PATIENT_STATUS.ACTIVE,
    diseaseType: 'ANALGESIA',
    careInsuranceType: 'NONE',
    planStatus: 'NOT_YET',
    admissionDate: '',
    earlyBonusStartDate: '',
    onsetDate: '2026-09-01',
    notes: '外来・消炎鎮痛処置（温熱・低周波）'
  },
  {
    id: 'P005',
    name: '伊藤 幸子',
    nameKana: 'イトウ サチコ',
    diseaseName: '頸椎症性神経根症（入院物療）',
    category: 'INPATIENT',
    status: PATIENT_STATUS.ACTIVE,
    diseaseType: 'ANALGESIA',
    careInsuranceType: 'NONE',
    planStatus: 'NOT_YET',
    admissionDate: '2026-09-20',
    earlyBonusStartDate: '2026-09-20',
    onsetDate: '2026-09-15',
    notes: '病棟牽引・消炎鎮痛処置'
  }
];

export function getAllPatients(includeDiscontinued = true) {
  try {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) {
      saveAllPatients(DEFAULT_PATIENTS);
      return [...DEFAULT_PATIENTS];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // 既存データに status がない場合は自動で ACTIVE（継続）を補完
    const normalized = parsed.map((p) => ({
      ...p,
      status: p.status || PATIENT_STATUS.ACTIVE
    }));

    if (includeDiscontinued) return normalized;
    return normalized.filter((p) => p.status !== PATIENT_STATUS.DISCONTINUED);
  } catch (error) {
    console.error('getAllPatients error:', error);
    return [];
  }
}

export function getPatientById(id) {
  if (!id) return null;
  const targetId = normalizePatientId(id);
  const patients = getAllPatients(true);
  return patients.find((p) => p.id === targetId) || null;
}

export function saveAllPatients(patients) {
  try {
    if (!Array.isArray(patients)) return false;
    return writeStorageItem(STORAGE_KEY, JSON.stringify(patients));
  } catch (error) {
    console.error('saveAllPatients error:', error);
    return false;
  }
}

export function upsertPatient(rawData) {
  if (!rawData) return { success: false, message: '入力データが空です。' };

  const id = normalizePatientId(rawData.id);
  const name = normalizeString(rawData.name);
  if (!id) return { success: false, message: '患者IDは必須です。' };
  if (!name) return { success: false, message: '患者氏名は必須です。' };

  const cleanPatient = {
    id,
    name,
    nameKana: normalizeString(rawData.nameKana || ''),
    diseaseName: normalizeString(rawData.diseaseName || '未記入'),
    category: rawData.category === 'OUTPATIENT' ? 'OUTPATIENT' : 'INPATIENT',
    status: rawData.status === PATIENT_STATUS.DISCONTINUED ? PATIENT_STATUS.DISCONTINUED : PATIENT_STATUS.ACTIVE,
    diseaseType: ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE', 'ANALGESIA'].includes(rawData.diseaseType)
      ? rawData.diseaseType : 'LOCOMOTIVE',
    careInsuranceType: ['NONE', 'SUPPORT', 'CARE'].includes(rawData.careInsuranceType)
      ? rawData.careInsuranceType : 'NONE',
    planStatus: ['NOT_YET', 'PLAN_1_FOLLOW', 'PLAN_2_FOLLOW'].includes(rawData.planStatus)
      ? rawData.planStatus : 'NOT_YET',
    admissionDate: normalizeDateString(rawData.admissionDate),
    earlyBonusStartDate: normalizeDateString(rawData.earlyBonusStartDate || rawData.admissionDate),
    onsetDate: normalizeDateString(rawData.onsetDate),
    force13Limit: Boolean(rawData.force13Limit),
    notes: normalizeString(rawData.notes || '')
  };

  const list = getAllPatients(true);
  const existingIndex = list.findIndex((p) => p.id === id);
  if (existingIndex >= 0) list[existingIndex] = cleanPatient;
  else list.push(cleanPatient);

  const saved = saveAllPatients(list);
  if (!saved) return { success: false, storageFailed: true };
  return { success: true, patient: cleanPatient };
}

/**
 * 時間割等からの計画書算定実績確定に伴い、患者の計画書ステータスを更新する
 */
export function updatePatientPlanStatus(patientId, planType) {
  const patient = getPatientById(patientId);
  if (!patient) return false;

  let newStatus = patient.planStatus || 'NOT_YET';
  if (String(planType).includes('PLAN_2')) {
    newStatus = 'PLAN_2_FOLLOW'; // 計画書2を一度でも算定したら今後は2回目以降固定
  } else if (String(planType).includes('PLAN_1')) {
    if (newStatus !== 'PLAN_2_FOLLOW') newStatus = 'PLAN_1_FOLLOW';
  }

  if (patient.planStatus !== newStatus) {
    patient.planStatus = newStatus;
    const list = getAllPatients(true);
    const idx = list.findIndex((p) => p.id === patient.id);
    if (idx >= 0) {
      list[idx] = patient;
      return saveAllPatients(list);
    }
  }
  return true;
}

export function deletePatient(id) {
  if (!id) return false;
  const targetId = normalizePatientId(id);
  const list = getAllPatients(true);
  const filtered = list.filter((p) => p.id !== targetId);
  if (filtered.length === list.length) return false;
  return saveAllPatients(filtered);
}

/**
 * 検索クエリを正規化（全角英数→半角・空白整理・小文字化）
 * @param {string} keyword
 * @returns {string}
 */
function normalizeSearchQuery(keyword) {
  // normalizeString 内で [！-～] 全角英数記号 → 半角へ変換済み
  return normalizeString(keyword).toLowerCase();
}

/**
 * 患者検索（ひらがな・カタカナ・全角半角の相互一致）
 * - ID: 全角「１２」「Ｐ００１」→ 半角比較
 * - 氏名・疾患名: 小文字＋半角正規化比較
 * - フリガナ: ひらがな入力「たなか」→ カタカナ「タナカ」へ変換して照合
 *
 * @param {string} keyword
 * @param {string} category 'ALL' | 'INPATIENT' | 'OUTPATIENT' | 'ANALGESIA'
 * @param {boolean} includeDiscontinued
 * @returns {Array}
 */
export function searchPatients(keyword = '', category = 'ALL', includeDiscontinued = false) {
  let list = getAllPatients(includeDiscontinued);

  if (!includeDiscontinued) {
    list = list.filter((p) => p.status !== PATIENT_STATUS.DISCONTINUED);
  }

  if (category === 'ANALGESIA') {
    list = list.filter((p) => p.diseaseType === 'ANALGESIA');
  } else if (category && category !== 'ALL') {
    list = list.filter((p) => p.category === category);
  }

  if (!keyword || !String(keyword).trim()) return list;

  const q = normalizeSearchQuery(keyword);
  const queryKana = normalizeToKatakana(keyword).toLowerCase();

  return list.filter((p) => {
    const idNorm = normalizeSearchQuery(p.id || '');
    const nameNorm = normalizeSearchQuery(p.name || '');
    const diseaseNorm = normalizeSearchQuery(p.diseaseName || '');
    const kanaNorm = normalizeToKatakana(p.nameKana || '').toLowerCase();

    return idNorm.includes(q)
      || nameNorm.includes(q)
      || diseaseNorm.includes(q)
      || (queryKana.length > 0 && kanaNorm.includes(queryKana));
  });
}
