import { formatWon } from "../utils";

export default function ProgressBar({ label, spent, budget }) {
  const rawPct = budget > 0 ? (spent / budget) * 100 : 0;
  const pct = Math.min(rawPct, 100);
  const over = spent > budget;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-600 font-medium">{label}</span>
        <span className={over ? "text-red-500 font-semibold" : "text-slate-500"}>
          {formatWon(spent)} / {formatWon(budget)}
          <span className={`ml-1.5 font-semibold ${over ? "text-red-500" : "text-emerald-600"}`}>{rawPct.toFixed(0)}%</span>
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
