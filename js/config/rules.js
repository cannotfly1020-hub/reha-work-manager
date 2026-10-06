// js/config/rules.js
// 診療報酬改定定数マスター・時間枠定義・制約ルール設定

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
      maxDays: 4,
      points: 60,
      label: '早期加算(4日以内)'
    },
    PHASE_2: {
      maxDays: 14,
      points: 25,
      label: '早期加算(14日以内)'
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

// タイムテーブルスロット定義（全24コマ: 午前12コマ[13:00まで] / 午後12コマ）
export const TIME_SLOTS = [
  // 午前枠（9:00〜13:00 / 12:00〜13:00枠完備）
  { id: 'am_1',  period: 'am', label: '09:00 - 09:20', start: '09:00', end: '09:20', order: 1 },
  { id: 'am_2',  period: 'am', label: '09:20 - 09:40', start: '09:20', end: '09:40', order: 2 },
  { id: 'am_3',  period: 'am', label: '09:40 - 10:00', start: '09:40', end: '10:00', order: 3 },
  { id: 'am_4',  period: 'am', label: '10:00 - 10:20', start: '10:00', end: '10:20', order: 4 },
  { id: 'am_5',  period: 'am', label: '10:20 - 10:40', start: '10:20', end: '10:40', order: 5 },
  { id: 'am_6',  period: 'am', label: '10:40 - 11:00', start: '10:40', end: '11:00', order: 6 },
  { id: 'am_7',  period: 'am', label: '11:00 - 11:20', start: '11:00', end: '11:20', order: 7 },
  { id: 'am_8',  period: 'am', label: '11:20 - 11:40', start: '11:20', end: '11:40', order: 8 },
  { id: 'am_9',  period: 'am', label: '11:40 - 12:00', start: '11:40', end: '12:00', order: 9 },
  { id: 'am_10', period: 'am', label: '12:00 - 12:20', start: '12:00', end: '12:20', order: 10 },
  { id: 'am_11', period: 'am', label: '12:20 - 12:40', start: '12:20', end: '12:40', order: 11 },
  { id: 'am_12', period: 'am', label: '12:40 - 13:00', start: '12:40', end: '13:00', order: 12 },

  // 午後枠（14:00〜18:00、夕方枠完備）
  { id: 'pm_1',  period: 'pm', label: '14:00 - 14:20', start: '14:00', end: '14:20', order: 13 },
  { id: 'pm_2',  period: 'pm', label: '14:20 - 14:40', start: '14:20', end: '14:40', order: 14 },
  { id: 'pm_3',  period: 'pm', label: '14:40 - 15:00', start: '14:40', end: '15:00', order: 15 },
  { id: 'pm_4',  period: 'pm', label: '15:00 - 15:20', start: '15:00', end: '15:20', order: 16 },
  { id: 'pm_5',  period: 'pm', label: '15:20 - 15:40', start: '15:20', end: '15:40', order: 17 },
  { id: 'pm_6',  period: 'pm', label: '15:40 - 16:00', start: '15:40', end: '16:00', order: 18 },
  { id: 'pm_7',  period: 'pm', label: '16:00 - 16:20', start: '16:00', end: '16:20', order: 19 },
  { id: 'pm_8',  period: 'pm', label: '16:20 - 16:40', start: '16:20', end: '16:40', order: 20 },
  { id: 'pm_9',  period: 'pm', label: '16:40 - 17:00', start: '16:40', end: '17:00', order: 21 },
  { id: 'pm_10', period: 'pm', label: '17:00 - 17:20', start: '17:00', end: '17:20', order: 22 },
  { id: 'pm_11', period: 'pm', label: '17:20 - 17:40', start: '17:20', end: '17:40', order: 23 },
  { id: 'pm_12', period: 'pm', label: '17:40 - 18:00', start: '17:40', end: '18:00', order: 24 }
];

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
