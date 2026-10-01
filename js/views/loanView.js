// js/views/loanView.js
// VIEW 4: リハビリ物品・装具貸出テーブル・返却・登録モーダル制御層（200行制限準拠）

import { sanitizeHtml } from '../core/dataNormalizer.js';
import { filterLoans, registerLoan, markAsReturned, deleteLoan } from '../store/loanStore.js';
import { getAllPatients } from '../store/patientStore.js';
import { showToast } from './exportView.js';

export function initLoanView() {
  const searchInput = document.getElementById('loanSearchInput');
  const statusFilter = document.getElementById('loanStatusFilter');
  const ownerFilter = document.getElementById('loanOwnerFilter');
  const btnNew = document.getElementById('btnNewLoan');

  searchInput?.addEventListener('input', () => renderLoanView());
  statusFilter?.addEventListener('change', () => renderLoanView());
  ownerFilter?.addEventListener('change', () => renderLoanView());

  btnNew?.addEventListener('click', openLoanRegisterModal);

  setupLoanModalListeners();
}

export function renderLoanView() {
  const container = document.getElementById('loanTableContainer');
  if (!container) return;

  const keyword = document.getElementById('loanSearchInput')?.value || '';
  const status = document.getElementById('loanStatusFilter')?.value || 'ALL';
  const ownerType = document.getElementById('loanOwnerFilter')?.value || 'ALL';

  const loans = filterLoans({ keyword, status, ownerType });

  if (loans.length === 0) {
    container.innerHTML = '<div style="padding:32px; text-align:center; color:#94a3b8; font-size:0.85rem;">該当する貸出記録がありません</div>';
    return;
  }

  let html = `
    <table class="modern-table">
      <thead>
        <tr>
          <th style="min-width:90px;">貸出番号</th>
          <th style="min-width:130px;">対象患者</th>
          <th style="min-width:160px;">物品・装具名</th>
          <th style="min-width:90px;">所有区分</th>
          <th style="min-width:110px;">業者名</th>
          <th style="min-width:95px;">貸出日</th>
          <th style="min-width:95px;">返却期日</th>
          <th style="min-width:85px;">状態</th>
          <th style="min-width:140px;">備考</th>
          <th style="min-width:120px; text-align:center;">操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  const todayStr = new Date().toISOString().split('T')[0];

  loans.forEach((item) => {
    const isActive = item.status === 'ACTIVE';
    const isOverdue = isActive && item.dueDate && item.dueDate < todayStr;

    let statusBadge = '<span style="background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.75rem;">返却済</span>';
    if (isActive) {
      statusBadge = isOverdue
        ? '<span style="background:#ffe4e6; color:#e11d48; padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.75rem;">期限超過</span>'
        : '<span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.75rem;">貸出中</span>';
    }

    const ownerBadge = item.ownerType === 'VENDOR'
      ? '<span style="color:#7c3aed; font-weight:600;">業者借用</span>'
      : '<span style="color:#475569; font-weight:600;">院内備品</span>';

    html += `
      <tr>
        <td style="font-size:0.75rem; color:#64748b;">${item.id}</td>
        <td><strong>${sanitizeHtml(item.patientName)}</strong> <span style="font-size:0.7rem; color:#64748b;">(${item.patientId})</span></td>
        <td><strong style="color:#0f172a;">${sanitizeHtml(item.itemName)}</strong></td>
        <td>${ownerBadge}</td>
        <td style="font-size:0.78rem;">${sanitizeHtml(item.vendorName || '-')}</td>
        <td style="font-size:0.78rem;">${item.loanDate || '-'}</td>
        <td style="font-size:0.78rem; ${isOverdue ? 'color:#e11d48; font-weight:700;' : ''}">${item.dueDate || '指定なし'}</td>
        <td>${statusBadge}</td>
        <td style="font-size:0.75rem; color:#64748b; max-width:140px; overflow:hidden; text-overflow:ellipsis;" title="${sanitizeHtml(item.notes || '')}">${sanitizeHtml(item.notes || '-')}</td>
        <td style="text-align:center;">
          ${isActive ? `<button class="btn-return-loan" data-id="${item.id}" style="padding:3px 8px; font-size:0.75rem; background:#0284c7; color:#fff; border:none; border-radius:4px; cursor:pointer; margin-right:4px;">返却</button>` : ''}
          <button class="btn-delete-loan" data-id="${item.id}" style="padding:3px 6px; font-size:0.75rem; background:#fff; border:1px solid #cbd5e1; color:#ef4444; border-radius:4px; cursor:pointer;">削除</button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;

  container.querySelectorAll('.btn-return-loan').forEach((btn) => {
    btn.addEventListener('click', () => {
      const success = markAsReturned(btn.dataset.id);
      if (success) {
        showToast('物品を返却済みに更新しました', 'success');
        renderLoanView();
      }
    });
  });

  container.querySelectorAll('.btn-delete-loan').forEach((btn) => {
    btn.addEventListener('click', () => {
      const success = deleteLoan(btn.dataset.id);
      if (success) {
        showToast('貸出レコードを削除しました', 'warn');
        renderLoanView();
      }
    });
  });
}

function setupLoanModalListeners() {
  const modal = document.getElementById('modalLoanRegister');
  const btnClose = document.getElementById('btnCloseLoanModal');
  const form = document.getElementById('loanRegisterForm');
  const ownerSelect = document.getElementById('loanOwnerType');
  const vendorGroup = document.getElementById('loanVendorGroup');

  btnClose?.addEventListener('click', () => modal.classList.remove('active'));

  ownerSelect?.addEventListener('change', (e) => {
    if (vendorGroup) {
      vendorGroup.style.display = e.target.value === 'VENDOR' ? 'block' : 'none';
    }
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const patientSelect = document.getElementById('loanPatientSelect');
    const selectedOption = patientSelect.options[patientSelect.selectedIndex];

    const rawData = {
      patientId: patientSelect.value,
      patientName: selectedOption ? selectedOption.dataset.name : '',
      itemName: document.getElementById('loanItemName').value,
      ownerType: document.getElementById('loanOwnerType').value,
      vendorName: document.getElementById('loanVendorName')?.value || '',
      loanDate: document.getElementById('loanDate').value,
      dueDate: document.getElementById('loanDueDate').value,
      notes: document.getElementById('loanNotes').value
    };

    const res = registerLoan(rawData);
    if (!res.success) {
      showToast(res.message || '貸出登録に失敗しました', 'error');
      return;
    }

    modal.classList.remove('active');
    showToast(`貸出登録完了: ${res.loan.itemName}`, 'success');
    renderLoanView();
  });
}

function openLoanRegisterModal() {
  const modal = document.getElementById('modalLoanRegister');
  const patientSelect = document.getElementById('loanPatientSelect');
  const vendorGroup = document.getElementById('loanVendorGroup');
  const ownerSelect = document.getElementById('loanOwnerType');

  // 患者選択肢を再構築
  if (patientSelect) {
    const patients = getAllPatients();
    patientSelect.innerHTML = '<option value="">-- 対象患者を選択してください --</option>' +
      patients.map((p) => `<option value="${p.id}" data-name="${sanitizeHtml(p.name)}">${p.id} - ${sanitizeHtml(p.name)} (${p.category === 'INPATIENT' ? '入院' : '外来'})</option>`).join('');
  }

  // フォーム初期化
  document.getElementById('loanItemName').value = '';
  document.getElementById('loanDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('loanDueDate').value = '';
  document.getElementById('loanNotes').value = '';
  if (ownerSelect) ownerSelect.value = 'HOSPITAL';
  if (vendorGroup) vendorGroup.style.display = 'none';

  modal.classList.add('active');
}
