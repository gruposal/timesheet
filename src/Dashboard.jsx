import React, { useMemo, useState } from "react";

const card  = "bg-white dark:bg-[#1C1C1E] rounded-2xl";
const th    = "px-4 py-2.5 text-left text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide whitespace-nowrap";
const td    = "px-4 py-3 text-[15px]";

function DesvioCell({ d }) {
  if (d == null) return <span className="text-[#8E8E93]">—</span>;
  if (d === 0)   return <span className="text-[#34C759] font-semibold tabular-nums">0h</span>;
  if (d > 0)     return <span className="text-[#FF3B30] dark:text-[#FF453A] font-semibold tabular-nums">+{d}h</span>;
  return               <span className="text-[#FF9500] dark:text-[#FF9F0A] font-semibold tabular-nums">{d}h</span>;
}

function BarChart({ title, data }) {
  const max = useMemo(() => Math.max(1, ...data.map(d => Math.max(d.forecast || 0, d.consolidated || 0))), [data]);
  return (
    <div className={card}>
      <div className="px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
        <h3 className="font-semibold text-[15px]">{title}</h3>
      </div>
      {!data.length ? (
        <div className="px-5 py-10 text-[15px] text-[#8E8E93] text-center">Sem dados.</div>
      ) : (
        <div className="p-5 space-y-4">
          {data.map(d => (
            <div key={d.name}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[15px] truncate max-w-[180px]" title={d.name}>{d.name}</span>
                <div className="flex gap-3 text-[13px] tabular-nums text-[#8E8E93]">
                  {d.consolidated != null && (
                    <span className="text-black dark:text-white font-semibold">{d.consolidated}h real</span>
                  )}
                  <span>{d.forecast}h prev</span>
                </div>
              </div>
              <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-[#F2F2F7] dark:bg-[#3A3A3C]">
                <div
                  className="h-full rounded-full bg-black dark:bg-white transition-all"
                  style={{ width: `${Math.round((d.forecast / max) * 100)}%`, minWidth: d.forecast > 0 ? 2 : 0 }}
                />
                {d.consolidated != null && (
                  <div
                    className={`h-full rounded-full opacity-70 transition-all ${d.consolidated > d.forecast ? "bg-[#FF3B30] dark:bg-[#FF453A]" : "bg-[#34C759] dark:bg-[#30D158]"}`}
                    style={{ width: `${Math.round((d.consolidated / max) * 100)}%`, minWidth: d.consolidated > 0 ? 2 : 0 }}
                  />
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-5 pt-1 text-[12px] text-[#8E8E93]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-full bg-black dark:bg-white inline-block" />Previsto
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-full bg-[#34C759] inline-block opacity-70" />Realizado
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function groupBy(rows, key) {
  const map = new Map();
  for (const r of rows || []) {
    const g   = r[key] || "—";
    const agg = map.get(g) || { name: g, forecast: 0, consolidated: 0, hasConsolidated: false, count: 0 };
    agg.forecast += Number(r.Hours_Forecast) || 0;
    if (r.Hours_Consolidated != null) { agg.consolidated += Number(r.Hours_Consolidated) || 0; agg.hasConsolidated = true; }
    agg.count++;
    map.set(g, agg);
  }
  return Array.from(map.values())
    .map(x => ({ ...x, consolidated: x.hasConsolidated ? x.consolidated : null }))
    .sort((a, b) => b.forecast - a.forecast);
}

export default function Dashboard({ db }) {
  const [personFilter, setPersonFilter] = useState("");
  const [weekFilter,   setWeekFilter]   = useState("");

  const allPeople = useMemo(() => [...new Set((db || []).map(r => r.Person).filter(Boolean))].sort(), [db]);
  const allWeeks  = useMemo(() => [...new Set((db || []).map(r => r.ISO_Week).filter(Boolean))].sort((a, b) => a - b), [db]);

  const filtered = useMemo(() => {
    let rows = db || [];
    if (personFilter) rows = rows.filter(r => r.Person === personFilter);
    if (weekFilter)   rows = rows.filter(r => String(r.ISO_Week) === weekFilter);
    return rows;
  }, [db, personFilter, weekFilter]);

  const byPerson  = useMemo(() => groupBy(filtered, "Person"),        [filtered]);
  const byProject = useMemo(() => groupBy(filtered, "Project"),       [filtered]);
  const byCC      = useMemo(() => groupBy(filtered, "Business_Unit"), [filtered]);

  const openWeeks = useMemo(() => {
    const map = new Map();
    for (const r of db || []) {
      const key = `${r.Year}-W${String(r.ISO_Week).padStart(2, "0")}|${r.Person}`;
      const cur = map.get(key) || { key, year: r.Year, week: r.ISO_Week, person: r.Person, hasForecast: false, hasConsolidated: false };
      if (r.Hours_Forecast) cur.hasForecast = true;
      if (r.Hours_Consolidated != null) cur.hasConsolidated = true;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .filter(x => x.hasForecast && !x.hasConsolidated)
      .sort((a, b) => b.year - a.year || b.week - a.week);
  }, [db]);

  const totalForecast     = useMemo(() => filtered.reduce((s, r) => s + (Number(r.Hours_Forecast) || 0), 0), [filtered]);
  const totalConsolidated = useMemo(() => filtered.reduce((s, r) => s + (Number(r.Hours_Consolidated) || 0), 0), [filtered]);
  const hasData = db && db.length > 0;

  const selectCls = "w-full rounded-[10px] border border-black/[0.08] dark:border-white/[0.1] bg-[#F2F2F7] dark:bg-[#2C2C2E] px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF] dark:focus:ring-[#0A84FF]";

  return (
    <div className="space-y-5">

      {/* Filters */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1.5">Pessoa</label>
            <select value={personFilter} onChange={e => setPersonFilter(e.target.value)} className={selectCls}>
              <option value="">Todas</option>
              {allPeople.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1.5">Semana</label>
            <select value={weekFilter} onChange={e => setWeekFilter(e.target.value)} className={selectCls}>
              <option value="">Todas</option>
              {allWeeks.map(w => <option key={w} value={String(w)}>Semana {String(w).padStart(2, "0")}</option>)}
            </select>
          </div>
          {(personFilter || weekFilter) && (
            <div className="flex items-end">
              <button
                onClick={() => { setPersonFilter(""); setWeekFilter(""); }}
                className="px-4 py-2 rounded-[10px] bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#007AFF] dark:text-[#0A84FF] text-[15px] font-medium hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C] transition-colors">
                Limpar
              </button>
            </div>
          )}
        </div>
      </div>

      {!hasData && (
        <div className="py-16 text-center text-[15px] text-[#8E8E93]">
          Use "Carregar Semana" ou "Carregar Ano" para ver os dados.
        </div>
      )}

      {hasData && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Registros",     value: filtered.length,                            color: "" },
              { label: "Previstas",     value: `${totalForecast}h`,                        color: "" },
              { label: "Realizadas",    value: totalConsolidated > 0 ? `${totalConsolidated}h` : "—",  color: "" },
              {
                label: "Desvio",
                value: totalConsolidated > 0
                  ? `${totalConsolidated - totalForecast > 0 ? "+" : ""}${totalConsolidated - totalForecast}h`
                  : "—",
                color: totalConsolidated > 0
                  ? totalConsolidated > totalForecast ? "text-[#FF3B30] dark:text-[#FF453A]"
                  : totalConsolidated < totalForecast ? "text-[#FF9500] dark:text-[#FF9F0A]"
                  : "text-[#34C759]"
                  : "",
              },
            ].map(k => (
              <div key={k.label} className={`${card} px-5 py-4`}>
                <div className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">{k.label}</div>
                <div className={`text-[28px] font-semibold tabular-nums leading-tight ${k.color}`}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid gap-4 sm:grid-cols-2">
            <BarChart title="Por Pessoa"  data={byPerson} />
            <BarChart title="Por Projeto" data={byProject} />
          </div>
          <BarChart title="Por Centro de Custo" data={byCC} />

          {/* Comparativo previsão vs real */}
          {byPerson.some(p => p.consolidated != null) && (
            <div className={card}>
              <div className="px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
                <h3 className="font-semibold text-[15px]">Comparativo por Pessoa</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-black/[0.06] dark:border-white/[0.06] bg-[#F9F9F9] dark:bg-[#2C2C2E]/40">
                      <th className={th}>Pessoa</th>
                      <th className={`${th} text-right`}>Previstas</th>
                      <th className={`${th} text-right`}>Realizadas</th>
                      <th className={`${th} text-right`}>Desvio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    {byPerson.map(p => (
                      <tr key={p.name} className="hover:bg-[#F2F2F7]/50 dark:hover:bg-[#2C2C2E]/50 transition-colors">
                        <td className={`${td} font-medium`}>{p.name}</td>
                        <td className={`${td} text-right tabular-nums`}>{p.forecast}h</td>
                        <td className={`${td} text-right tabular-nums`}>{p.consolidated != null ? `${p.consolidated}h` : "—"}</td>
                        <td className={`${td} text-right`}>
                          <DesvioCell d={p.consolidated != null ? p.consolidated - p.forecast : null} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Semanas sem consolidado */}
          {openWeeks.length > 0 && (
            <div className={card}>
              <div className="px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between">
                <h3 className="font-semibold text-[15px]">Semanas sem Consolidado</h3>
                <span className="text-[13px] font-semibold px-2.5 py-1 rounded-full bg-[#FF9500]/10 text-[#FF9500] border border-[#FF9500]/20">
                  {openWeeks.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-black/[0.06] dark:border-white/[0.06] bg-[#F9F9F9] dark:bg-[#2C2C2E]/40">
                      <th className={th}>Semana</th>
                      <th className={th}>Ano</th>
                      <th className={th}>Pessoa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    {openWeeks.map(x => (
                      <tr key={x.key} className="hover:bg-[#F2F2F7]/50 dark:hover:bg-[#2C2C2E]/50 transition-colors">
                        <td className={`${td} tabular-nums font-medium`}>W{String(x.week).padStart(2, "0")}</td>
                        <td className={`${td} tabular-nums text-[#8E8E93]`}>{x.year}</td>
                        <td className={`${td} font-medium`}>{x.person}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
