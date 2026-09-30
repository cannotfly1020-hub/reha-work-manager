/**
 * @file rules.js
 * @description 診療報酬改定ルール・期限・点数・セラピスト設定マスター
 * 
 * - 制度改定や院内ルールの変更があった場合は、本ファイル内の数値・設定のみを変更します。
 * - 計算ロジックやUIコードには直接数値を埋め込まず（マジックナンバーの排除）、
 *   すべて本設定を参照することで高い保守性を担保します。
 */

export const REHA_RULES = {
  // ==========================================
  // 1. 疾患別 標準算定日数上限（日数および点数）
  // ==========================================
  LIMIT_DAYS: {
    // 運動器リハビリテーション (Ⅱ)
    LOCOMOTIVE: {
      id: 'locomotive',
      label: '運動器リハビリテーション',
      days: 150,
      shortLabel: '運動器Ⅱ',
      defaultPoints: 170,
    },
    // 脳血管疾患等リハビリテーション (Ⅲ)
    CEREBROVASCULAR: {
      id: 'cerebrovascular',
      label: '脳血管疾患等リハビリテーション',
      days: 180,
      shortLabel: '脳血管Ⅲ',
      defaultPoints: 100,
    },
    // 廃用症候群リハビリテーション (Ⅲ)
    DISUSE: {
      id: 'disuse',
      label: '廃用症候群リハビリテーション',
      days: 120,
      shortLabel: '廃用Ⅲ',
      defaultPoints: 77,
    },
    // 消炎鎮痛等処置
    ANALGESIA: {
      id: 'analgesia',
      label: '消炎鎮痛処置',
      days: 9999, // 算定日数上限なし（個別管理）
      shortLabel: '消炎鎮痛',
      defaultPoints: 35,
    },
  },

  // ==========================================
  // 2. 令和8年度改定 早期加算ルール
  //    入院日/起算日からの日数区分および点数
  // ==========================================
  EARLY_BONUS: {
    // 早期加算 第1期：入院日から4日以内
    PHASE_1: {
      id: 'phase_1',
      maxDays: 4,      // 起算日を含めて4日目まで
      label: '早期加算（4日以内）',
      points: 60,      // 改定点数（60点）
    },
    // 早期加算 第2期：入院日から14日以内
    PHASE_2: {
      id: 'phase_2',
      maxDays: 14,     // 起算日を含めて14日目まで
      label: '早期加算（14日以内）',
      points: 25,      // 改定点数（25点）
    },
  },

  // ==========================================
  // 3. リハビリテーション総合計画評価料
  // ==========================================
  PLAN_EVALUATION: {
    // 算定周期目安（起算日または前回計画書作成日より30日）
    CYCLE_DAYS: 30,
    // 期限アラート表示（期限何日前に画面で注意喚起するか）
    ALERT_BEFORE_DAYS: 7,

    // 区分別点数
    TYPES: {
      PLAN_1_FIRST: {
        id: 'plan_1_first',
        label: '総合実施計画書1（初回）',
        points: 300,
      },
      PLAN_1_SUBSEQUENT: {
        id: 'plan_1_subsequent',
        label: '総合実施計画書1（2回目以降）',
        points: 240,
      },
      PLAN_2_FIRST: {
        id: 'plan_2_first',
        label: '総合実施計画書2（初回）',
        points: 240,
      },
      PLAN_2_SUBSEQUENT: {
        id: 'plan_2_subsequent',
        label: '総合実施計画書2（2回目以降）',
        points: 196,
      },
    },
  },

  // ==========================================
  // 4. セラピスト設定マスター
  //    現在は全員PT。将来OTや増員があればここに追加・変更
  // ==========================================
  THERAPISTS: {
    'A': {
      code: 'A',
      name: 'セラピストA',
      role: 'PT', // 'PT' または 'OT'
      description: 'リハ記録(A)担当',
    },
    'B': {
      code: 'B',
      name: 'セラピストB',
      role: 'PT',
      description: 'リハ記録(B)担当',
    },
    'C': {
      code: 'C',
      name: 'セラピストC',
      role: 'PT',
      description: 'リハ記録(C)担当',
    },
  },

  // ==========================================
  // 5. 受付提出用シート分類マッピング
  // ==========================================
  SHEET_CATEGORIES: {
    INPATIENT_1: {
      key: 'inpatient_1',
      sheetName: '実施ﾘｽﾄ 入院',
      type: '入院',
      defaultDisease: 'LOCOMOTIVE',
    },
    INPATIENT_2: {
      key: 'inpatient_2',
      sheetName: '入院(2)',
      type: '入院',
      defaultDisease: 'CEREBROVASCULAR',
    },
    INPATIENT_MAINTENANCE: {
      key: 'inpatient_maintenance',
      sheetName: '入院 （維持期介護)',
      type: '入院維持期',
      defaultDisease: 'LOCOMOTIVE',
    },
    OUTPATIENT_1: {
      key: 'outpatient_1',
      sheetName: '  外来',
      type: '外来',
      defaultDisease: 'LOCOMOTIVE',
    },
  },
};
