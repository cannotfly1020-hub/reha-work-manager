// js/excel/diaryWriter.js
// 業務日誌Excel生成層（原本R8.6準拠 / 検印欄 / 動的スタッフ名完全反映 / 当日までの累積シート生成 / 外来0名・公休スマート自動記録 / A4横1枚極上美麗レイアウト版）

import { REHA_RULES } from '../config/rules.js';
import { getDailySchedule } from '../store/scheduleStore.js';
import { getPatientById } from '../store/patientStore.js';
import { getAllTherapists, THERAPIST_STATUS } from '../store/therapistStore.js';

const STYLES = {
  headerNavy: {
    font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder('475569')
  },
  headerSub: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '1E293B' } },
    fill: { fgColor: { rgb: 'F1F5F9' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder('94A3B8')
  },
  cellLabel: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '334155' } },
    fill: { fgColor: { rgb: 'F8FAFC' } },
    alignment: { vertical: 'center' },
    border: thinBorder('CBD5E1')
  },
  cellVal: {
    font: { name: 'Meiryo UI', sz: 8 },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder('CBD5E1')
  },
  cellCenter: {
    font: { name: 'Meiryo UI', sz: 8 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder('CBD5E1')
  }
};

function thinBorder(colorHex = 'CBD5E1') {
  const b = { style: 'thin', color: { rgb: colorHex } };
  return { top: b, bottom: b, left: b, right: b };
}

/**
 * 業務日誌ワークブック生成（A4横1枚完全収容・極上美麗レイアウト）
 */
export function generateDiaryWorkbook(aggregated, targetDay = null) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();
  const { year, month, daysInMonth } = aggregated;

  const allTherapists = getAllTherapists();
  const activeStaffList = allTherapists.filter((t) => t.status !== THERAPIST_STATUS.RETIRED);

  const now = new Date();
  const isCurrentMonth = (now.getFullYear() === year && (now.getMonth() + 1) === month);
  let endDay = daysInMonth;

  if (targetDay !== null && targetDay !== undefined) {
    endDay = Math.min(daysInMonth, Math.max(1, targetDay));
  } else if (isCurrentMonth) {
    endDay = Math.min(daysInMonth, now.getDate());
  }

  for (let day = 1; day <= endDay; day++) {
    const ws = {};
    const rowHeights = []; // 行の高さをきめ細かく制御
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const reiwaYear = year - 2018;
    const isSunday = dayOfWeek === 0;

    // 1. タイトル & 日付 & 検印枠（右上）
    rowHeights[0] = 24;
    setStyledCell(ws, 0, 0, 'リハビリテーション科 業務日誌', {
      font: { name: 'Meiryo UI', sz: 13, bold: true, color: { rgb: '0F172A' } },
      alignment: { vertical: 'center' }
    });

    rowHeights[1] = 22;
    const dayColor = isSunday ? { rgb: 'DC2626' } : (dayOfWeek === 6 ? { rgb: '2563EB' } : { rgb: '334155' });
    setStyledCell(ws, 1, 0, `令和${reiwaYear}年 ${month}月 ${day}日 (${dayNames[dayOfWeek]})`, {
      font: { name: 'Meiryo UI', sz: 10, bold: true, color: dayColor },
      alignment: { vertical: 'center' }
    });

    // 検印枠（4連: 院長・事務長・科長・担当）
    const sealTitles = ['院 長', '事務長', '科 長', '担 当'];
    sealTitles.forEach((title, idx) => {
      const c = 4 + idx;
      setStyledCell(ws, 0, c, title, STYLES.headerSub);
      setStyledCell(ws, 1, c, '', { border: thinBorder('94A3B8'), alignment: { horizontal: 'center', vertical: 'center' } });
    });

    rowHeights[2] = 8; // 表との間の上品な余白

    // 2. データ集計
    const schedule = getDailySchedule(dateStr);
    const ptStats = {};
    activeStaffList.forEach((t) => {
      ptStats[t.id] = { name: t.name, units: 0, pSet: new Set() };
    });

    const breakdown = {
      IN: { LOCOMOTIVE: { u: 0, p: new Set() }, CEREBROVASCULAR: { u: 0, p: new Set() }, DISUSE: { u: 0, p: new Set() } },
      OUT: { LOCOMOTIVE: { u: 0, p: new Set() }, CEREBROVASCULAR: { u: 0, p: new Set() }, DISUSE: { u: 0, p: new Set() } }
    };
    let planCount = 0;

    activeStaffList.forEach((t) => {
      const slots = schedule[t.id] || {};
      Object.values(slots).forEach((item) => {
        if (item?.patientId) {
          const p = getPatientById(item.patientId);
          const u = item.units || 1;
          if (ptStats[t.id]) {
            ptStats[t.id].units += u;
            ptStats[t.id].pSet.add(item.patientId);
          }

          const isInput = p?.category === 'INPATIENT';
          const catKey = isInput ? 'IN' : 'OUT';
          const dKey = p?.diseaseType in breakdown[catKey] ? p.diseaseType : 'LOCOMOTIVE';
          breakdown[catKey][dKey].u += u;
          breakdown[catKey][dKey].p.add(item.patientId);

          if (item.billingPlan) planCount++;
        }
      });
    });

    // 3. 左側上部：勤務状況・出勤確認
    rowHeights[3] = 22;
    setStyledCell(ws, 3, 0, '職種 / 担当', STYLES.headerNavy);
    setStyledCell(ws, 3, 1, '出欠・勤務区分', STYLES.headerNavy);
    setStyledCell(ws, 3, 2, '備考', STYLES.headerNavy);

    let curLeftRow = 4;
    activeStaffList.forEach((t) => {
      rowHeights[curLeftRow] = 19;
      const isWorking = ptStats[t.id]?.units > 0;
      let statusStr = '出勤';
      let statusColor = { rgb: '15803D' };

      if (isSunday && !isWorking) {
        statusStr = '公休';
        statusColor = { rgb: '64748B' };
      } else if (t.status === THERAPIST_STATUS.LEAVE) {
        statusStr = '休職';
        statusColor = { rgb: 'B45309' };
      }

      setStyledCell(ws, curLeftRow, 0, t.name, STYLES.cellLabel);
      setStyledCell(ws, curLeftRow, 1, statusStr, {
        ...STYLES.cellCenter,
        font: { name: 'Meiryo UI', sz: 8, bold: true, color: statusColor }
      });
      setStyledCell(ws, curLeftRow, 2, '', STYLES.cellCenter);
      curLeftRow++;
    });

    ['リハビリ助手 1', 'リハビリ助手 2'].forEach((aide) => {
      rowHeights[curLeftRow] = 19;
      const aideStatus = isSunday ? '公休' : '出勤 [　　]';
      setStyledCell(ws, curLeftRow, 0, aide, STYLES.cellLabel);
      setStyledCell(ws, curLeftRow, 1, aideStatus, STYLES.cellCenter);
      setStyledCell(ws, curLeftRow, 2, '', STYLES.cellCenter);
      curLeftRow++;
    });

    // 4. 左側下部：担当セラピスト別実績
    rowHeights[curLeftRow] = 6; // 余白
    curLeftRow++;

    rowHeights[curLeftRow] = 22;
    setStyledCell(ws, curLeftRow, 0, '担当セラピスト', STYLES.headerNavy);
    setStyledCell(ws, curLeftRow, 1, '実施単位', STYLES.headerNavy);
    setStyledCell(ws, curLeftRow, 2, '実施患者数', STYLES.headerNavy);
    curLeftRow++;

    activeStaffList.forEach((t) => {
      rowHeights[curLeftRow] = 19;
      const stats = ptStats[t.id] || { units: 0, pSet: new Set() };
      setStyledCell(ws, curLeftRow, 0, t.name, STYLES.cellLabel);
      setStyledCell(ws, curLeftRow, 1, `${stats.units} 単位`, { ...STYLES.cellVal, font: { name: 'Meiryo UI', sz: 8, bold: stats.units > 0 } });
      setStyledCell(ws, curLeftRow, 2, `${stats.pSet.size} 名`, STYLES.cellVal);
      curLeftRow++;
    });

    // 5. 右側：入院・外来別 実績集計表
    setStyledCell(ws, 3, 4, '区分 / 疾患項目', STYLES.headerNavy);
    setStyledCell(ws, 3, 5, '単位数', STYLES.headerNavy);
    setStyledCell(ws, 3, 6, '実施人数', STYLES.headerNavy);
    setStyledCell(ws, 3, 7, '備考', STYLES.headerNavy);

    const inUnits = breakdown.IN.LOCOMOTIVE.u + breakdown.IN.CEREBROVASCULAR.u + breakdown.IN.DISUSE.u;
    const inPatients = new Set([...breakdown.IN.LOCOMOTIVE.p, ...breakdown.IN.CEREBROVASCULAR.p, ...breakdown.IN.DISUSE.p]).size;
    const outUnits = breakdown.OUT.LOCOMOTIVE.u + breakdown.OUT.CEREBROVASCULAR.u + breakdown.OUT.DISUSE.u;
    const outPatients = new Set([...breakdown.OUT.LOCOMOTIVE.p, ...breakdown.OUT.CEREBROVASCULAR.p, ...breakdown.OUT.DISUSE.p]).size;

    const aPatients = Object.values(schedule.analgesia || {}).flat();
    const aInCount = aPatients.filter((id) => getPatientById(id)?.category === 'INPATIENT').length;
    const aOutCount = aPatients.length - aInCount;

    const summaryGrid = [
      ['【入院】運動器リハ(Ⅱ)', `${breakdown.IN.LOCOMOTIVE.u} 単位`, `${breakdown.IN.LOCOMOTIVE.p.size} 名`, ''],
      ['【入院】脳血管等リハ(Ⅲ)', `${breakdown.IN.CEREBROVASCULAR.u} 単位`, `${breakdown.IN.CEREBROVASCULAR.p.size} 名`, ''],
      ['【入院】廃用症候群(Ⅲ)', `${breakdown.IN.DISUSE.u} 単位`, `${breakdown.IN.DISUSE.p.size} 名`, ''],
      ['【入院】小計', `${inUnits} 単位`, `${inPatients} 名`, ''],
      ['【外来】運動器リハ(Ⅱ)', `${breakdown.OUT.LOCOMOTIVE.u} 単位`, `${breakdown.OUT.LOCOMOTIVE.p.size} 名`, ''],
      ['【外来】脳血管等リハ(Ⅲ)', `${breakdown.OUT.CEREBROVASCULAR.u} 単位`, `${breakdown.OUT.CEREBROVASCULAR.p.size} 名`, ''],
      ['【外来】廃用症候群(Ⅲ)', `${breakdown.OUT.DISUSE.u} 単位`, `${breakdown.OUT.DISUSE.p.size} 名`, ''],
      ['【外来】小計', `${outUnits} 単位`, `${outPatients} 名`, ''],
      ['消炎鎮痛処置 (物療)', `${aPatients.length} 件`, `${aPatients.length} 名`, `入院${aInCount} / 外来${aOutCount}`],
      ['総合計画書策定件数', `${planCount} 件`, '-', ''],
      ['個別リハ 合計実績', `${inUnits + outUnits} 単位`, `${inPatients + outPatients} 名`, '']
    ];

    summaryGrid.forEach((row, idx) => {
      const r = 4 + idx;
      if (!rowHeights[r]) rowHeights[r] = 19;
      const isSub = row[0].includes('小計');
      const isTotal = row[0].includes('合計');

      let styleLbl = STYLES.cellLabel;
      let styleVal = STYLES.cellVal;

      if (isSub) {
        styleLbl = { ...STYLES.cellLabel, font: { name: 'Meiryo UI', sz: 8, bold: true }, fill: { fgColor: { rgb: 'F1F5F9' } } };
        styleVal = { ...STYLES.cellVal, font: { name: 'Meiryo UI', sz: 8, bold: true }, fill: { fgColor: { rgb: 'F1F5F9' } } };
      } else if (isTotal) {
        styleLbl = { ...STYLES.cellLabel, font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '0F172A' } }, fill: { fgColor: { rgb: 'E0F2FE' } } };
        styleVal = { ...STYLES.cellVal, font: { name: 'Meiryo UI', sz: 8.5, bold: true, color: { rgb: '0369A1' } }, fill: { fgColor: { rgb: 'E0F2FE' } } };
      }

      setStyledCell(ws, r, 4, row[0], styleLbl);
      setStyledCell(ws, r, 5, row[1], styleVal);
      setStyledCell(ws, r, 6, row[2], styleVal);
      setStyledCell(ws, r, 7, row[3], isTotal ? { ...STYLES.cellCenter, fill: { fgColor: { rgb: 'E0F2FE' } } } : STYLES.cellCenter);
    });

    // 6. 下部：記事・申し送り事項
    const noteStartRow = Math.max(curLeftRow, 16);
    rowHeights[noteStartRow] = 20;
    setStyledCell(ws, noteStartRow, 0, '記事・申し送り事項', STYLES.headerNavy);
    for (let c = 1; c <= 7; c++) setStyledCell(ws, noteStartRow, c, '', STYLES.headerNavy);

    let autoNoteText = '';
    const totalDayUnits = inUnits + outUnits;
    if (isSunday && totalDayUnits === 0 && aPatients.length === 0) {
      autoNoteText = '※ 休診日 (公休)';
    } else if (!isSunday && outUnits === 0 && aOutCount === 0) {
      autoNoteText = '※ 本日は外来患者来院なし（配置・待機・院内リハ業務実施）';
    }

    for (let rOffset = 1; rOffset <= 3; rOffset++) {
      const nr = noteStartRow + rOffset;
      rowHeights[nr] = 20;
      const rowText = (rOffset === 1 && autoNoteText) ? autoNoteText : '';
      setStyledCell(ws, nr, 0, rowText, {
        border: thinBorder('CBD5E1'),
        fill: { fgColor: { rgb: 'FFFFFF' } },
        font: { name: 'Meiryo UI', sz: 8, color: { rgb: '475569' }, italic: Boolean(autoNoteText && rOffset === 1) },
        alignment: { vertical: 'center' }
      });
      for (let c = 1; c <= 7; c++) {
        setStyledCell(ws, nr, c, '', { border: thinBorder('CBD5E1'), fill: { fgColor: { rgb: 'FFFFFF' } } });
      }
    }

    // 7. 列幅設定（A4横いっぱいに広がる最適幅）
    setSheetCols(ws, [18, 14, 12, 3, 22, 12, 12, 17]);

    // 8. 行高の適用
    ws['!rows'] = rowHeights.map((h) => ({ hpt: h || 19 }));

    applyA4LandscapePrintSetup(ws);
    updateSheetRange(ws);
    window.XLSX.utils.book_append_sheet(wb, ws, `${day}日`);
  }

  return wb;
}

function applyA4LandscapePrintSetup(ws) {
  ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
  ws['!properties'] = { pageSetUpPr: { fitToPage: true } };
  ws['!pageSetup'] = {
    paperSize: 9, // A4
    orientation: 'landscape', // 原本通りの横向き
    fitToWidth: 1, // 横1ページ
    fitToHeight: 1, // 縦1ページ（1日＝1枚完全収容）
    fitToPage: true
  };
  ws['!margins'] = { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.05, footer: 0.05 };
}

function setStyledCell(ws, r, c, val, style = {}) {
  const addr = window.XLSX.utils.encode_cell({ r, c });
  if (val === '' || val === null || val === undefined) {
    ws[addr] = { t: 's', v: '', s: style };
    return;
  }
  const isNum = typeof val === 'number';
  ws[addr] = { t: isNum ? 'n' : 's', v: val, s: style };
}

function setSheetCols(ws, widthList) {
  ws['!cols'] = widthList.map((w) => ({ wch: w }));
}

function updateSheetRange(ws) {
  const keys = Object.keys(ws).filter((k) => !k.startsWith('!'));
  if (keys.length === 0) return;
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  keys.forEach((k) => {
    const cell = window.XLSX.utils.decode_cell(k);
    if (cell.r < minR) minR = cell.r;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c < minC) minC = cell.c;
    if (cell.c > maxC) maxC = cell.c;
  });
  ws['!ref'] = window.XLSX.utils.encode_range({ r: minR, c: minC }, { r: maxR, c: maxC });
}
