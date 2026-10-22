// js/views/exportView.js
// VIEW 5: 月末Excel原本出力・全データバックアップ＆復元・PCフォルダ自動保存設定
// 日次14日ローテーション（IndexedDB + File System Access / Electron）

import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { safeParseInt } from '../core/dataNormalizer.js';
import { showToast } from '../ui/toast.js';
import {
  setupBackupAndRestoreListeners, performDailyAutoBackup, triggerDailyAutoBackup
} from '../backup/backupService.js';
import {
  pickBackupDirectory,
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

  // グローバル公開: 時間割保存・予約変更などからデバウンス付き自動バックアップ
  window.triggerDailyBackup = triggerDailyAutoBackup;
}

/**
 * 自動保存先フォルダ UI（ステータスバッジ・選択ボタン・チェックボックス）
 */
function setupLocalBackupFolderUi() {
  const badge = document.getElementById('backupFolderStatusBadge');
  const btnPick = document.getElementById('btnPickBackupFolder');
  const chkAuto = document.getElementById('chkAutoWriteBackupFolder');
  const panel = document.getElementById('localBackupFolderPanel');

  refreshBackupFolderStatusUi();

  if (!isFileSystemAccessSupported() && panel) {
    // Electron は IPC 経路があるためパネルは残す。ブラウザ非対応時のみ注記
    if (!(window.desktopApp && window.desktopApp.isDesktop) && badge) {
      badge.textContent = '📂 自動保存先: このブラウザはフォルダ自動保存未対応（IndexedDBスナップショットは稼働）';
      badge.style.color = '#b45309';
      if (btnPick) btnPick.disabled = true;
    }
  }

  btnPick?.addEventListener('click', async () => {
    const result = await pickBackupDirectory();
    refreshBackupFolderStatusUi();
    if (result.success) {
      showToast(`🟢 自動保存先を設定しました: ${result.folderName}`, 'success');
      // 設定直後に1回フラッシュ（サイレント）
      performDailyAutoBackup().catch(() => {});
    } else if (result.message) {
      showToast(result.message, 'warn');
    }
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
 * バッジ表示を最新状態に同期
 */
export function refreshBackupFolderStatusUi() {
  const badge = document.getElementById('backupFolderStatusBadge');
  const chkAuto = document.getElementById('chkAutoWriteBackupFolder');
  if (!badge) return;

  const state = getLocalBackupUiState();
  if (chkAuto) chkAuto.checked = state.autoEnabled;

  if (state.hasHandle && state.folderName) {
    badge.textContent = state.autoEnabled
      ? `🟢 自動保存先: ${state.folderName}`
      : `📂 自動保存先: ${state.folderName}（自動書き出しOFF）`;
    badge.style.color = state.autoEnabled ? '#15803d' : '#64748b';
  } else if (window.desktopApp && window.desktopApp.isDesktop) {
    badge.textContent = '🟢 Electron専用フォルダへ自動保存（ドキュメント/リハ業務管理_自動バックアップ）';
    badge.style.color = '#15803d';
  } else {
    badge.textContent = '📂 自動保存先: 未設定';
    badge.style.color = '#64748b';
  }
}

function handleExportUketsuke(monthInput) {
  const [year, month] = parseYearMonth(monthInput?.value);
  if (!year || !month) return showToast('出力対象年月を正しく選択してください', 'warn');

  showToast(`${year}年${month}月 受付提出用Excelを集計・生成中...`, 'info');
  try {
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

function handleExportDiary(monthInput) {
  const [year, month] = parseYearMonth(monthInput?.value);
  if (!year || !month) return showToast('出力対象年月を正しく選択してください', 'warn');

  const now = new Date();
  const isCurrentMonth = (now.getFullYear() === year && (now.getMonth() + 1) === month);
  const targetDay = isCurrentMonth ? now.getDate() : null;

  const targetRangeStr = isCurrentMonth ? `1日〜${targetDay}日 (当日累積)` : '1日〜月末';
  showToast(`${year}年${month}月 業務日誌Excelを集計中 (${targetRangeStr})...`, 'info');

  try {
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
