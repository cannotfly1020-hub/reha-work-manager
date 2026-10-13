// js/views/appointment/palette.js
// 外来予約カレンダーの患者パレット

import { sanitizeHtml, normalizeToKatakana } from '../../core/dataNormalizer.js';
import { searchPatients } from '../../store/patientStore.js';
import { calendarState } from './calendarState.js';

export function setupAptPaletteEvents() {
  const searchInput = document.getElementById('aptPaletteSearch');
  const sortSelect = document.getElementById('aptPaletteSortSelect');
  const catButtons = document.querySelectorAll('.apt-palette-cat-btn');

  searchInput?.addEventListener('input', renderAptPalette);

  sortSelect?.addEventListener('change', (e) => {
    calendarState.paletteSort = e.target.value;
    renderAptPalette();
  });

  catButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      catButtons.forEach((b) => {
        b.classList.remove('active');
        b.style.background = '#fff';
        b.style.color = '#334155';
      });
      btn.classList.add('active');
      btn.style.background = '#0284c7';
      btn.style.color = '#fff';
      calendarState.paletteCategory = btn.dataset.cat || 'ALL';
      renderAptPalette();
    });
  });
}

function sortAptPalettePatients(list, sortKey) {
  return [...list].sort((a, b) => {
    if (sortKey === 'KANA') {
      const kanaA = normalizeToKatakana(a.nameKana || a.name || '');
      const kanaB = normalizeToKatakana(b.nameKana || b.name || '');
      return kanaA.localeCompare(kanaB, 'ja');
    }
    if (sortKey === 'ID') {
      return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
    }
    // デフォルト: CATEGORY (外来優先: 外来 → 消炎 → 入院)
    const getCatScore = (p) => {
      if (p.category === 'OUTPATIENT' && p.diseaseType !== 'ANALGESIA') return 1;
      if (p.diseaseType === 'ANALGESIA') return 2;
      return 3;
    };
    const diff = getCatScore(a) - getCatScore(b);
    if (diff !== 0) return diff;
    return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
  });
}

export function renderAptPalette() {
  const container = document.getElementById('aptPalettePatientList');
  const searchInput = document.getElementById('aptPaletteSearch');
  if (!container) return;

  const keyword = searchInput ? searchInput.value.trim() : '';
  const rawPatients = searchPatients(keyword, calendarState.paletteCategory);

  if (rawPatients.length === 0) {
    container.innerHTML = `<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:16px;">該当する患者がいません</div>`;
    return;
  }

  const patients = sortAptPalettePatients(rawPatients, calendarState.paletteSort);

  container.innerHTML = patients
    .map((p) => {
      let catClass = 'cat-outpatient';
      let catName = '外来';
      let tagBg = '#2563eb';
      if (p.category === 'INPATIENT') {
        catClass = 'cat-inpatient';
        catName = '入院';
        tagBg = '#d97706';
      } else if (p.diseaseType === 'ANALGESIA') {
        catClass = 'cat-analgesia';
        catName = '消炎';
        tagBg = '#16a34a';
      }

      return `
        <div class="apt-palette-item ${catClass}" draggable="true" data-patient-id="${p.id}" data-patient-name="${sanitizeHtml(p.name)}">
          <div class="apt-palette-item-name">
            <span>${sanitizeHtml(p.name)}</span>
            <span style="font-size:0.65rem; background:${tagBg}; color:#fff; padding:1px 5px; border-radius:3px;">${catName}</span>
          </div>
          <div class="apt-palette-item-sub">
            ID: ${p.id} / ${sanitizeHtml(p.diseaseName || '疾患名未登録')}
          </div>
        </div>
      `;
    })
    .join('');

  // パレットのドラッグ開始イベント
  container.querySelectorAll('.apt-palette-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      const patientId = item.dataset.patientId;
      const patientName = item.dataset.patientName;
      const payload = {
        type: 'NEW_PATIENT',
        patientId,
        patientName
      };
      calendarState.dragPayload = payload;
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
    });

    item.addEventListener('dragend', () => {
      calendarState.dragPayload = null;
    });
  });
}
