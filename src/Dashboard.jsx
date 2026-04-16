import React, { useMemo, useState } from "react";

const card = "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden";
const th = "px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap";
const td = "px-4 py-2.5 text-sm";

function Desvio({ d }) {
  if (d == null) return <span className="text-slate-300 text-xs">—</span>;
  if (d === 0) return <span className="text-emerald-600 tabular-nums font-medium">0h</span>;
  if (d > 0)   return <span className="text-red-500 tabular-nums font-medium">+{d}h</span>;
  return              <span className="text-amber-500 tabular-nums font-medium">{d}h</span>;
}

function BarChart({ title, data, valueKey = "forecast" }) {
  const max = useMemo(() => Math.max(1, ...data.map(d => Math.max(d.forecast || 0, d.consolidated || 0))), [data]);
  return (
    <div className={card}>
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      {!data.length ? (
        <div className="px-5 py-8 text-sm text-slate-400 text-center">Sem dados.</div>
      ) : (
        <div className="p-5 space-y-3">
          {data.map(d => (
            <div key={d.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm truncate max-w-[180px]" title={d.name}>{d.name}</span>
                <div className="flex gap-3 text-xs tabular-nums text-slate-500">
                  {d.consolidated != null && <span className="text-slate-700 dark:text-slate-300 font-medium">{d.consolidated}h real</span>}
                  <span>{d.forecast}h prev</span>
                </div>
              </div>
              <div className="flex gap-0.5 h-2">
                <div className="h-full rounded-full bg-slate-800 dark:bg-slate-300" style={{ width: `${Math.round((d.forecast / max) * 100)}%`, minWidth: d.forecast > 0 ? 2 : 0 }} />
                {d.consolidated != null && (
                  <div className={`h-full rounded-full opacity-60 ${d.consolidated > d.forecast ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: `${Math.round((d.consolidated / max) * 100)}%`, minWidth: d.consolidated > 0 ? 2 : 0 }} />
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-4 pt-1 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded bg-slate-800 dark:bg-slate-300 inline-block" />Previsto</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded bg-emerald-400 inline-block opacity-60" />Realizado</span>
          </div>
        </div>
      )}
    </div>
  );
}

function groupBy(rows, key) {
  const map = new Map();
  for (const r of rows || []) {
    const g = r[key] || "—";
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
  const [weekFilter, setWeekFilter] = useState("");

  const allPeople  = useMemo(() => [...new Set((db||[]).map(r => r.Person).filter(Boolean))].sort(), [db]);
  const allWeeks   = useMemo(() => [...new Set((db||[]).map(r => r.ISO_Week).filter(Boolean))].sort((a,b) => a-b), [db]);

  const filtered = useMemo(() => {
    let rows = db || [];
    if (personFilter) rows = rows.filter(r => r.Person === personFilter);
    if (weekFilter)   rows = rows.filter(r => String(r.ISO_Week) === weekFilter);
    return rows;
  }, [db, personFilter, weekFilter]);

  const byPerson  = useMemo(() => groupBy(filtered, "Person"), [filtered]);
  const byProject = useMemo(() => groupBy(filtered, "Project"), [filtered]);
  const byCC      = useMemo(() => groupBy(filtered, "Business_Unit"), [filtered]);

  // Semanas abertas: tem previsão mas não tem consolidado
  const openWeeks = useMemo(() => {
    const map = new Map();
    for (const r of db || []) {
      const key = `${r.Year}-W${String(r.ISO_Week).padStart(2,"0")}|${r.Person}`;
      const cur = map.get(key) || { key, year: r.Year, week: r.ISO_Week, person: r.Person, hasForecast: false, hasConsolidated: false };
      if (r.Hours_Forecast) cur.hasForecast = true;
      if (r.Hours_Consolidated != null) cur.hasConsolidated = true;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .filter(x => x.hasForecast && !x.hasConsolidated)
      .sort((a,b) => b.year - a.year || b.week - a.week);
  }, [db]);

  const totalForecast     = useMemo(() => filtered.reduce((s,r) => s + (Number(r.Hours_Forecast)||0), 0), [filtered]);
  const totalConsolidated = useMemo(() => filtered.reduce((s,r) => s + (Number(r.Hours_Consolidated)||0), 0), [filtered]);
  const hasData = (db && db.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base">Dashboard</h2>
      </div>

      {/* Filters */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-slate-500 mb-1">Pessoa</label>
            <select
              value={personFilter}
              onChange={e => setPersonFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none"
            >
              <option value="">Todas</option>
              {allPeople.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs text-slate-500 mb-1">Semana</label>
            <select
              value={weekFilter}
              onChange={e => setWeekFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none"
            >
              <option value="">Todas</option>
              {allWeeks.map(w => <option key={w} value={String(w)}>Semana {String(w).padStart(2,"0")}</option>)}
            </select>
          </div>
          {(personFilter || weekFilter) && (
            <div className="flex items-end">
              <button
                onClick={() => { setPersonFilter(""); setWeekFilter(""); }}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Limpar
              </button>
            </div>
          )}
        </div>
      </div>

      {!hasData && (
        <div className="text-sm text-slate-400 text-center py-8">
          Sem dados. Carregue uma semana ou o ano completo no Timesheet.
        </div>
      )}

      {hasData && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Registros", value: filtered.length },
              { label: "Previstas (h)", value: totalForecast },
              { label: "Realizadas (h)", value: totalConsolidated > 0 ? totalConsolidated : "—" },
              {
                label: "Desvio",
                value: totalConsolidated > 0 ? `${totalConsolidated - totalForecast > 0 ? "+" : ""}${totalConsolidated - totalForecast}h` : "—",
                color: totalConsolidated > 0 ? (totalConsolidated > totalForecast ? "text-red-500" : totalConsolidated < totalForecast ? "text-amber-500" : "text-emerald-600") : ""
              },
            ].map(k => (
              <div key={k.label} className={`${card} px-5 py-4`}>
                <div className="text-xs text-slate-500 mb-1">{k.label}</div>
                <div className={`text-2xl font-semibold tabular-nums ${k.color || ""}`}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid gap-4 md:grid-cols-2">
            <BarChart title="Por Pessoa" data={byPerson} />
            <BarChart title="Por Projeto" data={byProject} />
          </div>
          <BarChart title="Por Centro de Custo" data={byCC} />

          {/* Comparativo previsão vs real */}
          {byPerson.some(p => p.consolidated != null) && (
            <div className={card}>
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                <h3 className="font-semibold text-sm">Comparativo Previsão vs Realizado</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                      <th className={th}>Pessoa</th>
                      <th className={`${th} text-right`}>Previstas</th>
                      <th className={`${th} text-right`}>Realizadas</th>
                      <th className={`${th} text-right`}>Desvio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {byPerson.map(p => (
                      <tr key={p.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className={`${td} font-medium`}>{p.name}</td>
                        <td className={`${td} text-right tabular-nums`}>{p.forecast}h</td>
                        <td className={`${td} text-right tabular-nums`}>{p.consolidated != null ? `${p.consolidated}h` : "—"}</td>
                        <td className={`${td} text-right`}>
                          <Desvio d={p.consolidated != null ? p.consolidated - p.forecast : null} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Semanas abertas */}
          {openWeeks.length > 0 && (
            <div className={card}>
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <h3 className="font-semibold text-sm">Semanas sem Consolidado</h3>
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{openWeeks.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                      <th className={th}>Semana</th>
                      <th className={th}>Ano</th>
                      <th className={th}>Pessoa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {openWeeks.map(x => (
                      <tr key={x.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className={`${td} tabular-nums`}>W{String(x.week).padStart(2,"0")}</td>
                        <td className={`${td} tabular-nums`}>{x.year}</td>
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
