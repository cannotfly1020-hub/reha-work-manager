/**
 * @file loanStore.js
 * @description リハビリ物品・機器の貸出管理ストア（当院備品 ＆ 外部業者からの借用・又貸し対応）
 * 
 * - 完全オフライン（LocalStorage）で管理。
 * - 現行運用に合わせて「返却期限なし」でシンプルに運用可能。
 * - 将来「返却期限」「期限超過アラート」を追加できるよう拡張フィールドを完備。
 */

import { normalizePatientId, normalizeString } from '../core/dataNormalizer.js';

const STORAGE_KEY_LOANS = 'reha_manager_loans_v1';

/**
 * 所有区分マスター
 */
export const LOAN_OWNER_TYPES = {
  HOSPITAL: { id: 'HOSPITAL', label: '当院備品' },
  VENDOR: { id: 'VENDOR', label: '外部業者借用品（又貸し）' },
};

/**
 * 貸出ステータスマスター
 */
export const LOAN_STATUS = {
  LOANED: { id: 'LOANED', label: '貸出中', color: 'orange' },
  RETURNED: { id: 'RETURNED', label: '返却完了', color: 'green' },
  VENDOR_RETURNED: { id: 'VENDOR_RETURNED', label: '業者返却完了', color: 'gray' },
};


/**
 * 登録されているすべての貸出レコードを取得
 * @returns {Array<Object>} 貸出レコード一覧
 */
export function getAllLoans() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOANS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[loanStore] 貸出データの読み込みに失敗しました:', error);
    return [];
  }
}

/**
 * 貸出レコードを一括保存
 * @param {Array<Object>} loans 
 */
export function saveAllLoans(loans) {
  try {
    localStorage.setItem(STORAGE_KEY_LOANS, JSON.stringify(loans));
  } catch (error) {
    console.error('[loanStore] 貸出データの保存に失敗しました:', error);
  }
}


/**
 * 物品の貸出を新規登録
 * @param {Object} loanData - 入力データ
 * @param {string} loanData.itemName - 物品名（例: 歩行器、車椅子、ロフストランド杖）
 * @param {string} loanData.patientId - 貸出先患者ID（記号: 'a' 等）または氏名
 * @param {'HOSPITAL'|'VENDOR'} [loanData.ownerType='HOSPITAL'] - 所有区分
 * @param {string} [loanData.vendorName=''] - 業者名（外部業者借用の場合）
 * @param {string} [loanData.loanDate] - 貸出日 (YYYY-MM-DD)。省略時は今日
 * @param {string} [loanData.dueDate=''] - （将来用）返却予定日
 * @param {string} [loanData.notes=''] - 用途・備考メモ（一時帰宅用、デモ機試用等）
 * @returns {Object} 作成された貸出レコード
 */
export function registerLoan(loanData) {
  if (!loanData.itemName || !loanData.itemName.trim()) {
    throw new Error('物品名は必須です。');
  }

  const loans = getAllLoans();
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const newLoan = {
    id: `loan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    itemName: normalizeString(loanData.itemName),
    patientId: normalizePatientId(loanData.patientId) || normalizeString(loanData.patientId),
    ownerType: loanData.ownerType || 'HOSPITAL',
    vendorName: loanData.ownerType === 'VENDOR' ? normalizeString(loanData.vendorName) : '',
    loanDate: loanData.loanDate || todayStr,
    dueDate: loanData.dueDate || '', // 現在は空欄可能
    status: 'LOANED',                // 初期状態は「貸出中」
    returnDate: '',                  // 返却日
    notes: normalizeString(loanData.notes || ''),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  loans.unshift(newLoan); // 新しいものを先頭に追加
  saveAllLoans(loans);
  return newLoan;
}

/**
 * 物品の返却を記録
 * @param {string} loanId - 貸出ID
 * @param {string} [returnDate] - 返却完了日 (YYYY-MM-DD)。省略時は今日
 * @param {boolean} [returnToVendor=false] - 業者にも返却済みとするか
 * @returns {Object|null} 更新されたレコード
 */
export function markAsReturned(loanId, returnDate = '', returnToVendor = false) {
  const loans = getAllLoans();
  const index = loans.findIndex((l) => l.id === loanId);
  if (index === -1) return null;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  loans[index].status = returnToVendor ? 'VENDOR_RETURNED' : 'RETURNED';
  loans[index].returnDate = returnDate || todayStr;
  loans[index].updatedAt = now.toISOString();

  saveAllLoans(loans);
  return loans[index];
}

/**
 * 貸出レコードを更新（備考編集やステータス変更など）
 * @param {string} loanId 
 * @param {Partial<Object>} updates 
 * @returns {Object|null}
 */
export function updateLoan(loanId, updates = {}) {
  const loans = getAllLoans();
  const index = loans.findIndex((l) => l.id === loanId);
  if (index === -1) return null;

  loans[index] = {
    ...loans[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  saveAllLoans(loans);
  return loans[index];
}

/**
 * 貸出レコードを削除
 * @param {string} loanId 
 * @returns {boolean} 成功可否
 */
export function deleteLoan(loanId) {
  const loans = getAllLoans();
  const filtered = loans.filter((l) => l.id !== loanId);
  if (filtered.length === loans.length) return false;

  saveAllLoans(filtered);
  return true;
}


/**
 * 現在「貸出中」の物品一覧を取得（業者又貸し含む）
 * @returns {Array<Object>}
 */
export function getActiveLoans() {
  return getAllLoans().filter((l) => l.status === 'LOANED');
}

/**
 * 業者からの借用品（又貸し）のみを取得
 * @param {boolean} [activeOnly=false] - 貸出中のみ絞り込み
 * @returns {Array<Object>}
 */
export function getVendorLoans(activeOnly = false) {
  return getAllLoans().filter((l) => {
    const isVendor = l.ownerType === 'VENDOR';
    return activeOnly ? (isVendor && l.status === 'LOANED') : isVendor;
  });
}

/**
 * 特定の患者に現在貸し出している物品一覧を取得
 * @param {string} patientId - 患者記号またはID
 * @returns {Array<Object>}
 */
export function getLoansByPatient(patientId) {
  const normId = normalizePatientId(patientId);
  return getAllLoans().filter((l) => {
    return l.status === 'LOANED' && normalizePatientId(l.patientId) === normId;
  });
}
