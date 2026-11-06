/**
 * 診療報酬計算コア（deadlineCalc.js）境界値単体テスト
 * Node.js 標準: node:test / node:assert/strict のみ（外部テストFWなし）
 *
 * 実行: npm test
 *
 * ※ getEarlyRehaBonusPoints は本番未 export のため、evaluateEarlyBonusPhase.points を
 *    テスト内ヘルパーで同等検証する（本番コードは変更しない）。
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePatientDeadlines,
  evaluateRecommendedPlan,
  evaluateEarlyBonusPhase,
  addDays,
  getInclusiveDayCount
} from '../js/core/deadlineCalc.js';
import { REHA_RULES } from '../js/config/rules.js';

/** @param {string|Date} start @param {string|Date} session @param {string} [category] */
function getEarlyRehaBonusPoints(start, session, category = 'INPATIENT') {
  return evaluateEarlyBonusPhase(start, session, category).points;
}

function basePatient(overrides = {}) {
  return {
    id: 'T001',
    name: 'テスト患者',
    category: 'INPATIENT',
    diseaseType: 'LOCOMOTIVE',
    careInsuranceType: 'CARE',
    onsetDate: '2026-04-01',
    admissionDate: '2026-04-01',
    planStatus: 'NOT_YET',
    ...overrides
  };
}

// ─── ルール正本の前提（テストがコード定数と同期していること） ───
describe('REHA_RULES 正本前提', () => {
  test('疾患別標準日数: 運動器150 / 脳血管180 / 廃用120（口頭180ではない）', () => {
    assert.equal(REHA_RULES.LIMIT_DAYS.LOCOMOTIVE.days, 150);
    assert.equal(REHA_RULES.LIMIT_DAYS.CEREBROVASCULAR.days, 180);
    assert.equal(REHA_RULES.LIMIT_DAYS.DISUSE.days, 120);
  });

  test('1/3日数: 運動器50 / 脳血管60 / 廃用40', () => {
    assert.equal(REHA_RULES.LIMIT_DAYS.LOCOMOTIVE.oneThirdDays, 50);
    assert.equal(REHA_RULES.LIMIT_DAYS.CEREBROVASCULAR.oneThirdDays, 60);
    assert.equal(REHA_RULES.LIMIT_DAYS.DISUSE.oneThirdDays, 40);
  });

  test('早期加算: PHASE_1=60点・3日 / PHASE_2=25点・14日', () => {
    assert.equal(REHA_RULES.EARLY_BONUS.PHASE_1.points, 60);
    assert.equal(REHA_RULES.EARLY_BONUS.PHASE_1.maxDays, 3);
    assert.equal(REHA_RULES.EARLY_BONUS.PHASE_2.points, 25);
    assert.equal(REHA_RULES.EARLY_BONUS.PHASE_2.maxDays, 14);
  });

  test('計画書点数: Ⅰ初300 / Ⅰ継240 / Ⅱ初240 / Ⅱ継196', () => {
    assert.equal(REHA_RULES.PLAN_POINTS.PLAN_1_FIRST, 300);
    assert.equal(REHA_RULES.PLAN_POINTS.PLAN_1_FOLLOW, 240);
    assert.equal(REHA_RULES.PLAN_POINTS.PLAN_2_FIRST, 240);
    assert.equal(REHA_RULES.PLAN_POINTS.PLAN_2_FOLLOW, 196);
  });
});

// ─── 1. 疾患別標準日数と満了日境界 ───
describe('calculatePatientDeadlines: 標準日数・満了日境界', () => {
  const onset = '2026-04-01';

  test('運動器: 起算日当日（暦差0・初日算入1日目）は超過 false', () => {
    const p = basePatient({ diseaseType: 'LOCOMOTIVE', onsetDate: onset });
    const d = calculatePatientDeadlines(p, onset);
    assert.equal(d.standardDays, 150);
    assert.equal(d.elapsedDays, 1);
    assert.equal(d.isLimitExceeded, false);
    assert.equal(d.limitDateStr, addDays(onset, 149));
  });

  test('運動器: 満了日（起算+149日＝通算150日目）は超過 false', () => {
    const p = basePatient({ diseaseType: 'LOCOMOTIVE', onsetDate: onset });
    const limitDay = addDays(onset, 149);
    const d = calculatePatientDeadlines(p, limitDay);
    assert.equal(d.limitDateStr, limitDay);
    assert.equal(d.elapsedDays, 150);
    assert.equal(d.isLimitExceeded, false);
  });

  test('運動器: 満了日翌日（起算+150日＝通算151日目）は超過 true', () => {
    const p = basePatient({ diseaseType: 'LOCOMOTIVE', onsetDate: onset });
    const nextDay = addDays(onset, 150);
    const d = calculatePatientDeadlines(p, nextDay);
    assert.equal(d.elapsedDays, 151);
    assert.equal(d.isLimitExceeded, true);
  });

  test('脳血管: 満了日（起算+179日）は超過 false', () => {
    const p = basePatient({ diseaseType: 'CEREBROVASCULAR', onsetDate: onset });
    const limitDay = addDays(onset, 179);
    const d = calculatePatientDeadlines(p, limitDay);
    assert.equal(d.standardDays, 180);
    assert.equal(d.limitDateStr, limitDay);
    assert.equal(d.elapsedDays, 180);
    assert.equal(d.isLimitExceeded, false);
  });

  test('脳血管: 満了日翌日（起算+180日）は超過 true', () => {
    const p = basePatient({ diseaseType: 'CEREBROVASCULAR', onsetDate: onset });
    const d = calculatePatientDeadlines(p, addDays(onset, 180));
    assert.equal(d.elapsedDays, 181);
    assert.equal(d.isLimitExceeded, true);
  });

  test('廃用: 実装正本120日 — 満了日（起算+119日）は超過 false', () => {
    const p = basePatient({ diseaseType: 'DISUSE', onsetDate: onset });
    const limitDay = addDays(onset, 119);
    const d = calculatePatientDeadlines(p, limitDay);
    assert.equal(d.standardDays, 120);
    assert.notEqual(d.standardDays, 180);
    assert.equal(d.limitDateStr, limitDay);
    assert.equal(d.elapsedDays, 120);
    assert.equal(d.isLimitExceeded, false);
  });

  test('廃用: 満了日翌日（起算+120日）は超過 true（180日ではない）', () => {
    const p = basePatient({ diseaseType: 'DISUSE', onsetDate: onset });
    const d = calculatePatientDeadlines(p, addDays(onset, 120));
    assert.equal(d.isLimitExceeded, true);
    // もし誤って180日実装なら、+120日時点ではまだ超過しない
    assert.equal(getInclusiveDayCount(onset, addDays(onset, 120)), 121);
  });
});

// ─── 2. 計画2移行日（1/3）境界 ───
describe('calculatePatientDeadlines: 計画2移行日（1/3）境界', () => {
  const onset = '2026-04-01';

  test('運動器: +49日は未到達 / +50日は isPlan2Required true', () => {
    const p = basePatient({ diseaseType: 'LOCOMOTIVE', careInsuranceType: 'CARE', onsetDate: onset });
    const before = calculatePatientDeadlines(p, addDays(onset, 49));
    const on = calculatePatientDeadlines(p, addDays(onset, 50));
    assert.equal(before.plan2TransitionDateStr, addDays(onset, 50));
    assert.equal(before.isPlan2Required, false);
    assert.equal(on.isPlan2Required, true);
  });

  test('脳血管: +59日は未到達 / +60日は到達', () => {
    const p = basePatient({ diseaseType: 'CEREBROVASCULAR', careInsuranceType: 'CARE', onsetDate: onset });
    assert.equal(calculatePatientDeadlines(p, addDays(onset, 59)).isPlan2Required, false);
    assert.equal(calculatePatientDeadlines(p, addDays(onset, 60)).isPlan2Required, true);
    assert.equal(calculatePatientDeadlines(p, addDays(onset, 60)).plan2TransitionDateStr, addDays(onset, 60));
  });

  test('廃用: +39日は未到達 / +40日は到達', () => {
    const p = basePatient({ diseaseType: 'DISUSE', careInsuranceType: 'CARE', onsetDate: onset });
    assert.equal(calculatePatientDeadlines(p, addDays(onset, 39)).isPlan2Required, false);
    assert.equal(calculatePatientDeadlines(p, addDays(onset, 40)).isPlan2Required, true);
  });

  test('要支援では plan2Transition が空・isPlan2Required false（1/3到達相当日でも）', () => {
    const p = basePatient({
      diseaseType: 'LOCOMOTIVE',
      careInsuranceType: 'SUPPORT',
      onsetDate: onset
    });
    const d = calculatePatientDeadlines(p, addDays(onset, 50));
    assert.equal(d.plan2TransitionDateStr, '');
    assert.equal(d.isPlan2Required, false);
  });
});

// ─── 3. 要支援は計画2除外・計画1固定 ───
describe('evaluateRecommendedPlan: 要支援 SUPPORT は計画1固定', () => {
  const onset = '2026-01-01';
  const daysList = [50, 60, 100];

  for (const dayOffset of daysList) {
    test(`SUPPORT 起算+${dayOffset}日・算定歴なし → PLAN_1_FIRST (300)`, () => {
      const p = basePatient({
        careInsuranceType: 'SUPPORT',
        diseaseType: 'LOCOMOTIVE',
        onsetDate: onset,
        planStatus: 'NOT_YET'
      });
      const r = evaluateRecommendedPlan(p, addDays(onset, dayOffset), false);
      assert.equal(r.recommendedPlan, 'PLAN_1_FIRST');
      assert.equal(r.points, 300);
      assert.ok(!String(r.recommendedPlan).startsWith('PLAN_2'));
    });

    test(`SUPPORT 起算+${dayOffset}日・算定歴あり → PLAN_1_FOLLOW (240)`, () => {
      const p = basePatient({
        careInsuranceType: 'SUPPORT',
        diseaseType: 'CEREBROVASCULAR',
        onsetDate: onset,
        planStatus: 'NOT_YET'
      });
      const r = evaluateRecommendedPlan(p, addDays(onset, dayOffset), true);
      assert.equal(r.recommendedPlan, 'PLAN_1_FOLLOW');
      assert.equal(r.points, 240);
      assert.ok(!String(r.recommendedPlan).startsWith('PLAN_2'));
    });
  }
});

// ─── 4. 要介護 CARE の計画2昇格 ───
describe('evaluateRecommendedPlan: 要介護 CARE 計画2昇格', () => {
  const onset = '2026-04-01';

  test('1/3未到達・算定歴なし → PLAN_1_FIRST', () => {
    const p = basePatient({ careInsuranceType: 'CARE', onsetDate: onset, planStatus: 'NOT_YET' });
    const r = evaluateRecommendedPlan(p, addDays(onset, 10), false);
    assert.equal(r.recommendedPlan, 'PLAN_1_FIRST');
    assert.equal(r.points, 300);
  });

  test('1/3未到達・算定歴あり → PLAN_1_FOLLOW', () => {
    const p = basePatient({ careInsuranceType: 'CARE', onsetDate: onset, planStatus: 'NOT_YET' });
    const r = evaluateRecommendedPlan(p, addDays(onset, 10), true);
    assert.equal(r.recommendedPlan, 'PLAN_1_FOLLOW');
    assert.equal(r.points, 240);
  });

  test('1/3到達後・算定歴なし → PLAN_2_FIRST', () => {
    const p = basePatient({ careInsuranceType: 'CARE', onsetDate: onset, planStatus: 'NOT_YET' });
    const r = evaluateRecommendedPlan(p, addDays(onset, 50), false);
    assert.equal(r.recommendedPlan, 'PLAN_2_FIRST');
    assert.equal(r.points, 240);
  });

  test('1/3到達後・算定歴あり → PLAN_2_FOLLOW', () => {
    const p = basePatient({ careInsuranceType: 'CARE', onsetDate: onset, planStatus: 'NOT_YET' });
    const r = evaluateRecommendedPlan(p, addDays(onset, 50), true);
    assert.equal(r.recommendedPlan, 'PLAN_2_FOLLOW');
    assert.equal(r.points, 196);
  });

  test('台帳 PLAN_2_FOLLOW 固定は期日前（+10日）でも尊重', () => {
    const p = basePatient({
      careInsuranceType: 'CARE',
      onsetDate: onset,
      planStatus: 'PLAN_2_FOLLOW'
    });
    const r = evaluateRecommendedPlan(p, addDays(onset, 10), false);
    assert.equal(r.recommendedPlan, 'PLAN_2_FOLLOW');
    assert.equal(r.points, 196);
  });

  test('脳血管: +60日到達で PLAN_2_FIRST', () => {
    const p = basePatient({
      diseaseType: 'CEREBROVASCULAR',
      careInsuranceType: 'CARE',
      onsetDate: onset,
      planStatus: 'NOT_YET'
    });
    assert.equal(
      evaluateRecommendedPlan(p, addDays(onset, 59), false).recommendedPlan,
      'PLAN_1_FIRST'
    );
    assert.equal(
      evaluateRecommendedPlan(p, addDays(onset, 60), false).recommendedPlan,
      'PLAN_2_FIRST'
    );
  });

  test('廃用: +40日到達で PLAN_2_FOLLOW（歴あり）', () => {
    const p = basePatient({
      diseaseType: 'DISUSE',
      careInsuranceType: 'CARE',
      onsetDate: onset,
      planStatus: 'PLAN_1_FOLLOW'
    });
    assert.equal(
      evaluateRecommendedPlan(p, addDays(onset, 39), false).recommendedPlan,
      'PLAN_1_FOLLOW'
    );
    assert.equal(
      evaluateRecommendedPlan(p, addDays(onset, 40), false).recommendedPlan,
      'PLAN_2_FOLLOW'
    );
  });
});

// ─── 5. 入院早期加算境界 ───
describe('getEarlyRehaBonusPoints / evaluateEarlyBonusPhase 境界', () => {
  const start = '2026-06-01';

  test('入院 通算1日目: 60点 (PHASE_1)', () => {
    assert.equal(getEarlyRehaBonusPoints(start, start, 'INPATIENT'), 60);
    assert.equal(evaluateEarlyBonusPhase(start, start, 'INPATIENT').phase, 'PHASE_1');
  });

  test('入院 通算2日目: 60点', () => {
    assert.equal(getEarlyRehaBonusPoints(start, addDays(start, 1), 'INPATIENT'), 60);
  });

  test('入院 通算3日目: 60点（PHASE_1終端）', () => {
    assert.equal(getEarlyRehaBonusPoints(start, addDays(start, 2), 'INPATIENT'), 60);
    assert.equal(evaluateEarlyBonusPhase(start, addDays(start, 2), 'INPATIENT').phase, 'PHASE_1');
  });

  test('入院 通算4日目: 25点（PHASE_2切替境目）', () => {
    assert.equal(getEarlyRehaBonusPoints(start, addDays(start, 3), 'INPATIENT'), 25);
    assert.equal(evaluateEarlyBonusPhase(start, addDays(start, 3), 'INPATIENT').phase, 'PHASE_2');
  });

  test('入院 通算14日目: 25点（PHASE_2終端）', () => {
    assert.equal(getEarlyRehaBonusPoints(start, addDays(start, 13), 'INPATIENT'), 25);
    assert.equal(evaluateEarlyBonusPhase(start, addDays(start, 13), 'INPATIENT').phase, 'PHASE_2');
  });

  test('入院 通算15日目: 0点（加算終了境目）', () => {
    assert.equal(getEarlyRehaBonusPoints(start, addDays(start, 14), 'INPATIENT'), 0);
    assert.equal(evaluateEarlyBonusPhase(start, addDays(start, 14), 'INPATIENT').phase, null);
  });

  test('外来 OUTPATIENT は通算1日目でも常に0点', () => {
    assert.equal(getEarlyRehaBonusPoints(start, start, 'OUTPATIENT'), 0);
    assert.equal(evaluateEarlyBonusPhase(start, start, 'OUTPATIENT').isEligible, false);
  });
});

// ─── 6. うるう年・月末跨ぎ ───
describe('日付加算: うるう年・平年・月末跨ぎ', () => {
  test('2024-02-01起算（うるう年）: +28日=02-29 / +29日=03-01', () => {
    assert.equal(addDays('2024-02-01', 28), '2024-02-29');
    assert.equal(addDays('2024-02-01', 29), '2024-03-01');
    const p = basePatient({ diseaseType: 'DISUSE', onsetDate: '2024-02-01', careInsuranceType: 'CARE' });
    // 廃用120日満了 = +119 → 2024-05-30
    assert.equal(calculatePatientDeadlines(p, '2024-02-01').limitDateStr, addDays('2024-02-01', 119));
    assert.equal(addDays('2024-02-01', 119), '2024-05-30');
  });

  test('2026-02-01起算（平年）: +28日=03-01（2/29なし）', () => {
    assert.equal(addDays('2026-02-01', 27), '2026-02-28');
    assert.equal(addDays('2026-02-01', 28), '2026-03-01');
  });

  test('31日月末跨ぎ: 2026-01-31 +1 = 2026-02-01', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  });

  test('30日月末跨ぎ: 2026-04-30 +1 = 2026-05-01', () => {
    assert.equal(addDays('2026-04-30', 1), '2026-05-01');
  });

  test('運動器150日がうるう年を跨いでも満了日が安定', () => {
    const onset = '2024-01-15';
    const p = basePatient({ diseaseType: 'LOCOMOTIVE', onsetDate: onset });
    const limit = calculatePatientDeadlines(p, onset).limitDateStr;
    assert.equal(limit, addDays(onset, 149));
    assert.equal(calculatePatientDeadlines(p, limit).isLimitExceeded, false);
    assert.equal(calculatePatientDeadlines(p, addDays(limit, 1)).isLimitExceeded, true);
  });

  test('包括日数: 同日=1、翌日=2（初日算入）', () => {
    assert.equal(getInclusiveDayCount('2026-03-01', '2026-03-01'), 1);
    assert.equal(getInclusiveDayCount('2026-03-01', '2026-03-02'), 2);
  });
});

// ─── 追加境界（合計約50パターン到達） ───
describe('追加境界・退行防止', () => {
  const onset = '2026-04-01';

  test('消炎 ANALGESIA: evaluateRecommendedPlan は空（算定なし）', () => {
    const p = basePatient({ diseaseType: 'ANALGESIA', onsetDate: onset });
    const r = evaluateRecommendedPlan(p, onset, false);
    assert.equal(r.recommendedPlan, '');
    assert.equal(r.points, 0);
  });

  test('医療のみ NONE: 1/3相当日でも PLAN_1_FIRST（計画2なし）', () => {
    const p = basePatient({
      careInsuranceType: 'NONE',
      onsetDate: onset,
      planStatus: 'NOT_YET'
    });
    const r = evaluateRecommendedPlan(p, addDays(onset, 50), false);
    assert.equal(r.recommendedPlan, 'PLAN_1_FIRST');
    assert.ok(!String(r.recommendedPlan).startsWith('PLAN_2'));
  });

  test('医療のみ NONE: calculatePatientDeadlines で isPlan2Required false', () => {
    const p = basePatient({ careInsuranceType: 'NONE', onsetDate: onset });
    assert.equal(calculatePatientDeadlines(p, addDays(onset, 50)).isPlan2Required, false);
  });

  test('CARE + 台帳 PLAN_1_FOLLOW + 1/3到達 → PLAN_2_FOLLOW 自動昇格', () => {
    const p = basePatient({
      careInsuranceType: 'CARE',
      onsetDate: onset,
      planStatus: 'PLAN_1_FOLLOW'
    });
    const r = evaluateRecommendedPlan(p, addDays(onset, 50), false);
    assert.equal(r.recommendedPlan, 'PLAN_2_FOLLOW');
    assert.equal(r.points, 196);
  });

  test('運動器: 満了日ちょうどは isLimitExceeded false、翌日 true（再確認）', () => {
    const p = basePatient({ diseaseType: 'LOCOMOTIVE', onsetDate: '2025-01-01' });
    const limit = addDays('2025-01-01', 149);
    assert.equal(calculatePatientDeadlines(p, limit).isLimitExceeded, false);
    assert.equal(calculatePatientDeadlines(p, addDays(limit, 1)).isLimitExceeded, true);
  });

  test('早期加算: 通算7日目は PHASE_2・25点', () => {
    const start = '2026-07-01';
    const day7 = addDays(start, 6);
    assert.equal(getEarlyRehaBonusPoints(start, day7, 'INPATIENT'), 25);
    assert.equal(evaluateEarlyBonusPhase(start, day7, 'INPATIENT').phase, 'PHASE_2');
  });

  test('SUPPORT + planStatus PLAN_1_FOLLOW → 常に PLAN_1_FOLLOW（歴フラグ不要）', () => {
    const p = basePatient({
      careInsuranceType: 'SUPPORT',
      onsetDate: onset,
      planStatus: 'PLAN_1_FOLLOW'
    });
    const r = evaluateRecommendedPlan(p, addDays(onset, 100), false);
    assert.equal(r.recommendedPlan, 'PLAN_1_FOLLOW');
  });

  test('うるう年: 2024-02-29 起算の翌日は 2024-03-01', () => {
    assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  });

  test('脳血管180: 起算当日は超過 false・remainingDays 179', () => {
    const p = basePatient({ diseaseType: 'CEREBROVASCULAR', onsetDate: onset });
    const d = calculatePatientDeadlines(p, onset);
    assert.equal(d.isLimitExceeded, false);
    assert.equal(d.remainingDays, 179);
  });
});
