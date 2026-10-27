// js/views/auditLogView.js
// 端末操作者バッジ・初回設定モーダル・操作履歴タイムライン UI

import { getActiveTherapists } from '../store/therapistStore.js';
import {
  getLocalOperator, setLocalOperator, hasLocalOperator,
  formatOperatorLabel, getTerminalHostname
} from '../store/operatorStore.js';
import {
  queryAuditLogs, AUDIT_CATEGORY, appendAuditLog, AUDIT_ACTION
} from '../store/auditLogStore.js';
import { showToast } from '../ui/toast.js';

const RECEPTION_OPTION = { id: 'RECEPTION', name: '受付', role: 'RECEPTION' };

/**
 * 操作者候補（稼働セラピスト + 受付）
 * @returns {Array<{id: string, name: string, role?: string}>}
 */
function getOperatorCandidates() {
  const list = getActiveTherapists().map((t) => ({
    id: t.id,
    name: t.name || t.id,
    role: t.role || ''
  }));
  list.push({ ...RECEPTION_OPTION });
  return list;
}

/**
 * ヘッダー操作者バッジを更新
 */
export function refreshOperatorBadge() {
  const nameEl = document.getElementById('currentOperatorName');
  const badge = document.getElementById('operatorBadge');
  const op = getLocalOperator();
  if (nameEl) {
    nameEl.textContent = op?.name || '未設定';
  }
  if (badge) {
    badge.title = formatOperatorLabel(op);
    badge.classList.toggle('operator-badge-unset', !op);
  }
}

/**
 * 操作者選択モーダルを開く
 * @param {{ force?: boolean }} [opts]
 */
export function openOperatorSelectModal(opts = {}) {
  const modal = document.getElementById('modalOperatorSelect');
  const select = document.getElementById('operatorSelectInput');
  const hostEl = document.getElementById('operatorModalHostname');
  if (!modal || !select) return;

  const candidates = getOperatorCandidates();
  const current = getLocalOperator();
  select.innerHTML = candidates.map((c) => {
    const selected = current && current.therapistId === c.id ? 'selected' : '';
    return `<option value="${c.id}" data-name="${escapeAttr(c.name)}" data-role="${escapeAttr(c.role || '')}" ${selected}>${escapeHtml(c.name)}</option>`;
  }).join('');

  if (hostEl) {
    hostEl.textContent = getTerminalHostname();
  }

  const titleEl = document.getElementById('operatorModalTitle');
  if (titleEl) {
    titleEl.textContent = opts.force || !hasLocalOperator()
      ? 'このPCの主な担当者を設定'
      : '操作者を変更';
  }

  modal.classList.add('active');
}

function closeOperatorSelectModal() {
  document.getElementById('modalOperatorSelect')?.classList.remove('active');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function confirmOperatorSelection() {
  const select = document.getElementById('operatorSelectInput');
  if (!select || !select.value) {
    showToast('担当者を選択してください', 'warn');
    return;
  }
  const opt = select.options[select.selectedIndex];
  const name = opt?.dataset?.name || opt?.textContent || '';
  const role = opt?.dataset?.role || '';
  const ok = setLocalOperator({
    therapistId: select.value,
    name: name.trim(),
    role
  });
  if (!ok) {
    showToast('操作者の保存に失敗しました', 'error');
    return;
  }

  appendAuditLog({
    category: AUDIT_CATEGORY.SYSTEM,
    action: AUDIT_ACTION.UPDATE,
    description: `端末操作者を「${name.trim()}」に設定`
  });

  refreshOperatorBadge();
  closeOperatorSelectModal();
  showToast(`操作者を「${name.trim()}」に固定しました`, 'success');
  renderAuditTimeline();
}

/**
 * 操作履歴タイムライン描画
 */
export function renderAuditTimeline() {
  const container = document.getElementById('auditTimelineContainer');
  if (!container) return;

  const category = document.getElementById('auditCategoryFilter')?.value || 'ALL';
  const keyword = document.getElementById('auditSearchInput')?.value || '';
  const logs = queryAuditLogs({ category, keyword, limit: 200 });

  if (logs.length === 0) {
    container.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:0.82rem;">操作履歴はまだありません</div>';
    return;
  }

  const actionLabel = {
    CREATE: '登録',
    UPDATE: '更新',
    DELETE: '削除',
    DISCONTINUE: '終了',
    MOVE: '移動',
    SYNC: '同期'
  };
  const catLabel = {
    SCHEDULE: '時間割',
    APPOINTMENT: '外来予約',
    PATIENT: '患者台帳',
    SYSTEM: 'システム'
  };

  container.innerHTML = logs.map((log) => {
    const patient = log.targetPatientName
      ? `<span class="audit-patient">${escapeHtml(log.targetPatientId ? `${log.targetPatientId} ` : '')}${escapeHtml(log.targetPatientName)}</span>`
      : '';
    return `
      <div class="audit-timeline-item" data-category="${escapeAttr(log.category)}">
        <div class="audit-time">${escapeHtml(log.displayTime || '')}</div>
        <div class="audit-body">
          <div class="audit-meta">
            <span class="audit-cat">${escapeHtml(catLabel[log.category] || log.category)}</span>
            <span class="audit-action">${escapeHtml(actionLabel[log.action] || log.action)}</span>
            <span class="audit-operator">${escapeHtml(log.operator || '')} <span class="audit-host">(${escapeHtml(log.hostname || '')})</span></span>
          </div>
          <div class="audit-desc">${escapeHtml(log.description || '')}${patient ? ` · ${patient}` : ''}</div>
        </div>
      </div>`;
  }).join('');
}

/**
 * 初期化（バッジ・モーダル・タイムライン）
 */
export function initAuditLogView() {
  refreshOperatorBadge();

  document.getElementById('btnChangeOperator')?.addEventListener('click', () => {
    openOperatorSelectModal({ force: false });
  });

  document.getElementById('btnCloseOperatorModal')?.addEventListener('click', () => {
    if (!hasLocalOperator()) {
      showToast('操作者を設定してください（監査ログに必須です）', 'warn');
      return;
    }
    closeOperatorSelectModal();
  });

  document.getElementById('btnConfirmOperator')?.addEventListener('click', () => {
    confirmOperatorSelection();
  });

  document.getElementById('auditCategoryFilter')?.addEventListener('change', () => renderAuditTimeline());
  document.getElementById('auditSearchInput')?.addEventListener('input', () => renderAuditTimeline());
  document.getElementById('btnRefreshAuditTimeline')?.addEventListener('click', () => {
    renderAuditTimeline();
    showToast('操作履歴を更新しました', 'success');
  });

  // 初回未設定ならモーダルを自動表示
  if (!hasLocalOperator()) {
    setTimeout(() => openOperatorSelectModal({ force: true }), 400);
  }

  renderAuditTimeline();
}
