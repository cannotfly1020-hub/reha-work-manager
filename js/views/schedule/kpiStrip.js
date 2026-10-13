// js/views/schedule/kpiStrip.js
// 当日時間割の件数ストリップ

import { getDailyStats } from '../../store/scheduleStore.js';
import { scheduleState } from './scheduleState.js';

export function renderDailyKPIStrip() {
  const container = document.getElementById('dailyKpiStrip');
  if (!container) return;
  const stats = getDailyStats(scheduleState.dateStr);
  const aTot = stats.analgesia?.total || 0;
  container.innerHTML = `
    <span style="color:#0369a1;">個別リハ総単位: <strong>${stats.totalUnits}</strong> 単位</span>
    <span style="color:#059669;">患者数: <strong>${stats.totalPatients}</strong> 名</span>
    <span style="color:#16a34a; background:#dcfce7; padding:2px 8px; border-radius:4px;">消炎鎮痛: <strong>${aTot}</strong>名 (入${stats.analgesia?.inpatients || 0}/外${stats.analgesia?.outpatients || 0})</span>
    <span style="color:#854d0e;">計画書: <strong>${stats.planCount}</strong> 件</span>
  `;
}
