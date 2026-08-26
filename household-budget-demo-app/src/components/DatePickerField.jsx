import { useState, useEffect } from "react";
import { formatDateDisplay, pad, daysInMonth, firstWeekday } from "../utils";

export default function DatePickerField({ value, onChange, placeholder = "날짜 선택", className = "" }) {
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
                <button type="button" onClick={goPrevYear} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200" title="이전 연도">«</button>
                <button type="button" onClick={goPrevMonth} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200">‹</button>
              </div>
              <div className="text-sm font-semibold text-slate-800">{viewYear}년 {viewMonth + 1}월</div>
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={goNextMonth} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200">›</button>
                <button type="button" onClick={goNextYear} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200" title="다음 연도">»</button>
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
                    className={`h-10 rounded-lg text-sm ${
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
