// js/store/appointmentStore.js
// 外来予約管理 データストア層
// 自由実時間（非20分縛り）・同一時間帯重複（並行来院/消炎複数人/PT別並行）対応
// ★同一患者の同日・重複時間帯二重予約物理遮断ガード・LocalStorage永続化

const APPOINTMENT_STORAGE_KEY = 'reha_outpatient_appointments';

/**
 * 予約データ構造の定義
 * @typedef {Object} Appointment
 * @property {string} id - 予約固有ID (UUIDまたはタイムスタンプ)
 * @property {string} date - 予約日 (YYYY-MM-DD)
 * @property {string} startTime - 開始時刻 (HH:MM, 例: '10:15')
 * @property {number} durationMinutes - 所要時間 (分, 例: 15, 20, 30, 40, 60)
 * @property {string} patientId - 患者ID
 * @property {string} therapistId - 担当者ID ('A', 'B', 'C', または 'ANALGESIA'/'NONE')
 * @property {string} treatmentType - 治療種別 ('INDIVIDUAL' | 'ANALGESIA' | 'EVALUATION' | 'OTHER')
 * @property {string} status - 状態 ('CONFIRMED' | 'CANCELLED' | 'COMPLETED')
 * @property {string} notes - 院内特記メモ (送迎、診察後など)
 * @property {string} createdAt - 登録日時
 * @property {string} updatedAt - 更新日時
 */

/**
 * 全予約データの取得
 * @returns {Record<string, Appointment>} idをキーとする予約オブジェクトマップ
 */
export function getAllAppointments() {
  try {
    const raw = localStorage.getItem(APPOINTMENT_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load appointments from localStorage:', e);
    return {};
  }
}

/**
 * 全予約データの保存
 * @param {Record<string, Appointment>} appointments
 */
export function saveAllAppointments(appointments) {
  try {
    localStorage.setItem(APPOINTMENT_STORAGE_KEY, JSON.stringify(appointments));
    // 日次バックアップ自動連携トリガー
    if (typeof window.triggerDailyBackup === 'function') {
      window.triggerDailyBackup();
    }
    return true;
  } catch (e) {
    console.error('Failed to save appointments to localStorage:', e);
    return false;
  }
}

/**
 * 指定日の予約一覧を取得（開始時刻順ソート）
 * 同一時刻の場合は登録順または治療種別順
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Appointment[]}
 */
export function getAppointmentsByDate(dateStr) {
  const all = getAllAppointments();
  return Object.values(all)
    .filter((apt) => apt.date === dateStr && apt.status !== 'CANCELLED')
    .sort((a, b) => {
      if (a.startTime !== b.startTime) {
        return a.startTime.localeCompare(b.startTime);
      }
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
}

/**
 * 指定月（YYYY-MM）の全予約一覧を取得
 * @param {number} year
 * @param {number} month
 * @returns {Appointment[]}
 */
export function getAppointmentsByMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const all = getAllAppointments();
  return Object.values(all)
    .filter((apt) => apt.date && apt.date.startsWith(prefix) && apt.status !== 'CANCELLED')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
}

/**
 * 指定患者の今後の予約一覧を取得（本日以降）
 * @param {string} patientId
 * @param {string} fromDateStr - YYYY-MM-DD（未指定時は本日）
 * @returns {Appointment[]}
 */
export function getPatientFutureAppointments(patientId, fromDateStr = null) {
  const baseDate = fromDateStr || new Date().toISOString().slice(0, 10);
  const all = getAllAppointments();
  return Object.values(all)
    .filter((apt) => apt.patientId === patientId && apt.date >= baseDate && apt.status !== 'CANCELLED')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
}

/**
 * 同一患者の同日・重複時間帯予約の競合判定
 * （別患者の同時刻重複は許可し、同一患者のみ物理遮断する）
 * @param {string} patientId - 患者ID
 * @param {string} date - 予約日 (YYYY-MM-DD)
 * @param {string} startTime - 開始時刻 (HH:MM)
 * @param {number} durationMinutes - 所要時間(分)
 * @param {string|null} excludeAppointmentId - 自身の更新・移動時に除外する予約ID
 * @returns {{ hasConflict: boolean, conflictingAppointment?: Appointment }}
 */
export function checkPatientAppointmentConflict(patientId, date, startTime, durationMinutes, excludeAppointmentId = null) {
  if (!patientId || !date || !startTime) {
    return { hasConflict: false };
  }

  const all = getAllAppointments();
  const targetStartMin = timeStringToMinutes(startTime);
  const targetEndMin = targetStartMin + (Number(durationMinutes) || 30);

  // 同一患者・同日の既存予約（キャンセル除く）を抽出
  const samePatientApts = Object.values(all).filter((apt) => {
    if (apt.status === 'CANCELLED') return false;
    if (apt.patientId !== patientId) return false;
    if (apt.date !== date) return false;
    if (excludeAppointmentId && apt.id === excludeAppointmentId) return false;
    return true;
  });

  for (const apt of samePatientApts) {
    const existStartMin = timeStringToMinutes(apt.startTime);
    const existEndMin = existStartMin + (Number(apt.durationMinutes) || 30);

    // 時間帯の重複（オーバーラップ）判定: startA < endB && endA > startB
    if (targetStartMin < existEndMin && targetEndMin > existStartMin) {
      return {
        hasConflict: true,
        conflictingAppointment: apt
      };
    }
  }

  return { hasConflict: false };
}

/**
 * 予約の新規登録または更新
 * @param {Object} rawData
 * @returns {{ success: boolean, appointment?: Appointment, message?: string }}
 */
export function upsertAppointment(rawData) {
  if (!rawData.date || !rawData.startTime || !rawData.patientId) {
    return { success: false, message: '予約日、時間、患者IDは必須です。' };
  }

  const targetId = rawData.id || null;
  const targetDuration = Number(rawData.durationMinutes) || 30;

  // ★同一患者の重複予約チェック（ヒューマンエラー物理遮断）
  const conflictCheck = checkPatientAppointmentConflict(
    rawData.patientId,
    rawData.date,
    rawData.startTime,
    targetDuration,
    targetId
  );

  if (conflictCheck.hasConflict && conflictCheck.conflictingAppointment) {
    const conflict = conflictCheck.conflictingAppointment;
    const conflictEnd = calculateEndTime(conflict.startTime, conflict.durationMinutes);
    return {
      success: false,
      message: `【二重予約防止】同日に既に予約が入っています (${conflict.startTime}〜${conflictEnd})。`
    };
  }

  const all = getAllAppointments();
  const nowStr = new Date().toISOString();
  const id = targetId || `apt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const existing = all[id] || {};
  const appointment = {
    id,
    date: rawData.date,
    startTime: rawData.startTime,
    durationMinutes: targetDuration,
    patientId: rawData.patientId,
    therapistId: rawData.therapistId || 'A',
    treatmentType: rawData.treatmentType || 'INDIVIDUAL',
    status: rawData.status || 'CONFIRMED',
    notes: (rawData.notes || '').trim(),
    createdAt: existing.createdAt || nowStr,
    updatedAt: nowStr
  };

  all[id] = appointment;
  saveAllAppointments(all);

  return { success: true, appointment, message: '予約を保存しました。' };
}

/**
 * 予約の削除（またはキャンセル）
 * @param {string} appointmentId
 * @returns {boolean}
 */
export function deleteAppointment(appointmentId) {
  const all = getAllAppointments();
  if (!all[appointmentId]) return false;
  delete all[appointmentId];
  return saveAllAppointments(all);
}

/**
 * 終了時刻の計算ヘルパー (HH:MM)
 * @param {string} startTime - '10:15'
 * @param {number} durationMinutes - 30
 * @returns {string} - '10:45'
 */
export function calculateEndTime(startTime, durationMinutes = 30) {
  if (!startTime || !startTime.includes(':')) return '';
  const totalMinutes = timeStringToMinutes(startTime) + (Number(durationMinutes) || 0);
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * 時刻文字列 (HH:MM) を通算分に変換するヘルパー
 * @param {string} timeStr - '10:15'
 * @returns {number} - 615
 */
function timeStringToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h * 60) + (m || 0);
}
