// js/views/monthly/diaryPreview.js
// 月間画面の業務日誌プレビュー

import { monthlyState } from './monthlyState.js';

export function renderDailyDiaryPreview(aggregated) {
  const container = document.getElementById('dailyDiaryPreviewContainer');
  if (!container) return;

  const today = new Date();
  const day = (monthlyState.year === today.getFullYear() && monthlyState.month === (today.getMonth() + 1)) ? today.getDate() : 1;
  const dayData = aggregated.dailyBreakdown[day] || { totalUnits: 0, inpatients: 0, outpatients: 0, planCount: 0, analgesiaTotal: 0 };

  container.innerHTML = `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; font-size:0.85rem;">
      <div style="font-weight:700; color:#0f172a; margin-bottom:6px;">
        📅 ${monthlyState.year}年${monthlyState.month}月${day}日 業務日誌集計プレビュー (24列目連携)
      </div>
      <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:10px; text-align:center;">
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">当日総単位</div>
          <div style="font-size:1.05rem; font-weight:700; color:#0369a1;">${dayData.totalUnits} 単位</div>
        </div>
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">入院実施単位</div>
          <div style="font-size:1.05rem; font-weight:700; color:#d97706;">${dayData.inpatients} 単位</div>
        </div>
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">外来実施単位</div>
          <div style="font-size:1.05rem; font-weight:700; color:#2563eb;">${dayData.outpatients} 単位</div>
        </div>
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">消炎鎮痛来院</div>
          <div style="font-size:1.05rem; font-weight:700; color:#16a34a;">${dayData.analgesiaTotal || 0} 名</div>
        </div>
        <div style="background:#f8fafc; padding:8px; border-radius:6px;">
          <div style="color:#64748b; font-size:0.72rem;">計画書算定</div>
          <div style="font-size:1.05rem; font-weight:700; color:#854d0e;">${dayData.planCount} 件</div>
        </div>
      </div>
    </div>
  `;
}
