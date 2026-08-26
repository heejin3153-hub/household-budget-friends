import { CATEGORY_COLORS, COLOR_PALETTE } from "./constants";

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function formatWon(n) {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

export function formatDateDisplay(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${y}. ${m}. ${d}.`;
}

export function formatNumberInput(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(String(v).replace(/,/g, ""));
  if (isNaN(n)) return "";
  return n.toLocaleString("ko-KR");
}

// 계산식("5000+3000")을 입력하는 중이면 그대로 보여주고, 그냥 숫자 하나면 콤마를 넣어서 보여줘요.
export function formatAmountDisplay(v) {
  if (v === "" || v === null || v === undefined) return "";
  const str = String(v);
  if (/\+/.test(str) || /-/.test(str.slice(1))) return str;
  return formatNumberInput(str);
}


export function parseNumberInput(v) {
  return v.replace(/[^0-9]/g, "");
}

// 금액 입력칸에서 "5000+3000-1200" 같은 계산식을 그대로 칠 수 있게 해줘요.
// 숫자, 콤마, 공백, +, -, 소수점만 남기고 나머진 다 걸러내요.
export function parseCalcInput(v) {
  return v.replace(/[^0-9+\-.,\s]/g, "");
}

// "5000+3000-1200" -> 6800 처럼 더하기/빼기만 있는 간단한 식을 계산해요.
// 맨 앞에 -만 있으면(-3000처럼) 마이너스 금액(환불/할인 등) 그대로 반환해요.
export function evalSimpleExpr(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/,/g, "").replace(/\s+/g, "");
  const tokens = cleaned.match(/[+-]?\d+(\.\d+)?/g);
  if (!tokens) return 0;
  return tokens.reduce((sum, tok) => sum + parseFloat(tok), 0);
}

export function monthsBetween(fromStr, toStr) {
  const from = new Date(fromStr);
  const to = new Date(toStr);
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(months, 0);
}

// 할부 총액을 개월 수만큼 나눠요. 나머지(딱 안 나눠떨어지는 금액)는 마지막 달에 몰아줘요.
export function splitInstallment({ total, months, startYear, startMonth, name }) {
  const monthly = Math.floor(total / months);
  const remainder = total - monthly * months;
  const items = [];
  for (let i = 0; i < months; i++) {
    let y = startYear, m = startMonth + i;
    while (m > 12) { m -= 12; y += 1; }
    const isLast = i === months - 1;
    items.push({
      date: `${y}-${String(m).padStart(2, "0")}-01`,
      amount: isLast ? monthly + remainder : monthly,
      memo: `${name} (${i + 1}/${months})`,
    });
  }
  return items;
}

export function categoryColor(cat) {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  let hash = 0;
  for (let i = 0; i < (cat || "").length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

export function firstWeekday(y, m) {
  return new Date(y, m, 1).getDay();
}

// 거래 하나의 +/- 표시와 색상을 정해줘요. 지출인데 금액이 마이너스(환불 등)면 +로, 초록색으로 보여줘요.
export function txDisplaySign(t) {
  const isPositive = t.type === "income" || t.amount < 0;
  return {
    sign: isPositive ? "+" : "-",
    colorClass: isPositive ? "text-emerald-600" : "text-red-500",
    amountText: formatWon(Math.abs(t.amount)),
  };
}

// ── 정산 시작일(예산 사이클) 관련 함수들 ──────────────────────────
// cycleStartDay가 1이면 기존이랑 완전히 똑같이 동작해요 (1일~말일).
// 예: cycleStartDay=25면 "2026-08" 사이클은 8/25~9/24를 의미해요.
export function daysInMonthNum(y, m) {
  return new Date(y, m, 0).getDate(); // m: 1~12
}
export function getCycleLabel(dateStr, cycleStartDay) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!cycleStartDay || cycleStartDay <= 1) return `${y}-${String(m).padStart(2, "0")}`;
  if (d >= cycleStartDay) return `${y}-${String(m).padStart(2, "0")}`;
  let py = y, pm = m - 1;
  if (pm < 1) { pm = 12; py -= 1; }
  return `${py}-${String(pm).padStart(2, "0")}`;
}
export function getCycleRange(cycleLabel, cycleStartDay) {
  const [y, m] = cycleLabel.split("-").map(Number);
  if (!cycleStartDay || cycleStartDay <= 1) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = `${y}-${String(m).padStart(2, "0")}-${String(daysInMonthNum(y, m)).padStart(2, "0")}`;
    return [start, end];
  }
  const startDay = Math.min(cycleStartDay, daysInMonthNum(y, m));
  const start = `${y}-${String(m).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
  let ey = y, em = m + 1;
  if (em > 12) { em = 1; ey += 1; }
  const endDay = Math.min(cycleStartDay - 1, daysInMonthNum(ey, em));
  const end = `${ey}-${String(em).padStart(2, "0")}-${String(Math.max(endDay, 1)).padStart(2, "0")}`;
  return [start, end];
}
export function getDateForCycleDay(cycleLabel, day, cycleStartDay) {
  const [y, m] = cycleLabel.split("-").map(Number);
  if (!cycleStartDay || cycleStartDay <= 1 || day >= cycleStartDay) {
    const safeDay = Math.min(day, daysInMonthNum(y, m));
    return `${y}-${String(m).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
  }
  let ey = y, em = m + 1;
  if (em > 12) { em = 1; ey += 1; }
  const safeDay = Math.min(day, daysInMonthNum(ey, em));
  return `${ey}-${String(em).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}
export function formatCycleLabel(cycleLabel, cycleStartDay) {
  const [y, m] = cycleLabel.split("-").map(Number);
  if (!cycleStartDay || cycleStartDay <= 1) return `${y}년 ${m}월`;
  const [start, end] = getCycleRange(cycleLabel, cycleStartDay);
  const [, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  return `${y}년 ${m}월 (${sm}/${sd}~${em}/${ed})`;
}
