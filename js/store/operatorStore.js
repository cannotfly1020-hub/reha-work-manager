// js/store/operatorStore.js
// 端末別操作者（PC固定）— localStorage のみ（共有マスター同期の影響を受けない）

const OPERATOR_LS_KEY = 'reha_local_operator';

/**
 * @typedef {{ therapistId: string, name: string, role?: string, setAt?: string }} LocalOperator
 */

/**
 * Electron / ブラウザからホスト名を取得
 * @returns {string}
 */
export function getTerminalHostname() {
  try {
    if (typeof window !== 'undefined') {
      if (window.desktopApp && typeof window.desktopApp.getHostname === 'function') {
        const h = window.desktopApp.getHostname();
        if (h) return String(h);
      }
      if (window.electronBackup && typeof window.electronBackup.getHostname === 'function') {
        const h = window.electronBackup.getHostname();
        if (h) return String(h);
      }
    }
  } catch (_) { /* ignore */ }
  return 'LOCAL-BROWSER';
}

/**
 * このPCに固定された操作者を取得
 * @returns {LocalOperator|null}
 */
export function getLocalOperator() {
  try {
    const raw = localStorage.getItem(OPERATOR_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.name) return null;
    return {
      therapistId: String(parsed.therapistId || ''),
      name: String(parsed.name || '').trim(),
      role: parsed.role ? String(parsed.role) : '',
      setAt: parsed.setAt || ''
    };
  } catch (_) {
    return null;
  }
}

/**
 * 操作者が設定済みか
 * @returns {boolean}
 */
export function hasLocalOperator() {
  const op = getLocalOperator();
  return Boolean(op && op.name);
}

/**
 * 操作者をこのPCに固定保存
 * @param {{ therapistId?: string, name: string, role?: string }} operator
 * @returns {boolean}
 */
export function setLocalOperator(operator) {
  if (!operator || !operator.name || !String(operator.name).trim()) return false;
  try {
    const payload = {
      therapistId: String(operator.therapistId || ''),
      name: String(operator.name).trim(),
      role: operator.role ? String(operator.role) : '',
      setAt: new Date().toISOString()
    };
    localStorage.setItem(OPERATOR_LS_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.error('setLocalOperator error:', e);
    return false;
  }
}

/**
 * ログ・画面表示用の操作者ラベル（ホスト名付き）
 * 例: 山田 PT (PC-YAMADA)
 * @param {LocalOperator|null} [op]
 * @returns {string}
 */
export function formatOperatorLabel(op = null) {
  const operator = op || getLocalOperator();
  const name = operator?.name || '未設定';
  const host = getTerminalHostname();
  return `${name} (${host})`;
}

/**
 * 監査ログ用の操作者名・ホスト名を分解取得
 * @returns {{ operatorName: string, hostname: string, therapistId: string }}
 */
export function resolveOperatorContext() {
  const op = getLocalOperator();
  return {
    operatorName: op?.name || '未設定',
    hostname: getTerminalHostname(),
    therapistId: op?.therapistId || ''
  };
}
