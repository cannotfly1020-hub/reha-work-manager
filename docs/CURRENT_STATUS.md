# reha-work-manager 現況レポート

記録日: 2026-10-13  
対象: リポジトリ作業ツリー（`.git` と `node_modules` を除く実在ファイル）

このシステムは、ビルド工程なしのオフライン SPA です。画面は `index.html` の `<section>` をタブで切り替え、データは `localStorage` に保存します。デスクトップ版は Electron 33 が `app://localhost` から同じ HTML を開きます。`file://` で `index.html` を直接開くと、ブラウザが `type="module"` の `js/app.js` を拒否します（`Origin null`）。

起動の流れ:

1. Electron の `main.js` が特権スキーム `app` を登録し、`app://localhost/index.html` を開く。
2. `preload.js` が `window.desktopApp`（日次バックアップのファイル保存）を公開する。
3. `index.html` が CSS 6 ファイルと `js/app.js`（ES Module）を読む。
4. `js/app.js` が各画面の `init*` を呼び、保存・削除のあと `renderAllViews()` で全画面を描き直す。

循環参照（関数の実行時にだけ辿る。初期化時には呼ばない）:

- `js/views/scheduleView.js` と `js/views/schedule/timetable.js`
- `js/views/appointmentCalendarView.js` と `js/views/appointment/weeklyTimetable.js`
- `js/views/appointmentCalendarView.js` と `js/views/appointment/monthlyCalendar.js`

画面状態オブジェクト（再代入せずプロパティを更新する）:

| オブジェクト | ファイル | プロパティ |
|---|---|---|
| `scheduleState` | `js/views/schedule/scheduleState.js` | `dateStr`, `paletteCategory`（初期 `ALL`）, `paletteSortKey`（初期 `CATEGORY`） |
| `calendarState` | `js/views/appointment/calendarState.js` | `baseDate`, `viewMode`（`WEEK` / `MONTH`）, `dragPayload`, `paletteCategory`（初期 `OUTPATIENT`）, `paletteSort`（初期 `CATEGORY`） |
| `monthlyState` | `js/views/monthly/monthlyState.js` | `year`, `month`, `sortKey`（初期 `CATEGORY`）, `lastAggregated` |

`localStorage` キー:

| キー | 書き手 |
|---|---|
| `reha_patients_master` | `patientStore.js` |
| `reha_therapists_master` | `therapistStore.js` |
| `reha_assistant_settings` | `assistantStore.js` |
| `reha_loans_master` | `loanStore.js` |
| `reha_outpatient_appointments` | `appointmentStore.js` |
| `reha_schedule_` + 日付 | `scheduleStore.js` |
| `reha_autobackup_` + 日付 | `backupService.js`（直近 14 日を残す） |

`appointmentSync.js` は反映時に `reha_outpatient_appointments` を先に読み、空なら `reha_appointments` を見る。`exportView.js` の初期化で `window.triggerDailyBackup` に日次バックアップを載せる。保存系の画面はこれを呼ぶ。

時間枠は 2 種類ある。混ぜないこと。

- 当日時間割: `js/config/rules.js` の `TIME_SLOTS`。`{ id, period, label, start, end, order }`。ID は `am_1` や `pm_1`。
- 外来予約カレンダー: `js/config/appointmentSlots.js` の `TIME_SLOTS`。`'08:40'` から始まる時刻文字列。

セルカードの高さは `js/views/schedule/timetable.js` の `buildSlotCardHtml` にある `(52 * u) - 5` px。

---

## 1. フォルダ・ファイル構成

```
reha-work-manager/
├── .github/workflows/build-exe.yml
├── css/
│   ├── appointment.css
│   ├── base.css
│   ├── modals.css
│   ├── schedule.css
│   ├── style.css
│   ├── tables.css
│   └── toast.css
├── docs/
│   └── CURRENT_STATUS.md          ← 本レポート
├── icon.png
├── index.html
├── js/
│   ├── app.js
│   ├── backup/backupService.js
│   ├── config/
│   │   ├── appointmentSlots.js
│   │   └── rules.js
│   ├── core/
│   │   ├── dataNormalizer.js
│   │   ├── dateUtils.js
│   │   ├── deadlineCalc.js
│   │   ├── holidayCalc.js
│   │   └── validator.js
│   ├── excel/
│   │   ├── diaryWriter.js
│   │   ├── sheetUtils.js
│   │   ├── uketsukeWriter.js
│   │   └── sheets/
│   │       ├── analgesiaSheet.js
│   │       ├── rehaPatientSheet.js
│   │       ├── summarySheet.js
│   │       └── yearlyTrendSheet.js
│   ├── print/
│   │   ├── appointmentTicketPrint.js
│   │   ├── dailyChecklistPrint.js
│   │   └── weeklyTablePrint.js
│   ├── store/
│   │   ├── appointmentStore.js
│   │   ├── appointmentSync.js
│   │   ├── assistantStore.js
│   │   ├── loanStore.js
│   │   ├── patientStore.js
│   │   ├── scheduleStore.js
│   │   └── therapistStore.js
│   ├── ui/toast.js
│   └── views/
│       ├── appointment/
│       │   ├── calendarState.js
│       │   ├── monthlyCalendar.js
│       │   ├── palette.js
│       │   └── weeklyTimetable.js
│       ├── appointmentCalendarView.js
│       ├── exportView.js
│       ├── loanView.js
│       ├── modals/
│       │   ├── analgesiaModal.js
│       │   ├── appointmentModal.js
│       │   ├── slotModal.js
│       │   └── staffModal.js
│       ├── monthly/
│       │   ├── diaryPreview.js
│       │   ├── monthlyState.js
│       │   ├── revenueDashboard.js
│       │   └── unitsTable.js
│       ├── monthlyView.js
│       ├── patientView.js
│       ├── schedule/
│       │   ├── kpiStrip.js
│       │   ├── palette.js
│       │   ├── scheduleState.js
│       │   └── timetable.js
│       └── scheduleView.js
├── main.js
├── main/backupIpc.js
├── package.json
└── preload.js
```

`icon.ico` はリポジトリには無い。Windows ビルド（`.github/workflows/build-exe.yml`）が `icon.png` から生成する。`package.json` の `build.win.icon` は `icon.ico` を参照する。

---

## 2. ファイルごとの詳細

凡例: 「利用先」は、その export を import しているファイル。内部関数は export しない。

### 起動・デスクトップ

#### `package.json`

Electron アプリの定義。`main` は `main.js`。スクリプトは `npm start`（`electron .`）と `npm run build:win`（NSIS）。依存は `electron` と `electron-builder` のみ。アプリ ID は `com.reha.workmanager`。

#### `main.js`

Electron メインプロセス。ウィンドウ、メニュー、`app://` 配信。

- `protocol.registerSchemesAsPrivileged` でスキーム `app` を standard / secure / CORS 許可にする。`app.ready` より前に実行する。
- `isInsideAppDirectory(filePath)`: 要求パスがアプリディレクトリ内か。
- `registerAppProtocol()`: `app://localhost/...` を `__dirname` 配下のファイルへ対応づける。`net.fetch` で返す。
- `createWindow()`: 1400×900、preload、`contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`。`loadURL('app://localhost/index.html')`。
- `require('./main/backupIpc')` の `getBackupDirectoryPath` をメニュー「バックアップフォルダを開く」が使う。`setupBackupIpc` を `whenReady` で呼ぶ。

export は無い。

#### `main/backupIpc.js`

CommonJS。ドキュメントフォルダ `リハ業務管理_自動バックアップ` への JSON 書き出し。

- `getBackupDirectoryPath()`: フォルダを作りパスを返す。
- `cleanOldBackupFiles(backupDir, keepCount = 14)`: `reha_autobackup_*.json` の古いファイルを消す。
- `setupIpcHandlers()`: 次の IPC を登録する。
  - `save-daily-backup-file`: `{ targetDate, data }` と dump 直渡しの両方を受ける。
  - `open-backup-folder`
  - `get-backup-dir-path`
- `module.exports`: `getBackupDirectoryPath` と、`setupBackupIpc`（中身は `setupIpcHandlers`）。

利用先: `main.js`。

#### `preload.js`

`contextBridge.exposeInMainWorld('desktopApp', ...)`。

- 値: `isDesktop: true`, `platform`, `version: '1.0.0'`
- `saveDailyBackup(dumpData)` → `save-daily-backup-file`
- `openBackupFolder()` → `open-backup-folder`

DOMContentLoaded でデスクトップ起動ログを出す。import / export は無い。

#### `index.html`

全画面の DOM。約 800 行。分割読み込みはしていない。

| 要素 | 役割 |
|---|---|
| `#viewSchedule` | 当日時間割 |
| `#viewAppointmentCalendar` | 外来予約（週間 `#aptWeeklyViewContainer`、月間 `#aptMonthlyViewContainer`） |
| `#viewMonthly` | 月間単位・収益 |
| `#viewPatient` | 患者台帳 |
| `#viewLoan` | 物品貸出 |
| `#viewExport` | Excel とバックアップ |
| `#modalSlotEdit` | 時間割コマ |
| `#modalPatientEdit` | 患者 |
| `#modalLoanRegister` | 貸出 |
| `#modalAnalgesiaSlot` | 消炎鎮痛 |
| `#modalRevenueBreakdown` | 本日内訳 |
| `#modalStaffSettings` | スタッフ・助手 |
| `#modalAppointmentEdit` | 外来予約 |
| `#toastContainer` | トースト |

末尾は `<script type="module" src="js/app.js"></script>`。SheetJS は CDN の `xlsx-js-style@1.2.0`。favicon は `data:,` で、`/favicon.ico` の 404 を出さない。

#### `.github/workflows/build-exe.yml`

`push` のたびに Windows で `npm install` と `npm run build:win`。`icon.png` があれば `icon.ico` を作る。成果物は `dist/*.exe`。

#### `icon.png`

ウィンドウ用アイコンの元画像。

### スタイル

`index.html` は次を直接読む。`css/style.css` は同じ 6 ファイルを `@import` する束ね用で、HTML からは参照していない。

| ファイル | 役割 |
|---|---|
| `css/base.css` | CSS 変数、`*` リセット、ヘッダー、タブ、パネル |
| `css/schedule.css` | 当日時間割グリッド、コマカード、消炎バッジ |
| `css/tables.css` | 共通テーブル、月間単位表、患者台帳の右端列 |
| `css/modals.css` | モーダルオーバーレイ |
| `css/toast.css` | トースト |
| `css/appointment.css` | 外来予約の月間マスと週間グリッド、パレット |

### `js/app.js`

全画面の初期化とタブ再描画。

import:

- `initScheduleView`, `renderScheduleView`
- `initAppointmentCalendarView`, `renderAppointmentCalendarView`
- `initMonthlyView`, `renderMonthlyView`
- `initPatientView`, `renderPatientView`
- `initLoanView`, `renderLoanView`
- `initExportView`
- `showToast`
- `setupAppointmentModalListeners`

export:

- `renderAllViews()`: 5 画面の `render*` を個別に try/catch する。予約モーダルの保存・削除と、タブ切替と、ヘッダー更新が呼ぶ。

内部: `initNavigationTabs()`, `initRefreshButtons()`。DOMContentLoaded で各 `init*` のあと `renderAllViews()`。

### 設定

#### `js/config/rules.js`

診療報酬の定数。import は無い。

- `REHA_RULES`: `LIMIT_DAYS`（運動器・脳血管・廃用・消炎の日数、点数、表示色）、早期加算、計画書点数、単位上限、`POINT_RATE: 10`。
- `TIME_SLOTS`: 当日時間割のコマオブジェクト。
- `THERAPISTS`: 初期スタッフ定義。
- `UNIT_CONFIG`: 単位数の表示設定。

利用先: 時間割、月間、患者、スロットモーダル、受付 Excel、業務日誌、予約同期。

#### `js/config/appointmentSlots.js`

- `TIME_SLOTS`: 外来予約の時刻文字列配列。

利用先: `weeklyTimetable.js`, `weeklyTablePrint.js`。

### コア計算

#### `js/core/dataNormalizer.js`

文字列・日付・HTML の正規化。import は無い。

- `normalizeString(input)`
- `normalizeToKatakana(input)`: パレットの五十音順。
- `getGojuonGroup(nameOrKana)`
- `normalizePatientId(id)`
- `normalizeDateString(dateInput)`
- `sanitizeHtml(str)`
- `safeParseInt(val, fallback = 0)`

#### `js/core/dateUtils.js`

- `formatDateYMD(d)` → `YYYY-MM-DD`
- `getLocalDateStr(date = new Date())`
- `getWeekDates(baseDate)`: 月曜始まりの月〜土、6 日。

利用先: 当日時間割、予約カレンダー、印刷、スロット／消炎モーダル、月間収益。

#### `js/core/deadlineCalc.js`

算定日数、早期加算、維持期、計画書の推奨。import は無い。

- `normalizeDate(input)`
- `formatDate(date)`
- `getDiffDays(fromDate, toDate)`
- `getOneThirdDays(diseaseType)`
- `addDays(baseDate, daysToAdd)`
- `evaluateEarlyBonusPhase(admissionOrStart, sessionDate, category = 'INPATIENT')`
- `calculatePatientDeadlines(patient, baseDate = new Date())`
- `evaluateRecommendedPlan(patient, targetDateStr, hasPastPlan = false)`

#### `js/core/holidayCalc.js`

- `getJapaneseHolidayName(dateInput)`: `Date` または日付文字列。祝日名、振替休日、国民の休日。該当しなければ `null`。空入力は `null`。外部 API は使わない。

利用先: 予約カレンダー一式、予約モーダル、週間印刷、デイリー印刷。

#### `js/core/validator.js`

`TIME_SLOTS` を `rules.js` から import。

- `getOccupiedSlotIds(startSlotId, units)`
- `validateTimeConflict(dailySchedule, targetTherapist, targetSlotId, patientId, units, excludeSlotId = null)`
- `validateDailyLimit(...)`
- `validateMonthly13Limit(...)`
- `validateMonthlyPlanLimit(billingPlan, existingPlanDate)`
- `validateTherapistWorkload(...)`

利用先: `slotModal.js`（全部）、`timetable.js`（`validateTimeConflict`）。

### ストア

#### `js/store/patientStore.js`

import: `normalizeString`, `normalizePatientId`, `normalizeDateString`。

- `PATIENT_STATUS`
- `getAllPatients(includeDiscontinued = true)`
- `getPatientById(id)`
- `saveAllPatients(patients)`
- `upsertPatient(rawData)`
- `updatePatientPlanStatus(patientId, planType)`
- `deletePatient(id)`
- `searchPatients(keyword = '', category = 'ALL', includeDiscontinued = false)`: 第 3 引数は中止患者の含否。並び順は受け取らない。

#### `js/store/therapistStore.js`

import: `normalizeString`。

- `THERAPIST_STATUS`
- `getAllTherapists()`, `getActiveTherapists()`, `getTherapistById(id)`
- `saveAllTherapists(list)`
- `addTherapist(name = '', status = ACTIVE)`
- `updateTherapistName(id, newName)`, `updateTherapistStatus(id, newStatus)`
- `updateTherapistSettings(updateMap)`, `updateTherapistNames(nameMap)`

#### `js/store/assistantStore.js`

import は無い。元は `staffModal.js` にあった。

- `getAssistantSettings()` → `{ assistant1, assistant2 }`
- `saveAssistantSettings(a1 = '', a2 = '')`

利用先: `staffModal.js`, `diaryWriter.js`。

#### `js/store/loanStore.js`

import: `normalizeString`, `normalizePatientId`, `normalizeDateString`。

- `getAllLoans()`, `saveAllLoans(loans)`, `registerLoan(rawData)`
- `markAsReturned(loanId, returnDate = '')`, `deleteLoan(loanId)`
- `filterLoans(filterOptions = {})`

利用先: `loanView.js`。

#### `js/store/appointmentStore.js`

import はファイル先頭の正規化に依存（保存・日付）。キーは `reha_outpatient_appointments`。保存成功時に `window.triggerDailyBackup` を呼ぶ。

- `getAllAppointments()`, `saveAllAppointments(appointments)`
- `getAppointmentsByDate(dateStr)`, `getAppointmentsByMonth(year, month)`
- `getPatientFutureAppointments(patientId, fromDateStr = null)`
- `checkPatientAppointmentConflict(patientId, date, startTime, durationMinutes, excludeAppointmentId = null)`
- `upsertAppointment(rawData)`, `deleteAppointment(appointmentId)`
- `calculateEndTime(startTime, durationMinutes = 30)`
- 内部 `timeStringToMinutes(timeStr)`

#### `js/store/appointmentSync.js`

当日時間割への外来予約の流し込み。元は `scheduleView.js`。

import: `rules.js` の `TIME_SLOTS`、`normalizeDateString`、`getActiveTherapists`、`getPatientById`、`getDailySchedule` / `setScheduleSlot` / `addAnalgesiaPatient` / `getAnalgesiaSlotPatients`、`showToast`。

- `getAppointmentsForDate(dateStr)`: キャンセル以外。配列でもオブジェクトでも読む。
- 内部 `findNearestSlotId(timeStr)`: 実時間を最も近い 20 分コマ ID にする。
- 内部 `convertDurationToUnits(durationMin)`: 20 分以下=1、40 以下=2、60 以下=3、それ以外=4。
- `syncAppointmentsToSchedule(dateStr, onApplied)`: 手入力済みコマは上書きしない。同日の二重配置はスキップ。反映件数があればバックアップを呼び、`onApplied()` を実行する。

利用先: `scheduleView.js`。

#### `js/store/scheduleStore.js`

日次スケジュールの読み書きと月間集計。分割していない。

import: 患者・ルール・期限計算（集計側）。

- `getDailySchedule(dateStr)`, `saveDailySchedule(dateStr, scheduleData)`
- `setScheduleSlot(...)`, `clearScheduleSlot(...)`, `moveScheduleSlot(...)`
- `addAnalgesiaPatient`, `removeAnalgesiaPatient`, `getAnalgesiaSlotPatients`
- `getDailyStats(dateStr)`
- `findPatientMonthlyPlanDate(...)`, `hasPatientPastPlan(patientId, beforeDateStr)`
- `aggregateFromAppSchedule(year, month)`: 月間画面と両 Excel の入力。

### UI 共通

#### `js/ui/toast.js`

元は `exportView.js` の `showToast`。

- `showToast(message, type = 'info')`: `#toastContainer` が無ければ作る。`type` はクラス名（`info` / `success` / `warn` / `error`）。

利用先: `app.js`、各画面、各モーダル、印刷 3 ファイル、`backupService.js`、`appointmentSync.js`。

### 当日時間割

#### `js/views/schedule/scheduleState.js`

import: `getLocalDateStr`。export は `scheduleState` のみ。

#### `js/views/schedule/palette.js`

import: `REHA_RULES`, `sanitizeHtml`, `normalizeToKatakana`, `searchPatients`, `scheduleState`。

- `setupSchedulePaletteEvents()`: `#paletteSearch`, `#paletteSortSelect`, `.palette-cat-btn`。
- `sortPalettePatients(list, sortKey)`: `KANA` / `ID` / 区分（入院→外来→消炎）。
- `renderPatientPalette()`: `#palettePatientList`。検索文字は関数内で `#paletteSearch` から取る。

利用先: `scheduleView.js`。

#### `js/views/schedule/kpiStrip.js`

import: `getDailyStats`, `scheduleState`。

- `renderDailyKPIStrip()`: `#dailyKpiStrip` に単位・患者数・消炎・計画書件数。

#### `js/views/schedule/timetable.js`

import: `TIME_SLOTS`, `REHA_RULES`, `sanitizeHtml`, `safeParseInt`, `getActiveTherapists`, `getPatientById`, `getDailySchedule`, `moveScheduleSlot`, `addAnalgesiaPatient`, `getAnalgesiaSlotPatients`, `calculatePatientDeadlines`, `validateTimeConflict`, `showToast`, `openSlotModal`, `openAnalgesiaModal`, `scheduleState`, `renderScheduleView`。

- `buildSlotCardHtml(p, u, cellData, tId, slotId)`: 高さ `(52 * u) - 5`。
- `renderTimetableGrid()`: `#timetableGrid`。
- 内部 `attachGridEventListeners(gridEl)`: 空セル、カードクリック、移動ドロップ、消炎ドロップ。移動と消炎追加のあと `renderScheduleView()` とバックアップ。

#### `js/views/scheduleView.js`

当日時間割の入口。描画本体は持たない。

import: `getLocalDateStr`, `showToast`, `getAppointmentsForDate`, `syncAppointmentsToSchedule`、3 モーダルの `setup*`、`scheduleState`、パレット、KPI、グリッド。

- 内部 `updateSyncAppointmentsBadge()`: `#syncAppointmentCountBadge`。
- 内部 `bindSyncButtonListener()`: `#btnSyncAppointmentsToSchedule`。二重登録を `dataset.bound` で防ぐ。
- `initScheduleView()`: 日付、今日、更新、パレット、3 モーダル。
- `renderScheduleView()`: バッジ、KPI、パレット、グリッド。

利用先: `app.js`。`timetable.js` が `renderScheduleView` を戻して呼ぶ。

### 外来予約

#### `js/views/appointment/calendarState.js`

import は無い。export は `calendarState`。

#### `js/views/appointment/palette.js`

import: `sanitizeHtml`, `normalizeToKatakana`, `searchPatients`, `calendarState`。

- `setupAptPaletteEvents()`: `#aptPaletteSearch`, `#aptPaletteSortSelect`, `.apt-palette-cat-btn`。
- 内部 `sortAptPalettePatients(list, sortKey)`: 区分は外来→消炎→入院。
- `renderAptPalette()`: `#aptPalettePatientList`。ドラッグ開始で `calendarState.dragPayload` に `{ type: 'NEW_PATIENT', patientId, patientName }`。

#### `js/views/appointment/weeklyTimetable.js`

import: `sanitizeHtml`, `getJapaneseHolidayName`, `formatDateYMD`, `getWeekDates`, 予約用 `TIME_SLOTS`, `getPatientById`, `getAllTherapists`, `getAllAppointments`, `upsertAppointment`, `openAppointmentModal`, `showToast`, `calendarState`, `renderAppointmentCalendarView`。

- `renderWeeklyTimetable()`: `#aptWeeklyGrid`。祝日列は入力不可の印を付ける。
- 内部 `setupWeeklyDragAndDrop(gridEl)`: 祝日へのクリックとドロップはトーストで止める。新規は `upsertAppointment`、移動も同じ。

#### `js/views/appointment/monthlyCalendar.js`

import: `sanitizeHtml`, `getJapaneseHolidayName`, `formatDateYMD`, `getPatientById`, `getAllTherapists`, `getAllAppointments`, `getAppointmentsByMonth`, `openAppointmentModal`, `showToast`, `calendarState`, `renderAppointmentCalendarView`, `switchViewMode`, `syncDateInput`。

- `renderMonthlyCalendar()`: `#aptCalendarGridContainer`。祝日の追加ボタンは止める。日付のダブルクリックでその週の週間ビューへ移る。

#### `js/views/appointmentCalendarView.js`

予約カレンダーの入口。

import: `getJapaneseHolidayName`, `formatDateYMD`, `openAppointmentModal`, `showToast`, 印刷 2 関数、`calendarState`、パレット、週間、月間。

- `initAppointmentCalendarView()`: 週移動、今日、新規、週／月、印刷 2 ボタン、パレット。
- `syncDateInput()`: `#aptCalendarWeekDateInput`。月間カレンダーからも使うため export。
- `switchViewMode(mode)`: `WEEK` または `MONTH`。export。
- `renderAppointmentCalendarView()`: パレットのあと、モードに応じて週間か月間。

利用先: `app.js`。週間・月間ビューが再描画と週ジャンプで戻して呼ぶ。

#### `js/views/modals/appointmentModal.js`

import: `sanitizeHtml`, `getPatientById`, `searchPatients`, `getActiveTherapists`, `upsertAppointment`, `deleteAppointment`, `calculateEndTime`, `showToast`, `getJapaneseHolidayName`, `printAppointmentTicket`。

- 内部 `validateAppointmentDateHoliday(dateValue)`: 祝日なら保存ボタンを止める。
- `setupAppointmentModalListeners(onUpdate)`: `app.js` が `renderAllViews` を渡す。
- 内部 `handleAppointmentFormSubmit()`: 祝日は保存しない。予約票チェック時に印刷。
- `openAppointmentModal(appointment = null, defaultDate = null, defaultTime = null)`
- 内部 `populateAppointmentPatientSelect`, `updateAppointmentPatientPreview`

### 月間

#### `js/views/monthly/monthlyState.js`

export は `monthlyState`。

#### `js/views/monthly/revenueDashboard.js`

import: `REHA_RULES`, `calculatePatientDeadlines`, `getLocalDateStr`, `monthlyState`。

- 内部 `getPlanPoints(planKey)`
- `renderRevenueDashboard(aggregated)`: 本日・当月の点数と金額。
- `setupRevenueBreakdownModalListeners()`
- `openRevenueBreakdownModal()`: `monthlyState.lastAggregated` の当日分を疾患・早期加算・計画書・消炎に分ける。

#### `js/views/monthly/unitsTable.js`

import: `REHA_RULES`, `sanitizeHtml`, `normalizeToKatakana`, `calculatePatientDeadlines`, `monthlyState`。

- 内部 `sortPatients(patients, sortKey)`
- `renderMonthlyUnitsTable(aggregated)`

#### `js/views/monthly/diaryPreview.js`

import: `monthlyState`。

- `renderDailyDiaryPreview(aggregated)`: 当月なら今日、それ以外は 1 日の日別集計プレビュー。

#### `js/views/monthlyView.js`

import: `safeParseInt`, `aggregateFromAppSchedule`, `monthlyState`、収益・単位表・日誌プレビュー。

- `initMonthlyView()`: 年月、前月、次月、並び、本日内訳カード。
- 内部 `syncMonthInput()`
- `renderMonthlyView()`: `aggregateFromAppSchedule` の結果を `monthlyState.lastAggregated` に置き、3 描画を呼ぶ。

利用先: `app.js`。

### 患者・貸出・その他モーダル

#### `js/views/patientView.js`

一覧と患者モーダルが同じファイル。分割していない。

import: 患者ストア、`calculatePatientDeadlines`、`sanitizeHtml`、`showToast`。

- `initPatientView()`, `renderPatientView()`
- 内部: `getPlanPhaseCellHtml`, `setupPatientModalListeners`, `syncStatusSelectStyle`, `openPatientModal(patientId)`, `updatePlan2GuidePreview`
- 保存・削除のあと `window.triggerDailyBackup`

利用先: `app.js`（init / render）。

#### `js/views/loanView.js`

一覧と貸出モーダルが同じファイル。

import: `loanStore`, `patientStore`, `showToast`。

- `initLoanView()`, `renderLoanView()`, `openLoanRegisterModal()`
- 内部: `attachLoanTableEvents`, `setupLoanModalListeners`

利用先: `app.js`。

#### `js/views/modals/slotModal.js`

時間割コマの編集。分割していない。

import: `TIME_SLOTS`, `sanitizeHtml`, `safeParseInt`, セラピスト、患者、`scheduleStore` の取得・保存・計画書検索、`evaluateRecommendedPlan`、validator 4 関数、`getLocalDateStr`, `showToast`。

- `setupSlotModalListeners(onUpdate)`: `scheduleView` が `renderScheduleView` を渡す。
- `openSlotModal(therapistId, slotId, currentItem)`
- 内部: `handleSlotFormSubmit`, `populateModalPatientSelect`, `updateModalPatientPlanRecommendation`, `getCurrentDateContext`（`#scheduleDateInput`、無ければ今日）

#### `js/views/modals/analgesiaModal.js`

import: `TIME_SLOTS`, `sanitizeHtml`, `getAllPatients`, 消炎の追加・削除・取得、`getLocalDateStr`, `showToast`。

- `setupAnalgesiaModalListeners(onUpdate)`
- `openAnalgesiaModal(slotId)`
- 内部: `renderAnalgesiaModalList`, `getCurrentDateContext`

#### `js/views/modals/staffModal.js`

import: `sanitizeHtml`, セラピストの取得・追加・設定保存・`THERAPIST_STATUS`, `showToast`, `getAssistantSettings`, `saveAssistantSettings`。

- `setupStaffSettingsModalListeners(onUpdate)`
- `renderStaffSettingsFields()`

利用先: `scheduleView.js` の `initScheduleView`。

#### `js/views/exportView.js`

Excel ボタンだけ。バックアップ処理は持たない。

import: `aggregateFromAppSchedule`, `safeParseInt`, `showToast`, `setupBackupAndRestoreListeners`, `performDailyAutoBackup`, `triggerDailyAutoBackup`, `generateUketsukeWorkbook`, `generateDiaryWorkbook`。

- `initExportView()`: 年月の初期値、受付 Excel、業務日誌、バックアップ UI の接続、起動時と `beforeunload` の日次保存、`window.triggerDailyBackup = triggerDailyAutoBackup`。
- 内部 `handleExportUketsuke(monthInput)`, `handleExportDiary(monthInput)`, `parseYearMonth(val)`

利用先: `app.js`。

### 印刷

ブラウザの別ウィンドウに HTML を書き、`window.print()` する。ポップアップが止まれば `showToast`。

#### `js/print/weeklyTablePrint.js`

import: `formatDateYMD`, `getWeekDates`, 予約用 `TIME_SLOTS`, `sanitizeHtml`, `getJapaneseHolidayName`, `getPatientById`, `getAllTherapists`, `getAllAppointments`, `showToast`。

- `printWeeklyAppointmentTable(baseDate)`: A4 横の週間予約表。祝日名を載せる。

利用先: `appointmentCalendarView.js`。

#### `js/print/dailyChecklistPrint.js`

import: `formatDateYMD`, `sanitizeHtml`, `getJapaneseHolidayName`, `getPatientById`, `getAllTherapists`, `getAllAppointments`, `showToast`。

- `printDailyAppointmentChecklist(baseDate)`: A4 縦。予約が少なくても 32 行まで空欄を足す。

利用先: `appointmentCalendarView.js`。

#### `js/print/appointmentTicketPrint.js`

import: `sanitizeHtml`, `getPatientById`, `getAllTherapists`, `calculateEndTime`, `showToast`。

- `printAppointmentTicket(appointment)`: A5 横の次回予約票。

利用先: `appointmentModal.js`。元の関数名は `triggerPrintAppointmentTicket`。

### Excel

#### `js/excel/sheetUtils.js`

受付 Excel の見た目とセル操作。元は `uketsukeWriter.js` の先頭と末尾。import は無い。`window.XLSX` を使う。

- `SUMMARY_SHEET` = `レセプト収益サマリー`
- `YEARLY_TREND_SHEET` = `年間推移 (入外別)`
- `ANALGESIA_SHEET` = `実施ﾘｽﾄ 消炎鎮痛`
- `STYLES`
- `thinBorder()`
- `getDiseaseInitial(type)`: 運 / 脳 / 廃 / 消
- `getEarlyBaseDate(p)`
- `applyA4LandscapePrintSetup(ws, singlePageOnly = false)`
- `setStyledCell(ws, r, c, val, style = {})`
- `setSheetCols(ws, widthList)`
- `updateSheetRange(ws)`
- `appendOrReplaceSheet(wb, ws, name)`

#### `js/excel/sheets/summarySheet.js`

- `writeExecutiveSummarySheet(wb, aggregated)`

import: `REHA_RULES`, `evaluateEarlyBonusPhase`, `aggregateFromAppSchedule`（このシート本体は月次引数の集計結果を使う）, `sheetUtils` 一式。

#### `js/excel/sheets/yearlyTrendSheet.js`

- `writeYearlyTrendSheet(wb, targetYear)`: 1〜12 月を `aggregateFromAppSchedule` で取り直す。

import は summary と同じ。

#### `js/excel/sheets/rehaPatientSheet.js`

- `writeRehaPatientSheet(wb, aggregated, category, sheetName, patients)`: 入院なら早期加算列あり。

#### `js/excel/sheets/analgesiaSheet.js`

- `writeAnalgesiaDedicatedSheet(wb, aggregated, sheetName)`

#### `js/excel/uketsukeWriter.js`

シートの順番だけを持つ。

import: `ANALGESIA_SHEET`, 4 つの `write*`。

- `generateUketsukeWorkbook(aggregated)`: サマリー、年間推移、入院 3 シート（運動器・脳血管・廃用）、外来 4 シート（運動器を半分に分けた ①②、脳血管、廃用）、消炎。`window.XLSX` が無ければ例外。

利用先: `exportView.js`。呼び出しは `generateUketsukeWorkbook(aggregated, null)`。第 2 引数は関数定義に無く、無視される。

#### `js/excel/diaryWriter.js`

業務日誌。シート分割はしていない。助手名は `assistantStore` から取る（以前は `staffModal.js` から取っていた）。

import: `REHA_RULES`, `evaluateEarlyBonusPhase`, `getDailySchedule`, `getPatientById`, `getAllTherapists`, `THERAPIST_STATUS`, `getAssistantSettings`。

- `generateDiaryWorkbook(aggregated, targetDay = null)`: `targetDay` が数値ならその日まで。
- 内部: `thinBorder(colorHex = 'CBD5E1')`（受付側の `thinBorder()` とは別）、`applyA4LandscapePrintSetup`, `setStyledCell`, `setSheetCols`, `updateSheetRange`。受付用 `sheetUtils` は使わない。

### バックアップ（レンダラー）

#### `js/backup/backupService.js`

元は `exportView.js` の後半。

import: `showToast`。

- 内部 `createSystemDump(meta = {})`: `reha_` で始まり `reha_autobackup_` ではないキーを集める。
- 内部 `downloadJsonBlob(blob, filename)`
- `triggerDailyAutoBackup()`: 2.5 秒デバウンスのあと `performDailyAutoBackup`。
- `performDailyAutoBackup()`: async。localStorage と、あれば `window.desktopApp.saveDailyBackup`。内部バックアップは 14 日。
- `setupBackupAndRestoreListeners()`: 手動 JSON、5 月区切りの年度確定、復元（`app === 'reha-work-manager'` を確認してから全 `reha_` キーを入れ替える）。

利用先: `exportView.js` の `initExportView`。

---

## 3. 巨大ファイルからの分割差分

行数は分割直前の作業ツリーと比較した概数。ロジックの式は移しただけで、算定式や `(52 * u) - 5` は変えていない。

### `js/views/scheduleView.js`（約 650 行 → 88 行）

| 移動した処理 | 移動先 |
|---|---|
| `getAppointmentsForDate`, `findNearestSlotId`, `convertDurationToUnits`, `syncAppointmentsToSchedule` | `js/store/appointmentSync.js`。再描画は引数 `onApplied` |
| 患者パレットの並び・描画・検索／区分／ソートのイベント | `js/views/schedule/palette.js` |
| KPI ストリップ | `js/views/schedule/kpiStrip.js` |
| グリッド HTML、カード高さ、ドラッグ＆ドロップ | `js/views/schedule/timetable.js` |
| `currentDateStr`, `paletteCategory`, `paletteSortKey` | `scheduleState` |
| `getLocalDateStr` | `js/core/dateUtils.js`（スロットモーダル・消炎モーダルもそちらを使う） |

残したもの: `initScheduleView`, `renderScheduleView`, 反映ボタン、件数バッジ。

### `js/views/appointmentCalendarView.js`（約 1,290 行 → 140 行）

二段階で分けた。先に祝日と印刷を抜き、そのあと画面を分けた。

| 移動した処理 | 移動先 |
|---|---|
| `getJapaneseHolidayName`（カレンダーとモーダルで重複していた） | `js/core/holidayCalc.js` |
| `handlePrintWeeklyTable` | `js/print/weeklyTablePrint.js` の `printWeeklyAppointmentTable(baseDate)` |
| `handlePrintDailyChecklist` | `js/print/dailyChecklistPrint.js` の `printDailyAppointmentChecklist(baseDate)` |
| `formatDateYMD`, `getWeekDates` | `js/core/dateUtils.js`。印刷側のコピーは削除 |
| 予約画面専用の時刻文字列 `TIME_SLOTS` | `js/config/appointmentSlots.js` |
| 患者パレット | `js/views/appointment/palette.js` |
| 週間グリッドとドロップ | `js/views/appointment/weeklyTimetable.js` |
| 月間カレンダー | `js/views/appointment/monthlyCalendar.js` |
| `currentBaseDate`, `currentViewMode`, `activeDragPayload`, パレットの区分とソート | `calendarState` |

残したもの: 初期化、日付入力、週／月の切替、再描画の呼び出し。

### `js/views/modals/appointmentModal.js`（約 470 行 → 313 行）

| 移動した処理 | 移動先 |
|---|---|
| 重複していた祝日関数 | `holidayCalc.js` を import |
| `triggerPrintAppointmentTicket` | `printAppointmentTicket` |

残したもの: フォーム、祝日なら保存ボタンを止める処理、患者検索。

### `js/views/monthlyView.js`（約 440 行 → 68 行）

| 移動した処理 | 移動先 |
|---|---|
| 収益 KPI と本日内訳モーダル | `js/views/monthly/revenueDashboard.js` |
| 月間単位表と並び替え | `js/views/monthly/unitsTable.js` |
| 業務日誌プレビュー | `js/views/monthly/diaryPreview.js` |
| `currentYear`, `currentMonth`, `currentSortKey`, `lastAggregated` | `monthlyState` |
| `getLocalTodayString` | `getLocalDateStr` |

残したもの: 年月の移動と、3 描画をまとめて呼ぶ `renderMonthlyView`。

### `js/views/exportView.js`（約 280 行 → 91 行）

| 移動した処理 | 移動先 |
|---|---|
| `showToast` | `js/ui/toast.js`。全 import を付け替えた |
| dump 作成、JSON ダウンロード、日次自動保存、手動バックアップ、年度確定、復元 | `js/backup/backupService.js` |

残したもの: 受付 Excel と業務日誌のボタン。`initExportView` がバックアップ初期化と `window.triggerDailyBackup` をまだ行う。

### `js/excel/uketsukeWriter.js`（約 850 行 → 63 行）

| 移動した処理 | 移動先 |
|---|---|
| `STYLES`, `thinBorder`, セル操作、印刷設定、シート名定数 | `js/excel/sheetUtils.js` |
| `writeExecutiveSummarySheet` | `js/excel/sheets/summarySheet.js` |
| `writeYearlyTrendSheet` | `js/excel/sheets/yearlyTrendSheet.js` |
| `writeRehaPatientSheet` | `js/excel/sheets/rehaPatientSheet.js` |
| `writeAnalgesiaDedicatedSheet` | `js/excel/sheets/analgesiaSheet.js` |

`generateUketsukeWorkbook` はシートを並べるだけになった。業務日誌の同種ヘルパーは `diaryWriter.js` に残している。引数付き `thinBorder(colorHex)` で、受付側と共通化していない。

### `js/views/modals/staffModal.js`

`getAssistantSettings` / `saveAssistantSettings` を `js/store/assistantStore.js` へ移した。`diaryWriter.js` の import 先もストアに変えた。

### `main.js`

バックアップ用 IPC とフォルダ作成を `main/backupIpc.js` へ移した。あわせて `loadFile('index.html')` を `loadURL('app://localhost/index.html')` に変えた。`file://` だと origin が `null` になり、モジュールの `app.js` が CORS で落ちるため。

### `css/style.css`

中身を `base` / `schedule` / `tables` / `modals` / `toast` / `appointment` に分けた。`index.html` は 6 ファイルを `<link>` する。`style.css` は `@import` の束ねだけが残る。

### 分けていないファイル

次は最初から 1 つの役割なので、今回の分割対象にしていない。

- `index.html`（画面 DOM の一枚岩。別 HTML の後読みは Electron の `webSecurity` と相性が悪い）
- `js/views/patientView.js`（台帳と患者モーダル）
- `js/views/loanView.js`（一覧と貸出モーダル）
- `js/views/modals/slotModal.js`
- `js/excel/diaryWriter.js`
- `js/store/scheduleStore.js`（日次 CRUD と `aggregateFromAppSchedule`）
- `js/core/deadlineCalc.js`, `js/core/validator.js`, `js/config/rules.js`
- 各ストアの CRUD ファイル
