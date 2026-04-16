import React, { useEffect, useMemo, useRef, useState } from "react";
import { format, getISOWeek, startOfISOWeek, endOfISOWeek, setISOWeek, setYear } from "date-fns";
import Dashboard from "./Dashboard.jsx";
import Directory from "./Directory.jsx";
import { loadForWeek, loadLastYear, upsertForecast, upsertConsolidated, deleteRow as cuDeleteRow } from "./lib/clickup/entries.js";
import { people as cuPeople, projects as cuProjects } from "./lib/clickup/lists.js";
import { CENTRO_DE_CUSTO_OPTIONS } from "./lib/clickup/fields.js";

const DEFAULT_BUS = CENTRO_DE_CUSTO_OPTIONS.map(o => o.name);
const toTwo = (n) => String(n).padStart(2, "0");
const uid = () => Math.random().toString(36).slice(2, 10);
const PERSIST_KEY = "ts:cu:v1";

function safeJsonParse(t, fb) { try { return JSON.parse(t); } catch { return fb; } }
function weekStartEnd(year, isoWeek) {
  const d = setISOWeek(setYear(new Date(), year), isoWeek);
  return { start: startOfISOWeek(d), end: endOfISOWeek(d) };
}

export function sumWeek(entry) { return Number(entry?.Hours_Forecast) || 0; }
export function allowedAfterCap(otherTotal, candidate) {
  return Math.min(Math.max(0, 40 - otherTotal), Math.max(0, candidate));
}

if (typeof window !== "undefined" && !window.__TS_TEST__) {
  window.__TS_TEST__ = true;
  console.assert(sumWeek({ Hours_Forecast: 32 }) === 32);
  console.assert(allowedAfterCap(30, 5) === 5);
  console.assert(allowedAfterCap(38, 10) === 2);
  console.log("[Timesheet] self-tests OK");
}

// ─── Combobox ────────────────────────────────────────────────────────────────
function Combobox({ value, onChange, options, placeholder, className }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const [rect, setRect] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { setQuery(value ?? ""); }, [value]);

  // Close on scroll so the dropdown doesn't drift from input on mobile
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [query, options]);

  function openDropdown() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect(r);
    setOpen(true);
  }

  function select(opt) {
    setQuery(opt);
    onChange(opt);
    setOpen(false);
  }

  function handleBlur(e) {
    if (listRef.current?.contains(e.relatedTarget)) return;
    const match = options.find(o => o.toLowerCase() === query.trim().toLowerCase());
    if (match) { onChange(match); setQuery(match); }
    else { setQuery(value ?? ""); }
    setOpen(false);
  }

  // Position: prefer below, flip above if not enough space
  const dropStyle = useMemo(() => {
    if (!rect) return {};
    const spaceBelow = window.innerHeight - rect.bottom;
    const maxH = 208; // max-h-52 = 13rem ≈ 208px
    const top = spaceBelow >= maxH + 8 ? rect.bottom + 4 : rect.top - Math.min(maxH, filtered.length * 44) - 4;
    // On narrow screens stretch to viewport width with horizontal margin
    const isMobile = window.innerWidth < 640;
    return isMobile
      ? { position: "fixed", top, left: 12, right: 12, zIndex: 9999 }
      : { position: "fixed", top, left: rect.left, width: rect.width, zIndex: 9999 };
  }, [rect, filtered.length]);

  return (
    <>
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); openDropdown(); }}
        onFocus={openDropdown}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {open && filtered.length > 0 && rect && (
        <ul
          ref={listRef}
          style={dropStyle}
          className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl text-sm"
        >
          {filtered.map(opt => (
            <li
              key={opt}
              tabIndex={-1}
              onMouseDown={e => { e.preventDefault(); select(opt); }}
              onTouchEnd={e => { e.preventDefault(); select(opt); }}
              className={`px-3 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 ${opt === value ? "font-medium text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"}`}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────
function WeekStatus({ entries }) {
  const hasForecast = entries.some(e => Number(e.hours_forecast) > 0);
  const hasConsolidated = entries.some(e => Number(e.hours_consolidated) > 0);
  if (hasConsolidated) return <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">● Consolidado</span>;
  if (hasForecast)    return <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">◑ Previsão</span>;
  return                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">○ Sem lançamento</span>;
}

// ─── Desvio badge ─────────────────────────────────────────────────────────────
function Desvio({ forecast, consolidated }) {
  if (consolidated == null || consolidated === "") return <span className="text-slate-300">—</span>;
  const d = Number(consolidated) - Number(forecast);
  if (d === 0) return <span className="text-emerald-600 font-medium tabular-nums">0h</span>;
  if (d > 0)   return <span className="text-red-500 font-medium tabular-nums">+{d}h</span>;
  return              <span className="text-amber-500 font-medium tabular-nums">{d}h</span>;
}

export default function TimesheetApp() {
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const bus = DEFAULT_BUS;

  const today = new Date();
  const persisted = typeof window !== "undefined"
    ? safeJsonParse(localStorage.getItem(PERSIST_KEY) || "{}", {})
    : {};

  const [selectedYear, setSelectedYear] = useState(Number(persisted.selectedYear) || today.getFullYear());
  const [selectedWeek, setSelectedWeek] = useState(Number(persisted.selectedWeek) || getISOWeek(today));
  const [person, setPerson] = useState(persisted.person || "");
  const { start, end } = useMemo(() => weekStartEnd(selectedYear, selectedWeek), [selectedYear, selectedWeek]);

  const blankEntry = () => ({ id: uid(), project: projects[0] || "", businessUnit: bus[0] || "", hours_forecast: "", hours_consolidated: "" });
  const [entries, setEntries] = useState(() =>
    Array.isArray(persisted.entries) && persisted.entries.length ? persisted.entries : [blankEntry()]
  );
  const [db, setDb] = useState([]);
  const [dbFilter, setDbFilter] = useState("");
  const [dbOpen, setDbOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [previewSort, setPreviewSort] = useState({ field: "ISO_Week", dir: "desc" });
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize] = useState(15);
  const [editingId, setEditingId] = useState(null);
  const [editingValues, setEditingValues] = useState(null);
  const [view, setView] = useState(persisted.view || "timesheet");
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    const s = persisted.theme || localStorage.getItem("theme");
    if (s === "dark" || s === "light") return s;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const [toast, setToast] = useState("");
  const toastRef = useRef(null);
  const [helpOpen, setHelpOpen] = useState(false);

  function showToast(msg) {
    if (!toastRef.current) toastRef.current = {};
    setToast(msg);
    clearTimeout(toastRef.current.t);
    toastRef.current.t = setTimeout(() => setToast(""), 2600);
  }

  useEffect(() => {
    const root = document.documentElement;
    theme === "dark" ? root.classList.add("dark") : root.classList.remove("dark");
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({ selectedYear, selectedWeek, person, entries, view, theme }));
    } catch {}
  }, [selectedYear, selectedWeek, person, entries, view, theme]);

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setHelpOpen(v => !v); }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setHelpOpen(v => !v); }
      if (e.shiftKey) {
        if (e.key === "1") { e.preventDefault(); setView("timesheet"); }
        if (e.key === "2") { e.preventDefault(); setView("dashboard"); }
        if (e.key === "3") { e.preventDefault(); setView("directory"); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function loadLists() {
    try {
      const [ppl, projs] = await Promise.all([cuPeople.loadAll(), cuProjects.loadAll()]);
      if (ppl.length) setPeople(ppl.map(p => p.name));
      if (projs.length) setProjects(projs.map(p => p.name));
    } catch (e) { console.warn("loadLists:", e); }
  }
  useEffect(() => { loadLists(); }, []);

  useEffect(() => {
    if (people.length && person && !people.includes(person)) setPerson("");
  }, [people]);

  function prevWeek() {
    if (selectedWeek > 1) setSelectedWeek(w => w - 1);
    else { setSelectedYear(y => y - 1); setSelectedWeek(52); }
  }
  function nextWeek() {
    if (selectedWeek < 52) setSelectedWeek(w => w + 1);
    else { setSelectedYear(y => y + 1); setSelectedWeek(1); }
  }

  const totalForecast = useMemo(() => entries.reduce((s, e) => s + (Number(e.hours_forecast) || 0), 0), [entries]);
  const totalConsolidated = useMemo(() => entries.reduce((s, e) => s + (Number(e.hours_consolidated) || 0), 0), [entries]);
  const desvioTotal = totalConsolidated - totalForecast;

  function updateEntry(id, field, value) {
    setEntries(prev => prev.map(e => {
      if (e.id !== id) return e;
      const next = { ...e };
      if (field === "hours_forecast" || field === "hours_consolidated") {
        if (value === "") { next[field] = ""; return next; }
        let n = parseInt(value, 10);
        if (isNaN(n)) n = 0;
        n = Math.max(0, Math.min(40, n));
        if (field === "hours_forecast") {
          const otherTotal = prev.filter(r => r.id !== id).reduce((s, r) => s + (Number(r.hours_forecast) || 0), 0);
          if (otherTotal + n > 40) { n = Math.max(0, 40 - otherTotal); showToast("Limite de 40h atingido."); }
        }
        next[field] = n;
      } else { next[field] = value; }
      return next;
    }));
  }

  function addRow() { setEntries(p => [...p, blankEntry()]); }
  function removeRow(id) {
    setEntries(p => {
      if (p.length === 1) return p;
      if (!window.confirm("Remover esta linha?")) return p;
      return p.filter(e => e.id !== id);
    });
  }
  function clearEntries() { setEntries([blankEntry()]); }

  function buildCuRows() {
    return entries
      .filter(e => Number(e.hours_forecast) > 0 || Number(e.hours_consolidated) > 0)
      .map(e => ({
        Year: selectedYear, ISO_Week: selectedWeek, Person: person,
        Project: e.project, Business_Unit: e.businessUnit,
        Hours_Forecast: Number(e.hours_forecast) || null,
        Hours_Consolidated: Number(e.hours_consolidated) || null,
      }));
  }

  async function saveForecast() {
    if (!person) { showToast("Selecione a pessoa."); return; }
    const rows = buildCuRows().filter(r => r.Hours_Forecast != null);
    if (!rows.length) { showToast("Nenhuma previsão para salvar."); return; }
    try { setSaving(true); await upsertForecast(rows); showToast(`Previsão salva (${rows.length} linha(s)).`); loadFromClickUpForWeek(); }
    catch (e) { console.warn(e); showToast("Erro ao salvar previsão."); }
    finally { setSaving(false); }
  }

  async function saveConsolidated() {
    if (!person) { showToast("Selecione a pessoa."); return; }
    const rows = buildCuRows().filter(r => r.Hours_Consolidated != null);
    if (!rows.length) { showToast("Nenhum consolidado para salvar."); return; }
    try { setSaving(true); await upsertConsolidated(rows); showToast(`Consolidado salvo (${rows.length} linha(s)).`); loadFromClickUpForWeek(); }
    catch (e) { console.warn(e); showToast("Erro ao salvar consolidado."); }
    finally { setSaving(false); }
  }

  async function loadFromClickUpForWeek() {
    try {
      setLoadingWeek(true);
      const rows = await loadForWeek(selectedYear, selectedWeek);
      setDb(rows); setPreviewPage(1); setDbOpen(true);
      const mine = rows.filter(r => r.Person === person);
      if (mine.length) {
        setEntries(mine.map(r => ({
          id: uid(), project: r.Project, businessUnit: r.Business_Unit,
          hours_forecast: r.Hours_Forecast ?? "",
          hours_consolidated: r.Hours_Consolidated ?? "",
        })));
      }
      showToast(`${rows.length} registro(s) carregado(s).`);
    } catch (e) { console.warn(e); showToast("Erro ao carregar semana."); }
    finally { setLoadingWeek(false); }
  }

  async function deleteDbRow(row) {
    try { await cuDeleteRow(row); setDb(p => p.filter(r => r.ID !== row.ID)); showToast("Removido."); }
    catch (e) { console.warn(e); showToast("Erro ao remover."); }
  }

  function startEditRow(row) { setEditingId(row.ID); setEditingValues({ ...row }); }
  function cancelEditRow() { setEditingId(null); setEditingValues(null); }
  function changeEditing(f, v) { setEditingValues(p => ({ ...p, [f]: v })); }

  async function saveEditRow() {
    if (!editingId || !editingValues) return;
    try {
      setSaving(true);
      await upsertForecast([{ ...editingValues, Hours_Forecast: Number(editingValues.Hours_Forecast) || null, Hours_Consolidated: Number(editingValues.Hours_Consolidated) || null }]);
      if (editingValues.Hours_Consolidated != null)
        await upsertConsolidated([{ ...editingValues, Hours_Consolidated: Number(editingValues.Hours_Consolidated) || null }]);
      setDb(p => p.map(r => r.ID === editingId ? { ...editingValues } : r));
      showToast("Atualizado."); cancelEditRow();
    } catch (e) { console.warn(e); showToast("Erro ao atualizar."); }
    finally { setSaving(false); }
  }

  const filteredDb = useMemo(() => {
    if (!dbFilter) return db;
    const f = dbFilter.toLowerCase();
    return db.filter(r =>
      String(r.Person).toLowerCase().includes(f) ||
      String(r.Project).toLowerCase().includes(f) ||
      String(r.Business_Unit).toLowerCase().includes(f)
    );
  }, [db, dbFilter]);

  const sortedDb = useMemo(() => {
    const arr = [...filteredDb];
    const { field, dir } = previewSort;
    arr.sort((a, b) => {
      const va = a[field], vb = b[field];
      if (va == null && vb == null) return 0;
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return dir === "asc" ? va - vb : vb - va;
      return dir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return arr;
  }, [filteredDb, previewSort]);

  const totalPages = Math.max(1, Math.ceil(sortedDb.length / previewPageSize));
  const currentPage = Math.min(previewPage, totalPages);
  const pagedDb = useMemo(() => sortedDb.slice((currentPage - 1) * previewPageSize, currentPage * previewPageSize), [sortedDb, currentPage, previewPageSize]);

  function toggleSort(f) {
    setPreviewSort(p => p.field === f ? { field: f, dir: p.dir === "asc" ? "desc" : "asc" } : { field: f, dir: "asc" });
  }

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const data = db.length ? db : [];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Registros");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(people.map(p => ({ Pessoa: p }))), "Pessoas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(projects.map(p => ({ Projeto: p }))), "Projetos");
    XLSX.writeFile(wb, `Timesheet_${selectedYear}_${format(new Date(), "yyyyMMdd")}.xlsx`);
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  const bg = "min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100";
  const card = "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl";
  const inputCls = "rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 w-full";
  const btnPrimary = "inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-700 dark:hover:bg-slate-200 disabled:opacity-40 transition-colors";
  const btnSecondary = "inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors";
  const th = "px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap";
  const td = "px-4 py-2.5 text-sm";

  const TAB = [
    { k: "timesheet", label: "Timesheet" },
    { k: "dashboard", label: "Dashboard" },
    { k: "directory", label: "Cadastros" },
  ];

  const TAB_ICONS = { timesheet: "📋", dashboard: "📊", directory: "👥" };

  return (
    <div className={bg}>

      {/* ── Topbar ── */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white h-14 flex items-center px-4 gap-4 shadow-sm">
        <span className="font-semibold text-sm tracking-wide text-slate-100 shrink-0">SAL Timesheet</span>

        {/* Tabs — desktop only */}
        <nav className="hidden sm:flex gap-1 ml-2">
          {TAB.map(t => (
            <button key={t.k} onClick={() => setView(t.k)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${view === t.k ? "bg-white/15 text-white font-medium" : "text-slate-400 hover:text-white hover:bg-white/10"}`}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {/* Excel — desktop only */}
          <button onClick={exportExcel} className="hidden sm:flex px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Exportar Excel">
            Excel
          </button>
          <button onClick={() => setHelpOpen(v => !v)} className="px-2.5 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Ajuda">
            ?
          </button>
          <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} className="px-2.5 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
            {theme === "dark" ? "☀" : "◑"}
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 sm:pb-8">

        {/* ══ Timesheet view ══ */}
        {view === "timesheet" && (
          <>
            {/* Week + Person bar */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <Combobox
                value={person}
                onChange={setPerson}
                options={people}
                placeholder="— selecione —"
                className={`${inputCls} w-auto min-w-[180px]`}
              />

              <div className="flex items-center gap-1 ml-auto">
                <button onClick={prevWeek} className={btnSecondary} aria-label="Semana anterior">←</button>
                <div className="px-4 py-2 text-sm font-medium tabular-nums">
                  Semana {toTwo(selectedWeek)} · {selectedYear}
                </div>
                <button onClick={nextWeek} className={btnSecondary} aria-label="Próxima semana">→</button>
              </div>

              <div className="text-sm text-slate-500">
                {format(start, "dd/MM")} – {format(end, "dd/MM")}
              </div>

              <WeekStatus entries={entries} />
            </div>

            {/* Entry table */}
            <div className={`${card} overflow-x-auto mb-4`}>
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <th className={th} style={{ width: "22%" }}>Centro de Custo</th>
                    <th className={th}>Projeto</th>
                    <th className={`${th} text-center`} style={{ width: "110px" }}>Previstas</th>
                    <th className={`${th} text-center`} style={{ width: "110px" }}>Realizadas</th>
                    <th className={`${th} text-center`} style={{ width: "80px" }}>Desvio</th>
                    <th className={th} style={{ width: "48px" }}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map(e => (
                    <tr key={e.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className={td}>
                        <select
                          value={e.businessUnit}
                          onChange={ev => updateEntry(e.id, "businessUnit", ev.target.value)}
                          className={inputCls}
                        >
                          {bus.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </td>
                      <td className={td}>
                        <Combobox
                          value={e.project}
                          onChange={val => updateEntry(e.id, "project", val)}
                          options={projects}
                          placeholder={projects.length === 0 ? "Carregando…" : "Projeto…"}
                          className={inputCls}
                        />
                      </td>
                      <td className={`${td} text-center`}>
                        <input
                          type="number" min={0} max={40} step={1}
                          value={e.hours_forecast}
                          onChange={ev => updateEntry(e.id, "hours_forecast", ev.target.value)}
                          placeholder="0"
                          className={`${inputCls} text-center tabular-nums`}
                        />
                      </td>
                      <td className={`${td} text-center`}>
                        <input
                          type="number" min={0} max={40} step={1}
                          value={e.hours_consolidated}
                          onChange={ev => updateEntry(e.id, "hours_consolidated", ev.target.value)}
                          placeholder="—"
                          className={`${inputCls} text-center tabular-nums`}
                        />
                      </td>
                      <td className={`${td} text-center`}>
                        <Desvio forecast={e.hours_forecast} consolidated={e.hours_consolidated} />
                      </td>
                      <td className={td}>
                        <button
                          onClick={() => removeRow(e.id)}
                          className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                          title="Remover linha"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Footer: add row + totals */}
              <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                <button onClick={addRow} className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
                  + Adicionar linha
                </button>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-slate-500">Total Previsto:</span>
                  <span className={`font-semibold tabular-nums ${totalForecast > 40 ? "text-red-600" : totalForecast >= 32 ? "text-emerald-600" : "text-slate-900 dark:text-white"}`}>
                    {totalForecast}h
                  </span>
                  {totalConsolidated > 0 && (
                    <>
                      <span className="text-slate-400">|</span>
                      <span className="text-slate-500">Realizado:</span>
                      <span className="font-semibold tabular-nums">{totalConsolidated}h</span>
                      <span className="text-slate-400">|</span>
                      <span className="text-slate-500">Desvio:</span>
                      <span className={`font-semibold tabular-nums ${desvioTotal > 0 ? "text-red-500" : desvioTotal < 0 ? "text-amber-500" : "text-emerald-600"}`}>
                        {desvioTotal > 0 ? "+" : ""}{desvioTotal}h
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 mb-10">
              <button onClick={loadFromClickUpForWeek} disabled={loadingWeek} className={btnSecondary}>
                {loadingWeek ? "Carregando…" : "Carregar Semana"}
              </button>
              <button onClick={clearEntries} className={btnSecondary}>Limpar</button>
              <div className="ml-auto flex gap-3">
                <button onClick={saveForecast} disabled={saving || totalForecast === 0} className={btnPrimary}>
                  {saving ? "Salvando…" : "Salvar Previsão"}
                </button>
                <button onClick={saveConsolidated} disabled={saving || totalConsolidated === 0} className={`${btnSecondary} border-slate-900 dark:border-white font-medium`}>
                  {saving ? "Salvando…" : "Salvar Realizado"}
                </button>
              </div>
            </div>

            {/* ── Registros (collapsible) ── */}
            <div className={card}>
              <button
                onClick={() => setDbOpen(v => !v)}
                className="w-full px-5 py-3.5 flex items-center justify-between text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors rounded-xl"
              >
                <span>Registros do ClickUp <span className="text-slate-400 font-normal ml-1">({db.length})</span></span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={async e => { e.stopPropagation(); try { setLoadingWeek(true); const r = await loadLastYear(selectedYear); setDb(r); setPreviewPage(1); setDbOpen(true); showToast(`${r.length} registros.`); } catch { showToast("Erro."); } finally { setLoadingWeek(false); } }}
                    className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-700"
                    disabled={loadingWeek}
                  >
                    {loadingWeek ? "…" : "Carregar Ano"}
                  </button>
                  <span className="text-slate-400">{dbOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {dbOpen && (
                <div className="border-t border-slate-100 dark:border-slate-800">
                  {/* Filter + page size */}
                  <div className="px-5 py-3 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800">
                    <input
                      value={dbFilter}
                      onChange={e => setDbFilter(e.target.value)}
                      placeholder="Filtrar por pessoa, projeto ou CC…"
                      className={`${inputCls} max-w-xs`}
                    />
                    {dbFilter && (
                      <button onClick={() => setDbFilter("")} className="text-xs text-slate-400 hover:text-slate-700">
                        Limpar
                      </button>
                    )}
                    <span className="ml-auto text-xs text-slate-400">
                      {filteredDb.length} registro{filteredDb.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                          {[
                            { k: "ISO_Week", label: "Sem." },
                            { k: "Person", label: "Pessoa" },
                            { k: "Project", label: "Projeto" },
                            { k: "Business_Unit", label: "Centro de Custo" },
                            { k: "Hours_Forecast", label: "Previstas" },
                            { k: "Hours_Consolidated", label: "Realizadas" },
                            { k: "_desvio", label: "Desvio" },
                          ].map(col => (
                            <th key={col.k} className={th}>
                              {col.k === "_desvio" ? col.label : (
                                <button onClick={() => toggleSort(col.k)} className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
                                  {col.label}
                                  {previewSort.field === col.k && <span className="text-slate-400">{previewSort.dir === "asc" ? "↑" : "↓"}</span>}
                                </button>
                              )}
                            </th>
                          ))}
                          <th className={th}></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {pagedDb.map(r => (
                          <tr key={r.ID} className="group hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                            {editingId === r.ID ? (
                              <>
                                <td className={td}><span className="text-slate-400">W{toTwo(r.ISO_Week)}</span></td>
                                <td className={td}><Combobox value={editingValues.Person} onChange={v => changeEditing("Person", v)} options={people} placeholder="Pessoa…" className={inputCls} /></td>
                                <td className={td}><Combobox value={editingValues.Project} onChange={v => changeEditing("Project", v)} options={projects} placeholder="Projeto…" className={inputCls} /></td>
                                <td className={td}>
                                  <select className={inputCls} value={editingValues.Business_Unit} onChange={e => changeEditing("Business_Unit", e.target.value)}>
                                    {bus.map(b => <option key={b} value={b}>{b}</option>)}
                                  </select>
                                </td>
                                <td className={td}><input type="number" min={0} max={40} className={`${inputCls} text-center w-16`} value={editingValues.Hours_Forecast ?? ""} onChange={e => changeEditing("Hours_Forecast", e.target.value)} /></td>
                                <td className={td}><input type="number" min={0} max={40} className={`${inputCls} text-center w-16`} value={editingValues.Hours_Consolidated ?? ""} onChange={e => changeEditing("Hours_Consolidated", e.target.value)} /></td>
                                <td className={td}></td>
                                <td className={`${td} text-right`}>
                                  <div className="flex gap-2 justify-end">
                                    <button onClick={saveEditRow} className={btnPrimary} style={{ padding: "4px 10px" }}>Salvar</button>
                                    <button onClick={cancelEditRow} className={btnSecondary} style={{ padding: "4px 10px" }}>↩</button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className={`${td} tabular-nums text-slate-500`}>W{toTwo(r.ISO_Week)}</td>
                                <td className={`${td} font-medium`}>{r.Person}</td>
                                <td className={td}>{r.Project}</td>
                                <td className={td}>
                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                    {r.Business_Unit}
                                  </span>
                                </td>
                                <td className={`${td} text-center tabular-nums`}>{r.Hours_Forecast ?? "—"}</td>
                                <td className={`${td} text-center tabular-nums`}>
                                  {r.Hours_Consolidated != null ? r.Hours_Consolidated : <span className="text-slate-300 text-xs">—</span>}
                                </td>
                                <td className={`${td} text-center`}>
                                  {r.Hours_Consolidated != null
                                    ? <Desvio forecast={r.Hours_Forecast} consolidated={r.Hours_Consolidated} />
                                    : <span className="text-slate-300 text-xs">—</span>
                                  }
                                </td>
                                <td className={`${td} text-right`}>
                                  <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => startEditRow(r)} className={btnSecondary} style={{ padding: "3px 8px" }}>✏</button>
                                    <button onClick={() => deleteDbRow(r)} className={`${btnSecondary} hover:border-red-300 hover:text-red-500`} style={{ padding: "3px 8px" }}>×</button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                        {!pagedDb.length && (
                          <tr>
                            <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                              {db.length === 0
                                ? 'Nenhum registro. Use "Carregar Semana" ou "Carregar Ano".'
                                : "Nenhum resultado para o filtro."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-xs text-slate-400">Página {currentPage} de {totalPages}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setPreviewPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} className={btnSecondary} style={{ padding: "4px 10px" }}>←</button>
                        <button onClick={() => setPreviewPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className={btnSecondary} style={{ padding: "4px 10px" }}>→</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {view === "dashboard" && <Dashboard db={db} />}
        {view === "directory" && <Directory onListsChanged={loadLists} />}
      </main>

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium px-4 py-3 rounded-xl shadow-lg">
            {toast}
          </div>
        </div>
      )}

      {/* ── Help modal ── */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHelpOpen(false)} />
          <div className={`relative w-full max-w-sm ${card} p-6 shadow-xl`}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-base">Atalhos de teclado</h2>
              <button onClick={() => setHelpOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">×</button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ["Shift + 1", "Timesheet"],
                ["Shift + 2", "Dashboard"],
                ["Shift + 3", "Cadastros"],
                ["?  ou  Ctrl+K", "Esta ajuda"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <code className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">{k}</code>
                  <span className="text-slate-500">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom nav — mobile only ── */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-slate-900 border-t border-slate-700 flex">
        {TAB.map(t => (
          <button key={t.k} onClick={() => setView(t.k)}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs transition-colors ${
              view === t.k ? "text-white" : "text-slate-400"
            }`}>
            <span className="text-lg leading-none">{TAB_ICONS[t.k]}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
