// js/backup/backupService.js
// 手動バックアップ・年度確定バックアップ・復元・日次自動保存
// ★データ収集は透過ストレージ層（メモリ/IndexedDB）スナップショットを正本とする

import { getLocalDateStr } from '../core/dateUtils.js';
import {
  storageKeys, storageRemove, storageRemoveByPrefix, storageSnapshot, storageSet
} from '../core/storageAdapter.js';
import { writeStorageItem } from '../store/storageWrite.js';
import { showToast } from '../ui/toast.js';

let autoBackupDebounceTimer = null;

function createSystemDump(meta = {}) {
  const dump = {
    app: 'reha-work-manager',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    ...meta,
    storage: {}
  };

  // メモリキャッシュ上の reha_* を正本として収集（IndexedDB 由来データも含む）
  const snapshot = storageSnapshot('reha_');
  Object.entries(snapshot).forEach(([key, value]) => {
    if (key.startsWith('reha_autobackup_')) return;
    dump.storage[key] = value;
  });

  // 初期化前フォールバック: スナップショットが空なら localStorage も走査
  if (Object.keys(dump.storage).length === 0) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('reha_') && !key.startsWith('reha_autobackup_')) {
          dump.storage[key] = localStorage.getItem(key);
        }
      }
    } catch (_) { /* ignore */ }
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
 * 日中の操作時（時間割の変更・登録等）に当日ファイルを最新状態で自動上書きするトリガー
 * 操作直後の短時間の連続書き込みを防ぐため、2.5秒のデバウンス制御を実施
 */
export function triggerDailyAutoBackup() {
  if (autoBackupDebounceTimer) clearTimeout(autoBackupDebounceTimer);
  autoBackupDebounceTimer = setTimeout(() => {
    performDailyAutoBackup();
  }, 2500);
}


function removeLegacyAutoBackupCopies() {
  storageKeys('reha_autobackup_').forEach((key) => storageRemove(key));
}

export async function performDailyAutoBackup() {
  try {
    const todayStr = getLocalDateStr();
    removeLegacyAutoBackupCopies();
    const dump = createSystemDump({ backupType: 'DAILY_AUTO', targetDate: todayStr });

    if (!(window.desktopApp && typeof window.desktopApp.saveDailyBackup === 'function')) {
      return;
    }

    try {
      const payload = { targetDate: todayStr, data: dump, ...dump };
      const res = await window.desktopApp.saveDailyBackup(payload);
      if (res?.success) {
        console.log(`[自動バックアップ] PCフォルダへ当日最新上書き保存完了: ${res.filePath}`);
        return;
      }
      console.warn('Desktop file auto-backup failed:', res);
      showToast(res?.message || '当日バックアップをPCフォルダへ保存できませんでした', 'error');
    } catch (ipcErr) {
      console.warn('Desktop file auto-backup IPC error:', ipcErr);
      showToast('当日バックアップをPCフォルダへ保存できませんでした', 'error');
    }
  } catch (e) {
    console.warn('Daily auto backup error:', e);
    showToast('当日バックアップの作成に失敗しました', 'error');
  }
}


export function setupBackupAndRestoreListeners() {
  removeLegacyAutoBackupCopies();

  const btnBackup = document.getElementById('btnBackupDownload');
  const btnFiscalBackup = document.getElementById('btnFiscalYearBackup');
  const btnTriggerRestore = document.getElementById('btnTriggerRestore');
  const fileInput = document.getElementById('backupFileInput');

  // A: 通常の手動全データバックアップ (随時)
  btnBackup?.addEventListener('click', () => {
    try {
      const dumpData = createSystemDump({ backupType: 'MANUAL' });
      const blob = new Blob([JSON.stringify(dumpData, null, 2)], { type: 'application/json' });
      const nowStr = getLocalDateStr();
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

        // 既存 reha_* をメモリ・IDB・LS から一掃
        storageRemoveByPrefix('reha_');

        for (const [k, v] of Object.entries(parsed.storage)) {
          if (typeof v !== 'string') continue;
          // writeStorageItem → storageSet（メモリ + IDB + LS ミラー）
          if (!writeStorageItem(k, v)) {
            // write 失敗時も storageSet 直叩きでメモリ/IDB は残す
            storageSet(k, v);
          }
        }

        showToast('データを完全復元しました。画面を再読み込みします...', 'success');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        console.error('Restore error:', err);
        if (err?.message !== 'storage-write-failed') {
          showToast('ファイルの復元に失敗しました。正しいJSONファイルかご確認ください。', 'error');
        }
      }
    };
    reader.readAsText(file);
  });
}
