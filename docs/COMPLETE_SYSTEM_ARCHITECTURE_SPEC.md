# リハビリ業務管理システム（reha-work-manager）
# 完全網羅 システム設計図・アーキテクチャ仕様書

| 項目 | 内容 |
|------|------|
| **文書ID** | COMPLETE_SYSTEM_ARCHITECTURE_SPEC |
| **作成日** | 2026-10-23 |
| **対象リポジトリ** | `reha-work-manager` |
| **アプリバージョン** | `package.json` = **1.0.0**（説明書表記 1.1.0：施設可変時間枠・Electronバックアップ1本化・ドロップ即配置反映後） |
| **準拠法令定数** | 医科診療報酬・リハビリテーション料（**令和8年度改定**想定定数を `js/config/rules.js` に内蔵） |
| **読者** | 保守エンジニア／新規機能担当／引き継ぎ先AI |
| **優先順位** | 本仕様書 ＞ `docs/PROJECT_FULL_SNAPSHOT.md` ＞ `docs/説明書.md` ＞ `docs/CURRENT_STATUS.md`（後者は古い記述が混在し得る） |

---

## 目次

1. [第1章：システム全体像・動作環境・運用基盤](#第1章システム全体像動作環境運用基盤)
2. [第2章：時間軸マスター動的生成エンジン（SSOT）](#第2章時間軸マスター動的生成エンジンssot)
3. [第3章：診療報酬・制度計算・過誤請求防止エンジン](#第3章診療報酬制度計算過誤請求防止エンジン)
4. [第4章：全ディレクトリ・全ファイル完全網羅リファレンス](#第4章全ディレクトリ全ファイル完全網羅リファレンス)
5. [第5章：画面別UI/UX・インタラクション詳細仕様](#第5章画面別uiuxインタラクション詳細仕様)
6. [第6章：全データモデル・型定義・キー一覧](#第6章全データモデル型定義キー一覧)

---

## 第1章：システム全体像・動作環境・運用基盤

### 1.1 システム基本諸元

| 項目 | 内容 |
|------|------|
| アプリ名称（製品名） | リハビリ業務管理システム（`productName`）／内部名 `reha-work-manager` |
| npm name / version | `reha-work-manager` / `1.0.0` |
| appId | `com.reha.workmanager` |
| アーキテクチャ形態 | **Electron スタンドアロン**（Windows NSIS）＋ **ブラウザ ESM SPA**（GitHub Pages 静的ホスティング）の**二重実行環境** |
| UI | 単一 `index.html` ＋ ES Modules（`js/app.js` エントリ）＋ 分割CSS |
| 業務範囲 | 本日時間割、外来予約、月間単位・収益、患者台帳、物品貸出、Excel帳票、バックアップ／復元 |
| 非対応 | `file://` 直開き（Origin null で module が CORS 拒否）。必ず Electron `app://` または http(s) 静的サーバ |

### 1.2 3層ハイブリッド・データ永続化アーキテクチャ

#### 第1層：IndexedDB 正本 ＋ メモリ同期キャッシュ ＋ localStorage ミラー

| 要素 | 仕様 |
|------|------|
| DB名 | `reha_work_manager_db` |
| バージョン | `1` |
| ObjectStore | `app_key_value_store`（`keyPath: 'key'`、値は常に **文字列**） |
| 実装 | `js/core/storageAdapter.js` |
| 読取 | `storageGet(key)`：メモリ `Map` ヒットで **同期 0ms**。未ヒット時のみ localStorage フォールバック→メモリへ載せる |
| 書込 | `storageSet(key, value)`：メモリ即時 → IndexedDB 非同期 put → 容量許容時 localStorage ミラー |
| 移行 | 初回 `initStorage()` が `localStorage` の `reha_*` を IDB へマイグレーションし `__reha_storage_migrated_v1` を立てる |
| 書き込みラッパ | `js/store/storageWrite.js` の `writeStorageItem`（失敗時トースト、Store API の boolean 戻り値契約維持） |

#### 第2層：アクティブウィンドウ管理（アーカイブ）

| 要素 | 仕様 |
|------|------|
| 実装 | `js/store/archiveManager.js` |
| 窓 | **今日基準の前後3ヶ月**（`getActiveWindowBounds`）の `reha_schedule_YYYY-MM-DD` をメモリ常駐 |
| フィルタ登録 | 起動時 `registerArchiveHydrationFilter()` → `storageAdapter.setScheduleHydrationFilter` |
| オンデマンド | `loadMonthOnDemand(year, month)` / `loadYearOnDemand(year)` が IDB から該当キーを `storageHydrateKeys` |
| パージ | 窓外キーは `storagePurgeFromMemory`（IDB・索引は残す） |
| UI表示 | Excel出力画面の「データ保管状態」バッジ（`getArchiveStats`） |

#### 第3層：Electron ネイティブ日次自動バックアップ

| 要素 | 仕様 |
|------|------|
| IPC | `main/backupIpc.js`：チャネル `save-daily-backup-file` / `open-backup-folder` / `get-backup-dir-path` |
| Preload | `preload.js` → `window.desktopApp.saveDailyBackup` / `openBackupFolder` / `isDesktop` |
| 保存先 | OSドキュメント直下 `リハ業務管理_自動バックアップ/reha_backup_YYYY-MM-DD.json` |
| ローテ | 同フォルダ内 `reha_backup_*.json` および旧名 `reha_autobackup_*.json` を14世代超過で削除 |
| トリガ | `backupService.triggerDailyAutoBackup`（**3秒デバウンス**）／起動時・`beforeunload` の `performDailyAutoBackup` |
| ブラウザ | `desktopApp` 不在時は PC 自動保存を静かにスキップ（警告バーなし）。手動📦／復元は動作 |

#### 手動バックアップ層

| 操作 | 実装 |
|------|------|
| 📦 随時JSON保存 | `createSystemDump` → ダウンロード `reha_backup_YYYY-MM-DD.json` |
| 🏛 5/31年度確定 | `backupType: 'FISCAL_YEAR_FINAL'`、ファイル名 `reha_YYYY年度確定_5月31日改定締め.json` |
| 📥 完全復元 | `reha_*` 全削除後に dump.storage を `writeStorageItem`／`storageSet` で全書き込み → リロード |

### 1.3 起動・配信・セキュリティ・CI/CD

#### Electron 起動シーケンス（`main.js`）

1. `protocol.registerSchemesAsPrivileged` で `app` スキームを ready 前に特権登録（standard / secure / supportFetchAPI / corsEnabled / stream）
2. `app.requestSingleInstanceLock()` — 取得失敗で即 quit（**二重起動物理遮断**）
3. ready 後 `registerAppProtocol()`（`app://` → リポジトリ内ファイルのみ `net.fetch`、パストラバーサル拒否）
4. `setupBackupIpc()`
5. `BrowserWindow`：preload、`nodeIntegration: false`、`contextIsolation: true`、`sandbox: false`
6. `loadURL('app://localhost/index.html')`
7. 第2インスタンス起動時は既存窓を restore／focus

#### レンダラ起動シーケンス（`js/app.js` DOMContentLoaded）

1. `registerArchiveHydrationFilter()`
2. `initStorage()`
3. `initArchiveManager()`
4. `initLocalFileBackup()` ＋ `logBackupNetStatus()`（Electron状態ログのみ）
5. 各 View の `init*` → `initNavigationTabs` → `initRefreshButtons`
6. `setupAppointmentModalListeners`
7. `renderAllViews()`
8. `performDailyAutoBackup()`（非ブロッキング）
9. `window.triggerDailyBackup = triggerDailyAutoBackup`

#### CI/CD

| ワークフロー | ファイル | トリガ | 成果物 |
|--------------|----------|--------|--------|
| Deploy GitHub Pages | `.github/workflows/deploy-pages.yml` | `push` to `main` / `workflow_dispatch` | Pages 静的サイト（`.nojekyll` 付与、Jekyll無効） |
| Build Windows Portable App | `.github/workflows/build-exe.yml` | `push` | `dist/*.exe` artifact |

Pages 設定必須: Repository Settings → Pages → Source = **GitHub Actions**。

---

## 第2章：時間軸マスター動的生成エンジン（SSOT）

### 2.1 単一情報源アーキテクチャ

```
localStorage['reha_facility_hours']
        │
        ▼
js/core/timeSlotGenerator.js
  generateTimeSlots / generateAppointmentTimeStrings
        │
        ▼
js/config/rules.js
  FACILITY_HOURS（同一オブジェクト参照を維持してプロパティ更新）
  TIME_SLOTS[]                 ← オブジェクト配列（時間割・バリデータ・吸着）
  APPOINTMENT_TIME_STRINGS[]   ← 開始時刻文字列配列
        │
        ├── appointmentSlots.js が APPOINTMENT_TIME_STRINGS を TIME_SLOTS 名で再エクスポート（同一配列参照）
        └── staffModal → saveFacilityHours → reloadFacilityTimeSlots → 画面再描画
```

### 2.2 デフォルト施設時間とコマ生成数式

| 帯 | 既定 | 生成条件 |
|----|------|----------|
| 午前 | 09:00〜13:00 | `t = amStart; t+20 ≤ amEnd; t += 20` → `am_1` … |
| 昼休憩 | 13:00〜14:00 | スロット非生成（`amEnd ≤ pmStart` を許容） |
| 午後 | 14:00〜18:00 | 同様に `pm_1` … |
| 刻み | 20分 | 固定 |
| 既定合計 | 午前12＋午後12＝**24コマ** | |

各スロットオブジェクト必須フィールド: `id`, `label`, `start`, `end`, `startTime`, `endTime`, `period` (`'am'|'pm'`), `order`。

### 2.3 バリデーション（施設時間）

条件: `午前開始 < 午前終了 ≤ 午後開始 < 業務終了`、かつ午前・午後それぞれ最低20分（1コマ）。

### 2.4 インプレース更新（`reloadFacilityTimeSlots`）

1. `FACILITY_HOURS` の各キーを上書き（オブジェクト参照不変）
2. `TIME_SLOTS.length = 0` の後 `push` で新スロット投入
3. `APPOINTMENT_TIME_STRINGS` も同様
4. `AM_SLOT_COUNT` / `PM_SLOT_COUNT` / `TOTAL_SLOT_COUNT` を `let` live binding で再代入
5. 半日／終日プリセットの `data-duration` を `staffModal` 内同期関数が更新

これにより既存 `import { TIME_SLOTS }` 先は再 import 不要で即時反映する。

### 2.5 互換ブリッジ

`js/config/appointmentSlots.js` は `export const TIME_SLOTS = APPOINTMENT_TIME_STRINGS`（**文字列配列・同一参照**）。  
週間予約表・A4週間印刷はこちらを import。オブジェクト配列の `rules.TIME_SLOTS` と**名前は同じだが型が異なる**。

---

## 第3章：診療報酬・制度計算・過誤請求防止エンジン

### 3.1 初日算入・満了日・日割り点数

実装: `js/core/deadlineCalc.js`

| 概念 | 数式・規則 |
|------|------------|
| 初日算入 | 起算日当日＝第1日目。`getInclusiveDayCount = getDiffDays + 1` |
| 満了日 | 起算日 + (標準日数 − 1) 日。`addDays(onset, rule.days - 1)` |
| 期限超過 | 経過日数 `> rule.days` の翌日から（満了日当日は正規点数） |
| 日割り | `getDailyBasePoints(patient, sessionDateStr)` が**実施日ごと**に単価決定 |
| 減算対象 | `careInsuranceType` が `CARE` または `SUPPORT` のみ `maintPoints` |
| 医療のみ NONE | 期限超過後も **defaultPoints 満額維持**（減算しない） |
| 物療 ANALGESIA | 日数制限なし、個別リハ単位・収益集計から隔離 |

`REHA_RULES.LIMIT_DAYS`:

| diseaseType | 標準日数 | 正規点 | 維持期点 | 3分の1日数 |
|-------------|----------|--------|----------|------------|
| LOCOMOTIVE | 150 | 170 | 102 | 50 |
| CEREBROVASCULAR | 180 | 100 | 60 | 60 |
| DISUSE | 120 | 77 | 46 | 40 |
| ANALGESIA | 9999 | 35 | 35 | 9999 |

### 3.2 月13単位制限 ＆ ドロップ即配置ブレーキ

| 関数 | 役割 |
|------|------|
| `checkMonth13UnitsViolation` | 月次⚠️判定。`force13` は月合計、期限が月初前は月合計、当月中満了は**満了日翌日以降のみ**合算 |
| `isMonth13LimitActiveOnDate` | 実施日時点で制限対象か |
| `getSuggestedPlacementUnits` | 既定単位（`defaultUnits` 初期3）と残り枠 `13 - applicable` の min。残り0は `blocked` |
| `getPatientMonthDailyRehaUnitsMap` | 当月日別個別リハ単位マップ（消炎除外） |
| `timetable.js` の即配置 | 上記を適用しバリデーション後 `setScheduleSlot` |

新患（期限内）: `WITHIN_LIMIT` → ブレーキ非適用 → 誤⚠️なし。  
累計適用12・既定3: 自動1単位（5回目ブレーキ）。13到達後: 配置拒否。

### 3.3 早期加算（令和8年度）

`evaluateEarlyBonusPhase`：入院のみ。起算日初日算入。

| 経過日 | 点数 |
|--------|------|
| 1〜3日目 | 60 |
| 4〜14日目 | 25 |
| 15日目以降 | なし |

### 3.4 リハビリテーション総合計画評価料

| 区分 | 点数 |
|------|------|
| PLAN_1_FIRST | 300 |
| PLAN_1_FOLLOW | 240 |
| PLAN_2_FIRST | 240 |
| PLAN_2_FOLLOW | 196 |

月1回ガード: `findPatientMonthlyPlanDate` で当月既存算定日があればチェック不可／保存遮断。  
要介護の計画書2移行: 起算日から `oneThirdDays` を超えた翌日（`addDays(onset, oneThirdDays)`）。

### 3.5 その他バリデーション（`validator.js`）

| 関数 | 内容 |
|------|------|
| `validateTimeConflict` | 同一患者の同日時間帯重複（連続単位の占有スロット含む）。担当変更時は元スロット除外 |
| `validateDailyLimit` | 患者1日標準6／急性期特例9 |
| `validateMonthly13Limit` | 月13超過の厳格ブロック |
| `validateTherapistWorkload` | セラピスト1日特例上限24厳格遮断、週108警告 |

---

## 第4章：全ディレクトリ・全ファイル完全網羅リファレンス

### 4.0 実在ファイル名に関する注記（指示書表記との差分）

本リポジトリに**存在しない**名称と、実際の正本:

| 指示書上の名称 | 実在する正本 |
|----------------|--------------|
| `appointment/weeklyTable.js` | `js/views/appointment/weeklyTimetable.js` |
| `appointment/monthlyGrid.js` | `js/views/appointment/monthlyCalendar.js` |
| `appointment/appointmentPalette.js` | `js/views/appointment/palette.js` |
| `modals/patientModal.js` | 患者モーダル制御は **`js/views/patientView.js`** |
| `modals/revenueModal.js` | 収益内訳は **`js/views/monthly/revenueDashboard.js`** |
| `modals/loanModal.js` | 貸出登録は **`js/views/loanView.js`** |

追加で実在し指示書に明示が薄いが網羅対象のファイル: `js/views/monthly/monthlyState.js`、`js/app.js`。

以下、ディスク上の対象ファイルを1件ずつ記述する。

### 4.1 ルート階層

#### `package.json`

- **配置場所:** `package.json`
- **行数目安:** 43
- **役割・責務:** npm／electron-builder プロジェクト定義。エントリ main.js、スクリプト start／build:win、Windows NSIS 設定。
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** （export なし／CommonJS module.exports または HTML/CSS/設定）
- **主要ロジック・仕様:** devDependencies: electron ^33、electron-builder ^25。build.appId=com.reha.workmanager、output=dist。アプリ定数や画面ロジックは含まない。

#### `main.js`

- **配置場所:** `main.js`
- **行数目安:** 153
- **役割・責務:** Electron メインプロセス。app スキーム特権登録、二重起動ロック、BrowserWindow 生成、メニュー（バックアップフォルダ・リロード・DevTools）、backupIpc 接続。
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** （export なし／CommonJS module.exports または HTML/CSS/設定）
- **主要ロジック・仕様:** isInsideAppDirectory でプロトコルハンドラのパストラバーサルを拒否。second-instance で既存窓フォーカス。window-all-closed で非darwin終了。

#### `preload.js`

- **配置場所:** `preload.js`
- **行数目安:** 30
- **役割・責務:** contextBridge で window.desktopApp を公開。レンダラから Node 直接アクセスを禁止しつつ IPC のみ許可。
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** （export なし／CommonJS module.exports または HTML/CSS/設定）
- **主要ロジック・仕様:** API: isDesktop=true, platform, version, saveDailyBackup→save-daily-backup-file, openBackupFolder→open-backup-folder。

#### `index.html`

- **配置場所:** `index.html`
- **役割・責務:** SPA の唯一の HTML 骨格。ヘッダー、6タブ、全モーダル、トーストコンテナ、SheetJS 読込、`js/app.js` module エントリ。
- **CSSリンク（この順）:** `css/base.css`, `css/schedule.css`, `css/tables.css`, `css/modals.css`, `css/toast.css`, `css/appointment.css`, `css/style.css`
- **スクリプト:** `js/vendor/xlsx.bundle.js`（優先）＋ CDN フォールバック、末尾 `type="module" src="js/app.js"`
- **6タブパネルID:**
  1. `viewSchedule` — 本日時間割
  2. `viewAppointmentCalendar` — 外来予約カレンダー
  3. `viewMonthly` — 月間単位・収益
  4. `viewPatient` — 患者台帳
  5. `viewLoan` — 物品貸出
  6. `viewExport` — Excel出力・バックアップ
- **ヘッダー主要コントロール:** `btnRefreshHeader`, `btnOpenStaffSettings`, `.nav-tab[data-target]`
- **全モーダル（7種）:**
  1. `modalSlotEdit` — コマ配置（患者／業務）
  2. `modalPatientEdit` — 患者登録・編集
  3. `modalLoanRegister` — 物品貸出登録
  4. `modalAnalgesiaSlot` — 消炎鎮痛コマ編集
  5. `modalRevenueBreakdown` — 本日収益内訳
  6. `modalStaffSettings` — スタッフ・助手・施設時間
  7. `modalAppointmentEdit` — 外来予約登録・編集
- **トースト:** `#toastContainer.toast-container`

#### `.nojekyll`

- **配置場所:** `.nojekyll`（空ファイル）
- **役割・責務:** GitHub Pages 上で Jekyll 処理を無効化し、`js/` 配下や vendor バンドルが 404／変換されないことを保証する。
- **依存／export:** なし
- **主要ロジック・仕様:** ファイルが存在するだけでよい。`deploy-pages.yml` も成果物へ `touch` する。

### 4.2 `main/` フォルダ

#### `main/backupIpc.js`

- **配置場所:** `main/backupIpc.js`
- **行数目安:** 133
- **役割・責務:** メインプロセス側の日次バックアップ IPC。ドキュメント配下専用フォルダの作成・JSON書込・14日ローテ・エクスプローラ起動。
- **ファイル先頭コメント:** main/backupIpc.js ドキュメントフォルダへの日次バックアップ書き出し
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** （export なし／CommonJS module.exports または HTML/CSS/設定）
- **主要ロジック・仕様:** getBackupDirectoryPath；cleanOldBackupFiles（reha_backup_ と旧 reha_autobackup_）；ipcMain.handle 3種。module.exports: getBackupDirectoryPath, setupBackupIpc。

### 4.3 `css/` フォルダ

#### `css/style.css`

- **配置場所:** `css/style.css`
- **役割・責務:** CSSエントリ。全部分CSSを @import。業務・有休・公休カード、スロット種別タブ、パレットカテゴリ等の追加スタイル。
- **依存:** `style.css` から @import、または `index.html` から直接 link
- **公開API:** CSSクラス／変数（JS export なし）
- **主要ロジック・仕様:** card-task/leave/holiday、btn-task-preset、slot-type-tab、palette-cat-btn 等。

#### `css/base.css`

- **配置場所:** `css/base.css`
- **役割・責務:** デザイン変数・リセット・ヘッダー・タブ・パネル・共通レイアウトの基盤。
- **依存:** `style.css` から @import、または `index.html` から直接 link
- **公開API:** CSSクラス／変数（JS export なし）
- **主要ロジック・仕様:** CSS変数（色・半径・影）、.app-header、.nav-tab、.view-panel、タイポグラフィ。

#### `css/schedule.css`

- **配置場所:** `css/schedule.css`
- **役割・責務:** 本日時間割グリッド・セル高さ52px・カード絶対配置・クイック単位ボタン。
- **依存:** `style.css` から @import、または `index.html` から直接 link
- **公開API:** CSSクラス／変数（JS export なし）
- **主要ロジック・仕様:** .time-slot-row/.cell-slot 高さ52px；.reha-slot-card absolute；.card-unit-1..4；.slot-quick-units/.btn-quick-unit；消炎列バッジ。

#### `css/appointment.css`

- **配置場所:** `css/appointment.css`
- **役割・責務:** 外来予約カレンダー（週間グリッド・月間マス・モード切替ボタン）の見た目。
- **依存:** `style.css` から @import、または `index.html` から直接 link
- **公開API:** CSSクラス／変数（JS export なし）
- **主要ロジック・仕様:** 週間セル、予約チップ、月間マス、apt-view-mode-btn。

#### `css/tables.css`

- **配置場所:** `css/tables.css`
- **役割・責務:** 患者台帳・物品・月間単位表などテーブル系レイアウト。
- **依存:** `style.css` から @import、または `index.html` から直接 link
- **公開API:** CSSクラス／変数（JS export なし）
- **主要ロジック・仕様:** 表ヘッダ、行ホバー、警告セル等。

#### `css/modals.css`

- **配置場所:** `css/modals.css`
- **役割・責務:** 全モーダル共通オーバーレイ・カード・アクティブ表示。
- **依存:** `style.css` から @import、または `index.html` から直接 link
- **公開API:** CSSクラス／変数（JS export なし）
- **主要ロジック・仕様:** .modal-overlay / .modal-overlay.active / .modal-card。

#### `css/toast.css`

- **配置場所:** `css/toast.css`
- **役割・責務:** トースト通知コンテナと種別色。
- **依存:** `style.css` から @import、または `index.html` から直接 link
- **公開API:** CSSクラス／変数（JS export なし）
- **主要ロジック・仕様:** .toast-container、成功／警告／エラー／info。

### 4.4 `js/config/` フォルダ

#### `js/config/rules.js`

- **配置場所:** `js/config/rules.js`
- **行数目安:** 247
- **役割・責務:** 診療報酬定数・施設時間・TIME_SLOTS 正本・セラピスト初期定義・単位UI色。時間軸のメモリ更新入口。
- **ファイル先頭コメント:** js/config/rules.js 診療報酬改定定数マスター・時間枠定義・制約ルール設定 ★時間枠は timeSlotGenerator が単一情報源。手書き固定配列は置かない。 ★施設時間は localStorage('reha_facility_hours') → FACILITY_HOURS → TIME_SLOTS へ即時反映
- **依存（import 元）:** ../core/timeSlotGenerator.js
- **公開API（export）:** REHA_RULES, FACILITY_HOURS, TIME_SLOTS, APPOINTMENT_TIME_STRINGS, AM_SLOT_COUNT, PM_SLOT_COUNT, TOTAL_SLOT_COUNT, reloadFacilityTimeSlots, THERAPISTS, UNIT_CONFIG
- **主要ロジック・仕様:** REHA_RULES；FACILITY_HOURS；TIME_SLOTS；APPOINTMENT_TIME_STRINGS；AM/PM/TOTAL_SLOT_COUNT；reloadFacilityTimeSlots；THERAPISTS；UNIT_CONFIG。モジュール読込時に getSavedFacilityHours で初期化。

#### `js/config/appointmentSlots.js`

- **配置場所:** `js/config/appointmentSlots.js`
- **行数目安:** 14
- **役割・責務:** 外来予約・印刷用の開始時刻配列ブリッジ。独自手書き配列は廃止。
- **ファイル先頭コメント:** js/config/appointmentSlots.js 外来予約カレンダーの時間軸（本日時間割と同一の施設設定から生成） ★単一情報源: js/core/timeSlotGenerator.js → rules.js 経由で配給
- **依存（import 元）:** ./rules.js
- **公開API（export）:** TIME_SLOTS
- **主要ロジック・仕様:** export const TIME_SLOTS = APPOINTMENT_TIME_STRINGS（rules と同一参照）。週間表・weeklyTablePrint が import。

### 4.5 `js/core/` フォルダ

#### `js/core/storageAdapter.js`

- **配置場所:** `js/core/storageAdapter.js`
- **行数目安:** 501
- **役割・責務:** IndexedDB透過ストレージ＋メモリキャッシュ＋LSミラー＋アーカイブ連携API。
- **ファイル先頭コメント:** js/core/storageAdapter.js IndexedDB 透過的ストレージ層（メモリキャッシュ同期読み取り + IDB非同期永続化） フェーズ3: 過去月スケジュールの選択的ハイドレーション／メモリパージ連携
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** setScheduleHydrationFilter, initStorage, storageGet, storageSet, storageRemove, storagePurgeFromMemory, storagePurgeKeysFromMemory, storageHydrateKeys, storageKeys, storageMemoryKeys, storageMemoryHas, storageRemoveByPrefix, storageSnapshot, storageFullSnapshotAsync, isStorageReady, getStorageStats, SCHEDULE_PREFIX
- **主要ロジック・仕様:** initStorage；storageGet/Set/Remove；storagePurgeFromMemory；storageHydrateKeys；storageKeys；storageFullSnapshotAsync；setScheduleHydrationFilter；getStorageStats。SCHEDULE_PREFIX=reha_schedule_。

#### `js/core/timeSlotGenerator.js`

- **配置場所:** `js/core/timeSlotGenerator.js`
- **行数目安:** 277
- **役割・責務:** 施設時間から20分コマを数学生成するSSOT。永続化・バリデーション・サマリー。
- **ファイル先頭コメント:** js/core/timeSlotGenerator.js 施設診療時間から20分刻みスロットを動的生成する単一情報源（Single Source of Truth） デフォルト: 午前 09:00〜13:00（12コマ）／昼休憩／午後 14:00〜18:00（12コマ）＝計24コマ 画面設定の永続化キー: localStorage 'reha_facilit
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** FACILITY_HOURS_STORAGE_KEY, DEFAULT_FACILITY_HOURS, normalizeTimeString, timeToMinutes, minutesToTime, normalizeFacilityHours, validateFacilityHours, formatFacilityHoursSummary, getSavedFacilityHours, saveFacilityHours, generateTimeSlots, generateAppointmentTimeStrings, getAmSlotCount, getPmSlotCount, getTotalSlotCount, isAfternoonSlot
- **主要ロジック・仕様:** DEFAULT_FACILITY_HOURS；validateFacilityHours；getSaved/saveFacilityHours；generateTimeSlots；generateAppointmentTimeStrings；getAm/Pm/TotalSlotCount；isAfternoonSlot。キー reha_facility_hours。

#### `js/core/deadlineCalc.js`

- **配置場所:** `js/core/deadlineCalc.js`
- **行数目安:** 543
- **役割・責務:** 期限・日割り点数・早期加算・計画書推奨・月13判定・ドロップ推奨単位。DOM非依存。
- **ファイル先頭コメント:** js/core/deadlineCalc.js 期限・早期加算・要介護3分の1移行日計算・総合計画書自動判定エンジン DOMおよびStorageに一切依存しない純粋関数群として実装（200行制限準拠）
- **依存（import 元）:** ../config/rules.js, ./dataNormalizer.js
- **公開API（export）:** normalizeDate, formatDate, getDiffDays, getInclusiveDayCount, getOneThirdDays, addDays, evaluateEarlyBonusPhase, calculatePatientDeadlines, getDailyBasePoints, evaluateRecommendedPlan, checkMonth13UnitsViolation, getPatientDefaultUnits, isMonth13LimitActiveOnDate, getSuggestedPlacementUnits
- **主要ロジック・仕様:** calculatePatientDeadlines；getDailyBasePoints；evaluateEarlyBonusPhase；evaluateRecommendedPlan；checkMonth13UnitsViolation；getSuggestedPlacementUnits；getPatientDefaultUnits；isMonth13LimitActiveOnDate。

#### `js/core/validator.js`

- **配置場所:** `js/core/validator.js`
- **行数目安:** 201
- **役割・責務:** 配置時の多重ガード（重複・日上限・月13・計画書月1・セラピスト負荷）。
- **ファイル先頭コメント:** js/core/validator.js 13単位制限・1日上限・人員基準・重複予約・計画書月1回算定の多重バリデーションガード DOM・Storageに非依存の純粋検証ロジック（200行制限準拠・18単位警告撤廃・週108単位超過判定対応版）
- **依存（import 元）:** ../config/rules.js, ./deadlineCalc.js
- **公開API（export）:** getOccupiedSlotIds, validateTimeConflict, validateDailyLimit, validateMonthly13Limit, validateMonthlyPlanLimit, validateTherapistWorkload
- **主要ロジック・仕様:** getOccupiedSlotIds；validateTimeConflict；validateDailyLimit；validateMonthly13Limit；validateMonthlyPlanLimit；validateTherapistWorkload。

#### `js/core/dateUtils.js`

- **配置場所:** `js/core/dateUtils.js`
- **行数目安:** 32
- **役割・責務:** 画面共通のローカル日付文字列と週範囲。
- **ファイル先頭コメント:** js/core/dateUtils.js 画面共通の日付文字列・週範囲
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** formatDateYMD, getLocalDateStr, getWeekDates
- **主要ロジック・仕様:** formatDateYMD；getLocalDateStr；getWeekDates。

#### `js/core/dataNormalizer.js`

- **配置場所:** `js/core/dataNormalizer.js`
- **行数目安:** 129
- **役割・責務:** 文字列正規化・かな変換・患者ID・日付・XSSエスケープ・整数安全変換。
- **ファイル先頭コメント:** js/core/dataNormalizer.js 文字列・患者記号・日付・五十音インデックス等の正規化ユーティリティ 純粋関数群として実装し、DOMやStorageへの依存を排除
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** normalizeString, normalizeToKatakana, getGojuonGroup, normalizePatientId, normalizeDateString, sanitizeHtml, safeParseInt
- **主要ロジック・仕様:** normalizeString；normalizeToKatakana；getGojuonGroup；normalizePatientId；normalizeDateString；sanitizeHtml；safeParseInt。

#### `js/core/holidayCalc.js`

- **配置場所:** `js/core/holidayCalc.js`
- **行数目安:** 90
- **役割・責務:** 日本の祝日・振替・国民の休日のオフライン判定（外部APIなし）。
- **ファイル先頭コメント:** js/core/holidayCalc.js 日本の祝日・振替休日・国民の休日オフライン判定（画面から共通化）
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** getJapaneseHolidayName
- **主要ロジック・仕様:** getJapaneseHolidayName(date)。予約カレンダー・印刷で使用。

### 4.6 `js/backup/` フォルダ

#### `js/backup/backupService.js`

- **配置場所:** `js/backup/backupService.js`
- **行数目安:** 185
- **役割・責務:** 手動バックアップ／年度確定／復元／日次自動バックアップ統括。Electron IPC のみでPC保存。
- **ファイル先頭コメント:** js/backup/backupService.js 手動バックアップ・年度確定・復元・日次自動セーフティネット統括 ★PC自動保存は Electron ネイティブ（desktopApp.saveDailyBackup → ドキュメント\リハ業務管理_自動バックアップ）に1本化 ★ブラウザ向け File System Access API / reha_ba
- **依存（import 元）:** ../core/dateUtils.js, ../core/storageAdapter.js, ../store/storageWrite.js, ../ui/toast.js
- **公開API（export）:** createSystemDump, triggerDailyAutoBackup, performDailyAutoBackup, setupBackupAndRestoreListeners
- **主要ロジック・仕様:** createSystemDump；triggerDailyAutoBackup（3秒debounce）；performDailyAutoBackup；setupBackupAndRestoreListeners。

#### `js/backup/localFileBackup.js`

- **配置場所:** `js/backup/localFileBackup.js`
- **行数目安:** 89
- **役割・責務:** Electron専用ヘルパー。旧FSA／safety_net_dbは撤廃済み。
- **ファイル先頭コメント:** js/backup/localFileBackup.js Electron ネイティブ自動バックアップ専用ヘルパー ★ブラウザ向け File System Access API / reha_backup_safety_net_db は完全撤廃済み 正本の保存先: ドキュメント\リハ業務管理_自動バックアップ（main/backupIpc.js）
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** isElectronDesktop, getElectronBackupFolderLabel, getElectronBackupUiState, openElectronBackupFolder, initLocalFileBackup, logBackupNetStatus
- **主要ロジック・仕様:** isElectronDesktop；getElectronBackupFolderLabel；getElectronBackupUiState；openElectronBackupFolder；initLocalFileBackup；logBackupNetStatus。

### 4.7 `js/store/` フォルダ

#### `js/store/patientStore.js`

- **配置場所:** `js/store/patientStore.js`
- **行数目安:** 284
- **役割・責務:** 患者マスターCRUD・検索（かな／全半角）・計画書ステータス更新・defaultUnits。
- **ファイル先頭コメント:** js/store/patientStore.js 患者マスターCRUD・LocalStorage永続化・ステータス管理(継続/終了・退院)・計画書ステータス同期・消炎鎮痛制御層 ★検索: ひらがな⇄カタカナ・全角⇄半角英数の相互一致対応
- **依存（import 元）:** ../core/dataNormalizer.js, ../core/storageAdapter.js, ./storageWrite.js
- **公開API（export）:** PATIENT_STATUS, getAllPatients, getPatientById, saveAllPatients, upsertPatient, updatePatientPlanStatus, deletePatient, searchPatients
- **主要ロジック・仕様:** キー reha_patients_master。PATIENT_STATUS；searchPatients；upsertPatient；updatePatientPlanStatus。

#### `js/store/scheduleStore.js`

- **配置場所:** `js/store/scheduleStore.js`
- **行数目安:** 415
- **役割・責務:** 日別時間割CRUD・移動・消炎・月間集計・月13用日別マップ。
- **ファイル先頭コメント:** js/store/scheduleStore.js 時間割コマCRUD・コマ移動・消炎鎮痛CRUD・LocalStorage永続化・月間集計（消炎/疾患別自動完全分離対応・高速O(1)最適化版）
- **依存（import 元）:** ../config/rules.js, ../core/dataNormalizer.js, ../core/storageAdapter.js, ./storageWrite.js, ./patientStore.js, ../core/deadlineCalc.js
- **公開API（export）:** isNonPatientBlock, getSlotSpan, slotRangeOverlaps, listTherapistIdsFromSchedule, getDailySchedule, saveDailySchedule, setScheduleSlot, clearScheduleSlot, moveScheduleSlot, addAnalgesiaPatient, removeAnalgesiaPatient, getAnalgesiaSlotPatients, getDailyStats, findPatientMonthlyPlanDate, hasPatientPastPlan, aggregateFromAppSchedule, getPatientMonthDailyRehaUnitsMap
- **主要ロジック・仕様:** キー reha_schedule_YYYY-MM-DD。set/clear/moveScheduleSlot；analgesia CRUD；aggregateFromAppSchedule；getPatientMonthDailyRehaUnitsMap；slotRangeOverlaps。

#### `js/store/appointmentStore.js`

- **配置場所:** `js/store/appointmentStore.js`
- **行数目安:** 252
- **役割・責務:** 外来予約CRUD・同一患者時間重複遮断・終了時刻計算。
- **ファイル先頭コメント:** js/store/appointmentStore.js 外来予約管理 データストア層 自由実時間（非20分縛り）・同一時間帯重複（並行来院/消炎複数人/PT別並行）対応 ★同一患者の同日・重複時間帯二重予約物理遮断ガード・LocalStorage永続化
- **依存（import 元）:** ../core/storageAdapter.js, ./storageWrite.js
- **公開API（export）:** getAllAppointments, saveAllAppointments, getAppointmentsByDate, getAppointmentsByMonth, getPatientFutureAppointments, checkPatientAppointmentConflict, upsertAppointment, deleteAppointment, calculateEndTime
- **主要ロジック・仕様:** キー reha_outpatient_appointments。upsertAppointment；checkPatientAppointmentConflict；getAppointmentsByDate/Month。

#### `js/store/appointmentSync.js`

- **配置場所:** `js/store/appointmentSync.js`
- **行数目安:** 8
- **役割・責務:** 【非推奨・未使用】旧予約→時間割同期の残骸。インポート参照ゼロ。
- **ファイル先頭コメント:** js/store/appointmentSync.js 【非推奨・未使用】外来予約→時間割の反映は js/views/scheduleView.js の handleSyncAppointmentsToSchedule / findNearestTimeSlot / durationToUnits が正本。 本ファイルは過去の重複実装の残骸。インポート参照は
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** APPOINTMENT_SYNC_DEPRECATED
- **主要ロジック・仕様:** export APPOINTMENT_SYNC_DEPRECATED のみ。正本は scheduleView 内 handleSyncAppointmentsToSchedule。削除候補。

#### `js/store/therapistStore.js`

- **配置場所:** `js/store/therapistStore.js`
- **行数目安:** 225
- **役割・責務:** セラピストマスター（稼働／休職／退職）・増員ID採番・一括更新。
- **ファイル先頭コメント:** js/store/therapistStore.js セラピストマスター管理・LocalStorage永続化・ステータス管理（稼働中/休職/退職）・新規追加・増員対応（200行制限準拠）
- **依存（import 元）:** ../core/dataNormalizer.js, ../core/storageAdapter.js, ./storageWrite.js
- **公開API（export）:** THERAPIST_STATUS, getAllTherapists, getActiveTherapists, getTherapistById, saveAllTherapists, addTherapist, updateTherapistName, updateTherapistStatus, updateTherapistSettings, updateTherapistNames
- **主要ロジック・仕様:** キー reha_therapists_master。THERAPIST_STATUS；getActiveTherapists；addTherapist；updateTherapistSettings。

#### `js/store/assistantStore.js`

- **配置場所:** `js/store/assistantStore.js`
- **行数目安:** 45
- **役割・責務:** リハビリ助手1・2氏名の永続化（業務日誌出勤欄へ反映）。
- **ファイル先頭コメント:** js/store/assistantStore.js リハビリ助手1・2の氏名
- **依存（import 元）:** ../core/storageAdapter.js, ./storageWrite.js
- **公開API（export）:** getAssistantSettings, saveAssistantSettings
- **主要ロジック・仕様:** キー reha_assistant_settings。getAssistantSettings；saveAssistantSettings。

#### `js/store/loanStore.js`

- **配置場所:** `js/store/loanStore.js`
- **行数目安:** 190
- **役割・責務:** 物品・装具貸出CRUD・返却・フィルタ。
- **ファイル先頭コメント:** js/store/loanStore.js リハビリ物品・装具貸出CRUD・返却管理・LocalStorage永続化層
- **依存（import 元）:** ../core/dataNormalizer.js, ../core/storageAdapter.js, ./storageWrite.js
- **公開API（export）:** getAllLoans, saveAllLoans, registerLoan, markAsReturned, deleteLoan, filterLoans
- **主要ロジック・仕様:** キー reha_loans_master。registerLoan；markAsReturned；deleteLoan；filterLoans。

#### `js/store/archiveManager.js`

- **配置場所:** `js/store/archiveManager.js`
- **行数目安:** 230
- **役割・責務:** スケジュールのアクティブ窓フィルタ・オンデマンド読込・統計。
- **ファイル先頭コメント:** js/store/archiveManager.js 過去月スケジュールのアクティブウィンドウ常駐 + オンデマンドハイドレーション IndexedDB 正本は維持し、メモリのみスリム化（同期 getDailySchedule は破壊しない）
- **依存（import 元）:** ../core/dateUtils.js, ../core/storageAdapter.js
- **公開API（export）:** addMonths, getActiveWindowBounds, isDateStrInActiveWindow, isScheduleKeyInActiveWindow, registerArchiveHydrationFilter, listScheduleKeysForMonth, loadMonthOnDemand, loadYearOnDemand, initArchiveManager, getArchiveStats
- **主要ロジック・仕様:** registerArchiveHydrationFilter；loadMonthOnDemand；loadYearOnDemand；initArchiveManager；getArchiveStats。

#### `js/store/storageWrite.js`

- **配置場所:** `js/store/storageWrite.js`
- **行数目安:** 48
- **役割・責務:** Store向け書き込みラッパ。失敗時のみトースト。
- **ファイル先頭コメント:** js/store/storageWrite.js 透過的ストレージ書き込み（メモリ + IndexedDB + localStorage ミラー） 失敗時のみトースト通知。Store API の同期戻り値契約は維持。
- **依存（import 元）:** ../core/storageAdapter.js, ../ui/toast.js
- **公開API（export）:** writeStorageItem
- **主要ロジック・仕様:** writeStorageItem(key,value)→storageSet。

### 4.8 `js/views/` フォルダおよびサブフォルダ

#### `js/views/scheduleView.js`

- **配置場所:** `js/views/scheduleView.js`
- **行数目安:** 274
- **役割・責務:** 本日時間割の初期化・再描画・外来予約一括反映（吸着・スキップ保護）。
- **ファイル先頭コメント:** js/views/scheduleView.js 当日時間割の初期化と再描画、外来予約の自動吸着・一括反映
- **依存（import 元）:** ../config/rules.js, ../core/dateUtils.js, ../ui/toast.js, ../store/appointmentStore.js, ../store/therapistStore.js, ../store/patientStore.js, ../store/scheduleStore.js, ./modals/slotModal.js, ./modals/staffModal.js, ./modals/analgesiaModal.js, ./schedule/scheduleState.js, ./schedule/palette.js, ./schedule/kpiStrip.js, ./schedule/timetable.js
- **公開API（export）:** findNearestTimeSlot, durationToUnits, initScheduleView, renderScheduleView
- **主要ロジック・仕様:** findNearestTimeSlot；durationToUnits；handleSyncAppointmentsToSchedule；initScheduleView；renderScheduleView。

#### `js/views/schedule/timetable.js`

- **配置場所:** `js/views/schedule/timetable.js`
- **行数目安:** 501
- **役割・責務:** 時間割グリッド描画・DnD・ドロップ即配置・クイック単位。
- **ファイル先頭コメント:** js/views/schedule/timetable.js 当日時間割グリッドとドラッグ＆ドロップ ★パレットからのドロップ即配置・月13単位スマートブレーキ・カード内クイック単位ボタン
- **依存（import 元）:** ../../config/rules.js, ../../core/dataNormalizer.js, ../../store/therapistStore.js, ../../store/patientStore.js, ../../store/scheduleStore.js, ../../core/deadlineCalc.js, ../../core/validator.js, ../../ui/toast.js, ../modals/slotModal.js, ../modals/analgesiaModal.js, ./scheduleState.js, ../scheduleView.js
- **公開API（export）:** buildSlotCardHtml, renderTimetableGrid
- **主要ロジック・仕様:** renderTimetableGrid；buildSlotCardHtml（高さ (52*u)-5）；placePatientInstant；changeSlotUnitsQuick；MOVE_SLOT／NEW_PATIENT／消炎ドロップ。

#### `js/views/schedule/palette.js`

- **配置場所:** `js/views/schedule/palette.js`
- **行数目安:** 121
- **役割・責務:** 本日時間割左パレット。検索デバウンス120ms・ソート・DnDソース。
- **ファイル先頭コメント:** js/views/schedule/palette.js 当日時間割の患者パレット ★検索入力は軽量デバウンス（患者数増加時のカクつき防止）。実検索は patientStore.searchPatients（かな・全半角相互一致）
- **依存（import 元）:** ../../config/rules.js, ../../core/dataNormalizer.js, ../../store/patientStore.js, ./scheduleState.js
- **公開API（export）:** setupSchedulePaletteEvents, sortPalettePatients, renderPatientPalette
- **主要ロジック・仕様:** setupSchedulePaletteEvents；renderPatientPalette；sortPalettePatients。

#### `js/views/schedule/kpiStrip.js`

- **配置場所:** `js/views/schedule/kpiStrip.js`
- **行数目安:** 19
- **役割・責務:** 当日KPIストリップ（延べ単位・患者数等）。
- **ファイル先頭コメント:** js/views/schedule/kpiStrip.js 当日時間割の件数ストリップ
- **依存（import 元）:** ../../store/scheduleStore.js, ./scheduleState.js
- **公開API（export）:** renderDailyKPIStrip
- **主要ロジック・仕様:** renderDailyKPIStrip ← getDailyStats。

#### `js/views/schedule/scheduleState.js`

- **配置場所:** `js/views/schedule/scheduleState.js`
- **行数目安:** 11
- **役割・責務:** 本日時間割の画面状態オブジェクト。
- **ファイル先頭コメント:** js/views/schedule/scheduleState.js 当日時間割画面の表示日と患者パレットの絞り込み
- **依存（import 元）:** ../../core/dateUtils.js
- **公開API（export）:** scheduleState
- **主要ロジック・仕様:** scheduleState: dateStr, paletteCategory, paletteSortKey。

#### `js/views/appointmentCalendarView.js`

- **配置場所:** `js/views/appointmentCalendarView.js`
- **行数目安:** 141
- **役割・責務:** 外来予約カレンダーの初期化・週/月切替・印刷ボタン結線。
- **ファイル先頭コメント:** js/views/appointmentCalendarView.js 外来予約カレンダーの初期化・週/月の切り替え
- **依存（import 元）:** ../core/holidayCalc.js, ../core/dateUtils.js, ./modals/appointmentModal.js, ../ui/toast.js, ../print/weeklyTablePrint.js, ../print/dailyChecklistPrint.js, ./appointment/calendarState.js, ./appointment/palette.js, ./appointment/weeklyTimetable.js, ./appointment/monthlyCalendar.js
- **公開API（export）:** initAppointmentCalendarView, syncDateInput, switchViewMode, renderAppointmentCalendarView
- **主要ロジック・仕様:** initAppointmentCalendarView；switchViewMode；renderAppointmentCalendarView；syncDateInput。

#### `js/views/appointment/weeklyTimetable.js`

- **配置場所:** `js/views/appointment/weeklyTimetable.js`
- **行数目安:** 302
- **役割・責務:** 外来予約の週間タイムテーブル描画・空きクリック新規・カード操作。
- **ファイル先頭コメント:** js/views/appointment/weeklyTimetable.js 外来予約の週間タイムテーブル
- **依存（import 元）:** ../../core/dataNormalizer.js, ../../core/holidayCalc.js, ../../core/dateUtils.js, ../../config/appointmentSlots.js, ../../store/patientStore.js, ../../store/therapistStore.js, ../../store/appointmentStore.js, ../modals/appointmentModal.js, ../../ui/toast.js, ./calendarState.js, ../appointmentCalendarView.js
- **公開API（export）:** renderWeeklyTimetable
- **主要ロジック・仕様:** renderWeeklyTimetable。時間軸は appointmentSlots.TIME_SLOTS（文字列）。複数予約同枠表示。

#### `js/views/appointment/monthlyCalendar.js`

- **配置場所:** `js/views/appointment/monthlyCalendar.js`
- **行数目安:** 176
- **役割・責務:** 外来予約の月間マス目。ダブルクリックで週間へジャンプ。
- **ファイル先頭コメント:** js/views/appointment/monthlyCalendar.js 外来予約の月間カレンダー
- **依存（import 元）:** ../../core/dataNormalizer.js, ../../core/holidayCalc.js, ../../core/dateUtils.js, ../../store/patientStore.js, ../../store/therapistStore.js, ../../store/appointmentStore.js, ../modals/appointmentModal.js, ../../ui/toast.js, ./calendarState.js, ../appointmentCalendarView.js
- **公開API（export）:** renderMonthlyCalendar
- **主要ロジック・仕様:** renderMonthlyCalendar。祝日名・件数表示。

#### `js/views/appointment/palette.js`

- **配置場所:** `js/views/appointment/palette.js`
- **行数目安:** 134
- **役割・責務:** 外来予約用患者パレット。
- **ファイル先頭コメント:** js/views/appointment/palette.js 外来予約カレンダーの患者パレット
- **依存（import 元）:** ../../core/dataNormalizer.js, ../../store/patientStore.js, ./calendarState.js
- **公開API（export）:** setupAptPaletteEvents, renderAptPalette
- **主要ロジック・仕様:** setupAptPaletteEvents；renderAptPalette。

#### `js/views/appointment/calendarState.js`

- **配置場所:** `js/views/appointment/calendarState.js`
- **行数目安:** 11
- **役割・責務:** 外来予約カレンダー状態。
- **ファイル先頭コメント:** js/views/appointment/calendarState.js 外来予約カレンダーの表示日・表示モード・ドラッグ中データ
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** calendarState
- **主要ロジック・仕様:** calendarState: baseDate, viewMode(week|month) 等。

#### `js/views/monthlyView.js`

- **配置場所:** `js/views/monthlyView.js`
- **行数目安:** 80
- **役割・責務:** 月間単位・収益の初期化と再描画（過去月は hydrate 後集計）。
- **ファイル先頭コメント:** js/views/monthlyView.js 月間単位・収益画面の初期化と再描画（過去月はオンデマンドハイドレーション後に集計）
- **依存（import 元）:** ../core/dataNormalizer.js, ../store/scheduleStore.js, ../store/archiveManager.js, ./monthly/monthlyState.js, ./monthly/revenueDashboard.js, ./monthly/unitsTable.js, ./monthly/diaryPreview.js
- **公開API（export）:** initMonthlyView, renderMonthlyView
- **主要ロジック・仕様:** initMonthlyView；renderMonthlyView。

#### `js/views/monthly/unitsTable.js`

- **配置場所:** `js/views/monthly/unitsTable.js`
- **行数目安:** 159
- **役割・責務:** 日別単位マトリクス・月13⚠️・早期加算サブ行。
- **ファイル先頭コメント:** js/views/monthly/unitsTable.js 月間単位表
- **依存（import 元）:** ../../config/rules.js, ../../core/dataNormalizer.js, ../../core/deadlineCalc.js, ./monthlyState.js
- **公開API（export）:** renderMonthlyUnitsTable
- **主要ロジック・仕様:** renderMonthlyUnitsTable。

#### `js/views/monthly/revenueDashboard.js`

- **配置場所:** `js/views/monthly/revenueDashboard.js`
- **行数目安:** 201
- **役割・責務:** 本日／当月収益KPIと内訳モーダル制御（revenueModal 相当）。
- **ファイル先頭コメント:** js/views/monthly/revenueDashboard.js 月間収益の数値と本日内訳モーダル
- **依存（import 元）:** ../../config/rules.js, ../../core/deadlineCalc.js, ../../core/dateUtils.js, ./monthlyState.js
- **公開API（export）:** renderRevenueDashboard, setupRevenueBreakdownModalListeners, openRevenueBreakdownModal
- **主要ロジック・仕様:** renderRevenueDashboard；openRevenueBreakdownModal；setupRevenueBreakdownModalListeners。

#### `js/views/monthly/diaryPreview.js`

- **配置場所:** `js/views/monthly/diaryPreview.js`
- **行数目安:** 44
- **役割・責務:** 月間画面内の業務日誌プレビュー断片。
- **ファイル先頭コメント:** js/views/monthly/diaryPreview.js 月間画面の業務日誌プレビュー
- **依存（import 元）:** ./monthlyState.js
- **公開API（export）:** renderDailyDiaryPreview
- **主要ロジック・仕様:** renderDailyDiaryPreview。

#### `js/views/monthly/monthlyState.js`

- **配置場所:** `js/views/monthly/monthlyState.js`
- **行数目安:** 12
- **役割・責務:** 月間画面の対象年月・ソート・直近集計キャッシュ。
- **ファイル先頭コメント:** js/views/monthly/monthlyState.js 月間画面の対象年月・並び順・直近の集計結果
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** monthlyState
- **主要ロジック・仕様:** monthlyState: year, month, sortKey, lastAggregated。

#### `js/views/patientView.js`

- **配置場所:** `js/views/patientView.js`
- **行数目安:** 345
- **役割・責務:** 患者台帳テーブル・ソート・フィルタ・患者モーダル制御（patientModal.js 相当を内包）。
- **ファイル先頭コメント:** js/views/patientView.js VIEW 3: 患者台帳・算定期限管理・計画書2行表示・通院中/終了ステータス管理・患者登録編集モーダル制御層（200行制限準拠）
- **依存（import 元）:** ../core/dataNormalizer.js, ../core/deadlineCalc.js, ../store/patientStore.js, ../ui/toast.js
- **公開API（export）:** initPatientView, renderPatientView
- **主要ロジック・仕様:** initPatientView；renderPatientView；openPatientModal（defaultUnits／force13 含む）。

#### `js/views/loanView.js`

- **配置場所:** `js/views/loanView.js`
- **行数目安:** 200
- **役割・責務:** 物品貸出一覧・返却・登録モーダル（loanModal 相当を内包）。
- **ファイル先頭コメント:** js/views/loanView.js VIEW 4: リハビリ物品・装具貸出テーブル・返却・登録モーダル制御層（200行制限準拠）
- **依存（import 元）:** ../core/dataNormalizer.js, ../store/loanStore.js, ../store/patientStore.js, ../ui/toast.js
- **公開API（export）:** initLoanView, renderLoanView, openLoanRegisterModal
- **主要ロジック・仕様:** initLoanView；renderLoanView；openLoanRegisterModal。

#### `js/views/exportView.js`

- **配置場所:** `js/views/exportView.js`
- **行数目安:** 170
- **役割・責務:** Excel出力UI・アーカイブバッジ・Electronバックアップフォルダ表示／オープン。
- **ファイル先頭コメント:** js/views/exportView.js VIEW 5: Excel原本出力・バックアップ＆復元・Electron PC自動保存状態・アーカイブ状態表示
- **依存（import 元）:** ../store/scheduleStore.js, ../store/archiveManager.js, ../core/dataNormalizer.js, ../ui/toast.js, ../backup/backupService.js, ../backup/localFileBackup.js, ../excel/uketsukeWriter.js, ../excel/diaryWriter.js
- **公開API（export）:** initExportView, refreshBackupFolderStatusUi, refreshArchiveStatusUi
- **主要ロジック・仕様:** initExportView；refreshBackupFolderStatusUi；refreshArchiveStatusUi。

#### `js/views/modals/slotModal.js`

- **配置場所:** `js/views/modals/slotModal.js`
- **行数目安:** 626
- **役割・責務:** コマ配置モーダル。患者検索デバウンス・Enter確定・単位・計画書・業務ブロック・バリデーション保存。
- **ファイル先頭コメント:** js/views/modals/slotModal.js コマ配置モーダル制御層（患者リアルタイム検索・単位数選択・計画書チェックボックス連動・各種制約バリデーション・保存解除・日次自動バックアップ連携） ★検索デバウンス・先頭候補自動選択・Enterキー即確定対応
- **依存（import 元）:** ../../config/rules.js, ../../core/dataNormalizer.js, ../../store/therapistStore.js, ../../store/patientStore.js, ../../store/scheduleStore.js, ../../core/deadlineCalc.js, ../../core/validator.js, ../../core/dateUtils.js, ../../ui/toast.js
- **公開API（export）:** setupSlotModalListeners, openSlotModal
- **主要ロジック・仕様:** setupSlotModalListeners；openSlotModal；新規時 getSuggestedPlacementUnits で単位初期値。

#### `js/views/modals/staffModal.js`

- **配置場所:** `js/views/modals/staffModal.js`
- **行数目安:** 352
- **役割・責務:** スタッフ設定モーダル。セラピストCRUD・助手・施設時間・休暇プリセット同期。
- **ファイル先頭コメント:** js/views/modals/staffModal.js セラピストマスター設定モーダル制御層 （スタッフ検索・追加・名称変更・休職退職管理・初期復帰 ＋ リハビリ助手1・2設定 ＋ 施設リハビリ提供時間設定・自動保存）
- **依存（import 元）:** ../../core/dataNormalizer.js, ../../store/therapistStore.js, ../../ui/toast.js, ../../store/assistantStore.js, ../../core/timeSlotGenerator.js, ../../config/rules.js, ../appointmentCalendarView.js
- **公開API（export）:** setupStaffSettingsModalListeners, renderStaffSettingsFields
- **主要ロジック・仕様:** setupStaffSettingsModalListeners；saveFacilityHours→reloadFacilityTimeSlots→再描画。

#### `js/views/modals/appointmentModal.js`

- **配置場所:** `js/views/modals/appointmentModal.js`
- **行数目安:** 314
- **役割・責務:** 外来予約登録編集。自由時間・所要・重複チェック・予約票印刷オプション。
- **ファイル先頭コメント:** js/views/modals/appointmentModal.js 外来予約登録・編集モーダル制御層 祝日判定は js/core/holidayCalc.js、予約票印刷は js/print/appointmentTicketPrint.js
- **依存（import 元）:** ../../core/dataNormalizer.js, ../../store/patientStore.js, ../../store/therapistStore.js, ../../store/appointmentStore.js, ../../ui/toast.js, ../../core/holidayCalc.js, ../../print/appointmentTicketPrint.js
- **公開API（export）:** setupAppointmentModalListeners, openAppointmentModal
- **主要ロジック・仕様:** setupAppointmentModalListeners；openAppointmentModal。

#### `js/views/modals/analgesiaModal.js`

- **配置場所:** `js/views/modals/analgesiaModal.js`
- **行数目安:** 108
- **役割・責務:** 消炎鎮痛コマの来院患者追加・解除。
- **ファイル先頭コメント:** js/views/modals/analgesiaModal.js 消炎鎮痛（物療）来院モーダル制御層（コマ別来院一覧・患者追加・解除）
- **依存（import 元）:** ../../config/rules.js, ../../core/dataNormalizer.js, ../../store/patientStore.js, ../../store/scheduleStore.js, ../../core/dateUtils.js, ../../ui/toast.js
- **公開API（export）:** setupAnalgesiaModalListeners, openAnalgesiaModal
- **主要ロジック・仕様:** setupAnalgesiaModalListeners；openAnalgesiaModal。

### 4.9 `js/excel/` フォルダ

#### `js/excel/uketsukeWriter.js`

- **配置場所:** `js/excel/uketsukeWriter.js`
- **行数目安:** 64
- **役割・責務:** 受付提出用ワークブック組み立て（サマリー・年間・疾患別・消炎）。
- **ファイル先頭コメント:** js/excel/uketsukeWriter.js 受付提出用Excelのシート組み立て
- **依存（import 元）:** ./sheetUtils.js, ./sheets/summarySheet.js, ./sheets/yearlyTrendSheet.js, ./sheets/rehaPatientSheet.js, ./sheets/analgesiaSheet.js
- **公開API（export）:** generateUketsukeWorkbook
- **主要ロジック・仕様:** generateUketsukeWorkbook(aggregated)。

#### `js/excel/diaryWriter.js`

- **配置場所:** `js/excel/diaryWriter.js`
- **行数目安:** 448
- **役割・責務:** 業務日誌Excel。日別シート、出欠、助手名、収益、公休スマート記録。
- **ファイル先頭コメント:** js/excel/diaryWriter.js 業務日誌Excel生成層（原本R8.6準拠 / 検印欄 / 動的スタッフ名・リハ助手名完全反映 / 当日までの累積シート生成 / 外来0名・公休スマート自動記録 / 右側テーブル本日収益金額¥完全連携 / A4横用紙完全均整・堂々美麗レイアウト版）
- **依存（import 元）:** ../config/rules.js, ../core/timeSlotGenerator.js, ../core/deadlineCalc.js, ../store/scheduleStore.js, ../store/patientStore.js, ../store/therapistStore.js, ../store/assistantStore.js
- **公開API（export）:** detectDiaryLeaveType, generateDiaryWorkbook
- **主要ロジック・仕様:** generateDiaryWorkbook；detectDiaryLeaveType；isAfternoonSlot で午前／午後判定。

#### `js/excel/sheetUtils.js`

- **配置場所:** `js/excel/sheetUtils.js`
- **行数目安:** 145
- **役割・責務:** SheetJS共通スタイル・罫線・A4横印刷設定・列幅・セル書込。
- **ファイル先頭コメント:** js/excel/sheetUtils.js 受付提出用Excelの共通スタイルとセル操作
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** SUMMARY_SHEET, YEARLY_TREND_SHEET, ANALGESIA_SHEET, STYLES, thinBorder, getDiseaseInitial, getEarlyBaseDate, applyA4LandscapePrintSetup, setStyledCell, setSheetCols, updateSheetRange, appendOrReplaceSheet
- **主要ロジック・仕様:** STYLES；setStyledCell；setSheetCols；applyA4LandscapePrintSetup；appendOrReplaceSheet。

#### `js/excel/sheets/analgesiaSheet.js`

- **配置場所:** `js/excel/sheets/analgesiaSheet.js`
- **行数目安:** 134
- **役割・責務:** 消炎鎮痛実施リスト（A4横1枚収容の列幅設計）。
- **ファイル先頭コメント:** js/excel/sheets/analgesiaSheet.js 消炎鎮痛の実施リスト（A4横1枚幅。ID・氏名・区分・1〜31日・回数）
- **依存（import 元）:** ../sheetUtils.js
- **公開API（export）:** writeAnalgesiaDedicatedSheet
- **主要ロジック・仕様:** writeAnalgesiaDedicatedSheet。列: ID・氏名・区分・1–31日・回数。

#### `js/excel/sheets/rehaPatientSheet.js`

- **配置場所:** `js/excel/sheets/rehaPatientSheet.js`
- **行数目安:** 179
- **役割・責務:** 入院／外来の疾患別リハ実施リスト。
- **ファイル先頭コメント:** js/excel/sheets/rehaPatientSheet.js 入院・外来の疾患別実施リスト
- **依存（import 元）:** ../../config/rules.js, ../../core/deadlineCalc.js, ../../store/scheduleStore.js, ../sheetUtils.js
- **公開API（export）:** writeRehaPatientSheet
- **主要ロジック・仕様:** writeRehaPatientSheet。日割り点数・早期加算を反映。

#### `js/excel/sheets/summarySheet.js`

- **配置場所:** `js/excel/sheets/summarySheet.js`
- **行数目安:** 184
- **役割・責務:** レセプト収益サマリーシート。
- **ファイル先頭コメント:** js/excel/sheets/summarySheet.js レセプト収益サマリー
- **依存（import 元）:** ../../config/rules.js, ../../core/deadlineCalc.js, ../sheetUtils.js
- **公開API（export）:** writeExecutiveSummarySheet
- **主要ロジック・仕様:** writeExecutiveSummarySheet。

#### `js/excel/sheets/yearlyTrendSheet.js`

- **配置場所:** `js/excel/sheets/yearlyTrendSheet.js`
- **行数目安:** 196
- **役割・責務:** 年間推移シート。
- **ファイル先頭コメント:** js/excel/sheets/yearlyTrendSheet.js 年間推移
- **依存（import 元）:** ../../config/rules.js, ../../core/deadlineCalc.js, ../../store/scheduleStore.js, ../sheetUtils.js
- **公開API（export）:** writeYearlyTrendSheet
- **主要ロジック・仕様:** writeYearlyTrendSheet。

### 4.10 `js/print/` フォルダ

#### `js/print/weeklyTablePrint.js`

- **配置場所:** `js/print/weeklyTablePrint.js`
- **行数目安:** 263
- **役割・責務:** A4横1枚・外来リハビリ週間予約表印刷。
- **ファイル先頭コメント:** js/print/weeklyTablePrint.js A4横1枚 外来リハビリ週間予約表の印刷
- **依存（import 元）:** ../core/dateUtils.js, ../config/appointmentSlots.js, ../core/dataNormalizer.js, ../core/holidayCalc.js, ../store/patientStore.js, ../store/therapistStore.js, ../store/appointmentStore.js, ../ui/toast.js
- **公開API（export）:** printWeeklyAppointmentTable
- **主要ロジック・仕様:** printWeeklyAppointmentTable。

#### `js/print/dailyChecklistPrint.js`

- **配置場所:** `js/print/dailyChecklistPrint.js`
- **行数目安:** 192
- **役割・責務:** A4縦1枚・本日デイリー予約チェック表（バインダー用・手書き枠）。
- **ファイル先頭コメント:** js/print/dailyChecklistPrint.js A4縦1枚 本日デイリー予約チェック表の印刷
- **依存（import 元）:** ../core/dateUtils.js, ../core/dataNormalizer.js, ../core/holidayCalc.js, ../store/patientStore.js, ../store/therapistStore.js, ../store/appointmentStore.js, ../ui/toast.js
- **公開API（export）:** printDailyAppointmentChecklist
- **主要ロジック・仕様:** printDailyAppointmentChecklist。

#### `js/print/appointmentTicketPrint.js`

- **配置場所:** `js/print/appointmentTicketPrint.js`
- **行数目安:** 79
- **役割・責務:** A5横・患者用次回予約票の即時印刷。
- **ファイル先頭コメント:** js/print/appointmentTicketPrint.js A5 次回予約票の即時印刷
- **依存（import 元）:** ../core/dataNormalizer.js, ../store/patientStore.js, ../store/therapistStore.js, ../store/appointmentStore.js, ../ui/toast.js
- **公開API（export）:** printAppointmentTicket
- **主要ロジック・仕様:** printAppointmentTicket(appointment)。

### 4.11 `js/ui/` フォルダ

#### `js/ui/toast.js`

- **配置場所:** `js/ui/toast.js`
- **行数目安:** 25
- **役割・責務:** 画面共通トースト通知。
- **ファイル先頭コメント:** js/ui/toast.js 画面共通のトースト通知
- **依存（import 元）:** （外部 ES import なし）
- **公開API（export）:** showToast
- **主要ロジック・仕様:** showToast(message, type) type: success|warn|error|info。

### 4.12 `js/vendor/` フォルダ

#### `js/vendor/xlsx.bundle.js`

- **配置場所:** `js/vendor/xlsx.bundle.js`
- **役割・責務:** SheetJS（xlsx-js-style 系）の**ローカル内包バンドル**。院内LAN遮断でも Excel 出力を保証する。
- **読込:** `index.html` が先に script タグで読込。未定義時のみ jsDelivr CDN フォールバック。
- **公開API:** グローバル `window.XLSX`
- **主要ロジック・仕様:** サードパーティ縮小コード（アプリ独自ロジックなし）。サイズ目安約 416KB。

### 4.13 `js/app.js`（レンダラエントリ）

#### `js/app.js`

- **配置場所:** `js/app.js`
- **行数目安:** 137
- **役割・責務:** レンダラ全体の起動司令塔。ストレージ→アーカイブ→各View→全日次バックアップ。
- **ファイル先頭コメント:** js/app.js 全体初期化・タブ切替自動再同期・ヘッダー＆時間割更新ボタン連動・全体再描画司令塔 ★起動: IndexedDB透過ストレージ（アクティブ窓のみメモリ）→ アーカイブ → Electron自動バックアップ確認 → 各画面
- **依存（import 元）:** ./core/storageAdapter.js, ./store/archiveManager.js, ./backup/localFileBackup.js, ./backup/backupService.js, ./views/scheduleView.js, ./views/appointmentCalendarView.js, ./views/monthlyView.js, ./views/patientView.js, ./views/loanView.js, ./views/exportView.js, ./ui/toast.js, ./views/modals/appointmentModal.js
- **公開API（export）:** renderAllViews
- **主要ロジック・仕様:** renderAllViews；タブ切替で再描画；ヘッダー更新ボタン；window.triggerDailyBackup 公開。

### 4.14 `.github/workflows/` フォルダ

#### `.github/workflows/deploy-pages.yml`

- **配置場所:** `.github/workflows/deploy-pages.yml`
- **役割・責務:** main への push／手動実行で GitHub Pages へ静的デプロイ。
- **permissions:** contents: read, pages: write, id-token: write
- **使用Actions:** actions/checkout@v4, actions/configure-pages@v5, actions/upload-pages-artifact@v3, actions/deploy-pages@v4
- **主要ロジック・仕様:** rsync で `.git` / `.github` / `node_modules` / `dist` を除外した `_gh_pages` を作成し `.nojekyll` を付与。`index.html`／`js/app.js`／`css/style.css`／`js/vendor/xlsx.bundle.js` の存在を test で検証してからアップロード。Electron ビルドワークフローとは独立。

#### `.github/workflows/build-exe.yml`

- **配置場所:** `.github/workflows/build-exe.yml`
- **役割・責務:** Windows Portable／NSIS EXE 生成。
- **runs-on:** windows-latest
- **主要ロジック・仕様:** checkout → setup-node 22 → 任意で icon.png を icon.ico へ変換 → npm install → npm run build:win → upload-artifact（`dist/*.exe`）。Pages デプロイを破壊しない。

---

## 第5章：画面別UI/UX・インタラクション詳細仕様

### 5.1 本日時間割（VIEW 1 / `viewSchedule`）

| 機能 | 仕様 |
|------|------|
| ドロップ即配置 | パレット `NEW_PATIENT` → `placePatientInstant`。モーダル非表示。`defaultUnits`（既定3）＋月13ブレーキ |
| カード高さ | `(52 * u) - 5` px（1→47, 2→99, 3→151, 4→203）。次セルへ侵食しない |
| 連続枠保護 | 複数単位の後続は `slot-covered-placeholder`（pointer-events:none） |
| クイック単位 | カード内 `[1][2][3]`。click/mousedown でバブリング停止。本体クリックは `openSlotModal` |
| コマ移動 | `MOVE_SLOT`。overlap／validateTimeConflict（元スロット除外）後 `moveScheduleSlot` |
| 担当変更 | slotModal でセラピスト変更。自コマを重複判定から除外し自滅エラー防止 |
| 業務・休暇 | モーダル TASK タブ。終日=`TOTAL_SLOT_COUNT`、半日=`AM_SLOT_COUNT` にプリセット連動 |
| 消炎鎮痛列 | `analgesia[slotId]=patientId[]`。個別リハ単位・収益に加算しない |
| 予約一括反映 | `btnSyncAppointmentsToSchedule`。最寄り20分吸着、所要→単位、`[予約 HH:MM〜]` メモ。既存患者／埋まり枠はスキップ |
| 日付 | `#scheduleDateInput`／今日ボタン。変更で再描画 |

### 5.2 外来予約カレンダー

| 機能 | 仕様 |
|------|------|
| 週間 | `weeklyTimetable.js`。同一枠に複数名チップ可（患者間の同時刻は許可） |
| 月間 | `monthlyCalendar.js`。マスダブルクリック→週間モード＋当該週へ |
| 新規 | ボタンまたは週間空きクリック → `openAppointmentModal` |
| 二重予約 | **同一患者**の同日重複時間のみ `checkPatientAppointmentConflict` で遮断 |
| 印刷 | 週間A4横（`weeklyTablePrint.js`）、デイリーA4縦（`dailyChecklistPrint.js`）、予約票A5（`appointmentTicketPrint.js`） |

### 5.3 月間単位・収益（VIEW 2）

| 機能 | 仕様 |
|------|------|
| 単位表 | 患者×日のマトリクス、早期加算サブ行、月計、月13⚠️（`unitsTable.js`） |
| KPI | 本日／当月収益（`POINT_RATE=10` 円換算）、内訳モーダル（`revenueDashboard.js`） |
| 日割り | 集計時も `getDailyBasePoints(p, date)` を実施日ごとに適用 |
| 過去月 | `loadMonthOnDemand` 後に `aggregateFromAppSchedule` |

### 5.4 患者台帳（VIEW 3）

| 機能 | 仕様 |
|------|------|
| 項目 | ID, 氏名, カナ, 疾患名, 区分, ステータス, diseaseType, 介護, 計画書フェーズ, 起算・入院・早期起算, force13, **defaultUnits**, 備考 |
| 検索 | `searchPatients`（ひらがな／カタカナ／全半角） |
| ソート | ID、五十音、起算日、期限間近等（`patientSortKey`） |
| ステータス | ACTIVE／DISCONTINUED。時間割パレットは継続のみ |

### 5.5 物品貸出（VIEW 4）

| 機能 | 仕様 |
|------|------|
| 種別 | 院内備品／業者借用（vendorName） |
| 状態 | 貸出中／返却済（`markAsReturned`） |
| UI | 一覧フィルタ、登録モーダル `#modalLoanRegister` |

### 5.6 Excel出力・バックアップ（VIEW 5）

| 機能 | 仕様 |
|------|------|
| 受付Excel | サマリー＋年間＋疾患別＋消炎。消炎はA4横1枚収容の列幅 |
| 日誌Excel | 1日〜当日（当月）または月末まで。助手名、午前／午後出欠（period判定） |
| PC自動保存UI | Electron時「有効 (ドキュメント\リハ業務管理_自動バックアップ)」＋フォルダを開く |
| 手動 | 📦保存／🏛確定／📥復元 |

---

## 第6章：全データモデル・型定義・キー一覧

### 6.1 永続化キー完全一覧

| キー | 層 | 用途 | ライフサイクル |
|------|-----|------|----------------|
| `reha_patients_master` | IDB＋メモリ | Patient[] | 永続。復元で全置換可 |
| `reha_therapists_master` | IDB＋メモリ | Therapist[] | 永続 |
| `reha_assistant_settings` | IDB＋メモリ | assistant1 / assistant2 | 永続 |
| `reha_loans_master` | IDB＋メモリ | Loan[] | 永続 |
| `reha_outpatient_appointments` | IDB＋メモリ | Record&lt;id, Appointment&gt; | 永続 |
| `reha_schedule_YYYY-MM-DD` | IDB＋メモリ（窓外はIDBのみ） | DailySchedule | 日別。アーカイブ窓外はメモリからパージ可 |
| `reha_facility_hours` | **localStorage 直接** | FacilityHours | 施設時間。timeSlotGenerator が直接 R/W |
| `__reha_storage_migrated_v1` | IDB | 移行完了フラグ | 一度きり |
| （廃止）`reha_backup_folder_*` | — | 旧FSA UI | ダンプ除外・無視 |
| （廃止）`reha_autobackup_*` | — | 旧LS日次コピー | 起動時削除 |

**IndexedDB メタ:** DB `reha_work_manager_db` / store `app_key_value_store`。

**Electron ファイル:** `Documents/リハ業務管理_自動バックアップ/reha_backup_YYYY-MM-DD.json`（14日ローテ）。

### 6.2 TypeScript風 型定義一覧

```ts
type FacilityHours = {
  amStart: string; // HH:MM
  amEnd: string;
  pmStart: string;
  pmEnd: string;
};

type TimeSlot = {
  id: string; // am_1 | pm_1 | ...
  label: string;
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
type BillingPlan = '' | 'PLAN_1_FIRST' | 'PLAN_1_FOLLOW' | 'PLAN_2_FIRST' | 'PLAN_2_FOLLOW';

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
  admissionDate: string;
  earlyBonusStartDate: string;
  onsetDate: string;
  force13Limit: boolean;
  defaultUnits: 1 | 2 | 3 | 4;
  notes: string;
};

type TherapistStatus = 'ACTIVE' | 'LEAVE' | 'RETIRED';
type Therapist = {
  id: string;
  name: string;
  color: string;
  status: TherapistStatus;
};

type ScheduleItemType = 'PATIENT' | 'TASK' | 'LEAVE' | 'HOLIDAY';

type PatientSlotItem = {
  itemType?: 'PATIENT';
  patientId: string;
  units: number; // 1..4
  note: string;
  billingPlan: BillingPlan;
  updatedAt: string;
};

type BlockSlotItem = {
  itemType: 'TASK' | 'LEAVE' | 'HOLIDAY';
  patientId: null;
  title: string;
  units: number;
  slotsCount: number;
  note: string;
  billingPlan: '';
  updatedAt: string;
};

type SlotItem = PatientSlotItem | BlockSlotItem;

type DailySchedule = {
  [therapistId: string]: { [slotId: string]: SlotItem };
  analgesia?: { [slotId: string]: string[] };
};

type AppointmentStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
type TreatmentType = 'INDIVIDUAL' | 'ANALGESIA' | 'EVALUATION' | 'OTHER';

type Appointment = {
  id: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  patientId: string;
  therapistId: string;
  treatmentType: TreatmentType;
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type LoanOwnerType = 'HOSPITAL' | 'VENDOR';
type Loan = {
  id: string;
  itemName: string;
  patientId: string;
  patientName: string;
  ownerType: LoanOwnerType;
  vendorName: string;
  loanDate: string;
  dueDate: string;
  returnedAt: string;
  notes: string;
};

type SystemDump = {
  app: 'reha-work-manager';
  version: string;
  exportedAt: string;
  backupType?: 'DAILY_AUTO' | 'MANUAL' | 'FISCAL_YEAR_FINAL';
  targetDate?: string;
  fiscalYear?: number;
  storage: Record<string, string>;
};

type DesktopAppApi = {
  isDesktop: true;
  platform: string;
  version: string;
  saveDailyBackup: (payload: object) => Promise<{ success: boolean; filePath?: string; message?: string }>;
  openBackupFolder: () => Promise<{ success: boolean; message?: string }>;
};
```

### 6.3 制限定数（`REHA_RULES.LIMITS`）

| キー | 値 | 意味 |
|------|-----|------|
| MONTHLY_MAINTENANCE_MAX | 13 | 月13単位 |
| DAILY_STANDARD | 6 | 患者1日標準 |
| DAILY_ACUTE_MAX | 9 | 急性期特例 |
| THERAPIST_DAILY_STANDARD | 18 | 目安 |
| THERAPIST_DAILY_MAX | 24 | セラピスト1日厳格上限 |
| THERAPIST_WEEKLY_MAX | 108 | 週上限 |
| POINT_RATE | 10 | 1点＝10円 |

---

## 付録A：依存関係の中心ハブ

| ハブ | 多数から参照 |
|------|----------------|
| `rules.js` | 点数・TIME_SLOTS・UNIT_CONFIG |
| `storageAdapter.js` | 全 Store |
| `deadlineCalc.js` | 月間・Excel・モーダル・即配置 |
| `scheduleStore.js` | 時間割・月間・Excel・日誌 |
| `patientStore.js` | ほぼ全画面 |
| `backupService.js` | データ変更後の triggerDailyBackup |

## 付録B：改修時の破壊禁止事項

1. カード高さ式 `(52 * u) - 5` とセル行高 52px の整合
2. `TIME_SLOTS`／`APPOINTMENT_TIME_STRINGS` の**参照維持インプレース更新**
3. `storageGet`／`storageSet` の同期契約
4. ブラウザ向け FSA バックアップの再導入禁止（Electron IPC 1本化）
5. 消炎鎮痛の個別リハ単位・収益への混入禁止
6. 予約一括反映の手入力枠スキップ保護
7. `file://` 前提コードの追加禁止

## 付録C：網羅チェックリスト（実在ソース）

以下は本仕様書第4章で個別記述した実在パスの一覧である。

- [x] `.github/workflows/build-exe.yml`
- [x] `.github/workflows/deploy-pages.yml`
- [x] `.nojekyll`
- [x] `css/appointment.css`
- [x] `css/base.css`
- [x] `css/modals.css`
- [x] `css/schedule.css`
- [x] `css/style.css`
- [x] `css/tables.css`
- [x] `css/toast.css`
- [x] `index.html`
- [x] `js/app.js`
- [x] `js/backup/backupService.js`
- [x] `js/backup/localFileBackup.js`
- [x] `js/config/appointmentSlots.js`
- [x] `js/config/rules.js`
- [x] `js/core/dataNormalizer.js`
- [x] `js/core/dateUtils.js`
- [x] `js/core/deadlineCalc.js`
- [x] `js/core/holidayCalc.js`
- [x] `js/core/storageAdapter.js`
- [x] `js/core/timeSlotGenerator.js`
- [x] `js/core/validator.js`
- [x] `js/excel/diaryWriter.js`
- [x] `js/excel/sheetUtils.js`
- [x] `js/excel/sheets/analgesiaSheet.js`
- [x] `js/excel/sheets/rehaPatientSheet.js`
- [x] `js/excel/sheets/summarySheet.js`
- [x] `js/excel/sheets/yearlyTrendSheet.js`
- [x] `js/excel/uketsukeWriter.js`
- [x] `js/print/appointmentTicketPrint.js`
- [x] `js/print/dailyChecklistPrint.js`
- [x] `js/print/weeklyTablePrint.js`
- [x] `js/store/appointmentStore.js`
- [x] `js/store/appointmentSync.js`
- [x] `js/store/archiveManager.js`
- [x] `js/store/assistantStore.js`
- [x] `js/store/loanStore.js`
- [x] `js/store/patientStore.js`
- [x] `js/store/scheduleStore.js`
- [x] `js/store/storageWrite.js`
- [x] `js/store/therapistStore.js`
- [x] `js/ui/toast.js`
- [x] `js/vendor/xlsx.bundle.js`
- [x] `js/views/appointment/calendarState.js`
- [x] `js/views/appointment/monthlyCalendar.js`
- [x] `js/views/appointment/palette.js`
- [x] `js/views/appointment/weeklyTimetable.js`
- [x] `js/views/appointmentCalendarView.js`
- [x] `js/views/exportView.js`
- [x] `js/views/loanView.js`
- [x] `js/views/modals/analgesiaModal.js`
- [x] `js/views/modals/appointmentModal.js`
- [x] `js/views/modals/slotModal.js`
- [x] `js/views/modals/staffModal.js`
- [x] `js/views/monthly/diaryPreview.js`
- [x] `js/views/monthly/monthlyState.js`
- [x] `js/views/monthly/revenueDashboard.js`
- [x] `js/views/monthly/unitsTable.js`
- [x] `js/views/monthlyView.js`
- [x] `js/views/patientView.js`
- [x] `js/views/schedule/kpiStrip.js`
- [x] `js/views/schedule/palette.js`
- [x] `js/views/schedule/scheduleState.js`
- [x] `js/views/schedule/timetable.js`
- [x] `js/views/scheduleView.js`
- [x] `main.js`
- [x] `main/backupIpc.js`
- [x] `package.json`
- [x] `preload.js`

---

*End of COMPLETE_SYSTEM_ARCHITECTURE_SPEC — 指示書の章立てに沿い、リポジトリ上の対象ソースをファイル単位で網羅*
