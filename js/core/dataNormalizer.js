/**
 * @file dataNormalizer.js
 * @description リハビリ記録（A, B, C）のセル文字列・シート名・患者記号の正規化処理
 * 
 * Excelマクロで発生しがちな「全角/半角スペース混在」「全角アルファベット」「シート名の余白」
 * によるマッチング失敗や集計漏れを完全に防ぎます。
 */

/**
 * 全角英数・全角記号を半角に変換し、全角スペースを半角スペースに統一、前後の余白を除去
 * @param {string|any} input - 入力文字列または値
 * @returns {string} 正規化された文字列
 */
export function normalizeString(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);

  return str
    // Unicode正規化 (NFKC: 全角英数や記号を標準半角へ分解・結合)
    .normalize('NFKC')
    // 全角スペース (U+3000) を半角スペースへ変換
    .replace(/\u3000/g, ' ')
    // 連続する空白（タブ・改行含む）を1つの半角スペースに集約
    .replace(/\s+/g, ' ')
    // 前後の余白をトリム
    .trim();
}

/**
 * 患者識別記号（a, b, c...）を統一フォーマット（半角小文字）へ正規化
 * 例: ' ａ ' -> 'a', 'A' -> 'a', 'ｒ' -> 'r'
 * @param {string|any} rawId - 入力記号
 * @returns {string} 半角小文字の患者記号
 */
export function normalizePatientId(rawId) {
  if (!rawId) return '';
  const cleaned = normalizeString(rawId).toLowerCase();
  // 英字部分のみを抽出（前後についてしまった余分な記号等を除去）
  const match = cleaned.match(/[a-z]+/);
  return match ? match[0] : cleaned;
}

/**
 * リハ記録の1コマセル値（例: "a 3", "a　3", "l 1", "p 3", "a3" など）を解析
 * 患者記号と単位数に分離して安全なオブジェクトとして返却
 * 
 * @param {string|any} cellValue - セル内の値
 * @returns {{ patientId: string, units: number, raw: string } | null} 解析結果（該当しない場合はnull）
 */
export function parseSessionCell(cellValue) {
  if (!cellValue) return null;

  // 基本的な正規化（NFKC・全角スペース解消・前後トリム）
  const normalized = normalizeString(cellValue);
  if (!normalized) return null;

  // 時間割見出しや「午前」「午後」「年」「月」などのラベル行は除外
  if (/^(午前|午後|年|月|日|職種|合計|実施)/.test(normalized)) {
    return null;
  }
  // コマの時間帯表記 (例: "9:00~9:20", "14:00～14:20") は除外
  if (/^\d{1,2}:\d{2}/.test(normalized)) {
    return null;
  }

  // パターン1: "a 3", "b 2", "a  3", "l 1" (記号 + 空白 + 単位数)
  // パターン2: "a3", "k1" (空白なしの結合)
  // パターン3: "a:3", "a-3" (区切り記号つき)
  const match = normalized.match(/^([a-zA-Z]+)[\s:\-_]*(\d+)$/);

  if (match) {
    const patientId = match[1].toLowerCase();
    const units = parseInt(match[2], 10);

    // 単位数が0〜9の常識的な範囲（リハビリ1回は通常1〜3単位、最大9単位程度）
    if (units > 0 && units <= 18) {
      return {
        patientId,
        units,
        raw: normalized,
      };
    }
  }

  return null;
}

/**
 * Excelシート名から「月」と「午前/午後区分」を抽出
 * リハ記録ファイル内の表記揺れ（例: '7(am) ', '7(pm)', '10(am)', ' 7 (am) '）に対応
 * 
 * @param {string} sheetName - シート名
 * @returns {{ month: number, period: 'am' | 'pm', raw: string } | null}
 */
export function parseRehaSheetName(sheetName) {
  if (!sheetName) return null;

  // 全角括弧や全角英数、末尾の空白を綺麗に除去
  const clean = normalizeString(sheetName).toLowerCase().replace(/\s+/g, '');

  // 例: "7(am)", "7(pm)", "12(am)", "1(pm)" をキャプチャ
  const match = clean.match(/^(\d{1,2})\((am|pm)\)$/);
  if (match) {
    const month = parseInt(match[1], 10);
    const period = match[2]; // 'am' または 'pm'

    if (month >= 1 && month <= 12) {
      return {
        month,
        period,
        raw: sheetName,
      };
    }
  }

  return null;
}

/**
 * 数値または数値文字列を安全な正の整数に変換（不正値はデフォルト値にフォールバック）
 * @param {any} val - 入力値
 * @param {number} [fallback=0] - 変換失敗時のフォールバック値
 * @returns {number}
 */
export function safeParseInt(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const num = Number(normalizeString(val));
  return isNaN(num) ? fallback : Math.round(num);
}
