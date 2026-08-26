// 기본 카테고리 그룹 설정값 (화면에서 카테고리 관리로 직접 수정 가능)
export const DEFAULT_GROUPS = [
  { id: "living", label: "생활비", categories: ["식비", "생활", "문화", "기타"], budgetEnabled: true, budget: 600000 },
  { id: "allowance", label: "사용자1 용돈", categories: ["(용돈)식비", "(용돈)쇼핑", "(용돈)문화", "(용돈)기타"], budgetEnabled: true, budget: 300000 },
  { id: "fixed", label: "정기 지출", categories: ["통신", "구독", "교통", "보험", "월세", "공과금", "대출이자", "기타 정기지출"], budgetEnabled: false, budget: 0 },
  { id: "irregular", label: "비정기 지출", categories: ["세금", "의료", "가족", "여행", "경조사", "예산 외 쇼핑", "기타 비정기지출"], budgetEnabled: false, budget: 0 },
  { id: "other", label: "기타", categories: ["저축/투자", "대출상환"], budgetEnabled: false, budget: 0 },
];
export const DEFAULT_INCOME_GROUPS = [
  { id: "income", label: "수입", categories: ["사용자1", "사용자2", "월세소득"] },
];

// 예전 카테고리 이름 -> 새 카테고리 이름 (기존 기록 자동 이관용)
export const CATEGORY_RENAME_MAP = {
  "생활용품": "생활", "카페&간식": "문화", "문화생활": "문화", "기타생활비": "기타",
  "식비&친목": "(용돈)식비", "기타지출": "(용돈)기타", "쇼핑": "(용돈)쇼핑",
  "아빠 용돈": "기타 정기지출", "월세지출": "월세",
  "생활 식비": "식비", "생활 문화": "문화", "생활 기타": "기타",
  "용돈 식비": "(용돈)식비", "용돈 문화": "(용돈)문화", "용돈 기타": "(용돈)기타",
  "정기 기타": "기타 정기지출", "기타 비정기": "기타 비정기지출",
};

export const CATEGORY_COLORS = {
  "공과금": "#0ea5e9", "월세": "#0284c7",
  "식비": "#f97316", "생활": "#fb923c", "문화": "#ec4899", "기타": "#94a3b8",
  "(용돈)쇼핑": "#a855f7", "(용돈)문화": "#d946ef", "(용돈)식비": "#c026d3", "(용돈)기타": "#e879f9",
  "기타 정기지출": "#7c3aed", "대출이자": "#be123c", "통신": "#0891b2", "구독": "#6366f1", "보험": "#0d9488", "교통": "#2563eb",
  "세금": "#dc2626", "의료": "#ef4444", "가족": "#f59e0b", "여행": "#06b6d4", "경조사": "#f43f5e", "기타 비정기지출": "#78716c",
  "예산 외 쇼핑": "#eab308", "저축/투자": "#22c55e", "대출상환": "#16a34a",
};
export const COLOR_PALETTE = ["#f97316", "#fb923c", "#fbbf24", "#ec4899", "#a855f7", "#d946ef", "#c026d3", "#7c3aed", "#be123c", "#0891b2", "#6366f1", "#0d9488", "#2563eb", "#dc2626", "#ef4444", "#f59e0b", "#06b6d4", "#f43f5e", "#78716c", "#eab308", "#22c55e", "#16a34a", "#0ea5e9", "#0284c7", "#94a3b8"];

export const CURRENCIES = [
  { code: "JPY", label: "일본 엔" },
  { code: "USD", label: "미국 달러" },
  { code: "EUR", label: "유로" },
  { code: "CNY", label: "중국 위안" },
  { code: "THB", label: "태국 바트" },
  { code: "VND", label: "베트남 동" },
  { code: "GBP", label: "영국 파운드" },
  { code: "AUD", label: "호주 달러" },
];

export const DEFAULT_LOANS = [];
