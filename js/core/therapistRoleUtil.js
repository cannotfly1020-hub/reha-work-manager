// js/core/therapistRoleUtil.js
// セラピスト職種（PT / OT / ST）判定・日別単位の職種別集計（印刷・Excel共通）

/**
 * @typedef {'PT'|'OT'|'ST'} TherapistRole
 */

/**
 * セラピスト職種を判定する（マスター優先、ID・氏名からフォールバック）
 * @param {string} [therapistId]
 * @param {string} [therapistName]
 * @param {Array<{id?: string, name?: string, role?: string}>} [therapistsMaster]
 * @returns {TherapistRole}
 */
export function getTherapistRole(therapistId, therapistName, therapistsMaster = []) {
  if (Array.isArray(therapistsMaster) && therapistsMaster.length > 0) {
    const t = therapistsMaster.find(
      (item) => item
        && (String(item.id || '') === String(therapistId || '')
          || (therapistName && String(item.name || '') === String(therapistName)))
    );
    if (t && t.role) {
      const r = String(t.role).toUpperCase();
      if (r.includes('PT') || r.includes('理学')) return 'PT';
      if (r.includes('OT') || r.includes('作業')) return 'OT';
      if (r.includes('ST') || r.includes('言語')) return 'ST';
    }
    // role 未設定時はマスター氏名からも判定
    if (t && t.name) {
      const fromName = inferRoleFromText(t.name);
      if (fromName) return fromName;
    }
  }

  const fromCombined = inferRoleFromText(`${therapistId || ''} ${therapistName || ''}`);
  if (fromCombined) return fromCombined;

  return 'PT'; // デフォルトフォールバック（未判定は理学療法）
}

/**
 * 文字列から職種を推定（見つからなければ null）
 * @param {string} text
 * @returns {TherapistRole|null}
 */
function inferRoleFromText(text) {
  const combined = String(text || '').toUpperCase();
  if (!combined.trim()) return null;
  // OT/ST を先に判定（「PTOT」等の誤爆を避けるため単語境界に近い判定）
  if (/(^|[^A-Z])OT([^A-Z]|$)/.test(combined) || combined.includes('作業')) return 'OT';
  if (/(^|[^A-Z])ST([^A-Z]|$)/.test(combined) || combined.includes('言語')) return 'ST';
  if (/(^|[^A-Z])PT([^A-Z]|$)/.test(combined) || combined.includes('理学')) return 'PT';
  if (combined.includes('OT') || combined.includes('作業')) return 'OT';
  if (combined.includes('ST') || combined.includes('言語')) return 'ST';
  if (combined.includes('PT') || combined.includes('理学')) return 'PT';
  return null;
}

/**
 * スロット配列から職種別・日別単位マップを構築
 * @param {Array<{date?: string, therapist?: string, therapistId?: string, therapistName?: string, units?: number, isAnalgesia?: boolean}>} slots
 * @param {number} daysInMonth
 * @param {Array} [therapistsMaster]
 * @returns {{
 *   dailyByRole: Record<TherapistRole, number[]>,
 *   totalsByRole: Record<TherapistRole, number>,
 *   hasRole: Record<TherapistRole, boolean>
 * }}
 */
export function buildDailyUnitsByRole(slots, daysInMonth, therapistsMaster = []) {
  /** @type {Record<TherapistRole, number[]>} */
  const dailyByRole = {
    PT: Array(daysInMonth + 1).fill(0),
    OT: Array(daysInMonth + 1).fill(0),
    ST: Array(daysInMonth + 1).fill(0)
  };
  /** @type {Record<TherapistRole, number>} */
  const totalsByRole = { PT: 0, OT: 0, ST: 0 };

  (slots || []).forEach((s) => {
    if (!s || s.isAnalgesia || !s.date) return;
    const parts = String(s.date).split('-');
    const dNum = parseInt(parts[2], 10);
    if (!(dNum >= 1 && dNum <= daysInMonth)) return;
    const u = Number(s.units) || 1;
    const tid = s.therapistId || s.therapist || '';
    const tname = s.therapistName || '';
    const role = getTherapistRole(tid, tname, therapistsMaster);
    dailyByRole[role][dNum] += u;
    totalsByRole[role] += u;
  });

  return {
    dailyByRole,
    totalsByRole,
    hasRole: {
      PT: totalsByRole.PT > 0,
      OT: totalsByRole.OT > 0,
      ST: totalsByRole.ST > 0
    }
  };
}

/**
 * 受付Excel用: 出力する職種行キー一覧（PT/OTは常時、STは実績があるときのみ）
 * @param {Record<TherapistRole, number>} totalsByRole
 * @returns {TherapistRole[]}
 */
export function listRolesForExcelRows(totalsByRole) {
  /** @type {TherapistRole[]} */
  const roles = ['PT', 'OT'];
  if ((totalsByRole?.ST || 0) > 0) roles.push('ST');
  return roles;
}
