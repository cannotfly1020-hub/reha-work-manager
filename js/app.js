/**
 * @file app.js
 * @description リハビリ業務管理Webアプリ（reha-work-manager）メインコントローラー
 * 
 * - UIイベントリスナーの設定
 * - リハ記録(A/B/C)および原本テンプレートExcelファイルのドラッグ＆ドロップ処理
 * - 集計実行・プレビューレンダリング
 * - 受付提出用Excel / 業務日誌Excelの出力トリガー
 * - 患者マスター管理（期限・早期加算起算日・発症日・月13単位）のUI連動
 * - 物品貸出管理（当院備品・外部業者借用又貸し）のUI連動
 * - 完全オフライン・外部通信ゼロ設計
 */

import { REHA_RULES } from './config/rules.js';
import { calculatePatientDeadlines, formatDate } from './core/deadlineCalc.js';
import { normalizePatientId } from './core/dataNormalizer.js';
import { readWorkbookFromFile, aggregateRehaRecords } from './excel/rehaRecordParser.js';
import { exportUketsukeSubmissionWorkbook } from './excel/uketsukeWriter.js';
import { exportDiaryWorkbook } from './excel/diaryWriter.js';
import { getAllPatients, getPatientById, upsertPatient, exportPatientsAsJson, importPatientsFromJson } from './store/patientStore.js';
import { getAllLoans, registerLoan, markAsReturned, deleteLoan } from './store/loanStore.js';

// アプリケーション内インメモリ状態
const state = {
  activeTab: 'reha-aggregate', // 'reha-aggregate' | 'patient-deadlines' | 'equipment-loans'
  targetYear: 2026,
  targetMonth: 7,
  // 読み込まれたExcelファイル (SheetJS Workbooks)
  files: {
    rehaA: null,
    rehaB: null,
    rehaC: null,
    uketsukeTemplate: null,
    diaryTemplate: null,
  },
  // 直近の集計結果キャッシュ
  lastAggregated: null,
};

/**
 * アプリ初期化
 */
document.addEventListener('DOMContentLoaded', () => {
  initDateSelectors();
  initTabNavigation();
  initFileUploadHandlers();
  initActionButtons();
  initPatientModal();
  initLoanModal();

  // 初期画面の描画
  renderPatientDeadlinesTable();
  renderEquipmentLoansTable();
  updateFileStatusBadges();
});

/**
 * 年月セレクトボックスの初期化
 */
function initDateSelectors() {
  const yearSelect = document.getElementById('target-year');
  const monthSelect = document.getElementById('target-month');

  const now = new Date();
  const currentYear = now.getFullYear();

  if (yearSelect) {
    yearSelect.innerHTML = '';
    for (let y = currentYear - 1; y <= currentYear + 3; y++) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = `${y}年 (R${y - 2018})`;
      if (y === state.targetYear) opt.selected = true;
      yearSelect.appendChild(opt);
    }
    yearSelect.addEventListener('change', (e) => {
      state.targetYear = parseInt(e.target.value, 10);
    });
  }

  if (monthSelect) {
    monthSelect.value = String(state.targetMonth);
    monthSelect.addEventListener('change', (e) => {
      state.targetMonth = parseInt(e.target.value, 10);
    });
  }
}

/**
 * タブ切り替え処理
 */
function initTabNavigation() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target;
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const activePanel = document.getElementById(targetId);
      if (activePanel) activePanel.classList.add('active');

      state.activeTab = targetId;

      // タブごとのデータ再描画
      if (targetId === 'patient-deadlines') {
        renderPatientDeadlinesTable();
      } else if (targetId === 'equipment-loans') {
        renderEquipmentLoansTable();
      }
    });
  });
}

/**
 * ファイル入力・ドラッグ＆ドロップハンドラー初期化
 */
function initFileUploadHandlers() {
  const fileConfigs = [
    { key: 'rehaA', inputId: 'file-input-rehaA', dropId: 'drop-zone-rehaA' },
    { key: 'rehaB', inputId: 'file-input-rehaB', dropId: 'drop-zone-rehaB' },
    { key: 'rehaC', inputId: 'file-input-rehaC', dropId: 'drop-zone-rehaC' },
    { key: 'uketsukeTemplate', inputId: 'file-input-uketsuke', dropId: 'drop-zone-uketsuke' },
    { key: 'diaryTemplate', inputId: 'file-input-diary', dropId: 'drop-zone-diary' },
  ];

  fileConfigs.forEach(({ key, inputId, dropId }) => {
    const input = document.getElementById(inputId);
    const dropZone = document.getElementById(dropId);

    if (input) {
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) await handleFileLoaded(key, file);
      });
    }

    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) await handleFileLoaded(key, file);
      });
      dropZone.addEventListener('click', () => {
        if (input) input.click();
      });
    }
  });
}

/**
 * 読み込まれたExcelファイルを解析して状態に保持
 */
async function handleFileLoaded(fileKey, file) {
  showToast(`${file.name} を読み込み中...`, 'info');
  try {
    const wb = await readWorkbookFromFile(file);
    state.files[fileKey] = wb;
    updateFileStatusBadges();
    showToast(`${file.name} の読み込みが完了しました。`, 'success');
  } catch (err) {
    console.error(`[App] ファイル読み込みエラー:`, err);
    showToast(`読み込み失敗: ${err.message}`, 'error');
  }
}

/**
 * ファイル読み込み状況バッジの更新
 */
function updateFileStatusBadges() {
  const badgeMap = {
    rehaA: document.getElementById('badge-rehaA'),
    rehaB: document.getElementById('badge-rehaB'),
    rehaC: document.getElementById('badge-rehaC'),
    uketsukeTemplate: document.getElementById('badge-uketsuke'),
    diaryTemplate: document.getElementById('badge-diary'),
  };

  for (const [key, badge] of Object.entries(badgeMap)) {
    if (badge) {
      if (state.files[key]) {
        badge.textContent = '読込済 ✓';
        badge.className = 'status-badge loaded';
      } else {
        badge.textContent = '未選択';
        badge.className = 'status-badge waiting';
      }
    }
  }

  // 集計ボタンの有効化判定（A/B/Cのうち少なくとも1つあれば集計可能）
  const btnAggregate = document.getElementById('btn-run-aggregate');
  const hasReha = state.files.rehaA || state.files.rehaB || state.files.rehaC;
  if (btnAggregate) {
    btnAggregate.disabled = !hasReha;
  }
}

/**
 * 各種アクションボタンのイベント設定
 */
function initActionButtons() {
  // 集計実行ボタン
  const btnRun = document.getElementById('btn-run-aggregate');
  if (btnRun) {
    btnRun.addEventListener('click', runAggregation);
  }

  // 受付提出用Excel出力ボタン
  const btnExportUketsuke = document.getElementById('btn-export-uketsuke');
  if (btnExportUketsuke) {
    btnExportUketsuke.addEventListener('click', exportUketsuke);
  }

  // 業務日誌Excel出力ボタン
  const btnExportDiary = document.getElementById('btn-export-diary');
  if (btnExportDiary) {
    btnExportDiary.addEventListener('click', exportDiary);
  }
}

/**
 * リハ記録の集計処理を実行
 */
function runAggregation() {
  const workbooks = [];
  if (state.files.rehaA) workbooks.push({ therapistCode: 'A', workbook: state.files.rehaA });
  if (state.files.rehaB) workbooks.push({ therapistCode: 'B', workbook: state.files.rehaB });
  if (state.files.rehaC) workbooks.push({ therapistCode: 'C', workbook: state.files.rehaC });

  if (workbooks.length === 0) {
    showToast('リハ記録ファイルが1つも読み込まれていません。', 'warning');
    return;
  }

  showToast('リハ記録を集計中...', 'info');

  try {
    const aggregated = aggregateRehaRecords(workbooks, state.targetMonth, state.targetYear);
    state.lastAggregated = aggregated;

    renderAggregatePreview(aggregated);
    showToast(`集計完了: ${aggregated.rawRecordsCount}件のコマを抽出しました。`, 'success');

    // 出力ボタンの有効化
    const btnUketsuke = document.getElementById('btn-export-uketsuke');
    const btnDiary = document.getElementById('btn-export-diary');
    if (btnUketsuke) btnUketsuke.disabled = !state.files.uketsukeTemplate;
    if (btnDiary) btnDiary.disabled = !state.files.diaryTemplate;
  } catch (err) {
    console.error('[App] 集計実行失敗:', err);
    showToast(`集計エラー: ${err.message}`, 'error');
  }
}

/**
 * 集計プレビューテーブルを描画
 */
function renderAggregatePreview(aggregated) {
  const container = document.getElementById('aggregate-preview-container');
  if (!container) return;

  const { targetYear, targetMonth, activePatientIds, byPatientAndDate, patientTotals } = aggregated;
  const daysInMonth = aggregated.daysInMonth;

  let html = `
    <div class="preview-header">
      <h3>【${targetYear}年${targetMonth}月度 集計プレビュー】 実施患者数: ${activePatientIds.length}名 / 総コマ数: ${aggregated.rawRecordsCount}</h3>
    </div>
    <div class="table-responsive">
      <table class="preview-table">
        <thead>
          <tr>
            <th class="sticky-col">患者記号</th>
            <th class="sticky-col-2">月間合計単位</th>
  `;

  for (let d = 1; d <= daysInMonth; d++) {
    html += `<th>${d}日</th>`;
  }
  html += `</tr></thead><tbody>`;

  activePatientIds.forEach((pId) => {
    const total = patientTotals[pId]?.totalUnits || 0;
    const pData = byPatientAndDate[pId] || {};

    html += `
      <tr>
        <td class="sticky-col font-bold">${pId.toUpperCase()}</td>
        <td class="sticky-col-2 font-bold highlight-cell">${total}</td>
    `;

    for (let d = 1; d <= daysInMonth; d++) {
      const dObj = new Date(targetYear, targetMonth - 1, d);
      const dStr = formatDate(dObj);
      const val = pData[dStr]?.total || '';
      html += `<td class="${val ? 'has-unit' : ''}">${val || '-'}</td>`;
    }
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

/**
 * 受付提出用Excelのダウンロード出力
 */
function exportUketsuke() {
  if (!state.lastAggregated) {
    showToast('まずは集計を実行してください。', 'warning');
    return;
  }
  if (!state.files.uketsukeTemplate) {
    showToast('受付提出用原本ファイルが読み込まれていません。', 'warning');
    return;
  }

  try {
    const filename = `受付提出_単位管理_R${state.targetYear - 2018}.${state.targetMonth}_集計済.xlsx`;
    exportUketsukeSubmissionWorkbook(state.files.uketsukeTemplate, state.lastAggregated, filename);
    showToast(`${filename} を出力しました。`, 'success');
  } catch (err) {
    console.error('[App] 受付提出Excel出力エラー:', err);
    showToast(`出力失敗: ${err.message}`, 'error');
  }
}

/**
 * 業務日誌Excelのダウンロード出力
 */
function exportDiary() {
  if (!state.lastAggregated) {
    showToast('まずは集計を実行してください。', 'warning');
    return;
  }
  if (!state.files.diaryTemplate) {
    showToast('業務日誌原本ファイルが読み込まれていません。', 'warning');
    return;
  }

  try {
    const filename = `業務日誌_R${state.targetYear - 2018}.${state.targetMonth}_集計済.xlsx`;
    exportDiaryWorkbook(state.files.diaryTemplate, state.lastAggregated, filename);
    showToast(`${filename} を出力しました。`, 'success');
  } catch (err) {
    console.error('[App] 業務日誌Excel出力エラー:', err);
    showToast(`出力失敗: ${err.message}`, 'error');
  }
}

/**
 * 患者期限管理一覧テーブルを描画
 */
function renderPatientDeadlinesTable() {
  const tbody = document.getElementById('patient-deadlines-tbody');
  if (!tbody) return;

  const patients = getAllPatients();
  const today = new Date();

  tbody.innerHTML = '';

  patients.forEach((p) => {
    // 期限計算エンジンの呼び出し
    const dInfo = calculatePatientDeadlines(p, today);
    const tr = document.createElement('tr');

    let badgeClass = 'badge-success';
    let badgeText = '正常';

    if (dInfo.planStatus === 'EXPIRED' || dInfo.unitAlertStatus === 'EXCEEDED') {
      badgeClass = 'badge-danger';
      badgeText = '要対応！';
    } else if (dInfo.planStatus === 'WARNING' || dInfo.rehaLimitStatus === 'WARNING' || dInfo.unitAlertStatus === 'NEAR_LIMIT') {
      badgeClass = 'badge-warning';
      badgeText = '期限間近';
    }

    // 早期加算のラベル
    let earlyLabel = '-';
    if (dInfo.earlyBonusStatus === 'PHASE_1_ACTIVE') earlyLabel = `<span class="tag-info">4日以内(60点)</span>`;
    else if (dInfo.earlyBonusStatus === 'PHASE_2_ACTIVE') earlyLabel = `<span class="tag-info">14日以内(25点)</span>`;
    else if (dInfo.earlyBonusStatus === 'EXPIRED') earlyLabel = `<span class="tag-muted">加算期間終了</span>`;

    tr.innerHTML = `
      <td class="font-bold">${p.id.toUpperCase()}</td>
      <td>${p.name || `患者${p.id.toUpperCase()}`}</td>
      <td>${dInfo.diseaseLabel || '運動器Ⅱ'}</td>
      <td>${p.admissionDate || '-'}</td>
      <td>${p.earlyBonusStartDate || p.admissionDate || '-'}</td>
      <td>${p.onsetDate || p.admissionDate || '-'}</td>
      <td>${earlyLabel}</td>
      <td>${dInfo.nextPlanLimitStr || '-'}</td>
      <td>${dInfo.rehaLimitDateStr || '上限なし'}</td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      <td>
        <button class="btn-sm btn-outline btn-edit-patient" data-id="${p.id}">編集</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 編集ボタンへのリスナー設定
  tbody.querySelectorAll('.btn-edit-patient').forEach((btn) => {
    btn.addEventListener('click', () => {
      openPatientEditModal(btn.dataset.id);
    });
  });
}

/**
 * 患者編集モーダルの初期化
 */
function initPatientModal() {
  const modal = document.getElementById('patient-modal');
  const closeBtn = document.getElementById('modal-close-patient');
  const cancelBtn = document.getElementById('btn-cancel-patient');
  const saveBtn = document.getElementById('btn-save-patient');

  const closeModal = () => modal?.classList.remove('show');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  saveBtn?.addEventListener('click', () => {
    const id = document.getElementById('patient-modal-id')?.value;
    const name = document.getElementById('patient-modal-name')?.value;
    const diseaseType = document.getElementById('patient-modal-disease')?.value;
    const category = document.getElementById('patient-modal-category')?.value;
    const admissionDate = document.getElementById('patient-modal-admission')?.value;
    const earlyBonusStartDate = document.getElementById('patient-modal-early-start')?.value;
    const onsetDate = document.getElementById('patient-modal-onset')?.value;
    const lastPlanDate = document.getElementById('patient-modal-last-plan')?.value;
    const isLimitExempt = document.getElementById('patient-modal-exempt')?.checked;
    const notes = document.getElementById('patient-modal-notes')?.value;

    try {
      upsertPatient({
        id,
        name,
        diseaseType,
        category,
        admissionDate,
        earlyBonusStartDate,
        onsetDate,
        lastPlanDate,
        isLimitExempt,
        notes,
      });
      showToast(`患者 ${id.toUpperCase()} の情報を更新しました。`, 'success');
      closeModal();
      renderPatientDeadlinesTable();
    } catch (err) {
      showToast(`保存失敗: ${err.message}`, 'error');
    }
  });

  // 新規追加ボタン
  const btnNewPatient = document.getElementById('btn-add-patient');
  if (btnNewPatient) {
    btnNewPatient.addEventListener('click', () => {
      openPatientEditModal('');
    });
  }
}

/**
 * 患者編集モーダルを開く
 */
function openPatientEditModal(patientId) {
  const modal = document.getElementById('patient-modal');
  if (!modal) return;

  const patient = patientId ? getPatientById(patientId) : null;

  document.getElementById('patient-modal-id').value = patient ? patient.id : '';
  document.getElementById('patient-modal-id').readOnly = Boolean(patient);
  document.getElementById('patient-modal-name').value = patient?.name || '';
  document.getElementById('patient-modal-disease').value = patient?.diseaseType || 'LOCOMOTIVE';
  document.getElementById('patient-modal-category').value = patient?.category || 'inpatient_1';
  document.getElementById('patient-modal-admission').value = patient?.admissionDate || '';
  document.getElementById('patient-modal-early-start').value = patient?.earlyBonusStartDate || '';
  document.getElementById('patient-modal-onset').value = patient?.onsetDate || '';
  document.getElementById('patient-modal-last-plan').value = patient?.lastPlanDate || '';
  document.getElementById('patient-modal-exempt').checked = Boolean(patient?.isLimitExempt);
  document.getElementById('patient-modal-notes').value = patient?.notes || '';

  modal.classList.add('show');
}

/**
 * 物品貸出管理一覧テーブルを描画
 */
function renderEquipmentLoansTable() {
  const tbody = document.getElementById('loans-tbody');
  if (!tbody) return;

  const loans = getAllLoans();
  tbody.innerHTML = '';

  if (loans.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">現在、登録されている物品貸出記録はありません。</td></tr>`;
    return;
  }

  loans.forEach((loan) => {
    const tr = document.createElement('tr');
    const isVendor = loan.ownerType === 'VENDOR';
    const isLoaned = loan.status === 'LOANED';

    const ownerBadge = isVendor
      ? `<span class="tag-vendor">業者借用（${loan.vendorName || '外部業者'}）</span>`
      : `<span class="tag-hospital">当院備品</span>`;

    const statusBadge = isLoaned
      ? `<span class="badge badge-warning">貸出中</span>`
      : `<span class="badge badge-success">返却済 (${loan.returnDate || ''})</span>`;

    tr.innerHTML = `
      <td class="font-bold">${loan.itemName}</td>
      <td>${loan.patientId ? loan.patientId.toUpperCase() : '-'}</td>
      <td>${ownerBadge}</td>
      <td>${loan.loanDate || '-'}</td>
      <td>${loan.dueDate || '-'}</td>
      <td>${statusBadge}</td>
      <td class="text-muted text-sm">${loan.notes || ''}</td>
      <td>
        ${isLoaned ? `<button class="btn-sm btn-primary btn-return-loan" data-id="${loan.id}">返却完了にする</button>` : ''}
        <button class="btn-sm btn-outline-danger btn-delete-loan" data-id="${loan.id}">削除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // リスナー登録
  tbody.querySelectorAll('.btn-return-loan').forEach((btn) => {
    btn.addEventListener('click', () => {
      markAsReturned(btn.dataset.id);
      showToast('物品の返却完了を記録しました。', 'success');
      renderEquipmentLoansTable();
    });
  });

  tbody.querySelectorAll('.btn-delete-loan').forEach((btn) => {
    btn.addEventListener('click', () => {
      deleteLoan(btn.dataset.id);
      showToast('貸出記録を削除しました。', 'info');
      renderEquipmentLoansTable();
    });
  });
}

/**
 * 物品貸出登録モーダルの初期化
 */
function initLoanModal() {
  const modal = document.getElementById('loan-modal');
  const openBtn = document.getElementById('btn-add-loan');
  const closeBtn = document.getElementById('modal-close-loan');
  const cancelBtn = document.getElementById('btn-cancel-loan');
  const saveBtn = document.getElementById('btn-save-loan');
  const ownerTypeSelect = document.getElementById('loan-owner-type');
  const vendorGroup = document.getElementById('vendor-name-group');

  const closeModal = () => modal?.classList.remove('show');

  openBtn?.addEventListener('click', () => {
    // 今日をデフォルト
    const now = new Date();
    document.getElementById('loan-date').value = formatDate(now);
    document.getElementById('loan-item-name').value = '';
    document.getElementById('loan-patient-id').value = '';
    document.getElementById('loan-vendor-name').value = '';
    document.getElementById('loan-notes').value = '';
    modal?.classList.add('show');
  });

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  ownerTypeSelect?.addEventListener('change', (e) => {
    if (vendorGroup) {
      vendorGroup.style.display = e.target.value === 'VENDOR' ? 'block' : 'none';
    }
  });

  saveBtn?.addEventListener('click', () => {
    const itemName = document.getElementById('loan-item-name')?.value;
    const patientId = document.getElementById('loan-patient-id')?.value;
    const ownerType = document.getElementById('loan-owner-type')?.value;
    const vendorName = document.getElementById('loan-vendor-name')?.value;
    const loanDate = document.getElementById('loan-date')?.value;
    const dueDate = document.getElementById('loan-due-date')?.value;
    const notes = document.getElementById('loan-notes')?.value;

    if (!itemName || !itemName.trim()) {
      showToast('物品名を入力してください。', 'warning');
      return;
    }

    try {
      registerLoan({
        itemName,
        patientId,
        ownerType,
        vendorName,
        loanDate,
        dueDate,
        notes,
      });
      showToast('物品の貸出を登録しました。', 'success');
      closeModal();
      renderEquipmentLoansTable();
    } catch (err) {
      showToast(`登録エラー: ${err.message}`, 'error');
    }
  });
}

/**
 * 画面下部にトーストメッセージを表示
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
