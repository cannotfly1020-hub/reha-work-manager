// js/excel/diaryWriter.js
// 業務日誌Excel生成層（入院・外来別単位＆人数 / スタッフ出欠枠 / PT別実績 / A4縦1枚収容 / 200行制限準拠）

import { TIME_SLOTS, THERAPISTS, REHA_RULES } from '../config/rules.js';
import { getDailySchedule } from '../store/scheduleStore.js';
import { getPatientById } from '../store/patientStore.js';

const STYLES = {
  headerNavy: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  headerSub: {
    font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: '1E293B' } },
    fill: { fgColor: { rgb: 'F1F5F9' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellTime: {
    font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: '475569' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellInpatient: {
    font: { name: 'Meiryo UI', sz: 7.5, color: { rgb: '92400E' } },
    fill: { fgColor: { rgb: 'FEF3C7' } },
    alignment: { vertical: 'center', wrapText: true },
    border: thinBorder()
  },
  cellOutpatient: {
    font: { name: 'Meiryo UI', sz: 7.5, color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'EFF6FF' } },
    alignment: { vertical: 'center', wrapText: true },
    border: thinBorder()
  },
  cellEmpty: {
    font: { name: 'Meiryo UI', sz: 7.5 },
    border: thinBorder()
  },
  cellLabel: {
    font: { name: 'Meiryo UI', sz: 7.5, bold: true, color: { rgb: '334155' } },
    fill: { fgColor: { rgb: 'F8FAFC' } },
    alignment: { vertical: 'center' },
    border: thinBorder()
  },
  cellVal: {
    font: { name: 'Meiryo UI', sz: 7.5 },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder()
  },
  cellCenter: {
    font: { name: 'Meiryo UI', sz: 7.5 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder()
  },
  cellTotal: {
    font: { name: 'Meiryo UI', sz: 8, bold: true, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: 'ECFDF5' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: { top: { style: 'thin', color: { rgb: '0F172A' } }, bottom: { style: 'double', color: { rgb: '0F172A' } }, left: { style: 'thin', color: { rgb: 'CBD5E1' } }, right: { style: 'thin', color: { rgb: 'CBD5E1' } } }
  }
};

function thinBorder() {
  const b = { style: 'thin', color: { rgb: 'CBD5E1' } };
  return { top: b, bottom: b, left: b, right: b };
}

export function generateDiaryWorkbook(aggregated) {
  if (!window.XLSX) throw new Error('SheetJS (xlsx-js-style) が読み込まれていません。');
  const wb = window.XLSX.utils.book_new();
  const { year, month, daysInMonth } = aggregated;

  for (let day = 1; day <= daysInMonth; day++) {
    const ws = {};
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

    // 1. タイトル
    setStyledCell(ws, 0, 0, `【リハビリテーション科 業務日誌】 ${year}年${month}月${day}日 (${dayNames[dayOfWeek]})`, {
      font: { name: 'Meiryo UI', sz: 10.5, bold: true, color: { rgb: '0F172A' } }
    });

    // 2. 時間割ヘッダー
    setStyledCell(ws, 2, 0, '時間帯', STYLES.headerNavy);
    THERAPISTS.forEach((t, i) => setStyledCell(ws, 2, i + 1, t.name, STYLES.headerNavy));

    // 3. スケジュール描画 & 集計
    const schedule = getDailySchedule(dateStr);
    const ptStats = { A: { units: 0, patients: new Set() }, B: { units: 0, patients: new Set() }, C: { units: 0, patients: new Set() } };
    const inPatientsSet = new Set();
    const outPatientsSet = new Set();
    let inUnits = 0, outUnits = 0, planCount = 0;
    const diseaseUnits = { LOCOMOTIVE: 0, CEREBROVASCULAR: 0, DISUSE: 0 };

    TIME_SLOTS.forEach((slot, rIdx) => {
      const r = 3 + rIdx;
      setStyledCell(ws, r, 0, slot.label, STYLES.cellTime);

      THERAPISTS.forEach((t, cIdx) => {
        const item = schedule[t.id]?.[slot.id];
        if (item?.patientId) {
          const p = getPatientById(item.patientId);
          const u = item.units || 1;
          ptStats[t.id].units += u;
          ptStats[t.id].patients.add(item.patientId);
          const isIn = p?.category === 'INPATIENT';

          if (isIn) {
            inUnits += u;
            inPatientsSet.add(item.patientId);
          } else {
            outUnits += u;
            outPatientsSet.add(item.patientId);
          }

          if (p?.diseaseType && diseaseUnits[p.diseaseType] !== undefined) diseaseUnits[p.diseaseType] += u;
          if (item.billingPlan) planCount++;

          const planMark = item.billingPlan ? '★' : '';
          const text = `${p ? p.name : item.patientId} (${u}u${planMark})`;
          setStyledCell(ws, r, cIdx + 1, text, isIn ? STYLES.cellInpatient : STYLES.cellOutpatient);
        } else {
          setStyledCell(ws, r, cIdx + 1, '', STYLES.cellEmpty);
        }
      });
    });

    // 4. 右側上部：出欠・勤務状況確認ブロック (行 2〜6)
    setStyledCell(ws, 2, 5, '職種 / 担当', STYLES.headerNavy);
    setStyledCell(ws, 2, 6, '出欠・勤務区分', STYLES.headerNavy);

    const staffList = [
      ['セラピスト PT A', ptStats.A.units > 0 ? '出勤' : '公休 / -'],
      ['セラピスト PT B', ptStats.B.units > 0 ? '出勤' : '公休 / -'],
      ['セラピスト PT C', ptStats.C.units > 0 ? '出勤' : '公休 / -'],
      ['リハビリ助手 1', '出勤 [　　]'],
      ['リハビリ助手 2', '出勤 [　　]']
    ];

    staffList.forEach((st, sIdx) => {
      const r = 3 + sIdx;
      setStyledCell(ws, r, 5, st[0], STYLES.cellLabel);
      setStyledCell(ws, r, 6, st[1], STYLES.cellCenter);
    });

    // 5. 右側中央：入院・外来別 ＆ 実績集計ブロック (行 9〜)
    setStyledCell(ws, 9, 5, '実績集計項目', STYLES.headerNavy);
    setStyledCell(ws, 9, 6, '当日実績値', STYLES.headerNavy);

    const aPatients = Object.values(schedule.analgesia || {}).flat();
    const analgesiaInCount = aPatients.filter((id) => getPatientById(id)?.category === 'INPATIENT').length;
    const analgesiaOutCount = aPatients.length - analgesiaInCount;
    const totalUnits = inUnits + outUnits;
    const totalPatientsCount = new Set([...inPatientsSet, ...outPatientsSet]).size;

    const summaryRows = [
      ['個別リハ総単位数 (総人数)', `${totalUnits} 単位 (${totalPatientsCount} 名)`],
      ['─ 入院 実施単位 (人数)', `${inUnits} 単位 (${inPatientsSet.size} 名)`],
      ['─ 外来 実施単位 (人数)', `${outUnits} 単位 (${outPatientsSet.size} 名)`],
      ['運動器リハ(Ⅱ)', `${diseaseUnits.LOCOMOTIVE} 単位`],
      ['脳血管等リハ(Ⅲ)', `${diseaseUnits.CEREBROVASCULAR} 単位`],
      ['廃用症候群リハ(Ⅲ)', `${diseaseUnits.DISUSE} 単位`],
      ['消炎鎮痛処置 (物療)', `${aPatients.length} 件 (入${analgesiaInCount}/外${analgesiaOutCount})`],
      ['総合計画書策定', `${planCount} 件`],
      ['PT A 実施単位 (患者数)', `${ptStats.A.units} u (${ptStats.A.patients.size}名)`],
      ['PT B 実施単位 (患者数)', `${ptStats.B.units} u (${ptStats.B.patients.size}名)`],
      ['PT C 実施単位 (患者数)', `${ptStats.C.units} u (${ptStats.C.patients.size}名)`]
    ];

    summaryRows.forEach((row, idx) => {
      const r = 10 + idx;
      setStyledCell(ws, r, 5, row[0], STYLES.cellLabel);
      setStyledCell(ws, r, 6, row[1], STYLES.cellVal);
    });

    // 概算収益
    const estPoints = (diseaseUnits.LOCOMOTIVE * 170) + (diseaseUnits.CEREBROVASCULAR * 100) + (diseaseUnits.DISUSE * 77) + (aPatients.length * 35);
    setStyledCell(ws, 21, 5, '当日リハ概算収益', STYLES.cellTotal);
    setStyledCell(ws, 21, 6, `¥${(estPoints * 10).toLocaleString()}`, STYLES.cellTotal);

    // 列幅: 時間帯(10), PT A/B/C(17.5ずつ), 余白(1.5), サマリー項目(20), サマリー値(14)
    setSheetCols(ws, [10, 17.5, 17.5, 17.5, 1.5, 20, 14]);

    applyA4PortraitPrintSetup(ws);
    updateSheetRange(ws);
    window.XLSX.utils.book_append_sheet(wb, ws, `${day}日`);
  }

  return wb;
}

function applyA4PortraitPrintSetup(ws) {
  ws['!properties'] = { pageSetUpPr: { fitToPage: true } };
  ws['!pageSetup'] = {
    paperSize: 9, // A4
    orientation: 'portrait', // 縦向き
    fitToWidth: 1, // 横1ページ
    fitToHeight: 1, // 縦1ページ（1日＝1枚完全収容）
    fitToPage: true
  };
  ws['!margins'] = { left: 0.15, right: 0.15, top: 0.25, bottom: 0.25, header: 0.05, footer: 0.05 };
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
