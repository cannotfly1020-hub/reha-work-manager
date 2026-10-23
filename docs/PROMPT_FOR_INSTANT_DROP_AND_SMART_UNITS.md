# 本日時間割「ドロップ即配置」＆「13単位スマートブレーキ」＆「クイック単位」仕様

> 実装済み（2026-10-23）。本ファイルは改修指示の正本メモ。

## 要件

1. パレット→グリッドへのドロップ時、モーダルを開かず即配置する。
2. 配置単位は患者 `defaultUnits`（未設定時 3）。月13単位制限対象で適用累計が残り不足の場合は自動縮小（例: 累計12 → 1単位）。
3. カード右端に `[1][2][3]` クイックボタン。クリックはバブリング停止しモーダルを開かない。
4. カード本体クリックでの詳細モーダルは維持。

## 対象ファイル

| ファイル | 役割 |
|----------|------|
| `js/core/deadlineCalc.js` | `getSuggestedPlacementUnits` / `getPatientDefaultUnits` / `isMonth13LimitActiveOnDate` |
| `js/store/scheduleStore.js` | `getPatientMonthDailyRehaUnitsMap` |
| `js/views/schedule/timetable.js` | 即配置・クイック単位 |
| `css/schedule.css` | `.slot-quick-units` / `.btn-quick-unit` |
| `js/store/patientStore.js` | `defaultUnits` 永続化 |
| `js/views/patientView.js` + `index.html` | 患者モーダル（※ `patientModal.js` は未分離・本モーダル相当） |

## 月13合算ルール

- `force13Limit` または標準算定日数超過後のみ対象。
- 当月中に期限切れ: **満了日の翌日以降**の単位のみ合算（`checkMonth13UnitsViolation` と同ロジック）。
