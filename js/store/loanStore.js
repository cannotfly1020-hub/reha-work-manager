// js/store/loanStore.js
// リハビリ物品・装具貸出CRUD・返却管理・LocalStorage永続化層

import { normalizeString, normalizePatientId, normalizeDateString } from '../core/dataNormalizer.js';

const STORAGE_KEY = 'reha_loans_master';

/**
 * 初期貸出シードデータ（初回起動・リセット時用サンプル）
 */
const DEFAULT_LOANS = [
  {
    id: 'LN-2026-001',
    patientId: 'P001',
    patientName: '田中 太郎',
    itemName: '短下肢装具（プラスチックAFO 右）',
    ownerType: 'HOSPITAL', // 'HOSPITAL'(院内備品) | 'VENDOR'(業者貸出)
    vendorName: '',
    loanDate: '2026-09-05',
    dueDate: '2026-10-05',
    returnDate: '',
    status: 'ACTIVE', // 'ACTIVE'(貸出中) | 'RETURNED'(返却済)
    notes: '病棟歩行訓練および退院前屋外歩行用。'
  },
  {
    id: 'LN-2026-002',
    patientId: 'P002',
    patientName: '佐藤 花子',
    itemName: 'モジュール型車椅子（チルト＆リクライニング式）',
    ownerType: 'VENDOR',
    vendorName: 'ヤマシタケアサービス',
    loanDate: '2026-09-18',
    dueDate: '2026-10-18',
    returnDate: '',
    status: 'ACTIVE',
    notes: 'デモ機試乗中。シーティング評価実施。'
  },
  {
    id: 'LN-2026-003',
    patientId: 'P003',
    patientName: '鈴木 一郎',
    itemName: 'ロフストランドクラッチ（両側）',
    ownerType: 'HOSPITAL',
    vendorName: '',
    loanDate: '2026-08-10',
    dueDate: '2026-09-10',
    returnDate: '2026-09-08',
    status: 'RETURNED',
    notes: '疼痛軽減に伴い杖歩行自立のため返却完了。'
  }
];

/**
 * LocalStorageから全貸出レコードを取得する（存在しない場合は初期データを保存）
 * @returns {Array<Object>} 貸出レコード配列
 */
export function getAllLoans() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveAllLoans(DEFAULT_LOANS);
      return [...DEFAULT_LOANS];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('getAllLoans parse error:', error);
    return [];
  }
}

/**
 * 全貸出配列をLocalStorageに一括保存する
 * @param {Array<Object>} loans 
 * @returns {boolean}
 */
export function saveAllLoans(loans) {
  try {
    if (!Array.isArray(loans)) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loans));
    return true;
  } catch (error) {
    console.error('saveAllLoans write error:', error);
    return false;
  }
}

/**
 * 新規物品貸出レコードを作成・登録する
 * @param {Object} rawData 
 * @returns {{ success: boolean, loan?: Object, message?: string }}
 */
export function registerLoan(rawData) {
  if (!rawData) return { success: false, message: '入力データが空です。' };

  const itemName = normalizeString(rawData.itemName);
  const patientId = normalizePatientId(rawData.patientId);
  const loanDate = normalizeDateString(rawData.loanDate) || new Date().toISOString().split('T')[0];

  if (!itemName) return { success: false, message: '品名・装具名は必須です。' };
  if (!patientId) return { success: false, message: '対象患者を選択してください。' };

  const uniqueId = `LN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

  const newLoan = {
    id: uniqueId,
    patientId,
    patientName: normalizeString(rawData.patientName || '未登録患者'),
    itemName,
    ownerType: rawData.ownerType === 'VENDOR' ? 'VENDOR' : 'HOSPITAL',
    vendorName: rawData.ownerType === 'VENDOR' ? normalizeString(rawData.vendorName || '') : '',
    loanDate,
    dueDate: normalizeDateString(rawData.dueDate),
    returnDate: '',
    status: 'ACTIVE',
    notes: normalizeString(rawData.notes || '')
  };

  const list = getAllLoans();
  list.unshift(newLoan); // 新規レコードを先頭に追加

  const saved = saveAllLoans(list);
  if (!saved) return { success: false, message: 'ストレージへの保存に失敗しました。' };
  return { success: true, loan: newLoan };
}

/**
 * 貸出中の物品を「返却済み」に更新する
 * @param {string} loanId 
 * @param {string} returnDate YYYY-MM-DD
 * @returns {boolean}
 */
export function markAsReturned(loanId, returnDate = '') {
  if (!loanId) return false;
  const list = getAllLoans();
  const index = list.findIndex((item) => item.id === loanId);
  if (index === -1) return false;

  const resolvedReturnDate = normalizeDateString(returnDate) || new Date().toISOString().split('T')[0];
  list[index].returnDate = resolvedReturnDate;
  list[index].status = 'RETURNED';

  return saveAllLoans(list);
}

/**
 * 物品貸出レコードを完全に削除する
 * @param {string} loanId 
 * @returns {boolean}
 */
export function deleteLoan(loanId) {
  if (!loanId) return false;
  const list = getAllLoans();
  const filtered = list.filter((item) => item.id !== loanId);
  if (filtered.length === list.length) return false;
  return saveAllLoans(filtered);
}

/**
 * 物品貸出リストをステータス・所有区分・キーワードで絞り込む
 * @param {Object} filterOptions { status: 'ALL'|'ACTIVE'|'RETURNED', ownerType: 'ALL'|'HOSPITAL'|'VENDOR', keyword: string }
 * @returns {Array<Object>}
 */
export function filterLoans(filterOptions = {}) {
  const { status = 'ALL', ownerType = 'ALL', keyword = '' } = filterOptions;
  let list = getAllLoans();

  if (status && status !== 'ALL') {
    list = list.filter((item) => item.status === status);
  }

  if (ownerType && ownerType !== 'ALL') {
    list = list.filter((item) => item.ownerType === ownerType);
  }

  if (keyword && keyword.trim()) {
    const q = normalizeString(keyword).toLowerCase();
    list = list.filter((item) => {
      const matchItem = item.itemName.toLowerCase().includes(q);
      const matchPatient = item.patientName.toLowerCase().includes(q);
      const matchId = item.patientId.toLowerCase().includes(q);
      const matchVendor = (item.vendorName || '').toLowerCase().includes(q);
      return matchItem || matchPatient || matchId || matchVendor;
    });
  }

  return list;
}
