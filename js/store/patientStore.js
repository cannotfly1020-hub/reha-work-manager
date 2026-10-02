// js/store/patientStore.js
// 患者マスターCRUD・LocalStorage永続化・介護認定・疾患名・消炎鎮痛フィルタリング制御層（200行制限準拠）

import { normalizeString, normalizePatientId, normalizeDateString } from '../core/dataNormalizer.js';

const STORAGE_KEY = 'reha_patients_master';

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
    diseaseType: 'LOCOMOTIVE',
    careInsuranceType: 'CARE',
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
    diseaseType: 'CEREBROVASCULAR',
    careInsuranceType: 'NONE',
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
    diseaseType: 'LOCOMOTIVE',
    careInsuranceType: 'SUPPORT',
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
    diseaseType: 'ANALGESIA',
    careInsuranceType: 'NONE',
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
    diseaseType: 'ANALGESIA',
    careInsuranceType: 'NONE',
    admissionDate: '2026-09-20',
    earlyBonusStartDate: '2026-09-20',
    onsetDate: '2026-09-15',
    notes: '病棟牽引・消炎鎮痛処置'
  }
];

/**
 * LocalStorageから全患者レコードを取得する（存在しない場合は初期データを保存）
 * @returns {Array<Object>} 患者配列
 */
export function getAllPatients() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveAllPatients(DEFAULT_PATIENTS);
      return [...DEFAULT_PATIENTS];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('getAllPatients failed to parse LocalStorage data:', error);
    return [];
  }
}

/**
 * IDを指定して単一患者レコードを取得する
 * @param {string} id 患者ID
 * @returns {Object|null}
 */
export function getPatientById(id) {
  if (!id) return null;
  const targetId = normalizePatientId(id);
  const patients = getAllPatients();
  return patients.find((p) => p.id === targetId) || null;
}

/**
 * 全患者配列をLocalStorageに一括保存する
 * @param {Array<Object>} patients 
 * @returns {boolean} 成功成否
 */
export function saveAllPatients(patients) {
  try {
    if (!Array.isArray(patients)) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
    return true;
  } catch (error) {
    console.error('saveAllPatients failed to write to LocalStorage:', error);
    return false;
  }
}

/**
 * 単一患者レコードを新規作成または更新（Upsert）する
 * @param {Object} rawData 入力フォームデータ
 * @returns {{ success: boolean, patient?: Object, message?: string }}
 */
export function upsertPatient(rawData) {
  if (!rawData) return { success: false, message: '入力データが空です。' };

  const id = normalizePatientId(rawData.id);
  const name = normalizeString(rawData.name);

  if (!id) return { success: false, message: '患者ID（記号）は必須です。' };
  if (!name) return { success: false, message: '患者氏名は必須です。' };

  const cleanPatient = {
    id,
    name,
    nameKana: normalizeString(rawData.nameKana || ''),
    diseaseName: normalizeString(rawData.diseaseName || '未記入'),
    category: rawData.category === 'OUTPATIENT' ? 'OUTPATIENT' : 'INPATIENT',
    diseaseType: ['LOCOMOTIVE', 'CEREBROVASCULAR', 'DISUSE', 'ANALGESIA'].includes(rawData.diseaseType)
      ? rawData.diseaseType
      : 'LOCOMOTIVE',
    careInsuranceType: ['NONE', 'SUPPORT', 'CARE'].includes(rawData.careInsuranceType)
      ? rawData.careInsuranceType
      : 'NONE',
    admissionDate: normalizeDateString(rawData.admissionDate),
    earlyBonusStartDate: normalizeDateString(rawData.earlyBonusStartDate || rawData.admissionDate),
    onsetDate: normalizeDateString(rawData.onsetDate),
    force13Limit: Boolean(rawData.force13Limit),
    notes: normalizeString(rawData.notes || '')
  };

  const list = getAllPatients();
  const existingIndex = list.findIndex((p) => p.id === id);

  if (existingIndex >= 0) {
    list[existingIndex] = cleanPatient;
  } else {
    list.push(cleanPatient);
  }

  const saved = saveAllPatients(list);
  if (!saved) {
    return { success: false, message: 'ストレージへの保存に失敗しました。' };
  }
  return { success: true, patient: cleanPatient };
}

/**
 * IDを指定して患者レコードを削除する
 * @param {string} id 患者ID
 * @returns {boolean}
 */
export function deletePatient(id) {
  if (!id) return false;
  const targetId = normalizePatientId(id);
  const list = getAllPatients();
  const filtered = list.filter((p) => p.id !== targetId);
  if (filtered.length === list.length) return false;
  return saveAllPatients(filtered);
}

/**
 * 検索キーワードや区分で患者リストを絞り込む
 * @param {string} keyword 氏名・ID・病名・カナあいまい検索
 * @param {'ALL'|'INPATIENT'|'OUTPATIENT'|'ANALGESIA'} category 絞り込み区分
 * @returns {Array<Object>} 絞り込み済み患者配列
 */
export function searchPatients(keyword = '', category = 'ALL') {
  let list = getAllPatients();

  if (category === 'ANALGESIA') {
    // 消炎鎮痛モード: 入院・外来問わず疾患区分が ANALGESIA の患者を抽出
    list = list.filter((p) => p.diseaseType === 'ANALGESIA');
  } else if (category && category !== 'ALL') {
    // 入院または外来モード
    list = list.filter((p) => p.category === category);
  }

  if (!keyword || !keyword.trim()) return list;

  const q = normalizeString(keyword).toLowerCase();
  return list.filter((p) => {
    const idMatch = p.id.toLowerCase().includes(q);
    const nameMatch = p.name.toLowerCase().includes(q);
    const kanaMatch = (p.nameKana || '').toLowerCase().includes(q);
    const diseaseMatch = (p.diseaseName || '').toLowerCase().includes(q);
    return idMatch || nameMatch || kanaMatch || diseaseMatch;
  });
}
