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
 * 初期値: 保存済み設定があればそれ、なければ 午前09:00〜13:00 / 午後13:00〜18:00（昼休憩なし・計27コマ）
 * ※旧保存（pmStart=14:00）は getSavedFacilityHours で 13:00 へ自動マイグレーション
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
