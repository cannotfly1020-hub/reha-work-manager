// js/core/dataNormalizer.js
// 文字列・患者記号・日付・五十音インデックス等の正規化ユーティリティ
// 純粋関数群として実装し、DOMやStorageへの依存を排除

/**
 * 全角英数を半角に変換し、前後の連続空白をトリミングする
 * @param {string|any} input 
 * @returns {string}
 */
export function normalizeString(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * ひらがなを全角カタカナに変換する（五十音検索・比較用）
 * @param {string|any} input 
 * @returns {string}
 */
export function normalizeToKatakana(input) {
  const str = normalizeString(input);
  return str.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

/**
 * 氏名・カナの頭文字から五十音グループ（ア行〜ワ行・他）を取得する
 * @param {string} nameOrKana 
 * @returns {string} 'ア' | 'カ' | 'サ' | 'タ' | 'ナ' | 'ハ' | 'マ' | 'ヤ' | 'ラ' | 'ワ' | '他'
 */
export function getGojuonGroup(nameOrKana) {
  const kana = normalizeToKatakana(nameOrKana);
  if (!kana || kana.length === 0) return '他';

  const firstChar = kana.charAt(0);
  const code = firstChar.charCodeAt(0);

  // カタカナ範囲: 0x30A1(ァ) 〜 0x30FA(ヺ)
  if (code >= 0x30A1 && code <= 0x30AA) return 'ア'; // ア〜オ
  if (code >= 0x30AB && code <= 0x30F4) {
    if (code <= 0x30BF) {
      if (code <= 0x30B4) return 'カ'; // カ〜ゴ
      return 'サ'; // サ〜ゾ
    }
    if (code <= 0x30C9) return 'タ'; // タ〜ド
    if (code <= 0x30CE) return 'ナ'; // ナ〜ノ
    if (code <= 0x30DD) return 'ハ'; // ハ〜ポ
    if (code <= 0x30E2) return 'マ'; // マ〜モ
    if (code <= 0x30E8) return 'ヤ'; // ヤ〜ヨ
    if (code <= 0x30ED) return 'ラ'; // ラ〜ロ
    return 'ワ'; // ワ〜ン・ヴ
  }
  return '他';
}

/**
 * 患者ID・記号を正規化する（英数は大文字・半角化）
 * @param {string|any} id 
 * @returns {string}
 */
export function normalizePatientId(id) {
  return normalizeString(id).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

/**
 * 日付文字列を YYYY-MM-DD 形式に正規化する
 * @param {string|Date|any} dateInput 
 * @returns {string} 正規化された日付文字列（無効時は空文字）
 */
export function normalizeDateString(dateInput) {
  if (!dateInput) return '';

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return '';
    const y = dateInput.getFullYear();
    const m = String(dateInput.getMonth() + 1).padStart(2, '0');
    const d = String(dateInput.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const str = normalizeString(dateInput);
  // YYYY/M/D や YYYY-M-D 等のゆらぎを検出
  const match = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) {
    const y = match[1];
    const m = String(match[2]).padStart(2, '0');
    const d = String(match[3]).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 8桁連続数字 (YYYYMMDD) の場合
  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }

  return '';
}

/**
 * HTML特殊文字をエスケープしてXSSを防止する
 * @param {string|any} str 
 * @returns {string}
 */
export function sanitizeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 数値を正の整数に安全変換する（単位数・点数用）
 * @param {any} val 
 * @param {number} fallback 
 * @returns {number}
 */
export function safeParseInt(val, fallback = 0) {
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}
