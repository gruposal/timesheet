import React, { useMemo, useState } from "react";

function groupTotals(rows, key) {
  const map = new Map();
  for (const r of rows || []) {
    const groupKey = r?.[key] || "—";
    const total = Number(r?.Total) || 0;
    const agg = map.get(groupKey) || { name: groupKey, total: 0, people: new Set(), projects: new Set() };
    agg.total += total;
    if (r?.Person) agg.people.add(r.Person);
    if (r?.Project) agg.projects.add(r.Project);
    map.set(groupKey, agg);
  }
  return Array.from(map.values()).map((x) => ({
    name: x.name,
    total: x.total,
    peopleCount: x.people.size,
    projectsCount: x.projects.size,
  }));
}

function Bars({ data, title, subtitle }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.total)), [data]);
  return (
    <section className="p-4 bg-white rounded-2xl shadow-sm border">
      <div className="mb-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {subtitle ? <div className="text-sm text-gray-500">{subtitle}</div> : null}
      </div>
      {!data.length ? (
        <div className="text-sm text-gray-500">Sem dados.</div>
      ) : (
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.name} className="grid grid-cols-[minmax(120px,180px)_1fr_80px] items-center gap-3">
              <div className="truncate" title={d.name}>{d.name}</div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-black/80"
                  style={{ width: `${Math.round((d.total / max) * 100)}%` }}
                />
              </div>
              <div className="text-right tabular-nums">{d.total}h</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TableBU({ data }) {
  return (
    <section className="p-4 bg-white rounded-2xl shadow-sm border">
      <div className="mb-3">
        <h3 className="text-lg font-semibold">Por Unidade de Negócio</h3>
        <div className="text-sm text-gray-500">Horas totais, nº de pessoas e nº de projetos por BU</div>
      </div>
      {!data.length ? (
        <div className="text-sm text-gray-500">Sem dados.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 pr-2">BU</th>
                <th className="py-2 pr-2 text-right">Horas</th>
                <th className="py-2 pr-2 text-right">Pessoas</th>
                <th className="py-2 pr-2 text-right">Projetos</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.name} className="border-t">
                  <td className="py-2 pr-2">{d.name}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{d.total}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{d.peopleCount}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{d.projectsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Dashboard({ db }) {
  const [personFilter, setPersonFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const allPersons = useMemo(() => Array.from(new Set((db||[]).map(r=>r.Person).filter(Boolean))).sort(), [db]);
  const allProjects = useMemo(() => Array.from(new Set((db||[]).map(r=>r.Project).filter(Boolean))).sort(), [db]);

  const filteredDb = useMemo(() => {
    let rows = db || [];
    if (personFilter) rows = rows.filter(r => r.Person === personFilter);
    if (projectFilter) rows = rows.filter(r => r.Project === projectFilter);
    return rows;
  }, [db, personFilter, projectFilter]);

  const byPerson = useMemo(() =>
    groupTotals(filteredDb, "Person").sort((a, b) => b.total - a.total),
    [filteredDb]
  );
  const byProject = useMemo(() =>
    groupTotals(filteredDb, "Project").sort((a, b) => b.total - a.total),
    [filteredDb]
  );
  const byBU = useMemo(() =>
    groupTotals(filteredDb, "Business_Unit").sort((a, b) => b.total - a.total),
    [filteredDb]
  );

  function toWeekKey(row) {
    const d = row?.Week_Start ? new Date(row.Week_Start) : null;
    if (!d || isNaN(d)) return String(row?.Year||"").padStart(4,"0")+"-W"+String(row?.ISO_Week||"").padStart(2,"0");
    const y = d.getFullYear();
    const w = String(row?.ISO_Week || 0).padStart(2, "0");
    return `${y}-W${w}`;
  }
  function toMonthKey(row) {
    const d = row?.Week_Start ? new Date(row.Week_Start) : null;
    const y = d && !isNaN(d) ? d.getFullYear() : (row?.Year||"");
    const m = d && !isNaN(d) ? String(d.getMonth()+1).padStart(2,"0") : "01";
    return `${y}-${m}`;
  }

  // Weekly series for person filter
  const weeklyPersonSeries = useMemo(() => {
    if (!personFilter) return null;
    const map = new Map(); const weeks = new Map();
    for (const r of (db||[])) {
      if (r.Person !== personFilter) continue;
      const wk = toWeekKey(r);
      const dateKey = r.Week_Start || wk;
      weeks.set(wk, dateKey);
      map.set(wk, (map.get(wk)||0) + (Number(r.Total)||0));
    }
    const entries = Array.from(map.entries()).map(([wk, total])=>({ wk, total, dateKey: weeks.get(wk) }));
    entries.sort((a,b)=> String(a.dateKey).localeCompare(String(b.dateKey)));
    return entries;
  }, [db, personFilter]);

  // Weekly series by person for a selected project
  const weeklyByPersonForProject = useMemo(() => {
    if (!projectFilter) return [];
    const byPersonMap = new Map();
    const allWeeks = new Set();
    for (const r of (db||[])) {
      if (r.Project !== projectFilter) continue;
      const wk = toWeekKey(r);
      allWeeks.add(r.Week_Start || wk);
      const person = r.Person || "—";
      const m = byPersonMap.get(person) || new Map();
      m.set(wk, (m.get(wk)||0) + (Number(r.Total)||0));
      byPersonMap.set(person, m);
    }
    const weeksSorted = Array.from(allWeeks).sort((a,b)=> String(a).localeCompare(String(b)));
    // Build array of { person, series: number[], total }
    return Array.from(byPersonMap.entries()).map(([person, m]) => {
      // derive weekKey from weekStart ordering
      const series = weeksSorted.map(ws => {
        // rebuild wk from date string by finding a row with that week_start
        // fallback: use ws as key
        const wkCandidates = Array.from(m.keys());
        // try direct match on wk end if present; otherwise sum 0
        // since we can't reconstruct ISO week reliably here, take m.get of any key whose string appears in ws or last 2 digits
        // simpler: try all keys and pick if ws includes the ISO week segment
        let val = 0;
        for (const k of wkCandidates) { if (ws.includes(k.split("-W")[1])) { val = m.get(k) || 0; break; } }
        if (!val && m.has(ws)) val = m.get(ws) || 0;
        return val;
      });
      const total = series.reduce((s,n)=>s+n,0);
      return { person, series, total, weeksLabels: weeksSorted };
    }).sort((a,b)=> b.total - a.total);
  }, [db, projectFilter]);

  // Monthly proportionality per project
  const monthlyProportion = useMemo(() => {
    const monthTotals = new Map(); // month -> total hours
    const monthProject = new Map(); // month -> Map(project -> hours)
    for (const r of (db||[])) {
      const mk = toMonthKey(r);
      const pt = Number(r.Total)||0;
      monthTotals.set(mk, (monthTotals.get(mk)||0) + pt);
      const mp = monthProject.get(mk) || new Map();
      mp.set(r.Project || "—", (mp.get(r.Project||"—")||0) + pt);
      monthProject.set(mk, mp);
    }
    const months = Array.from(monthTotals.keys()).sort();
    const rows = months.map((mk) => {
      const total = monthTotals.get(mk) || 0;
      const mp = monthProject.get(mk) || new Map();
      const projects = Array.from(mp.entries()).map(([name, hours])=>({
        name, hours, pct: total ? Math.round((hours/total)*100) : 0
      })).sort((a,b)=> b.hours - a.hours);
      return { month: mk, total, projects };
    });
    return rows;
  }, [db]);

  const hasData = (db && db.length) > 0;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      {/* Filters */}
      <section className="mb-4 p-4 bg-white rounded-2xl shadow-sm border grid gap-3 md:grid-cols-3">
        <label className="text-sm">Pessoa
          <select className="w-full mt-1 rounded-xl border px-3 py-2" value={personFilter} onChange={(e)=>setPersonFilter(e.target.value)}>
            <option value="">Todas</option>
            {allPersons.map(p => (<option key={p} value={p}>{p}</option>))}
          </select>
        </label>
        <label className="text-sm">Projeto
          <select className="w-full mt-1 rounded-xl border px-3 py-2" value={projectFilter} onChange={(e)=>setProjectFilter(e.target.value)}>
            <option value="">Todos</option>
            {allProjects.map(p => (<option key={p} value={p}>{p}</option>))}
          </select>
        </label>
        <div className="flex items-end">
          <button onClick={()=>{setPersonFilter(""); setProjectFilter("");}} className="rounded-xl border px-3 py-2 w-full">Limpar filtros</button>
        </div>
      </section>
      {!hasData && (
        <div className="mb-4 p-3 rounded-xl border bg-yellow-50 text-yellow-800 text-sm">
          Sem dados na base local. Use "Adicionar à Base" ou "Carregar Semana" para popular o dashboard.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Bars title="Horas por Pessoa" subtitle="Soma de Total por pessoa (aplica filtros)" data={byPerson} />
        <Bars title="Horas por Projeto" subtitle="Soma de Total por projeto (aplica filtros)" data={byProject} />
      </div>

      <div className="mt-6">
        <TableBU data={byBU} />
      </div>

      {/* Weekly evolution for selected person */}
      {personFilter && (
        <section className="mt-6 p-4 bg-white rounded-2xl shadow-sm border">
          <h3 className="text-lg font-semibold mb-2">Evolução Semanal – {personFilter}</h3>
          {!weeklyPersonSeries?.length ? (
            <div className="text-sm text-gray-500">Sem dados.</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[640px] grid grid-rows-2 gap-2">
                <div className="flex items-end gap-1 h-24">
                  {(() => {
                    const max = Math.max(1, ...weeklyPersonSeries.map(p=>p.total));
                    return weeklyPersonSeries.map((p) => (
                      <div key={p.wk} className="w-2 bg-black/80" title={`${p.wk}: ${p.total}h`} style={{ height: `${(p.total/max)*100}%` }} />
                    ));
                  })()}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  {weeklyPersonSeries.map((p)=> (
                    <div key={p.wk} className="w-2 rotate-45 origin-top-left whitespace-nowrap" title={p.wk}>{p.wk.split("-W")[1]}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Weekly evolution per person for selected project */}
      {projectFilter && (
        <section className="mt-6 p-4 bg-white rounded-2xl shadow-sm border">
          <h3 className="text-lg font-semibold mb-2">Evolução por Pessoa no Projeto – {projectFilter}</h3>
          {!weeklyByPersonForProject.length ? (
            <div className="text-sm text-gray-500">Sem dados.</div>
          ) : (
            <div className="space-y-3">
              {weeklyByPersonForProject.map((row) => (
                <div key={row.person}>
                  <div className="text-sm mb-1">{row.person} <span className="text-gray-500">({row.total}h)</span></div>
                  <div className="flex items-end gap-1 h-16">
                    {(() => {
                      const max = Math.max(1, ...row.series);
                      return row.series.map((v, idx) => (
                        <div key={idx} className="w-2 bg-black/70" title={`${row.weeksLabels[idx]}: ${v}h`} style={{ height: `${(v/max)*100}%` }} />
                      ));
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Monthly proportionality by project */}
      <section className="mt-6 p-4 bg-white rounded-2xl shadow-sm border">
        <h3 className="text-lg font-semibold mb-2">Proporção Mensal de Horas por Projeto</h3>
        {!monthlyProportion.length ? (
          <div className="text-sm text-gray-500">Sem dados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2 pr-2">Mês</th>
                  <th className="py-2 pr-2">Top Projetos (participação %)</th>
                  <th className="py-2 pr-2 text-right">Total (h)</th>
                </tr>
              </thead>
              <tbody>
                {monthlyProportion.map((m) => (
                  <tr key={m.month} className="border-t align-top">
                    <td className="py-2 pr-2 whitespace-nowrap">{m.month}</td>
                    <td className="py-2 pr-2">
                      <div className="space-y-1">
                        {m.projects.slice(0,5).map((p) => (
                          <div key={p.name} className="grid grid-cols-[180px_1fr_50px] items-center gap-2">
                            <div className="truncate" title={p.name}>{p.name}</div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-black/80" style={{ width: `${p.pct}%` }} />
                            </div>
                            <div className="text-right tabular-nums">{p.pct}%</div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{m.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}


