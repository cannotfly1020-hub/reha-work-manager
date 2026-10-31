// js/views/exportView.js
// VIEW 5: Excel原本出力・バックアップ＆復元・Electron PC自動保存状態・アーカイブ状態表示

import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import {
  loadMonthOnDemand, loadYearOnDemand, loadFiscalYearOnDemand, getArchiveStats
} from '../store/archiveManager.js';
import { resolveFiscalStartYear } from '../excel/sheets/yearlyTrendSheet.js';
import { safeParseInt } from '../core/dataNormalizer.js';
import { showToast } from '../ui/toast.js';
import {
  setupBackupAndRestoreListeners, triggerDailyAutoBackup
} from '../backup/backupService.js';
import {
  isElectronDesktop,
  openElectronBackupFolder,
  getElectronBackupUiState,
  getElectronBackupFolderLabel
} from '../backup/localFileBackup.js';
import { generateUketsukeWorkbook } from '../excel/uketsukeWriter.js';
import { generateDiaryWorkbook } from '../excel/diaryWriter.js';
import { initSharedFolderUi, refreshSharedFolderStatusUi } from '../ui/sharedFolderUi.js';

export function initExportView() {
  const monthInput = document.getElementById('exportMonthInput');
  const btnUketsuke = document.getElementById('btnExportUketsuke');
  const btnDiary = document.getElementById('btnExportDiary');

  if (monthInput && !monthInput.value) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    monthInput.value = `${y}-${m}`;
  }

  btnUketsuke?.addEventListener('click', () => handleExportUketsuke(monthInput));
  btnDiary?.addEventListener('click', () => handleExportDiary(monthInput));

  setupBackupAndRestoreListeners();
  setupLocalBackupFolderUi();
  initSharedFolderUi();
  refreshArchiveStatusUi();

  window.triggerDailyBackup = triggerDailyAutoBackup;
}

/** 共有フォルダステータス再描画（外部から呼び出し可） */
export { refreshSharedFolderStatusUi };

/**
 * Electron 自動バックアップ表示＋フォルダを開くボタンのみ
 */
function setupLocalBackupFolderUi() {
  const btnOpen = document.getElementById('btnOpenBackupFolder');

  refreshBackupFolderStatusUi();

  btnOpen?.addEventListener('click', async () => {
    if (!isElectronDesktop()) {
      showToast('バックアップフォルダを開く機能はデスクトップアプリ版でのみ利用できます', 'warn');
      return;
    }
    const result = await openElectronBackupFolder();
    if (result.success) {
      showToast(`📂 ${getElectronBackupFolderLabel()} を開きました`, 'success');
    } else {
      showToast(result.message || 'バックアップフォルダを開けませんでした', 'warn');
    }
  });
}

/**
 * PC自動保存ステータス表示を更新（Electron 1本化）
 */
export function refreshBackupFolderStatusUi() {
  const badge = document.getElementById('backupFolderStatusBadge');
  const btnOpen = document.getElementById('btnOpenBackupFolder');
  if (!badge) return;

  const state = getElectronBackupUiState();

  if (state.isDesktop) {
    badge.textContent = `🟢 PC自動保存: 有効 (${state.folderLabel})`;
    badge.style.color = '#15803d';
    if (btnOpen) {
      btnOpen.style.display = '';
      btnOpen.disabled = false;
    }
  } else {
    badge.textContent = '📂 PC自動保存: デスクトップアプリ版で有効（ブラウザ単体起動時は対象外）';
    badge.style.color = '#64748b';
    if (btnOpen) {
      btnOpen.style.display = '';
      btnOpen.disabled = true;
      btnOpen.title = 'デスクトップアプリ版でのみ利用できます';
    }
  }
}

/**
 * アーカイブ保管状態バッジを更新
 */
export function refreshArchiveStatusUi() {
  const el = document.getElementById('archiveStorageStatusBadge');
  if (!el) return;
  try {
    const stats = getArchiveStats();
    el.textContent = `📦 データ保管状態: アクティブ ${stats.activeInMemory}件 / アーカイブ退避 ${stats.archivedCount}件`;
  } catch (_) {
    el.textContent = '📦 データ保管状態: —';
  }
}

async function handleExportUketsuke(monthInput) {
  const [year, month] = parseYearMonth(monthInput?.value);
  if (!year || !month) return showToast('出力対象年月を正しく選択してください', 'warn');

  if (typeof window.XLSX === 'undefined') {
    return showToast('SheetJS が読み込まれていません。js/vendor/xlsx.bundle.js を確認してください。', 'error');
  }

  showToast(`${year}年${month}月 受付提出用Excelを集計・生成中...`, 'info');
  try {
    await loadMonthOnDemand(year, month);
    // 年間推移シート用: 診療報酬年度（4月〜翌3月）を先読み
    const fiscalStart = resolveFiscalStartYear(year, month);
    await loadFiscalYearOnDemand(fiscalStart);
    // カレンダー年も可能な範囲で補完（他シート互換）
    await loadYearOnDemand(year);
    refreshArchiveStatusUi();

    const aggregated = aggregateFromAppSchedule(year, month);
    const wb = generateUketsukeWorkbook(aggregated, null);
    if (!wb) return showToast('受付提出用Excelの生成に失敗しました', 'error');

    const filename = `受付提出用_実施リスト_${year}年${String(month).padStart(2, '0')}月.xlsx`;
    window.XLSX.writeFile(wb, filename);
    showToast(`受付提出用Excelを出力しました: ${filename}`, 'success');
  } catch (error) {
    console.error('Uketsuke Export Error:', error);
    showToast(`出力エラー: ${error.message || 'データ集計に失敗しました'}`, 'error');
  }
}

async function handleExportDiary(monthInput) {
  const [year, month] = parseYearMonth(monthInput?.value);
  if (!year || !month) return showToast('出力対象年月を正しく選択してください', 'warn');

  if (typeof window.XLSX === 'undefined') {
    return showToast('SheetJS が読み込まれていません。js/vendor/xlsx.bundle.js を確認してください。', 'error');
  }

  const now = new Date();
  const isCurrentMonth = (now.getFullYear() === year && (now.getMonth() + 1) === month);
  const targetDay = isCurrentMonth ? now.getDate() : null;

  const targetRangeStr = isCurrentMonth ? `1日〜${targetDay}日 (当日累積)` : '1日〜月末';
  showToast(`${year}年${month}月 業務日誌Excelを集計中 (${targetRangeStr})...`, 'info');

  try {
    await loadMonthOnDemand(year, month);
    refreshArchiveStatusUi();

    const aggregated = aggregateFromAppSchedule(year, month);
    const wb = generateDiaryWorkbook(aggregated, targetDay);
    if (!wb) return showToast('業務日誌Excelの生成に失敗しました', 'error');

    const filename = `業務日誌_${year}年${String(month).padStart(2, '0')}月.xlsx`;
    window.XLSX.writeFile(wb, filename);
    showToast(`業務日誌Excelを出力しました (${targetRangeStr}): ${filename}`, 'success');
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
