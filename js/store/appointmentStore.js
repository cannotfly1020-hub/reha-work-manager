// js/store/appointmentStore.js
// 外来予約管理 データストア層
// 自由実時間（非20分縛り）・同一時間帯重複（並行来院/消炎複数人/PT別並行）対応・LocalStorage永続化

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
 * 予約の新規登録または更新
 * @param {Object} rawData
 * @returns {{ success: boolean, appointment?: Appointment, message?: string }}
 */
export function upsertAppointment(rawData) {
  if (!rawData.date || !rawData.startTime || !rawData.patientId) {
    return { success: false, message: '予約日、時間、患者IDは必須です。' };
  }

  const all = getAllAppointments();
  const nowStr = new Date().toISOString();
  const id = rawData.id || `apt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const existing = all[id] || {};
  const appointment = {
    id,
    date: rawData.date,
    startTime: rawData.startTime,
    durationMinutes: Number(rawData.durationMinutes) || 30,
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
  const [h, m] = startTime.split(':').map(Number);
  const totalMinutes = h * 60 + m + (Number(durationMinutes) || 0);
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}
