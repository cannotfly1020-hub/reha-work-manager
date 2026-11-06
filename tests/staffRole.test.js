/**
 * セラピスト職種判定（therapistRoleUtil.js）単体テスト
 * Node.js 標準: node:test / node:assert/strict のみ
 *
 * ★ therapist.role 最優先 → 氏名推測 → デフォルト PT
 * 実行: npm test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTherapistRole,
  buildDailyUnitsByRole,
  listRolesForExcelRows
} from '../js/core/therapistRoleUtil.js';

describe('getTherapistRole: role プロパティ最優先', () => {
  test('therapist.role === OT なら氏名が山田太郎でも OT', () => {
    const master = [{ id: 'A', name: '山田太郎', role: 'OT' }];
    assert.equal(getTherapistRole('A', '山田太郎', master), 'OT');
  });

  test('therapist.role === ST を尊重', () => {
    const master = [{ id: 'B', name: '田中', role: 'ST' }];
    assert.equal(getTherapistRole('B', '田中', master), 'ST');
  });

  test('therapist.role === PT を尊重（氏名にOTがあっても role 優先）', () => {
    const master = [{ id: 'C', name: '鈴木(OT)', role: 'PT' }];
    assert.equal(getTherapistRole('C', '鈴木(OT)', master), 'PT');
  });
});

describe('getTherapistRole: 氏名フォールバック（既存互換）', () => {
  test('role 未指定で氏名が鈴木(OT)なら OT', () => {
    const master = [{ id: 'A', name: '鈴木(OT)' }];
    assert.equal(getTherapistRole('A', '鈴木(OT)', master), 'OT');
  });

  test('role 未指定で氏名が佐藤ならデフォルト PT', () => {
    const master = [{ id: 'A', name: '佐藤' }];
    assert.equal(getTherapistRole('A', '佐藤', master), 'PT');
  });

  test('マスター空でも氏名テキストから OT を推測', () => {
    assert.equal(getTherapistRole('X', '作業療法 花子', []), 'OT');
  });

  test('マスター空・手がかりなしは PT', () => {
    assert.equal(getTherapistRole('Z', '匿名', []), 'PT');
  });
});

describe('buildDailyUnitsByRole / listRolesForExcelRows', () => {
  test('role=OT のマスターに紐づくスロットは OT 行へ集計', () => {
    const master = [
      { id: 'A', name: '山田', role: 'PT' },
      { id: 'B', name: '佐藤', role: 'OT' }
    ];
    const slots = [
      { date: '2026-11-01', therapistId: 'A', units: 2 },
      { date: '2026-11-01', therapistId: 'B', units: 3 },
      { date: '2026-11-02', therapistId: 'B', units: 1 }
    ];
    const { totalsByRole, hasRole } = buildDailyUnitsByRole(slots, 30, master);
    assert.equal(totalsByRole.PT, 2);
    assert.equal(totalsByRole.OT, 4);
    assert.equal(hasRole.OT, true);
    assert.deepEqual(listRolesForExcelRows(totalsByRole), ['PT', 'OT']);
  });
});
