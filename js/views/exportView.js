// js/views/exportView.js
// VIEW 5: 月末Excel原本出力・全データバックアップ＆復元・日次14日ローテーション自動保存(PCフォルダ直接書き出し・当日リアルタイム上書き・終了時保存対応)・5/31年度確定バックアップ対応層（200行制限準拠）

import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { safeParseInt } from '../core/dataNormalizer.js';
import { showToast } from '../ui/toast.js';
import {
  setupBackupAndRestoreListeners, performDailyAutoBackup, triggerDailyAutoBackup
} from '../backup/backupService.js';
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

  // ★【第1層：起動時】当日の最新ファイルを作成・上書き保存（前日のファイルはそのまま確定保持）
  performDailyAutoBackup();

  // ★【第1層：終了時】アプリ終了（画面を閉じる）直前に、当日の最終確定データを当日ファイルへ上書き保存
  window.addEventListener('beforeunload', () => {
    performDailyAutoBackup();
  });

  // グローバルに関数を公開し、時間割保存時などから安全に即時/遅延上書きを呼べるように設定
  window.triggerDailyBackup = triggerDailyAutoBackup;
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

