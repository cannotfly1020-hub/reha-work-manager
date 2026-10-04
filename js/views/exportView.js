// js/views/exportView.js
// VIEW 5: 月末Excel原本出力アクション制御・ワンクリック自動生成・トースト通知管理層（200行制限準拠）

import { safeParseInt } from '../core/dataNormalizer.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { generateUketsukeWorkbook } from '../excel/uketsukeWriter.js';
import { generateDiaryWorkbook } from '../excel/diaryWriter.js';

/**
 * トースト通知を表示する（3.5秒で自動フェードアウト）
 * @param {string} message 
 * @param {'info'|'success'|'warn'|'error'} type 
 */
export function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function initExportView() {
  const monthInput = document.getElementById('exportMonthInput');
  const btnUketsuke = document.getElementById('btnExportUketsuke');
  const btnDiary = document.getElementById('btnExportDiary');

  // 初期年月設定（当月 YYYY-MM）
  if (monthInput && !monthInput.value) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    monthInput.value = `${y}-${m}`;
  }

  // 1. 受付提出用Excel出力ボタン（テンプレート選択完全撤廃・ワンクリック生成）
  btnUketsuke?.addEventListener('click', () => {
    handleExportUketsuke(monthInput);
  });

  // 2. 業務日誌Excel出力ボタン
  btnDiary?.addEventListener('click', () => {
    handleExportDiary(monthInput);
  });
}

function handleExportUketsuke(monthInput) {
  const [year, month] = parseYearMonth(monthInput?.value);
  if (!year || !month) {
    showToast('出力対象年月を正しく選択してください', 'warn');
    return;
  }

  showToast(`${year}年${month}月 受付提出用Excelを集計・生成中...`, 'info');

  try {
    const aggregated = aggregateFromAppSchedule(year, month);
    const wb = generateUketsukeWorkbook(aggregated, null);

    if (!wb) {
      showToast('受付提出用Excelの生成に失敗しました', 'error');
      return;
    }

    const filename = `受付提出用_実施リスト_${year}年${String(month).padStart(2, '0')}月.xlsx`;
    window.XLSX.writeFile(wb, filename);
    showToast(`受付提出用Excelを出力しました: ${filename}`, 'success');
  } catch (error) {
    console.error('Uketsuke Export Error:', error);
    showToast(`出力エラー: ${error.message || 'データ集計に失敗しました'}`, 'error');
  }
}

function handleExportDiary(monthInput) {
  const [year, month] = parseYearMonth(monthInput?.value);
  if (!year || !month) {
    showToast('出力対象年月を正しく選択してください', 'warn');
    return;
  }

  showToast(`${year}年${month}月 業務日誌Excelを集計・生成中...`, 'info');

  try {
    const aggregated = aggregateFromAppSchedule(year, month);
    const wb = generateDiaryWorkbook(aggregated, null);

    if (!wb) {
      showToast('業務日誌Excelの生成に失敗しました', 'error');
      return;
    }

    const filename = `業務日誌_${year}年${String(month).padStart(2, '0')}月.xlsx`;
    window.XLSX.writeFile(wb, filename);
    showToast(`業務日誌Excelを出力しました: ${filename}`, 'success');
  } catch (error) {
    console.error('Diary Export Error:', error);
    showToast(`出力エラー: ${error.message || '日誌集計に失敗しました'}`, 'error');
  }
}

function parseYearMonth(val) {
  if (!val) return [null, null];
  const parts = val.split('-');
  return [safeParseInt(parts[0]), safeParseInt(parts[1])];
}
