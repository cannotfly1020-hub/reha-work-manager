/**
 * @file app.js
 * @description リハビリ業務管理Webアプリ（reha-work-manager）メインコントローラー
 * 
 * - パターンC（ハイブリッド配色）：
 *   ・左端縦ライン：入院（ウォームアンバー）／外来（インディゴブルー）
 *   ・カード背景＆バッジ：1単位（ミントグリーン）／2単位（スカイブルー）／3単位（ラベンダーパープル）
 * - 複数コマブロック結合（1単位20分・2単位40分・3単位60分）のグリッド完全吸着（連続配置可能）
 * - 外来50名・入院19名（計69名）の患者パレット・あいまい検索・五十音絞り込み
 * - セラピスト別リアルタイム日計カウンターおよび月13単位モニタリング
 * - アプリ内蓄積データからの受付提出用Excel・日別業務日誌Excelのワンクリック出力
 */

import { REHA_RULES } from './config/rules.js';
import { calculatePatientDeadlines, formatDate } from './core/deadlineCalc.js';
import { normalizePatientId, normalizeString } from './core/dataNormalizer.js';
import { exportUketsukeSubmissionWorkbook } from './excel/uketsukeWriter.js';
import { exportDiaryWorkbook } from './excel/diaryWriter.js';
import { getAllPatients, upsertPatient } from './store/patientStore.js';
import { getAllLoans, registerLoan, markAsReturned, deleteLoan } from './store/loanStore.js';
import {
  TIME_SLOTS,
  getDailySchedule,
  setScheduleSlot,
  clearScheduleSlot,
  getDailyStats,
  aggregateFromAppSchedule,
} from './store/scheduleStore.js';

/**
 * 患者が月13単位制限（算定日数上限超過・維持期介護・個別制限）の対象か判定
 * @param {Object} patient 
 * @param {Date} dateObj 
 * @returns {boolean}
 */
function isPatientRestrictedTo13Units(patient, dateObj) {
  if (!patient) return false;
  if (patient.isLimitExempt) return false; // 除外規定適用者は制限なし

  // 1. 維持期介護区分
  if (patient.category && patient.category.includes('maintenance')) {
    return true;
  }

  // 2. 個別指定フラグ
  if (patient.is13UnitLimited) {
    return true;
  }

  // 3. 疾患別標準算定日数上限（運動器150日、脳血管180日、廃用120日）を超過しているか
  const deadlines = calculatePatientDeadlines(patient, dateObj);
  if (deadlines.isOverLimit) {
    return true;
  }

  return false;
}

/**
 * コマ配置時に月13単位制限を超過しないかバリデーション検証
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} therapistCode - 'A'|'B'|'C'
 * @param {string} slotId - 'am_1' 等
 * @param {string} patientId - 患者記号
 * @param {number} newUnits - 追加・設定しようとしている単位数
 * @param {boolean} isEditMode - 既存コマの編集か
 * @returns {boolean} 配置可能なら true, 制限超過なら false
 */
function validateMonthly13UnitsLimit(dateStr, therapistCode, slotId, patientId, newUnits, isEditMode = false) {
  const normId = normalizePatientId(patientId);
  const patient = getAllPatients().find((p) => normalizePatientId(p.id) === normId);
  if (!patient) return true;

  const dateObj = new Date(dateStr);
  const isRestricted = isPatientRestrictedTo13Units(patient, dateObj);
  if (!isRestricted) {
    return true; // 13単位制限の対象外患者（算定期間内の通常患者など）は制限なし
  }

  // 対象年月の集計を取得
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;
  const aggregated = aggregateFromAppSchedule(year, month);
  let currentMonthUnits = aggregated.patientTotals[normId]?.totalUnits || 0;

  // 編集中のコマにすでに割り当てられていた既存単位があれば、二重加算防止のため差し引く
  if (isEditMode) {
    const schedule = getDailySchedule(dateStr);
    const existingSlot = schedule[therapistCode]?.[slotId];
    if (existingSlot && normalizePatientId(existingSlot.patientId) === normId) {
      currentMonthUnits -= (existingSlot.units || 0);
    }
  }

  const projectedTotal = currentMonthUnits + newUnits;
  if (projectedTotal > 13) {
    const pName = patient.name || patientId.toUpperCase();
    showToast(
      `⚠️【13単位制限エラー】${pName} 様は月13単位上限の対象です。当月現在 ${currentMonthUnits}単位のため、${newUnits}単位を追加すると13単位を超過 (${projectedTotal}単位) します。配置できません。`,
      'error'
    );
    return false;
  }

  return true;
}

/**
 * 入院19名・外来50名（計69名）のテスト患者データセット
 */
const SEED_TEST_PATIENTS = [
  // ==================== 入院患者 (19名: 記号 a 〜 s) ====================
  { id: 'a', name: '山田 太郎', kana: 'やまだ たろう', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-06-10', onsetDate: '2026-06-08', earlyBonusStartDate: '2026-06-10', lastPlanDate: '2026-06-12' },
  { id: 'b', name: '佐藤 花子', kana: 'さとう はなこ', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-06-15', onsetDate: '2026-06-14', earlyBonusStartDate: '2026-06-15', lastPlanDate: '2026-06-18' },
  { id: 'c', name: '鈴木 一郎', kana: 'すずき いちろう', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-06-20', onsetDate: '2026-06-18', earlyBonusStartDate: '2026-06-20', lastPlanDate: '2026-06-22' },
  { id: 'd', name: '田中 幸子', kana: 'たなか さちこ', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-06-25', onsetDate: '2026-06-22', earlyBonusStartDate: '2026-06-25', lastPlanDate: '2026-06-28' },
  { id: 'e', name: '高橋 健二', kana: 'たかはし けんじ', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-06-28', onsetDate: '2026-06-26', earlyBonusStartDate: '2026-06-28', lastPlanDate: '2026-06-30' },
  { id: 'f', name: '伊藤 恵子', kana: 'いとう けいこ', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-07-01', onsetDate: '2026-06-30', earlyBonusStartDate: '2026-07-01', lastPlanDate: '2026-07-02' },
  { id: 'g', name: '渡辺 勇', kana: 'わたなべ いさむ', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-07-02', onsetDate: '2026-07-01', earlyBonusStartDate: '2026-07-02', lastPlanDate: '2026-07-03' },
  { id: 'h', name: '山本 節子', kana: 'やまもと せつこ', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-07-03', onsetDate: '2026-07-01', earlyBonusStartDate: '2026-07-03', lastPlanDate: '2026-07-04' },
  { id: 'i', name: '中村 忠夫', kana: 'なかむら ただお', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-07-04', onsetDate: '2026-07-02', earlyBonusStartDate: '2026-07-04', lastPlanDate: '2026-07-05' },
  { id: 'j', name: '小林 芳子', kana: 'こばやし よしこ', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-07-05', onsetDate: '2026-07-03', earlyBonusStartDate: '2026-07-05', lastPlanDate: '2026-07-06' },
  { id: 'k', name: '加藤 武', kana: 'かとう たけし', category: 'inpatient_2', diseaseType: 'CEREBROVASCULAR', admissionDate: '2026-06-05', onsetDate: '2026-06-01', earlyBonusStartDate: '2026-06-05', lastPlanDate: '2026-06-08' },
  { id: 'l', name: '吉田 光男', kana: 'よしだ みつお', category: 'inpatient_2', diseaseType: 'CEREBROVASCULAR', admissionDate: '2026-06-12', onsetDate: '2026-06-10', earlyBonusStartDate: '2026-06-12', lastPlanDate: '2026-06-15' },
  { id: 'm', name: '佐々木 弘', kana: 'ささき ひろし', category: 'inpatient_2', diseaseType: 'CEREBROVASCULAR', admissionDate: '2026-06-18', onsetDate: '2026-06-15', earlyBonusStartDate: '2026-06-18', lastPlanDate: '2026-06-20' },
  { id: 'n', name: '山口 房江', kana: 'やまぐち ふさえ', category: 'inpatient_2', diseaseType: 'DISUSE', admissionDate: '2026-06-22', onsetDate: '2026-06-20', earlyBonusStartDate: '2026-06-22', lastPlanDate: '2026-06-24' },
  { id: 'o', name: '松本 健', kana: 'まつもと けん', category: 'inpatient_2', diseaseType: 'DISUSE', admissionDate: '2026-06-25', onsetDate: '2026-06-22', earlyBonusStartDate: '2026-06-25', lastPlanDate: '2026-06-28' },
  { id: 'p', name: '井上 トミ', kana: 'いのうえ とみ', category: 'inpatient_maintenance', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-05-10', onsetDate: '2026-05-01', earlyBonusStartDate: '', lastPlanDate: '2026-06-05' },
  { id: 'q', name: '木村 豊', kana: 'きむら ゆたか', category: 'inpatient_maintenance', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-05-15', onsetDate: '2026-05-10', earlyBonusStartDate: '', lastPlanDate: '2026-06-12' },
  { id: 'r', name: '林 正雄', kana: 'はやし まさお', category: 'inpatient_1', diseaseType: 'ANALGESIA', admissionDate: '2026-07-01', onsetDate: '2026-06-25', earlyBonusStartDate: '', lastPlanDate: '2026-07-02' },
  { id: 's', name: '斎藤 勝', kana: 'さいとう まさる', category: 'inpatient_1', diseaseType: 'LOCOMOTIVE', admissionDate: '2026-07-04', onsetDate: '2026-07-02', earlyBonusStartDate: '2026-07-04', lastPlanDate: '2026-07-05' },

  // ==================== 外来患者 (50名: 記号 p1 〜 p50) ====================
  { id: 'p1', name: '青木 俊夫', kana: 'あおき としお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-05-10' },
  { id: 'p2', name: '秋山 美智子', kana: 'あきやま みちこ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-05-12' },
  { id: 'p3', name: '安藤 浩二', kana: 'あんどう こうじ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-05-15' },
  { id: 'p4', name: '石田 敏行', kana: 'いしだ としゆき', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-05-18' },
  { id: 'p5', name: '市川 静江', kana: 'いちかわ しずえ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-05-20' },
  { id: 'p6', name: '上田 健作', kana: 'うえだ けんさく', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-05-22' },
  { id: 'p7', name: '遠藤 紀子', kana: 'えんどう のりこ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-05-25' },
  { id: 'p8', name: '大野 義男', kana: 'おおの よしお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-05-28' },
  { id: 'p9', name: '小川 正弘', kana: 'おがわ まさひろ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-01' },
  { id: 'p10', name: '金子 保', kana: 'かねこ たもつ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-02' },
  { id: 'p11', name: '菊地 秀樹', kana: 'きくち ひでき', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-04' },
  { id: 'p12', name: '工藤 千代', kana: 'くどう ちよ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-05' },
  { id: 'p13', name: '久保 和彦', kana: 'くぼ かずひこ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-08' },
  { id: 'p14', name: '栗原 忠', kana: 'くりはら ただし', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-10' },
  { id: 'p15', name: '小池 和代', kana: 'こいけ かずよ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-11' },
  { id: 'p16', name: '後藤 貞夫', kana: 'ごとう さだお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-12' },
  { id: 'p17', name: '近藤 治', kana: 'こんどう おさむ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-15' },
  { id: 'p18', name: '坂本 明美', kana: 'さかもと あけみ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-16' },
  { id: 'p19', name: '桜井 栄作', kana: 'さくらい えいさく', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-18' },
  { id: 'p20', name: '柴田 喜代', kana: 'しばた きよ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-19' },
  { id: 'p21', name: '島田 繁', kana: 'しまだ しげる', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-20' },
  { id: 'p22', name: '清水 敏子', kana: 'しみず としこ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-22' },
  { id: 'p23', name: '菅原 仁', kana: 'すがわら ひとし', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-23' },
  { id: 'p24', name: '杉山 芳雄', kana: 'すぎやま よしお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-25' },
  { id: 'p25', name: '関根 文子', kana: 'せきね ふみこ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-26' },
  { id: 'p26', name: '高田 勉', kana: 'たかだ つとむ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-27' },
  { id: 'p27', name: '竹内 八郎', kana: 'たけうち はちろう', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-28' },
  { id: 'p28', name: '田村 トヨ', kana: 'たむら とよ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-29' },
  { id: 'p29', name: '千葉 勝己', kana: 'ちば かつみ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-06-30' },
  { id: 'p30', name: '土屋 照男', kana: 'つちや てるお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-01' },
  { id: 'p31', name: '内藤 美穂', kana: 'ないとう みほ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-01' },
  { id: 'p32', name: '永井 孝一', kana: 'ながい こういち', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-02' },
  { id: 'p33', name: '西田 秀雄', kana: 'にしだ ひでお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-02' },
  { id: 'p34', name: '野口 サエ', kana: 'のぐち さえ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-02' },
  { id: 'p35', name: '長谷川 徹', kana: 'はせがわ とおる', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-03' },
  { id: 'p36', name: '馬場 春男', kana: 'ばば はるお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-03' },
  { id: 'p37', name: '平野 ハナ', kana: 'ひらの はな', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-03' },
  { id: 'p38', name: '広瀬 義明', kana: 'ひろせ よしあき', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-04' },
  { id: 'p39', name: '福田 静夫', kana: 'ふくだ しずお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-04' },
  { id: 'p40', name: '藤田 昭二', kana: 'ふじた しょうじ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-04' },
  { id: 'p41', name: '本間 辰夫', kana: 'ほんま たつお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-05' },
  { id: 'p42', name: '前田 久男', kana: 'まえだ ひさお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-05' },
  { id: 'p43', name: '増田 正雄', kana: 'ますだ まさお', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-05' },
  { id: 'p44', name: '三浦 幸平', kana: 'みうら こうへい', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-06' },
  { id: 'p45', name: '宮崎 律子', kana: 'みやざき りつこ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-06' },
  { id: 'p46', name: '村上 寛', kana: 'むらかみ ひろし', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-06' },
  { id: 'p47', name: '望月 隆', kana: 'もちづき たかし', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-06' },
  { id: 'p48', name: '矢野 光子', kana: 'やの みつこ', category: 'outpatient_1', diseaseType: 'ANALGESIA', onsetDate: '2026-07-07' },
  { id: 'p49', name: '横山 喜八', kana: 'よこやま きはち', category: 'outpatient_1', diseaseType: 'ANALGESIA', onsetDate: '2026-07-07' },
  { id: 'p50', name: '若林 芳江', kana: 'わかばやし よしえ', category: 'outpatient_1', diseaseType: 'LOCOMOTIVE', onsetDate: '2026-07-07' },
];

const state = {
  currentTab: 'view-daily-schedule',
  selectedDate: '2026-07-01',
  targetYear: 2026,
  targetMonth: 7,
  paletteFilter: 'ALL',
  paletteSearchTerm: '',
  paletteKanaFilter: 'ALL',
  activeSlotModal: null,
  draggedPatientId: null,
};

document.addEventListener('DOMContentLoaded', () => {
  ensureInitialTestPatients();
  initNavigationTabs();
  initDateControls();
  initPaletteFiltersAndSearch();
  initSlotEditModal();
  initPatientMasterModal();
  initLoanModal();
  initMonthlyViews();
  initExportActionButtons();

  renderAll();
});

function ensureInitialTestPatients() {
  const existing = getAllPatients();
  if (!existing || existing.length === 0) {
    SEED_TEST_PATIENTS.forEach((p) => upsertPatient(p));
  } else {
    const ids = new Set(existing.map((e) => e.id));
    SEED_TEST_PATIENTS.forEach((p) => {
      if (!ids.has(p.id)) {
        upsertPatient(p);
      }
    });
  }
}

function renderAll() {
  renderPalette();
  renderTimetable();
  renderDailyKPIs();
  renderMonthlyUnitsTable();
  renderDailyDiaryPreview();
  renderPatientDeadlines();
  renderLoansTable();
}

function initNavigationTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.view-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target;
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
      state.currentTab = targetId;

      if (targetId === 'view-daily-schedule') {
        renderTimetable();
        renderDailyKPIs();
      } else if (targetId === 'view-monthly-units') {
        renderMonthlyUnitsTable();
        renderDailyDiaryPreview();
      } else if (targetId === 'view-patients') {
        renderPatientDeadlines();
      } else if (targetId === 'view-equipment') {
        renderLoansTable();
      }
    });
  });
}

function initDateControls() {
  const dateInput = document.getElementById('schedule-target-date');
  const btnPrev = document.getElementById('btn-prev-day');
  const btnNext = document.getElementById('btn-next-day');
  const btnToday = document.getElementById('btn-today');

  if (dateInput) {
    dateInput.value = state.selectedDate;
    dateInput.addEventListener('change', (e) => {
      state.selectedDate = e.target.value;
      updateYearMonthFromSelectedDate();
      renderAll();
    });
  }

  btnPrev?.addEventListener('click', () => {
    const cur = new Date(state.selectedDate);
    cur.setDate(cur.getDate() - 1);
    state.selectedDate = formatDate(cur);
    if (dateInput) dateInput.value = state.selectedDate;
    updateYearMonthFromSelectedDate();
    renderAll();
  });

  btnNext?.addEventListener('click', () => {
    const cur = new Date(state.selectedDate);
    cur.setDate(cur.getDate() + 1);
    state.selectedDate = formatDate(cur);
    if (dateInput) dateInput.value = state.selectedDate;
    updateYearMonthFromSelectedDate();
    renderAll();
  });

  btnToday?.addEventListener('click', () => {
    const today = new Date();
    state.selectedDate = formatDate(today);
    if (dateInput) dateInput.value = state.selectedDate;
    updateYearMonthFromSelectedDate();
    renderAll();
  });
}

function updateYearMonthFromSelectedDate() {
  const d = new Date(state.selectedDate);
  state.targetYear = d.getFullYear();
  state.targetMonth = d.getMonth() + 1;

  const yearSelect = document.getElementById('monthly-target-year');
  const monthSelect = document.getElementById('monthly-target-month');
  if (yearSelect) yearSelect.value = String(state.targetYear);
  if (monthSelect) monthSelect.value = String(state.targetMonth);
}

function initPaletteFiltersAndSearch() {
  const segButtons = document.querySelectorAll('.segment-btn');
  segButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      segButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.paletteFilter = btn.dataset.filter;
      renderPalette();
    });
  });

  const searchInput = document.getElementById('patient-palette-search');
  const clearBtn = document.getElementById('btn-clear-palette-search');

  searchInput?.addEventListener('input', (e) => {
    state.paletteSearchTerm = normalizeString(e.target.value).toLowerCase();
    renderPalette();
  });

  clearBtn?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      state.paletteSearchTerm = '';
      renderPalette();
    }
  });

  const kanaChips = document.querySelectorAll('.kana-chip');
  kanaChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      kanaChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.paletteKanaFilter = chip.dataset.kana;
      renderPalette();
    });
  });

  const btnQuickAdd = document.getElementById('btn-quick-add-patient');
  btnQuickAdd?.addEventListener('click', () => {
    openPatientMasterModal();
  });
}

function matchesKanaGroup(kana, group) {
  if (!kana || group === 'ALL') return true;
  const first = kana.trim().charAt(0);
  const groups = {
    'ア': ['あ', 'い', 'う', 'え', 'お', 'ア', 'イ', 'ウ', 'エ', 'オ'],
    'カ': ['か', 'き', 'く', 'け', 'こ', 'が', 'ぎ', 'ぐ', 'げ', 'ご', 'カ', 'キ', 'ク', 'ケ', 'コ'],
    'サ': ['さ', 'し', 'す', 'せ', 'そ', 'ざ', 'じ', 'ず', 'ぜ', 'ぞ', 'サ', 'シ', 'ス', 'セ', 'ソ'],
    'タ': ['た', 'ち', 'つ', 'て', 'と', 'だ', 'ぢ', 'づ', 'で', 'ど', 'タ', 'チ', 'ツ', 'テ', 'ト'],
    'ナ': ['な', 'に', 'ぬ', 'ね', 'の', 'ナ', 'ニ', 'ヌ', 'ネ', 'ノ'],
    'ハ': ['は', 'ひ', 'ふ', 'へ', 'ほ', 'ば', 'び', 'ぶ', 'べ', 'ぼ', 'ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ', 'ハ', 'ヒ', 'フ', 'ヘ', 'ホ'],
    'マ': ['ま', 'み', 'む', 'め', 'も', 'マ', 'ミ', 'ム', 'メ', 'モ'],
    'ヤ': ['や', 'ゆ', 'よ', 'ヤ', 'ユ', 'ヨ'],
    'ラ': ['ら', 'り', 'る', 'れ', 'ろ', 'ラ', 'リ', 'ル', 'レ', 'ロ'],
    'ワ': ['わ', 'を', 'ん', 'ワ', 'ヲ', 'ン'],
  };
  return groups[group] ? groups[group].includes(first) : true;
}

function renderPalette() {
  const container = document.getElementById('patient-palette-list');
  if (!container) return;

  const all = getAllPatients();
  let inpCount = 0;
  let outCount = 0;

  all.forEach((p) => {
    const isOut = p.category && p.category.startsWith('outpatient');
    if (isOut) outCount++;
    else inpCount++;
  });

  const badgeAll = document.getElementById('badge-count-all');
  const badgeIn = document.getElementById('badge-count-inpatient');
  const badgeOut = document.getElementById('badge-count-outpatient');
  if (badgeAll) badgeAll.textContent = String(all.length);
  if (badgeIn) badgeIn.textContent = String(inpCount);
  if (badgeOut) badgeOut.textContent = String(outCount);

  const filtered = all.filter((p) => {
    const isOut = p.category && p.category.startsWith('outpatient');
    if (state.paletteFilter === 'INPATIENT' && isOut) return false;
    if (state.paletteFilter === 'OUTPATIENT' && !isOut) return false;

    if (state.paletteKanaFilter !== 'ALL') {
      const match = matchesKanaGroup(p.kana || p.name, state.paletteKanaFilter);
      if (!match) return false;
    }

    if (state.paletteSearchTerm) {
      const term = state.paletteSearchTerm;
      const targetStr = `${p.id} ${p.name || ''} ${p.kana || ''}`.toLowerCase();
      if (!targetStr.includes(term)) return false;
    }

    return true;
  });

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: span 2; padding: 1.5rem; text-align: center; color: var(--text-dim); font-size: 0.8rem;">該当する患者が見つかりません</div>`;
    return;
  }

  filtered.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'patient-palette-card';
    card.draggable = true;
    card.dataset.patientId = p.id;

    const isOut = p.category && p.category.startsWith('outpatient');
    const tagClass = isOut ? 'tag-outpatient' : 'tag-inpatient';
    const tagLabel = isOut ? '外来' : '入院';

    card.innerHTML = `
      <div class="palette-card-top">
        <span class="palette-patient-badge">${p.id.toUpperCase()}</span>
        <span class="palette-category-tag ${tagClass}">${tagLabel}</span>
      </div>
      <div class="palette-patient-name" title="${p.name || p.id}">${p.name || `患者${p.id.toUpperCase()}`}</div>
    `;

    card.addEventListener('dragstart', (e) => {
      state.draggedPatientId = p.id;
      e.dataTransfer.setData('text/plain', p.id);
      e.dataTransfer.effectAllowed = 'copy';
      card.style.opacity = '0.5';
    });

    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
      state.draggedPatientId = null;
    });

    card.addEventListener('click', () => {
      showToast(`${p.name || p.id.toUpperCase()} を選択中。配置したいコマをクリックしてください。`, 'info');
    });

    container.appendChild(card);
  });
}

function getSlotDurationText(startTimeStr, units) {
  const parts = startTimeStr.split(':');
  if (parts.length < 2) return `${startTimeStr} (${units * 20}分)`;

  const startH = parseInt(parts[0], 10);
  const startM = parseInt(parts[1], 10);
  const totalDurationMinutes = units * 20;

  const totalEndMinutes = startH * 60 + startM + totalDurationMinutes;
  const endH = Math.floor(totalEndMinutes / 60);
  const endM = totalEndMinutes % 60;
  const endMStr = String(endM).padStart(2, '0');

  return `${startH}:${String(startM).padStart(2, '0')}～${endH}:${endMStr}`;
}

/**
 * タイムテーブル描画（パターンC：ハイブリッド配色 ＆ 連続配置の完全対応）
 */
function renderTimetable() {
  const dayLabel = document.getElementById('schedule-day-label');
  if (dayLabel) {
    const cur = new Date(state.selectedDate);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    dayLabel.textContent = `${cur.getFullYear()}年${cur.getMonth() + 1}月${cur.getDate()}日 (${days[cur.getDay()]})`;
  }

  const container = document.getElementById('timetable-grid');
  if (!container) return;

  container.innerHTML = '';

  const schedule = getDailySchedule(state.selectedDate);
  const patientMap = {};
  getAllPatients().forEach((p) => {
    patientMap[normalizePatientId(p.id)] = p;
  });

  // 占有スロットトラッカー（前のコマの単位数に応じて後続スロットを占有）
  const occupiedSlots = {
    A: new Map(),
    B: new Map(),
    C: new Map(),
  };

  ['A', 'B', 'C'].forEach((tCode) => {
    const slots = schedule[tCode] || {};
    TIME_SLOTS.forEach((slot, idx) => {
      const slotData = slots[slot.id];
      if (slotData && slotData.patientId && slotData.units > 0) {
        const units = Math.max(1, Math.min(6, slotData.units));
        for (let i = 1; i < units; i++) {
          const nextSlot = TIME_SLOTS[idx + i];
          if (nextSlot && nextSlot.period === slot.period) {
            occupiedSlots[tCode].set(nextSlot.id, {
              rootSlotId: slot.id,
              rootSlotData: slotData,
            });
          }
        }
      }
    });
  });

  TIME_SLOTS.forEach((slot) => {
    const row = document.createElement('div');
    row.className = 'slot-row';
    row.dataset.slotId = slot.id;

    // 時間ラベル列
    const timeCell = document.createElement('div');
    timeCell.className = 'slot-time-cell';
    timeCell.textContent = slot.time;
    row.appendChild(timeCell);

    // セラピスト A, B, C 列
    ['A', 'B', 'C'].forEach((tCode) => {
      const cell = document.createElement('div');
      cell.className = 'slot-drop-cell';
      cell.dataset.therapist = tCode;
      cell.dataset.slotId = slot.id;

      const slotData = schedule[tCode]?.[slot.id];
      const isOccupiedByPrior = occupiedSlots[tCode].has(slot.id);

      if (slotData && slotData.patientId && slotData.units > 0) {
        // [1] このスロットが結合ブロックの開始コマ
        const units = Math.max(1, slotData.units);
        const pInfo = patientMap[normalizePatientId(slotData.patientId)];
        const pName = pInfo?.name || `患者${slotData.patientId.toUpperCase()}`;
        const isOutpatient = pInfo?.category && pInfo.category.startsWith('outpatient');
        const durationText = getSlotDurationText(slot.label, units);

        // パターンCのクラス判定
        const typeClass = isOutpatient ? 'patient-type-outpatient' : 'patient-type-inpatient';
        const unitThemeClass = units >= 4 ? 'unit-theme-4' : `unit-theme-${units}`;
        const spanClass = `span-units-${Math.min(units, 4)}`;

        const card = document.createElement('div');
        card.className = `slot-pill-card ${typeClass} ${unitThemeClass} ${spanClass}`;

        card.innerHTML = `
          <div class="slot-patient-title" style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.1rem;">
              <span class="slot-id-badge">${slotData.patientId.toUpperCase()}</span>
              <span class="slot-name-label" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${pName}</span>
            </div>
            <div class="slot-time-sub">
              🕒 ${durationText} (${units * 20}分)
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; flex-shrink: 0; margin-left: 0.35rem;">
            <span class="slot-unit-tag">${units}単位</span>
          </div>
        `;

        card.addEventListener('click', (e) => {
          e.stopPropagation();
          openSlotEditModal(state.selectedDate, tCode, slot.id);
        });

        cell.appendChild(card);
      } else if (isOccupiedByPrior) {
        // [2] 前のコマ（2単位/3単位）の結合により占有されているコマ
        const parentInfo = occupiedSlots[tCode].get(slot.id);
        cell.classList.add('slot-covered-placeholder');
        cell.title = `前のコマ（${parentInfo.rootSlotId}）により ${parentInfo.rootSlotData.patientId.toUpperCase()} さんが実施中`;
        cell.addEventListener('click', () => {
          openSlotEditModal(state.selectedDate, tCode, parentInfo.rootSlotId);
        });
      } else {
        // [3] 空きコマ（ドロップ ＆ クリックで配置可能）
        const hint = document.createElement('span');
        hint.className = 'slot-empty-hint';
        hint.textContent = '＋ 追加';
        cell.appendChild(hint);

        // ドラッグ＆ドロップイベント
        cell.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          cell.classList.add('drag-hover');
        });

        cell.addEventListener('dragleave', () => {
          cell.classList.remove('drag-hover');
        });

        cell.addEventListener('drop', (e) => {
          e.preventDefault();
          cell.classList.remove('drag-hover');
          const pId = e.dataTransfer.getData('text/plain') || state.draggedPatientId;
          if (pId) {
            handleSlotDropped(state.selectedDate, tCode, slot.id, pId);
          }
        });

        cell.addEventListener('click', () => {
          openSlotEditModal(state.selectedDate, tCode, slot.id);
        });
      }

      row.appendChild(cell);
    });

    container.appendChild(row);
  });
}

function handleSlotDropped(dateStr, therapistCode, slotId, patientId) {
  const p = getAllPatients().find((item) => normalizePatientId(item.id) === normalizePatientId(patientId));
  const pName = p?.name || patientId.toUpperCase();

  // デフォルト2単位の配置前に月13単位制限を検証
  if (!validateMonthly13UnitsLimit(dateStr, therapistCode, slotId, patientId, 2, false)) {
    return;
  }

  // デフォルト2単位 (40分) で配置
  setScheduleSlot(dateStr, therapistCode, slotId, {
    patientId: normalizePatientId(patientId),
    units: 2,
    note: '',
  });

  renderTimetable();
  renderDailyKPIs();
  renderDailyDiaryPreview();
  renderMonthlyUnitsTable();
  showToast(`${pName} を PT ${therapistCode} に配置しました (2単位 / 40分)`, 'success');
}

function renderDailyKPIs() {
  const stats = getDailyStats(state.selectedDate);

  const kpiA = document.getElementById('kpi-therapist-A');
  const kpiB = document.getElementById('kpi-therapist-B');
  const kpiC = document.getElementById('kpi-therapist-C');
  const patA = document.getElementById('kpi-patients-A');
  const patB = document.getElementById('kpi-patients-B');
  const patC = document.getElementById('kpi-patients-C');
  const kpiTotal = document.getElementById('kpi-clinic-total');
  const patTotal = document.getElementById('kpi-clinic-patients');

  if (kpiA) kpiA.textContent = String(stats.therapistStats.A.totalUnits);
  if (kpiB) kpiB.textContent = String(stats.therapistStats.B.totalUnits);
  if (kpiC) kpiC.textContent = String(stats.therapistStats.C.totalUnits);

  if (patA) patA.textContent = `${stats.therapistStats.A.patientCount}名`;
  if (patB) patB.textContent = `${stats.therapistStats.B.patientCount}名`;
  if (patC) patC.textContent = `${stats.therapistStats.C.patientCount}名`;

  if (kpiTotal) kpiTotal.textContent = String(stats.grandTotalUnits);
  if (patTotal) patTotal.textContent = `実人数 ${stats.grandPatientCount}名`;
}

function initSlotEditModal() {
  const modal = document.getElementById('slot-modal');
  const closeBtn = document.getElementById('modal-close-slot');
  const cancelBtn = document.getElementById('btn-cancel-slot');
  const saveBtn = document.getElementById('btn-save-slot');
  const clearBtn = document.getElementById('btn-clear-slot');
  const customUnitInput = document.getElementById('slot-modal-units');
  const presetChips = document.querySelectorAll('.preset-chip');
  const patientSelect = document.getElementById('slot-modal-patient-select');
  const patientInput = document.getElementById('slot-modal-patient');
  const timeSelect = document.getElementById('slot-modal-time');
  const therapistSelect = document.getElementById('slot-modal-therapist');

  const closeModal = () => modal?.classList.remove('show');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      presetChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      if (customUnitInput) {
        customUnitInput.value = chip.dataset.unit;
        updateModalDurationHint(parseInt(chip.dataset.unit, 10));
      }
    });
  });

  customUnitInput?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10) || 1;
    updateModalDurationHint(val);
  });

  timeSelect?.addEventListener('change', () => {
    const val = parseInt(customUnitInput?.value, 10) || 2;
    updateModalDurationHint(val);
  });

  therapistSelect?.addEventListener('change', () => {
    const val = parseInt(customUnitInput?.value, 10) || 2;
    updateModalDurationHint(val);
  });

  patientSelect?.addEventListener('change', (e) => {
    if (e.target.value && patientInput) {
      patientInput.value = e.target.value;
    }
  });

  saveBtn?.addEventListener('click', () => {
    if (!state.activeSlotModal) return;
    const { dateStr, therapistCode: origTherapist, slotId: origSlotId } = state.activeSlotModal;
    const targetSlotId = timeSelect?.value || origSlotId;
    const targetTherapist = therapistSelect?.value || origTherapist;

    const patientId = patientInput?.value?.trim();
    const units = parseInt(customUnitInput?.value, 10) || 0;
    const note = document.getElementById('slot-modal-note')?.value?.trim() || '';

    if (!patientId) {
      showToast('患者記号または氏名を入力してください。', 'warning');
      return;
    }
    if (units <= 0) {
      showToast('有効な単位数を指定してください。', 'warning');
      return;
    }

    // 月13単位制限の超過チェック
    const isSameSlot = (targetSlotId === origSlotId && targetTherapist === origTherapist);
    if (!validateMonthly13UnitsLimit(dateStr, origTherapist, origSlotId, patientId, units, isSameSlot)) {
      return; // 制限超過の場合は設定を中断
    }

    // 開始時間または担当PTが変更されている場合は、元のコマを空にして新位置へ移動
    if (targetSlotId !== origSlotId || targetTherapist !== origTherapist) {
      clearScheduleSlot(dateStr, origTherapist, origSlotId);
    }

    // 新しい時間枠・担当者枠へ設定
    setScheduleSlot(dateStr, targetTherapist, targetSlotId, { patientId, units, note });

    closeModal();
    renderTimetable();
    renderDailyKPIs();
    renderDailyDiaryPreview();
    renderMonthlyUnitsTable();
    showToast(`PT ${targetTherapist} のコマを設定しました (${units}単位 / ${units * 20}分)`, 'success');
  });

  clearBtn?.addEventListener('click', () => {
    if (!state.activeSlotModal) return;
    const { dateStr, therapistCode, slotId } = state.activeSlotModal;
    clearScheduleSlot(dateStr, therapistCode, slotId);
    closeModal();
    renderTimetable();
    renderDailyKPIs();
    renderDailyDiaryPreview();
    renderMonthlyUnitsTable();
    showToast('コマを空にしました。', 'info');
  });
}

function updateModalDurationHint(units) {
  if (!state.activeSlotModal) return;
  const timeSelect = document.getElementById('slot-modal-time');
  const therapistSelect = document.getElementById('slot-modal-therapist');

  const selectedSlotId = timeSelect?.value || state.activeSlotModal.slotId;
  const selectedTherapist = therapistSelect?.value || state.activeSlotModal.therapistCode;

  const slotInfo = TIME_SLOTS.find((s) => s.id === selectedSlotId);
  if (!slotInfo) return;

  const durationStr = getSlotDurationText(slotInfo.label, units);
  const title = document.getElementById('slot-modal-title');
  if (title) {
    title.textContent = `PT ${selectedTherapist} | ${durationStr} (${units * 20}分)`;
  }
}

function openSlotEditModal(dateStr, therapistCode, slotId) {
  const modal = document.getElementById('slot-modal');
  if (!modal) return;

  state.activeSlotModal = { dateStr, therapistCode, slotId };

  // 開始時間ドロップダウンの選択肢を生成
  const timeSelect = document.getElementById('slot-modal-time');
  if (timeSelect) {
    timeSelect.innerHTML = '';
    TIME_SLOTS.forEach((slot) => {
      const opt = document.createElement('option');
      opt.value = slot.id;
      opt.textContent = `${slot.period === 'am' ? '午前' : '午後'} ${slot.time}`;
      if (slot.id === slotId) opt.selected = true;
      timeSelect.appendChild(opt);
    });
  }

  // 担当セラピストの選択
  const therapistSelect = document.getElementById('slot-modal-therapist');
  if (therapistSelect) {
    therapistSelect.value = therapistCode;
  }

  const select = document.getElementById('slot-modal-patient-select');
  if (select) {
    const list = getAllPatients();
    select.innerHTML = `<option value="">登録患者から選択</option>`;
    list.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.id.toUpperCase()}: ${p.name || ''}`;
      select.appendChild(opt);
    });
  }

  const schedule = getDailySchedule(dateStr);
  const curSlot = schedule[therapistCode]?.[slotId];

  const pInput = document.getElementById('slot-modal-patient');
  const uInput = document.getElementById('slot-modal-units');
  const nInput = document.getElementById('slot-modal-note');

  const currentUnits = curSlot ? curSlot.units : 2;
  if (pInput) pInput.value = curSlot ? curSlot.patientId.toUpperCase() : '';
  if (uInput) uInput.value = String(currentUnits);
  if (nInput) nInput.value = curSlot ? curSlot.note || '' : '';

  document.querySelectorAll('.preset-chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.unit === String(currentUnits));
  });

  updateModalDurationHint(currentUnits);
  modal.classList.add('show');
}

function initMonthlyViews() {
  const yearSelect = document.getElementById('monthly-target-year');
  const monthSelect = document.getElementById('monthly-target-month');

  if (yearSelect) {
    yearSelect.innerHTML = '';
    for (let y = 2025; y <= 2028; y++) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `${y}年 (R${y - 2018})`;
      if (y === state.targetYear) opt.selected = true;
      yearSelect.appendChild(opt);
    }
    yearSelect.addEventListener('change', (e) => {
      state.targetYear = parseInt(e.target.value, 10);
      renderMonthlyUnitsTable();
    });
  }

  if (monthSelect) {
    monthSelect.value = String(state.targetMonth);
    monthSelect.addEventListener('change', (e) => {
      state.targetMonth = parseInt(e.target.value, 10);
      renderMonthlyUnitsTable();
    });
  }
}

function renderMonthlyUnitsTable() {
  const tbody = document.getElementById('monthly-patient-units-tbody');
  if (!tbody) return;

  const aggregated = aggregateFromAppSchedule(state.targetYear, state.targetMonth);
  const allPatients = getAllPatients();
  const patientMap = {};
  allPatients.forEach((p) => {
    patientMap[normalizePatientId(p.id)] = p;
  });

  tbody.innerHTML = '';

  const activeIds = Object.keys(aggregated.patientTotals);
  if (activeIds.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">当月の実施データはまだありません。時間割に入力してください。</td></tr>`;
    return;
  }

  activeIds.forEach((pId) => {
    const totals = aggregated.patientTotals[pId];
    const p = patientMap[pId] || { id: pId, name: `患者${pId.toUpperCase()}`, category: 'inpatient_1', diseaseType: 'LOCOMOTIVE' };
    const units = totals.totalUnits;

    const tr = document.createElement('tr');
    const isOut = p.category && p.category.startsWith('outpatient');
    const catLabel = isOut ? '外来' : '入院';
    const disLabel = REHA_RULES.LIMIT_DAYS[p.diseaseType]?.shortLabel || '運動器Ⅱ';

    let statusBadge = `<span style="color: var(--success); font-weight: 700;">算定枠内 (${units}/13)</span>`;
    if (units > 13) {
      statusBadge = `<span style="color: var(--danger); font-weight: 800; background: var(--danger-light); padding: 0.15rem 0.5rem; border-radius: var(--radius-pill);">⚠️ 13単位超過 (${units}単位)</span>`;
    } else if (units >= 11) {
      statusBadge = `<span style="color: var(--warning); font-weight: 700; background: var(--warning-light); padding: 0.15rem 0.5rem; border-radius: var(--radius-pill);">残枠わずか (${units}/13)</span>`;
    }

    tr.innerHTML = `
      <td><strong>${p.id.toUpperCase()}</strong>: ${p.name || ''}</td>
      <td><span class="palette-category-tag ${isOut ? 'tag-outpatient' : 'tag-inpatient'}">${catLabel}</span></td>
      <td>${disLabel}</td>
      <td><strong style="font-size: 1.05rem; color: var(--primary);">${units}</strong> 単位</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDailyDiaryPreview() {
  const container = document.getElementById('daily-diary-preview-container');
  const badge = document.getElementById('diary-preview-date-badge');
  if (!container) return;

  if (badge) {
    badge.textContent = state.selectedDate;
  }

  const schedule = getDailySchedule(state.selectedDate);
  const patientMap = {};
  getAllPatients().forEach((p) => {
    patientMap[normalizePatientId(p.id)] = p;
  });

  const diary = {
    inpatient: { loco: 0, cerebro: 0, disuse: 0, pain: 0, totalUnits: 0, patients: new Set() },
    outpatient: { loco: 0, cerebro: 0, disuse: 0, pain: 0, totalUnits: 0, patients: new Set() },
  };

  ['A', 'B', 'C'].forEach((tCode) => {
    const slots = schedule[tCode] || {};
    for (const s of Object.values(slots)) {
      if (s && s.patientId && s.units > 0) {
        const p = patientMap[normalizePatientId(s.patientId)];
        const isOut = p?.category && p.category.startsWith('outpatient');
        const target = isOut ? diary.outpatient : diary.inpatient;
        const dType = p?.diseaseType || 'LOCOMOTIVE';

        target.patients.add(s.patientId);
        target.totalUnits += s.units;

        if (dType === 'LOCOMOTIVE') target.loco += s.units;
        else if (dType === 'CEREBROVASCULAR') target.cerebro += s.units;
        else if (dType === 'DISUSE') target.disuse += s.units;
        else if (dType === 'ANALGESIA') target.pain += s.units;
      }
    }
  });

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem; font-size: 0.85rem;">
      <div style="background: #f8fafc; padding: 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--border-light);">
        <div style="font-weight: 800; color: var(--text-main); margin-bottom: 0.4rem; display: flex; justify-content: space-between;">
          <span>🏥 入院リハビリ</span>
          <span style="color: var(--primary);">${diary.inpatient.patients.size} 名 / ${diary.inpatient.totalUnits} 単位</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.35rem; color: var(--text-secondary); font-size: 0.8rem;">
          <div>運動器Ⅱ: <strong>${diary.inpatient.loco}</strong> 単位</div>
          <div>脳血管Ⅲ: <strong>${diary.inpatient.cerebro}</strong> 単位</div>
          <div>廃用Ⅲ: <strong>${diary.inpatient.disuse}</strong> 単位</div>
          <div>消炎鎮痛: <strong>${diary.inpatient.pain}</strong> 単位</div>
        </div>
      </div>

      <div style="background: #f8fafc; padding: 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--border-light);">
        <div style="font-weight: 800; color: var(--text-main); margin-bottom: 0.4rem; display: flex; justify-content: space-between;">
          <span>🚶 外来リハビリ</span>
          <span style="color: var(--primary);">${diary.outpatient.patients.size} 名 / ${diary.outpatient.totalUnits} 単位</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.35rem; color: var(--text-secondary); font-size: 0.8rem;">
          <div>運動器Ⅱ: <strong>${diary.outpatient.loco}</strong> 単位</div>
          <div>脳血管Ⅲ: <strong>${diary.outpatient.cerebro}</strong> 単位</div>
          <div>消炎鎮痛: <strong>${diary.outpatient.pain}</strong> 単位</div>
          <div>その他: <strong>0</strong> 単位</div>
        </div>
      </div>
    </div>
  `;
}

function initPatientMasterModal() {
  const modal = document.getElementById('patient-modal');
  const openBtn = document.getElementById('btn-add-patient-master');
  const closeBtn = document.getElementById('modal-close-patient');
  const cancelBtn = document.getElementById('btn-cancel-patient');
  const saveBtn = document.getElementById('btn-save-patient');

  const closeModal = () => modal?.classList.remove('show');
  openBtn?.addEventListener('click', () => openPatientMasterModal());
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  saveBtn?.addEventListener('click', () => {
    const id = document.getElementById('patient-modal-id')?.value?.trim();
    const name = document.getElementById('patient-modal-name')?.value?.trim();
    const category = document.getElementById('patient-modal-category')?.value;
    const diseaseType = document.getElementById('patient-modal-disease')?.value;
    const admissionDate = document.getElementById('patient-modal-admission')?.value;
    const earlyBonusStartDate = document.getElementById('patient-modal-early-start')?.value;
    const onsetDate = document.getElementById('patient-modal-onset')?.value;
    const lastPlanDate = document.getElementById('patient-modal-last-plan')?.value;
    const notes = document.getElementById('patient-modal-notes')?.value?.trim();

    if (!id) {
      showToast('患者記号は必須です。', 'warning');
      return;
    }

    upsertPatient({
      id,
      name,
      category,
      diseaseType,
      admissionDate,
      earlyBonusStartDate,
      onsetDate,
      lastPlanDate,
      notes,
    });

    closeModal();
    renderPalette();
    renderPatientDeadlines();
    showToast(`患者 ${id.toUpperCase()} を保存しました。`, 'success');
  });
}

function openPatientMasterModal(existingId = null) {
  const modal = document.getElementById('patient-modal');
  if (!modal) return;

  const p = existingId ? getAllPatients().find((item) => item.id === existingId) : null;

  document.getElementById('patient-modal-id').value = p ? p.id : '';
  document.getElementById('patient-modal-name').value = p ? p.name || '' : '';
  document.getElementById('patient-modal-category').value = p ? p.category || 'inpatient_1' : 'inpatient_1';
  document.getElementById('patient-modal-disease').value = p ? p.diseaseType || 'LOCOMOTIVE' : 'LOCOMOTIVE';
  document.getElementById('patient-modal-admission').value = p ? p.admissionDate || '' : '';
  document.getElementById('patient-modal-early-start').value = p ? p.earlyBonusStartDate || '' : '';
  document.getElementById('patient-modal-onset').value = p ? p.onsetDate || '' : '';
  document.getElementById('patient-modal-last-plan').value = p ? p.lastPlanDate || '' : '';
  document.getElementById('patient-modal-notes').value = p ? p.notes || '' : '';

  modal.classList.add('show');
}

function renderPatientDeadlines() {
  const tbody = document.getElementById('patient-deadlines-tbody');
  if (!tbody) return;

  const patients = getAllPatients();
  tbody.innerHTML = '';

  patients.forEach((p) => {
    const calc = calculatePatientDeadlines(p, new Date(state.selectedDate));
    const tr = document.createElement('tr');

    const isOut = p.category && p.category.startsWith('outpatient');
    const catLabel = isOut ? '外来' : '入院';

    let earlyBadge = '<span style="color: var(--text-dim);">-</span>';
    if (calc.earlyBonusStatus === 'PHASE_1_ACTIVE') {
      earlyBadge = '<span class="status-pill" style="background: #eff6ff; color: #1d4ed8; font-weight: 700;">第1期 (4日以内)</span>';
    } else if (calc.earlyBonusStatus === 'PHASE_2_ACTIVE') {
      earlyBadge = '<span class="status-pill" style="background: #f0fdf4; color: #15803d; font-weight: 700;">第2期 (14日以内)</span>';
    } else if (calc.earlyBonusStatus === 'EXPIRED') {
      earlyBadge = '<span style="color: var(--text-dim); font-size: 0.75rem;">加算終了</span>';
    }

    let planBadge = calc.nextPlanLimitStr || '-';
    if (calc.planStatus === 'WARNING') {
      planBadge += ' <span style="color: var(--warning); font-weight: 700;">(間近)</span>';
    } else if (calc.planStatus === 'EXPIRED') {
      planBadge += ' <span style="color: var(--danger); font-weight: 800;">(超過)</span>';
    }

    tr.innerHTML = `
      <td><strong>${p.id.toUpperCase()}</strong></td>
      <td>${p.name || ''}</td>
      <td><span class="palette-category-tag ${isOut ? 'tag-outpatient' : 'tag-inpatient'}">${catLabel}</span></td>
      <td>${calc.diseaseLabel || '運動器Ⅱ'}</td>
      <td>${p.admissionDate || '-'}</td>
      <td>${p.earlyBonusStartDate || '-'}</td>
      <td>${p.onsetDate || '-'}</td>
      <td>${earlyBadge}</td>
      <td>${calc.rehaLimitDateStr || '上限なし'}</td>
      <td>${planBadge}</td>
      <td>
        <button class="btn-secondary-compact btn-edit-patient" data-id="${p.id}">編集</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-edit-patient').forEach((btn) => {
    btn.addEventListener('click', () => {
      openPatientMasterModal(btn.dataset.id);
    });
  });
}

function initLoanModal() {
  const modal = document.getElementById('loan-modal');
  const openBtn = document.getElementById('btn-add-loan');
  const closeBtn = document.getElementById('modal-close-loan');
  const cancelBtn = document.getElementById('btn-cancel-loan');
  const saveBtn = document.getElementById('btn-save-loan');
  const ownerType = document.getElementById('loan-owner-type');
  const vendorGroup = document.getElementById('vendor-name-group');

  const closeModal = () => modal?.classList.remove('show');
  openBtn?.addEventListener('click', () => {
    document.getElementById('loan-date').value = state.selectedDate;
    document.getElementById('loan-item-name').value = '';
    document.getElementById('loan-patient-id').value = '';
    document.getElementById('loan-vendor-name').value = '';
    document.getElementById('loan-notes').value = '';
    modal?.classList.add('show');
  });

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  ownerType?.addEventListener('change', (e) => {
    if (vendorGroup) {
      vendorGroup.style.display = e.target.value === 'VENDOR' ? 'block' : 'none';
    }
  });

  saveBtn?.addEventListener('click', () => {
    const itemName = document.getElementById('loan-item-name')?.value?.trim();
    const patientId = document.getElementById('loan-patient-id')?.value?.trim();
    const oType = ownerType?.value;
    const vendorName = document.getElementById('loan-vendor-name')?.value?.trim();
    const loanDate = document.getElementById('loan-date')?.value;
    const dueDate = document.getElementById('loan-due-date')?.value;
    const notes = document.getElementById('loan-notes')?.value?.trim();

    if (!itemName) {
      showToast('物品名を入力してください。', 'warning');
      return;
    }

    registerLoan({ itemName, patientId, ownerType: oType, vendorName, loanDate, dueDate, notes });
    closeModal();
    renderLoansTable();
    showToast('貸出を登録しました。', 'success');
  });
}

function renderLoansTable() {
  const tbody = document.getElementById('loans-tbody');
  if (!tbody) return;

  const loans = getAllLoans();
  tbody.innerHTML = '';

  if (loans.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">現在、貸出中の物品はありません。</td></tr>`;
    return;
  }

  loans.forEach((l) => {
    const tr = document.createElement('tr');
    const isVendor = l.ownerType === 'VENDOR';
    const isLoaned = l.status === 'LOANED';

    const ownerBadge = isVendor
      ? `<span class="palette-category-tag tag-outpatient">業者借用 (${l.vendorName || '外部業者'})</span>`
      : `<span class="palette-category-tag tag-inpatient">当院備品</span>`;

    const statusBadge = isLoaned
      ? `<span class="status-pill" style="background: var(--warning-light); color: var(--warning-text); font-weight: 700;">貸出中</span>`
      : `<span class="status-pill" style="background: var(--success-light); color: var(--success-text); font-weight: 700;">返却済</span>`;

    tr.innerHTML = `
      <td><strong>${l.itemName}</strong></td>
      <td>${l.patientId ? l.patientId.toUpperCase() : '-'}</td>
      <td>${ownerBadge}</td>
      <td>${l.loanDate || '-'}</td>
      <td>${l.dueDate || '-'}</td>
      <td>${statusBadge}</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${l.notes || ''}</td>
      <td>
        ${isLoaned ? `<button class="btn-secondary-compact btn-return-loan" data-id="${l.id}">返却完了</button>` : ''}
        <button class="btn-secondary-compact btn-delete-loan" data-id="${l.id}" style="color: var(--danger);">削除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-return-loan').forEach((btn) => {
    btn.addEventListener('click', () => {
      markAsReturned(btn.dataset.id);
      renderLoansTable();
      showToast('物品の返却完了を記録しました。', 'success');
    });
  });

  tbody.querySelectorAll('.btn-delete-loan').forEach((btn) => {
    btn.addEventListener('click', () => {
      deleteLoan(btn.dataset.id);
      renderLoansTable();
      showToast('貸出記録を削除しました。', 'info');
    });
  });
}

function initExportActionButtons() {
  const btnExportUketsuke = document.getElementById('btn-export-uketsuke');
  const btnExportDiary = document.getElementById('btn-export-diary');

  btnExportUketsuke?.addEventListener('click', () => {
    showToast('受付提出用Excelを生成中...', 'info');
    try {
      const aggregated = aggregateFromAppSchedule(state.targetYear, state.targetMonth);
      if (aggregated.rawRecordsCount === 0) {
        showToast('当月のリハビリ実施データがまだありません。時間割に入力してください。', 'warning');
        return;
      }

      const wb = XLSX.utils.book_new();
      const wsInpatient = XLSX.utils.aoa_to_sheet([
        ['受付提出用 単位管理', '', '', '', ''],
        ['年月:', `${state.targetYear}年${state.targetMonth}月度`],
        [],
        ['日付', '曜日', '天候', '午前', '午後', 'a', '', 'b', '', 'c'],
        ['', '', '', '', '', 'PT', 'OT', 'PT', 'OT', 'PT', 'OT'],
      ]);
      XLSX.utils.book_append_sheet(wb, wsInpatient, '実施ﾘｽﾄ 入院');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['外来']]), '  外来');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['レセプト合計']]), '(レセプト合計)入院');

      exportUketsukeSubmissionWorkbook(wb, aggregated);
      showToast('受付提出用Excelのダウンロードが完了しました。', 'success');
    } catch (err) {
      console.error(err);
      showToast(`出力エラー: ${err.message}`, 'error');
    }
  });

  btnExportDiary?.addEventListener('click', () => {
    showToast('業務日誌Excelを生成中...', 'info');
    try {
      const aggregated = aggregateFromAppSchedule(state.targetYear, state.targetMonth);
      if (aggregated.rawRecordsCount === 0) {
        showToast('当月のリハビリ実施データがまだありません。時間割に入力してください。', 'warning');
        return;
      }

      const wb = XLSX.utils.book_new();
      for (let d = 1; d <= 31; d++) {
        const ws = XLSX.utils.aoa_to_sheet([
          [`業務日誌 ${state.targetMonth}月${d}日`],
          [],
          ['区分', '項目', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '集計値'],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, `${d}日`);
      }

      exportDiaryWorkbook(wb, aggregated);
      showToast('業務日誌Excelのダウンロードが完了しました。', 'success');
    } catch (err) {
      console.error(err);
      showToast(`出力エラー: ${err.message}`, 'error');
    }
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}
