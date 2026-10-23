// js/backup/backupService.js
// 手動バックアップ・年度確定・復元・日次自動セーフティネット統括
// ★PC自動保存は Electron ネイティブ（desktopApp.saveDailyBackup → ドキュメント\リハ業務管理_自動バックアップ）に1本化
// ★ブラウザ向け File System Access API / reha_backup_safety_net_db 依存は撤廃
// ★手動「📦 保存」「🏛 確定保存」および JSON 復元は従来どおり維持

import { getLocalDateStr } from '../core/dateUtils.js';
import {
  storageKeys, storageRemove, storageRemoveByPrefix, storageFullSnapshotAsync, storageSet
} from '../core/storageAdapter.js';
import { writeStorageItem } from '../store/storageWrite.js';
import { showToast } from '../ui/toast.js';

let autoBackupDebounceTimer = null;

/**
 * 全ストアの最新スナップショット（アーカイブ冷データ含む）を非同期生成
 * @param {Object} meta
 * @returns {Promise<Object>}
 */
export async function createSystemDump(meta = {}) {
  const dump = {
    app: 'reha-work-manager',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    ...meta,
    storage: {}
  };

  const snapshot = await storageFullSnapshotAsync('reha_');
  Object.entries(snapshot).forEach(([key, value]) => {
    if (key.startsWith('reha_autobackup_')) return;
    if (key.startsWith('reha_backup_folder_')) return;
    dump.storage[key] = value;
  });

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
    performDailyAutoBackup().catch((e) => {
      console.warn('[backup] debounced auto backup error:', e);
    });
  }, 3000);
}


function removeLegacyAutoBackupCopies() {
  storageKeys('reha_autobackup_').forEach((key) => storageRemove(key));
}

/**
 * 日次セーフティネット実行（Electron PCフォルダへの上書き保存のみ）
 */
export async function performDailyAutoBackup() {
  try {
    const todayStr = getLocalDateStr();
    removeLegacyAutoBackupCopies();
    const dump = await createSystemDump({ backupType: 'DAILY_AUTO', targetDate: todayStr });

    if (window.desktopApp && typeof window.desktopApp.saveDailyBackup === 'function') {
      try {
        const payload = { targetDate: todayStr, data: dump, ...dump };
        const res = await window.desktopApp.saveDailyBackup(payload);
        if (res?.success) {
          console.log(`[自動バックアップ] Electron PCフォルダへ保存: ${res.filePath || res.fileName || ''}`);
        } else if (res) {
          console.warn('[自動バックアップ] Desktop file auto-backup soft-fail:', res);
        }
      } catch (ipcErr) {
        console.warn('[自動バックアップ] Desktop file auto-backup IPC error:', ipcErr);
      }
      return;
    }

    // ブラウザ単体起動時は PC 自動保存対象外（警告バーは出さない）
    console.log('[自動バックアップ] Electron未検出のためPC自動保存をスキップ（手動📦保存は利用可）');
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

  btnBackup?.addEventListener('click', async () => {
    try {
      showToast('全データスナップショットを作成中...', 'info');
      const dumpData = await createSystemDump({ backupType: 'MANUAL' });
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

  btnFiscalBackup?.addEventListener('click', async () => {
    try {
      const today = new Date();
      const y = today.getFullYear();
      const m = today.getMonth() + 1;
      const fiscalYear = m <= 5 ? y - 1 : y;
      showToast('年度確定スナップショットを作成中...', 'info');
      const dumpData = await createSystemDump({
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

  btnTriggerRestore?.addEventListener('click', () => {
    if (fileInput) { fileInput.value = ''; fileInput.click(); }
  });

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
