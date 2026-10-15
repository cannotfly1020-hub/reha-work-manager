// js/views/schedule/palette.js
// 当日時間割の患者パレット

import { REHA_RULES } from '../../config/rules.js';
import { sanitizeHtml, normalizeToKatakana } from '../../core/dataNormalizer.js';
import { searchPatients } from '../../store/patientStore.js';
import { scheduleState } from './scheduleState.js';

export function setupSchedulePaletteEvents() {
  const searchInput = document.getElementById('paletteSearch');
  const sortSelect = document.getElementById('paletteSortSelect');

  if (searchInput) searchInput.addEventListener('input', () => renderPatientPalette());

  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      scheduleState.paletteSortKey = e.target.value;
      renderPatientPalette();
    });
  }

  document.querySelectorAll('.palette-cat-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.palette-cat-btn').forEach((b) => b.classList.remove('active'));
      e.target.classList.add('active');
      scheduleState.paletteCategory = e.target.dataset.cat;
      renderPatientPalette();
    });
  });
}

function comparePaletteKana(a, b) {
  const kanaA = normalizeToKatakana(a.nameKana || a.name || '');
  const kanaB = normalizeToKatakana(b.nameKana || b.name || '');
  return kanaA.localeCompare(kanaB, 'ja');
}

function comparePaletteId(a, b) {
  return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
}

function diseaseSortScore(patient) {
  switch (patient?.diseaseType) {
    case 'LOCOMOTIVE': return 1;
    case 'CEREBROVASCULAR': return 2;
    case 'DISUSE': return 3;
    case 'ANALGESIA': return 4;
    default: return 9;
  }
}

export function sortPalettePatients(list, sortKey) {
  return [...list].sort((a, b) => {
    if (sortKey === 'DISEASE') {
      const diff = diseaseSortScore(a) - diseaseSortScore(b);
      if (diff !== 0) return diff;
      return comparePaletteKana(a, b) || comparePaletteId(a, b);
    }
    if (sortKey === 'ID') {
      return comparePaletteId(a, b);
    }
    return comparePaletteKana(a, b) || comparePaletteId(a, b);
  });
}

export function renderPatientPalette() {
  const listEl = document.getElementById('palettePatientList');
  const searchInput = document.getElementById('paletteSearch');
  if (!listEl) return;

  const keyword = searchInput ? searchInput.value : '';
  const rawPatients = searchPatients(keyword, scheduleState.paletteCategory);

  if (rawPatients.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:16px;">該当する患者がいません</div>';
    return;
  }

  const patients = sortPalettePatients(rawPatients, scheduleState.paletteSortKey);

  listEl.innerHTML = patients
    .map((p) => {
      const isOut = p.category === 'OUTPATIENT';
      const borderCol = isOut ? 'var(--color-outpatient)' : 'var(--color-inpatient)';
      const disRule = REHA_RULES.LIMIT_DAYS[p.diseaseType] || REHA_RULES.LIMIT_DAYS.ANALGESIA;
      const tagHtml = `<span style="font-size:0.65rem; font-weight:700; background:${disRule.tagBg}; color:${disRule.tagColor}; border:1px solid ${disRule.tagBorder}; padding:1px 4px; border-radius:3px;">${disRule.shortLabel}</span> `;

      return `
        <div class="patient-palette-card" draggable="true" data-patient-id="${p.id}"
             style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${borderCol}; border-radius:4px; padding:6px 8px; cursor:grab; font-size:0.78rem;">
          <div style="font-weight:700; display:flex; justify-content:space-between; align-items:center;">
            <div>${tagHtml}<span>${sanitizeHtml(p.name)}</span></div>
            <span style="font-size:0.7rem; color:#64748b;">${p.id}</span>
          </div>
          <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">${sanitizeHtml(p.diseaseName || '')}</div>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.patient-palette-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'NEW_PATIENT', patientId: e.currentTarget.dataset.patientId }));
      e.dataTransfer.setData('text/plain', e.currentTarget.dataset.patientId);
    });
  });
}
