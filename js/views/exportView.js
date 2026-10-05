// js/views/exportView.js
// VIEW 5: 月末Excel原本出力アクション制御・全データバックアップ＆復元(JSON)・トースト通知管理層（200行制限準拠）

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

  // 3. システム全データ バックアップ保存 & 復元イベントリスナー
  setupBackupAndRestoreListeners();
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

/**
 * システム全データのバックアップ(JSON)保存 & 復元リスナー設定
 */
function setupBackupAndRestoreListeners() {
  const btnBackup = document.getElementById('btnBackupDownload');
  const btnTriggerRestore = document.getElementById('btnTriggerRestore');
  const fileInput = document.getElementById('backupFileInput');

  // A: 全データ一括バックアップ (ダウンロード)
  btnBackup?.addEventListener('click', () => {
    try {
      const dumpData = {
        app: 'reha-work-manager',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        storage: {}
      };

      // reha_ で始まる全データ（患者台帳、時間割、スタッフ設定、物品貸出等）を安全に収集
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('reha_')) {
          dumpData.storage[key] = localStorage.getItem(key);
        }
      }

      const jsonStr = JSON.stringify(dumpData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const nowStr = new Date().toISOString().slice(0, 10);
      const fileName = `reha_backup_${nowStr}.json`;

      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = fileName;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      URL.revokeObjectURL(downloadLink.href);

      showToast(`全データを保存しました: ${fileName}`, 'success');
    } catch (err) {
      console.error('Backup error:', err);
      showToast('バックアップの作成に失敗しました', 'error');
    }
  });

  // B: 復元ファイル選択トリガー
  btnTriggerRestore?.addEventListener('click', () => {
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  });

  // C: 復元ファイルの読み込み & LocalStorage展開
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') throw new Error('ファイルを読み込めませんでした');

        const parsed = JSON.parse(text);
        if (!parsed || parsed.app !== 'reha-work-manager' || !parsed.storage) {
          showToast('無効なファイル形式です。reha-work-managerのバックアップJSONを選択してください。', 'error');
          return;
        }

        // 既存の reha_ 関連キーを一旦クリアしてバックアップ内容で完全復元
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('reha_')) keysToRemove.push(k);
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));

        // バックアップの全キーを展開
        Object.entries(parsed.storage).forEach(([k, v]) => {
          if (typeof v === 'string') localStorage.setItem(k, v);
        });

        showToast('データを完全復元しました。画面を再読み込みします...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } catch (err) {
        console.error('Restore error:', err);
        showToast('ファイルの復元に失敗しました。正しいJSONファイルかご確認ください。', 'error');
      }
    };
    reader.readAsText(file);
  });
}
