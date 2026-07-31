import React, { useState, useEffect, useMemo, useRef } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import * as XLSX from "xlsx";
import {
  Trash2, Plus, TrendingUp, TrendingDown, Wallet, Loader2,
  PiggyBank, Target, ChevronDown, ChevronUp, Download, Upload, Pencil, X, MoreVertical, Search, CheckCircle2, RotateCcw, LogOut,
} from "lucide-react";
import { storageGet, storageSet, setCurrentUid, signInWithGoogle, signOutUser, watchAuthState } from "./firebase";

const TX_KEY = "household-budget-transactions";
const SETTINGS_KEY = "household-budget-settings";
const LOANS_KEY = "household-budget-loans";
const RECURRING_KEY = "household-budget-recurring";
const BUDGETS_KEY = "household-budget-monthly-budgets";
const CATEGORY_CONFIG_KEY = "household-budget-category-config";

// 기본 카테고리 그룹 설정값 (사용자가 나중에 화면에서 직접 수정 가능)
const DEFAULT_GROUPS = [
  { id: "living", label: "생활비", categories: ["식비", "생활", "문화", "기타"], budgetEnabled: true, budget: 600000 },
  { id: "allowance", label: "사용자1 용돈", categories: ["(용돈)식비", "(용돈)쇼핑", "(용돈)문화", "(용돈)기타"], budgetEnabled: true, budget: 300000 },
  { id: "fixed", label: "정기 지출", categories: ["통신", "구독", "교통", "보험", "월세", "공과금", "대출이자", "기타 정기지출"], budgetEnabled: false, budget: 0 },
  { id: "irregular", label: "비정기 지출", categories: ["세금", "의료", "가족", "여행", "경조사", "예산 외 쇼핑", "기타 비정기지출"], budgetEnabled: false, budget: 0 },
  { id: "other", label: "기타", categories: ["저축/투자", "대출상환"], budgetEnabled: false, budget: 0 },
];
const DEFAULT_INCOME_CATEGORIES = ["사용자1", "사용자2", "월세소득"];

const CATEGORY_COLORS = {
  "공과금": "#0ea5e9", "월세": "#0284c7",
  "식비": "#f97316", "생활": "#fb923c", "문화": "#ec4899", "기타": "#94a3b8",
  "(용돈)쇼핑": "#a855f7", "(용돈)문화": "#d946ef", "(용돈)식비": "#c026d3", "(용돈)기타": "#e879f9",
  "기타 정기지출": "#7c3aed", "대출이자": "#be123c", "통신": "#0891b2", "구독": "#6366f1", "보험": "#0d9488", "교통": "#2563eb",
  "세금": "#dc2626", "의료": "#ef4444", "가족": "#f59e0b", "여행": "#06b6d4", "경조사": "#f43f5e", "기타 비정기지출": "#78716c",
  "예산 외 쇼핑": "#eab308", "저축/투자": "#22c55e", "대출상환": "#16a34a",
};
const COLOR_PALETTE = ["#f97316", "#fb923c", "#fbbf24", "#ec4899", "#a855f7", "#d946ef", "#c026d3", "#7c3aed", "#be123c", "#0891b2", "#6366f1", "#0d9488", "#2563eb", "#dc2626", "#ef4444", "#f59e0b", "#06b6d4", "#f43f5e", "#78716c", "#eab308", "#22c55e", "#16a34a", "#0ea5e9", "#0284c7", "#94a3b8"];
function categoryColor(cat) {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  let hash = 0;
  for (let i = 0; i < (cat || "").length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

const CURRENCIES = [
  { code: "JPY", label: "일본 엔" },
  { code: "USD", label: "미국 달러" },
  { code: "EUR", label: "유로" },
  { code: "CNY", label: "중국 위안" },
  { code: "THB", label: "태국 바트" },
  { code: "VND", label: "베트남 동" },
  { code: "GBP", label: "영국 파운드" },
  { code: "AUD", label: "호주 달러" },
];

const DEFAULT_LOANS = [];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function formatWon(n) {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}
function formatDateDisplay(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${y}. ${m}. ${d}.`;
}

function DatePickerField({ value, onChange, placeholder = "날짜 선택", className = "" }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const parsed = value ? value.split("-").map(Number) : null;
  const [viewYear, setViewYear] = useState(parsed ? parsed[0] : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed ? parsed[1] - 1 : today.getMonth());

  useEffect(() => {
    if (open) {
      const p = value ? value.split("-").map(Number) : null;
      const t = new Date();
      setViewYear(p ? p[0] : t.getFullYear());
      setViewMonth(p ? p[1] - 1 : t.getMonth());
    }
  }, [open]);

  function pad(n) { return String(n).padStart(2, "0"); }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function firstWeekday(y, m) { return new Date(y, m, 1).getDay(); }

  function selectDay(d) {
    onChange(`${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`);
    setOpen(false);
  }
  function goPrevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1);
  }
  function goNextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1);
  }
  function goPrevYear() { setViewYear(viewYear - 1); }
  function goNextYear() { setViewYear(viewYear + 1); }

  const dim = daysInMonth(viewYear, viewMonth);
  const startWeekday = firstWeekday(viewYear, viewMonth);
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  const selectedDay = parsed && parsed[0] === viewYear && parsed[1] - 1 === viewMonth ? parsed[2] : null;
  const todayISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full h-11 flex items-center rounded-lg border border-slate-200 px-3 text-sm bg-white text-left ${value ? "text-slate-800" : "text-slate-400"}`}
      >
        {value ? formatDateDisplay(value) : placeholder}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-40 w-64">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={goPrevYear} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" title="이전 연도">«</button>
                <button type="button" onClick={goPrevMonth} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
              </div>
              <div className="text-sm font-semibold text-slate-800">{viewYear}년 {viewMonth + 1}월</div>
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={goNextMonth} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
                <button type="button" onClick={goNextYear} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" title="다음 연도">»</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                <div key={d} className="text-center text-[11px] text-slate-400">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (d === null) return <div key={i} />;
                const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
                const isSelected = d === selectedDay;
                const isToday = iso === todayISO;
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => selectDay(d)}
                    className={`h-8 rounded-lg text-sm ${
                      isSelected ? "bg-emerald-600 text-white font-semibold"
                        : isToday ? "border border-emerald-400 text-emerald-700"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
function formatNumberInput(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(String(v).replace(/,/g, ""));
  if (isNaN(n)) return "";
  return n.toLocaleString("ko-KR");
}
function parseNumberInput(v) {
  return v.replace(/[^0-9]/g, "");
}
function monthsBetween(fromStr, toStr) {
  const from = new Date(fromStr);
  const to = new Date(toStr);
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(months, 0);
}

function ProgressBar({ label, spent, budget }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const over = spent > budget;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-600 font-medium">{label}</span>
        <span className={over ? "text-red-500 font-semibold" : "text-slate-500"}>
          {formatWon(spent)} / {formatWon(budget)}
        </span>
      </div>
      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && (
        <div className="text-[11px] text-red-500 mt-1">
          예산 {formatWon(spent - budget)} 초과했어요
        </div>
      )}
    </div>
  );
}

function HouseholdBudget() {
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState({ mySalary: 0, spouseGive: 0, title: "우리집 가계부", fxCurrency: "JPY", fxRate: 0, loanModeEnabled: true });
  const [loanData, setLoanData] = useState({ targetDate: "", loans: DEFAULT_LOANS });
  const [recurringItems, setRecurringItems] = useState([]);
  const [monthlyBudgets, setMonthlyBudgets] = useState({});
  const [groups, setGroups] = useState(DEFAULT_GROUPS);
  const [incomeCategories, setIncomeCategories] = useState(DEFAULT_INCOME_CATEGORIES);
  const [editingBudgetGroupId, setEditingBudgetGroupId] = useState(null);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [draftGroups, setDraftGroups] = useState([]);
  const [draftIncomeCategories, setDraftIncomeCategories] = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [newCatText, setNewCatText] = useState({});
  const [newGroupName, setNewGroupName] = useState("");
  const [showRecurring, setShowRecurring] = useState(false);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [newRecurName, setNewRecurName] = useState("");
  const [newRecurCategory, setNewRecurCategory] = useState(DEFAULT_GROUPS.find((g) => g.id === "fixed").categories[0]);
  const [newRecurAmount, setNewRecurAmount] = useState("");
  const [newRecurDay, setNewRecurDay] = useState("1");
  // 아래 값들은 groups/incomeCategories state로부터 매 렌더마다 계산돼요 (직접 수정 가능한 카테고리 지원용)
  const LIVING_CATEGORIES = groups.find((g) => g.id === "living")?.categories || [];
  const ALLOWANCE_CATEGORIES = groups.find((g) => g.id === "allowance")?.categories || [];
  const FIXED_CATEGORIES = groups.find((g) => g.id === "fixed")?.categories || [];
  const IRREGULAR_CATEGORIES = groups.find((g) => g.id === "irregular")?.categories || [];
  const OTHER_EXPENSE_CATEGORIES = groups.find((g) => g.id === "other")?.categories || [];
  const EXPENSE_GROUPS = groups.map((g) => ({ label: g.label, items: g.categories }));
  const INCOME_CATEGORIES = incomeCategories;
  const [confirmDeleteRecurId, setConfirmDeleteRecurId] = useState(null);
  const [showInstallment, setShowInstallment] = useState(false);
  const [instName, setInstName] = useState("");
  const [instTotal, setInstTotal] = useState("");
  const [instMonths, setInstMonths] = useState("");
  const [instStartMonth, setInstStartMonth] = useState(todayStr().slice(0, 7));
  const [instCategory, setInstCategory] = useState("예산 외 쇼핑");
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(timer);
  }, [toast]);
  const [lastFailedSave, setLastFailedSave] = useState(null);

  useEffect(() => {
    if (showCategoryManager) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prevOverflow; };
    }
  }, [showCategoryManager]);

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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [newLoanName, setNewLoanName] = useState("");
  const [newLoanBalance, setNewLoanBalance] = useState("");
  const [newLoanRate, setNewLoanRate] = useState("");
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState(null);
  const [longPressTx, setLongPressTx] = useState(null);
  const longPressTimer = useRef(null);

  function handlePressStart(t) {
    longPressTimer.current = setTimeout(() => {
      setLongPressTx(t);
      longPressTimer.current = null;
    }, 500);
  }
  function handlePressEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }
  const [confirmDeleteLoanId, setConfirmDeleteLoanId] = useState(null);
  const [showCompletedLoans, setShowCompletedLoans] = useState(false);
  const [showLoanMenu, setShowLoanMenu] = useState(false);
  const [showLoanDetails, setShowLoanDetails] = useState(false);
  const [showTxDetails, setShowTxDetails] = useState(true);
  const [showTxMenu, setShowTxMenu] = useState(false);
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
          setTransactions(JSON.parse(txRes.value));
        }
      } catch (e) {}
      try {
        const sRes = await storageGet(SETTINGS_KEY);
        if (sRes && sRes.value) {
          const loadedSettings = JSON.parse(sRes.value);
          setSettings(loadedSettings);
          if (loadedSettings.defaultPieGroup) setPieGroupFilter(loadedSettings.defaultPieGroup);
        }
      } catch (e) {}
      try {
        const lRes = await storageGet(LOANS_KEY);
        if (lRes && lRes.value) {
          setLoanData(JSON.parse(lRes.value));
        } else {
          const seeded = { targetDate: "", loans: DEFAULT_LOANS };
          setLoanData(seeded);
          await storageSet(LOANS_KEY, seeded);
        }
      } catch (e) {}
      try {
        const rRes = await storageGet(RECURRING_KEY);
        if (rRes && rRes.value) {
          const loadedR = JSON.parse(rRes.value);
          setRecurringItems(loadedR.map((r) => ({ day: 1, ...r })));
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
          if (parsed.incomeCategories) setIncomeCategories(parsed.incomeCategories);
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
    setLoanData(next);
    debouncedSave(LOANS_KEY, next, "대출 정보 저장에 실패했어요.");
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
  function persistCategoryConfig(nextGroups, nextIncome) {
    const g = nextGroups || groups;
    const inc = nextIncome || incomeCategories;
    setGroups(g);
    setIncomeCategories(inc);
    debouncedSave(CATEGORY_CONFIG_KEY, { groups: g, incomeCategories: inc }, "카테고리 설정 저장에 실패했어요.");
  }
  function openCategoryManager() {
    setDraftGroups(JSON.parse(JSON.stringify(groups)));
    setDraftIncomeCategories([...incomeCategories]);
    setPendingDelete(null);
    setShowCategoryManager(true);
  }
  function cancelCategoryManager() {
    setShowCategoryManager(false);
    setPendingDelete(null);
  }
  function applyCategoryManager() {
    persistCategoryConfig(draftGroups, draftIncomeCategories);
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
  function addIncomeCategory(name) {
    const n = (name || "").trim();
    if (!n || draftIncomeCategories.includes(n)) return;
    setDraftIncomeCategories([...draftIncomeCategories, n]);
  }
  function renameIncomeCategory(oldName, newName) {
    setDraftIncomeCategories(draftIncomeCategories.map((c) => (c === oldName ? newName : c)));
  }
  function removeIncomeCategory(name) {
    setDraftIncomeCategories(draftIncomeCategories.filter((c) => c !== name));
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
    let finalAmount = Number(amount);
    let finalMemo = memo.trim();
    if (type === "expense" && travelMode) {
      const fa = Number(foreignAmount) || 0;
      const rate = Number(settings.fxRate) || 0;
      finalAmount = Math.round(fa * rate);
      const fxNote = `${fa.toLocaleString("ko-KR")}${settings.fxCurrency} × ${rate}원`;
      finalMemo = finalMemo ? `${fxNote} · ${finalMemo}` : fxNote;
    }
    if (!finalAmount || finalAmount <= 0) {
      setSaveError(travelMode ? "환산된 금액이 0원이에요. 통화·환율·금액을 확인해주세요." : "금액을 입력해주세요.");
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
    setEmAmount(String(t.amount));
    setEmMemo(t.memo || "");
    setEmTravelMode(false);
    setEmForeignAmount("");
  }
  function cancelEdit() {
    setEditingId(null);
  }
  async function saveEditedTransaction(e) {
    e.preventDefault();
    let finalAmount = Number(emAmount);
    let finalMemo = emMemo.trim();
    if (emType === "expense" && emTravelMode) {
      const fa = Number(emForeignAmount) || 0;
      const rate = Number(settings.fxRate) || 0;
      finalAmount = Math.round(fa * rate);
      const fxNote = `${fa.toLocaleString("ko-KR")}${settings.fxCurrency} × ${rate}원`;
      finalMemo = finalMemo ? `${fxNote} · ${finalMemo}` : fxNote;
    }
    if (!finalAmount || finalAmount <= 0 || !emDate) return;
    const next = transactions.map((t) =>
      t.id === editingId ? { ...t, type: emType, date: emDate, category: emCategory, amount: finalAmount, memo: finalMemo } : t
    );
    const ok = await persistTx(next);
    setEditingId(null);
    if (ok) setToast("수정됐어요");
  }

  const monthTx = useMemo(() => transactions.filter((t) => t.date.slice(0, 7) === selectedMonth), [transactions, selectedMonth]);
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
  const irregularTx = useMemo(
    () => monthTx.filter((t) => t.type === "expense" && IRREGULAR_CATEGORIES.includes(t.category)),
    [monthTx]
  );
  const irregularSpent = useMemo(() => irregularTx.reduce((s, t) => s + t.amount, 0), [irregularTx]);
  const irregularByCategory = useMemo(() => {
    const map = {};
    irregularTx.forEach((t) => { map[t.category] = (map[t.category] || 0) + t.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [irregularTx]);

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

  const topGroupTransactions = useMemo(() => {
    let base = monthTx.filter((t) => t.type === "expense");
    if (pieGroupFilter !== "전체") {
      const group = EXPENSE_GROUPS.find((g) => g.label === pieGroupFilter);
      base = base.filter((t) => group && group.items.includes(t.category));
    }
    return [...base].sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [monthTx, pieGroupFilter]);

  const monthOptions = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.slice(0, 7)));
    set.add(selectedMonth);
    return Array.from(set).sort().reverse();
  }, [transactions, selectedMonth]);

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
      if (sortBy === "date_asc") return a.date < b.date ? -1 : 1;
      return a.date < b.date ? 1 : -1;
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
        return { ...l, completed: nowCompleted, balance: nowCompleted ? 0 : l.balance };
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
    const monthly = Math.floor(total / months);
    const remainder = total - monthly * months;
    const [startY, startM] = instStartMonth.split("-").map(Number);
    const newTxs = [];
    for (let i = 0; i < months; i++) {
      let y = startY, m = startM + i;
      while (m > 12) { m -= 12; y += 1; }
      const isLast = i === months - 1;
      newTxs.push({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        type: "expense",
        date: `${y}-${String(m).padStart(2, "0")}-01`,
        category: instCategory,
        amount: isLast ? monthly + remainder : monthly,
        memo: `${instName.trim()} (${i + 1}/${months})`,
      });
    }
    const ok = await persistTx([...newTxs, ...transactions]);
    if (ok) setToast(`${months}개월치 할부를 등록했어요`);
    setInstName(""); setInstTotal(""); setInstMonths("");
    setShowInstallment(false);
  }
  function updateRecurringField(id, field, value) {
    const next = recurringItems.map((r) => (r.id === id ? { ...r, [field]: value } : r));
    persistRecurring(next);
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
      const day = String(Math.min(Math.max(Number(item.day) || 1, 1), 28)).padStart(2, "0");
      const newTx = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "expense", date: `${selectedMonth}-${day}`, category: item.category, amount: Number(item.amount) || 0, memo: item.name,
      };
      const ok = await persistTx([newTx, ...transactions]);
      if (ok) setToast(`${item.name} → ${selectedMonth}월 ${Number(day)}일로 기록했어요 ✅`);
    }
  }
  async function updateTargetDate(d) {
    await persistLoans({ ...loanData, targetDate: d });
  }

  function groupLabel(cat) {
    const g = groups.find((grp) => grp.categories.includes(cat));
    return g ? g.label : "기타";
  }

  function exportToExcel(scope) {
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

    const filename = scope === "month"
      ? `가계부_${selectedMonth}.xlsx`
      : `가계부_전체.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  function resolveImportedCategory(rawCategory, rawGroup) {
    return rawCategory || rawCategory;
  }

  async function handleImportExcel(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
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

      if (imported.length === 0) {
        setSaveError("엑셀에서 읽을 수 있는 거래가 없어요. 이전에 이 앱에서 내보낸 파일인지 확인해주세요.");
        return;
      }

      const existingKeys = new Set(transactions.map((t) => `${t.date}|${t.type}|${t.category}|${t.amount}|${t.memo}`));
      const newOnes = imported.filter((t) => !existingKeys.has(`${t.date}|${t.type}|${t.category}|${t.amount}|${t.memo}`));

      // 정기지출 체크리스트 시트도 있으면 같이 불러오기
      let recurAddedCount = 0;
      const recurSheetName = wb.SheetNames.find((n) => n === "정기지출 체크리스트");
      if (recurSheetName) {
        const recurWs = wb.Sheets[recurSheetName];
        const recurRows = XLSX.utils.sheet_to_json(recurWs, { defval: "" });
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

      if (newOnes.length === 0) {
        setToast(recurAddedCount > 0 ? `정기지출 ${recurAddedCount}건 불러왔어요` : "이미 다 들어있는 내역이에요");
        return;
      }
      const ok = await persistTx([...newOnes, ...transactions]);
      if (ok) {
        setToast(
          recurAddedCount > 0
            ? `거래 ${newOnes.length}건, 정기지출 ${recurAddedCount}건 불러왔어요`
            : `${newOnes.length}건 불러왔어요`
        );
      }
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
            <p className="text-sm text-slate-500 mt-1">수입 · 지출 · 예산 · 대출 상환까지 한번에 관리해요.</p>
            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5 mt-2 inline-block">
              🔒 개인 계정 — 나만 볼 수 있는 데이터예요. 다른 사람이 로그인해도 서로 안 보여요
            </p>
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
                <div className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 w-44">
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
                    onClick={() => {
                      openCategoryManager();
                      setShowHeaderMenu(false);
                    }}
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
            📋 정기지출 체크리스트 ({selectedMonth}월)
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
            {recurringItems.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">등록된 정기지출이 없어요. 아래에서 추가해보세요.</p>
            ) : (
              <ul className="divide-y divide-slate-100 mb-3">
                {recurringItems.map((item) => {
                  const logged = monthTx.some((t) => t.type === "expense" && t.category === item.category && t.memo === item.name);
                  return (
                    <li key={item.id} className="py-2.5 flex items-center gap-2">
                      <button
                        onClick={() => toggleRecurringLogged(item)}
                        className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition ${
                          logged ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400"
                        }`}
                        aria-label={logged ? "완료 취소" : "완료 표시"}
                      >
                        <CheckCircle2 size={15} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <input
                          value={item.name}
                          onChange={(e) => updateRecurringField(item.id, "name", e.target.value)}
                          className={`w-full text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-emerald-300 rounded px-0.5 ${logged ? "text-slate-400 line-through" : "text-slate-800"}`}
                        />
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <select
                            value={item.category}
                            onChange={(e) => updateRecurringField(item.id, "category", e.target.value)}
                            className="text-[11px] text-slate-400 bg-transparent border-0 focus:outline-none"
                          >
                            {FIXED_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <span className="text-[11px] text-slate-300">·</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={formatNumberInput(item.amount)}
                            onChange={(e) => updateRecurringField(item.id, "amount", Number(parseNumberInput(e.target.value)) || 0)}
                            className="text-[11px] text-slate-400 bg-transparent border-0 focus:outline-none w-16"
                          />
                          <span className="text-[11px] text-slate-300">·</span>
                          <span className="text-[11px] text-slate-400">매월</span>
                          <select
                            value={item.day || 1}
                            onChange={(e) => updateRecurringField(item.id, "day", Number(e.target.value))}
                            className="text-[11px] text-slate-400 bg-transparent border-0 focus:outline-none"
                          >
                            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                              <option key={d} value={d}>{d}{d === 28 ? "(말일)" : ""}</option>
                            ))}
                          </select>
                          <span className="text-[11px] text-slate-400">일</span>
                        </div>
                      </div>
                      {confirmDeleteRecurId === item.id ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => { deleteRecurringItem(item.id); setConfirmDeleteRecurId(null); }}
                            className="text-[11px] px-2 py-1 rounded-lg bg-red-500 text-white">삭제</button>
                          <button onClick={() => setConfirmDeleteRecurId(null)}
                            className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-600">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDeleteRecurId(item.id)} className="text-slate-300 hover:text-red-500 shrink-0" aria-label="삭제">
                          <Trash2 size={14} />
                        </button>
                      )}
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
                : INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
                <select value={settings.fxCurrency} onChange={(e) => persistSettings({ ...settings, fxCurrency: e.target.value })}
                  className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white">
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.label})</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">오늘 환율 (1{settings.fxCurrency}=원)</label>
                <input type="text" inputMode="decimal" placeholder="예: 9.1" value={settings.fxRate}
                  onChange={(e) => persistSettings({ ...settings, fxRate: e.target.value.replace(/[^0-9.]/g, "") })}
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
              <label className="text-xs text-slate-500 block mb-1">금액 (원)</label>
              <input ref={amountInputRef} type="text" inputMode="numeric" placeholder="0" value={formatNumberInput(amount)}
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
          {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">이번 달 잔액 계산</h3>
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
          <span className="text-sm font-semibold text-slate-800">이번 달 남은 돈</span>
          <span className={`text-base font-bold ${balance >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatWon(balance)}</span>
        </div>
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
        <h3 className="text-sm font-semibold text-slate-700 mb-3">이번 달 예산 현황</h3>
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
                    <button
                      onClick={() => { setEditingBudgetGroupId(g.id); setBudgetDraft(String(getGroupBudget(g.id, selectedMonth))); }}
                      className="text-[11px] text-slate-400 hover:text-slate-600"
                    >
                      이 달 예산 수정
                    </button>
                  )}
                </div>
                <ProgressBar label="" spent={spent} budget={getGroupBudget(g.id, selectedMonth)} />
              </div>
            );
          })
        )}
      </div>

      {showCategoryManager && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={cancelCategoryManager} />
          <div className="fixed inset-x-3 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-lg max-w-md mx-auto max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">카테고리 관리</h3>
            <button onClick={cancelCategoryManager} className="text-slate-400 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-3 flex-1 min-h-0" style={{ WebkitOverflowScrolling: "touch" }}>
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
              placeholder="새 그룹 이름 (예: 자녀 교육비)"
              className="flex-1 h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white"
            />
            <button onClick={() => addNewGroup(newGroupName)} className="px-3 h-8 rounded-lg bg-emerald-600 text-white text-xs shrink-0">그룹 추가</button>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <h4 className="text-xs font-semibold text-slate-500 mb-2">수입 카테고리</h4>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {draftIncomeCategories.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-100 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-emerald-700">
                  <input
                    value={c}
                    onChange={(e) => renameIncomeCategory(c, e.target.value)}
                    className="bg-transparent border-0 focus:outline-none text-xs"
                    style={{ width: `${Math.max(c.length * 1.8 + 1, 3)}ch` }}
                  />
                  <button onClick={() => setPendingDelete({ type: "income", name: c })} className="text-emerald-300 hover:text-red-500">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                value={newCatText.income || ""}
                onChange={(e) => setNewCatText({ ...newCatText, income: e.target.value })}
                placeholder="수입 카테고리 추가"
                className="flex-1 h-8 border border-slate-200 rounded-lg px-2 text-xs bg-white"
              />
              <button
                onClick={() => { addIncomeCategory(newCatText.income); setNewCatText({ ...newCatText, income: "" }); }}
                className="px-3 h-8 rounded-lg bg-slate-900 text-white text-xs shrink-0"
              >
                추가
              </button>
            </div>
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
            } else if (pendingDelete.type === "income") {
              affectedCount = transactions.filter((t) => t.type === "income" && t.category === pendingDelete.name).length;
            }
            return (
            <>
              <div className="fixed inset-0 bg-black/40 z-[60]" onClick={() => setPendingDelete(null)} />
              <div className="fixed inset-x-8 top-1/2 -translate-y-1/2 z-[70] bg-white rounded-2xl p-5 shadow-lg max-w-xs mx-auto">
                <p className="text-sm font-medium text-slate-800 text-center mb-1">
                  {pendingDelete.type === "group" && `"${pendingDelete.label}" 그룹을 삭제할까요?`}
                  {pendingDelete.type === "category" && `"${pendingDelete.name}" 카테고리를 삭제할까요?`}
                  {pendingDelete.type === "income" && `"${pendingDelete.name}" 수입 카테고리를 삭제할까요?`}
                </p>
                {affectedCount > 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 text-center mb-2">
                    ⚠️ 이 카테고리로 기록된 거래 {affectedCount}건이 있어요. 삭제하면 "기타"로 재분류돼요 (거래 자체는 안 지워져요).
                  </p>
                )}
                <p className="text-xs text-slate-400 text-center mb-4">
                  {pendingDelete.type === "group" ? "그 안의 카테고리도 함께 없어져요. " : ""}
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
                      if (pendingDelete.type === "income") removeIncomeCategory(pendingDelete.name);
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

      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">비정기 지출</h3>
        <p className="text-xs text-slate-400 mb-3">매달 예산에 포함하지 않고 별도로 관리해요.</p>
        <div className="flex justify-between items-center bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-3">
          <span className="text-xs text-rose-700">이번 달 비정기 지출 합계</span>
          <span className="text-sm font-bold text-rose-700">{formatWon(irregularSpent)}</span>
        </div>
        {irregularByCategory.length > 0 ? (
          <ul className="space-y-1.5">
            {irregularByCategory.map((c) => (
              <li key={c.name} className="flex justify-between text-xs text-slate-600">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: categoryColor(c.name) }} />
                  {c.name}
                </span>
                <span className="font-medium">{formatWon(c.value)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400 text-center py-2">이번 달 비정기 지출 기록이 없어요.</p>
        )}
      </div>

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
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {categoryData.map((entry, i) => <Cell key={i} fill={categoryColor(entry.name)} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatWon(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-10">이 그룹에는 이번 달 지출이 없어요.</p>
          )}
          {topGroupTransactions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-500 mb-2">
                {pieGroupFilter === "전체" ? "전체" : pieGroupFilter} 중 금액 큰 거래 Top 5
              </h4>
              <ul className="space-y-1.5">
                {topGroupTransactions.map((t, i) => (
                  <li key={t.id} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-slate-300 font-medium w-3 shrink-0">{i + 1}</span>
                      <span className="text-slate-400 shrink-0">{t.category}</span>
                      <span className="text-slate-700 truncate">{t.memo || "-"}</span>
                    </span>
                    <span className="text-slate-800 font-medium shrink-0 ml-2">{formatWon(t.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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
            .map((l) => (
            <li key={l.id} className={`py-3 border-b border-slate-100 last:border-0 ${l.completed ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0 flex items-center gap-2">
                  <div>
                    <div className="text-sm text-slate-800 truncate font-medium flex items-center gap-1.5">
                      {l.name}
                      {l.completed && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">상환완료</span>}
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
                  ) : (
                    <>
                      <button
                        onClick={() => toggleLoanComplete(l.id)}
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
          ))}
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
          <div className="relative">
            <button
              onClick={() => setShowTxMenu((s) => !s)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
              aria-label="메뉴"
            >
              <MoreVertical size={18} />
            </button>
            {showTxMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowTxMenu(false)} />
                <div className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 w-44">
                  <button
                    onClick={() => { exportToExcel("month"); setShowTxMenu(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Download size={14} /> 이번 달 내려받기
                  </button>
                  <button
                    onClick={() => { exportToExcel("all"); setShowTxMenu(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Download size={14} /> 전체 내려받기
                  </button>
                  <button
                    onClick={() => { importInputRef.current && importInputRef.current.click(); setShowTxMenu(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-emerald-700 hover:bg-slate-50"
                  >
                    <Upload size={14} /> 엑셀 불러오기
                  </button>
                </div>
              </>
            )}
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImportExcel}
              className="hidden"
            />
          </div>
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
            <optgroup label="수입">
              {INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </optgroup>
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
                                  onPointerDown={() => handlePressStart(t)}
                                  onPointerUp={handlePressEnd}
                                  onPointerLeave={handlePressEnd}
                                  onContextMenu={(e) => e.preventDefault()}
                                  className="flex items-center justify-between px-3 py-2 bg-white select-none active:bg-slate-50 transition"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm text-slate-800 truncate">{t.memo || "-"}</div>
                                    <div className="text-xs text-slate-400">{t.date}</div>
                                  </div>
                                  <span className={`text-sm font-medium shrink-0 ml-2 ${t.type === "income" ? "text-emerald-600" : "text-slate-700"}`}>
                                    {formatWon(t.amount)}
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
              const showMonthHeader = (sortBy === "date_desc" || sortBy === "date_asc") && (i === 0 || pagedTx[i - 1].date.slice(0, 7) !== t.date.slice(0, 7));
              return (
              <React.Fragment key={t.id}>
                {showMonthHeader && (
                  <li className="pt-3 pb-1 first:pt-0">
                    <span className="text-xs font-semibold text-slate-400">{t.date.slice(0, 7).replace("-", "년 ")}월</span>
                  </li>
                )}
                <li
                onPointerDown={() => handlePressStart(t)}
                onPointerUp={handlePressEnd}
                onPointerLeave={handlePressEnd}
                onContextMenu={(e) => e.preventDefault()}
                className="flex items-center justify-between gap-2 py-2.5 select-none active:bg-slate-50 rounded-lg transition"
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
                <span className={`text-sm font-semibold whitespace-nowrap shrink-0 ${t.type === "income" ? "text-emerald-600" : "text-red-500"}`}>
                  {t.type === "income" ? "+" : "-"}{formatWon(t.amount)}
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
                      : INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
                      <select value={settings.fxCurrency} onChange={(e) => persistSettings({ ...settings, fxCurrency: e.target.value })}
                        className="w-full h-10 border border-slate-200 rounded-lg px-2 text-sm bg-white">
                        {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.label})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">오늘 환율 (1{settings.fxCurrency}=원)</label>
                      <input type="text" inputMode="decimal" placeholder="예: 9.1" value={settings.fxRate}
                        onChange={(e) => persistSettings({ ...settings, fxRate: e.target.value.replace(/[^0-9.]/g, "") })}
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
                    <label className="text-xs text-slate-500 block mb-1">금액 (원)</label>
                    <input type="text" inputMode="numeric" placeholder="0" value={formatNumberInput(emAmount)}
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

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg flex items-center gap-1.5">
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

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = 로딩중, null = 로그아웃, object = 로그인됨
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const unsubscribe = watchAuthState((u) => {
      setUser(u);
      setCurrentUid(u ? u.uid : null);
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

  return <HouseholdBudget />;
}
