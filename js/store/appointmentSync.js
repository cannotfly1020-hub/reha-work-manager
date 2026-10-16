// js/store/appointmentSync.js
// 外来予約を当日時間割へ流し込む（手入力枠は上書きしない）

import { TIME_SLOTS } from '../config/rules.js';
import { normalizeDateString } from '../core/dataNormalizer.js';
import { getActiveTherapists } from './therapistStore.js';
import { getPatientById } from './patientStore.js';
import {
  getDailySchedule, setScheduleSlot, addAnalgesiaPatient, getAnalgesiaSlotPatients, slotRangeOverlaps
} from './scheduleStore.js';
import { showToast } from '../ui/toast.js';

/**
 * 外来予約データストアから指定日の予約（キャンセル以外）を堅牢に取得するヘルパー
 * 複数キー（reha_outpatient_appointments / reha_appointments）およびオブジェクト・配列両形式に対応
 */
export function getAppointmentsForDate(dateStr) {
  try {
    const cleanTargetDate = normalizeDateString(dateStr);
    const candidateKeys = ['reha_outpatient_appointments', 'reha_appointments'];
    let allAppointments = [];

    for (const key of candidateKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (list.length > 0) {
          allAppointments = list;
          break;
        }
      } catch (_) {}
    }

    return allAppointments.filter((apt) => {
      if (!apt || !apt.patientId) return false;
      const aptDate = normalizeDateString(apt.date || apt.appointmentDate || '');
      const isStatusOk = apt.status !== 'CANCELLED' && apt.status !== 'CANCELED';
      return aptDate === cleanTargetDate && isStatusOk;
    });
  } catch (err) {
    console.error('外来予約データ取得エラー:', err);
    return [];
  }
}

/**
 * 実時間（例: "09:15"）から最も近い20分コマのIDを判定して返す
 */
function findNearestSlotId(timeStr) {
  if (!timeStr || !TIME_SLOTS || TIME_SLOTS.length === 0) return TIME_SLOTS[0]?.id || 'slot_0840';

  const [hStr, mStr] = timeStr.split(':');
  const targetMinutes = (parseInt(hStr, 10) || 0) * 60 + (parseInt(mStr, 10) || 0);

  let bestSlotId = TIME_SLOTS[0].id;
  let bestMinutes = 0;
  let minDiff = Infinity;

  TIME_SLOTS.forEach((slot) => {
    let slotTime = '08:40';
    if (slot.start) {
      slotTime = slot.start;
    } else if (slot.label && slot.label.includes('〜')) {
      slotTime = slot.label.split('〜')[0].trim();
    } else if (slot.id && slot.id.startsWith('slot_')) {
      const raw = slot.id.replace('slot_', '');
      slotTime = `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
    }

    const [sh, sm] = slotTime.split(':');
    const slotMinutes = (parseInt(sh, 10) || 0) * 60 + (parseInt(sm, 10) || 0);
    const diff = Math.abs(targetMinutes - slotMinutes);

    if (diff < minDiff || (diff === minDiff && slotMinutes > bestMinutes)) {
      minDiff = diff;
      bestMinutes = slotMinutes;
      bestSlotId = slot.id;
    }
  });

  return bestSlotId;
}

/**
 * 所要時間（分）から単位数（1〜4単位）を変換判定
 */
function convertDurationToUnits(durationMin) {
  const dur = parseInt(durationMin, 10);
  const minutes = Number.isFinite(dur) ? dur : 20;
  if (minutes <= 25) return 1;
  if (minutes <= 45) return 2;
  if (minutes <= 65) return 3;
  return 4;
}

/**
 * 本日の予約データを時間割へ安全に自動流し込み（手入力保護ガード完備）
 */
export function syncAppointmentsToSchedule(dateStr, onApplied) {
  const currentDateStr = dateStr;
  console.log(`[外来予約反映] 処理開始: 日付=${currentDateStr}`);
  const appointments = getAppointmentsForDate(currentDateStr);

  if (appointments.length === 0) {
    showToast(`本日（${currentDateStr}）の外来予約データはありません`, 'info');
    return;
  }

  const activeTherapists = getActiveTherapists();
  if (activeTherapists.length === 0) {
    showToast('稼働中のセラピストが設定されていません', 'error');
    return;
  }

  const schedule = getDailySchedule(currentDateStr);
  let appliedCount = 0;
  let skippedCount = 0;

  appointments.forEach((apt) => {
    const patient = getPatientById(apt.patientId);
    if (!patient) {
      console.warn(`[外来予約反映] 患者ID未登録のためスキップ: ${apt.patientId}`);
      skippedCount++;
      return;
    }

    const nearestSlotId = findNearestSlotId(apt.startTime);
    const slotIndex = TIME_SLOTS.findIndex((s) => s.id === nearestSlotId);
    if (slotIndex === -1) {
      skippedCount++;
      return;
    }

    // ① 消炎鎮痛（物療）の場合
    const isAnalgesia = apt.treatmentType === 'ANALGESIA' || apt.therapistId === 'ANALGESIA';
    if (isAnalgesia) {
      const existingAnalgesia = getAnalgesiaSlotPatients(currentDateStr, nearestSlotId);
      const isAlreadyAdded = existingAnalgesia.some((p) => p && p.id === apt.patientId);
      if (isAlreadyAdded) {
        skippedCount++;
      } else {
        addAnalgesiaPatient(currentDateStr, nearestSlotId, apt.patientId);
        appliedCount++;
      }
      return;
    }

    // ② 個別リハビリの場合
    const units = convertDurationToUnits(apt.durationMinutes || apt.duration || 30);

    // 担当セラピストの選定（指定PTが存在し稼働中か確認、なければ空いているPTを探索）
    let targetTherapistId = apt.therapistId;
    let therapistValid = activeTherapists.some((t) => t.id === targetTherapistId);

    // 同一患者が同日内のいずれかの個別リハ枠にすでに配置されている場合は二重算定防止のためスキップ
    let alreadyScheduledAnywhere = false;
    for (const t of activeTherapists) {
      for (const slot of TIME_SLOTS) {
        if (schedule[t.id]?.[slot.id]?.patientId === apt.patientId) {
          alreadyScheduledAnywhere = true;
          break;
        }
      }
      if (alreadyScheduledAnywhere) break;
    }

    if (alreadyScheduledAnywhere) {
      console.log(`[外来予約反映] 同日他枠に既存配置のためスキップ: 患者=${patient.name}`);
      skippedCount++;
      return;
    }

    // 指定PT枠で units 分の連続した空き枠があるか検査（手入力データ保護ガード）
    const isSlotRangeAvailable = (tId, startIdx, reqUnits) => {
      const startId = TIME_SLOTS[startIdx]?.id;
      if (!startId) return false;
      return !slotRangeOverlaps(schedule, tId, startId, reqUnits).blocked;
    };

    if (!therapistValid) {
      targetTherapistId = activeTherapists[0].id;
    }

    let canAssign = isSlotRangeAvailable(targetTherapistId, slotIndex, units);

    if (!canAssign) {
      // 既存の手入力データが埋まっているため安全にスキップ
      console.log(`[外来予約反映] 空き枠不足のためスキップ: 患者=${patient.name}, 要求単位=${units}`);
      skippedCount++;
      return;
    }

    // メモ欄に元の実時間・特記メモを保持（実時間と制度時間の二重レイヤー分離）
    const combinedNote = `[予約 ${apt.startTime}〜] ${apt.notes || ''}`.trim();

    const cellData = {
      itemType: 'PATIENT',
      patientId: apt.patientId,
      units: units,
      note: combinedNote,
      billingPlan: ''
    };

    setScheduleSlot(currentDateStr, targetTherapistId, nearestSlotId, cellData);

    // 2単位以上の連続枠をローカルの schedule オブジェクトにも仮マークして次患者との衝突を防止
    for (let u = 0; u < units; u++) {
      const idx = slotIndex + u;
      if (idx < TIME_SLOTS.length) {
        const sId = TIME_SLOTS[idx].id;
        if (!schedule[targetTherapistId]) schedule[targetTherapistId] = {};
        schedule[targetTherapistId][sId] = u === 0 ? cellData : { ...cellData, units: 1 };
      }
    }

    appliedCount++;
  });

  if (appliedCount > 0) {
    let msg = `✅ 外来予約 ${appointments.length}件中 ${appliedCount}件を時間割に反映しました（${skippedCount}件スキップ）`;
    showToast(msg, 'success');

    // 自動バックアップトリガー
    if (typeof window.triggerDailyBackup === 'function') {
      window.triggerDailyBackup();
    }

    if (typeof onApplied === 'function') onApplied();
  } else {
    showToast(`反映可能な空きコマがありませんでした（${skippedCount}件スキップ）`, 'warn');
  }
}
