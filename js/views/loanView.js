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

  // 固定幅を撤廃し、期間や所有区分をコンパクトに統合した1画面収容テーブル
  let html = `
    <table class="modern-table" style="width:100%; table-layout:auto; font-size:0.78rem;">
      <thead>
        <tr>
          <th style="padding:6px 6px;">No</th>
          <th style="padding:6px 8px;">対象患者</th>
          <th style="padding:6px 8px;">物品・装具名</th>
          <th style="padding:6px 6px; text-align:center;">区分 / 業者</th>
          <th style="padding:6px 6px;">貸出日 / 返却期日</th>
          <th style="padding:6px 6px; text-align:center; width:64px;">状態</th>
          <th style="padding:6px 6px;">備考</th>
          <th style="padding:6px 6px; text-align:center; width:88px;">操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  const todayStr = new Date().toISOString().split('T')[0];

  loans.forEach((item) => {
    const isActive = item.status === 'ACTIVE';
    const isOverdue = isActive && item.dueDate && item.dueDate < todayStr;

    // 状態バッジ（スリム化）
    let statusBadge = '<span style="background:#dcfce7; color:#15803d; padding:2px 6px; border-radius:3px; font-weight:700; font-size:0.72rem;">返却済</span>';
    if (isActive) {
      statusBadge = isOverdue
        ? '<span style="background:#ffe4e6; color:#e11d48; padding:2px 6px; border-radius:3px; font-weight:700; font-size:0.72rem;">期限超過</span>'
        : '<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:3px; font-weight:700; font-size:0.72rem;">貸出中</span>';
    }

    // 所有区分と業者名の2段表示
    const ownerDisplay = item.ownerType === 'VENDOR'
      ? `<span style="color:#7c3aed; font-weight:700;">業者借用</span><br><span style="font-size:0.68rem; color:#64748b;">${sanitizeHtml(item.vendorName || '-')}</span>`
      : `<span style="color:#475569; font-weight:700;">院内備品</span>`;

    // 貸出日と返却期日の2段表示
    const dateDisplay = `
      <div style="white-space:nowrap;">出: ${item.loanDate || '-'}</div>
      <div style="white-space:nowrap; ${isOverdue ? 'color:#e11d48; font-weight:700;' : 'color:#64748b;'}">
        期: ${item.dueDate || '指定なし'}
      </div>
    `;

    html += `
      <tr>
        <td style="padding:6px 6px; font-size:0.72rem; color:#64748b;">${item.id}</td>
        <td style="padding:6px 8px; white-space:nowrap;">
          <strong>${sanitizeHtml(item.patientName)}</strong><br>
          <span style="font-size:0.68rem; color:#64748b;">ID: ${item.patientId}</span>
        </td>
        <td style="padding:6px 8px;">
          <strong style="color:#0f172a;">${sanitizeHtml(item.itemName)}</strong>
        </td>
        <td style="padding:6px 6px; text-align:center;">${ownerDisplay}</td>
        <td style="padding:6px 6px; font-size:0.73rem;">${dateDisplay}</td>
        <td style="padding:6px 6px; text-align:center;">${statusBadge}</td>
        <td style="padding:6px 6px; font-size:0.73rem; color:#64748b; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${sanitizeHtml(item.notes || '')}">
          ${sanitizeHtml(item.notes || '-')}
        </td>
        <td style="padding:6px 6px; text-align:center; white-space:nowrap;">
          ${isActive ? `<button class="btn-return-loan" data-id="${item.id}" style="padding:2px 6px; font-size:0.72rem; background:#0284c7; color:#fff; border:none; border-radius:3px; cursor:pointer; margin-right:3px;">返却</button>` : ''}
          <button class="btn-delete-loan" data-id="${item.id}" style="padding:2px 5px; font-size:0.72rem; background:#fff; border:1px solid #cbd5e1; color:#ef4444; border-radius:3px; cursor:pointer;">削除</button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;

  attachLoanTableEvents(container);
}

function attachLoanTableEvents(container) {
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

export function openLoanRegisterModal() {
  const modal = document.getElementById('modalLoanRegister');
  const patientSelect = document.getElementById('loanPatientSelect');
  const vendorGroup = document.getElementById('loanVendorGroup');
  const ownerSelect = document.getElementById('loanOwnerType');

  if (patientSelect) {
    const patients = getAllPatients();
    patientSelect.innerHTML = '<option value="">-- 対象患者を選択してください --</option>' +
      patients.map((p) => `<option value="${p.id}" data-name="${sanitizeHtml(p.name)}">${p.id} - ${sanitizeHtml(p.name)} (${p.category === 'INPATIENT' ? '入院' : '外来'})</option>`).join('');
  }

  document.getElementById('loanItemName').value = '';
  document.getElementById('loanDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('loanDueDate').value = '';
  document.getElementById('loanNotes').value = '';
  if (ownerSelect) ownerSelect.value = 'HOSPITAL';
  if (vendorGroup) vendorGroup.style.display = 'none';

  modal.classList.add('active');
}
