/**
 * 時間割バリデーションエンジン（validator.js）単体テスト
 * Node.js 標準: node:test / node:assert/strict のみ（外部FWなし）
 *
 * ★本番コード（js/ 以下）は一切変更しない。
 * ★実装正本に忠実: validateDailyLimit = 患者1日上限(6/9)。
 *   セラピスト日24の厳格ブロックは現行 validator では撤廃済み
 *   （validateTherapistWorkload は週108超過時 WARN のみ・配置許可）。
 *
 * 実行: npm test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOccupiedSlotIds,
  validateTimeConflict,
  validateDailyLimit,
  validateMonthlyPlanLimit,
  validateTherapistWorkload,
  validateMonthly13Limit
} from '../js/core/validator.js';
import { REHA_RULES, TIME_SLOTS } from '../js/config/rules.js';
import { listTherapistIdsFromSchedule } from '../js/store/scheduleStore.js';

assert.ok(TIME_SLOTS.length >= 4, 'TIME_SLOTS が初期化されていること');

const S1 = TIME_SLOTS[0].id; // am_1
const S2 = TIME_SLOTS[1].id; // am_2
const S3 = TIME_SLOTS[2].id; // am_3
const S5 = TIME_SLOTS[4].id; // am_5

function patientSlot(patientId, units = 1, extra = {}) {
  return { itemType: 'PATIENT', patientId, units, ...extra };
}

function taskSlot(units = 1) {
  return { itemType: 'TASK', units, slotsCount: units, note: '会議' };
}

// ═══════════════════════════════════════════════════════════
// 前提・占有スロット
// ═══════════════════════════════════════════════════════════
describe('validator 前提 / getOccupiedSlotIds', () => {
  test('LIMITS: 患者標準6 / 急性期9 / セラピスト日24定数 / 週108', () => {
    assert.equal(REHA_RULES.LIMITS.DAILY_STANDARD, 6);
    assert.equal(REHA_RULES.LIMITS.DAILY_ACUTE_MAX, 9);
    assert.equal(REHA_RULES.LIMITS.THERAPIST_DAILY_MAX, 24);
    assert.equal(REHA_RULES.LIMITS.THERAPIST_WEEKLY_MAX, 108);
  });

  test('getOccupiedSlotIds: 2単位は開始コマ＋次コマを占有', () => {
    assert.deepEqual(getOccupiedSlotIds(S1, 2), [S1, S2]);
    assert.deepEqual(getOccupiedSlotIds(S1, 1), [S1]);
  });
});

// ═══════════════════════════════════════════════════════════
// 1. validateTimeConflict
// ═══════════════════════════════════════════════════════════
describe('validateTimeConflict: 時間重複チェック', () => {
  test('同一患者が同時間帯に他セラピストへ重複配置 → valid: false', () => {
    const schedule = {
      A: { [S1]: patientSlot('P001', 1) },
      B: {},
      analgesia: { [S1]: ['P999'] },
      dialysis: { [S1]: ['P888'] }
    };
    const r = validateTimeConflict(schedule, 'B', S1, 'P001', 1);
    assert.equal(r.valid, false);
    assert.match(r.message, /二重登録防止|すでに該当患者/);
  });

  test('複数単位の占有枠内への重複も検知（Aがam_1×2単位、Bがam_2へ同患者）', () => {
    const schedule = {
      A: { [S1]: patientSlot('P001', 2) },
      B: {}
    };
    const r = validateTimeConflict(schedule, 'B', S2, 'P001', 1);
    assert.equal(r.valid, false);
  });

  test('同一患者でも異なる時間帯 → valid: true', () => {
    const schedule = {
      A: { [S1]: patientSlot('P001', 1) },
      B: {}
    };
    const r = validateTimeConflict(schedule, 'B', S5, 'P001', 1);
    assert.equal(r.valid, true);
  });

  test('自分自身の同一コマ更新（exclude）→ valid: true', () => {
    const schedule = {
      A: { [S1]: patientSlot('P001', 2) },
      B: {}
    };
    const r = validateTimeConflict(schedule, 'A', S1, 'P001', 2, S1, 'A');
    assert.equal(r.valid, true);
  });

  test('担当変更時: 元コマを excludeTherapistId+excludeSlotId で除外し通過', () => {
    const schedule = {
      A: { [S1]: patientSlot('P001', 1) },
      B: {}
    };
    // A→B へ同スロット移動（元A/S1を除外）
    const r = validateTimeConflict(schedule, 'B', S1, 'P001', 1, S1, 'A');
    assert.equal(r.valid, true);
  });

  test('業務ブロック（TASK等・patientIdなし）同士は重複エラーにならない', () => {
    const schedule = {
      A: { [S1]: taskSlot(1) },
      B: { [S1]: taskSlot(1) }
    };
    // patientId 空 → 早期 return true
    const rEmpty = validateTimeConflict(schedule, 'A', S1, '', 1);
    assert.equal(rEmpty.valid, true);

    // 患者配置先に TASK しかない時間帯でも、patientId 衝突判定はスキップされる
    const rPatient = validateTimeConflict(schedule, 'C', S1, 'P100', 1);
    assert.equal(rPatient.valid, true);
  });

  test('同セラピストの別予定と時間重複 → valid: false', () => {
    const schedule = {
      A: { [S1]: patientSlot('P002', 1) }
    };
    const r = validateTimeConflict(schedule, 'A', S1, 'P001', 1);
    assert.equal(r.valid, false);
    assert.match(r.message, /同時間帯|既に別の予定/);
  });
});

// ═══════════════════════════════════════════════════════════
// 2. 患者1日上限 = validateDailyLimit（実装正本）
//    ※プロンプトの「24単位」はセラピスト定数。現行日次厳格ブロックは患者6/9。
// ═══════════════════════════════════════════════════════════
describe('validateDailyLimit: 患者1日上限（標準6 / 急性期9）', () => {
  test('標準: 既存4 + 新規2 = 6 → valid: true', () => {
    const patient = { id: 'P001', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-01-01' };
    const schedule = {
      A: { [S1]: patientSlot('P001', 2), [S3]: patientSlot('P001', 2) },
      B: {},
      analgesia: {},
      dialysis: {}
    };
    const r = validateDailyLimit(schedule, patient, '2026-06-01', 2, 0);
    assert.equal(r.valid, true);
  });

  test('標準: 既存5 + 新規2 = 7 → valid: false（6単位超過）', () => {
    const patient = { id: 'P001', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-01-01' };
    const schedule = {
      A: { [S1]: patientSlot('P001', 3), [S3]: patientSlot('P001', 2) }
    };
    const r = validateDailyLimit(schedule, patient, '2026-06-01', 2, 0);
    assert.equal(r.valid, false);
    assert.match(r.message, /患者1日上限|最大6単位/);
  });

  test('同一コマ更新時は currentSlotUnits を差し引き二重加算しない', () => {
    const patient = { id: 'P001', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-01-01' };
    // 既存合計6（うち当該コマ3）。3→3の再保存は next=6-3+3=6 で通過
    const schedule = {
      A: {
        [S1]: patientSlot('P001', 3),
        [S5]: patientSlot('P001', 3)
      }
    };
    const ok = validateDailyLimit(schedule, patient, '2026-06-01', 3, 3);
    assert.equal(ok.valid, true);

    // 3→4 は next=6-3+4=7 で超過
    const ng = validateDailyLimit(schedule, patient, '2026-06-01', 4, 3);
    assert.equal(ng.valid, false);
  });

  test('急性期（脳血管・発症14日未満）: 8+1=9 通過 / 8+2=10 超過', () => {
    const patient = {
      id: 'P002',
      diseaseType: 'CEREBROVASCULAR',
      onsetDate: '2026-11-01',
      admissionDate: '2026-11-01'
    };
    const schedule = {
      A: { [S1]: patientSlot('P002', 4), [S5]: patientSlot('P002', 4) }
    };
    const day = '2026-11-05'; // 起算から4日差 → 14日未満
    assert.equal(validateDailyLimit(schedule, patient, day, 1, 0).valid, true);
    const over = validateDailyLimit(schedule, patient, day, 2, 0);
    assert.equal(over.valid, false);
    assert.match(over.message, /最大9単位/);
  });

  test('消炎・透析レーンの単位は患者日合計に混入しない', () => {
    const patient = { id: 'P001', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-01-01' };
    const schedule = {
      A: { [S1]: patientSlot('P001', 6) },
      analgesia: { [S1]: ['P001'] },
      dialysis: { [S1]: ['P001'] }
    };
    // セラピスト列のみ合計6。追加1は超過
    const r = validateDailyLimit(schedule, patient, '2026-06-01', 1, 0);
    assert.equal(r.valid, false);
    // 再保存 6→6（差し引き6）は通過
    assert.equal(validateDailyLimit(schedule, patient, '2026-06-01', 6, 6).valid, true);
  });
});

// ═══════════════════════════════════════════════════════════
// セラピスト負荷（週108 WARN）※日24は現行コードでブロックしない
// ═══════════════════════════════════════════════════════════
describe('validateTherapistWorkload: 週108超過は WARN（配置は許可）', () => {
  test('週累計 107+1=108 → OK', () => {
    const r = validateTherapistWorkload({}, 'A', 1, 0, 107);
    assert.equal(r.valid, true);
    assert.equal(r.level, 'OK');
  });

  test('週累計 107+2=109 → valid:true / level:WARN / 108単位を含む', () => {
    const r = validateTherapistWorkload({}, 'A', 2, 0, 107);
    assert.equal(r.valid, true);
    assert.equal(r.level, 'WARN');
    assert.match(r.message, /108/);
  });

  test('差し引き再計算: weekly 108・当該コマ2を2のまま再保存 → OK', () => {
    const r = validateTherapistWorkload({}, 'B', 2, 2, 108);
    assert.equal(r.valid, true);
    assert.equal(r.level, 'OK');
  });

  test('ルール上 THERAPIST_DAILY_MAX=24 だが日次厳格ブロック関数は週WARNのみ', () => {
    // 日次24超相当の newUnits でも valid は true（現行仕様）
    const r = validateTherapistWorkload({}, 'A', 25, 0, 0);
    assert.equal(r.valid, true);
    assert.equal(REHA_RULES.LIMITS.THERAPIST_DAILY_MAX, 24);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. validateMonthlyPlanLimit
// ═══════════════════════════════════════════════════════════
describe('validateMonthlyPlanLimit: 総合計画評価料 同月重複', () => {
  test('当月別日に算定済み → 再算定は valid: false', () => {
    const r = validateMonthlyPlanLimit(true, '2026-11-03');
    assert.equal(r.valid, false);
    assert.match(r.message, /月1回|2026-11-03/);
  });

  test('計画書コード文字列（PLAN_1_FIRST 等）も truthy として検査対象', () => {
    const r = validateMonthlyPlanLimit('PLAN_2_FOLLOW', '2026-11-10');
    assert.equal(r.valid, false);
  });

  test('当月未算定（existingPlanDate null）→ valid: true', () => {
    assert.equal(validateMonthlyPlanLimit(true, null).valid, true);
    assert.equal(validateMonthlyPlanLimit('PLAN_1_FIRST', null).valid, true);
    assert.equal(validateMonthlyPlanLimit('PLAN_1_FIRST', '').valid, true);
  });

  test('計画書なし（falsy）なら既存算定日があっても通過', () => {
    assert.equal(validateMonthlyPlanLimit(false, '2026-11-03').valid, true);
    assert.equal(validateMonthlyPlanLimit('', '2026-11-03').valid, true);
    assert.equal(validateMonthlyPlanLimit(null, '2026-11-03').valid, true);
  });
});

// ═══════════════════════════════════════════════════════════
// 4. 並行レーン除外
// ═══════════════════════════════════════════════════════════
describe('並行レーン（analgesia / dialysis）の除外ガード', () => {
  test('listTherapistIdsFromSchedule は analgesia / dialysis を除外', () => {
    const ids = listTherapistIdsFromSchedule({
      A: {},
      B: {},
      C: {},
      D: {},
      analgesia: { [S1]: ['P1'] },
      dialysis: { [S1]: ['P2'] }
    });
    assert.deepEqual(ids.sort(), ['A', 'B', 'C', 'D']);
    assert.ok(!ids.includes('analgesia'));
    assert.ok(!ids.includes('dialysis'));
  });

  test('validateTimeConflict も analgesia/dialysis キーをセラピストとして走査しない', () => {
    // dialysis に同患者がいても、セラピスト列でなければ衝突しない
    const schedule = {
      A: {},
      analgesia: { [S1]: ['P001'] },
      dialysis: { [S1]: ['P001'] }
    };
    const r = validateTimeConflict(schedule, 'A', S1, 'P001', 1);
    assert.equal(r.valid, true);
  });
});

// ═══════════════════════════════════════════════════════════
// 月13単位（補助）
// ═══════════════════════════════════════════════════════════
describe('validateMonthly13Limit（補助防護）', () => {
  test('制限対象外なら大量単位でも通過', () => {
    const p = { id: 'P1', force13Limit: false };
    assert.equal(validateMonthly13Limit(20, p, false, 5, 0).valid, true);
  });

  test('超過対象で 12+2=14 → false / 差し引きで 12-2+2=12 → true', () => {
    const p = { id: 'P1', force13Limit: true };
    assert.equal(validateMonthly13Limit(12, p, true, 2, 0).valid, false);
    assert.equal(validateMonthly13Limit(12, p, true, 2, 2).valid, true);
  });
});
