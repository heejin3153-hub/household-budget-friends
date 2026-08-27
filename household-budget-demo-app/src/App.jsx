import React, { useState, useEffect, useMemo, useRef } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar, ComposedChart } from "recharts";
import {
  Trash2, Plus, TrendingUp, TrendingDown, Wallet, Loader2,
  PiggyBank, Target, ChevronDown, ChevronUp, Download, Upload, Pencil, X, MoreVertical, Search, CheckCircle2, RotateCcw, LogOut, Bell,
} from "lucide-react";
import { storageGet, storageSet, setCurrentUid, signInWithGoogle, signOutUser, watchAuthState, setupOrVerifyPin, checkPinExists } from "./firebase";
import {
  DEFAULT_GROUPS, DEFAULT_INCOME_GROUPS, CATEGORY_RENAME_MAP, CURRENCIES, DEFAULT_LOANS,
} from "./constants";
import {
  todayStr, formatWon, formatNumberInput, parseNumberInput, monthsBetween, categoryColor, splitInstallment, txDisplaySign,
  getCycleLabel, getCycleRange, getDateForCycleDay, formatCycleLabel,
} from "./utils";
import DatePickerField from "./components/DatePickerField";
import ProgressBar from "./components/ProgressBar";

const TX_KEY = "household-budget-transactions";
const SETTINGS_KEY = "household-budget-settings";
const LOANS_KEY = "household-budget-loans";
const RECURRING_KEY = "household-budget-recurring";
const BUDGETS_KEY = "household-budget-monthly-budgets";
const CATEGORY_CONFIG_KEY = "household-budget-category-config";
const ASSETS_KEY = "household-budget-assets";

// 업데이트 내역 — 사용자가 명시적으로 요청할 때만 새 항목을 배열 맨 앞에 추가하세요.
// (자동/임의로 새로 추가하지 마세요. 최신순 유지.)
// 맨 위(UPDATE_HISTORY[0])가 로그인 직후 뜨는 안내 팝업 내용이 되고,
// 헤더 메뉴의 "업데이트 내역"에서는 전체가 날짜별로 다 보여요.
const UPDATE_HISTORY = [
  {
    date: "2026-08-26",
    items: [
      {
        emoji: "📊",
        title: "통계 탭 추가",
        body: `통계 탭에서 월별 수입·지출 그래프, 카테고리별 지출 추이를 한눈에 확인할 수 있어요.`,
      },
      {
        emoji: "💰",
        title: "통계탭 - 자산·부채 관리",
        body: "매월 자산·부채를 업데이트하고, 순자산 추이를 확인해보세요.",
        note: "지출 내역과는 연동되지 않아서, 자산·부채 금액은 직접 입력해주셔야 해요.",
        bullets: [
          "자산·부채를 원하는 이름으로 직접 추가할 수 있어요",
          "대출 잔액도 이 카드에서 같이 관리돼요",
          "월 단위로 기록해서, 한 번 입력해두면 다음 달에도 자동으로 이어져서 보여요",
          "한 달에 한 번 정도는 실제 잔액을 업데이트해주시는 걸 추천해요 — 순자산 그래프가 더 정확해져요",
          "통계 탭에서 자산·부채·순자산 흐름을 그래프로도 볼 수 있어요",
        ],
      },
      {
        emoji: "💵",
        title: "홈탭 - 현금흐름표 추가",
        body: `"이번 달 잔액 계산" 카드에 "요약보기 / 현금흐름표" 버튼이 생겼어요. 한 달의 현금흐름을 한눈에 파악해보세요.`,
        bullets: [
          "요약보기: 기존이랑 똑같이 간단하게",
          `현금흐름표: 이번 달 수입을 고정지출 / 자산형성지출(저축·투자, 대출 원금상환) / 변동지출로 나눠서 보여줘요. "마음대로 써도 되는 돈"이 얼마 남았는지도 확인할 수 있어요.`,
        ],
      },
      {
        emoji: "📅",
        title: "정산 시작일 설정",
        body: `급여일에 맞게 정산 시작일을 설정할 수 있어요 (예: 25일~다음달 24일). 헤더 ⋯ 메뉴에서 설정할 수 있어요.`,
      },
      {
        emoji: "📥",
        title: "백업 기능 강화",
        body: `헤더 ⋯ 메뉴 → "엑셀 백업"으로 대출·자산·부채 포함 전체 데이터를 엑셀로 내보내고, 불러올 수 있어요. 혹시 모를 상황에 대비해서 가끔 백업 받아두시는 걸 추천해요!`,
      },
    ],
  },
];
// "다시 안 보기"는 최신 업데이트 날짜 기준으로 기억돼요 — 새 업데이트가 생기면 자동으로 다시 떠요
const WHATS_NEW_VERSION = UPDATE_HISTORY[0].date;
const WHATS_NEW_DISMISS_KEY = "household-budget-whats-new-dismissed";

// 🎯 특정 월의 자산 스냅샷을 가져와요
// 그 달에 직접 기록한 게 없으면, 그 이전 가장 최근 기록을 이어받아요 (누적 방식)
// 예: 7월에만 기록했으면, 8월/9월/10월에서 조회할 때 다 7월 값을 보여줌
function getEffectiveAssetSnapshot(snapshots, month) {
  // 이 달에 직접 기록한 게 있으면 그걸 쓰고
  if (snapshots[month]) return snapshots[month];
  // 없으면 그 이전 달 중 가장 최근 기록을 찾아서 이어받아요
  const priorMonths = Object.keys(snapshots).filter((m) => m < month).sort();
  if (priorMonths.length > 0) return snapshots[priorMonths[priorMonths.length - 1]];
  // 기록이 하나도 없으면 null 반환
  return null;
}

// 🎯 대출을 만든 월을 추측해요
// 대출 ID에 생성 시각이 들어있어요 (Date.now() 기반)
// 이걸로 "지난 달에 이 대출이 실제로 있었는지" 판단하는 데 쓰여요
// 예: 10월에 대출을 만들면 9월 화면에선 이 대출이 안 보임 (아직 없었으니까)
function getLoanCreationMonth(loanId) {
  // ID 첫 부분(생성 시각)을 꺼내요
  const ts = Number(String(loanId).split("-")[0]);
  if (!ts || isNaN(ts)) return null;
  // 타임스탬프를 "2024-10" 형식의 월로 변환
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getEffectiveLoanBalances(monthlySnapshots, month, loans) {
  const snapshots = monthlySnapshots || {};
  const exact = snapshots[month];
  const priorMonths = Object.keys(snapshots).filter((m) => m <= month).sort();
  const source = exact ? month : (priorMonths.length > 0 ? priorMonths[priorMonths.length - 1] : null);
  const sourceBalances = source ? snapshots[source] : {};
  const result = {};
  loans.forEach((l) => {
    if (source && sourceBalances[l.id] != null) {
      result[l.id] = sourceBalances[l.id]; // 직접 기록해둔 값이 있으면 항상 이게 우선이에요
      return;
    }
    const createdMonth = getLoanCreationMonth(l.id);
    if (createdMonth && createdMonth > month) return; // 기록이 없고, 아직 생기기 전 달이면 원금도 안 보여줘요
    result[l.id] = Number(l.originalBalance ?? l.balance) || 0;
  });
  return result;
}

function renderDeltaBadge(current, prev) {
  if (prev == null || prev === 0) return null;
  const delta = Math.round(((current - prev) / Math.abs(prev)) * 100);
  if (delta === 0) return <span className="text-slate-300">(-)</span>;
  return (
    <span className="text-slate-500 font-medium whitespace-nowrap">
      {delta > 0 ? `(🔺${delta}%)` : `(🔻${Math.abs(delta)}%)`}
    </span>
  );
}

// 스택 막대 위에 그 달 합계 + 전월대비 증감을 보여주는 라벨 (맨 위 세그먼트에만 붙여요)
// 금액 크기에 따라 만원/억원 단위를 자동으로 골라서 짧게 표시해요.
function formatChartAmount(v) {
  const abs = Math.abs(v);
  if (abs >= 100000000) {
    const eok = v / 100000000;
    const rounded = Math.round(eok * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}억`;
  }
  if (abs >= 10000) {
    return `${Math.round(v / 10000)}만`;
  }
  return `${Math.round(v).toLocaleString()}원`;
}

function makeStackedTotalLabel(dataArr, subCats) {
  return (props) => {
    const { x, y, width, index } = props;
    const row = dataArr[index];
    const total = subCats.reduce((s, c) => s + (row[c] || 0), 0);
    const cx = x + width / 2;
    return (
      <text x={cx} y={y - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="#334155">
        {formatChartAmount(total)}
      </text>
    );
  };
}

// 막대 위에 금액을 보여주는 라벨 (수입/지출, 자산/부채 같은 그룹형 막대용).
// otherKey를 주면, 같은 달 옆 막대랑 실제 픽셀 높이를 비교해서 라벨끼리 안 겹치게 최소 간격을 보장해요.
function makeBarValueLabel(dataArr, key, otherKey) {
  return (props) => {
    const { x, y, width, height, value, index } = props;
    if (!value) return null;
    const cx = x + width / 2;
    let lift = 0;
    if (otherKey && height > 0) {
      const otherValue = Number(dataArr[index]?.[otherKey]) || 0;
      if (otherValue > 0) {
        const otherHeight = otherValue * (height / value); // 같은 스케일 기준 상대 막대의 실제 픽셀 높이
        const heightDiff = Math.abs(height - otherHeight);
        const MIN_GAP = 14; // 라벨 두 줄이 안 겹치는 데 필요한 최소 픽셀 간격
        if (heightDiff < MIN_GAP && value <= otherValue) {
          // 내가 더 짧거나 같은 막대일 때만, 상대 라벨보다 확실히 MIN_GAP만큼 위로 올라가게 띄워요
          // (둘 다 띄우면 다시 겹치니 한쪽만 올림 — 자연 간격(heightDiff)을 넘어서 MIN_GAP만큼 더 가야 해요)
          lift = heightDiff + MIN_GAP;
        }
      }
    }
    return (
      <text x={cx} y={y - 5 - lift} textAnchor="middle" fontSize={9} fontWeight={700} fill="#334155">
        {formatChartAmount(value)}
      </text>
    );
  };
}

// 선그래프 위 점마다 금액을 보여주는 라벨 (순현금흐름/순자산용). 막대 라벨이랑 안 겹치게 점 아래쪽에 배경 있는 텍스트로 표시해요.
function makeLineValueLabel(color) {
  return (props) => {
    const { x, y, value } = props;
    if (value == null) return null;
    const text = formatChartAmount(value);
    const w = text.length * 6.5 + 6;
    return (
      <g>
        <rect x={x - w / 2} y={y + 5} width={w} height={14} rx={3} fill="white" fillOpacity={0.9} />
        <text x={x} y={y + 15} textAnchor="middle" fontSize={9} fontWeight={700} fill={color || "#0369a1"}>
          {text}
        </text>
      </g>
    );
  };
}

// 도넛 차트 조각마다 바깥쪽에 선으로 이어서 "이름 · 퍼센트" 라벨을 바로 붙여줘요.
const PIE_LABEL_RADIAN = Math.PI / 180;
function renderPieSliceLabel(props) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent, name, fill } = props;
  if (percent < 0.03) return null; // 3% 미만은 겹쳐서 안 보이니 생략
  const lineEndRadius = outerRadius + 10;
  const labelRadius = outerRadius + 14;
  const x1 = cx + outerRadius * Math.cos(-midAngle * PIE_LABEL_RADIAN);
  const y1 = cy + outerRadius * Math.sin(-midAngle * PIE_LABEL_RADIAN);
  const x2 = cx + lineEndRadius * Math.cos(-midAngle * PIE_LABEL_RADIAN);
  const y2 = cy + lineEndRadius * Math.sin(-midAngle * PIE_LABEL_RADIAN);
  const xLabel = cx + labelRadius * Math.cos(-midAngle * PIE_LABEL_RADIAN);
  const yLabel = cy + labelRadius * Math.sin(-midAngle * PIE_LABEL_RADIAN);
  const isRight = xLabel >= cx;
  return (
    <g>
      <path d={`M${x1},${y1}L${x2},${y2}`} stroke={fill} strokeWidth={1.5} fill="none" />
      <text x={xLabel} y={yLabel - 6} textAnchor={isRight ? "start" : "end"} dominantBaseline="central" fontSize={11} fontWeight={600} fill="#334155">
        {name}
      </text>
      <text x={xLabel} y={yLabel + 7} textAnchor={isRight ? "start" : "end"} dominantBaseline="central" fontSize={10} fontWeight={500} fill="#94a3b8">
        {(percent * 100).toFixed(0)}%
      </text>
    </g>
  );
}

function HouseholdBudget() {
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState({ mySalary: 0, spouseGive: 0, title: "우리집 가계부", fxCurrency: "JPY", fxRate: 0, loanModeEnabled: true, cycleStartDay: 1 });
  const [loanData, setLoanData] = useState({ targetDate: "", loans: DEFAULT_LOANS, monthlySnapshots: {} });
  const [recurringItems, setRecurringItems] = useState([]);
  const [monthlyBudgets, setMonthlyBudgets] = useState({});
  const [groups, setGroups] = useState(DEFAULT_GROUPS);
  const [incomeGroups, setIncomeGroups] = useState(DEFAULT_INCOME_GROUPS);
  const [editingBudgetGroupId, setEditingBudgetGroupId] = useState(null);
  const [budgetEditMode, setBudgetEditMode] = useState(false);
  const [showBudgetMenu, setShowBudgetMenu] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [draftGroups, setDraftGroups] = useState([]);
  const [draftIncomeGroups, setDraftIncomeGroups] = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [newCatText, setNewCatText] = useState({});
  const [newGroupName, setNewGroupName] = useState("");
  const [viewportH, setViewportH] = useState(typeof window !== "undefined" ? window.innerHeight : 700);
  useEffect(() => {
    function onResize() { setViewportH(window.innerHeight); }
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [showRecurring, setShowRecurring] = useState(false);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [newRecurName, setNewRecurName] = useState("");
  const [newRecurCategory, setNewRecurCategory] = useState(DEFAULT_GROUPS.find((g) => g.id === "fixed").categories[0]);
  const [newRecurAmount, setNewRecurAmount] = useState("");
  const [newRecurDay, setNewRecurDay] = useState("1");
  const [editingRecurId, setEditingRecurId] = useState(null);
  const [confirmDeleteInRecurSheet, setConfirmDeleteInRecurSheet] = useState(false);
  const [recurDraftName, setRecurDraftName] = useState("");
  const [recurDraftCategory, setRecurDraftCategory] = useState("");
  const [recurDraftAmount, setRecurDraftAmount] = useState("");
  const [recurDraftDay, setRecurDraftDay] = useState(1);
  function openRecurEditSheet(item) {
    setEditingRecurId(item.id);
    setRecurDraftName(item.name);
    setRecurDraftCategory(item.category);
    setRecurDraftAmount(String(item.amount || 0));
    setRecurDraftDay(item.day || 1);
    setConfirmDeleteInRecurSheet(false);
  }
  function saveRecurEditSheet() {
    const name = recurDraftName.trim();
    if (!name) return;
    const next = recurringItems.map((r) =>
      r.id === editingRecurId ? { ...r, name, category: recurDraftCategory, amount: Number(recurDraftAmount) || 0, day: recurDraftDay } : r
    );
    persistRecurring(next);
    setEditingRecurId(null);
  }
  function closeRecurEditSheet() {
    setEditingRecurId(null);
    setConfirmDeleteInRecurSheet(false);
  }
  const [showInstallment, setShowInstallment] = useState(false);
  const [instName, setInstName] = useState("");
  const [instTotal, setInstTotal] = useState("");
  const [instMonths, setInstMonths] = useState("");
  const [instStartMonth, setInstStartMonth] = useState(todayStr().slice(0, 7));
  // 할부 카테고리 초기값을 첫 유효 카테고리로 설정
  const defaultInstCategory = useMemo(() => {
    const firstCat = groups[0]?.categories[0];
    return firstCat || "예산 외 쇼핑";
  }, [groups]);
  const [instCategory, setInstCategory] = useState(defaultInstCategory);
  useEffect(() => {
    setInstCategory(defaultInstCategory);
  }, [defaultInstCategory]);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState("");
  const [toastType, setToastType] = useState("success"); // "success" = 자동 사라짐, "error" = 유지

  useEffect(() => {
    if (!toast || toastType === "error") return;
    const timer = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(timer);
  }, [toast, toastType]);
  const [lastFailedSave, setLastFailedSave] = useState(null);

  useEffect(() => {
    import("xlsx"); // 엑셀 백업/불러오기 기능을 미리 로드해서, 처음 눌러도 바로 동작하게 해요
  }, []);

  // 아래 값들은 groups/incomeCategories state로부터 매 렌더마다 계산돼요 (카테고리 관리에서 직접 수정 가능)
  const LIVING_CATEGORIES = groups.find((g) => g.id === "living")?.categories || [];
  const ALLOWANCE_CATEGORIES = groups.find((g) => g.id === "allowance")?.categories || [];
  const FIXED_CATEGORIES = groups.find((g) => g.id === "fixed")?.categories || [];
  const OTHER_EXPENSE_CATEGORIES = groups.find((g) => g.id === "other")?.categories || [];
  const EXPENSE_GROUPS = groups.map((g) => ({ label: g.label, items: g.categories }));
  const INCOME_CATEGORIES = incomeGroups.flatMap((g) => g.categories);

  const [type, setType] = useState("expense");
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState(LIVING_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [travelMode, setTravelMode] = useState(false);
  const [foreignAmount, setForeignAmount] = useState("");
  const [emType, setEmType] = useState("expense");
  const [emDate, setEmDate] = useState(todayStr());
  const [emCategory, setEmCategory] = useState(LIVING_CATEGORIES[0]);
  const [emAmount, setEmAmount] = useState("");
  const [emMemo, setEmMemo] = useState("");
  const [emTravelMode, setEmTravelMode] = useState(false);
  const [emForeignAmount, setEmForeignAmount] = useState("");

  const [selectedMonth, setSelectedMonth] = useState(todayStr().slice(0, 7));
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showCycleModal, setShowCycleModal] = useState(false);
  const [cycleDraft, setCycleDraft] = useState(1);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [newLoanName, setNewLoanName] = useState("");
  const [newLoanBalance, setNewLoanBalance] = useState("");
  const [newLoanRate, setNewLoanRate] = useState("");
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState(null);
  const [longPressTx, setLongPressTx] = useState(null);
  const [isNegative, setIsNegative] = useState(false);
  const [emIsNegative, setEmIsNegative] = useState(false);
  const [confirmDeleteLoanId, setConfirmDeleteLoanId] = useState(null);
  const [confirmCompleteLoanId, setConfirmCompleteLoanId] = useState(null);
  const [showCompletedLoans, setShowCompletedLoans] = useState(false);
  const [showLoanMenu, setShowLoanMenu] = useState(false);
  const [showAssetInputCard, setShowAssetInputCard] = useState(false);
  const [showAddAssetForm, setShowAddAssetForm] = useState(false);
  const [showAddLiabilityForm, setShowAddLiabilityForm] = useState(false);
  const [assetErrorMsg, setAssetErrorMsg] = useState("");
  const [liabilityErrorMsg, setLiabilityErrorMsg] = useState("");
  const [showAssetBar, setShowAssetBar] = useState(true);
  const [showDebtBar, setShowDebtBar] = useState(true);
  const [showNetBar, setShowNetBar] = useState(false);
  const [showLoanDetails, setShowLoanDetails] = useState(false);
  const [showTxDetails, setShowTxDetails] = useState(true);
  const [visibleCount, setVisibleCount] = useState(20);
  const [viewMode, setViewMode] = useState("grouped");
  const [expandedCats, setExpandedCats] = useState(new Set());
  function toggleCatExpand(key) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const [showAddLoanForm, setShowAddLoanForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterYear, setFilterYear] = useState(todayStr().slice(0, 4));
  const [filterMonth, setFilterMonth] = useState(todayStr().slice(5, 7));
  const [sortBy, setSortBy] = useState("date_desc");
  const [page, setPage] = useState("home"); // "home" | "stats"
  const [statsPeriod, setStatsPeriod] = useState("6"); // "3" | "6" | "12" | "all" | "custom"
  const [statsFrom, setStatsFrom] = useState("");
  const [statsTo, setStatsTo] = useState("");
  const [showIncome, setShowIncome] = useState(true);
  const [showExpense, setShowExpense] = useState(true);
  const [showNet, setShowNet] = useState(false);
  const [statsCategoryGroup, setStatsCategoryGroup] = useState("전체");
  const [assetData, setAssetData] = useState({ monthlySnapshots: {} });
  const [newLiabilityName, setNewLiabilityName] = useState("");
  const [newLiabilityAmount, setNewLiabilityAmount] = useState("");
  const [confirmDeleteSnapshotMonth, setConfirmDeleteSnapshotMonth] = useState(null);
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetAmount, setNewAssetAmount] = useState("");
  const [assetViewMonth, setAssetViewMonth] = useState(todayStr().slice(0, 7));
  const [assetSheetItem, setAssetSheetItem] = useState(null); // { type: 'asset'|'liability', id, name, amount } | null
  const [assetSheetMode, setAssetSheetMode] = useState("menu"); // 'menu' | 'edit' | 'delete'
  const [assetSheetNameDraft, setAssetSheetNameDraft] = useState("");
  const [assetSheetAmountDraft, setAssetSheetAmountDraft] = useState("");
  const [showAssetHelpModal, setShowAssetHelpModal] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(
    () => typeof window !== "undefined" && localStorage.getItem(WHATS_NEW_DISMISS_KEY) !== WHATS_NEW_VERSION
  );
  const [showUpdateHistory, setShowUpdateHistory] = useState(false);
  const [whatsNewHasMore, setWhatsNewHasMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const whatsNewScrollRef = useRef(null);
  const historyScrollRef = useRef(null);
  function checkScrollBottom(el, setHasMore) {
    if (!el) return;
    setHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }
  useEffect(() => {
    if (showWhatsNew) checkScrollBottom(whatsNewScrollRef.current, setWhatsNewHasMore);
  }, [showWhatsNew]);
  useEffect(() => {
    if (showUpdateHistory) checkScrollBottom(historyScrollRef.current, setHistoryHasMore);
  }, [showUpdateHistory]);
  const [showRecordedMonths, setShowRecordedMonths] = useState(false);
  const [reportMonth, setReportMonth] = useState(todayStr().slice(0, 7));
  const [balanceCardView, setBalanceCardView] = useState("summary"); // "summary" | "detail"
  const [pieGroupFilter, setPieGroupFilter] = useState("생활비");
  useEffect(() => {
    if (pieGroupFilter !== "전체" && !groups.some((g) => g.label === pieGroupFilter)) {
      setPieGroupFilter("전체");
    }
  }, [groups, pieGroupFilter]);

  useEffect(() => {
    (async () => {
      try {
        const txRes = await storageGet(TX_KEY);
        if (txRes && txRes.value) {
          const loaded = JSON.parse(txRes.value);
          let changed = false;
          const migrated = loaded.map((t) => {
            if (CATEGORY_RENAME_MAP[t.category]) {
              changed = true;
              return { ...t, category: CATEGORY_RENAME_MAP[t.category] };
            }
            return t;
          });
          setTransactions(migrated);
          if (changed) {
            try { await storageSet(TX_KEY, migrated); } catch (e) {}
          }
        }
      } catch (e) {}
      try {
        const sRes = await storageGet(SETTINGS_KEY);
        if (sRes && sRes.value) {
          const loadedSettings = JSON.parse(sRes.value);
          if (!loadedSettings.cycleStartDay) loadedSettings.cycleStartDay = 1;
          setSettings(loadedSettings);
          if (loadedSettings.defaultPieGroup) setPieGroupFilter(loadedSettings.defaultPieGroup);
          if (loadedSettings.cycleStartDay > 1) {
            setSelectedMonth(getCycleLabel(todayStr(), loadedSettings.cycleStartDay));
            setReportMonth(getCycleLabel(todayStr(), loadedSettings.cycleStartDay));
          }
        }
      } catch (e) {}
      try {
        const lRes = await storageGet(LOANS_KEY);
        if (lRes && lRes.value) {
          const parsed = JSON.parse(lRes.value);
          if (!parsed.monthlySnapshots) {
            const month = todayStr().slice(0, 7);
            const balances = {};
            (parsed.loans || []).forEach((l) => { balances[l.id] = Number(l.balance) || 0; });
            parsed.monthlySnapshots = { [month]: balances };
          }
          setLoanData(parsed);
        } else {
          const seeded = { targetDate: "", loans: DEFAULT_LOANS, monthlySnapshots: {} };
          setLoanData(seeded);
          await storageSet(LOANS_KEY, seeded);
        }
      } catch (e) {}
      try {
        const rRes = await storageGet(RECURRING_KEY);
        if (rRes && rRes.value) {
          const loadedR = JSON.parse(rRes.value);
          let rChanged = false;
          const migratedR = loadedR.map((r) => {
            if (CATEGORY_RENAME_MAP[r.category]) {
              rChanged = true;
              return { ...r, category: CATEGORY_RENAME_MAP[r.category] };
            }
            return r;
          });
          setRecurringItems(migratedR.map((r) => ({ day: 1, ...r })));
          if (rChanged) {
            try { await storageSet(RECURRING_KEY, migratedR); } catch (e) {}
          }
        }
      } catch (e) {}
      try {
        const bRes = await storageGet(BUDGETS_KEY);
        if (bRes && bRes.value) setMonthlyBudgets(JSON.parse(bRes.value));
      } catch (e) {}
      try {
        const cRes = await storageGet(CATEGORY_CONFIG_KEY);
        if (cRes && cRes.value) {
          const parsed = JSON.parse(cRes.value);
          if (parsed.groups) setGroups(parsed.groups);
          if (parsed.incomeGroups) {
            setIncomeGroups(parsed.incomeGroups);
          } else if (parsed.incomeCategories) {
            // 예전 버전(낱개 목록) 데이터를 그룹 구조로 자동 이관
            setIncomeGroups([{ id: "income", label: "수입", categories: parsed.incomeCategories }]);
          }
        }
      } catch (e) {}
      try {
        const aRes = await storageGet(ASSETS_KEY);
        if (aRes && aRes.value) {
          const parsed = JSON.parse(aRes.value);
          if (parsed.monthlySnapshots) {
            setAssetData(parsed);
          } else if ((parsed.items && parsed.items.length > 0) || (parsed.liabilities && parsed.liabilities.length > 0)) {
            // 예전(일자 기준) 구조 -> 이번 달 기록으로 이관해요. 예전 히스토리는 새 방식과 안 맞아서 이관 안 해요.
            // 옮길 내용이 실제로 있을 때만 이관해요 (빈 배열이면 유령 기록만 생기니 건너뛰어요).
            setAssetData({ monthlySnapshots: { [todayStr().slice(0, 7)]: { items: parsed.items || [], liabilities: parsed.liabilities || [] } } });
          }
        }
      } catch (e) {}
      setLoading(false);
    })();
  }, []);

  const debounceTimers = useRef({});
  const importInputRef = useRef(null);
  const amountInputRef = useRef(null);
  const memoInputRef = useRef(null);
  const submitBtnRef = useRef(null);
  const addFormRef = useRef(null);
  const assetNameInputRef = useRef(null);
  const liabilityNameInputRef = useRef(null);
  function debouncedSave(key, value, errorMsg, delay = 700) {
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      try {
        const result = await storageSet(key, value);
        if (result) { setSaveError(""); setLastFailedSave(null); }
        else { setSaveError(errorMsg); setLastFailedSave({ key, value, errorMsg }); }
      } catch (e) {
        setSaveError(errorMsg);
        setLastFailedSave({ key, value, errorMsg });
      }
    }, delay);
  }

  async function persistTx(next) {
    setTransactions(next);
    try {
      const result = await storageSet(TX_KEY, next);
      if (result) { setSaveError(""); setLastFailedSave(null); return true; }
      else {
        setSaveError("저장에 실패했어요. 다시 시도해주세요.");
        setLastFailedSave({ key: TX_KEY, value: next, errorMsg: "저장에 실패했어요. 다시 시도해주세요." });
        return false;
      }
    } catch (e) {
      setSaveError("저장에 실패했어요. 다시 시도해주세요.");
      setLastFailedSave({ key: TX_KEY, value: next, errorMsg: "저장에 실패했어요. 다시 시도해주세요." });
      return false;
    }
  }
  function persistSettings(next) {
    setSettings(next);
    debouncedSave(SETTINGS_KEY, next, "설정 저장에 실패했어요.");
  }
  function persistLoans(next) {
    const month = todayStr().slice(0, 7);
    const balances = {};
    (next.loans || []).forEach((l) => { balances[l.id] = Number(l.balance) || 0; });
    const nextWithSnapshot = {
      ...next,
      monthlySnapshots: { ...(next.monthlySnapshots || loanData.monthlySnapshots || {}), [month]: balances },
    };
    setLoanData(nextWithSnapshot);
    debouncedSave(LOANS_KEY, nextWithSnapshot, "대출 정보 저장에 실패했어요.");
  }
  function saveLoanHistoryBalance(loanId, month, balanceValue) {
    const effectiveNow = getEffectiveLoanBalances(loanData.monthlySnapshots, month, loanData.loans);
    const monthSnapshot = { ...effectiveNow, [loanId]: Number(balanceValue) || 0 };
    const nextSnapshots = { ...(loanData.monthlySnapshots || {}), [month]: monthSnapshot };
    const currentMonth = todayStr().slice(0, 7);
    const nextLoans = month === currentMonth
      ? loanData.loans.map((l) => (l.id === loanId ? { ...l, balance: Number(balanceValue) || 0 } : l))
      : loanData.loans;
    const next = { ...loanData, loans: nextLoans, monthlySnapshots: nextSnapshots };
    setLoanData(next);
    debouncedSave(LOANS_KEY, next, "대출 정보 저장에 실패했어요.");
    setToast(`${formatCycleLabel(month, 1)} 대출 잔액을 저장했어요`);
  }
  function persistAssetSnapshot(nextItems, nextLiabilities) {
    const next = {
      monthlySnapshots: {
        ...assetData.monthlySnapshots,
        [assetViewMonth]: { items: nextItems, liabilities: nextLiabilities },
      },
    };
    setAssetData(next);
    debouncedSave(ASSETS_KEY, next, "자산 정보 저장에 실패했어요.");
  }
  function persistAssetItems(nextItems) {
    persistAssetSnapshot(nextItems, effectiveAssetView.liabilities);
  }
  function persistLiabilityItems(nextLiabilities) {
    persistAssetSnapshot(effectiveAssetView.items, nextLiabilities);
  }
  function addAssetItem(e) {
    e.preventDefault();
    if (!newAssetName.trim()) return false;
    const name = newAssetName.trim();
    const amount = Number(newAssetAmount) || 0;

    // 중복 체크
    if (effectiveAssetView.items.some((a) => a.name === name)) {
      setAssetErrorMsg("같은 이름의 자산이 이미 있어요");
      assetNameInputRef.current?.focus();
      return false;
    }
    setAssetErrorMsg("");
    
    const nextSnapshots = { ...(assetData.monthlySnapshots || {}) };
    nextSnapshots[assetViewMonth] = {
      items: [...effectiveAssetView.items, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, amount }],
      liabilities: effectiveAssetView.liabilities,
    };
    // 이 달 이후로 이미 "직접 기록"이 있는 달들엔 이월이 안 되니, 새로 추가한 항목을 거기에도 같이 넣어줘요.
    let laterCount = 0;
    Object.keys(assetData.monthlySnapshots || {}).filter((m) => m > assetViewMonth).forEach((m) => {
      const snap = assetData.monthlySnapshots[m];
      const alreadyHas = (snap.items || []).some((a) => a.name === name);
      if (!alreadyHas) {
        nextSnapshots[m] = {
          items: [...(snap.items || []), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, amount }],
          liabilities: snap.liabilities || [],
        };
        laterCount++;
      }
    });
    const next = { monthlySnapshots: nextSnapshots };
    setAssetData(next);
    debouncedSave(ASSETS_KEY, next, "자산 정보 저장에 실패했어요.");
    setNewAssetName(""); setNewAssetAmount("");
    setToast(laterCount > 0 ? `추가했어요 (이후 ${laterCount}개월 기록에도 같이 반영)` : "추가했어요");
    return true;
  }
  function countLaterAssetMonths(name) {
    return Object.keys(assetData.monthlySnapshots || {})
      .filter((m) => m > assetViewMonth && (assetData.monthlySnapshots[m].items || []).some((a) => a.name === name))
      .length;
  }
  function deleteAssetItem(id) {
    const item = effectiveAssetView.items.find((a) => a.id === id);
    const nextSnapshots = { ...(assetData.monthlySnapshots || {}) };
    nextSnapshots[assetViewMonth] = {
      items: effectiveAssetView.items.filter((a) => a.id !== id),
      liabilities: effectiveAssetView.liabilities,
    };
    let laterCount = 0;
    if (item) {
      Object.keys(assetData.monthlySnapshots || {}).filter((m) => m > assetViewMonth).forEach((m) => {
        const snap = assetData.monthlySnapshots[m];
        if ((snap.items || []).some((a) => a.name === item.name)) {
          nextSnapshots[m] = { items: (snap.items || []).filter((a) => a.name !== item.name), liabilities: snap.liabilities || [] };
          laterCount++;
        }
      });
    }
    const next = { monthlySnapshots: nextSnapshots };
    setAssetData(next);
    debouncedSave(ASSETS_KEY, next, "자산 정보 저장에 실패했어요.");
    setToast(laterCount > 0 ? `삭제했어요 (이후 ${laterCount}개월 기록에서도 같이 삭제)` : "삭제했어요");
  }
  function addLiabilityItem(e) {
    e.preventDefault();
    if (!newLiabilityName.trim()) return false;
    const name = newLiabilityName.trim();
    const amount = Number(newLiabilityAmount) || 0;

    // 중복 체크
    if (effectiveAssetView.liabilities.some((l) => l.name === name)) {
      setLiabilityErrorMsg("같은 이름의 부채가 이미 있어요");
      liabilityNameInputRef.current?.focus();
      return false;
    }
    setLiabilityErrorMsg("");
    
    const nextSnapshots = { ...(assetData.monthlySnapshots || {}) };
    nextSnapshots[assetViewMonth] = {
      items: effectiveAssetView.items,
      liabilities: [...effectiveAssetView.liabilities, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, amount }],
    };
    let laterCount = 0;
    Object.keys(assetData.monthlySnapshots || {}).filter((m) => m > assetViewMonth).forEach((m) => {
      const snap = assetData.monthlySnapshots[m];
      const alreadyHas = (snap.liabilities || []).some((l) => l.name === name);
      if (!alreadyHas) {
        nextSnapshots[m] = {
          items: snap.items || [],
          liabilities: [...(snap.liabilities || []), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, amount }],
        };
        laterCount++;
      }
    });
    const next = { monthlySnapshots: nextSnapshots };
    setAssetData(next);
    debouncedSave(ASSETS_KEY, next, "자산 정보 저장에 실패했어요.");
    setNewLiabilityName(""); setNewLiabilityAmount("");
    setToast(laterCount > 0 ? `추가했어요 (이후 ${laterCount}개월 기록에도 같이 반영)` : "추가했어요");
    return true;
  }
  function countLaterLiabilityMonths(name) {
    return Object.keys(assetData.monthlySnapshots || {})
      .filter((m) => m > assetViewMonth && (assetData.monthlySnapshots[m].liabilities || []).some((l) => l.name === name))
      .length;
  }
  function deleteLiabilityItem(id) {
    const item = effectiveAssetView.liabilities.find((l) => l.id === id);
    const nextSnapshots = { ...(assetData.monthlySnapshots || {}) };
    nextSnapshots[assetViewMonth] = {
      items: effectiveAssetView.items,
      liabilities: effectiveAssetView.liabilities.filter((l) => l.id !== id),
    };
    let laterCount = 0;
    if (item) {
      Object.keys(assetData.monthlySnapshots || {}).filter((m) => m > assetViewMonth).forEach((m) => {
        const snap = assetData.monthlySnapshots[m];
        if ((snap.liabilities || []).some((l) => l.name === item.name)) {
          nextSnapshots[m] = { items: snap.items || [], liabilities: (snap.liabilities || []).filter((l) => l.name !== item.name) };
          laterCount++;
        }
      });
    }
    const next = { monthlySnapshots: nextSnapshots };
    setAssetData(next);
    debouncedSave(ASSETS_KEY, next, "자산 정보 저장에 실패했어요.");
    setToast(laterCount > 0 ? `삭제했어요 (이후 ${laterCount}개월 기록에서도 같이 삭제)` : "삭제했어요");
  }
  // 자산/부채 목록 행을 탭하면 뜨는 시트: 이름·금액 같이 수정하거나 삭제해요.
  function openAssetSheet(type, item) {
    setAssetSheetItem({ type, id: item.id, name: item.name, amount: item.amount });
    setAssetSheetMode("menu");
    setAssetSheetNameDraft(item.name);
    setAssetSheetAmountDraft(String(item.amount));
  }
  function saveAssetSheetEdit() {
    if (!assetSheetItem) return;
    const { type, id } = assetSheetItem;
    const amount = Number(assetSheetAmountDraft) || 0;
    if (type === "loan") {
      saveLoanHistoryBalance(id, assetViewMonth, amount);
      setAssetSheetItem(null);
      return;
    }
    const name = assetSheetNameDraft.trim();
    if (!name) return;
    if (type === "asset") {
      persistAssetItems(effectiveAssetView.items.map((a) => (a.id === id ? { ...a, name, amount } : a)));
    } else {
      persistLiabilityItems(effectiveAssetView.liabilities.map((l) => (l.id === id ? { ...l, name, amount } : l)));
    }
    setAssetSheetItem(null);
  }
  function confirmDeleteAssetSheet() {
    if (!assetSheetItem) return;
    const { type, id } = assetSheetItem;
    if (type === "asset") deleteAssetItem(id); else if (type === "liability") deleteLiabilityItem(id);
    setAssetSheetItem(null);
  }
  function deleteSnapshotMonth(month) {
    const nextSnapshots = { ...assetData.monthlySnapshots };
    delete nextSnapshots[month];
    const next = { monthlySnapshots: nextSnapshots };
    setAssetData(next);
    debouncedSave(ASSETS_KEY, next, "자산 정보 저장에 실패했어요.");
  }
  function persistRecurring(next) {
    setRecurringItems(next);
    debouncedSave(RECURRING_KEY, next, "정기지출 목록 저장에 실패했어요.");
  }
  function persistBudgets(next) {
    setMonthlyBudgets(next);
    debouncedSave(BUDGETS_KEY, next, "예산 설정 저장에 실패했어요.");
  }
  function getGroupBudget(groupId, month) {
    const g = groups.find((x) => x.id === groupId);
    const fallback = g ? g.budget : 0;
    return monthlyBudgets[month]?.[groupId] ?? fallback;
  }
  function persistCategoryConfig(nextGroups, nextIncomeGroups) {
    const g = nextGroups || groups;
    const inc = nextIncomeGroups || incomeGroups;
    setGroups(g);
    setIncomeGroups(inc);
    debouncedSave(CATEGORY_CONFIG_KEY, { groups: g, incomeGroups: inc }, "카테고리 설정 저장에 실패했어요.");
  }
  function openCategoryManager() {
    setDraftGroups(JSON.parse(JSON.stringify(groups)));
    setDraftIncomeGroups(JSON.parse(JSON.stringify(incomeGroups)));
    setPendingDelete(null);
    setShowCategoryManager(true);
  }
  function cancelCategoryManager() {
    setShowCategoryManager(false);
    setPendingDelete(null);
  }
  function applyCategoryManager() {
    persistCategoryConfig(draftGroups, draftIncomeGroups);
    setShowCategoryManager(false);
    setPendingDelete(null);
    setToast("카테고리 변경사항을 적용했어요");
  }
  function renameGroupLabel(groupId, newLabel) {
    setDraftGroups(draftGroups.map((g) => (g.id === groupId ? { ...g, label: newLabel } : g)));
  }
  function toggleGroupBudget(groupId) {
    setDraftGroups(draftGroups.map((g) => (g.id === groupId ? { ...g, budgetEnabled: !g.budgetEnabled } : g)));
  }
  function updateGroupBudgetAmount(groupId, amount) {
    setDraftGroups(draftGroups.map((g) => (g.id === groupId ? { ...g, budget: Number(amount) || 0 } : g)));
  }
  function addCategoryToGroup(groupId, catName) {
    const name = (catName || "").trim();
    if (!name) return;
    const alreadyExists = draftGroups.some((g) => g.categories.includes(name));
    if (alreadyExists) { setToast("이미 있는 카테고리예요"); return; }
    setDraftGroups(draftGroups.map((g) => (g.id === groupId ? { ...g, categories: [...g.categories, name] } : g)));
  }
  function removeCategoryFromGroup(groupId, catName) {
    setDraftGroups(draftGroups.map((g) => (g.id === groupId ? { ...g, categories: g.categories.filter((c) => c !== catName) } : g)));
    setPendingDelete(null);
  }
  function renameCategoryInGroup(groupId, oldName, newName) {
    setDraftGroups(draftGroups.map((g) => (g.id === groupId ? { ...g, categories: g.categories.map((c) => (c === oldName ? newName : c)) } : g)));
  }
  function addNewGroup(name) {
    const label = (name || "").trim();
    if (!label) return;
    const id = `custom-${Date.now()}`;
    setDraftGroups([...draftGroups, { id, label, categories: [], budgetEnabled: false, budget: 0 }]);
    setNewGroupName("");
  }
  function removeGroup(groupId) {
    setDraftGroups(draftGroups.filter((g) => g.id !== groupId));
    setPendingDelete(null);
  }
  // 수입 쪽도 지출이랑 똑같은 그룹 구조 - 아래 함수들은 위 지출용 함수랑 대응돼요
  function renameIncomeGroupLabel(groupId, newLabel) {
    setDraftIncomeGroups(draftIncomeGroups.map((g) => (g.id === groupId ? { ...g, label: newLabel } : g)));
  }
  function addCategoryToIncomeGroup(groupId, catName) {
    const name = (catName || "").trim();
    if (!name) return;
    const alreadyExists = draftIncomeGroups.some((g) => g.categories.includes(name));
    if (alreadyExists) { setToast("이미 있는 카테고리예요"); return; }
    setDraftIncomeGroups(draftIncomeGroups.map((g) => (g.id === groupId ? { ...g, categories: [...g.categories, name] } : g)));
  }
  function removeCategoryFromIncomeGroup(groupId, catName) {
    setDraftIncomeGroups(draftIncomeGroups.map((g) => (g.id === groupId ? { ...g, categories: g.categories.filter((c) => c !== catName) } : g)));
    setPendingDelete(null);
  }
  function renameCategoryInIncomeGroup(groupId, oldName, newName) {
    setDraftIncomeGroups(draftIncomeGroups.map((g) => (g.id === groupId ? { ...g, categories: g.categories.map((c) => (c === oldName ? newName : c)) } : g)));
  }
  function addNewIncomeGroup(name) {
    const label = (name || "").trim();
    if (!label) return;
    const id = `income-custom-${Date.now()}`;
    setDraftIncomeGroups([...draftIncomeGroups, { id, label, categories: [] }]);
    setNewGroupName("");
  }
  function removeIncomeGroup(groupId) {
    setDraftIncomeGroups(draftIncomeGroups.filter((g) => g.id !== groupId));
    setPendingDelete(null);
  }
  async function retrySave() {
    if (!lastFailedSave) return;
    const { key, value, errorMsg } = lastFailedSave;
    try {
      const result = await storageSet(key, value);
      if (result) { setSaveError(""); setLastFailedSave(null); }
      else setSaveError(errorMsg);
    } catch (e) {
      setSaveError(errorMsg);
    }
  }

  function commitTitle() {
    persistSettings({ ...settings, title: titleDraft.trim() || "우리집 가계부" });
    setEditingTitle(false);
  }

  function handleTypeChange(t) {
    setType(t);
    setCategory(t === "expense" ? LIVING_CATEGORIES[0] : INCOME_CATEGORIES[0]);
    if (t === "income") { setTravelMode(false); setForeignAmount(""); }
  }

  function toggleTravelMode() {
    setTravelMode((tm) => {
      const next = !tm;
      if (next) setCategory("여행");
      return next;
    });
  }

  const fxComputedAmount = useMemo(() => {
    const fa = Number(foreignAmount) || 0;
    const rate = Number(settings.fxRate) || 0;
    return Math.round(fa * rate);
  }, [foreignAmount, settings.fxRate]);

  async function addTransaction(e) {
    e.preventDefault();
    let finalAmount;
    let finalMemo = memo.trim();
    if (type === "expense" && travelMode) {
      const fa = Number(foreignAmount) || 0;
      const rate = Number(settings.fxRate) || 0;
      finalAmount = Math.round(fa * rate);
      const fxNote = `${fa.toLocaleString("ko-KR")}${settings.fxCurrency} × ${rate}원`;
      finalMemo = finalMemo ? `${fxNote} · ${finalMemo}` : fxNote;
    } else {
      finalAmount = Number(amount) || 0;
      if (type === "expense" && isNegative) finalAmount = -Math.abs(finalAmount);
    }
    if (isNaN(finalAmount) || finalAmount === 0) {
      setSaveError(travelMode ? "환산된 금액이 0원이에요. 통화·환율·금액을 확인해주세요." : "금액을 입력해주세요.");
      return;
    }
    if (type === "income" && finalAmount < 0) {
      setSaveError("수입 금액은 0보다 커야 해요.");
      return;
    }
    if (!date) {
      setSaveError("날짜를 선택해주세요.");
      return;
    }
    const newTx = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type, date, category, amount: finalAmount, memo: finalMemo,
    };
    const ok = await persistTx([newTx, ...transactions]);
    setAmount("");
    setMemo("");
    setForeignAmount("");
    setTravelMode(false);
    setIsNegative(false);
    if (ok) {
      setToast(type === "income" ? "수입이 추가됐어요" : "지출이 추가됐어요");
      setTimeout(() => amountInputRef.current && amountInputRef.current.focus(), 50);
    }
  }
  async function deleteTransaction(id) {
    const ok = await persistTx(transactions.filter((t) => t.id !== id));
    if (editingId === id) cancelEdit();
    if (ok) setToast("삭제했어요");
  }

  function handleEmTypeChange(t) {
    setEmType(t);
    setEmCategory(t === "expense" ? LIVING_CATEGORIES[0] : INCOME_CATEGORIES[0]);
    if (t === "income") { setEmTravelMode(false); setEmForeignAmount(""); }
  }
  function toggleEmTravelMode() {
    setEmTravelMode((tm) => {
      const next = !tm;
      if (next) setEmCategory("여행");
      return next;
    });
  }
  const emFxComputedAmount = useMemo(() => {
    const fa = Number(emForeignAmount) || 0;
    const rate = Number(settings.fxRate) || 0;
    return Math.round(fa * rate);
  }, [emForeignAmount, settings.fxRate]);

  function startEdit(t) {
    setEditingId(t.id);
    setEmType(t.type);
    setEmDate(t.date);
    setEmCategory(t.category);
    setEmAmount(String(Math.abs(t.amount)));
    setEmIsNegative(t.amount < 0);
    setEmMemo(t.memo || "");
    setEmTravelMode(false);
    setEmForeignAmount("");
  }
  function cancelEdit() {
    setEditingId(null);
  }
  async function saveEditedTransaction(e) {
    e.preventDefault();
    let finalAmount;
    let finalMemo = emMemo.trim();
    if (emType === "expense" && emTravelMode) {
      const fa = Number(emForeignAmount) || 0;
      const rate = Number(settings.fxRate) || 0;
      finalAmount = Math.round(fa * rate);
      const fxNote = `${fa.toLocaleString("ko-KR")}${settings.fxCurrency} × ${rate}원`;
      finalMemo = finalMemo ? `${fxNote} · ${finalMemo}` : fxNote;
    } else {
      finalAmount = Number(emAmount) || 0;
      if (emType === "expense" && emIsNegative) finalAmount = -Math.abs(finalAmount);
    }
    if (isNaN(finalAmount) || finalAmount === 0 || !emDate) return;
    if (emType === "income" && finalAmount < 0) {
      setSaveError("수입 금액은 0보다 커야 해요.");
      return;
    }
    const next = transactions.map((t) =>
      t.id === editingId ? { ...t, type: emType, date: emDate, category: emCategory, amount: finalAmount, memo: finalMemo } : t
    );
    const ok = await persistTx(next);
    setEditingId(null);
    if (ok) setToast("수정됐어요");
  }

  const monthTx = useMemo(() => transactions.filter((t) => getCycleLabel(t.date, settings.cycleStartDay) === selectedMonth), [transactions, selectedMonth, settings.cycleStartDay]);
  const recurSummary = useMemo(() => {
    const total = recurringItems.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const checked = recurringItems
      .filter((item) => monthTx.some((t) => t.type === "expense" && t.category === item.category && t.memo === item.name))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return { total, checked };
  }, [recurringItems, monthTx]);
  const totalIncome = useMemo(() => monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0), [monthTx]);
  const totalExpense = useMemo(() => monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0), [monthTx]);
  const balance = totalIncome - totalExpense;

  const budgetWarnings = useMemo(() => {
    const warnings = [];
    groups.filter((g) => g.budgetEnabled).forEach((g) => {
      const spent = monthTx.filter((t) => t.type === "expense" && g.categories.includes(t.category)).reduce((s, t) => s + t.amount, 0);
      const budget = getGroupBudget(g.id, selectedMonth);
      if (spent > budget) warnings.push(`${g.label} 예산을 ${formatWon(spent - budget)} 초과했어요`);
    });
    return warnings;
  }, [monthTx, groups, monthlyBudgets, selectedMonth]);

  const categoryData = useMemo(() => {
    const map = {};
    monthTx.filter((t) => t.type === "expense").forEach((t) => {
      if (pieGroupFilter !== "전체") {
        const group = EXPENSE_GROUPS.find((g) => g.label === pieGroupFilter);
        if (!group || !group.items.includes(t.category)) return;
      }
      map[t.category] = (map[t.category] || 0) + t.amount;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [monthTx, pieGroupFilter]);

  function filterMonthsByPeriod(monthsList, period, from, to) {
    if (period === "custom") {
      if (!from || !to) return monthsList.slice(-6);
      const fromLabel = from.slice(0, 7), toLabel = to.slice(0, 7);
      return monthsList.filter((m) => m.month >= fromLabel && m.month <= toLabel);
    }
    if (period === "all") return monthsList;
    return monthsList.slice(-Number(period));
  }

  const monthlyTrend = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      const label = getCycleLabel(t.date, settings.cycleStartDay);
      if (!map[label]) map[label] = { month: label, income: 0, expense: 0 };
      if (t.type === "income") map[label].income += t.amount;
      else map[label].expense += t.amount;
    });
    const sorted = Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
    return filterMonthsByPeriod(sorted, statsPeriod, statsFrom, statsTo)
      .map((m) => ({ ...m, net: m.income - m.expense, label: `${Number(m.month.slice(5))}월` }));
  }, [transactions, statsPeriod, statsFrom, statsTo, settings.cycleStartDay]);

  const categoryTrendStacked = useMemo(() => {
    if (statsCategoryGroup === "전체") return { data: [], subCats: [] };
    const group = EXPENSE_GROUPS.find((g) => g.label === statsCategoryGroup);
    if (!group) return { data: [], subCats: [] };
    const monthMap = {};
    const subCatsSet = new Set();
    transactions.filter((t) => t.type === "expense" && group.items.includes(t.category)).forEach((t) => {
      const label = getCycleLabel(t.date, settings.cycleStartDay);
      if (!monthMap[label]) monthMap[label] = {};
      monthMap[label][t.category] = (monthMap[label][t.category] || 0) + t.amount;
      subCatsSet.add(t.category);
    });
    const sortedMonths = Object.keys(monthMap).sort();
    const filteredMonths = filterMonthsByPeriod(sortedMonths.map((month) => ({ month })), statsPeriod, statsFrom, statsTo).map((m) => m.month);
    const subCats = Array.from(subCatsSet);
    const data = filteredMonths.map((month) => {
      const row = { month, label: `${Number(month.slice(5))}월` };
      subCats.forEach((c) => { row[c] = monthMap[month][c] || 0; });
      return row;
    });
    return { data, subCats };
  }, [transactions, statsCategoryGroup, statsPeriod, statsFrom, statsTo, settings.cycleStartDay]);

  const effectiveAssetView = useMemo(() => {
    const snapshots = assetData.monthlySnapshots || {};
    const isRecorded = !!snapshots[assetViewMonth];
    const snap = getEffectiveAssetSnapshot(snapshots, assetViewMonth);
    const priorMonths = Object.keys(snapshots).filter((m) => m < assetViewMonth).sort();
    return {
      items: snap ? snap.items || [] : [],
      liabilities: snap ? snap.liabilities || [] : [],
      isRecorded,
      sourceMonth: isRecorded ? assetViewMonth : (priorMonths.length > 0 ? priorMonths[priorMonths.length - 1] : null),
    };
  }, [assetData.monthlySnapshots, assetViewMonth]);

  const assetViewLoanBalances = useMemo(() => {
    return getEffectiveLoanBalances(loanData.monthlySnapshots, assetViewMonth, loanData.loans);
  }, [loanData.monthlySnapshots, loanData.loans, assetViewMonth]);

  const assetMonthOptions = useMemo(() => {
    const opts = [];
    const now = new Date();
    for (let offset = -60; offset <= 12; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    Object.keys(assetData.monthlySnapshots || {}).forEach((m) => { if (!opts.includes(m)) opts.push(m); });
    return opts.sort().reverse();
  }, [assetData.monthlySnapshots]);

  const assetTotals = useMemo(() => {
    const totalAssets = effectiveAssetView.items.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const loanBalances = getEffectiveLoanBalances(loanData.monthlySnapshots, assetViewMonth, loanData.loans);
    const loanDebt = Object.values(loanBalances).reduce((s, v) => s + (Number(v) || 0), 0);
    const liabilityDebt = effectiveAssetView.liabilities.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const totalDebt = loanDebt + liabilityDebt;
    return { totalAssets, totalDebt, netWorth: totalAssets - totalDebt };
  }, [effectiveAssetView, loanData.loans, loanData.monthlySnapshots, assetViewMonth]);

  const isDuplicateAssetName = newAssetName.trim() !== "" && effectiveAssetView.items.some((a) => a.name === newAssetName.trim());
  const isDuplicateLiabilityName = newLiabilityName.trim() !== "" && effectiveAssetView.liabilities.some((l) => l.name === newLiabilityName.trim());

  const assetHistoryFiltered = useMemo(() => {
    const snapshots = assetData.monthlySnapshots || {};
    const loanSnapshots = loanData.monthlySnapshots || {};
    const recordedMonths = Array.from(new Set([...Object.keys(snapshots), ...Object.keys(loanSnapshots)])).sort();
    if (recordedMonths.length === 0) return [];
    const earliestMonth = recordedMonths[0];
    const currentMonth = todayStr().slice(0, 7);
    const allMonths = [];
    let [y, m] = earliestMonth.split("-").map(Number);
    const [cy, cm] = currentMonth.split("-").map(Number);
    while (y < cy || (y === cy && m <= cm)) {
      allMonths.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    const filteredMonths = filterMonthsByPeriod(allMonths.map((month) => ({ month })), statsPeriod, statsFrom, statsTo).map((x) => x.month);
    return filteredMonths.map((month) => {
      const snap = getEffectiveAssetSnapshot(snapshots, month);
      const items = snap ? snap.items || [] : [];
      const liabilities = snap ? snap.liabilities || [] : [];
      const totalAssets = items.reduce((s, a) => s + (Number(a.amount) || 0), 0);
      const loanBalances = getEffectiveLoanBalances(loanData.monthlySnapshots, month, loanData.loans);
      const loanDebt = Object.values(loanBalances).reduce((s, v) => s + (Number(v) || 0), 0);
      const liabilityDebt = liabilities.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const totalDebt = loanDebt + liabilityDebt;
      return { month, label: `${Number(month.slice(5))}월`, netWorth: totalAssets - totalDebt, totalAssets, totalDebt };
    });
  }, [assetData.monthlySnapshots, statsPeriod, statsFrom, statsTo, loanData.loans, loanData.monthlySnapshots]);

  const cashFlowStatement = useMemo(() => {
    const mTx = transactions.filter((t) => getCycleLabel(t.date, settings.cycleStartDay) === selectedMonth);
    const incomeMap = {};
    const fixedMap = {}, assetMap = {};
    const variableGroupMap = {};
    const fixedGroup = groups.find((g) => g.id === "fixed");
    const fixedCats = fixedGroup ? fixedGroup.categories : [];
    mTx.forEach((t) => {
      if (t.type === "income") {
        incomeMap[t.category] = (incomeMap[t.category] || 0) + t.amount;
      } else if (t.category === "저축/투자" || t.category === "대출상환") {
        assetMap[t.category] = (assetMap[t.category] || 0) + t.amount;
      } else if (fixedCats.includes(t.category)) {
        fixedMap[t.category] = (fixedMap[t.category] || 0) + t.amount;
      } else {
        const label = groupLabel(t.category);
        if (!variableGroupMap[label]) variableGroupMap[label] = {};
        variableGroupMap[label][t.category] = (variableGroupMap[label][t.category] || 0) + t.amount;
      }
    });
    const toItems = (map) => Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const incomeItems = toItems(incomeMap);
    const fixedItems = toItems(fixedMap);
    const assetItems = toItems(assetMap);
    const variableGroups = Object.entries(variableGroupMap)
      .map(([label, catMap]) => ({ label, items: toItems(catMap), total: Object.values(catMap).reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total);
    const totalIncome = incomeItems.reduce((s, i) => s + i.value, 0);
    const totalFixed = fixedItems.reduce((s, i) => s + i.value, 0);
    const totalAsset = assetItems.reduce((s, i) => s + i.value, 0);
    const totalVariable = variableGroups.reduce((s, g) => s + g.total, 0);
    return {
      incomeItems, fixedItems, assetItems, variableGroups,
      totalIncome, totalFixed, totalAsset, totalVariable,
      totalExpense: totalFixed + totalAsset + totalVariable,
      net: totalIncome - totalFixed - totalAsset - totalVariable,
      variableLimit: totalIncome - totalFixed - totalAsset,
    };
  }, [transactions, selectedMonth, groups, settings.cycleStartDay]);


  const balanceSheetSnapshot = useMemo(() => {
    const snapshots = assetData.monthlySnapshots || {};
    const snap = getEffectiveAssetSnapshot(snapshots, reportMonth);
    if (!snap && loanData.loans.length === 0) return null;
    const items = snap ? snap.items || [] : [];
    const liabilities = snap ? snap.liabilities || [] : [];
    const totalAssets = items.reduce((s, a) => s + (Number(a.amount) || 0), 0);

    const loanBalances = getEffectiveLoanBalances(loanData.monthlySnapshots, reportMonth, loanData.loans);
    const [py, pm] = reportMonth.split("-").map(Number);
    let prevY = py, prevM = pm - 1;
    if (prevM < 1) { prevM = 12; prevY -= 1; }
    const prevMonth = `${prevY}-${String(prevM).padStart(2, "0")}`;
    const prevLoanBalances = getEffectiveLoanBalances(loanData.monthlySnapshots, prevMonth, loanData.loans);
    const loanDetail = loanData.loans
      .map((l) => ({
        id: l.id,
        name: l.name,
        balance: loanBalances[l.id] || 0,
        paidThisMonth: (prevLoanBalances[l.id] || 0) - (loanBalances[l.id] || 0),
      }))
      .filter((l) => l.balance > 0 || l.paidThisMonth !== 0);
    const loanDebt = loanDetail.reduce((s, l) => s + l.balance, 0);

    const liabilityDebt = liabilities.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const totalDebt = loanDebt + liabilityDebt;
    const netWorth = totalAssets - totalDebt;

    // 전월대비 순자산 변동 + 가장 크게 움직인 항목 하나
    const prevSnap = getEffectiveAssetSnapshot(snapshots, prevMonth);
    const prevItems = prevSnap ? prevSnap.items || [] : [];
    const prevLiabilities = prevSnap ? prevSnap.liabilities || [] : [];
    const prevTotalAssets = prevItems.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const prevLiabilityDebt = prevLiabilities.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const prevLoanDebt = Object.values(prevLoanBalances).reduce((s, v) => s + (Number(v) || 0), 0);
    const prevNetWorth = prevTotalAssets - (prevLoanDebt + prevLiabilityDebt);
    const netWorthChange = (prevSnap || loanDetail.some((l) => l.paidThisMonth !== 0)) ? netWorth - prevNetWorth : null;

    const totalAssetsChange = totalAssets - prevTotalAssets;
    const totalDebtChange = totalDebt - (prevLoanDebt + prevLiabilityDebt);
    let changeNote = null;
    if (totalDebtChange !== 0) {
      changeNote = `부채 ${formatWon(Math.abs(totalDebtChange))} ${totalDebtChange < 0 ? "감소" : "증가"}`;
    } else if (totalAssetsChange !== 0) {
      changeNote = `자산 ${formatWon(Math.abs(totalAssetsChange))} ${totalAssetsChange > 0 ? "증가" : "감소"}`;
    }

    return { month: reportMonth, totalAssets, totalDebt, netWorth, items, liabilities, loanDetail, netWorthChange, changeNote };
  }, [assetData.monthlySnapshots, reportMonth, loanData.loans, loanData.monthlySnapshots]);

  const topGroupTransactions = useMemo(() => {
    let base = monthTx.filter((t) => t.type === "expense");
    if (pieGroupFilter !== "전체") {
      const group = EXPENSE_GROUPS.find((g) => g.label === pieGroupFilter);
      base = base.filter((t) => group && group.items.includes(t.category));
    }
    return [...base].sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [monthTx, pieGroupFilter]);

  const monthOptions = useMemo(() => {
    const set = new Set(transactions.map((t) => getCycleLabel(t.date, settings.cycleStartDay)));
    set.add(selectedMonth);
    return Array.from(set).sort().reverse();
  }, [transactions, selectedMonth, settings.cycleStartDay]);

  const sortedMonthTx = useMemo(() => [...monthTx].sort((a, b) => (a.date < b.date ? 1 : -1)), [monthTx]);

  const availableYears = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.slice(0, 4)));
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const displayedTx = useMemo(() => {
    const hasExplicitFilter = searchQuery.trim() || filterCategory !== "all" || filterYear !== "all" || filterMonth !== "all";
    let base = hasExplicitFilter ? transactions : monthTx;
    if (filterYear !== "all") base = base.filter((t) => t.date.slice(0, 4) === filterYear);
    if (filterMonth !== "all") base = base.filter((t) => t.date.slice(5, 7) === filterMonth);
    if (filterCategory !== "all") {
      if (filterCategory.startsWith("group:")) {
        const label = filterCategory.slice(6);
        const group = EXPENSE_GROUPS.find((g) => g.label === label);
        base = base.filter((t) => group && group.items.includes(t.category));
      } else {
        base = base.filter((t) => t.category === filterCategory);
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      base = base.filter((t) => (t.memo || "").toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
    }
    return [...base].sort((a, b) => {
      if (sortBy === "amount_desc") return b.amount - a.amount;
      if (sortBy === "amount_asc") return a.amount - b.amount;
      if (a.date !== b.date) {
        return sortBy === "date_asc" ? (a.date < b.date ? -1 : 1) : (a.date < b.date ? 1 : -1);
      }
      // 같은 날짜면 실제로 작성한 시간(id 앞부분에 생성 시각이 들어있어요) 기준으로 정렬해요
      const timeA = Number(String(a.id).split("-")[0]) || 0;
      const timeB = Number(String(b.id).split("-")[0]) || 0;
      return sortBy === "date_asc" ? timeA - timeB : timeB - timeA;
    });
  }, [monthTx, transactions, searchQuery, filterCategory, filterYear, filterMonth, sortBy]);

  useEffect(() => {
    setVisibleCount(20);
  }, [searchQuery, filterCategory, filterYear, filterMonth, sortBy, selectedMonth]);

  const pagedTx = useMemo(() => displayedTx.slice(0, visibleCount), [displayedTx, visibleCount]);

  function displayGroupLabel(cat) {
    const g = EXPENSE_GROUPS.find((grp) => grp.items.includes(cat));
    return g ? g.label : "기타";
  }

  const GROUP_DISPLAY_ORDER = [...groups.map((g) => g.label), "수입"];

  const groupedView = useMemo(() => {
    const groups = {};
    displayedTx.forEach((t) => {
      const groupName = t.type === "income" ? "수입" : displayGroupLabel(t.category);
      if (!groups[groupName]) groups[groupName] = { total: 0, categories: {} };
      groups[groupName].total += t.amount;
      if (!groups[groupName].categories[t.category]) groups[groupName].categories[t.category] = { total: 0, items: [] };
      groups[groupName].categories[t.category].total += t.amount;
      groups[groupName].categories[t.category].items.push(t);
    });
    return Object.entries(groups)
      .map(([name, data]) => ({
        name,
        total: data.total,
        categories: Object.entries(data.categories)
          .map(([cname, cdata]) => ({
            name: cname,
            total: cdata.total,
            items: [...cdata.items].sort((a, b) => (a.date < b.date ? -1 : 1)),
          }))
          .sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => GROUP_DISPLAY_ORDER.indexOf(a.name) - GROUP_DISPLAY_ORDER.indexOf(b.name));
  }, [displayedTx]);

  const totalInterestPaid = useMemo(
    () => transactions
      .filter((t) => t.type === "expense" && t.category === "대출이자" && !(t.memo || "").includes("주담대"))
      .reduce((s, t) => s + t.amount, 0),
    [transactions]
  );

  const currentYear = new Date().getFullYear();
  const yearStats = useMemo(() => {
    const yearStr = String(currentYear);
    let income = 0, expense = 0, savings = 0, principal = 0, interest = 0;
    transactions.forEach((t) => {
      if (!t.date.startsWith(yearStr)) return;
      if (t.type === "income") {
        income += t.amount;
      } else {
        expense += t.amount;
        if (t.category === "저축/투자") savings += t.amount;
        if (t.category === "대출상환") principal += t.amount;
        if (t.category === "대출이자") interest += t.amount;
      }
    });
    return { income, expense, savings, principal, interest, net: income - expense };
  }, [transactions, currentYear]);

  const loanTotals = useMemo(() => {
    const totalBalance = loanData.loans.reduce((s, l) => s + Number(l.balance || 0), 0);
    const totalOriginal = loanData.loans.reduce((s, l) => s + Number(l.originalBalance || 0), 0);
    const paidOff = totalOriginal - totalBalance;
    const pct = totalOriginal > 0 ? Math.min((paidOff / totalOriginal) * 100, 100) : 0;
    let monthsLeft = null;
    let monthlyNeeded = null;
    if (loanData.targetDate) {
      monthsLeft = monthsBetween(todayStr(), loanData.targetDate);
      monthlyNeeded = monthsLeft > 0 ? totalBalance / monthsLeft : totalBalance;
    }
    return { totalBalance, totalOriginal, paidOff, pct, monthsLeft, monthlyNeeded };
  }, [loanData]);

  async function updateLoanBalance(id, newBalance) {
    const next = {
      ...loanData,
      loans: loanData.loans.map((l) => (l.id === id ? { ...l, balance: Number(newBalance) || 0 } : l)),
    };
    await persistLoans(next);
  }
  async function updateLoanName(id, newName) {
    const next = {
      ...loanData,
      loans: loanData.loans.map((l) => (l.id === id ? { ...l, name: newName } : l)),
    };
    await persistLoans(next);
  }
  async function updateLoanOriginal(id, newOriginal) {
    const next = {
      ...loanData,
      loans: loanData.loans.map((l) => (l.id === id ? { ...l, originalBalance: Number(newOriginal) || 0 } : l)),
    };
    await persistLoans(next);
  }
  async function deleteLoan(id) {
    await persistLoans({ ...loanData, loans: loanData.loans.filter((l) => l.id !== id) });
  }
  async function toggleLoanComplete(id) {
    const next = {
      ...loanData,
      loans: loanData.loans.map((l) => {
        if (l.id !== id) return l;
        const nowCompleted = !l.completed;
        if (nowCompleted) {
          return { ...l, completed: true, preCompleteBalance: l.balance, balance: 0 };
        }
        return { ...l, completed: false, balance: l.preCompleteBalance ?? l.balance };
      }),
    };
    await persistLoans(next);
    setToast(next.loans.find((l) => l.id === id).completed ? "상환 완료로 표시했어요 🎉" : "다시 진행중으로 옮겼어요");
  }
  async function addLoan(e) {
    e.preventDefault();
    const bal = Number(newLoanBalance);
    if (!newLoanName.trim() || !bal || bal <= 0) return;
    const loan = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newLoanName.trim(), balance: bal, originalBalance: bal,
      rate: Number(newLoanRate) || 0, completed: false,
    };
    await persistLoans({ ...loanData, loans: [...loanData.loans, loan] });
    setNewLoanName(""); setNewLoanBalance(""); setNewLoanRate("");
  }

  function addRecurringItem(e) {
    e.preventDefault();
    const amt = Number(newRecurAmount);
    if (!newRecurName.trim() || !amt || amt <= 0) return;
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newRecurName.trim(),
      category: newRecurCategory,
      amount: amt,
      day: Math.min(Math.max(Number(newRecurDay) || 1, 1), 28),
    };
    persistRecurring([...recurringItems, item]);
    setNewRecurName(""); setNewRecurAmount(""); setNewRecurDay("1");
  }

  async function addInstallment(e) {
    e.preventDefault();
    const total = Number(instTotal);
    const months = Number(instMonths);
    if (!instName.trim() || !total || total <= 0 || !months || months <= 0) return;
    const [startY, startM] = instStartMonth.split("-").map(Number);
    const items = splitInstallment({ total, months, startYear: startY, startMonth: startM, name: instName.trim() });
    const newTxs = items.map((it, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      type: "expense",
      category: instCategory,
      ...it,
    }));
    const ok = await persistTx([...newTxs, ...transactions]);
    if (ok) {
      const monthlyAmount = Math.floor(total / months);
      setToast(`${instName.trim()}: 총액 ${formatWon(total)}, 매달 ${formatWon(monthlyAmount)}씩 ${months}개월로 등록했어요`);
    }
    setInstName(""); setInstTotal(""); setInstMonths("");
    setShowInstallment(false);
  }
  function deleteRecurringItem(id) {
    persistRecurring(recurringItems.filter((r) => r.id !== id));
  }
  async function toggleRecurringLogged(item) {
    const existing = monthTx.find((t) => t.type === "expense" && t.category === item.category && t.memo === item.name);
    if (existing) {
      const ok = await persistTx(transactions.filter((t) => t.id !== existing.id));
      if (ok) setToast(`${item.name} 기록을 취소했어요`);
    } else {
      const day = Math.min(Math.max(Number(item.day) || 1, 1), 28);
      const date = getDateForCycleDay(selectedMonth, day, settings.cycleStartDay);
      const newTx = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "expense", date, category: item.category, amount: Number(item.amount) || 0, memo: item.name,
      };
      const ok = await persistTx([newTx, ...transactions]);
      if (ok) setToast(`${item.name} → ${date} 로 기록했어요 ✅`);
    }
  }
  async function updateTargetDate(d) {
    await persistLoans({ ...loanData, targetDate: d });
  }

  function groupLabel(cat) {
    const g = groups.find((grp) => grp.categories.includes(cat));
    return g ? g.label : "기타";
  }

  async function exportToExcel(scope) {
    const XLSX = await import("xlsx");
    const rows = (scope === "month" ? sortedMonthTx : [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1)))
      .map((t) => ({
        날짜: t.date,
        구분: t.type === "income" ? "수입" : "지출",
        분류: t.type === "expense" ? groupLabel(t.category) : "",
        카테고리: t.category,
        금액: t.amount,
        메모: t.memo || "",
      }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 6 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "거래내역");

    if (recurringItems.length > 0) {
      const recurRows = recurringItems.map((r) => ({
        항목명: r.name,
        카테고리: r.category,
        금액: r.amount,
        매월며칠: r.day || 1,
      }));
      const recurWs = XLSX.utils.json_to_sheet(recurRows);
      recurWs["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, recurWs, "정기지출 체크리스트");
    }

    if (scope === "all") {
      // 대출
      if (loanData.loans.length > 0) {
        const loanRows = loanData.loans.map((l) => ({
          이름: l.name,
          최초금액: l.originalBalance || 0,
          현재잔액: l.balance || 0,
          이자율: l.rate || 0,
          상환완료: l.completed ? "Y" : "N",
        }));
        const loanWs = XLSX.utils.json_to_sheet(loanRows);
        loanWs["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 }];
        XLSX.utils.book_append_sheet(wb, loanWs, "대출");
      }

      // 대출 월별 기록
      const loanHistRows = [];
      Object.entries(loanData.monthlySnapshots || {}).sort().forEach(([month, balances]) => {
        Object.entries(balances).forEach(([loanId, balance]) => {
          const loan = loanData.loans.find((l) => l.id === loanId);
          if (loan) loanHistRows.push({ 월: month, 대출이름: loan.name, 잔액: balance });
        });
      });
      if (loanHistRows.length > 0) {
        const loanHistWs = XLSX.utils.json_to_sheet(loanHistRows);
        loanHistWs["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, loanHistWs, "대출월별기록");
      }

      // 자산 (월별)
      const assetRows = [];
      Object.entries(assetData.monthlySnapshots || {}).sort().forEach(([month, snap]) => {
        (snap.items || []).forEach((a) => assetRows.push({ 월: month, 자산이름: a.name, 금액: a.amount }));
      });
      if (assetRows.length > 0) {
        const assetWs = XLSX.utils.json_to_sheet(assetRows);
        assetWs["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, assetWs, "자산");
      }

      // 부채 (대출 외, 월별)
      const liabilityRows = [];
      Object.entries(assetData.monthlySnapshots || {}).sort().forEach(([month, snap]) => {
        (snap.liabilities || []).forEach((l) => liabilityRows.push({ 월: month, 부채이름: l.name, 금액: l.amount }));
      });
      if (liabilityRows.length > 0) {
        const liabWs = XLSX.utils.json_to_sheet(liabilityRows);
        liabWs["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, liabWs, "부채");
      }

      // 예산 (월별 그룹 예산)
      const budgetRows = [];
      Object.entries(monthlyBudgets || {}).sort().forEach(([month, byGroup]) => {
        Object.entries(byGroup).forEach(([groupId, amount]) => {
          const group = groups.find((g) => g.id === groupId);
          budgetRows.push({ 월: month, 그룹: group ? group.label : groupId, 예산금액: amount });
        });
      });
      if (budgetRows.length > 0) {
        const budgetWs = XLSX.utils.json_to_sheet(budgetRows);
        budgetWs["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, budgetWs, "예산");
      }

      // 기본 설정
      const settingsRows = [
        { 항목: "정산시작일", 값: settings.cycleStartDay || 1 },
        { 항목: "가계부이름", 값: settings.title || "" },
        { 항목: "대출상환모드", 값: settings.loanModeEnabled === false ? "OFF" : "ON" },
        { 항목: "환율통화", 값: settings.fxCurrency || "" },
        { 항목: "환율값", 값: settings.fxRate || 0 },
        { 항목: "대출목표일", 값: loanData.targetDate || "" },
      ];
      const settingsWs = XLSX.utils.json_to_sheet(settingsRows);
      settingsWs["!cols"] = [{ wch: 14 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, settingsWs, "설정");
    }

    const filename = scope === "month"
      ? `가계부_${selectedMonth}.xlsx`
      : `가계부_전체.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  function resolveImportedCategory(rawCategory, rawGroup) {
    if (!rawCategory) return rawCategory;
    // 이미 예전 이름이면 우선 새 이름으로 변환
    let cat = CATEGORY_RENAME_MAP[rawCategory] || rawCategory;
    // "식비/문화/기타"처럼 그룹마다 겹치는 이름은 그때 내보낸 "분류" 칸으로 원래 그룹을 되짚어서 교정
    const AMBIGUOUS = ["식비", "문화", "기타"];
    if (AMBIGUOUS.includes(cat) && rawGroup) {
      if (rawGroup.includes("용돈")) return `(용돈)${cat}`;
      if (rawGroup.includes("비정기")) return cat === "기타" ? "기타 비정기지출" : cat;
      if (rawGroup.includes("정기")) return cat === "기타" ? "기타 정기지출" : cat;
      if (rawGroup.includes("생활비")) return cat; // 식비/문화/기타는 생활비 쪽엔 접두어 없이 그대로
    }
    return cat;
  }

  async function handleImportExcel(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const imported = rows
        .map((r) => {
          let dateVal = r["날짜"];
          if (dateVal instanceof Date) {
            dateVal = `${dateVal.getFullYear()}-${String(dateVal.getMonth() + 1).padStart(2, "0")}-${String(dateVal.getDate()).padStart(2, "0")}`;
          } else {
            dateVal = String(dateVal || "").trim();
          }
          const isIncome = String(r["구분"] || "").trim() === "수입";
          const rawCategory = String(r["카테고리"] || "").trim();
          const rawGroup = String(r["분류"] || "").trim();
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: isIncome ? "income" : "expense",
            date: dateVal,
            category: isIncome ? rawCategory : resolveImportedCategory(rawCategory, rawGroup),
            amount: Number(r["금액"]) || 0,
            memo: String(r["메모"] || "").trim(),
          };
        })
        .filter((t) => t.date && t.category && t.amount > 0);

      const existingKeys = new Set(transactions.map((t) => `${t.date}|${t.type}|${t.category}|${t.amount}|${t.memo}`));
      const newOnes = imported.filter((t) => !existingKeys.has(`${t.date}|${t.type}|${t.category}|${t.amount}|${t.memo}`));

      // 정기지출 체크리스트
      let recurAddedCount = 0;
      const recurSheetName = wb.SheetNames.find((n) => n === "정기지출 체크리스트");
      if (recurSheetName) {
        const recurRows = XLSX.utils.sheet_to_json(wb.Sheets[recurSheetName], { defval: "" });
        const existingRecurKeys = new Set(recurringItems.map((r) => `${r.name}|${r.category}`));
        const newRecurItems = recurRows
          .map((r) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: String(r["항목명"] || "").trim(),
            category: String(r["카테고리"] || "").trim(),
            amount: Number(r["금액"]) || 0,
            day: Math.min(Math.max(Number(r["매월며칠"]) || 1, 1), 28),
          }))
          .filter((r) => r.name && r.category && r.amount > 0 && !existingRecurKeys.has(`${r.name}|${r.category}`));
        if (newRecurItems.length > 0) {
          persistRecurring([...recurringItems, ...newRecurItems]);
          recurAddedCount = newRecurItems.length;
        }
      }

      // 대출 + 대출월별기록 (같이 처리해야 이름→id 매칭이 가능해요)
      let loanAddedCount = 0;
      let loanHistAddedCount = 0;
      const loanSheetName = wb.SheetNames.find((n) => n === "대출");
      const loanHistSheetName = wb.SheetNames.find((n) => n === "대출월별기록");
      if (loanSheetName || loanHistSheetName) {
        const existingLoanNames = new Set(loanData.loans.map((l) => l.name));
        let mergedLoans = [...loanData.loans];
        if (loanSheetName) {
          const loanRows = XLSX.utils.sheet_to_json(wb.Sheets[loanSheetName], { defval: "" });
          const newLoans = loanRows
            .map((r) => ({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: String(r["이름"] || "").trim(),
              originalBalance: Number(r["최초금액"]) || 0,
              balance: Number(r["현재잔액"]) || 0,
              rate: Number(r["이자율"]) || 0,
              completed: String(r["상환완료"] || "").trim().toUpperCase() === "Y",
            }))
            .filter((l) => l.name && !existingLoanNames.has(l.name));
          mergedLoans = [...mergedLoans, ...newLoans];
          loanAddedCount = newLoans.length;
        }
        let mergedSnapshots = { ...(loanData.monthlySnapshots || {}) };
        if (loanHistSheetName) {
          const nameToId = {};
          mergedLoans.forEach((l) => { nameToId[l.name] = l.id; });
          const histRows = XLSX.utils.sheet_to_json(wb.Sheets[loanHistSheetName], { defval: "" });
          histRows.forEach((r) => {
            const month = String(r["월"] || "").trim();
            const name = String(r["대출이름"] || "").trim();
            const balance = Number(r["잔액"]);
            const loanId = nameToId[name];
            if (month && loanId && !isNaN(balance)) {
              mergedSnapshots[month] = { ...(mergedSnapshots[month] || {}), [loanId]: balance };
              loanHistAddedCount++;
            }
          });
        }
        if (loanAddedCount > 0 || loanHistAddedCount > 0) {
          const nextLoanData = { ...loanData, loans: mergedLoans, monthlySnapshots: mergedSnapshots };
          setLoanData(nextLoanData);
          debouncedSave(LOANS_KEY, nextLoanData, "대출 정보 저장에 실패했어요.");
        }
      }

      // 자산 + 부채 (같이 처리해서 월별 스냅샷을 한 번에 합쳐요)
      let assetAddedCount = 0;
      const assetSheetName = wb.SheetNames.find((n) => n === "자산");
      const liabSheetName = wb.SheetNames.find((n) => n === "부채");
      if (assetSheetName || liabSheetName) {
        const mergedAssetSnapshots = { ...(assetData.monthlySnapshots || {}) };
        const ensureMonth = (month) => {
          if (!mergedAssetSnapshots[month]) mergedAssetSnapshots[month] = { items: [], liabilities: [] };
          else mergedAssetSnapshots[month] = { items: [...(mergedAssetSnapshots[month].items || [])], liabilities: [...(mergedAssetSnapshots[month].liabilities || [])] };
        };
        if (assetSheetName) {
          const assetRows = XLSX.utils.sheet_to_json(wb.Sheets[assetSheetName], { defval: "" });
          assetRows.forEach((r) => {
            const month = String(r["월"] || "").trim();
            const name = String(r["자산이름"] || "").trim();
            const amount = Number(r["금액"]);
            if (!month || !name || isNaN(amount)) return;
            ensureMonth(month);
            const existing = mergedAssetSnapshots[month].items.find((a) => a.name === name);
            if (existing) existing.amount = amount;
            else mergedAssetSnapshots[month].items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, amount });
            assetAddedCount++;
          });
        }
        if (liabSheetName) {
          const liabRows = XLSX.utils.sheet_to_json(wb.Sheets[liabSheetName], { defval: "" });
          liabRows.forEach((r) => {
            const month = String(r["월"] || "").trim();
            const name = String(r["부채이름"] || "").trim();
            const amount = Number(r["금액"]);
            if (!month || !name || isNaN(amount)) return;
            ensureMonth(month);
            const existing = mergedAssetSnapshots[month].liabilities.find((l) => l.name === name);
            if (existing) existing.amount = amount;
            else mergedAssetSnapshots[month].liabilities.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, amount });
            assetAddedCount++;
          });
        }
        if (assetAddedCount > 0) {
          const nextAssetData = { monthlySnapshots: mergedAssetSnapshots };
          setAssetData(nextAssetData);
          debouncedSave(ASSETS_KEY, nextAssetData, "자산 정보 저장에 실패했어요.");
        }
      }

      // 예산
      let budgetAddedCount = 0;
      const budgetSheetName = wb.SheetNames.find((n) => n === "예산");
      if (budgetSheetName) {
        const budgetRows = XLSX.utils.sheet_to_json(wb.Sheets[budgetSheetName], { defval: "" });
        const mergedBudgets = { ...monthlyBudgets };
        budgetRows.forEach((r) => {
          const month = String(r["월"] || "").trim();
          const groupLabelStr = String(r["그룹"] || "").trim();
          const amount = Number(r["예산금액"]);
          const group = groups.find((g) => g.label === groupLabelStr);
          if (!month || !group || isNaN(amount)) return;
          mergedBudgets[month] = { ...(mergedBudgets[month] || {}), [group.id]: amount };
          budgetAddedCount++;
        });
        if (budgetAddedCount > 0) persistBudgets(mergedBudgets);
      }

      // 기본 설정
      let settingsRestored = false;
      const settingsSheetName = wb.SheetNames.find((n) => n === "설정");
      if (settingsSheetName) {
        const settingsRows = XLSX.utils.sheet_to_json(wb.Sheets[settingsSheetName], { defval: "" });
        const settingsMap = {};
        settingsRows.forEach((r) => { settingsMap[String(r["항목"] || "").trim()] = r["값"]; });
        const nextSettings = { ...settings };
        if (settingsMap["정산시작일"] != null && settingsMap["정산시작일"] !== "") nextSettings.cycleStartDay = Number(settingsMap["정산시작일"]) || 1;
        if (settingsMap["가계부이름"]) nextSettings.title = String(settingsMap["가계부이름"]);
        if (settingsMap["대출상환모드"]) nextSettings.loanModeEnabled = String(settingsMap["대출상환모드"]).trim().toUpperCase() !== "OFF";
        if (settingsMap["환율통화"]) nextSettings.fxCurrency = String(settingsMap["환율통화"]);
        if (settingsMap["환율값"] != null && settingsMap["환율값"] !== "") nextSettings.fxRate = Number(settingsMap["환율값"]) || 0;
        persistSettings(nextSettings);
        if (settingsMap["대출목표일"]) {
          persistLoans({ ...loanData, targetDate: String(settingsMap["대출목표일"]) });
        }
        settingsRestored = true;
      }

      const summaryParts = [];
      if (newOnes.length > 0) summaryParts.push(`거래 ${newOnes.length}건`);
      if (recurAddedCount > 0) summaryParts.push(`정기지출 ${recurAddedCount}건`);
      if (loanAddedCount > 0) summaryParts.push(`대출 ${loanAddedCount}건`);
      if (loanHistAddedCount > 0) summaryParts.push(`대출기록 ${loanHistAddedCount}건`);
      if (assetAddedCount > 0) summaryParts.push(`자산·부채 ${assetAddedCount}건`);
      if (budgetAddedCount > 0) summaryParts.push(`예산 ${budgetAddedCount}건`);
      if (settingsRestored) summaryParts.push("설정");

      if (summaryParts.length === 0) {
        setSaveError("엑셀에서 읽을 수 있는 내용이 없어요. 이전에 이 앱에서 내보낸 파일인지 확인해주세요.");
        return;
      }

      if (newOnes.length > 0) {
        const ok = await persistTx([...newOnes, ...transactions]);
        if (!ok) return;
      }
      setToast(`${summaryParts.join(", ")} 불러왔어요`);
    } catch (err) {
      setSaveError("엑셀 파일을 읽는 데 실패했어요. 파일 형식을 확인해주세요.");
    } finally {
      e.target.value = "";
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 gap-2">
        <Loader2 className="animate-spin" size={20} />
        <span>불러오는 중...</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 bg-slate-50 min-h-screen font-sans text-slate-800">
      <style>{`
        input, select, textarea { font-size: 16px !important; }
      `}</style>
      <header className="mb-5 relative">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="text-2xl font-bold text-slate-900 bg-transparent border-b-2 border-emerald-400 focus:outline-none w-full"
              />
            ) : (
              <h1 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
                <Wallet size={24} className="text-emerald-600 shrink-0" />
                <span className="truncate">{settings.title || "우리집 가계부"}</span>
              </h1>
            )}
          </div>
          <div className="relative shrink-0">
            <button
              onClick={() => setShowHeaderMenu((s) => !s)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
              aria-label="메뉴"
            >
              <MoreVertical size={20} />
            </button>
            {showHeaderMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowHeaderMenu(false)} />
                <div className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 w-60">
                  <button
                    onClick={() => {
                      setTitleDraft(settings.title || "우리집 가계부");
                      setEditingTitle(true);
                      setShowHeaderMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    제목 수정
                  </button>
                  <button
                    onClick={() => { openCategoryManager(); setShowHeaderMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    카테고리 관리
                  </button>
                  <button
                    onClick={() => {
                      persistSettings({ ...settings, loanModeEnabled: settings.loanModeEnabled === false ? true : false });
                      setShowHeaderMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    대출상환모드 {settings.loanModeEnabled === false ? "켜기" : "끄기"}
                  </button>
                  <button
                    onClick={() => {
                      setCycleDraft(settings.cycleStartDay || 1);
                      setShowCycleModal(true);
                      setShowHeaderMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    정산 시작일 설정
                  </button>
                  <button
                    onClick={() => { setShowUpdateHistory(true); setShowHeaderMenu(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Bell size={14} /> 업데이트 내역
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    onClick={() => { exportToExcel("all"); setShowHeaderMenu(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download size={14} /> 엑셀 백업(대출·자산·부채)
                  </button>
                  <button
                    onClick={() => { importInputRef.current && importInputRef.current.click(); setShowHeaderMenu(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-emerald-700 hover:bg-slate-50"
                  >
                    <Upload size={14} /> 엑셀 백업 불러오기
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    onClick={() => { signOutUser(); setShowHeaderMenu(false); }}
                    className="w-full flex items-center gap-1.5 text-left px-3 py-2 text-sm text-red-500 hover:bg-slate-50"
                  >
                    <LogOut size={14} /> 로그아웃
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        <button
          onClick={() => setPage("home")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${page === "home" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
        >
          홈
        </button>
        <button
          onClick={() => setPage("stats")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${page === "stats" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
        >
          통계
        </button>
      </div>

      {page === "stats" ? (
        <>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">월별 수입·지출 추이</h3>

          <div className="flex gap-1.5 mb-3 overflow-x-auto">
            {[["3", "3개월"], ["6", "6개월"], ["12", "12개월"], ["all", "전체"], ["custom", "기간 설정"]].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setStatsPeriod(val)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${statsPeriod === val ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {statsPeriod === "custom" && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">시작</label>
                <DatePickerField value={statsFrom} onChange={setStatsFrom} />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">끝</label>
                <DatePickerField value={statsTo} onChange={setStatsTo} />
              </div>
            </div>
          )}

          <div className="flex gap-3 mb-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showIncome} onChange={(e) => setShowIncome(e.target.checked)} className="w-3.5 h-3.5 accent-[#34d399]" />
              수입
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showExpense} onChange={(e) => setShowExpense(e.target.checked)} className="w-3.5 h-3.5 accent-[#f87171]" />
              지출
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showNet} onChange={(e) => setShowNet(e.target.checked)} className="w-3.5 h-3.5 accent-[#38bdf8]" />
              순현금흐름
            </label>
          </div>

          {monthlyTrend.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">이 기간엔 기록이 없어요.</p>
          ) : !showIncome && !showExpense && !showNet ? (
            <p className="text-sm text-slate-400 text-center py-10">위에서 하나 이상 체크해주세요.</p>
          ) : (
            <>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <ComposedChart data={monthlyTrend} margin={{ top: 26, right: 8, left: 8, bottom: 20 }} barCategoryGap="30%" barGap={8}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" tickMargin={14} />
                    <YAxis hide domain={[(dataMin) => Math.min(dataMin, 0), (dataMax) => Math.max(dataMax, 0)]} />
                    {showIncome && <Bar dataKey="income" name="수입" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={30} label={makeBarValueLabel(monthlyTrend, "income", "expense")} />}
                    {showExpense && <Bar dataKey="expense" name="지출" fill="#f87171" radius={[3, 3, 0, 0]} maxBarSize={30} label={makeBarValueLabel(monthlyTrend, "expense", "income")} />}
                    {showNet && <Line type="linear" dataKey="net" name="순현금흐름" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} label={makeLineValueLabel("#0284c7")} />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="text-left font-medium py-1.5 pr-3 sticky left-0 bg-white"> </th>
                      {monthlyTrend.map((m) => (
                        <th key={m.month} colSpan={2} className="text-center font-medium py-1.5 px-2 whitespace-nowrap">{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 text-slate-700 font-medium whitespace-nowrap sticky left-0 bg-white">수입</td>
                      {monthlyTrend.map((m, i) => (
                        <React.Fragment key={m.month}>
                          <td className="py-1.5 pl-2 text-right text-emerald-600 whitespace-nowrap">+{formatWon(m.income)}</td>
                          <td className="py-1.5 pl-1 pr-2 text-left whitespace-nowrap">{i > 0 && renderDeltaBadge(m.income, monthlyTrend[i - 1].income)}</td>
                        </React.Fragment>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 text-slate-700 font-medium whitespace-nowrap sticky left-0 bg-white">지출</td>
                      {monthlyTrend.map((m, i) => (
                        <React.Fragment key={m.month}>
                          <td className="py-1.5 pl-2 text-right text-red-500 whitespace-nowrap">-{formatWon(m.expense)}</td>
                          <td className="py-1.5 pl-1 pr-2 text-left whitespace-nowrap">{i > 0 && renderDeltaBadge(m.expense, monthlyTrend[i - 1].expense)}</td>
                        </React.Fragment>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-3 text-slate-700 font-semibold whitespace-nowrap sticky left-0 bg-white">순현금흐름</td>
                      {monthlyTrend.map((m, i) => (
                        <React.Fragment key={m.month}>
                          <td className={`py-1.5 pl-2 text-right font-semibold whitespace-nowrap ${m.net >= 0 ? "text-slate-800" : "text-red-600"}`}>
                            {formatWon(m.net)}
                          </td>
                          <td className="py-1.5 pl-1 pr-2 text-left whitespace-nowrap">{i > 0 && renderDeltaBadge(m.net, monthlyTrend[i - 1].net)}</td>
                        </React.Fragment>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">카테고리별 지출 추이</h3>
            <select
              value={statsCategoryGroup}
              onChange={(e) => setStatsCategoryGroup(e.target.value)}
              className="h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white text-slate-600"
            >
              <option value="전체">그룹 선택</option>
              {EXPENSE_GROUPS.map((g) => <option key={g.label} value={g.label}>{g.label}</option>)}
            </select>
          </div>
          {statsCategoryGroup === "전체" ? (
            <p className="text-sm text-slate-400 text-center py-10">위에서 카테고리 그룹을 선택해보세요.</p>
          ) : categoryTrendStacked.data.length === 0 || categoryTrendStacked.data.every((m) => categoryTrendStacked.subCats.every((c) => !m[c])) ? (
            <p className="text-sm text-slate-400 text-center py-10">이 기간엔 "{statsCategoryGroup}" 지출이 없어요.</p>
          ) : (
            <>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={categoryTrendStacked.data} margin={{ top: 28, right: 16, left: 8, bottom: 5 }} barCategoryGap="15%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis hide />
                    {categoryTrendStacked.subCats.map((c, idx) => (
                      <Bar
                        key={c}
                        dataKey={c}
                        name={c}
                        stackId="a"
                        fill={categoryColor(c)}
                        maxBarSize={64}
                        label={idx === categoryTrendStacked.subCats.length - 1 ? makeStackedTotalLabel(categoryTrendStacked.data, categoryTrendStacked.subCats) : undefined}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="text-left font-medium py-1.5 pr-3 sticky left-0 bg-white"> </th>
                      {categoryTrendStacked.data.map((m) => (
                        <th key={m.month} colSpan={2} className="text-center font-medium py-1.5 px-2 whitespace-nowrap">{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {categoryTrendStacked.subCats.map((c) => (
                      <tr key={c} className="border-b border-slate-50">
                        <td className="py-1.5 pr-3 text-slate-700 font-medium whitespace-nowrap sticky left-0 bg-white">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor(c) }} />
                            {c}
                          </span>
                        </td>
                        {categoryTrendStacked.data.map((m, i) => (
                          <React.Fragment key={m.month}>
                            <td className="py-1.5 pl-2 text-right text-slate-600 whitespace-nowrap">{formatWon(m[c] || 0)}</td>
                            <td className="py-1.5 pl-1 pr-2 text-left whitespace-nowrap">{i > 0 && renderDeltaBadge(m[c] || 0, categoryTrendStacked.data[i - 1][c] || 0)}</td>
                          </React.Fragment>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1.5 pr-3 text-slate-700 font-semibold whitespace-nowrap sticky left-0 bg-white">합계</td>
                      {categoryTrendStacked.data.map((m, i) => {
                        const total = categoryTrendStacked.subCats.reduce((s, c) => s + (m[c] || 0), 0);
                        const prevTotal = i > 0 ? categoryTrendStacked.subCats.reduce((s, c) => s + (categoryTrendStacked.data[i - 1][c] || 0), 0) : null;
                        return (
                          <React.Fragment key={m.month}>
                            <td className="py-1.5 pl-2 text-right font-semibold text-slate-800 whitespace-nowrap">{formatWon(total)}</td>
                            <td className="py-1.5 pl-1 pr-2 text-left whitespace-nowrap">{i > 0 && renderDeltaBadge(total, prevTotal)}</td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>


        <div id="asset-input-card" className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="flex items-center justify-between">
            <button onClick={() => setShowAssetInputCard((s) => !s)} className="flex-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">자산·부채 입력</h3>
              {showAssetInputCard ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
            </button>
            <button
              onClick={() => setShowAssetHelpModal(true)}
              className="ml-2 w-5 h-5 shrink-0 rounded-full border border-slate-300 text-slate-400 text-xs font-semibold flex items-center justify-center hover:bg-slate-50"
              aria-label="사용법"
            >
              ?
            </button>
          </div>

          {showAssetInputCard && (
          <>
          <div className="flex items-center gap-2 mb-1 mt-3">
            <label className="text-xs text-slate-500 shrink-0">기록 월</label>
            <select
              value={assetViewMonth}
              onChange={(e) => setAssetViewMonth(e.target.value)}
              className="h-9 border border-slate-200 rounded-lg px-2 text-sm bg-white"
            >
              {assetMonthOptions.map((m) => <option key={m} value={m}>{formatCycleLabel(m, 1)}</option>)}
            </select>
          </div>
          {effectiveAssetView.isRecorded ? (() => {
            const laterMonths = Object.keys(assetData.monthlySnapshots || {}).filter((m) => m > assetViewMonth).sort();
            const nextRecorded = laterMonths[0];
            const [vy, vm] = assetViewMonth.split("-").map(Number);
            let ny = vy, nm = vm + 1;
            if (nm > 12) { nm = 1; ny += 1; }
            const immediateNextMonth = `${ny}-${String(nm).padStart(2, "0")}`;
            const isImmediateNext = nextRecorded === immediateNextMonth;
            return (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mb-3">
                ✏️ {formatCycleLabel(assetViewMonth, 1)}에 직접 기록한 값이에요.{" "}
                {nextRecorded
                  ? (isImmediateNext
                      ? `여기 금액을 고치면 ${formatCycleLabel(assetViewMonth, 1)}에만 적용돼요 — ${formatCycleLabel(nextRecorded, 1)}은 이미 따로 기록이 있어요. (새로 추가하거나 삭제하는 건 이후 기록에도 같이 반영돼요.)`
                      : `여기 금액을 고치면 ${formatCycleLabel(nextRecorded, 1)} 전까지의 달에도 이 값이 이어져요 (${formatCycleLabel(nextRecorded, 1)}부터는 그때 기록한 값으로 바뀌어요). 새로 추가하거나 삭제하는 건 이후 기록에도 같이 반영돼요.`)
                  : "여기 금액을 고치면 그 이후로 따로 기록하지 않은 모든 달(미래 포함)에 이 값이 계속 이어져요."}
              </p>
            );
          })() : effectiveAssetView.sourceMonth ? (
            <p className="text-xs text-sky-600 bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5 mb-3">
              ℹ️ {formatCycleLabel(assetViewMonth, 1)}에 직접 기록이 없어서, {formatCycleLabel(effectiveAssetView.sourceMonth, 1)} 값을 쓰고 있어요. 수정하면 {formatCycleLabel(assetViewMonth, 1)}에만 적용되고, 이후 달에는 여기서 수정한 값이 이어져요.
            </p>
          ) : (
            <p className="text-xs text-slate-400 mb-3">아직 기록이 없어요. 값을 입력하면 {formatCycleLabel(assetViewMonth, 1)} 기록으로 저장돼요.</p>
          )}

          <div className="bg-slate-50 rounded-xl p-3 mb-1">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>총 자산</span>
              <span className="font-semibold text-slate-700 tabular-nums">{formatWon(assetTotals.totalAssets)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500 mb-2">
              <span>총 부채 (대출잔액)</span>
              <span className="font-semibold text-red-500 tabular-nums">-{formatWon(assetTotals.totalDebt)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="text-sm font-semibold text-slate-800">순자산</span>
              <span className={`text-base font-bold tabular-nums ${assetTotals.netWorth >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                {formatWon(assetTotals.netWorth)}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">항목을 눌러서 수정·삭제할 수 있어요.</p>

          <h4 className="text-xs font-semibold text-slate-500 mb-2">자산</h4>
          {effectiveAssetView.items.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-3">등록된 자산이 없어요. 아래에서 추가해보세요.</p>
          ) : (
            <ul className="divide-y divide-slate-100 mb-1">
              {effectiveAssetView.items.map((a) => (
                <li key={a.id} onClick={() => openAssetSheet("asset", a)} className="py-2 flex items-center gap-1.5 cursor-pointer active:bg-slate-50 rounded-lg transition">
                  <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{a.name}</span>
                  <span className="text-sm font-semibold text-slate-700 shrink-0">{formatWon(a.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          {showAddAssetForm ? (
            <form onSubmit={(e) => { if (addAssetItem(e)) setShowAddAssetForm(false); }} className="space-y-1.5 mb-5 mt-2">
              <input
                ref={assetNameInputRef}
                autoFocus
                value={newAssetName}
                onChange={(e) => { setNewAssetName(e.target.value); setAssetErrorMsg(""); }}
                placeholder="자산 이름"
                className="w-full h-9 border border-slate-200 rounded-lg px-2 text-sm bg-white"
              />
              {(assetErrorMsg || isDuplicateAssetName) && <p className="text-xs text-red-500">{assetErrorMsg || "이미 있는 이름이에요"}</p>}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(newAssetAmount)}
                  onChange={(e) => setNewAssetAmount(parseNumberInput(e.target.value))}
                  placeholder="금액"
                  className="flex-1 h-9 border border-slate-200 rounded-lg px-2 text-sm bg-white text-right"
                />
                <button
                  type="submit"
                  disabled={isDuplicateAssetName}
                  className={`px-4 h-9 rounded-lg text-white text-xs shrink-0 ${isDuplicateAssetName ? "bg-slate-300 cursor-not-allowed" : "bg-slate-900"}`}
                >
                  추가
                </button>
                <button type="button" onClick={() => setShowAddAssetForm(false)} className="px-3 h-9 rounded-lg border border-slate-200 text-slate-500 text-xs shrink-0">취소</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowAddAssetForm(true)} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 py-2 mb-3">
              <Plus size={13} /> 자산 추가
            </button>
          )}

          <h4 className="text-xs font-semibold text-red-600 mb-2 pt-3 border-t border-slate-100">부채</h4>
          {effectiveAssetView.liabilities.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">등록된 부채가 없어요.</p>
          ) : (
            <ul className="divide-y divide-slate-100 mb-1">
              {effectiveAssetView.liabilities.map((l) => (
                <li key={l.id} onClick={() => openAssetSheet("liability", l)} className="py-2 flex items-center gap-1.5 cursor-pointer active:bg-slate-50 rounded-lg transition">
                  <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{l.name}</span>
                  <span className="text-sm font-semibold text-red-600 shrink-0">{formatWon(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          {showAddLiabilityForm ? (
            <form onSubmit={(e) => { if (addLiabilityItem(e)) setShowAddLiabilityForm(false); }} className="space-y-1.5 mb-3 mt-2">
              <input
                ref={liabilityNameInputRef}
                autoFocus
                value={newLiabilityName}
                onChange={(e) => { setNewLiabilityName(e.target.value); setLiabilityErrorMsg(""); }}
                placeholder="부채 이름"
                className="w-full h-9 border border-slate-200 rounded-lg px-2 text-sm bg-white"
              />
              {(liabilityErrorMsg || isDuplicateLiabilityName) && <p className="text-xs text-red-500">{liabilityErrorMsg || "이미 있는 이름이에요"}</p>}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(newLiabilityAmount)}
                  onChange={(e) => setNewLiabilityAmount(parseNumberInput(e.target.value))}
                  placeholder="금액"
                  className="flex-1 h-9 border border-slate-200 rounded-lg px-2 text-sm bg-white text-right"
                />
                <button
                  type="submit"
                  disabled={isDuplicateLiabilityName}
                  className={`px-4 h-9 rounded-lg text-white text-xs shrink-0 ${isDuplicateLiabilityName ? "bg-slate-300 cursor-not-allowed" : "bg-slate-900"}`}
                >
                  추가
                </button>
                <button type="button" onClick={() => setShowAddLiabilityForm(false)} className="px-3 h-9 rounded-lg border border-slate-200 text-slate-500 text-xs shrink-0">취소</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowAddLiabilityForm(true)} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 py-2 mb-1">
              <Plus size={13} /> 부채 추가
            </button>
          )}

          <p className="text-xs font-medium text-slate-600 mb-1.5 mt-3">대출 <span className="font-normal text-slate-400">(부채에 포함)</span></p>
          {loanData.loans.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">등록된 대출이 없어요. 홈 화면 "대출 상환 목표"에서 추가할 수 있어요.</p>
          ) : loanData.loans.every((l) => assetViewLoanBalances[l.id] === undefined) ? (
            <p className="text-xs text-slate-400 text-center py-2">{formatCycleLabel(assetViewMonth, 1)}엔 아직 등록된 대출이 없었어요.</p>
          ) : (
            <ul className="divide-y divide-slate-100 mb-1">
              {loanData.loans.filter((l) => assetViewLoanBalances[l.id] !== undefined).map((l) => (
                <li
                  key={l.id}
                  onClick={() => openAssetSheet("loan", { id: l.id, name: l.name, amount: assetViewLoanBalances[l.id] || 0 })}
                  className="py-2 flex items-center gap-1.5 cursor-pointer active:bg-slate-50 rounded-lg transition"
                >
                  <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{l.name}</span>
                  <span className="text-sm font-semibold text-red-600 shrink-0">{formatWon(assetViewLoanBalances[l.id] || 0)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-400 mb-2 mt-1">대출 이름·이자율·목표일은 홈 화면 "대출 상환 목표"에서 관리해요.</p>

          {Object.keys(assetData.monthlySnapshots || {}).length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <button onClick={() => setShowRecordedMonths((s) => !s)} className="w-full flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-slate-500">기록된 월</h4>
                {showRecordedMonths ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              </button>
              {showRecordedMonths && (
              <>
              <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                한 달을 삭제하면 그 달에 저장돼있던 기록(그때 새로 넣은 항목·이월받아 보이던 항목 구분 없이 전부)이 통째로 없어져요. 다른 달의 기록은 그대로 남고, 삭제한 달은 다시 그 이전 가장 최근 기록을 이어받아 보여줘요.
              </p>
              <ul className="divide-y divide-slate-50 max-h-40 overflow-y-auto">
                {Object.keys(assetData.monthlySnapshots).sort().reverse().map((month) => {
                  const snap = assetData.monthlySnapshots[month];
                  const ta = (snap.items || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
                  const loanBalances = getEffectiveLoanBalances(loanData.monthlySnapshots, month, loanData.loans);
                  const loanDebt = Object.values(loanBalances).reduce((s, v) => s + (Number(v) || 0), 0);
                  const td = loanDebt + (snap.liabilities || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
                  const nw = ta - td;
                  return (
                    <li key={month} className="flex items-center justify-between py-1.5 text-xs">
                      <button onClick={() => setAssetViewMonth(month)} className="text-slate-500 hover:text-slate-800">
                        {formatCycleLabel(month, 1)}
                      </button>
                      <div className="text-right">
                        <div className={`font-medium ${nw >= 0 ? "text-slate-700" : "text-red-600"}`}>{formatWon(nw)}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">자산 {formatWon(ta)}, 부채 -{formatWon(td)}</div>
                      </div>
                      {confirmDeleteSnapshotMonth === month ? (
                        <span className="flex items-center gap-1 shrink-0">
                          <button onClick={() => { deleteSnapshotMonth(month); setConfirmDeleteSnapshotMonth(null); }} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500 text-white">삭제</button>
                          <button onClick={() => setConfirmDeleteSnapshotMonth(null)} className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-600">취소</button>
                        </span>
                      ) : (
                        <button onClick={() => { setConfirmDeleteSnapshotMonth(month); setToast("삭제하면 이 달 기록이 없어지고, 이전 기록을 이어받아요"); }} className="text-slate-300 hover:text-red-500 shrink-0 ml-2" aria-label="기록 삭제">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              </>
              )}
            </div>
          )}
          </>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">자산·부채 그래프</h3>
          <p className="text-xs text-slate-400 mb-3">기록해두신 흐름이에요. 이어받은 달까지 포함해서 매끄럽게 이어져요.</p>

          <div className="flex gap-3 mb-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showAssetBar} onChange={(e) => setShowAssetBar(e.target.checked)} className="w-3.5 h-3.5 accent-[#34d399]" />
              자산
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showDebtBar} onChange={(e) => setShowDebtBar(e.target.checked)} className="w-3.5 h-3.5 accent-[#f87171]" />
              부채
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showNetBar} onChange={(e) => setShowNetBar(e.target.checked)} className="w-3.5 h-3.5 accent-[#38bdf8]" />
              순자산
            </label>
          </div>

          {assetHistoryFiltered.length < 2 ? (
            <p className="text-xs text-slate-400 text-center py-6">
              자산 금액을 두 번 이상 수정하면, 그 흐름이 그래프로 쌓여요.
            </p>
          ) : !showAssetBar && !showDebtBar && !showNetBar ? (
            <p className="text-sm text-slate-400 text-center py-10">위에서 하나 이상 체크해주세요.</p>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <ComposedChart data={assetHistoryFiltered} margin={{ top: 26, right: 8, left: 8, bottom: 20 }} barCategoryGap="30%" barGap={8}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" tickMargin={14} />
                  <YAxis hide domain={[(dataMin) => Math.min(dataMin, 0), (dataMax) => Math.max(dataMax, 0)]} />
                  {showAssetBar && <Bar dataKey="totalAssets" name="자산" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={30} label={makeBarValueLabel(assetHistoryFiltered, "totalAssets", "totalDebt")} />}
                  {showDebtBar && <Bar dataKey="totalDebt" name="부채" fill="#f87171" radius={[3, 3, 0, 0]} maxBarSize={30} label={makeBarValueLabel(assetHistoryFiltered, "totalDebt", "totalAssets")} />}
                  {showNetBar && <Line type="linear" dataKey="netWorth" name="순자산" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} label={makeLineValueLabel("#0284c7")} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-slate-700">월별 재무상태표</h3>
            <select
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
              className="h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white"
            >
              {monthOptions.map((m) => <option key={m} value={m}>{formatCycleLabel(m, settings.cycleStartDay)}</option>)}
            </select>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            {balanceSheetSnapshot
              ? `${formatCycleLabel(balanceSheetSnapshot.month, 1)} 기준으로 기록된(또는 이어받은) 값이에요.`
              : "이 달 이전엔 저장된 자산 기록이 없어요."}
          </p>

          {balanceSheetSnapshot ? (
            <div className="bg-slate-50 rounded-xl p-3 mb-3">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>총 자산</span>
                <span className="font-semibold text-slate-700 tabular-nums">{formatWon(balanceSheetSnapshot.totalAssets)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 mb-2">
                <span>총 부채</span>
                <span className="font-semibold text-red-500 tabular-nums">-{formatWon(balanceSheetSnapshot.totalDebt)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="text-sm font-semibold text-slate-800">순자산</span>
                <span className={`text-base font-bold tabular-nums ${balanceSheetSnapshot.netWorth >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                  {formatWon(balanceSheetSnapshot.netWorth)}
                </span>
              </div>
              {balanceSheetSnapshot.netWorthChange != null && (
                <div className="text-[11px] text-slate-400 pt-1.5 mt-1.5 border-t border-slate-100">
                  전월대비 순자산 {balanceSheetSnapshot.netWorthChange >= 0 ? "+" : ""}{formatWon(balanceSheetSnapshot.netWorthChange)}
                  {balanceSheetSnapshot.changeNote ? ` (${balanceSheetSnapshot.changeNote})` : ""}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-6">위 "자산·부채 입력" 카드에서 값을 기록하면 여기에 표시돼요.</p>
          )}

          {balanceSheetSnapshot && balanceSheetSnapshot.items.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-500 mb-1.5">자산 상세 ({formatCycleLabel(reportMonth, 1)} 기준)</h4>
              <ul className="space-y-1">
                {balanceSheetSnapshot.items.map((a) => (
                  <li key={a.id} className="flex justify-between text-xs text-slate-600">
                    <span className="truncate">{a.name}</span>
                    <span className="font-medium">{formatWon(a.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {((balanceSheetSnapshot && balanceSheetSnapshot.loanDetail.length > 0) || (balanceSheetSnapshot && balanceSheetSnapshot.liabilities.length > 0)) && (
            <div className="pt-2 mt-2 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-500 mb-1.5">부채 상세 ({formatCycleLabel(reportMonth, 1)} 기준)</h4>
              <ul className="space-y-1.5">
                {balanceSheetSnapshot.loanDetail.map((l) => (
                  <li key={l.id} className="text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span className="truncate">{l.name} <span className="text-slate-400">(대출)</span></span>
                      <span className="font-medium text-red-500">{formatWon(l.balance)}</span>
                    </div>
                    {l.paidThisMonth !== 0 && (
                      <div className="text-[11px] text-slate-400">
                        {l.paidThisMonth > 0 ? `이 달에 ${formatWon(l.paidThisMonth)} 갚았어요` : `이 달에 ${formatWon(-l.paidThisMonth)} 늘었어요`}
                      </div>
                    )}
                  </li>
                ))}
                {balanceSheetSnapshot.liabilities.map((l) => (
                  <li key={l.id} className="flex justify-between text-xs text-slate-600">
                    <span className="truncate">{l.name}</span>
                    <span className="font-medium text-red-500">{formatWon(l.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loanData.loans.length > 0 && (
            <div className="pt-2 mt-2 border-t border-slate-100">
            <button
              onClick={() => {
                setShowAssetInputCard(true);
                setTimeout(() => document.getElementById("asset-input-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
              }}
              className="text-left text-[11px] text-slate-400 underline decoration-dotted"
            >
              자산·부채·대출 내역은 위 "자산·부채 입력" 카드에서 월별로 고칠 수 있어요. (누르면 바로 이동)
            </button>
            </div>
          )}
        </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">{currentYear}년 누적 요약</h3>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="bg-emerald-50 rounded-lg px-3 py-2">
            <div className="text-[11px] text-emerald-600">총수입</div>
            <div className="text-sm font-semibold text-emerald-700">{formatWon(yearStats.income)}</div>
          </div>
          <div className="bg-red-50 rounded-lg px-3 py-2">
            <div className="text-[11px] text-red-500">총지출</div>
            <div className="text-sm font-semibold text-red-600">{formatWon(yearStats.expense)}</div>
          </div>
          <div className="bg-green-50 rounded-lg px-3 py-2">
            <div className="text-[11px] text-green-600">저축/투자</div>
            <div className="text-sm font-semibold text-green-700">{formatWon(yearStats.savings)}</div>
          </div>
          {settings.loanModeEnabled !== false && (
            <>
              <div className="bg-purple-50 rounded-lg px-3 py-2">
                <div className="text-[11px] text-purple-600">대출 원금상환</div>
                <div className="text-sm font-semibold text-purple-700">{formatWon(yearStats.principal)}</div>
              </div>
              <div className="bg-rose-50 rounded-lg px-3 py-2">
                <div className="text-[11px] text-rose-600">대출 이자</div>
                <div className="text-sm font-semibold text-rose-700">{formatWon(yearStats.interest)}</div>
              </div>
            </>
          )}
          <div className="bg-slate-50 rounded-lg px-3 py-2">
            <div className="text-[11px] text-slate-500">순증감 (수입-지출)</div>
            <div className={`text-sm font-semibold ${yearStats.net >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatWon(yearStats.net)}</div>
          </div>
        </div>
      </div>
        </>
      ) : (
        <>

      {saveError && (
        <div className="mb-4 flex items-center justify-between gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>{saveError}</span>
          {lastFailedSave && (
            <button onClick={retrySave} className="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition">
              재시도
            </button>
          )}
        </div>
      )}

      {budgetWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {budgetWarnings.map((w, i) => (
            <div key={i} className="flex items-center gap-1.5 text-sm text-amber-700">
              <span>⚠️</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-5">
        <button
          onClick={() => setShowRecurring((s) => !s)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-800"
        >
          <span className="flex items-center gap-2">
            📋 정기지출 체크리스트 ({formatCycleLabel(selectedMonth, settings.cycleStartDay)})
            {recurringItems.length > 0 && (
              <span className="text-xs font-normal text-slate-400">
                ({recurringItems.filter((item) => monthTx.some((t) => t.type === "expense" && t.category === item.category && t.memo === item.name)).length}/{recurringItems.length})
              </span>
            )}
          </span>
          {showRecurring ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </button>
        {showRecurring && (
          <div className="px-4 pb-4">
            <p className="text-[11px] text-slate-400 mb-2">
              체크하면 "월별 요약"에서 선택한 달의 설정된 날짜로 기록돼요. 지난달 걸 지금 채우려면 월별 요약에서 지난달을 선택하고 체크하세요.
            </p>
            {recurringItems.length > 0 && (
              <p className="text-[11px] text-slate-500 mb-3">
                이번 달 체크: <span className="font-semibold text-emerald-600">{formatWon(recurSummary.checked)}</span> / 총 {formatWon(recurSummary.total)}
              </p>
            )}
            {recurringItems.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">등록된 정기지출이 없어요. 아래에서 추가해보세요.</p>
            ) : (
              <ul className="divide-y divide-slate-100 mb-3">
                {[...recurringItems].sort((a, b) => (a.day || 1) - (b.day || 1)).map((item) => {
                  const logged = monthTx.some((t) => t.type === "expense" && t.category === item.category && t.memo === item.name);
                  return (
                    <li key={item.id} className="py-1.5 flex items-center gap-2">
                      <button
                        onClick={() => toggleRecurringLogged(item)}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                          logged ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400"
                        }`}
                        aria-label={logged ? "완료 취소" : "완료 표시"}
                      >
                        <CheckCircle2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openRecurEditSheet(item)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-sm truncate ${logged ? "text-slate-400 line-through" : "text-slate-800"}`}>{item.name}</span>
                          <span className={`text-sm font-medium shrink-0 ${logged ? "text-slate-400 line-through" : "text-slate-800"}`}>{formatWon(item.amount)}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {item.category} · 매월 {item.day || 1}{(item.day || 1) === 28 ? "(말일)" : ""}일
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {showAddRecurring ? (
              <form className="space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <input
                  value={newRecurName}
                  onChange={(e) => setNewRecurName(e.target.value)}
                  placeholder="항목명 (예: 넷플릭스 구독)"
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newRecurCategory}
                    onChange={(e) => setNewRecurCategory(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white"
                  >
                    {FIXED_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="금액"
                    value={formatNumberInput(newRecurAmount)}
                    onChange={(e) => setNewRecurAmount(parseNumberInput(e.target.value))}
                    className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">매월 며칠에 낼지</label>
                  <select
                    value={newRecurDay}
                    onChange={(e) => setNewRecurDay(e.target.value)}
                    className="w-24 h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}일{d === 28 ? "(말일)" : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAddRecurring(false)} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600">취소</button>
                  <button type="button" onClick={addRecurringItem} className="flex-1 py-2 rounded-lg bg-slate-900 text-white text-sm">추가</button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowAddRecurring(true)}
                className="w-full py-2 text-xs text-slate-500 border border-dashed border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                + 정기지출 항목 추가
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-5">
        <button
          onClick={() => setShowInstallment((s) => !s)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-800"
        >
          <span className="flex items-center gap-2">💳 할부 거래 한번에 등록</span>
          {showInstallment ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </button>
        {showInstallment && (
          <form className="px-4 pb-4 space-y-2">
            <p className="text-xs text-slate-400 -mt-1 mb-1">총액을 개월 수로 나눠서 한 번에 등록해요. 나눠떨어지지 않는 금액은 마지막 달에서 맞춰져요.</p>
            <input
              value={instName}
              onChange={(e) => setInstName(e.target.value)}
              placeholder="항목명 (예: 아이폰 할부)"
              className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">총액</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(instTotal)}
                  onChange={(e) => setInstTotal(parseNumberInput(e.target.value))}
                  placeholder="0"
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">개월 수</label>
                <input
                  type="number"
                  min="1"
                  value={instMonths}
                  onChange={(e) => setInstMonths(e.target.value)}
                  placeholder="예: 6"
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">시작 월</label>
                <DatePickerField
                  value={`${instStartMonth}-01`}
                  onChange={(d) => setInstStartMonth(d.slice(0, 7))}
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">카테고리</label>
                <select
                  value={instCategory}
                  onChange={(e) => setInstCategory(e.target.value)}
                  className="w-full h-11 border border-slate-200 rounded-lg px-2 text-sm bg-white"
                >
                  {EXPENSE_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((c) => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            {Number(instTotal) > 0 && Number(instMonths) > 0 && (() => {
              const monthly = Math.floor(Number(instTotal) / Number(instMonths));
              const remainder = Number(instTotal) - monthly * Number(instMonths);
              return (
                <p className="text-xs text-slate-500">
                  {instStartMonth}월부터 {instMonths}개월간 매달 {formatWon(monthly)}씩
                  {remainder > 0 ? ` (마지막 달만 ${formatWon(monthly + remainder)})` : ""}
                  , 총 {formatWon(Number(instTotal))} 등록돼요.
                </p>
              );
            })()}
            <button type="button" onClick={addInstallment} className="w-full flex items-center justify-center gap-1 bg-slate-900 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-slate-800 transition">
              <Plus size={16} /> 할부 등록하기
            </button>
          </form>
        )}
      </div>

      <form ref={addFormRef} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-5">
        <div className="flex gap-2 mb-3">
          <button type="button" onClick={() => handleTypeChange("expense")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${type === "expense" ? "bg-red-500 text-white" : "bg-slate-100 text-slate-500"}`}>지출</button>
          <button type="button" onClick={() => handleTypeChange("income")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${type === "income" ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500"}`}>수입</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">날짜</label>
            <DatePickerField value={date} onChange={setDate} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">카테고리</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full h-11 box-border border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
              {type === "expense"
                ? EXPENSE_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((c) => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                  ))
                : incomeGroups.map((g) => (
                    <optgroup key={g.id} label={g.label}>
                      {g.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                  ))}
            </select>
          </div>
        </div>

        {type === "expense" && (
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs text-slate-600">✈️ 현지통화로 입력</label>
            <button
              type="button"
              onClick={toggleTravelMode}
              className={`relative w-10 h-6 rounded-full transition ${travelMode ? "bg-emerald-500" : "bg-slate-300"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${travelMode ? "translate-x-4" : ""}`} />
            </button>
          </div>
        )}

        {travelMode ? (
          <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 mb-3">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">통화</label>
                <select
                  value={settings.fxCurrency}
                  onChange={(e) => {
                    const nextCurrency = e.target.value;
                    const remembered = settings.fxRates?.[nextCurrency];
                    persistSettings({ ...settings, fxCurrency: nextCurrency, fxRate: remembered !== undefined ? remembered : "" });
                  }}
                  className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white">
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.label})</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">오늘 환율 (1{settings.fxCurrency}=원)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="예: 9.1"
                  value={settings.fxRate}
                  onChange={(e) => {
                    const nextRate = e.target.value.replace(/[^0-9.]/g, "");
                    persistSettings({
                      ...settings,
                      fxRate: nextRate,
                      fxRates: { ...(settings.fxRates || {}), [settings.fxCurrency]: nextRate },
                    });
                  }}
                  className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white" />
              </div>
            </div>
            <label className="text-[11px] text-slate-500 block mb-1">{settings.fxCurrency} 금액</label>
            <input type="text" inputMode="decimal" placeholder="0" value={foreignAmount}
              onChange={(e) => setForeignAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white mb-2" />
            <div className="flex justify-between items-center text-xs bg-white rounded-lg px-3 py-2 border border-sky-100">
              <span className="text-slate-500">환산 금액</span>
              <span className="font-semibold text-sky-700">{formatWon(fxComputedAmount)}</span>
            </div>
            <div className="mt-2">
              <label className="text-[11px] text-slate-500 block mb-1">메모 (선택)</label>
              <input type="text" placeholder="예: 라멘집" value={memo} onChange={(e) => setMemo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addTransaction(e); }
                  if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); submitBtnRef.current && submitBtnRef.current.focus(); }
                }}
                className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-500">금액 (원)</label>
                {type === "expense" && (
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input type="checkbox" checked={isNegative} onChange={(e) => setIsNegative(e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600" />
                    마이너스
                  </label>
                )}
              </div>
              <input
                ref={amountInputRef}
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={amount ? (isNegative ? "-" : "") + formatNumberInput(amount) : ""}
                onChange={(e) => setAmount(parseNumberInput(e.target.value))}
                className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">메모 (선택)</label>
              <input ref={memoInputRef} type="text" placeholder="예: 점심 식사" value={memo} onChange={(e) => setMemo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addTransaction(e); }
                  if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); submitBtnRef.current && submitBtnRef.current.focus(); }
                }}
                className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button ref={submitBtnRef} type="button" onClick={addTransaction}
            className="flex-1 flex items-center justify-center gap-1 text-white rounded-xl py-2.5 text-sm font-medium transition bg-slate-900 hover:bg-slate-800">
            <Plus size={16} /> 추가하기
          </button>
        </div>
      </form>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-900">월별 요약</h2>
        <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white">
          {monthOptions.map((m) => <option key={m} value={m}>{formatCycleLabel(m, settings.cycleStartDay)}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">이번 달 잔액 계산</h3>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setBalanceCardView("summary")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${balanceCardView === "summary" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
            >
              요약보기
            </button>
            <button
              onClick={() => setBalanceCardView("detail")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${balanceCardView === "detail" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
            >
              현금흐름표
            </button>
          </div>
        </div>

        {balanceCardView === "summary" ? (
          <>
            <ul className="text-sm divide-y divide-slate-100">
              <li className="flex justify-between py-1.5">
                <span className="text-slate-600">총수입 (전체)</span>
                <span className="font-medium text-emerald-600">+{formatWon(totalIncome)}</span>
              </li>
              {groups.map((g) => {
                const spent = monthTx.filter((t) => t.type === "expense" && g.categories.includes(t.category)).reduce((s, t) => s + t.amount, 0);
                return (
                  <li key={g.id} className="flex justify-between py-1.5">
                    <span className="text-slate-600">{g.label}</span>
                    <span className="font-medium text-red-500">-{formatWon(spent)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-between items-center mt-2 pt-3 border-t border-slate-200">
              <span className="text-sm font-semibold text-slate-800">이번 달 순현금흐름</span>
              <span className={`text-base font-bold ${balance >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatWon(balance)}</span>
            </div>
          </>
        ) : (
          <>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 mb-2.5">
            <h4 className="text-xs font-bold text-emerald-700 mb-1.5">🟢 수입</h4>
            {cashFlowStatement.incomeItems.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">기록 없음</p>
            ) : (
              <ul className="space-y-1">
                {cashFlowStatement.incomeItems.map((i) => (
                  <li key={i.name} className="flex justify-between text-xs text-slate-600">
                    <span>{i.name}</span>
                    <span className="text-emerald-600 font-medium">+{formatWon(i.value)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-between text-xs font-bold text-emerald-800 mt-1.5 pt-1.5 border-t border-emerald-200">
              <span>수입 합계</span>
              <span>{formatWon(cashFlowStatement.totalIncome)}</span>
            </div>
          </div>

          <div className="rounded-xl border border-red-100 bg-red-50/50 p-3 mb-2.5">
            <h4 className="text-xs font-bold text-red-700 mb-1.5">🔴 고정지출 <span className="font-normal text-slate-400">· 매달 정해진 시기에 나가는 지출</span></h4>
            {cashFlowStatement.fixedItems.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">기록 없음</p>
            ) : (
              <ul className="space-y-1">
                {cashFlowStatement.fixedItems.map((i) => (
                  <li key={i.name} className="flex justify-between text-xs text-slate-600">
                    <span>{i.name}</span>
                    <span className={`font-medium ${i.value < 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {i.value < 0 ? "+" : "-"}{formatWon(Math.abs(i.value))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-between text-xs font-bold text-red-800 mt-1.5 pt-1.5 border-t border-red-200">
              <span>고정지출 합계</span>
              <span>{formatWon(cashFlowStatement.totalFixed)}</span>
            </div>
          </div>

          <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3 mb-2.5">
            <h4 className="text-xs font-bold text-sky-700 mb-1.5">🔵 자산형성지출 <span className="font-normal text-slate-400">· 저축·투자, 대출 원금상환처럼 내 자산으로 쌓이는 지출</span></h4>
            {cashFlowStatement.assetItems.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">기록 없음</p>
            ) : (
              <ul className="space-y-1">
                {cashFlowStatement.assetItems.map((i) => (
                  <li key={i.name} className="flex justify-between text-xs text-slate-600">
                    <span>{i.name}</span>
                    <span className={`font-medium ${i.value < 0 ? "text-emerald-600" : "text-sky-600"}`}>
                      {i.value < 0 ? "+" : "-"}{formatWon(Math.abs(i.value))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-between text-xs font-bold text-sky-800 mt-1.5 pt-1.5 border-t border-sky-200">
              <span>자산형성지출 합계</span>
              <span>{formatWon(cashFlowStatement.totalAsset)}</span>
            </div>
          </div>

          <div className="rounded-xl border border-red-100 bg-red-50/50 p-3 mb-2.5">
            <h4 className="text-xs font-bold text-red-700 mb-2">🔴 변동지출 <span className="font-normal text-slate-400">· 내 의지로 조절 가능한 지출</span></h4>
            {cashFlowStatement.variableGroups.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">기록 없음</p>
            ) : (
              cashFlowStatement.variableGroups.map((g) => (
                <div key={g.label} className="mb-2 last:mb-0">
                  <div className="flex justify-between text-[11px] font-semibold text-slate-500 mb-1">
                    <span>{g.label}</span>
                    <span className={g.total < 0 ? "text-emerald-600" : ""}>
                      {g.total < 0 ? "+" : "-"}{formatWon(Math.abs(g.total))}
                    </span>
                  </div>
                  <ul className="space-y-1 pl-2">
                    {g.items.map((i) => (
                      <li key={i.name} className="flex justify-between text-xs text-slate-600">
                        <span>{i.name}</span>
                        <span className={`font-medium ${i.value < 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {i.value < 0 ? "+" : "-"}{formatWon(Math.abs(i.value))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            <div className="flex justify-between text-xs font-bold text-red-800 mt-1.5 pt-1.5 border-t border-red-200">
              <span>변동지출 합계</span>
              <span>{formatWon(cashFlowStatement.totalVariable)}</span>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 mb-2">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>변동지출 한도 <span className="text-slate-400">(수입 - 고정 - 자산형성)</span></span>
              <span className="font-semibold text-slate-700">{formatWon(cashFlowStatement.variableLimit)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>실제 변동지출</span>
              <span className={`font-semibold ${cashFlowStatement.totalVariable > cashFlowStatement.variableLimit ? "text-red-500" : "text-emerald-600"}`}>
                {formatWon(cashFlowStatement.totalVariable)}
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-slate-200">
            <span className="text-sm font-semibold text-slate-800">순현금흐름</span>
            <span className={`text-base font-bold ${cashFlowStatement.net >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              {formatWon(cashFlowStatement.net)}
            </span>
          </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-1 text-xs text-emerald-600 mb-1"><TrendingUp size={14} /> 수입</div>
          <div className="text-sm font-bold text-slate-900 break-words">{formatWon(totalIncome)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-1 text-xs text-red-500 mb-1"><TrendingDown size={14} /> 지출</div>
          <div className="text-sm font-bold text-slate-900 break-words">{formatWon(totalExpense)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-1 text-xs text-slate-500 mb-1"><Wallet size={14} /> 잔액</div>
          <div className={`text-sm font-bold break-words ${balance >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatWon(balance)}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">이번 달 예산 현황</h3>
          <div className="relative">
            <button
              onClick={() => setShowBudgetMenu((s) => !s)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
              aria-label="메뉴"
            >
              <MoreVertical size={18} />
            </button>
            {showBudgetMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowBudgetMenu(false)} />
                <div className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 w-36">
                  <button
                    onClick={() => {
                      setBudgetEditMode((m) => !m);
                      setEditingBudgetGroupId(null);
                      setShowBudgetMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {budgetEditMode ? "예산 수정 닫기" : "예산 수정"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {groups.filter((g) => g.budgetEnabled).length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">예산이 설정된 그룹이 없어요. 오른쪽 위 ⋯ 메뉴 → 카테고리 관리에서 켜보세요.</p>
        ) : (
          groups.filter((g) => g.budgetEnabled).map((g) => {
            const spent = monthTx.filter((t) => t.type === "expense" && g.categories.includes(t.category)).reduce((s, t) => s + t.amount, 0);
            return (
              <div key={g.id} className="mb-3 last:mb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-600">{g.label}</span>
                  {editingBudgetGroupId === g.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoFocus
                        value={formatNumberInput(budgetDraft)}
                        onChange={(e) => setBudgetDraft(parseNumberInput(e.target.value))}
                        className="w-24 h-7 border border-slate-200 rounded-lg px-1.5 text-xs text-right"
                      />
                      <button
                        onClick={() => {
                          persistBudgets({ ...monthlyBudgets, [selectedMonth]: { ...(monthlyBudgets[selectedMonth] || {}), [g.id]: Number(budgetDraft) || 0 } });
                          setEditingBudgetGroupId(null);
                          setToast(`${g.label} ${selectedMonth}월 예산을 저장했어요`);
                        }}
                        className="text-xs px-2 py-1 rounded-lg bg-slate-900 text-white"
                      >
                        저장
                      </button>
                      <button onClick={() => setEditingBudgetGroupId(null)} className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600">취소</button>
                    </div>
                  ) : (
                    budgetEditMode && (
                      <button
                        onClick={() => { setEditingBudgetGroupId(g.id); setBudgetDraft(String(getGroupBudget(g.id, selectedMonth))); }}
                        className="text-[11px] text-slate-400 hover:text-slate-600"
                      >
                        이 달 예산 수정
                      </button>
                    )
                  )}
                </div>
                <ProgressBar label="" spent={spent} budget={getGroupBudget(g.id, selectedMonth)} />
                {(() => {
                  const remain = getGroupBudget(g.id, selectedMonth) - spent;
                  return (
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-[11px] text-slate-400">{remain >= 0 ? "남은 예산" : "초과 금액"}</span>
                      <span className={`text-xs font-semibold ${remain >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {remain >= 0 ? formatWon(remain) : `-${formatWon(Math.abs(remain))}`}
                      </span>
                    </div>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>

      {showCategoryManager && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={cancelCategoryManager} />
          <div
            className="fixed inset-x-3 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-lg max-w-md mx-auto flex flex-col"
            style={{ maxHeight: Math.round(viewportH * 0.8) + "px" }}
          >
          <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">카테고리 관리</h3>
            <button onClick={cancelCategoryManager} className="text-slate-400 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-3 flex-1 min-h-0" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">지출 카테고리</h4>
          {draftGroups.map((g) => (
            <div key={g.id} className="mb-4 last:mb-0 bg-slate-50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2 gap-2">
                <input
                  value={g.label}
                  onChange={(e) => renameGroupLabel(g.id, e.target.value)}
                  className="flex-1 min-w-0 text-sm font-semibold text-slate-800 bg-transparent border-b border-transparent focus:border-slate-300 focus:outline-none"
                />
                <button onClick={() => setPendingDelete({ type: "group", groupId: g.id, label: g.label })} className="text-slate-300 hover:text-red-500 shrink-0" aria-label="그룹 삭제">
                  <Trash2 size={14} />
                </button>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                <input type="checkbox" checked={g.budgetEnabled} onChange={() => toggleGroupBudget(g.id)} className="w-4 h-4 accent-emerald-600" />
                이 그룹에 예산 설정하기
                {g.budgetEnabled && (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput(g.budget)}
                    onChange={(e) => updateGroupBudgetAmount(g.id, parseNumberInput(e.target.value))}
                    className="w-28 h-7 border border-slate-200 rounded-lg px-2 text-xs bg-white ml-1"
                  />
                )}
              </label>

              <div className="flex flex-wrap gap-1.5 mb-2">
                {g.categories.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-slate-600">
                    <input
                      value={c}
                      onChange={(e) => renameCategoryInGroup(g.id, c, e.target.value)}
                      className="bg-transparent border-0 focus:outline-none text-xs w-auto"
                      style={{ width: `${Math.max(c.length * 1.8 + 1, 3)}ch` }}
                    />
                    <button onClick={() => setPendingDelete({ type: "category", groupId: g.id, name: c })} className="text-slate-300 hover:text-red-500">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-1.5">
                <input
                  value={newCatText[g.id] || ""}
                  onChange={(e) => setNewCatText({ ...newCatText, [g.id]: e.target.value })}
                  placeholder="카테고리 추가"
                  className="flex-1 h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white"
                />
                <button
                  onClick={() => { addCategoryToGroup(g.id, newCatText[g.id]); setNewCatText({ ...newCatText, [g.id]: "" }); }}
                  className="px-3 h-8 rounded-lg bg-slate-900 text-white text-xs shrink-0"
                >
                  추가
                </button>
              </div>
            </div>
          ))}

          <div className="flex gap-1.5 mb-4">
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="새 지출그룹 이름 (예: 자녀 교육비)"
              className="flex-1 h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white"
            />
            <button onClick={() => addNewGroup(newGroupName)} className="px-3 h-8 rounded-lg bg-emerald-600 text-white text-xs shrink-0">새 지출그룹 추가</button>
          </div>

          <div className="border-t border-slate-200 my-4" />
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">수입 카테고리</h4>
          {draftIncomeGroups.map((g) => (
            <div key={g.id} className="mb-4 last:mb-0 bg-emerald-50/60 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2 gap-2">
                <input
                  value={g.label}
                  onChange={(e) => renameIncomeGroupLabel(g.id, e.target.value)}
                  className="flex-1 min-w-0 text-sm font-semibold text-slate-800 bg-transparent border-b border-transparent focus:border-slate-300 focus:outline-none"
                />
                <button onClick={() => setPendingDelete({ type: "incomeGroup", groupId: g.id, label: g.label })} className="text-slate-300 hover:text-red-500 shrink-0" aria-label="그룹 삭제">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-2">
                {g.categories.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-slate-600">
                    <input
                      value={c}
                      onChange={(e) => renameCategoryInIncomeGroup(g.id, c, e.target.value)}
                      className="bg-transparent border-0 focus:outline-none text-xs w-auto"
                      style={{ width: `${Math.max(c.length * 1.8 + 1, 3)}ch` }}
                    />
                    <button onClick={() => setPendingDelete({ type: "incomeCategory", groupId: g.id, name: c })} className="text-slate-300 hover:text-red-500">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-1.5">
                <input
                  value={newCatText[g.id] || ""}
                  onChange={(e) => setNewCatText({ ...newCatText, [g.id]: e.target.value })}
                  placeholder="카테고리 추가"
                  className="flex-1 h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white"
                />
                <button
                  onClick={() => { addCategoryToIncomeGroup(g.id, newCatText[g.id]); setNewCatText({ ...newCatText, [g.id]: "" }); }}
                  className="px-3 h-8 rounded-lg bg-slate-900 text-white text-xs shrink-0"
                >
                  추가
                </button>
              </div>
            </div>
          ))}

          <div className="flex gap-1.5">
            <input
              value={newCatText.newIncomeGroup || ""}
              onChange={(e) => setNewCatText({ ...newCatText, newIncomeGroup: e.target.value })}
              placeholder="새 수입그룹 이름 (예: 부수입)"
              className="flex-1 h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white"
            />
            <button
              onClick={() => { addNewIncomeGroup(newCatText.newIncomeGroup); setNewCatText({ ...newCatText, newIncomeGroup: "" }); }}
              className="px-3 h-8 rounded-lg bg-emerald-600 text-white text-xs shrink-0"
            >
              새 수입그룹 추가
            </button>
          </div>
          </div>

          <div className="flex gap-2 px-4 py-3 border-t border-slate-100 shrink-0">
            <button onClick={cancelCategoryManager} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600">
              취소
            </button>
            <button onClick={applyCategoryManager} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium">
              적용
            </button>
          </div>
          </div>

          {pendingDelete && (() => {
            let affectedCount = 0;
            if (pendingDelete.type === "group") {
              const g = draftGroups.find((x) => x.id === pendingDelete.groupId);
              const cats = g ? g.categories : [];
              affectedCount = transactions.filter((t) => cats.includes(t.category)).length;
            } else if (pendingDelete.type === "category") {
              affectedCount = transactions.filter((t) => t.category === pendingDelete.name).length;
            } else if (pendingDelete.type === "incomeGroup") {
              const g = draftIncomeGroups.find((x) => x.id === pendingDelete.groupId);
              const cats = g ? g.categories : [];
              affectedCount = transactions.filter((t) => t.type === "income" && cats.includes(t.category)).length;
            } else if (pendingDelete.type === "incomeCategory") {
              affectedCount = transactions.filter((t) => t.type === "income" && t.category === pendingDelete.name).length;
            }
            return (
            <>
              <div className="fixed inset-0 bg-black/40 z-[60]" onClick={() => setPendingDelete(null)} />
              <div className="fixed inset-x-8 top-1/2 -translate-y-1/2 z-[70] bg-white rounded-2xl p-5 shadow-lg max-w-xs mx-auto">
                <p className="text-sm font-medium text-slate-800 text-center mb-1">
                  {pendingDelete.type === "group" && `"${pendingDelete.label}" 그룹을 삭제할까요?`}
                  {pendingDelete.type === "category" && `"${pendingDelete.name}" 카테고리를 삭제할까요?`}
                  {pendingDelete.type === "incomeGroup" && `"${pendingDelete.label}" 수입 그룹을 삭제할까요?`}
                  {pendingDelete.type === "incomeCategory" && `"${pendingDelete.name}" 수입 카테고리를 삭제할까요?`}
                </p>
                {affectedCount > 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 text-center mb-2">
                    ⚠️ 이 카테고리로 기록된 거래 {affectedCount}건이 있어요. 삭제하면 "기타"로 재분류돼요 (거래 자체는 안 지워져요).
                  </p>
                )}
                <p className="text-xs text-slate-400 text-center mb-4">
                  {(pendingDelete.type === "group" || pendingDelete.type === "incomeGroup") ? "그 안의 카테고리도 함께 없어져요. " : ""}
                  "적용"을 눌러야 실제로 반영돼요.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setPendingDelete(null)} className="flex-1 py-2 rounded-xl border border-slate-200 text-sm text-slate-600">
                    취소
                  </button>
                  <button
                    onClick={() => {
                      if (pendingDelete.type === "group") removeGroup(pendingDelete.groupId);
                      if (pendingDelete.type === "category") removeCategoryFromGroup(pendingDelete.groupId, pendingDelete.name);
                      if (pendingDelete.type === "incomeGroup") removeIncomeGroup(pendingDelete.groupId);
                      if (pendingDelete.type === "incomeCategory") removeCategoryFromIncomeGroup(pendingDelete.groupId, pendingDelete.name);
                    }}
                    className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </>
            );
          })()}
        </>
      )}

      {monthTx.some((t) => t.type === "expense") && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-700">지출 카테고리 비중</h3>
            <select
              value={pieGroupFilter}
              onChange={(e) => {
                setPieGroupFilter(e.target.value);
                persistSettings({ ...settings, defaultPieGroup: e.target.value });
              }}
              className="h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white text-slate-600"
            >
              <option value="전체">전체</option>
              {EXPENSE_GROUPS.map((g) => <option key={g.label} value={g.label}>{g.label}</option>)}
            </select>
          </div>
          {categoryData.length > 0 ? (
            <>
              <div style={{ width: "100%", height: 270 }}>
                <ResponsiveContainer>
                  <PieChart margin={{ top: 24, right: 44, left: 44, bottom: 24 }}>
                    <Pie
                      data={categoryData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={68}
                      paddingAngle={2}
                      label={renderPieSliceLabel}
                      labelLine={false}
                    >
                      {categoryData.map((entry, i) => <Cell key={i} fill={categoryColor(entry.name)} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {(() => {
                const total = categoryData.reduce((s, c) => s + c.value, 0);
                return (
                  <table className="w-full mt-2 text-xs border-collapse">
                    <tbody>
                      {categoryData.map((c) => (
                        <tr key={c.name} className="border-b border-slate-50 last:border-0">
                          <td className="py-1.5 text-center text-slate-400 whitespace-nowrap w-12">{total > 0 ? ((c.value / total) * 100).toFixed(0) : 0}%</td>
                          <td className="py-1.5">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: categoryColor(c.name) }} />
                              <span className="text-slate-700 truncate">{c.name}</span>
                            </span>
                          </td>
                          <td className="py-1.5 text-right text-slate-800 font-medium whitespace-nowrap w-28">{formatWon(c.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </>
          ) : (
            <p className="text-sm text-slate-400 text-center py-10">이 그룹에는 이번 달 지출이 없어요.</p>
          )}
          {topGroupTransactions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-500 mb-2">
                {pieGroupFilter === "전체" ? "전체" : pieGroupFilter} 중 금액 큰 거래 Top 5
              </h4>
              <table className="w-full text-xs border-collapse">
                <tbody>
                  {topGroupTransactions.map((t, i) => (
                    <tr key={t.id}>
                      <td className="py-1 pr-1.5 text-slate-300 font-medium w-4">{i + 1}</td>
                      <td className="py-1 pr-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="inline-block shrink-0 truncate text-[11px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap"
                            style={{ backgroundColor: `${categoryColor(t.category)}20`, color: categoryColor(t.category) }}
                          >
                            {t.category}
                          </span>
                          <span className="text-slate-400 truncate">{t.memo || "-"}</span>
                        </span>
                      </td>
                      <td className="py-1 pl-2 text-right text-slate-500 font-medium whitespace-nowrap w-28">{formatWon(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}


      {settings.loanModeEnabled !== false && (
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Target size={16} className="text-purple-500" /> 대출 상환 목표
          </h3>
          <div className="relative">
            <button
              onClick={() => setShowLoanMenu((s) => !s)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
              aria-label="메뉴"
            >
              <MoreVertical size={18} />
            </button>
            {showLoanMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowLoanMenu(false)} />
                <div className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 w-32">
                  <button
                    onClick={() => { setShowAddLoanForm((v) => !v); setShowLoanDetails(true); setShowLoanMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {showAddLoanForm ? "대출 추가 닫기" : "대출 추가"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-purple-700 font-medium">전체 상환 진행률</span>
            <span className="text-purple-700">{loanTotals.pct.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2.5 bg-purple-100 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${loanTotals.pct}%` }} />
          </div>
          <div className="flex justify-between text-xs text-slate-600">
            <span>남은 대출 총액</span>
            <span className="font-semibold">{formatWon(loanTotals.totalBalance)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-600 mt-1">
            <span>지금까지 낸 이자 총액 (주담대 제외)</span>
            <span className="font-semibold text-rose-600">{formatWon(totalInterestPaid)}</span>
          </div>
          {loanData.targetDate && (
            <>
              <div className="flex justify-between text-xs text-slate-600 mt-1">
                <span>목표일까지 남은 개월</span>
                <span className="font-semibold">{loanTotals.monthsLeft}개월</span>
              </div>
              <div className="flex justify-between text-xs text-slate-600 mt-1">
                <span>월 평균 필요 상환액</span>
                <span className="font-semibold text-purple-700">{formatWon(loanTotals.monthlyNeeded)}</span>
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => setShowLoanDetails((s) => !s)}
          className="w-full flex items-center justify-center gap-1 text-xs text-slate-500 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition mb-3"
        >
          {showLoanDetails ? <>대출 목록 접기 <ChevronUp size={14} /></> : <>대출 목록 보기 <ChevronDown size={14} /></>}
        </button>

        {showLoanDetails && (
          <>
        <div className="mb-3">
          <label className="text-xs text-slate-500 block mb-1">상환 목표일</label>
          <DatePickerField value={loanData.targetDate} onChange={updateTargetDate} className="max-w-[200px]" />
        </div>

        {loanData.loans.some((l) => l.completed) && (
          <label className="flex items-center gap-2 mb-3 text-xs text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showCompletedLoans}
              onChange={(e) => setShowCompletedLoans(e.target.checked)}
              className="w-4 h-4 accent-purple-600"
            />
            상환완료한 대출도 함께보기 ({loanData.loans.filter((l) => l.completed).length}건 숨김)
          </label>
        )}

        <ul className="divide-y divide-slate-100 mb-3">
          {loanData.loans
            .filter((l) => showCompletedLoans || !l.completed)
            .map((l) => {
            return (
            <li key={l.id} className={`py-3 border-b border-slate-100 last:border-0 ${l.completed ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0 flex-1 flex items-start gap-1.5">
                  <Pencil size={11} className="text-slate-300 shrink-0 mt-1" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <input
                        value={l.name}
                        onChange={(e) => updateLoanName(l.id, e.target.value)}
                        disabled={l.completed}
                        className="min-w-0 flex-1 text-sm text-slate-700 bg-transparent border-0 focus:outline-none disabled:opacity-60"
                      />
                      {l.completed && <span className="text-[11px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full shrink-0">상환완료</span>}
                    </div>
                    {l.rate ? <div className="text-xs text-slate-400">이자율 {l.rate}%</div> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {confirmDeleteLoanId === l.id ? (
                    <>
                      <span className="text-xs text-red-500">삭제할까요?</span>
                      <button onClick={() => { deleteLoan(l.id); setConfirmDeleteLoanId(null); }}
                        className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition">삭제</button>
                      <button onClick={() => setConfirmDeleteLoanId(null)}
                        className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition">취소</button>
                    </>
                  ) : confirmCompleteLoanId === l.id ? (
                    <>
                      <span className="text-xs text-slate-500">상환완료로 처리할까요?</span>
                      <button onClick={() => { toggleLoanComplete(l.id); setConfirmCompleteLoanId(null); }}
                        className="text-xs px-2 py-1 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition">확인</button>
                      <button onClick={() => setConfirmCompleteLoanId(null)}
                        className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition">취소</button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => (l.completed ? toggleLoanComplete(l.id) : setConfirmCompleteLoanId(l.id))}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition ${
                          l.completed
                            ? "border border-slate-200 text-slate-500 hover:bg-slate-50"
                            : "bg-purple-50 text-purple-700 hover:bg-purple-100"
                        }`}
                      >
                        {l.completed ? <><RotateCcw size={12} /> 되돌리기</> : <><CheckCircle2 size={12} /> 상환완료</>}
                      </button>
                      <button onClick={() => setConfirmDeleteLoanId(l.id)} className="text-slate-300 hover:text-red-500 transition" aria-label="삭제">
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-0.5">최초금액</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput(l.originalBalance)}
                    onChange={(e) => updateLoanOriginal(l.id, parseNumberInput(e.target.value))}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-0.5">현재 잔액</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput(l.balance)}
                    onChange={(e) => updateLoanBalance(l.id, parseNumberInput(e.target.value))}
                    disabled={l.completed}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>
              </div>
            </li>
            );
          })}
        </ul>

        {showAddLoanForm && (
          <form className="space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <input type="text" placeholder="대출명" value={newLoanName} onChange={(e) => setNewLoanName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white" />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" inputMode="numeric" placeholder="잔액" value={formatNumberInput(newLoanBalance)}
                onChange={(e) => setNewLoanBalance(parseNumberInput(e.target.value))}
                className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white" />
              <input type="number" placeholder="이자율%" value={newLoanRate} onChange={(e) => setNewLoanRate(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white" />
            </div>
            <button type="button" onClick={(e) => { addLoan(e); setShowAddLoanForm(false); }} className="w-full flex items-center justify-center gap-1 bg-purple-600 text-white rounded-xl py-2 text-sm font-medium hover:bg-purple-700 transition">
              <PiggyBank size={16} /> 대출 추가
            </button>
          </form>
        )}
          </>
        )}
      </div>
      )}


      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-700">거래 내역</h3>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportExcel}
            className="sr-only"
          />
        </div>

        <button
          onClick={() => setShowTxDetails((s) => !s)}
          className="w-full flex items-center justify-center gap-1 text-xs text-slate-500 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition mb-3"
        >
          {showTxDetails ? <>상세내역 접기 <ChevronUp size={14} /></> : <>상세내역 보기 <ChevronDown size={14} /></>}
        </button>

        {showTxDetails && (
          <>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="메모·카테고리 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 border border-slate-200 rounded-lg pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-9 border border-slate-200 rounded-lg px-2 text-sm bg-white max-w-[45%]"
          >
            <option value="all">전체 카테고리</option>
            {incomeGroups.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
            ))}
            {EXPENSE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                <option value={`group:${g.label}`}>전체 {g.label}</option>
                {g.items.map((c) => <option key={c} value={c}>　{c}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="flex gap-2 mb-3">
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
            className="flex-1 h-9 border border-slate-200 rounded-lg px-2 text-sm bg-white"
          >
            <option value="all">전체 연도</option>
            {availableYears.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="flex-1 h-9 border border-slate-200 rounded-lg px-2 text-sm bg-white"
          >
            <option value="all">전체 월</option>
            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
              <option key={m} value={m}>{Number(m)}월</option>
            ))}
          </select>
        </div>
        <div className="flex justify-between items-center mb-3">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${viewMode === "list" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
            >
              목록
            </button>
            <button
              onClick={() => setViewMode("grouped")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${viewMode === "grouped" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
            >
              그룹별
            </button>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white text-slate-600"
          >
            <option value="date_desc">최신순</option>
            <option value="date_asc">오래된순</option>
            <option value="amount_desc">금액 큰순</option>
            <option value="amount_asc">금액 작은순</option>
          </select>
        </div>

        {viewMode === "grouped" ? (
          displayedTx.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              {searchQuery.trim() || filterCategory !== "all" || filterYear !== "all" || filterMonth !== "all" ? "조건에 맞는 기록이 없어요." : "이번 달 기록이 아직 없어요."}
            </p>
          ) : (
            <div className="space-y-4">
              {groupedView.map((group) => (
                <div key={group.name}>
                  <div className="flex justify-between items-center mb-1.5 px-1">
                    <span className="text-sm font-semibold text-slate-700">{group.name}</span>
                    <span className={`text-sm font-semibold ${group.name === "수입" ? "text-emerald-600" : "text-red-500"}`}>
                      {group.name === "수입" ? "+" : "-"}{formatWon(group.total)}
                    </span>
                  </div>
                  <div className="bg-slate-50 rounded-xl overflow-hidden">
                    {group.categories.map((cat) => {
                      const key = `${group.name}__${cat.name}`;
                      const isOpen = expandedCats.has(key);
                      return (
                        <div key={cat.name} className="border-b border-white last:border-0">
                          <button
                            onClick={() => toggleCatExpand(key)}
                            className="w-full flex justify-between items-center px-3 py-2 bg-slate-100/60 hover:bg-slate-100 transition"
                          >
                            <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                              {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              {cat.name}
                            </span>
                            <span className="text-xs font-medium text-slate-500">{formatWon(cat.total)} · {cat.items.length}건</span>
                          </button>
                          {isOpen && (
                            <ul className="divide-y divide-slate-100">
                              {cat.items.map((t) => (
                                <li
                                  key={t.id}
                                  onClick={() => setLongPressTx(t)}
                                  className="flex items-center justify-between px-3 py-2 bg-white select-none active:bg-slate-50 transition cursor-pointer"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm text-slate-800 truncate">{t.memo || "-"}</div>
                                    <div className="text-xs text-slate-400">{t.date}</div>
                                  </div>
                                  <span className={`text-sm font-medium shrink-0 ml-2 ${t.type === "income" ? "text-emerald-600" : (t.amount < 0 ? "text-emerald-600" : "text-slate-700")}`}>
                                    {t.amount < 0 ? "+" : ""}{formatWon(Math.abs(t.amount))}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
        <>
        {displayedTx.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">
            {searchQuery.trim() || filterCategory !== "all" || filterYear !== "all" || filterMonth !== "all" ? "조건에 맞는 기록이 없어요." : "이번 달 기록이 아직 없어요."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pagedTx.map((t, i) => {
              const showMonthHeader = (sortBy === "date_desc" || sortBy === "date_asc") && (i === 0 || getCycleLabel(pagedTx[i - 1].date, settings.cycleStartDay) !== getCycleLabel(t.date, settings.cycleStartDay));
              return (
              <React.Fragment key={t.id}>
                {showMonthHeader && (
                  <li className="pt-3 pb-1 first:pt-0">
                    <span className="text-xs font-semibold text-slate-400">{formatCycleLabel(getCycleLabel(t.date, settings.cycleStartDay), settings.cycleStartDay)}</span>
                  </li>
                )}
                <li
                onClick={() => setLongPressTx(t)}
                className="flex items-center justify-between gap-2 py-2.5 select-none active:bg-slate-50 rounded-lg transition cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="shrink-0 w-[68px] text-center text-[11px] px-1.5 py-1 rounded-full font-medium truncate"
                    style={{
                      backgroundColor: t.type === "income" ? "#ecfdf5" : `${categoryColor(t.category)}20`,
                      color: t.type === "income" ? "#059669" : categoryColor(t.category),
                    }}>
                    {t.category}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-800 truncate">{t.memo || (t.type === "income" ? "수입" : "지출")}</div>
                    <div className="text-xs text-slate-400">{t.date}</div>
                  </div>
                </div>
                <span className={`text-sm font-semibold whitespace-nowrap shrink-0 ${txDisplaySign(t).colorClass}`}>
                  {txDisplaySign(t).sign}{txDisplaySign(t).amountText}
                </span>
              </li>
              </React.Fragment>
              );
            })}
          </ul>
        )}
        {displayedTx.length > visibleCount && (
          <button
            onClick={() => setVisibleCount((c) => c + 20)}
            className="w-full mt-3 py-2 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            더보기 ({displayedTx.length - visibleCount}건 더 있음)
          </button>
        )}
        </>
        )}
          </>
        )}
      </div>

      {longPressTx && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setLongPressTx(null)} />
          <div className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl p-4 pb-6 shadow-lg">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-3" />
            <div className="text-sm text-slate-500 mb-3 text-center truncate">
              {longPressTx.memo || longPressTx.category} · {formatWon(longPressTx.amount)}
            </div>
            <button
              onClick={() => { startEdit(longPressTx); setLongPressTx(null); }}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium text-amber-700 bg-amber-50 rounded-xl mb-2"
            >
              <Pencil size={16} /> 수정하기
            </button>
            <button
              onClick={() => { setConfirmDeleteTxId(longPressTx.id); setLongPressTx(null); }}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium text-red-600 bg-red-50 rounded-xl mb-2"
            >
              <Trash2 size={16} /> 삭제하기
            </button>
            <button
              onClick={() => setLongPressTx(null)}
              className="w-full py-3 text-sm font-medium text-slate-500"
            >
              취소
            </button>
          </div>
        </>
      )}

      {confirmDeleteTxId && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setConfirmDeleteTxId(null)} />
          <div className="fixed inset-x-6 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl p-5 shadow-lg max-w-sm mx-auto">
            <p className="text-base font-medium text-slate-800 text-center mb-1">삭제할까요?</p>
            <p className="text-xs text-slate-400 text-center mb-4">삭제한 거래는 복구할 수 없어요.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteTxId(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600"
              >
                취소
              </button>
              <button
                onClick={() => { deleteTransaction(confirmDeleteTxId); setConfirmDeleteTxId(null); }}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium"
              >
                삭제
              </button>
            </div>
          </div>
        </>
      )}

      {editingId && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={cancelEdit} />
          <div className="fixed inset-x-3 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-lg max-w-md mx-auto max-h-[85vh] overflow-y-auto">
            <form className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800">거래 수정</h3>
                <button type="button" onClick={cancelEdit} className="text-slate-400 hover:text-slate-700">
                  <X size={18} />
                </button>
              </div>

              <div className="flex gap-2 mb-3">
                <button type="button" onClick={() => handleEmTypeChange("expense")}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${emType === "expense" ? "bg-red-500 text-white" : "bg-slate-100 text-slate-500"}`}>지출</button>
                <button type="button" onClick={() => handleEmTypeChange("income")}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${emType === "income" ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500"}`}>수입</button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">날짜</label>
                  <DatePickerField value={emDate} onChange={setEmDate} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">카테고리</label>
                  <select value={emCategory} onChange={(e) => setEmCategory(e.target.value)}
                    className="w-full h-11 box-border border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                    {emType === "expense"
                      ? EXPENSE_GROUPS.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.items.map((c) => <option key={c} value={c}>{c}</option>)}
                          </optgroup>
                        ))
                      : incomeGroups.map((g) => (
                          <optgroup key={g.id} label={g.label}>
                            {g.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                          </optgroup>
                        ))}
                  </select>
                </div>
              </div>

              {emType === "expense" && (
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs text-slate-600">✈️ 현지통화로 입력</label>
                  <button
                    type="button"
                    onClick={toggleEmTravelMode}
                    className={`relative w-10 h-6 rounded-full transition ${emTravelMode ? "bg-emerald-500" : "bg-slate-300"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${emTravelMode ? "translate-x-4" : ""}`} />
                  </button>
                </div>
              )}

              {emTravelMode ? (
                <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 mb-3">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">통화</label>
                      <select
                        value={settings.fxCurrency}
                        onChange={(e) => {
                          const nextCurrency = e.target.value;
                          const remembered = settings.fxRates?.[nextCurrency];
                          persistSettings({ ...settings, fxCurrency: nextCurrency, fxRate: remembered !== undefined ? remembered : "" });
                        }}
                        className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white">
                        {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.label})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">오늘 환율 (1{settings.fxCurrency}=원)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="예: 9.1"
                        value={settings.fxRate}
                        onChange={(e) => {
                          const nextRate = e.target.value.replace(/[^0-9.]/g, "");
                          persistSettings({
                            ...settings,
                            fxRate: nextRate,
                            fxRates: { ...(settings.fxRates || {}), [settings.fxCurrency]: nextRate },
                          });
                        }}
                        className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white" />
                    </div>
                  </div>
                  <label className="text-[11px] text-slate-500 block mb-1">{settings.fxCurrency} 금액</label>
                  <input type="text" inputMode="decimal" placeholder="0" value={emForeignAmount}
                    onChange={(e) => setEmForeignAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white mb-2" />
                  <div className="flex justify-between items-center text-xs bg-white rounded-lg px-3 py-2 border border-sky-100">
                    <span className="text-slate-500">환산 금액</span>
                    <span className="font-semibold text-sky-700">{formatWon(emFxComputedAmount)}</span>
                  </div>
                  <div className="mt-2">
                    <label className="text-[11px] text-slate-500 block mb-1">메모 (선택)</label>
                    <input type="text" placeholder="예: 라멘집" value={emMemo} onChange={(e) => setEmMemo(e.target.value)}
                      className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white" />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-slate-500">금액 (원)</label>
                      {emType === "expense" && (
                        <label className="flex items-center gap-1 text-[11px] text-slate-500">
                          <input type="checkbox" checked={emIsNegative} onChange={(e) => setEmIsNegative(e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600" />
                          마이너스
                        </label>
                      )}
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={emAmount ? (emIsNegative ? "-" : "") + formatNumberInput(emAmount) : ""}
                      onChange={(e) => setEmAmount(parseNumberInput(e.target.value))}
                      className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">메모 (선택)</label>
                    <input type="text" placeholder="예: 점심 식사" value={emMemo} onChange={(e) => setEmMemo(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button type="button" onClick={cancelEdit}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600">
                  취소
                </button>
                <button type="button" onClick={saveEditedTransaction}
                  className="flex-1 flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-700 text-white rounded-xl py-2.5 text-sm font-medium transition">
                  <Pencil size={16} /> 저장하기
                </button>
              </div>
            </form>
          </div>
        </>
      )}
        </>
      )}

      {assetSheetItem && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setAssetSheetItem(null)} />
          <div className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl p-4 pb-6 shadow-lg">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-3" />
            {assetSheetMode === "menu" && (
              <>
                <div className="text-sm text-slate-500 mb-3 text-center truncate">
                  {assetSheetItem.name} · {formatWon(assetSheetItem.amount)}
                </div>
                <button
                  onClick={() => setAssetSheetMode("edit")}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium text-amber-700 bg-amber-50 rounded-xl mb-2"
                >
                  <Pencil size={16} /> 수정하기
                </button>
                {assetSheetItem.type !== "loan" && (
                  <button
                    onClick={() => setAssetSheetMode("delete")}
                    className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium text-red-600 bg-red-50 rounded-xl mb-2"
                  >
                    <Trash2 size={16} /> 삭제하기
                  </button>
                )}
                <button onClick={() => setAssetSheetItem(null)} className="w-full py-3 text-sm font-medium text-slate-500">
                  취소
                </button>
              </>
            )}
            {assetSheetMode === "edit" && (
              <>
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">이름{assetSheetItem.type === "loan" ? " (홈 화면에서 관리)" : ""}</label>
                    <input
                      value={assetSheetNameDraft}
                      onChange={(e) => setAssetSheetNameDraft(e.target.value)}
                      disabled={assetSheetItem.type === "loan"}
                      className="w-full h-10 border border-slate-200 rounded-lg px-3 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">금액</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoFocus={assetSheetItem.type === "loan"}
                      value={formatNumberInput(assetSheetAmountDraft)}
                      onChange={(e) => setAssetSheetAmountDraft(parseNumberInput(e.target.value))}
                      className="w-full h-10 border border-slate-200 rounded-lg px-3 text-sm text-right"
                    />
                  </div>
                </div>
                <button onClick={saveAssetSheetEdit} className="w-full py-3 text-sm font-medium text-white bg-slate-900 rounded-xl mb-2">
                  저장
                </button>
                <button onClick={() => setAssetSheetMode("menu")} className="w-full py-3 text-sm font-medium text-slate-500">
                  뒤로
                </button>
              </>
            )}
            {assetSheetMode === "delete" && (() => {
              const laterCount = assetSheetItem.type === "asset" ? countLaterAssetMonths(assetSheetItem.name) : countLaterLiabilityMonths(assetSheetItem.name);
              return (
                <>
                  <p className="text-sm font-medium text-slate-800 text-center mb-1">삭제할까요?</p>
                  <p className="text-xs text-amber-600 text-center mb-1 px-2 leading-relaxed">
                    ⚠️ 이 {assetSheetItem.type === "asset" ? "자산이" : "부채가"} 이후 모든 달에 기록되어 있다면, 그 기록들도 함께 삭제됩니다.
                  </p>
                  {laterCount > 0 ? (
                    <p className="text-xs text-amber-600 text-center mb-4">(지금 바로 {laterCount}개월 기록에서 삭제돼요)</p>
                  ) : (
                    <div className="mb-4" />
                  )}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setAssetSheetMode("menu")} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600">
                      취소
                    </button>
                    <button onClick={confirmDeleteAssetSheet} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium">
                      삭제
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}

      {showWhatsNew && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
          onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
        >
          <div
            className="bg-white rounded-2xl shadow-lg max-w-sm w-full flex flex-col overflow-hidden"
            style={{ height: Math.round(viewportH * 0.85) + "px" }}
          >
            <h3 className="text-sm font-semibold text-slate-800 px-5 pt-5 shrink-0">📣 가계부 업데이트 소식!</h3>
            <p className="text-xs text-slate-500 px-5 mt-1 mb-3 shrink-0">새로운 기능이 많이 생겼어요 🙌</p>
            <div className="relative min-h-0 flex-1">
              <div
                ref={whatsNewScrollRef}
                onScroll={(e) => checkScrollBottom(e.currentTarget, setWhatsNewHasMore)}
                className="absolute inset-0 px-5 overflow-y-auto"
                style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
              >
                {UPDATE_HISTORY[0].items.map((s, i) => (
                  <div key={i} className="mb-3.5">
                    <h4 className="text-sm font-semibold text-slate-800 mb-1">
                      {i + 1}. {s.emoji} {s.title}
                    </h4>
                    <p className="text-xs text-slate-600 leading-relaxed">{s.body}</p>
                    {s.note && (
                      <p className="text-[11px] text-amber-600 mt-1 leading-relaxed">⚠️ {s.note}</p>
                    )}
                    {s.bullets && (
                      <ul className="mt-1.5 space-y-1">
                        {s.bullets.map((b, j) => (
                          <li key={j} className="text-xs text-slate-600 leading-relaxed flex gap-1.5">
                            <span className="text-slate-300 shrink-0">•</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              {whatsNewHasMore && (
                <div className="pointer-events-none absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-white to-transparent flex items-end justify-center pb-0.5">
                  <ChevronDown size={16} className="text-slate-300 animate-bounce" />
                </div>
              )}
            </div>
            <div className="px-5 pb-5 pt-2 shrink-0">
              <p className="text-[11px] text-slate-400 mb-3">🔄 이 앱은 자주 업데이트돼요. 새로고침을 자주 해주세요!</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowWhatsNew(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium"
                >
                  닫기
                </button>
                <button
                  onClick={() => { localStorage.setItem(WHATS_NEW_DISMISS_KEY, WHATS_NEW_VERSION); setShowWhatsNew(false); }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium"
                >
                  다시 안 보기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUpdateHistory && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowUpdateHistory(false); }}
          onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
        >
          <div
            className="bg-white rounded-2xl shadow-lg max-w-sm w-full flex flex-col overflow-hidden"
            style={{ height: Math.round(viewportH * 0.85) + "px" }}
          >
            <div className="flex items-center justify-between px-5 pt-5 shrink-0">
              <h3 className="text-sm font-semibold text-slate-800">🔔 업데이트 내역</h3>
              <button onClick={() => setShowUpdateHistory(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="relative min-h-0 flex-1">
              <div
                ref={historyScrollRef}
                onScroll={(e) => checkScrollBottom(e.currentTarget, setHistoryHasMore)}
                className="absolute inset-0 px-5 pb-5 pt-3 overflow-y-auto"
                style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
              >
                {UPDATE_HISTORY.map((release, ri) => (
                  <div key={release.date} className={ri > 0 ? "mt-4 pt-4 border-t border-slate-100" : ""}>
                    <p className="text-xs font-semibold text-slate-400 mb-2">{release.date}</p>
                    {release.items.map((s, i) => (
                      <div key={i} className="mb-3">
                        <h4 className="text-xs font-semibold text-slate-800 mb-0.5">{s.emoji} {s.title}</h4>
                        <p className="text-xs text-slate-600 leading-relaxed">{s.body}</p>
                        {s.note && (
                          <p className="text-[11px] text-amber-600 mt-0.5 leading-relaxed">⚠️ {s.note}</p>
                        )}
                        {s.bullets && (
                          <ul className="mt-1 space-y-1">
                            {s.bullets.map((b, j) => (
                              <li key={j} className="text-xs text-slate-600 leading-relaxed flex gap-1.5">
                                <span className="text-slate-300 shrink-0">•</span>
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {historyHasMore && (
                <div className="pointer-events-none absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-white to-transparent flex items-end justify-center pb-0.5">
                  <ChevronDown size={16} className="text-slate-300 animate-bounce" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAssetHelpModal && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowAssetHelpModal(false)} />
          <div className="fixed inset-x-6 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl p-5 shadow-lg max-w-sm mx-auto">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">자산·부채 입력 사용법</h3>
            <p className="text-xs text-slate-500 mb-2">자산과 부채를 월 단위로 관리해요. 기록 없는 달은 이전 달 값을 그대로 이어받아 보여줘요 — 누적 관리 방식이에요.</p>
            <p className="text-xs text-slate-500 mb-4">대출 잔액도 여기서 같이 관리돼요 — 이번 달을 수정하면 홈 화면 대출 카드에도 반영되고, 과거·미래 달은 그 달 기록만 바뀌어요.</p>
            <button onClick={() => setShowAssetHelpModal(false)} className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium">
              확인
            </button>
          </div>
        </>
      )}

      {showCycleModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowCycleModal(false)} />
          <div className="fixed inset-x-6 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl p-5 shadow-lg max-w-sm mx-auto">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">정산 시작일 설정</h3>
            <p className="text-xs text-slate-500 mb-4">
              월급날에 맞춰서 "이번 달"의 기준을 바꿀 수 있어요. 예: 25일로 설정하면 매달 25일~다음달 24일이 한 사이클이 돼요. 기본값은 1일(1일~말일)이에요.
            </p>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs text-slate-500 shrink-0">시작일</label>
              <select
                value={cycleDraft}
                onChange={(e) => setCycleDraft(Number(e.target.value))}
                className="flex-1 h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}일{d === 1 ? " (기본값)" : ""}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mb-4">
              ⚠️ 이미 입력된 거래 데이터는 전혀 안 건드려요. "몇 월로 묶어서 보여줄지"만 바뀌어요.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowCycleModal(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600">
                취소
              </button>
              <button
                onClick={() => {
                  persistSettings({ ...settings, cycleStartDay: cycleDraft });
                  setSelectedMonth(getCycleLabel(todayStr(), cycleDraft));
                  setShowCycleModal(false);
                  setToast("정산 시작일을 저장했어요 (거래는 유지되고 사이클 분류만 다시 계산돼요)");
                }}
                className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium"
              >
                저장
              </button>
            </div>
          </div>
        </>
      )}

      {editingRecurId && (() => {
        const editingItem = recurringItems.find((r) => r.id === editingRecurId);
        const relatedTxCount = editingItem
          ? transactions.filter((t) => t.type === "expense" && t.category === editingItem.category && t.memo === editingItem.name).length
          : 0;
        return (
          <>
            <div className="fixed inset-0 bg-black/40 z-[60]" onClick={closeRecurEditSheet} />
            <div className="fixed inset-x-3 top-1/2 -translate-y-1/2 z-[61] bg-white rounded-2xl shadow-lg max-w-md mx-auto max-h-[85vh] overflow-y-auto">
              <div className="p-4">
                {confirmDeleteInRecurSheet ? (
                  <>
                    <h3 className="text-sm font-semibold text-slate-800 text-center mb-1">삭제할까요?</h3>
                    <p className="text-sm text-slate-600 text-center mb-3">{editingItem?.name}</p>
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4 leading-relaxed">
                      {relatedTxCount > 0
                        ? `⚠️ 이 항목으로 지금까지 기록된 거래가 ${relatedTxCount}건 있어요. 그 거래 기록은 삭제되지 않고 그대로 남고, 체크리스트에서만 없어져요.`
                        : "⚠️ 아직 이 항목으로 기록된 거래는 없어요. 체크리스트에서 없어져요."}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmDeleteInRecurSheet(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600">
                        취소
                      </button>
                      <button
                        onClick={() => { deleteRecurringItem(editingRecurId); closeRecurEditSheet(); }}
                        className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium"
                      >
                        삭제
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-slate-800">정기지출 수정</h3>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setConfirmDeleteInRecurSheet(true)} className="text-slate-300 hover:text-red-500" aria-label="삭제">
                          <Trash2 size={16} />
                        </button>
                        <button onClick={closeRecurEditSheet} className="text-slate-400 hover:text-slate-700">
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="text-xs text-slate-500 block mb-1">이름</label>
                      <input
                        autoFocus
                        value={recurDraftName}
                        onChange={(e) => setRecurDraftName(e.target.value)}
                        className="w-full h-11 box-border border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">카테고리</label>
                        <select
                          value={recurDraftCategory}
                          onChange={(e) => setRecurDraftCategory(e.target.value)}
                          className="w-full h-11 box-border border border-slate-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        >
                          {FIXED_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">매월 며칠</label>
                        <select
                          value={recurDraftDay}
                          onChange={(e) => setRecurDraftDay(Number(e.target.value))}
                          className="w-full h-11 box-border border border-slate-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        >
                          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>{d}{d === 28 ? "(말일)" : ""}일</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="mb-4">
                      <label className="text-xs text-slate-500 block mb-1">금액</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formatNumberInput(recurDraftAmount)}
                        onChange={(e) => setRecurDraftAmount(parseNumberInput(e.target.value))}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRecurEditSheet(); }}
                        className="w-full h-11 box-border border border-slate-200 rounded-lg px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={closeRecurEditSheet} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600">
                        취소
                      </button>
                      <button onClick={saveRecurEditSheet} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium">
                        저장
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2">
          <span>✅</span>
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

function LoginScreen({ onSignIn, error }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
        <div className="text-3xl mb-3">💰</div>
        <h1 className="text-xl font-bold text-slate-900 mb-1">우리집 가계부</h1>
        <p className="text-sm text-slate-500 mb-6">구글 계정으로 로그인해주세요</p>
        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}
        <button
          onClick={onSignIn}
          className="w-full flex items-center justify-center gap-2 border border-slate-200 rounded-xl py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33C2.44 15.98 5.48 18 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.72c-.18-.54-.28-1.12-.28-1.72s.1-1.18.28-1.72V4.95H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.05l3.01-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          Google로 로그인
        </button>
        <p className="text-[11px] text-slate-400 mt-4">로그인하면 나만의 가계부가 시작돼요. 다른 사람한테는 안 보여요.</p>
      </div>
    </div>
  );
}

function PinScreen({ isNew, onSubmit, error, onSignOut }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState("enter"); // 'enter' | 'confirm' (isNew일 때만 confirm 사용)

  function handleDigit(d) {
    if (isNew && step === "enter") {
      const next = (pin + d).slice(0, 4);
      setPin(next);
      if (next.length === 4) setStep("confirm");
      return;
    }
    if (isNew && step === "confirm") {
      const next = (confirmPin + d).slice(0, 4);
      setConfirmPin(next);
      if (next.length === 4) {
        if (next === pin) onSubmit(pin);
        else { setPin(""); setConfirmPin(""); setStep("enter"); }
      }
      return;
    }
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) onSubmit(next);
  }

  const activeValue = isNew && step === "confirm" ? confirmPin : pin;
  const activeSetter = isNew && step === "confirm" ? setConfirmPin : setPin;

  function handleBackspace() {
    activeSetter(activeValue.slice(0, -1));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
        <div className="text-3xl mb-3">🔒</div>
        {isNew ? (
          <>
            <h1 className="text-lg font-bold text-slate-900 mb-1">
              {step === "enter" ? "4자리 PIN을 정해주세요" : "한 번 더 입력해주세요"}
            </h1>
            <p className="text-xs text-slate-500 mb-5">
              {step === "enter"
                ? "이 PIN으로 내 데이터가 암호화돼요. 나만 알고 있어야 해요."
                : "방금 입력한 PIN을 다시 한번 입력해주세요."}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-slate-900 mb-1">PIN을 입력해주세요</h1>
            <p className="text-xs text-slate-500 mb-5">내 데이터를 열어보려면 처음 설정한 4자리 PIN이 필요해요.</p>
          </>
        )}
        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full border-2 ${i < activeValue.length ? "bg-slate-900 border-slate-900" : "border-slate-300"}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              className="h-12 rounded-xl border border-slate-200 text-lg font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition"
            >
              {d}
            </button>
          ))}
          <div />
          <button
            onClick={() => handleDigit("0")}
            className="h-12 rounded-xl border border-slate-200 text-lg font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="h-12 rounded-xl border border-slate-200 text-sm font-medium text-slate-500 hover:bg-slate-50 active:bg-slate-100 transition"
          >
            지우기
          </button>
        </div>
        {isNew && (
          <p className="text-[11px] text-amber-600 leading-relaxed mb-3">
            ⚠️ 이 PIN을 잊어버리면 데이터를 복구할 수 없어요. 저(개발자)한테 물어봐도 찾아드릴 수 없어요 — 그래야 진짜 안전한 거예요.
          </p>
        )}
        <button onClick={onSignOut} className="text-xs text-slate-400 hover:text-slate-600 transition">
          다른 계정으로 로그인
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = 로딩중, null = 로그아웃, object = 로그인됨
  const [authError, setAuthError] = useState("");
  const [pinState, setPinState] = useState("checking"); // checking | needed_new | needed_verify | unlocked
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    const unsubscribe = watchAuthState(async (u) => {
      setUser(u);
      setCurrentUid(u ? u.uid : null);
      setPinError("");
      if (u) {
        setPinState("checking");
        const exists = await checkPinExists();
        setPinState(exists ? "needed_verify" : "needed_new");
      } else {
        setPinState("checking");
      }
    });
    return unsubscribe;
  }, []);

  async function handleSignIn() {
    setAuthError("");
    try {
      await signInWithGoogle();
    } catch (e) {
      setAuthError("로그인에 실패했어요. 다시 시도해주세요.");
    }
  }

  async function handlePinSubmit(pin) {
    setPinError("");
    const result = await setupOrVerifyPin(pin);
    if (result.ok) {
      setPinState("unlocked");
    } else {
      setPinError(result.error || "PIN을 확인해주세요.");
    }
  }

  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onSignIn={handleSignIn} error={authError} />;
  }

  if (pinState === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (pinState === "needed_new" || pinState === "needed_verify") {
    return (
      <PinScreen
        isNew={pinState === "needed_new"}
        onSubmit={handlePinSubmit}
        error={pinError}
        onSignOut={() => signOutUser()}
      />
    );
  }

  return <HouseholdBudget />;
}
