// js/backup/backupService.js
// 手動バックアップ・年度確定・復元・日次自動セーフティネット統括
// 方式A: File System Access / Electron PCフォルダ
// 方式B: IndexedDB 14日スナップショット（常時）
// 方式C: ワンクリック手動ダウンロード（従来維持）
// ★データ収集は透過ストレージ層（メモリ/IndexedDB）スナップショットを正本とする

import { getLocalDateStr } from '../core/dateUtils.js';
import {
  storageKeys, storageRemove, storageRemoveByPrefix, storageSnapshot, storageSet
} from '../core/storageAdapter.js';
import { writeStorageItem } from '../store/storageWrite.js';
import { showToast } from '../ui/toast.js';
import {
  autoWriteDailyBackupToFile,
  saveIdbDailySnapshot,
  isAutoWriteEnabled
} from './localFileBackup.js';

let autoBackupDebounceTimer = null;
let lastFolderWarnAt = 0;

/**
 * 全ストアの最新スナップショット JSON オブジェクトを生成
 * @param {Object} meta
 * @returns {Object}
 */
export function createSystemDump(meta = {}) {
  const dump = {
    app: 'reha-work-manager',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    ...meta,
    storage: {}
  };

  const snapshot = storageSnapshot('reha_');
  Object.entries(snapshot).forEach(([key, value]) => {
    if (key.startsWith('reha_autobackup_')) return;
    if (key.startsWith('reha_backup_folder_')) return;
    dump.storage[key] = value;
  });

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
 * データ変更時のデバウンス付き自動バックアップ（3秒・UI非ブロッキング）
 */
export function triggerDailyAutoBackup() {
  if (autoBackupDebounceTimer) clearTimeout(autoBackupDebounceTimer);
  autoBackupDebounceTimer = setTimeout(() => {
    // fire-and-forget（await しない → UI フリーズ防止）
    performDailyAutoBackup().catch((e) => {
      console.warn('[backup] debounced auto backup error:', e);
    });
  }, 3000);
}


function removeLegacyAutoBackupCopies() {
  storageKeys('reha_autobackup_').forEach((key) => storageRemove(key));
}

function maybeWarnFolder(reason) {
  const now = Date.now();
  if (now - lastFolderWarnAt < 60000) return;
  lastFolderWarnAt = now;

  if (reason === 'no_folder' || reason === 'permission_denied' || reason === 'permission_prompt') {
    showToast(
      '📂 PCフォルダ自動保存の権限が無効です。Excel出力画面で「自動保存先フォルダ」を再選択してください（IndexedDB内スナップショットは保存済み）',
      'warn'
    );
  }
}

/**
 * 日次セーフティネット実行（非ブロッキング前提の async）
 * 1) IndexedDB 14日スナップショット（常時）
 * 2) Electron desktopApp（あれば）
 * 3) File System Access ユーザー指定フォルダ（設定ON時）
 */
export async function performDailyAutoBackup() {
  try {
    const todayStr = getLocalDateStr();
    removeLegacyAutoBackupCopies();
    const dump = createSystemDump({ backupType: 'DAILY_AUTO', targetDate: todayStr });

    // ── 方式 B: IndexedDB 内スナップショット（常時・サイレント）──
    try {
      await saveIdbDailySnapshot(dump, todayStr);
    } catch (snapErr) {
      console.warn('[backup] IDB snapshot layer failed:', snapErr);
    }

    // ── 方式 A-1: Electron 専用フォルダ（既存 IPC・互換維持）──
    if (window.desktopApp && typeof window.desktopApp.saveDailyBackup === 'function') {
      try {
        const payload = { targetDate: todayStr, data: dump, ...dump };
        const res = await window.desktopApp.saveDailyBackup(payload);
        if (res?.success) {
          console.log(`[自動バックアップ] Electron PCフォルダへ保存: ${res.filePath}`);
        } else if (res) {
          console.warn('Desktop file auto-backup soft-fail:', res);
        }
      } catch (ipcErr) {
        console.warn('Desktop file auto-backup IPC error:', ipcErr);
      }
    }

    // ── 方式 A-2: File System Access ユーザー指定フォルダ──
    if (isAutoWriteEnabled()) {
      try {
        const fileRes = await autoWriteDailyBackupToFile(dump, todayStr);
        if (fileRes.success) {
          console.log(`[自動バックアップ] 指定フォルダへ保存: ${fileRes.fileName}`);
        } else if (fileRes.reason && fileRes.reason !== 'disabled' && fileRes.reason !== 'unsupported') {
          maybeWarnFolder(fileRes.reason);
        }
      } catch (fsErr) {
        console.warn('[backup] File System Access write failed:', fsErr);
      }
    }
  } catch (e) {
    console.warn('Daily auto backup error:', e);
  }
}


export function setupBackupAndRestoreListeners() {
  removeLegacyAutoBackupCopies();

  const btnBackup = document.getElementById('btnBackupDownload');
  const btnFiscalBackup = document.getElementById('btnFiscalYearBackup');
  const btnTriggerRestore = document.getElementById('btnTriggerRestore');
  const fileInput = document.getElementById('backupFileInput');

  // C: 通常の手動全データバックアップ (随時)
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

  // C: 5/31年度確定バックアップ
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

  // 復元ファイル選択トリガー
  btnTriggerRestore?.addEventListener('click', () => {
    if (fileInput) { fileInput.value = ''; fileInput.click(); }
  });

  // バックアップファイルの読み込み & 完全復元
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

        storageRemoveByPrefix('reha_');

        for (const [k, v] of Object.entries(parsed.storage)) {
          if (typeof v !== 'string') continue;
          if (!writeStorageItem(k, v)) {
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
