// js/views/exportView.js
// VIEW 5: 月末Excel原本出力・全データバックアップ＆復元・日次14日ローテーション自動保存(PCフォルダ直接書き出し連携)・5/31年度確定バックアップ対応層（200行制限準拠）


import { safeParseInt } from '../core/dataNormalizer.js';
import { aggregateFromAppSchedule } from '../store/scheduleStore.js';
import { generateUketsukeWorkbook } from '../excel/uketsukeWriter.js';
import { generateDiaryWorkbook } from '../excel/diaryWriter.js';

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

  if (monthInput && !monthInput.value) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    monthInput.value = `${y}-${m}`;
  }

  btnUketsuke?.addEventListener('click', () => handleExportUketsuke(monthInput));
  btnDiary?.addEventListener('click', () => handleExportDiary(monthInput));

  setupBackupAndRestoreListeners();

  // ★【第1層】起動時に日次自動バックアップを実行（直近14日ローテーション自動管理）
  performDailyAutoBackup();
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

  showToast(`${year}年${month}月 業務日誌Excelを集計・生成中...`, 'info');
  try {
    const aggregated = aggregateFromAppSchedule(year, month);
    const wb = generateDiaryWorkbook(aggregated, null);
    if (!wb) return showToast('業務日誌Excelの生成に失敗しました', 'error');

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

function createSystemDump(meta = {}) {
  const dump = {
    app: 'reha-work-manager',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    ...meta,
    storage: {}
  };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // 自動バックアップ自体の肥大化防止のため、内部ローテーションキーは除外して純粋データのみ収集
    if (key && key.startsWith('reha_') && !key.startsWith('reha_autobackup_')) {
      dump.storage[key] = localStorage.getItem(key);
    }
  }
  return dump;
}

function downloadJsonBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

/**
 * ★【第1層：日常】日次自動バックアップ ＆ 直近14日自動ローテーション消去
 * （アプリ内部LocalStorage保護 ＋ PCドキュメントフォルダへの直接JSON書き出しの二重防衛）
 */
async function performDailyAutoBackup() {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const backupKey = `reha_autobackup_${todayStr}`;
    const dump = createSystemDump({ backupType: 'DAILY_AUTO', targetDate: todayStr });

    // 1. アプリ内部LocalStorageへの保管
    if (!localStorage.getItem(backupKey)) {
      localStorage.setItem(backupKey, JSON.stringify(dump));
    }

    // 2. PCの専用フォルダ（ドキュメント/リハ業務管理_自動バックアップ/）へ直接JSONファイルを書き出し
    if (window.desktopApp && typeof window.desktopApp.saveDailyBackup === 'function') {
      try {
        const res = await window.desktopApp.saveDailyBackup(dump);
        if (res?.success) {
          console.log(`[自動バックアップ] PCフォルダへ直接保存完了: ${res.filePath}`);
        }
      } catch (ipcErr) {
        console.warn('Desktop file auto-backup IPC error:', ipcErr);
      }
    }

    // 3. 内部LocalStorage側も14日を超過した古い自動バックアップを自動消去（容量頭打ち処理）
    const autoKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('reha_autobackup_')) autoKeys.push(k);
    }
    autoKeys.sort(); // 日付文字列昇順
    while (autoKeys.length > 14) {
      const oldestKey = autoKeys.shift();
      if (oldestKey) localStorage.removeItem(oldestKey);
    }
  } catch (e) {
    console.warn('Daily auto backup error:', e);
  }
}

function setupBackupAndRestoreListeners() {
  const btnBackup = document.getElementById('btnBackupDownload');
  const btnFiscalBackup = document.getElementById('btnFiscalYearBackup');
  const btnTriggerRestore = document.getElementById('btnTriggerRestore');
  const fileInput = document.getElementById('backupFileInput');

  // A: 通常の手動全データバックアップ
  btnBackup?.addEventListener('click', () => {
    try {
      const dumpData = createSystemDump({ backupType: 'MANUAL' });
      const blob = new Blob([JSON.stringify(dumpData, null, 2)], { type: 'application/json' });
      const nowStr = new Date().toISOString().slice(0, 10);
      const fileName = `reha_backup_${nowStr}.json`;
      downloadJsonBlob(blob, fileName);
      showToast(`全データを保存しました: ${fileName}`, 'success');
    } catch (err) {
      console.error('Backup error:', err);
      showToast('バックアップの作成に失敗しました', 'error');
    }
  });

  // ★B: 【第2層：年次】5月31日 年度確定バックアップ（改定サイクル準拠）
  btnFiscalBackup?.addEventListener('click', () => {
    try {
      const today = new Date();
      const y = today.getFullYear();
      const m = today.getMonth() + 1;
      // 6月1日〜翌5月31日サイクル判定（1〜5月は前年年度、6〜12月は当年年度）
      const fiscalYear = m <= 5 ? y - 1 : y;
      const dumpData = createSystemDump({
        backupType: 'FISCAL_YEAR_FINAL',
        fiscalYear: fiscalYear,
        cycleNote: '5月31日確定_診療報酬改定対応'
      });
      const blob = new Blob([JSON.stringify(dumpData, null, 2)], { type: 'application/json' });
      const fileName = `reha_${fiscalYear}年度確定_5月31日改定締め.json`;
      downloadJsonBlob(blob, fileName);
      showToast(`🏛 ${fiscalYear}年度確定バックアップ(5/31締め)を保存しました`, 'success');
    } catch (err) {
      console.error('Fiscal backup error:', err);
      showToast('年度確定バックアップの作成に失敗しました', 'error');
    }
  });

  // C: 復元ファイル選択トリガー
  btnTriggerRestore?.addEventListener('click', () => {
    if (fileInput) { fileInput.value = ''; fileInput.click(); }
  });

  // D: バックアップファイルの読み込み & 完全復元
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') throw new Error('読込失敗');
        const parsed = JSON.parse(text);
        if (!parsed || parsed.app !== 'reha-work-manager' || !parsed.storage) {
          return showToast('無効なファイルです。正しいバックアップJSONを選択してください。', 'error');
        }

        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('reha_')) keysToRemove.push(k);
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));

        Object.entries(parsed.storage).forEach(([k, v]) => {
          if (typeof v === 'string') localStorage.setItem(k, v);
        });

        showToast('データを完全復元しました。画面を再読み込みします...', 'success');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        console.error('Restore error:', err);
        showToast('ファイルの復元に失敗しました。正しいJSONファイルかご確認ください。', 'error');
      }
    };
    reader.readAsText(file);
  });
}
