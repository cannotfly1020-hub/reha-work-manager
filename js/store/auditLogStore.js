// js/store/auditLogStore.js
// レベル3監査ログ（操作履歴タイムライン）— 追記専用・共有マスター同期対象

import { storageGet } from '../core/storageAdapter.js';
import { writeStorageItem } from './storageWrite.js';
import { resolveOperatorContext } from './operatorStore.js';

const STORAGE_KEY = 'reha_audit_logs';
const MAX_LOGS = 3000;

export const AUDIT_CATEGORY = {
  SCHEDULE: 'SCHEDULE',
  APPOINTMENT: 'APPOINTMENT',
  PATIENT: 'PATIENT',
  SYSTEM: 'SYSTEM'
};

export const AUDIT_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  DISCONTINUE: 'DISCONTINUE',
  MOVE: 'MOVE',
  SYNC: 'SYNC'
};

/**
 * @typedef {Object} AuditLogEntry
 * @property {string} id
 * @property {string} timestamp
 * @property {string} displayTime
 * @property {string} operator
 * @property {string} hostname
 * @property {string} category
 * @property {string} action
 * @property {string} targetPatientId
 * @property {string} targetPatientName
 * @property {string} description
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 表示用ローカル日時
 * @param {Date} [date]
 * @returns {string}
 */
export function formatAuditDisplayTime(date = new Date()) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * 全ログ取得（新しい順）
 * @returns {AuditLogEntry[]}
 */
export function getAllAuditLogs() {
  try {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  } catch (e) {
    console.error('getAllAuditLogs error:', e);
    return [];
  }
}

/**
 * ログ配列を永続化（新しい順・上限付き）
 * @param {AuditLogEntry[]} logs
 * @returns {boolean}
 */
function saveAuditLogs(logs) {
  try {
    const trimmed = (Array.isArray(logs) ? logs : [])
      .slice()
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
      .slice(0, MAX_LOGS);
    return writeStorageItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('saveAuditLogs error:', e);
    return false;
  }
}

/**
 * 監査ログを1件追記（失敗しても業務処理は止めない）
 * @param {Object} partial
 * @returns {AuditLogEntry|null}
 */
export function appendAuditLog(partial = {}) {
  try {
    const ctx = resolveOperatorContext();
    const now = new Date();
    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now.toISOString(),
      displayTime: formatAuditDisplayTime(now),
      operator: partial.operator || ctx.operatorName,
      hostname: partial.hostname || ctx.hostname,
      category: partial.category || AUDIT_CATEGORY.SYSTEM,
      action: partial.action || AUDIT_ACTION.UPDATE,
      targetPatientId: partial.targetPatientId ? String(partial.targetPatientId) : '',
      targetPatientName: partial.targetPatientName ? String(partial.targetPatientName) : '',
      description: partial.description ? String(partial.description) : ''
    };

    const list = getAllAuditLogs();
    list.unshift(entry);
    saveAuditLogs(list);
    return entry;
  } catch (e) {
    console.warn('[auditLog] append soft-fail:', e);
    return null;
  }
}

/**
 * 他端末ログとのマージ（id ユニーク）
 * @param {AuditLogEntry[]} remoteLogs
 * @returns {number} 追加件数
 */
export function mergeAuditLogs(remoteLogs) {
  try {
    if (!Array.isArray(remoteLogs) || remoteLogs.length === 0) return 0;
    const local = getAllAuditLogs();
    const byId = new Map();
    local.forEach((l) => {
      if (l && l.id) byId.set(l.id, l);
    });
    let added = 0;
    remoteLogs.forEach((l) => {
      if (!l || !l.id) return;
      if (!byId.has(l.id)) {
        byId.set(l.id, l);
        added += 1;
      }
    });
    if (added > 0) {
      saveAuditLogs(Array.from(byId.values()));
    }
    return added;
  } catch (e) {
    console.warn('[auditLog] merge soft-fail:', e);
    return 0;
  }
}

/**
 * フィルタ付き取得
 * @param {{ category?: string, keyword?: string, limit?: number }} [opts]
 * @returns {AuditLogEntry[]}
 */
export function queryAuditLogs(opts = {}) {
  let list = getAllAuditLogs();
  const cat = opts.category && opts.category !== 'ALL' ? opts.category : '';
  const kw = (opts.keyword || '').trim().toLowerCase();
  if (cat) {
    list = list.filter((l) => l.category === cat);
  }
  if (kw) {
    list = list.filter((l) => {
      const hay = [
        l.operator, l.hostname, l.description,
        l.targetPatientId, l.targetPatientName, l.action, l.category, l.displayTime
      ].join(' ').toLowerCase();
      return hay.includes(kw);
    });
  }
  const limit = Number(opts.limit);
  if (Number.isFinite(limit) && limit > 0) {
    return list.slice(0, limit);
  }
  return list;
}
