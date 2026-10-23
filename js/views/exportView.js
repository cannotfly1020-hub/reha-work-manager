// js/views/exportView.js
// VIEW 5: Excel原本出力・バックアップ＆復元・PCフォルダ自動保存・アーカイブ状態表示

import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { loadMonthOnDemand, loadYearOnDemand, getArchiveStats } from '../store/archiveManager.js';
import { safeParseInt } from '../core/dataNormalizer.js';
import { showToast } from '../ui/toast.js';
import {
  setupBackupAndRestoreListeners, performDailyAutoBackup, triggerDailyAutoBackup
} from '../backup/backupService.js';
import {
  pickBackupDirectory,
  clearBackupDirectoryHandle,
  setAutoWriteEnabled,
  isAutoWriteEnabled,
  getLocalBackupUiState,
  isFileSystemAccessSupported
} from '../backup/localFileBackup.js';
import { generateUketsukeWorkbook } from '../excel/uketsukeWriter.js';
import { generateDiaryWorkbook } from '../excel/diaryWriter.js';

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
  refreshArchiveStatusUi();

  window.triggerDailyBackup = triggerDailyAutoBackup;
}

/**
 * フォルダ選択ダイアログを開き、結果をトースト＆UI反映する共通処理
 * （初回選択・変更の両方で使用）
 */
async function handlePickOrChangeBackupFolder() {
  const result = await pickBackupDirectory();
  refreshBackupFolderStatusUi();
  if (result.success) {
    showToast(`🟢 自動保存先を設定しました: ${result.folderName}`, 'success');
    performDailyAutoBackup().catch(() => {});
  } else if (result.message) {
    showToast(result.message, 'warn');
  }
}

function setupLocalBackupFolderUi() {
  const badge = document.getElementById('backupFolderStatusBadge');
  const btnPick = document.getElementById('btnPickBackupFolder');
  const btnChange = document.getElementById('btnChangeBackupFolder');
  const btnReset = document.getElementById('btnResetBackupFolder');
  const chkAuto = document.getElementById('chkAutoWriteBackupFolder');
  const panel = document.getElementById('localBackupFolderPanel');

  refreshBackupFolderStatusUi();

  if (!isFileSystemAccessSupported() && panel) {
    if (!(window.desktopApp && window.desktopApp.isDesktop) && badge) {
      badge.textContent = '📂 自動保存先: このブラウザはフォルダ自動保存未対応（IndexedDBスナップショットは稼働）';
      badge.style.color = '#b45309';
      if (btnPick) btnPick.disabled = true;
      if (btnChange) btnChange.disabled = true;
      if (btnReset) btnReset.disabled = true;
    }
  }

  btnPick?.addEventListener('click', () => {
    handlePickOrChangeBackupFolder();
  });

  btnChange?.addEventListener('click', () => {
    handlePickOrChangeBackupFolder();
  });

  btnReset?.addEventListener('click', async () => {
    const ok = window.confirm(
      'PCフォルダへの自動保存設定を解除しますか？\n\n'
      + '・専用サブフォルダへの自動書き出しは停止します\n'
      + '・IndexedDB内の14日スナップショットは引き続き稼働します\n'
      + '・フォルダ内の既存JSONファイル自体は削除しません'
    );
    if (!ok) return;

    const result = await clearBackupDirectoryHandle();
    refreshBackupFolderStatusUi();
    showToast(result.message || 'フォルダ設定を解除しました', result.success ? 'info' : 'warn');
  });

  if (chkAuto) {
    chkAuto.checked = isAutoWriteEnabled();
    chkAuto.addEventListener('change', () => {
      setAutoWriteEnabled(Boolean(chkAuto.checked));
      showToast(
        chkAuto.checked
          ? 'PCフォルダへの自動書き出しをONにしました'
          : 'PCフォルダへの自動書き出しをOFFにしました（IndexedDBスナップショットは継続）',
        'info'
      );
      refreshBackupFolderStatusUi();
    });
  }
}

/**
 * 設定済み／未設定に応じてボタン表示を切り替え、バッジ文言を更新
 */
export function refreshBackupFolderStatusUi() {
  const badge = document.getElementById('backupFolderStatusBadge');
  const chkAuto = document.getElementById('chkAutoWriteBackupFolder');
  const btnPick = document.getElementById('btnPickBackupFolder');
  const btnChange = document.getElementById('btnChangeBackupFolder');
  const btnReset = document.getElementById('btnResetBackupFolder');
  if (!badge) return;

  const state = getLocalBackupUiState();
  if (chkAuto) chkAuto.checked = state.autoEnabled;

  const isConfigured = Boolean(state.hasHandle && state.folderName);
  const isDesktop = Boolean(window.desktopApp && window.desktopApp.isDesktop);

  // 未設定: 「選択」のみ表示／設定済み: 「変更」「解除」を表示
  // Electron 専用パス稼働時はブラウザ側の選択 UI を隠す
  if (isDesktop && !isConfigured) {
    if (btnPick) btnPick.style.display = 'none';
    if (btnChange) btnChange.style.display = 'none';
    if (btnReset) btnReset.style.display = 'none';
  } else if (isConfigured) {
    if (btnPick) btnPick.style.display = 'none';
    if (btnChange) btnChange.style.display = '';
    if (btnReset) btnReset.style.display = '';
  } else {
    if (btnPick) btnPick.style.display = '';
    if (btnChange) btnChange.style.display = 'none';
    if (btnReset) btnReset.style.display = 'none';
  }

  if (isConfigured) {
    badge.textContent = state.autoEnabled
      ? `🟢 自動保存先: ${state.folderName}`
      : `📂 自動保存先: ${state.folderName}（自動書き出しOFF）`;
    badge.style.color = state.autoEnabled ? '#15803d' : '#64748b';
  } else if (isDesktop) {
    badge.textContent = '🟢 Electron専用フォルダへ自動保存（ドキュメント/リハ業務管理_自動バックアップ）';
    badge.style.color = '#15803d';
  } else {
    badge.textContent = '📂 自動保存先: 未設定';
    badge.style.color = '#64748b';
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
