# reha-work-manager — PROJECT FULL SNAPSHOT（AI引き継ぎマスター）

> **目的:** 別AI（Gemini等）が本リポジトリの全容をコード探索なしで把握できる正本ドキュメント。  
> **作成日:** 2026-10-23  
> **対象バージョン:** アプリ `package.json` = 1.0.0／説明書表記 1.1.0（施設可変時間枠＋Electronバックアップ1本化後）  
> **リポジトリルート:** `reha-work-manager/`  
> **優先順位:** 本ファイルの「心臓部全文」＞ `docs/説明書.md` ＞ `docs/CURRENT_STATUS.md`（後者は古い記述が混在し得る）

---

## 0. 30秒でわかる全体像

| 項目 | 内容 |
|------|------|
| 形態 | Electron デスクトップアプリ（`app://` 配信）。ブラウザでもESM可だが **PC自動バックアップはElectronのみ**。`file://` 直開きは非対応 |
| 画面 | 6タブ SPA：本日時間割／外来予約／月間単位・収益／患者台帳／物品貸出／Excel出力 |
| 時間軸 | `timeSlotGenerator.js` → `rules.js` の `TIME_SLOTS`（SSOT）。初期 09:00–13:00／14:00–18:00＝24コマ・20分。スタッフ設定UIで変更可（`localStorage['reha_facility_hours']`） |
| ストレージ | **IndexedDB正本** `reha_work_manager_db` ＋ メモリ同期読取。localStorageは移行元／一部ミラー |
| バックアップ | **Electron IPCのみ** → `ドキュメント\リハ業務管理_自動バックアップ\reha_backup_YYYY-MM-DD.json`。手動📦／🏛確定／JSON復元は維持。ブラウザFSAは**完全撤廃** |
| 法令定数 | 令和8年度改定想定を `js/config/rules.js` に内蔵 |
| 二重起動 | `app.requestSingleInstanceLock()` で物理遮断 |

---

## 1. 最新フォルダ・ファイル構成ツリー

```
reha-work-manager/
├── package.json
├── main.js                          # Electron エントリ（app:// 配信・二重起動防止）
├── preload.js                       # desktopApp API（saveDailyBackup / openBackupFolder）
├── index.html                       # SPA 骨格（6タブ＋モーダル）
├── icon.ico                         # （ビルド用・存在する場合）
├── css/
│   ├── style.css                    # エントリ（各CSS import）
│   ├── base.css
│   ├── schedule.css
│   ├── appointment.css
│   ├── tables.css
│   ├── modals.css
│   └── toast.css
├── main/
│   └── backupIpc.js                 # ドキュメント\リハ業務管理_自動バックアップ IPC
├── docs/
│   ├── 説明書.md                    # 現場向け操作説明書（v1.1.0）
│   ├── CURRENT_STATUS.md            # 開発メモ（一部古い記述あり → 本SNAPSHOTを優先）
│   └── PROJECT_FULL_SNAPSHOT.md     # ★本ファイル（AI引き継ぎ用マスター）
├── js/
│   ├── app.js                       # 起動司令塔（IDB→アーカイブ→各画面→自動バックアップ）
│   ├── vendor/
│   │   └── xlsx.bundle.js           # SheetJS ローカル内包（~416KB）
│   ├── config/
│   │   ├── rules.js                 # 点数・日数・FACILITY_HOURS／TIME_SLOTS 正本
│   │   └── appointmentSlots.js      # APPOINTMENT_TIME_STRINGS 再エクスポート互換
│   ├── core/
│   │   ├── storageAdapter.js        # IndexedDB透過層＋メモリキャッシュ
│   │   ├── timeSlotGenerator.js     # 施設時間→20分コマ動的生成＋永続化
│   │   ├── deadlineCalc.js          # 期限・日割り点数・計画書推奨
│   │   ├── validator.js             # 重複・日上限・セラピスト負荷
│   │   ├── dateUtils.js
│   │   ├── dataNormalizer.js
│   │   └── holidayCalc.js
│   ├── backup/
│   │   ├── backupService.js         # 手動JSON／復元／日次Electron自動保存
│   │   └── localFileBackup.js       # Electron専用ヘルパー（FSA撤廃済み）
│   ├── store/
│   │   ├── patientStore.js
│   │   ├── scheduleStore.js
│   │   ├── appointmentStore.js
│   │   ├── appointmentSync.js       # （旧連動スタブ／未使用寄り）
│   │   ├── therapistStore.js
│   │   ├── assistantStore.js
│   │   ├── loanStore.js
│   │   ├── archiveManager.js        # 当月±3ヶ月アクティブ窓
│   │   └── storageWrite.js          # 書き込み＋失敗トースト
│   ├── views/
│   │   ├── scheduleView.js          # 本日時間割
│   │   ├── appointmentCalendarView.js
│   │   ├── monthlyView.js
│   │   ├── patientView.js
│   │   ├── loanView.js
│   │   ├── exportView.js            # Excel＋バックアップUI
│   │   ├── schedule/                # timetable, palette, kpiStrip, scheduleState
│   │   ├── appointment/             # weekly/monthly/palette/calendarState
│   │   ├── monthly/                 # unitsTable, revenueDashboard, diaryPreview
│   │   └── modals/                  # slot, staff, appointment, analgesia
│   ├── excel/
│   │   ├── uketsukeWriter.js
│   │   ├── diaryWriter.js
│   │   ├── sheetUtils.js
│   │   └── sheets/                  # analgesia, rehaPatient, summary, yearlyTrend
│   ├── print/
│   │   ├── weeklyTablePrint.js      # A4横週間表
│   │   ├── dailyChecklistPrint.js   # A4縦デイリー
│   │   └── appointmentTicketPrint.js# A5予約票
│   └── ui/
│       └── toast.js
└── dist/                            # electron-builder 出力（gitignore想定）
```


### 起動・ビルド

```bash
npm install
npm start                 # electron .
npm run build:win         # NSIS → dist/
```

---

## 2. 主要機能一覧と実装状態

| 機能 | 状態 | 実装の要点・入口 |
|------|------|------------------|
| 本日時間割（DnD・単位1–4・ジャストフィット `(52*u)-5`） | ✅ 稼働 | `scheduleView.js` / `schedule/timetable.js` / `slotModal.js` |
| 業務・有休・公休ブロック（半日＝午前コマ数／終日＝総コマ数に連動） | ✅ 稼働 | `slotModal.js`＋`staffModal.syncLeavePresetDurations` |
| 消炎鎮痛列（収益・単位に混入しない） | ✅ 稼働 | `scheduleStore` の `analgesia` マップ／`analgesiaModal.js` |
| 外来予約（自由実時間・同一患者重複のみ遮断） | ✅ 稼働 | `appointmentStore.js` / `appointmentModal.js` |
| 予約→時間割一括反映（手入力枠スキップ・最寄り20分吸着） | ✅ 稼働 | `scheduleView.js` |
| A4週間／デイリー印刷・A5予約票 | ✅ 稼働 | `js/print/*` |
| 月間単位表・収益KPI・月13単位警告 | ✅ 稼働 | `unitsTable.js` / `revenueDashboard.js` |
| **当月中期限切れの日割り点数** | ✅ 稼働 | `deadlineCalc.getDailyBasePoints` |
| 患者台帳（疾患・起算・介護区分・計画書ステータス） | ✅ 稼働 | `patientStore.js` / `patientView.js` |
| 物品貸出 | ✅ 稼働 | `loanStore.js` / `loanView.js` |
| Excel（受付提出・業務日誌）＋SheetJSローカル | ✅ 稼働 | `excel/*` + `js/vendor/xlsx.bundle.js` |
| **施設時間枠UI（スタッフ設定）** | ✅ 稼働 | `staffModal.js` + `reloadFacilityTimeSlots` |
| **時間軸動的生成 SSOT** | ✅ 稼働 | `timeSlotGenerator.js` → `rules.js` |
| IndexedDB透過ストレージ＋アーカイブ窓±3ヶ月 | ✅ 稼働 | `storageAdapter.js` / `archiveManager.js` |
| Electron日次自動バックアップ | ✅ 稼働 | `backupService.performDailyAutoBackup` → `desktopApp.saveDailyBackup` → `main/backupIpc.js` |
| ブラウザ File System Access 自動保存 | ❌ **削除済み** | 旧 `reha_backup_safety_net_db` 不使用 |
| 手動JSONバックアップ／復元 | ✅ 稼働 | `backupService.setupBackupAndRestoreListeners` |

### 画面タブ ↔ モジュール

| タブ | init / render |
|------|----------------|
| 本日時間割 | `initScheduleView` / `renderScheduleView` |
| 外来予約 | `initAppointmentCalendarView` / `renderAppointmentCalendarView` |
| 月間単位・収益 | `initMonthlyView` / `renderMonthlyView` |
| 患者台帳 | `initPatientView` / `renderPatientView` |
| 物品貸出 | `initLoanView` / `renderLoanView` |
| Excel出力 | `initExportView`（バックアップUI含む） |

### 起動シーケンス（`js/app.js`）

1. `registerArchiveHydrationFilter()`  
2. `initStorage()`（IDBプリロード／LS移行）  
3. `initArchiveManager()`  
4. `initLocalFileBackup()`（Electron状態ログのみ・副作用ほぼなし）  
5. 各 `init*View` → `renderAllViews`  
6. `performDailyAutoBackup()`（非ブロッキング）  
7. `window.triggerDailyBackup = triggerDailyAutoBackup`（データ変更時デバウンス3秒）

---

## 3. 主要データ構造

### 3.1 IndexedDB（正本）

| 項目 | 値 |
|------|-----|
| DB名 | `reha_work_manager_db` |
| バージョン | `1` |
| ObjectStore | `app_key_value_store`（`keyPath: 'key'`） |
| レコード形 | `{ key: string, value: string }` ※値は常に文字列（JSON文字列を格納） |
| メタ | `__reha_storage_migrated_v1`（移行完了フラグ） |

読み取りは **メモリキャッシュ同期**（`storageGet` = 0ms）。書き込みはメモリ即時＋IDB非同期。

### 3.2 アプリキー一覧（いずれも `reha_` 接頭）

| キー | 内容 | 型（値のパース後） |
|------|------|-------------------|
| `reha_patients_master` | 患者台帳 | `Patient[]` |
| `reha_therapists_master` | セラピスト | `Therapist[]` |
| `reha_assistant_settings` | 助手1・2 | `{ assistant1, assistant2 }` |
| `reha_loans_master` | 物品貸出 | `Loan[]` |
| `reha_outpatient_appointments` | 外来予約 | `Record<id, Appointment>` |
| `reha_schedule_YYYY-MM-DD` | 日別時間割 | `DailySchedule` |
| （廃止）`reha_backup_folder_*` | 旧FSA UI | 無視／ダンプ除外 |
| （廃止）`reha_autobackup_*` | 旧LS自動コピー | 起動時削除 |

### 3.3 localStorage（直接参照が残るもの）

| キー | 用途 |
|------|------|
| `reha_facility_hours` | 施設時間 `{ amStart, amEnd, pmStart, pmEnd }`（`timeSlotGenerator` が直接 read/write） |

※マスター系は原則 `storageAdapter` 経由。初回起動で LS → IDB 移行。

### 3.4 Electron PCファイル

| パス | 内容 |
|------|------|
| `Documents/リハ業務管理_自動バックアップ/reha_backup_YYYY-MM-DD.json` | 日次フルダンプ（14日ローテ。旧名 `reha_autobackup_*` も削除対象に含む） |

### 3.5 型定義（実装準拠）

```ts
/** 施設診療時間 */
type FacilityHours = {
  amStart: string; // 'HH:MM'
  amEnd: string;
  pmStart: string;
  pmEnd: string;
};

/** TIME_SLOTS 要素 */
type TimeSlot = {
  id: string;           // 'am_1' | 'pm_1' | ...
  label: string;        // '09:00 - 09:20'
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  period: 'am' | 'pm';
  order: number;
};

type DiseaseType = 'LOCOMOTIVE' | 'CEREBROVASCULAR' | 'DISUSE' | 'ANALGESIA';
type CareInsuranceType = 'NONE' | 'SUPPORT' | 'CARE';
type PatientCategory = 'INPATIENT' | 'OUTPATIENT';
type PatientStatus = 'ACTIVE' | 'DISCONTINUED';
type PlanStatus = 'NOT_YET' | 'PLAN_1_FOLLOW' | 'PLAN_2_FOLLOW';

type Patient = {
  id: string;
  name: string;
  nameKana: string;
  diseaseName: string;
  category: PatientCategory;
  status: PatientStatus;
  diseaseType: DiseaseType;
  careInsuranceType: CareInsuranceType;
  planStatus: PlanStatus;
  admissionDate: string;        // YYYY-MM-DD
  earlyBonusStartDate: string;
  onsetDate: string;            // 起算日（初日算入）
  force13Limit: boolean;
  notes: string;
};

type TherapistStatus = 'ACTIVE' | 'LEAVE' | 'RETIRED';
type Therapist = {
  id: string;     // 'A','B','C',...
  name: string;
  color: string;
  status: TherapistStatus;
};

type BillingPlan =
  | '' | 'PLAN_1_FIRST' | 'PLAN_1_FOLLOW' | 'PLAN_2_FIRST' | 'PLAN_2_FOLLOW';

type ScheduleItemType = 'PATIENT' | 'TASK' | 'LEAVE' | 'HOLIDAY';

/** 患者コマ */
type PatientSlotItem = {
  itemType?: 'PATIENT';
  patientId: string;
  units: number;          // 1..4
  note: string;
  billingPlan: BillingPlan;
  updatedAt: string;      // ISO
};

/** 業務・休暇コマ */
type BlockSlotItem = {
  itemType: 'TASK' | 'LEAVE' | 'HOLIDAY';
  patientId: null;
  title: string;
  units: number;          // = slotsCount
  slotsCount: number;
  note: string;
  billingPlan: '';
  updatedAt: string;
};

type SlotItem = PatientSlotItem | BlockSlotItem;

/** 1日分 */
type DailySchedule = {
  [therapistId: string]: {
    [slotId: string]: SlotItem;  // 開始スロットIDのみ保持。複数単位は後続を覆う
  };
  analgesia?: {
    [slotId: string]: string[];  // patientId[]
  };
};

type AppointmentStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
type TreatmentType = 'INDIVIDUAL' | 'ANALGESIA' | 'EVALUATION' | 'OTHER';

type Appointment = {
  id: string;
  date: string;              // YYYY-MM-DD
  startTime: string;         // HH:MM（20分縛りなし）
  durationMinutes: number;
  patientId: string;
  therapistId: string;       // 'A'.. or 'ANALGESIA' | 'NONE'
  treatmentType: TreatmentType;
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

/** 手動／自動バックアップJSON */
type SystemDump = {
  app: 'reha-work-manager';
  version: string;
  exportedAt: string;
  backupType?: 'DAILY_AUTO' | 'MANUAL' | 'FISCAL_YEAR_FINAL';
  targetDate?: string;
  fiscalYear?: number;
  storage: Record<string, string>; // key → 生文字列
};
```

### 3.6 診療報酬ロジック要点（`deadlineCalc.js`）

- **初日算入:** 起算日＝1日目。  
- **維持期減算:** 標準日数超過後、`careInsuranceType` が `CARE`/`SUPPORT` のみ `maintPoints`。`NONE`（医療のみ）は正規点数維持。  
- **日割り:** 同一月内で満了日をまたぐ場合、実施日ごとに `getDailyBasePoints(patient, dateStr)`。  
- **月13単位:** 維持期・強制フラグ対象の監視（UI警告）。  
- **早期加算:** 入院かつ `earlyBonusStartDate` 基準（3日以内60／4–14日25）。  
- **計画書:** `PLAN_POINTS` 4区分。物療は個別リハ単位・収益に混入しない。

### 3.7 desktopApp API（`preload.js`）

```js
window.desktopApp = {
  isDesktop: true,
  platform,
  version: '1.0.0',
  saveDailyBackup(dumpData) -> ipc 'save-daily-backup-file',
  openBackupFolder() -> ipc 'open-backup-folder'
};
```

---

## 4. 改修時の絶対制約（破壊禁止）

1. UIの主要ID・既存CSSクラス・カード高さ `(52 * units) - 5` を安易に変えない。  
2. `TIME_SLOTS` / `APPOINTMENT_TIME_STRINGS` は **配列参照を維持した in-place 更新**（`reloadFacilityTimeSlots`）。  
3. ストレージ API は同期 `storageGet`／`storageSet` 契約を壊さない。  
4. Electron自動バックアップ以外の「第2のフォルダピッカー」を再導入しない。  
5. コミットはユーザー明示時のみ。

---

## 5. システムの心臓部 — 全文コード

以下は **ディスク上の最新全文**（端折りなし）。


### 5.1 `package.json`

```json
{
"name": "reha-work-manager",
"version": "1.0.0",
"description": "リハビリ業務管理システム Windows専用デスクトップアプリケーション",
"main": "main.js",
"scripts": {
"start": "electron .",
"build:win": "electron-builder --win nsis --publish never"
},
"keywords": [
"rehabilitation",
"medical",
"schedule",
"electron"
],
"author": "Rehabilitation科",
"license": "ISC",
"devDependencies": {
"electron": "^33.0.0",
"electron-builder": "^25.1.8"
},
"build": {
"appId": "com.reha.workmanager",
"productName": "リハビリ業務管理システム",
"publish": null,
"win": {
"target": "nsis",
"icon": "icon.ico"
},
"nsis": {
"oneClick": true,
"perMachine": false,
"allowToChangeInstallationDirectory": false,
"createDesktopShortcut": true,
"createStartMenuShortcut": true,
"shortcutName": "リハビリ業務管理システム"
},
"directories": {
"output": "dist"
}
}
}
```

### 5.2 `js/config/rules.js`

```javascript
// js/config/rules.js
// 診療報酬改定定数マスター・時間枠定義・制約ルール設定
// ★時間枠は timeSlotGenerator が単一情報源。手書き固定配列は置かない。
// ★施設時間は localStorage('reha_facility_hours') → FACILITY_HOURS → TIME_SLOTS へ即時反映

import {
  DEFAULT_FACILITY_HOURS,
  generateTimeSlots,
  generateAppointmentTimeStrings,
  getAmSlotCount,
  getPmSlotCount,
  getTotalSlotCount,
  getSavedFacilityHours,
  normalizeFacilityHours,
  validateFacilityHours
} from '../core/timeSlotGenerator.js';

export const REHA_RULES = {
  // 疾患別標準算定日数上限と点数マスター（令和8年度改定準拠）
  LIMIT_DAYS: {
    LOCOMOTIVE: {
      days: 150,
      defaultPoints: 170,
      maintPoints: 102,
      shortLabel: '運動器Ⅱ',
      fullName: '運動器リハビリテーション料(Ⅱ)',
      oneThirdDays: 50,
      tag: '運',
      tagBg: '#ecfdf5',
      tagColor: '#065f46',
      tagBorder: '#10b981'
    },
    CEREBROVASCULAR: {
      days: 180,
      defaultPoints: 100,
      maintPoints: 60,
      shortLabel: '脳血管Ⅲ',
      fullName: '脳血管疾患等リハビリテーション料(Ⅲ)',
      oneThirdDays: 60,
      tag: '脳',
      tagBg: '#f5f3ff',
      tagColor: '#5b21b6',
      tagBorder: '#8b5cf6'
    },
    DISUSE: {
      days: 120,
      defaultPoints: 77,
      maintPoints: 46,
      shortLabel: '廃用Ⅲ',
      fullName: '廃用症候群リハビリテーション料(Ⅲ)',
      oneThirdDays: 40,
      tag: '廃',
      tagBg: '#fffbeb',
      tagColor: '#92400e',
      tagBorder: '#f59e0b'
    },
    ANALGESIA: {
      days: 9999,
      defaultPoints: 35,
      maintPoints: 35,
      shortLabel: '消炎鎮痛',
      fullName: '消炎鎮痛等処置',
      oneThirdDays: 9999,
      tag: '消',
      tagBg: '#f1f5f9',
      tagColor: '#334155',
      tagBorder: '#94a3b8'
    }
  },

  // 令和8年度改定 早期加算判定ルール（入院患者のみ）
  EARLY_BONUS: {
    PHASE_1: {
      maxDays: 3,
      points: 60,
      label: '早期加算(3日以内)'
    },
    PHASE_2: {
      maxDays: 14,
      points: 25,
      label: '早期加算(4〜14日目)'
    }
  },

  // リハビリテーション総合計画評価料（令和8年度改定：4段階区分）
  PLAN_POINTS: {
    PLAN_1_FIRST: 300,   // ・総合実施計画書1 (初回)
    PLAN_1_FOLLOW: 240,  // ・総合実施計画書1 (2回目以降)
    PLAN_2_FIRST: 240,   // ・総合実施計画書2 (初回)
    PLAN_2_FOLLOW: 196,  // ・総合実施計画書2 (2回目以降)
    // 既存コード互換用フォールバック
    PLAN_1: 300,
    PLAN_2: 240
  },

  // 総合実施計画書の選択肢マスター（UIプルダウン用）
  PLAN_OPTIONS: [
    { value: '', label: 'なし (算定しない)', points: 0 },
    { value: 'PLAN_1_FIRST', label: '総合実施計画書1 (初回: 300点)', points: 300 },
    { value: 'PLAN_1_FOLLOW', label: '総合実施計画書1 (2回目以降: 240点)', points: 240 },
    { value: 'PLAN_2_FIRST', label: '総合実施計画書2 (初回: 240点)', points: 240 },
    { value: 'PLAN_2_FOLLOW', label: '総合実施計画書2 (2回目以降: 196点)', points: 196 }
  ],

  // 介護保険認定区分
  CARE_INSURANCE: {
    NONE: { code: 'NONE', label: 'なし(医療のみ)' },
    SUPPORT: { code: 'SUPPORT', label: '要支援' },
    CARE: { code: 'CARE', label: '要介護' }
  },

  // 患者区分
  PATIENT_CATEGORY: {
    INPATIENT: { code: 'INPATIENT', label: '入院', colorBorder: '#d97706' },
    OUTPATIENT: { code: 'OUTPATIENT', label: '外来', colorBorder: '#2563eb' }
  },

  // 算定・人員基準上限
  LIMITS: {
    MONTHLY_MAINTENANCE_MAX: 13,   // 日数超過・介護保険対象者の月間上限単位
    DAILY_STANDARD: 6,             // 患者1日標準上限（120分）
    DAILY_ACUTE_MAX: 9,            // 発症14日以内の急性期特例（180分）
    THERAPIST_DAILY_STANDARD: 18,  // セラピスト1日標準（目安）
    THERAPIST_DAILY_MAX: 24,       // セラピスト1日特例上限（厳格ブロック）
    THERAPIST_WEEKLY_MAX: 108      // セラピスト週上限単位
  },

  // 1点あたりの円換算レート
  POINT_RATE: 10
};

/**
 * 現行施設の診療時間（画面設定・localStorage と同期）
 * 初期値: 保存済み設定があればそれ、なければ 午前09:00〜13:00 / 午後14:00〜18:00
 * ※オブジェクトは同一参照を維持し、プロパティだけ上書きする（import 側の参照を壊さない）
 */
export const FACILITY_HOURS = { ...DEFAULT_FACILITY_HOURS };

/**
 * 本日時間割・バリデーション・吸着・日誌の単一情報源
 * ※配列は同一参照を維持し、中身だけ差し替える（全 import 先が即時反映）
 */
export const TIME_SLOTS = [];

/** 外来予約カレンダー用の開始時刻文字列（TIME_SLOTS.start と同一系列・同一配列参照を appointmentSlots が再エクスポート） */
export const APPOINTMENT_TIME_STRINGS = [];

/** 午前／午後／全日コマ数（半日・終日休暇プリセットと整合・live binding） */
export let AM_SLOT_COUNT = 0;
export let PM_SLOT_COUNT = 0;
export let TOTAL_SLOT_COUNT = 0;

/**
 * FACILITY_HOURS / TIME_SLOTS / APPOINTMENT_TIME_STRINGS / コマ数をメモリ上で即時更新する。
 * 配列・オブジェクトは参照を維持したまま中身だけ差し替えるため、既存 import 先の再 import は不要。
 *
 * @param {Partial<typeof DEFAULT_FACILITY_HOURS>|null|undefined} [newHours]
 * @returns {{ success: boolean, message: string, hours: typeof DEFAULT_FACILITY_HOURS, am: number, pm: number, total: number }}
 */
export function reloadFacilityTimeSlots(newHours) {
  const source = newHours != null ? newHours : getSavedFacilityHours();
  const check = validateFacilityHours(source);
  if (!check.ok) {
    return {
      success: false,
      message: check.message,
      hours: { ...FACILITY_HOURS },
      am: AM_SLOT_COUNT,
      pm: PM_SLOT_COUNT,
      total: TOTAL_SLOT_COUNT
    };
  }

  const hours = normalizeFacilityHours(check.hours);
  FACILITY_HOURS.amStart = hours.amStart;
  FACILITY_HOURS.amEnd = hours.amEnd;
  FACILITY_HOURS.pmStart = hours.pmStart;
  FACILITY_HOURS.pmEnd = hours.pmEnd;

  const slots = generateTimeSlots(FACILITY_HOURS);
  TIME_SLOTS.length = 0;
  for (let i = 0; i < slots.length; i += 1) {
    TIME_SLOTS.push(slots[i]);
  }

  const aptStrings = generateAppointmentTimeStrings(FACILITY_HOURS);
  APPOINTMENT_TIME_STRINGS.length = 0;
  for (let i = 0; i < aptStrings.length; i += 1) {
    APPOINTMENT_TIME_STRINGS.push(aptStrings[i]);
  }

  AM_SLOT_COUNT = getAmSlotCount(FACILITY_HOURS);
  PM_SLOT_COUNT = getPmSlotCount(FACILITY_HOURS);
  TOTAL_SLOT_COUNT = getTotalSlotCount(FACILITY_HOURS);

  return {
    success: true,
    message: '施設時間枠をメモリへ反映しました',
    hours: { ...FACILITY_HOURS },
    am: AM_SLOT_COUNT,
    pm: PM_SLOT_COUNT,
    total: TOTAL_SLOT_COUNT
  };
}

// モジュール読込時に保存済み設定（なければデフォルト）で初期化
reloadFacilityTimeSlots(getSavedFacilityHours());

// 対象セラピストリスト定義
export const THERAPISTS = [
  { id: 'A', name: 'PT A', label: 'PT A' },
  { id: 'B', name: 'PT B', label: 'PT B' },
  { id: 'C', name: 'PT C', label: 'PT C' }
];

// 単位数別 UI 幾何学パラメータ＆ハイブリッド配色（パターンC 第2層）
export const UNIT_CONFIG = {
  1: {
    heightPx: 48,
    badgeBg: '#059669',
    badgeText: '#ffffff',
    gradientBg: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
    label: '1単位 (20分)'
  },
  2: {
    heightPx: 100,
    badgeBg: '#2563eb',
    badgeText: '#ffffff',
    gradientBg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
    label: '2単位 (40分)'
  },
  3: {
    heightPx: 152,
    badgeBg: '#7c3aed',
    badgeText: '#ffffff',
    gradientBg: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
    label: '3単位 (60分)'
  },
  4: {
    heightPx: 204,
    badgeBg: '#e11d48',
    badgeText: '#ffffff',
    gradientBg: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
    label: '4単位 (80分)'
  }
};
```

### 5.3 `js/core/timeSlotGenerator.js`

```javascript
// js/core/timeSlotGenerator.js
// 施設診療時間から20分刻みスロットを動的生成する単一情報源（Single Source of Truth）
// デフォルト: 午前 09:00〜13:00（12コマ）／昼休憩／午後 14:00〜18:00（12コマ）＝計24コマ
// 画面設定の永続化キー: localStorage 'reha_facility_hours'

/**
 * 施設の診療時間設定（スタッフ設定モーダル／定数初期値で同じ形）
 * @typedef {{ amStart: string, amEnd: string, pmStart: string, pmEnd: string }} FacilityHours
 */

/** localStorage キー（施設リハビリ提供時間） */
export const FACILITY_HOURS_STORAGE_KEY = 'reha_facility_hours';

/** @type {FacilityHours} */
export const DEFAULT_FACILITY_HOURS = {
  amStart: '09:00',
  amEnd: '13:00',   // 昼休憩開始（午前終了）
  pmStart: '14:00',  // 昼休憩終了（午後開始）
  pmEnd: '18:00'     // 業務終了
};

/**
 * HH:MM または HH:MM:SS を HH:MM に正規化
 * @param {string} timeStr
 * @returns {string}
 */
export function normalizeTimeString(timeStr) {
  if (!timeStr || !String(timeStr).includes(':')) return '';
  const parts = String(timeStr).trim().split(':');
  const h = Math.min(23, Math.max(0, Number(parts[0]) || 0));
  const m = Math.min(59, Math.max(0, Number(parts[1]) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * HH:MM 文字列を通算分（0〜1440）に変換
 * @param {string} timeStr
 * @returns {number}
 */
export function timeToMinutes(timeStr) {
  const normalized = normalizeTimeString(timeStr);
  if (!normalized) return 0;
  const [h, m] = normalized.split(':').map(Number);
  return ((Number(h) || 0) * 60) + (Number(m) || 0);
}

/**
 * 通算分を HH:MM 文字列に変換
 * @param {number} minutes
 * @returns {string}
 */
export function minutesToTime(minutes) {
  const total = ((Number(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 施設設定を正規化（欠落キーはデフォルトで補完・時刻を HH:MM 化）
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {FacilityHours}
 */
export function normalizeFacilityHours(hours) {
  return {
    amStart: normalizeTimeString(hours?.amStart) || DEFAULT_FACILITY_HOURS.amStart,
    amEnd: normalizeTimeString(hours?.amEnd) || DEFAULT_FACILITY_HOURS.amEnd,
    pmStart: normalizeTimeString(hours?.pmStart) || DEFAULT_FACILITY_HOURS.pmStart,
    pmEnd: normalizeTimeString(hours?.pmEnd) || DEFAULT_FACILITY_HOURS.pmEnd
  };
}

/**
 * 時刻逆転・コマ不足を検証
 * 条件: 午前開始 < 午前終了 <= 午後開始 < 業務終了、かつ午前・午後それぞれ最低1コマ（20分以上）
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {{ ok: boolean, message: string, hours: FacilityHours }}
 */
export function validateFacilityHours(hours) {
  const h = normalizeFacilityHours(hours);
  const amStart = timeToMinutes(h.amStart);
  const amEnd = timeToMinutes(h.amEnd);
  const pmStart = timeToMinutes(h.pmStart);
  const pmEnd = timeToMinutes(h.pmEnd);

  if (!(amStart < amEnd)) {
    return { ok: false, message: '午前開始は午前終了より前である必要があります', hours: h };
  }
  if (!(amEnd <= pmStart)) {
    return { ok: false, message: '午前終了は午後開始以前である必要があります（昼休憩の逆転を禁止）', hours: h };
  }
  if (!(pmStart < pmEnd)) {
    return { ok: false, message: '午後開始は業務終了より前である必要があります', hours: h };
  }
  if (amEnd - amStart < 20) {
    return { ok: false, message: '午前帯は最低20分（1コマ）以上必要です', hours: h };
  }
  if (pmEnd - pmStart < 20) {
    return { ok: false, message: '午後帯は最低20分（1コマ）以上必要です', hours: h };
  }

  return { ok: true, message: '', hours: h };
}

/**
 * バッジ表示用サマリー文字列を生成
 * @param {Partial<FacilityHours>|null|undefined} hours
 * @returns {string}
 */
export function formatFacilityHoursSummary(hours) {
  const check = validateFacilityHours(hours);
  const h = check.hours;
  if (!check.ok) {
    return `⚠ ${check.message}`;
  }
  const am = getAmSlotCount(h);
  const pm = getPmSlotCount(h);
  const total = am + pm;
  const breakMin = timeToMinutes(h.pmStart) - timeToMinutes(h.amEnd);
  const breakLabel = breakMin > 0 ? `昼休憩 ${breakMin}分` : '昼休憩なし（連続）';
  return `午前 ${am}コマ ／ 午後 ${pm}コマ ＝ 計 ${total}コマ（${breakLabel}）`;
}

/**
 * 保存済み施設時間を取得（未保存・破損時はデフォルト）
 * @returns {FacilityHours}
 */
export function getSavedFacilityHours() {
  try {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_FACILITY_HOURS };
    }
    const raw = localStorage.getItem(FACILITY_HOURS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FACILITY_HOURS };
    const parsed = JSON.parse(raw);
    const check = validateFacilityHours(parsed);
    if (!check.ok) return { ...DEFAULT_FACILITY_HOURS };
    return check.hours;
  } catch (_) {
    return { ...DEFAULT_FACILITY_HOURS };
  }
}

/**
 * 施設時間を検証して localStorage に保存
 * @param {Partial<FacilityHours>} hours
 * @returns {{ success: boolean, message: string, hours: FacilityHours }}
 */
export function saveFacilityHours(hours) {
  const check = validateFacilityHours(hours);
  if (!check.ok) {
    return { success: false, message: check.message, hours: check.hours };
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FACILITY_HOURS_STORAGE_KEY, JSON.stringify(check.hours));
    }
    return { success: true, message: '施設リハビリ提供時間を保存しました', hours: check.hours };
  } catch (_) {
    return { success: false, message: '施設時間の保存に失敗しました（ストレージ書き込み不可）', hours: check.hours };
  }
}

/**
 * 施設設定に基づいて20分刻みの TIME_SLOTS 配列を動的生成する。
 * 既存画面互換のため period は 'am'|'pm'、label は 'HH:MM - HH:MM'、start/end を必ず付与する。
 *
 * @param {Partial<FacilityHours>} [hours]
 * @returns {Array<{
 *   id: string,
 *   label: string,
 *   start: string,
 *   end: string,
 *   startTime: string,
 *   endTime: string,
 *   period: 'am'|'pm',
 *   order: number
 * }>}
 */
export function generateTimeSlots(hours = DEFAULT_FACILITY_HOURS) {
  const h = normalizeFacilityHours(hours);
  const slots = [];

  const amStartMin = timeToMinutes(h.amStart);
  const amEndMin = timeToMinutes(h.amEnd);
  const pmStartMin = timeToMinutes(h.pmStart);
  const pmEndMin = timeToMinutes(h.pmEnd);

  let order = 1;

  // 午前スロット（例: 09:00〜13:00 → 12コマ）
  let amCount = 1;
  for (let t = amStartMin; t + 20 <= amEndMin; t += 20) {
    const startStr = minutesToTime(t);
    const endStr = minutesToTime(t + 20);
    slots.push({
      id: `am_${amCount}`,
      label: `${startStr} - ${endStr}`,
      start: startStr,
      end: endStr,
      startTime: startStr,
      endTime: endStr,
      period: 'am',
      order
    });
    amCount += 1;
    order += 1;
  }

  // 午後スロット（例: 14:00〜18:00 → 12コマ）
  let pmCount = 1;
  for (let t = pmStartMin; t + 20 <= pmEndMin; t += 20) {
    const startStr = minutesToTime(t);
    const endStr = minutesToTime(t + 20);
    slots.push({
      id: `pm_${pmCount}`,
      label: `${startStr} - ${endStr}`,
      start: startStr,
      end: endStr,
      startTime: startStr,
      endTime: endStr,
      period: 'pm',
      order
    });
    pmCount += 1;
    order += 1;
  }

  return slots;
}

/**
 * 外来予約カレンダー用の開始時刻文字列配列（TIME_SLOTS の start と完全一致）
 * @param {Partial<FacilityHours>} [hours]
 * @returns {string[]}
 */
export function generateAppointmentTimeStrings(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).map((slot) => slot.start);
}

/**
 * 午前コマ数（半日有休・公休の既定コマ数に使用）
 * @param {Partial<FacilityHours>} [hours]
 * @returns {number}
 */
export function getAmSlotCount(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).filter((s) => s.period === 'am').length;
}

/**
 * 午後コマ数
 * @param {Partial<FacilityHours>} [hours]
 * @returns {number}
 */
export function getPmSlotCount(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).filter((s) => s.period === 'pm').length;
}

/**
 * 1日の総コマ数（デフォルト24＝セラピスト日上限・終日休暇と調和）
 * @param {Partial<FacilityHours>} [hours]
 * @returns {number}
 */
export function getTotalSlotCount(hours = DEFAULT_FACILITY_HOURS) {
  return generateTimeSlots(hours).length;
}

/**
 * スロットが午後帯か（業務日誌の午前／午後休暇判定用）
 * @param {{ period?: string }|null|undefined} slot
 * @returns {boolean}
 */
export function isAfternoonSlot(slot) {
  const p = String(slot?.period || '').toLowerCase();
  return p === 'pm';
}
```

### 5.4 `js/core/storageAdapter.js`

```javascript
// js/core/storageAdapter.js
// IndexedDB 透過的ストレージ層（メモリキャッシュ同期読み取り + IDB非同期永続化）
// フェーズ3: 過去月スケジュールの選択的ハイドレーション／メモリパージ連携

const DB_NAME = 'reha_work_manager_db';
const DB_VERSION = 1;
const STORE_NAME = 'app_key_value_store';
const KEY_PREFIX = 'reha_';
const SCHEDULE_PREFIX = 'reha_schedule_';
const META_MIGRATED = '__reha_storage_migrated_v1';

/** @type {Map<string, string>} */
const memoryCache = new Map();

/** IndexedDB 上に存在する全キーの索引（値は持たない・アーカイブ件数把握用） */
const keyIndex = new Set();

/** @type {IDBDatabase|null} */
let dbInstance = null;

let initPromise = null;
let isReady = false;

/**
 * スケジュールキーをメモリに載せるかの判定関数（archiveManager が設定）
 * @type {((key: string) => boolean)|null}
 */
let scheduleHydrationFilter = null;

/**
 * 起動前にアーカイブ窓フィルタを登録する
 * @param {(key: string) => boolean} fn
 */
export function setScheduleHydrationFilter(fn) {
  scheduleHydrationFilter = typeof fn === 'function' ? fn : null;
}

function shouldHydrateIntoMemory(key) {
  if (!key || key === META_MIGRATED) return false;
  if (!key.startsWith(SCHEDULE_PREFIX)) return true;
  if (typeof scheduleHydrationFilter === 'function') {
    return scheduleHydrationFilter(key);
  }
  return true;
}

/**
 * IndexedDB を開く
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      const row = request.result;
      resolve(row && row.value !== undefined ? String(row.value) : null);
    };
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ key, value: String(value) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB put aborted'));
  });
}

function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbPutMany(db, entries) {
  return new Promise((resolve, reject) => {
    if (!entries.length) {
      resolve();
      return;
    }
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    entries.forEach((entry) => {
      store.put({ key: entry.key, value: String(entry.value) });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function collectLocalStorageRehaEntries() {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      entries.push({ key, value });
    }
  } catch (e) {
    console.warn('[storageAdapter] localStorage scan failed:', e);
  }
  return entries;
}

function tryMirrorLocalStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
      return;
    }
    console.warn('[storageAdapter] localStorage mirror warn:', key, e);
  }
}

function tryRemoveLocalStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('[storageAdapter] localStorage remove warn:', key, e);
  }
}

/**
 * レコードを索引登録し、フィルタに合うものだけメモリへ載せる
 * @param {Array<{key: string, value: string}>} records
 */
function loadIntoMemorySelective(records) {
  memoryCache.clear();
  keyIndex.clear();
  let hydrated = 0;
  let skippedSchedule = 0;

  records.forEach((rec) => {
    if (!rec || !rec.key) return;
    if (rec.key === META_MIGRATED) return;
    keyIndex.add(rec.key);
    if (shouldHydrateIntoMemory(rec.key)) {
      memoryCache.set(rec.key, String(rec.value ?? ''));
      hydrated += 1;
    } else if (rec.key.startsWith(SCHEDULE_PREFIX)) {
      skippedSchedule += 1;
    }
  });

  console.log(
    `[storageAdapter] Memory hydrate: ${hydrated} keys (archived schedules kept cold: ${skippedSchedule})`
  );
}

/**
 * 起動時初期化
 * @returns {Promise<{ migrated: boolean, keyCount: number, memoryCount: number }>}
 */
export async function initStorage() {
  if (isReady) {
    return { migrated: false, keyCount: keyIndex.size, memoryCount: memoryCache.size };
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let migrated = false;

    try {
      dbInstance = await openDatabase();
      let records = await idbGetAll(dbInstance);
      const dataRecords = records.filter((r) => r && r.key && r.key !== META_MIGRATED);

      if (dataRecords.length === 0) {
        const lsEntries = collectLocalStorageRehaEntries();
        if (lsEntries.length > 0) {
          await idbPutMany(dbInstance, lsEntries);
          await idbPut(dbInstance, META_MIGRATED, new Date().toISOString());
          migrated = true;
          console.log(`[storageAdapter] Migrated ${lsEntries.length} keys from localStorage → IndexedDB`);
        }
        records = await idbGetAll(dbInstance);
      } else {
        const existing = new Set(dataRecords.map((r) => r.key));
        const missing = collectLocalStorageRehaEntries().filter((e) => !existing.has(e.key));
        if (missing.length > 0) {
          await idbPutMany(dbInstance, missing);
          records = await idbGetAll(dbInstance);
          console.log(`[storageAdapter] Merged ${missing.length} missing localStorage keys into IndexedDB`);
        }
      }

      loadIntoMemorySelective(records);
    } catch (err) {
      console.warn('[storageAdapter] IndexedDB unavailable — falling back to localStorage memory preload:', err);
      dbInstance = null;
      loadIntoMemorySelective(collectLocalStorageRehaEntries());
    }

    isReady = true;
    console.log(`[storageAdapter] Ready. index=${keyIndex.size}, memory=${memoryCache.size}, migrated=${migrated}`);
    return { migrated, keyCount: keyIndex.size, memoryCount: memoryCache.size };
  })();

  try {
    return await initPromise;
  } catch (e) {
    initPromise = null;
    isReady = true;
    loadIntoMemorySelective(collectLocalStorageRehaEntries());
    console.warn('[storageAdapter] init failed hard, LS-only mode:', e);
    return { migrated: false, keyCount: keyIndex.size, memoryCount: memoryCache.size };
  }
}

/**
 * 同期読み取り（メモリ → localStorage フォールバック）
 * アーカイブ済みスケジュールは loadMonthOnDemand 後にメモリへ載る。
 * @param {string} key
 * @param {string|null} fallback
 * @returns {string|null}
 */
export function storageGet(key, fallback = null) {
  if (!key) return fallback;
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      memoryCache.set(key, raw);
      keyIndex.add(key);
      return raw;
    }
  } catch (_) { /* ignore */ }
  return fallback;
}

/**
 * 同期書き込み: メモリ即時 + IDB 非同期 + LS ミラー
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function storageSet(key, value) {
  if (!key) return false;
  const str = value === undefined || value === null ? '' : String(value);

  keyIndex.add(key);
  memoryCache.set(key, str);

  if (dbInstance) {
    idbPut(dbInstance, key, str).catch((err) => {
      console.error('[storageAdapter] IndexedDB put failed:', key, err);
    });
  }

  tryMirrorLocalStorage(key, str);
  return true;
}

/**
 * キー完全削除（メモリ + IDB + LS）
 * @param {string} key
 * @returns {boolean}
 */
export function storageRemove(key) {
  if (!key) return false;
  memoryCache.delete(key);
  keyIndex.delete(key);

  if (dbInstance) {
    idbDelete(dbInstance, key).catch((err) => {
      console.error('[storageAdapter] IndexedDB delete failed:', key, err);
    });
  }

  tryRemoveLocalStorage(key);
  return true;
}

/**
 * メモリからのみ外す（IDB・索引は維持＝アーカイブ退避）
 * @param {string} key
 */
export function storagePurgeFromMemory(key) {
  if (!key) return;
  memoryCache.delete(key);
}

/**
 * @param {string[]} keys
 * @returns {number} パージ件数
 */
export function storagePurgeKeysFromMemory(keys) {
  let n = 0;
  (keys || []).forEach((key) => {
    if (memoryCache.has(key)) {
      memoryCache.delete(key);
      n += 1;
    }
  });
  return n;
}

/**
 * IndexedDB から指定キーをメモリへオンデマンド復元
 * @param {string[]} keys
 * @returns {Promise<number>} 新規ハイドレート件数
 */
export async function storageHydrateKeys(keys) {
  if (!keys || keys.length === 0) return 0;
  let loaded = 0;

  for (const key of keys) {
    if (!key || memoryCache.has(key)) continue;
    keyIndex.add(key);

    if (dbInstance) {
      try {
        const val = await idbGet(dbInstance, key);
        if (val !== null) {
          memoryCache.set(key, val);
          loaded += 1;
          continue;
        }
      } catch (e) {
        console.warn('[storageAdapter] hydrate idb get failed:', key, e);
      }
    }

    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        memoryCache.set(key, raw);
        loaded += 1;
      }
    } catch (_) { /* ignore */ }
  }

  return loaded;
}

/**
 * 既知キー一覧（索引ベース・アーカイブ分も含む）
 * @param {string} prefix
 * @returns {string[]}
 */
export function storageKeys(prefix = '') {
  const keys = [];
  keyIndex.forEach((key) => {
    if (!prefix || key.startsWith(prefix)) keys.push(key);
  });
  if (keys.length === 0 && !isReady) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (!prefix || key.startsWith(prefix))) keys.push(key);
      }
    } catch (_) { /* ignore */ }
  }
  return keys.sort();
}

/**
 * メモリ上に載っているキーのみ
 * @param {string} prefix
 * @returns {string[]}
 */
export function storageMemoryKeys(prefix = '') {
  const keys = [];
  memoryCache.forEach((_, key) => {
    if (!prefix || key.startsWith(prefix)) keys.push(key);
  });
  return keys.sort();
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function storageMemoryHas(key) {
  return memoryCache.has(key);
}

/**
 * プレフィックス一致キーを完全削除
 * @param {string} prefix
 */
export function storageRemoveByPrefix(prefix) {
  storageKeys(prefix).forEach((key) => storageRemove(key));
}

/**
 * 同期スナップショット（メモリ上のみ — バックアップには storageFullSnapshotAsync を使う）
 * @param {string} prefix
 * @returns {Record<string, string>}
 */
export function storageSnapshot(prefix = KEY_PREFIX) {
  const dump = {};
  storageMemoryKeys(prefix).forEach((key) => {
    if (key === META_MIGRATED) return;
    const val = memoryCache.get(key);
    if (val !== undefined) dump[key] = val;
  });
  return dump;
}

/**
 * バックアップ用: IndexedDB 全件（アーカイブ含む）を非同期取得
 * @param {string} prefix
 * @returns {Promise<Record<string, string>>}
 */
export async function storageFullSnapshotAsync(prefix = KEY_PREFIX) {
  const dump = {};

  if (dbInstance) {
    try {
      const records = await idbGetAll(dbInstance);
      records.forEach((rec) => {
        if (!rec || !rec.key || rec.key === META_MIGRATED) return;
        if (prefix && !rec.key.startsWith(prefix)) return;
        dump[rec.key] = String(rec.value ?? '');
        keyIndex.add(rec.key);
      });
      return dump;
    } catch (e) {
      console.warn('[storageAdapter] full snapshot IDB failed, falling back to memory:', e);
    }
  }

  return { ...storageSnapshot(prefix) };
}

/**
 * @returns {boolean}
 */
export function isStorageReady() {
  return isReady;
}

/**
 * 統計（アーカイブ UI 用）
 * @returns {{ indexCount: number, memoryCount: number, scheduleIndex: number, scheduleMemory: number }}
 */
export function getStorageStats() {
  let scheduleIndex = 0;
  let scheduleMemory = 0;
  keyIndex.forEach((key) => {
    if (key.startsWith(SCHEDULE_PREFIX)) scheduleIndex += 1;
  });
  memoryCache.forEach((_, key) => {
    if (key.startsWith(SCHEDULE_PREFIX)) scheduleMemory += 1;
  });
  return {
    indexCount: keyIndex.size,
    memoryCount: memoryCache.size,
    scheduleIndex,
    scheduleMemory
  };
}

export { SCHEDULE_PREFIX };
```

### 5.5 `js/core/deadlineCalc.js`

```javascript
// js/core/deadlineCalc.js
// 期限・早期加算・要介護3分の1移行日計算・総合計画書自動判定エンジン
// DOMおよびStorageに一切依存しない純粋関数群として実装（200行制限準拠）

import { REHA_RULES } from '../config/rules.js';
import { normalizeDateString } from './dataNormalizer.js';

/**
 * 日付オブジェクトまたは文字列を、時刻を切り捨てたローカルDateに変換する
 * @param {string|Date} input 
 * @returns {Date|null}
 */
export function normalizeDate(input) {
  if (!input) return null;
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }
  const dateStr = normalizeDateString(input);
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

/**
 * Dateオブジェクトを YYYY-MM-DD 形式にフォーマットする
 * @param {Date} date 
 * @returns {string}
 */
export function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 2つの日付の暦日差を返す。同日は 0。算定日数（初日算入）そのものではない。
 * ローカル日付の 0:00 同士で引くため、JST と UTC の 9 時間差は入らない。
 * @param {string|Date} fromDate
 * @param {string|Date} toDate
 * @returns {number|null}
 */
export function getDiffDays(fromDate, toDate) {
  const f = normalizeDate(fromDate);
  const t = normalizeDate(toDate);
  if (!f || !t) return null;
  const diffTime = t.getTime() - f.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * 起算日当日を 1 日目とする経過日数（診療報酬の初日算入）。
 * 同日は 1。起算日の前日は 0。
 * @param {string|Date} fromDate 起算日
 * @param {string|Date} toDate 判定日
 * @returns {number|null}
 */
export function getInclusiveDayCount(fromDate, toDate) {
  const diff = getDiffDays(fromDate, toDate);
  if (diff === null) return null;
  return diff + 1;
}

/**
 * 疾患区分に応じた標準算定日数の3分の1日数を取得する
 * @param {string} diseaseType LOCOMOTIVE | CEREBROVASCULAR | DISUSE | ANALGESIA
 * @returns {number}
 */
export function getOneThirdDays(diseaseType) {
  const rule = REHA_RULES.LIMIT_DAYS[diseaseType];
  return rule ? rule.oneThirdDays : 9999;
}

/**
 * 基準日に指定日数を加算した日付文字列を返す
 * @param {string|Date} baseDate 
 * @param {number} daysToAdd 
 * @returns {string}
 */
export function addDays(baseDate, daysToAdd) {
  const d = normalizeDate(baseDate);
  if (!d) return '';
  d.setDate(d.getDate() + daysToAdd);
  return formatDate(d);
}

/**
 * 入院患者の早期加算フェーズ・終了日・残日数を自動評価する（令和8年度改定準拠）
 * 起算日（転院患者は前医入院日、直接入院は当院入院日）当日を 1 日目とする
 * 1〜3日目: 60点, 4〜14日目: 25点, 15日目以降: なし
 * 告示は「起算日から4日目以降は25点」「14日を限度」。旧30日限度は令和8年度で廃止。
 * @param {string|Date} admissionOrStart 早期起算日
 * @param {string|Date} sessionDate 実施日
 * @param {string} category 患者区分 (INPATIENT | OUTPATIENT)
 * @returns {Object}
 */
export function evaluateEarlyBonusPhase(admissionOrStart, sessionDate, category = 'INPATIENT') {
  if (category !== 'INPATIENT') {
    return { phase: null, points: 0, label: '外来対象外', isEligible: false, endDateStr: '', remainingDays: null, shortLabel: '' };
  }
  const dayCount = getInclusiveDayCount(admissionOrStart, sessionDate);
  if (dayCount === null || dayCount < 1) {
    return { phase: null, points: 0, label: '対象外', isEligible: false, endDateStr: '', remainingDays: null, shortLabel: '' };
  }
  const maxAllowedDays = REHA_RULES.EARLY_BONUS.PHASE_2.maxDays;
  const endDateStr = addDays(admissionOrStart, maxAllowedDays - 1);
  const remainingDays = maxAllowedDays - dayCount;

  const endParts = endDateStr.split('-');
  const shortDateStr = endParts.length === 3 ? `${Number(endParts[1])}/${Number(endParts[2])}` : '';

  if (dayCount <= REHA_RULES.EARLY_BONUS.PHASE_1.maxDays) {
    return {
      phase: 'PHASE_1',
      points: REHA_RULES.EARLY_BONUS.PHASE_1.points,
      label: `早期加算(Ⅰ) +${REHA_RULES.EARLY_BONUS.PHASE_1.points}点 [${dayCount}日目]`,
      isEligible: true,
      dayCount,
      endDateStr,
      remainingDays,
      shortLabel: `早:〜${shortDateStr}`
    };
  }
  if (dayCount <= maxAllowedDays) {
    return {
      phase: 'PHASE_2',
      points: REHA_RULES.EARLY_BONUS.PHASE_2.points,
      label: `早期加算(Ⅱ) +${REHA_RULES.EARLY_BONUS.PHASE_2.points}点 [${dayCount}日目]`,
      isEligible: true,
      dayCount,
      endDateStr,
      remainingDays,
      shortLabel: `早:〜${shortDateStr}`
    };
  }
  return {
    phase: null,
    points: 0,
    label: `早期加算終了 [${dayCount}日目]`,
    isEligible: false,
    dayCount,
    endDateStr,
    remainingDays: 0,
    shortLabel: ''
  };
}

/**
 * 患者の標準算定上限日・早期加算ステータス・要介護3分の1移行日を包括計算する
 * @param {Object} patient 患者マスター情報
 * @param {string|Date} baseDate 判定基準日（通常は当日）
 * @returns {Object} 判定結果オブジェクト
 */
export function calculatePatientDeadlines(patient, baseDate = new Date()) {
  const disease = REHA_RULES.LIMIT_DAYS[patient?.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
  const startDateStr = patient?.onsetDate || patient?.admissionDate || '';
  const earlyStartStr = patient?.earlyBonusStartDate || patient?.admissionDate || '';

  let limitDateStr = '';
  let remainingDays = null;
  let elapsedDays = null;
  let isLimitExceeded = false;

  if (startDateStr && disease.days < 9000) {
    // 満了日 = 起算日 + (標準日数 - 1)。起算日が1日目、標準日数日目が最終算定日。
    // 翌日（標準日数 + 1 日目）から期限超過（月13単位）。
    limitDateStr = addDays(startDateStr, disease.days - 1);
    elapsedDays = getInclusiveDayCount(startDateStr, baseDate);
    if (elapsedDays !== null) {
      isLimitExceeded = elapsedDays > disease.days;
      remainingDays = disease.days - elapsedDays;
    }
  }

  const earlyBonus = evaluateEarlyBonusPhase(earlyStartStr, baseDate, patient?.category);

  let plan2TransitionDateStr = '';
  let plan2RemainingDays = null;
  let isPlan2Required = false;

  if (patient?.careInsuranceType === 'CARE' && startDateStr && disease.oneThirdDays < 9000) {
    // 「3分の1を超えた」翌日が移行日。50日なら起算日から数えて51日目 = 起算日+50日。
    plan2TransitionDateStr = addDays(startDateStr, disease.oneThirdDays);
    const diffToPlan2 = getDiffDays(baseDate, plan2TransitionDateStr);
    plan2RemainingDays = diffToPlan2 !== null ? diffToPlan2 : null;
    isPlan2Required = plan2RemainingDays !== null && plan2RemainingDays <= 0;
  }

  // 単価は実施日（baseDate）単位で判定。月一括の一律掛けはしない。
  const rate = getDailyBasePoints(patient, baseDate);
  const isCareInsured = rate.isCareInsured;
  const isMaintenanceReduction = rate.isCareReduced;
  const currentBasePoints = rate.points;

  return {
    diseaseLabel: disease.shortLabel,
    diseaseFullName: disease.fullName,
    standardDays: disease.days,
    startDateStr,
    elapsedDays,
    limitDateStr,
    remainingDays,
    isLimitExceeded,
    earlyBonus,
    isCareInsured,
    isMaintenanceReduction,
    currentBasePoints,
    careInsuranceType: patient?.careInsuranceType || 'NONE',
    plan2TransitionDateStr,
    plan2RemainingDays,
    isPlan2Required,
    dailyRateReason: rate.reason
  };
}

/**
 * 特定の実施日におけるリハビリ1単位あたりの算定点数を厳密取得する。
 * 満了日当日（第N日）までは正規点数、翌日（第N+1日）から維持期判定へ切り替える。
 * 医療保険のみ（NONE）は超過後も所定点数のまま。要介護・要支援のみ maintPoints を適用する。
 * @param {Object} patient
 * @param {string|Date} sessionDateStr
 * @returns {{ points: number, isMaintenance: boolean, isCareReduced: boolean, isCareInsured: boolean, reason: string }}
 */
export function getDailyBasePoints(patient, sessionDateStr) {
  const disease = REHA_RULES.LIMIT_DAYS[patient?.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
  const isCareInsured = patient?.careInsuranceType === 'CARE' || patient?.careInsuranceType === 'SUPPORT';

  if (!patient || patient.diseaseType === 'ANALGESIA' || disease.days >= 9000) {
    return {
      points: disease.defaultPoints,
      isMaintenance: false,
      isCareReduced: false,
      isCareInsured,
      reason: 'REGULAR'
    };
  }

  const force13 = patient.force13Limit === true || patient.force13UnitsLimit === true;
  if (force13 && isCareInsured) {
    return {
      points: disease.maintPoints,
      isMaintenance: true,
      isCareReduced: true,
      isCareInsured,
      reason: 'FORCE_CARE_MAINTENANCE'
    };
  }

  const startDateStr = normalizeDateString(patient.onsetDate || patient.admissionDate || '');
  if (!startDateStr) {
    return {
      points: disease.defaultPoints,
      isMaintenance: false,
      isCareReduced: false,
      isCareInsured,
      reason: 'NO_START_DATE'
    };
  }

  const elapsedDays = getInclusiveDayCount(startDateStr, sessionDateStr);
  // 標準算定日数以内（満了日当日を含む）: 誰でも正規満額
  if (elapsedDays === null || elapsedDays <= disease.days) {
    return {
      points: disease.defaultPoints,
      isMaintenance: false,
      isCareReduced: false,
      isCareInsured,
      reason: 'WITHIN_STANDARD_DAYS'
    };
  }

  // 標準算定日数超過後（満了日の翌日以降）
  if (!isCareInsured) {
    return {
      points: disease.defaultPoints,
      isMaintenance: true,
      isCareReduced: false,
      isCareInsured,
      reason: 'MEDICAL_ONLY_EXPIRED'
    };
  }

  return {
    points: disease.maintPoints,
    isMaintenance: true,
    isCareReduced: true,
    isCareInsured,
    reason: 'CARE_MAINTENANCE_REDUCED'
  };
}

/**
 * リハ総合計画評価料（4区分）の推奨選択肢を自動判定する純粋関数
 * 患者マスターの planStatus（計画書2継続中固定など）を最優先に評価する
 * @param {Object} patient 患者マスター情報
 * @param {string} targetDateStr 算定対象日 (YYYY-MM-DD)
 * @param {boolean} hasPastPlan 過去（対象日より前）に算定実績があるか
 * @returns {{ recommendedPlan: string, label: string, points: number, reason: string }}
 */
export function evaluateRecommendedPlan(patient, targetDateStr, hasPastPlan = false) {
  if (!patient || patient.diseaseType === 'ANALGESIA') {
    return { recommendedPlan: '', label: 'なし (算定しない)', points: 0, reason: '物療または患者未選択' };
  }

  // A: 患者マスターで「計画書2継続中」が指定されている場合は、無条件で196点固定
  if (patient.planStatus === 'PLAN_2_FOLLOW') {
    return {
      recommendedPlan: 'PLAN_2_FOLLOW',
      label: '総合実施計画書2 (2回目以降: 196点)',
      points: REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW,
      reason: '患者台帳: 計画書2継続中 (196点固定)'
    };
  }

  const deadlines = calculatePatientDeadlines(patient, targetDateStr);
  const isPlan2 = deadlines.isPlan2Required;

  // B: 患者マスターで「計画書1継続中」が指定されている場合
  if (patient.planStatus === 'PLAN_1_FOLLOW') {
    if (isPlan2) {
      return {
        recommendedPlan: 'PLAN_2_FOLLOW',
        label: '総合実施計画書2 (2回目以降: 196点)',
        points: REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW,
        reason: '計画書2への移行日到達 (2回目以降)'
      };
    }
    return {
      recommendedPlan: 'PLAN_1_FOLLOW',
      label: '総合実施計画書1 (2回目以降: 240点)',
      points: REHA_RULES.PLAN_POINTS.PLAN_1_FOLLOW,
      reason: '患者台帳: 計画書1継続中 (2回目以降)'
    };
  }

  // C: 未算定（初回対象）または未設定の場合
  const isFirst = !hasPastPlan;
  if (isPlan2) {
    return isFirst
      ? {
          recommendedPlan: 'PLAN_2_FIRST',
          label: '総合実施計画書2 (初回: 240点)',
          points: REHA_RULES.PLAN_POINTS.PLAN_2_FIRST,
          reason: '要介護認定 ＋ 3分の1日数経過 (初回)'
        }
      : {
          recommendedPlan: 'PLAN_2_FOLLOW',
          label: '総合実施計画書2 (2回目以降: 196点)',
          points: REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW,
          reason: '要介護認定 ＋ 3分の1日数経過 (2回目以降)'
        };
  }

  return isFirst
    ? {
        recommendedPlan: 'PLAN_1_FIRST',
        label: '総合実施計画書1 (初回: 300点)',
        points: REHA_RULES.PLAN_POINTS.PLAN_1_FIRST,
        reason: '通常算定 (初回)'
      }
    : {
        recommendedPlan: 'PLAN_1_FOLLOW',
        label: '総合実施計画書1 (2回目以降: 240点)',
        points: REHA_RULES.PLAN_POINTS.PLAN_1_FOLLOW,
        reason: '通常算定 (2回目以降)'
      };
}

function sumUnits(dailyUnitsMap) {
  return Object.values(dailyUnitsMap || {}).reduce((sum, units) => sum + (Number(units) || 0), 0);
}

/**
 * 対象月の実施が月13単位制限を超えるかを、期限満了日の翌日から数えて判定する。
 * 要介護・要支援だけでは制限しない。標準算定日数の満了後、または個別の13単位指定があるときだけ対象。
 * @param {Object} patient
 * @param {number} year
 * @param {number} month 1〜12
 * @param {Object|number[]} dailyUnitsMap 日別単位。キーは日（1〜31）
 * @returns {{ isOver13: boolean, applicableUnits: number, reason: string }}
 */
export function checkMonth13UnitsViolation(patient, year, month, dailyUnitsMap = {}) {
  const force13 = patient?.force13Limit === true || patient?.force13UnitsLimit === true;
  if (force13) {
    const totalMonthUnits = sumUnits(dailyUnitsMap);
    return {
      isOver13: totalMonthUnits > 13,
      applicableUnits: totalMonthUnits,
      reason: 'FORCE_13_LIMIT'
    };
  }

  const onsetStr = normalizeDateString(patient?.onsetDate);
  if (!patient || patient.diseaseType === 'ANALGESIA' || !onsetStr) {
    return { isOver13: false, applicableUnits: 0, reason: 'NOT_APPLICABLE' };
  }

  const rule = REHA_RULES.LIMIT_DAYS[patient.diseaseType];
  if (!rule || !rule.days || rule.days >= 9000) {
    return { isOver13: false, applicableUnits: 0, reason: 'NO_LIMIT_RULE' };
  }

  const deadlineStr = addDays(onsetStr, rule.days - 1);
  if (!deadlineStr) {
    return { isOver13: false, applicableUnits: 0, reason: 'NOT_APPLICABLE' };
  }

  const y = Number(year);
  const m = Number(month);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStartStr = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEndStr = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  if (deadlineStr < monthStartStr) {
    const totalMonthUnits = sumUnits(dailyUnitsMap);
    return {
      isOver13: totalMonthUnits > 13,
      applicableUnits: totalMonthUnits,
      reason: 'EXPIRED_BEFORE_MONTH'
    };
  }

  if (deadlineStr >= monthStartStr && deadlineStr < monthEndStr) {
    const deadlineDay = Number(deadlineStr.slice(8, 10));
    let postDeadlineUnits = 0;
    for (let day = deadlineDay + 1; day <= daysInMonth; day += 1) {
      postDeadlineUnits += Number(dailyUnitsMap[day]) || 0;
    }
    return {
      isOver13: postDeadlineUnits > 13,
      applicableUnits: postDeadlineUnits,
      reason: 'EXPIRED_DURING_MONTH'
    };
  }

  return { isOver13: false, applicableUnits: 0, reason: 'WITHIN_LIMIT' };
}
```

### 5.6 `js/backup/backupService.js`

```javascript
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
```

### 5.7 `main.js`

```javascript
const { app, BrowserWindow, Menu, shell, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// file:// で開くと origin が null になり、type="module" の app.js が CORS で拒否される。
// 標準スキーム app:// で配信し、モジュール読み込みを許可する。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// 二重起動防止のロック取得
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;

const { getBackupDirectoryPath, setupBackupIpc } = require('./main/backupIpc');

function isInsideAppDirectory(filePath) {
  const root = path.resolve(__dirname);
  const target = path.resolve(filePath);
  const relativePath = path.relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    const requestUrl = new URL(request.url);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const filePath = path.join(__dirname, pathname);
    if (!isInsideAppDirectory(filePath)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'リハビリ業務管理システム (reha-work-manager)',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // 外部ファイル連携とプリロード通信のためfalseに変更しcontextBridgeで厳格保護
      webSecurity: true
    }
  });

  // 医療現場向けに不要なメニューバーを整理
  const menuTemplate = [
    {
      label: 'ファイル',
      submenu: [
        {
          label: 'バックアップフォルダを開く',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            const dir = getBackupDirectoryPath();
            shell.openPath(dir);
          }
        },
        { type: 'separator' },
        {
          label: '最新状態に更新 (リロード)',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.reload()
        },
        { type: 'separator' },
        {
          label: '終了',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '表示',
      submenu: [
        { label: '拡大', role: 'zoomIn' },
        { label: '縮小', role: 'zoomOut' },
        { label: '標準サイズに戻す', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全画面表示切替', role: 'togglefullscreen' }
      ]
    },
    {
      label: '開発者ツール',
      submenu: [
        {
          label: '開発者ツールを開く/閉じる (F12)',
          accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.loadURL('app://localhost/index.html');

  // ウィンドウが閉じられたときの参照解除
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  setupBackupIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Windowsでは全ウィンドウが閉じられたらアプリを終了
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 二重起動が試みられた場合は既存ウィンドウを前面に表示
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
```

### 5.8 `main/backupIpc.js`

```javascript
// main/backupIpc.js
// ドキュメントフォルダへの日次バックアップ書き出し

const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * バックアップ専用フォルダのパスを取得・未存在時は自動生成
 * 保存先: Windowsの「ドキュメント」フォルダ内 \ リハ業務管理_自動バックアップ
 */
function formatLocalDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getBackupDirectoryPath() {
  const documentsPath = app.getPath('documents');
  const backupDir = path.join(documentsPath, 'リハ業務管理_自動バックアップ');
  if (!fs.existsSync(backupDir)) {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create backup directory:', e);
    }
  }
  return backupDir;
}

/**
 * 直近14世代（14日分）を超過した古い自動バックアップJSONを安全に自動消去する
 */
function isDailyBackupFileName(file) {
  if (!file || !file.endsWith('.json')) return false;
  // 現行: reha_backup_YYYY-MM-DD.json / 旧互換: reha_autobackup_YYYY-MM-DD.json
  return file.startsWith('reha_backup_') || file.startsWith('reha_autobackup_');
}

function cleanOldBackupFiles(backupDir, keepCount = 14) {
  try {
    if (!fs.existsSync(backupDir)) return;
    const files = fs.readdirSync(backupDir);
    const backupFiles = files
      .filter((file) => isDailyBackupFileName(file))
      .sort(); // ファイル名昇順（日付順 YYYY-MM-DD）

    while (backupFiles.length > keepCount) {
      const oldestFile = backupFiles.shift();
      if (oldestFile) {
        const fullPath = path.join(backupDir, oldestFile);
        fs.unlinkSync(fullPath);
      }
    }
  } catch (error) {
    console.error('cleanOldBackupFiles error:', error);
  }
}

/**
 * レンダラー（画面側）からのファイル保存・取得要求を受信するIPC通信ハンドラー
 */
function setupIpcHandlers() {
  // 1. 自動バックアップJSONの直接書き出し
  ipcMain.handle('save-daily-backup-file', async (event, payload) => {
    try {
      if (!payload) {
        return { success: false, message: 'バックアップデータが空です。' };
      }

      // ★重要：dumpオブジェクト直渡し / { targetDate, data } 包み渡しの両方を自動吸収
      let targetDate = '';
      let dumpData = null;

      if (payload.data && typeof payload.data === 'object') {
        // パターンA: { targetDate: '...', data: dump } で渡された場合
        targetDate = payload.targetDate || formatLocalDate();
        dumpData = payload.data;
      } else {
        // パターンB: dump オブジェクトそのものが渡された場合 (exportView.js の呼び出し形式)
        targetDate = payload.targetDate || formatLocalDate();
        dumpData = payload;
      }

      const backupDir = getBackupDirectoryPath();
      const fileName = `reha_backup_${targetDate}.json`;
      const filePath = path.join(backupDir, fileName);

      // JSON文字列をインデント付きで整形してファイル書き出し
      const jsonStr = typeof dumpData === 'string' ? dumpData : JSON.stringify(dumpData, null, 2);
      fs.writeFileSync(filePath, jsonStr, 'utf8');

      // 14日を超過した過去ファイルを自動消去
      cleanOldBackupFiles(backupDir, 14);

      console.log(`[IPC] バックアップ書き出し成功: ${filePath}`);
      return {
        success: true,
        filePath,
        fileName,
        message: `「ドキュメント\\リハ業務管理_自動バックアップ」に保存しました。`
      };
    } catch (error) {
      console.error('save-daily-backup-file error:', error);
      return { success: false, message: error.message || 'ファイル書き出しに失敗しました。' };
    }
  });

  // 2. バックアップ保存フォルダをエクスプローラーで直接開く
  ipcMain.handle('open-backup-folder', async () => {
    try {
      const backupDir = getBackupDirectoryPath();
      await shell.openPath(backupDir);
      return { success: true };
    } catch (error) {
      console.error('open-backup-folder error:', error);
      return { success: false, message: error.message };
    }
  });

  // 3. バックアップフォルダのパス情報を取得する
  ipcMain.handle('get-backup-dir-path', async () => {
    return getBackupDirectoryPath();
  });
}


module.exports = {
  getBackupDirectoryPath,
  setupBackupIpc: setupIpcHandlers,
};
```

### 5.9 `preload.js`

```javascript
const { contextBridge, ipcRenderer } = require('electron');

// レンダラープロセス（画面側）に安全なデスクトップ専用情報およびファイルバックアップAPIを公開
contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',

  /**
   * 日次自動バックアップデータをPCの専用フォルダ（ドキュメント/リハ業務管理_自動バックアップ/）へ直接書き出す
   * @param {Object} dumpData バックアップJSONオブジェクト
   * @returns {Promise<{ success: boolean, filePath?: string, error?: string }>}
   */
  saveDailyBackup: (dumpData) => {
    return ipcRenderer.invoke('save-daily-backup-file', dumpData);
  },

  /**
   * 自動バックアップが保存されているフォルダをWindowsエクスプローラーで直接開く
   * @returns {Promise<boolean>}
   */
  openBackupFolder: () => {
    return ipcRenderer.invoke('open-backup-folder');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('リハビリ業務管理システム: デスクトップアプリケーションモードで起動しました（直接ファイル保存API有効）。');
});
```

---

## 6. 関連ドキュメント・補足

| ファイル | 用途 |
|----------|------|
| `docs/説明書.md` | 現場スタッフ向け操作説明（日本語・詳細） |
| `docs/CURRENT_STATUS.md` | 開発経緯メモ（**古い記述あり**。バックアップ二重系統の記述は本SNAPSHOTで上書き） |
| `docs/PROJECT_FULL_SNAPSHOT.md` | 本ファイル |

### Gemini向け推奨読み順

1. §0〜§3（全体像・データ型）  
2. §5.2 `rules.js` + §5.3 `timeSlotGenerator.js`（時間軸）  
3. §5.4 `storageAdapter.js` + §5.6 `backupService.js` + §5.7–5.9 Electron  
4. §5.5 `deadlineCalc.js`（点数）  
5. 必要に応じて `js/store/*` と `js/views/*` をリポジトリから追加読込

### 既知の意図的設計

- セラピスト日上限 `THERAPIST_DAILY_MAX: 24` は法令特例。施設コマ数が24以外でも上限定数は独立。  
- 予約吸着は実時間→最寄り `TIME_SLOTS.start`。メモに `[予約 HH:MM〜]` を残す実装。  
- `appointmentSlots.js` の `TIME_SLOTS` は **文字列配列**（`APPOINTMENT_TIME_STRINGS` 同一参照）。時間割のオブジェクト配列とは別物。

---

*End of PROJECT_FULL_SNAPSHOT*
