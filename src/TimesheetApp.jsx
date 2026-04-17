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

  function select(opt) { setQuery(opt); onChange(opt); setOpen(false); }

  function handleBlur(e) {
    if (listRef.current?.contains(e.relatedTarget)) return;
    const match = options.find(o => o.toLowerCase() === query.trim().toLowerCase());
    if (match) { onChange(match); setQuery(match); }
    else { setQuery(value ?? ""); }
    setOpen(false);
  }

  const dropStyle = useMemo(() => {
    if (!rect) return {};
    const spaceBelow = window.innerHeight - rect.bottom;
    const maxH = 208;
    const top = spaceBelow >= maxH + 8 ? rect.bottom + 4 : rect.top - Math.min(maxH, filtered.length * 44) - 4;
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
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
      />
      {open && filtered.length > 0 && rect && (
        <ul
          ref={listRef}
          style={dropStyle}
          className="max-h-52 overflow-y-auto rounded-2xl border border-black/[0.08] dark:border-white/[0.1] bg-white/95 dark:bg-[#2C2C2E]/95 backdrop-blur-xl shadow-2xl text-[15px]"
        >
          {filtered.map(opt => (
            <li
              key={opt}
              tabIndex={-1}
              onMouseDown={e => { e.preventDefault(); select(opt); }}
              onTouchEnd={e => { e.preventDefault(); select(opt); }}
              className={`px-4 py-3 cursor-pointer border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 active:bg-[#F2F2F7] dark:active:bg-[#3A3A3C] ${opt === value ? "font-semibold text-[#007AFF] dark:text-[#0A84FF]" : "text-black dark:text-white"}`}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─── WeekStatus badge ─────────────────────────────────────────────────────────
function WeekStatus({ entries }) {
  const hasForecast = entries.some(e => Number(e.hours_forecast) > 0);
  const hasConsolidated = entries.some(e => Number(e.hours_consolidated) > 0);
  if (hasConsolidated) return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1 rounded-full bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20">
      ● Consolidado
    </span>
  );
  if (hasForecast) return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1 rounded-full bg-[#FF9500]/10 text-[#FF9500] border border-[#FF9500]/20">
      ◑ Previsão
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-[#8E8E93] border border-black/[0.06] dark:border-white/[0.08]">
      ○ Sem lançamento
    </span>
  );
}

// ─── Desvio badge ─────────────────────────────────────────────────────────────
function Desvio({ forecast, consolidated }) {
  if (consolidated == null || consolidated === "") return <span className="text-[#8E8E93]">—</span>;
  const d = Number(consolidated) - Number(forecast);
  if (d === 0) return <span className="text-[#34C759] font-semibold tabular-nums">0h</span>;
  if (d > 0)   return <span className="text-[#FF3B30] dark:text-[#FF453A] font-semibold tabular-nums">+{d}h</span>;
  return              <span className="text-[#FF9500] dark:text-[#FF9F0A] font-semibold tabular-nums">{d}h</span>;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TimesheetApp() {
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const bus = DEFAULT_BUS;

  const today = new Date();
  const persisted = typeof window !== "undefined"
    ? safeJsonParse(localStorage.getItem(PERSIST_KEY) || "{}", {})
    : {};

  const [selectedYear, setSelectedYear]   = useState(Number(persisted.selectedYear) || today.getFullYear());
  const [selectedWeek, setSelectedWeek]   = useState(Number(persisted.selectedWeek) || getISOWeek(today));
  const [person, setPerson]               = useState(persisted.person || "");
  const { start, end } = useMemo(() => weekStartEnd(selectedYear, selectedWeek), [selectedYear, selectedWeek]);

  const blankEntry = () => ({ id: uid(), project: "", businessUnit: bus[0] || "", hours_forecast: "", hours_consolidated: "" });
  const [entries, setEntries] = useState(() =>
    Array.isArray(persisted.entries) && persisted.entries.length ? persisted.entries : [blankEntry()]
  );
  const [db, setDb]                         = useState([]);
  const [dbFilter, setDbFilter]             = useState("");
  const [dbOpen, setDbOpen]                 = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [loadingWeek, setLoadingWeek]       = useState(false);
  const [previewSort, setPreviewSort]       = useState({ field: "ISO_Week", dir: "desc" });
  const [previewPage, setPreviewPage]       = useState(1);
  const [previewPageSize]                   = useState(15);
  const [editingId, setEditingId]           = useState(null);
  const [editingValues, setEditingValues]   = useState(null);
  const [view, setView]                     = useState(persisted.view === "directory" ? "timesheet" : (persisted.view || "timesheet"));
  const [theme, setTheme]                   = useState(() => {
    if (typeof window === "undefined") return "light";
    const s = persisted.theme || localStorage.getItem("theme");
    if (s === "dark" || s === "light") return s;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [toast, setToast]       = useState("");
  const toastRef                = useRef(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tokenInput, setTokenInput]     = useState(() => localStorage.getItem('cu:token') || '');
  const [showToken, setShowToken]       = useState(false);
  const hasToken = !!(localStorage.getItem('cu:token') || import.meta.env.VITE_CLICKUP_TOKEN);

  function saveSettings() {
    const t = tokenInput.trim();
    if (t) localStorage.setItem('cu:token', t);
    else localStorage.removeItem('cu:token');
    setSettingsOpen(false);
    showToast('Configurações salvas.');
    loadLists();
  }

  const blankPlanRow   = () => ({ id: uid(), businessUnit: bus[0] || "", project: "", hours_forecast: "" });
  const blankPlanGroup = () => ({ id: uid(), person: "", rows: [blankPlanRow()] });
  const [planGroups, setPlanGroups] = useState(() => {
    const saved = safeJsonParse(localStorage.getItem("ts:plan:v1") || "null", null);
    return Array.isArray(saved) && saved.length ? saved : [blankPlanGroup()];
  });

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
    try { localStorage.setItem("ts:plan:v1", JSON.stringify(planGroups)); } catch {}
  }, [planGroups]);

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setHelpOpen(v => !v); }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setHelpOpen(v => !v); }
      if (e.shiftKey) {
        if (e.key === "1") { e.preventDefault(); setView("timesheet"); }
        if (e.key === "2") { e.preventDefault(); setView("planning"); }
        if (e.key === "3") { e.preventDefault(); setView("dashboard"); }
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

  const totalForecast     = useMemo(() => entries.reduce((s, e) => s + (Number(e.hours_forecast) || 0), 0), [entries]);
  const totalConsolidated = useMemo(() => entries.reduce((s, e) => s + (Number(e.hours_consolidated) || 0), 0), [entries]);
  const desvioTotal       = totalConsolidated - totalForecast;

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

  function addRow()       { setEntries(p => [...p, blankEntry()]); }
  function removeRow(id)  {
    setEntries(p => {
      if (p.length === 1) return p;
      if (!window.confirm("Remover esta linha?")) return p;
      return p.filter(e => e.id !== id);
    });
  }
  function clearEntries() { setEntries([blankEntry()]); }

  // ─── Planning (multi-person) ──────────────────────────────────────────────
  function addPlanGroup() { setPlanGroups(p => [...p, blankPlanGroup()]); }
  function removePlanGroup(gid) { setPlanGroups(p => p.filter(g => g.id !== gid)); }
  function setPlanPerson(gid, person) { setPlanGroups(p => p.map(g => g.id === gid ? { ...g, person } : g)); }
  function addPlanRow(gid) { setPlanGroups(p => p.map(g => g.id === gid ? { ...g, rows: [...g.rows, blankPlanRow()] } : g)); }
  function removePlanRow(gid, rid) { setPlanGroups(p => p.map(g => g.id === gid ? { ...g, rows: g.rows.filter(r => r.id !== rid) } : g)); }
  function updatePlanRow(gid, rid, field, value) {
    setPlanGroups(prev => prev.map(g => {
      if (g.id !== gid) return g;
      return {
        ...g,
        rows: g.rows.map(r => {
          if (r.id !== rid) return r;
          if (field === "hours_forecast") {
            if (value === "") return { ...r, hours_forecast: "" };
            let n = parseInt(value, 10);
            if (isNaN(n)) n = 0;
            n = Math.max(0, Math.min(40, n));
            const otherTotal = g.rows.filter(pr => pr.id !== rid).reduce((s, pr) => s + (Number(pr.hours_forecast) || 0), 0);
            if (otherTotal + n > 40) { n = Math.max(0, 40 - otherTotal); showToast(`Cap 40h atingido${g.person ? ` — ${g.person}` : ""}.`); }
            return { ...r, hours_forecast: n };
          }
          return { ...r, [field]: value };
        }),
      };
    }));
  }

  async function savePlan() {
    const rows = planGroups.flatMap(g =>
      g.rows
        .filter(r => g.person && r.project && Number(r.hours_forecast) > 0)
        .map(r => ({
          Year: selectedYear, ISO_Week: selectedWeek,
          Person: g.person, Project: r.project, Business_Unit: r.businessUnit,
          Hours_Forecast: Number(r.hours_forecast), Hours_Consolidated: null,
        }))
    );
    if (!rows.length) { showToast("Preencha pessoa, projeto e horas em pelo menos uma linha."); return; }
    try {
      setSaving(true);
      await upsertForecast(rows);
      showToast(`Planejamento salvo — ${rows.length} linha${rows.length > 1 ? "s" : ""}.`);
    } catch (e) { console.warn(e); showToast("Erro ao salvar planejamento."); }
    finally { setSaving(false); }
  }

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

  async function save() {
    if (!person) { showToast("Selecione a pessoa."); return; }
    const rows = buildCuRows();
    if (!rows.length) { showToast("Nenhum dado para salvar."); return; }
    try {
      setSaving(true);
      const forecastRows     = rows.filter(r => r.Hours_Forecast != null);
      const consolidatedRows = rows.filter(r => r.Hours_Consolidated != null);
      if (forecastRows.length)     await upsertForecast(forecastRows);
      if (consolidatedRows.length) await upsertConsolidated(consolidatedRows);
      showToast(`Salvo (${rows.length} linha${rows.length > 1 ? "s" : ""}).`);
      loadFromClickUp();
    } catch (e) { console.warn(e); showToast("Erro ao salvar."); }
    finally { setSaving(false); }
  }

  async function loadFromClickUp() {
    if (!person) { showToast("Selecione a pessoa primeiro."); return; }
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
      showToast(`${rows.length} registro${rows.length !== 1 ? "s" : ""} carregado${rows.length !== 1 ? "s" : ""}.`);
    } catch (e) { console.warn(e); showToast("Erro ao carregar."); }
    finally { setLoadingWeek(false); }
  }

  async function loadYear() {
    try {
      setLoadingWeek(true);
      const r = await loadLastYear(selectedYear);
      setDb(r); setPreviewPage(1); setDbOpen(true);
      showToast(`${r.length} registros.`);
    } catch { showToast("Erro ao carregar ano."); }
    finally { setLoadingWeek(false); }
  }

  async function deleteDbRow(row) {
    try { await cuDeleteRow(row); setDb(p => p.filter(r => r.ID !== row.ID)); showToast("Removido."); }
    catch (e) { console.warn(e); showToast("Erro ao remover."); }
  }

  function startEditRow(row)   { setEditingId(row.ID); setEditingValues({ ...row }); }
  function cancelEditRow()     { setEditingId(null); setEditingValues(null); }
  function changeEditing(f, v) { setEditingValues(p => ({ ...p, [f]: v })); }

  async function saveEditRow() {
    if (!editingId || !editingValues) return;
    try {
      setSaving(true);
      await upsertForecast([{ ...editingValues, Hours_Forecast: Number(editingValues.Hours_Forecast) || null }]);
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

  const totalPages  = Math.max(1, Math.ceil(sortedDb.length / previewPageSize));
  const currentPage = Math.min(previewPage, totalPages);
  const pagedDb     = useMemo(() => sortedDb.slice((currentPage - 1) * previewPageSize, currentPage * previewPageSize), [sortedDb, currentPage, previewPageSize]);

  function toggleSort(f) {
    setPreviewSort(p => p.field === f ? { field: f, dir: p.dir === "asc" ? "desc" : "asc" } : { field: f, dir: "asc" });
  }

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(db.length ? db : []), "Registros");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(people.map(p => ({ Pessoa: p }))), "Pessoas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(projects.map(p => ({ Projeto: p }))), "Projetos");
    XLSX.writeFile(wb, `Timesheet_${selectedYear}_${format(new Date(), "yyyyMMdd")}.xlsx`);
  }

  // ─── Apple design tokens ──────────────────────────────────────────────────
  const bg        = "min-h-screen bg-[#F2F2F7] dark:bg-black text-black dark:text-white";
  const card      = "bg-white dark:bg-[#1C1C1E] rounded-2xl";
  const inputCls  = "rounded-[10px] border border-black/[0.08] dark:border-white/[0.1] bg-[#F2F2F7] dark:bg-[#2C2C2E] px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF] dark:focus:ring-[#0A84FF] w-full";
  const btnBlue   = "w-full flex items-center justify-center py-[14px] rounded-[14px] bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[17px] font-semibold disabled:opacity-40 transition-opacity active:opacity-70";
  const btnGhost  = "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#007AFF] dark:text-[#0A84FF] text-[15px] font-medium disabled:opacity-40 transition-colors hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]";
  const th        = "px-4 py-2.5 text-left text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide whitespace-nowrap";
  const td        = "px-4 py-3";
  const sep       = "divide-y divide-black/[0.06] dark:divide-white/[0.06]";

  const TABS = [
    { k: "timesheet", label: "Lançar",       icon: "⏱" },
    { k: "planning",  label: "Planejamento", icon: "📅" },
    { k: "dashboard", label: "Visão Geral",  icon: "📊" },
  ];

  return (
    <div className={bg}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 backdrop-blur-2xl bg-white/80 dark:bg-black/80 border-b border-black/[0.08] dark:border-white/[0.08]">
        <div className="max-w-3xl mx-auto px-4 h-12 flex items-center gap-3">
          <span className="font-semibold text-[17px] tracking-tight shrink-0">SAL Timesheet</span>

          {/* Segmented control — desktop */}
          <div className="hidden sm:flex mx-auto bg-[#E5E5EA] dark:bg-[#3A3A3C] rounded-[9px] p-[2px] gap-[2px]">
            {TABS.map(t => (
              <button key={t.k} onClick={() => setView(t.k)}
                className={`px-5 py-[5px] rounded-[7px] text-[13px] font-medium transition-all duration-150 ${
                  view === t.k
                    ? "bg-white dark:bg-[#636366] text-black dark:text-white shadow-sm"
                    : "text-[#8E8E93] hover:text-black dark:hover:text-white"
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="ml-auto sm:ml-0 flex items-center gap-0.5">
            <button onClick={exportExcel}
              className="hidden sm:flex items-center px-3 py-1.5 rounded-[8px] text-[13px] text-[#007AFF] dark:text-[#0A84FF] font-medium hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition-colors">
              Excel
            </button>
            <button onClick={() => setSettingsOpen(true)}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors text-[15px] ${!hasToken ? "text-[#FF9500]" : "text-[#8E8E93] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]"}`}
              title="Configurações">
              ⚙
            </button>
            <button onClick={() => setHelpOpen(v => !v)}
              className="w-9 h-9 flex items-center justify-center rounded-full text-[#8E8E93] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition-colors text-[15px]">
              ?
            </button>
            <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
              className="w-9 h-9 flex items-center justify-center rounded-full text-[#8E8E93] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition-colors text-[15px]">
              {theme === "dark" ? "☀" : "◑"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-32 sm:pb-12">

        {!hasToken && (
          <button onClick={() => setSettingsOpen(true)}
            className="w-full mb-5 px-4 py-3 rounded-2xl bg-[#FF9500]/10 border border-[#FF9500]/25 text-left flex items-center gap-3 hover:bg-[#FF9500]/15 transition-colors">
            <span className="text-[22px] leading-none shrink-0">⚠️</span>
            <div>
              <div className="text-[15px] font-semibold text-[#FF9500]">Token ClickUp não configurado</div>
              <div className="text-[13px] text-[#FF9500]/80">Toque para configurar →</div>
            </div>
          </button>
        )}

        {/* ══════════════════════════════════════════
            LANÇAR  (jornada do colaborador)
        ══════════════════════════════════════════ */}
        {view === "timesheet" && (
          <>
            {/* Person + Week — iOS grouped card */}
            <div className={`${card} overflow-hidden mb-5`}>
              <div className={sep}>
                {/* Pessoa */}
                <div className="px-4 py-3 flex items-center gap-3 min-h-[52px]">
                  <span className="text-[15px] text-[#8E8E93] w-28 shrink-0">Colaborador</span>
                  <div className="flex-1">
                    <Combobox
                      value={person}
                      onChange={setPerson}
                      options={people}
                      placeholder={people.length === 0 ? "Carregando…" : "Selecionar…"}
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Semana */}
                <div className="px-4 py-3 flex items-center gap-3 min-h-[60px]">
                  <span className="text-[15px] text-[#8E8E93] w-28 shrink-0">Semana</span>
                  <div className="flex items-center gap-3 flex-1">
                    <button onClick={prevWeek}
                      className="w-9 h-9 flex items-center justify-center rounded-full bg-[#F2F2F7] dark:bg-[#3A3A3C] text-[#007AFF] dark:text-[#0A84FF] text-[22px] leading-none font-light shrink-0">
                      ‹
                    </button>
                    <div className="flex-1 text-center">
                      <div className="text-[15px] font-semibold">
                        Semana {toTwo(selectedWeek)}
                        <span className="text-[#8E8E93] font-normal ml-2">{selectedYear}</span>
                      </div>
                      <div className="text-[12px] text-[#8E8E93] mt-0.5">
                        {format(start, "dd/MM")} – {format(end, "dd/MM")}
                      </div>
                    </div>
                    <button onClick={nextWeek}
                      className="w-9 h-9 flex items-center justify-center rounded-full bg-[#F2F2F7] dark:bg-[#3A3A3C] text-[#007AFF] dark:text-[#0A84FF] text-[22px] leading-none font-light shrink-0">
                      ›
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Status + Carregar */}
            <div className="flex items-center justify-between mb-5 px-1">
              <WeekStatus entries={entries} />
              <button onClick={loadFromClickUp} disabled={loadingWeek || !person} className={btnGhost + " text-[13px] py-1.5"}>
                {loadingWeek ? "Carregando…" : "Carregar semana"}
              </button>
            </div>

            {/* Entry table */}
            <div className={`${card} overflow-x-auto mb-4`}>
              <div className="px-4 pt-4 pb-2">
                <span className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">Lançamentos</span>
              </div>
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06] bg-[#F9F9F9] dark:bg-[#2C2C2E]/40">
                    <th className={th}>Centro de Custo</th>
                    <th className={th}>Projeto</th>
                    <th className={`${th} text-center`} style={{ width: "90px" }}>Previstas</th>
                    <th className={`${th} text-center`} style={{ width: "90px" }}>Realizadas</th>
                    <th className={`${th} text-center`} style={{ width: "70px" }}>Desvio</th>
                    <th style={{ width: "36px" }} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  {entries.map(e => (
                    <tr key={e.id} className="group">
                      <td className={td}>
                        <select value={e.businessUnit} onChange={ev => updateEntry(e.id, "businessUnit", ev.target.value)} className={inputCls}>
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
                        <input type="number" min={0} max={40} step={1}
                          value={e.hours_forecast}
                          onChange={ev => updateEntry(e.id, "hours_forecast", ev.target.value)}
                          placeholder="0"
                          className={`${inputCls} text-center tabular-nums`} />
                      </td>
                      <td className={`${td} text-center`}>
                        <input type="number" min={0} max={40} step={1}
                          value={e.hours_consolidated}
                          onChange={ev => updateEntry(e.id, "hours_consolidated", ev.target.value)}
                          placeholder="—"
                          className={`${inputCls} text-center tabular-nums`} />
                      </td>
                      <td className={`${td} text-center`}>
                        <Desvio forecast={e.hours_forecast} consolidated={e.hours_consolidated} />
                      </td>
                      <td className="pr-3">
                        <button onClick={() => removeRow(e.id)}
                          className="w-6 h-6 flex items-center justify-center rounded-full text-[#FF3B30] dark:text-[#FF453A] opacity-0 group-hover:opacity-100 hover:bg-[#FF3B30]/10 transition-all text-[18px] leading-none">
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Table footer */}
              <div className="px-4 py-3 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between">
                <button onClick={addRow} className="text-[#007AFF] dark:text-[#0A84FF] text-[15px] font-medium">
                  + Adicionar linha
                </button>
                <div className="flex items-center gap-2 text-[13px] text-[#8E8E93]">
                  <span>
                    <span className={`font-semibold tabular-nums ${totalForecast > 40 ? "text-[#FF3B30] dark:text-[#FF453A]" : "text-black dark:text-white"}`}>
                      {totalForecast}h
                    </span>
                    {" "}prev.
                  </span>
                  {totalConsolidated > 0 && (
                    <>
                      <span className="text-black/20 dark:text-white/20">|</span>
                      <span>
                        <span className="font-semibold tabular-nums text-black dark:text-white">{totalConsolidated}h</span>
                        {" "}real.
                      </span>
                      <span className="text-black/20 dark:text-white/20">|</span>
                      <Desvio forecast={totalForecast} consolidated={totalConsolidated} />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* CTA — Salvar */}
            <button onClick={save}
              disabled={saving || (totalForecast === 0 && totalConsolidated === 0) || !person}
              className={btnBlue}>
              {saving ? "Salvando…" : "Salvar"}
            </button>

            {/* Limpar — texto destrutivo */}
            <button onClick={clearEntries}
              className="w-full mt-2 py-3 text-[15px] text-[#FF3B30] dark:text-[#FF453A] font-medium transition-opacity hover:opacity-70">
              Limpar
            </button>
          </>
        )}

        {/* ══════════════════════════════════════════
            PLANEJAMENTO  (jornada da gestora)
        ══════════════════════════════════════════ */}
        {view === "planning" && (
          <>
            {/* Week selector */}
            <div className={`${card} overflow-hidden mb-5`}>
              <div className="px-4 py-3 flex items-center gap-3 min-h-[60px]">
                <span className="text-[15px] text-[#8E8E93] w-28 shrink-0">Semana</span>
                <div className="flex items-center gap-3 flex-1">
                  <button onClick={prevWeek}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-[#F2F2F7] dark:bg-[#3A3A3C] text-[#007AFF] dark:text-[#0A84FF] text-[22px] leading-none font-light shrink-0">‹</button>
                  <div className="flex-1 text-center">
                    <div className="text-[15px] font-semibold">
                      Semana {toTwo(selectedWeek)}
                      <span className="text-[#8E8E93] font-normal ml-2">{selectedYear}</span>
                    </div>
                    <div className="text-[12px] text-[#8E8E93] mt-0.5">{format(start, "dd/MM")} – {format(end, "dd/MM")}</div>
                  </div>
                  <button onClick={nextWeek}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-[#F2F2F7] dark:bg-[#3A3A3C] text-[#007AFF] dark:text-[#0A84FF] text-[22px] leading-none font-light shrink-0">›</button>
                </div>
              </div>
            </div>

            {/* Person cards */}
            {planGroups.map(g => {
              const groupTotal = g.rows.reduce((s, r) => s + (Number(r.hours_forecast) || 0), 0);
              const isOver = groupTotal > 40;
              const isFull = groupTotal === 40;
              return (
                <div key={g.id} className={`${card} overflow-x-auto mb-3`}>
                  {/* Person header */}
                  <div className="px-4 py-3 flex items-center gap-3 border-b border-black/[0.06] dark:border-white/[0.06] bg-[#F9F9F9] dark:bg-[#2C2C2E]/50 min-w-[460px]">
                    <div className="flex-1">
                      <Combobox
                        value={g.person}
                        onChange={v => setPlanPerson(g.id, v)}
                        options={people}
                        placeholder={people.length === 0 ? "Carregando…" : "Selecionar pessoa…"}
                        className={inputCls}
                      />
                    </div>
                    {/* Cap indicator */}
                    <div className={`text-[13px] font-semibold tabular-nums shrink-0 px-2.5 py-1 rounded-full border ${
                      isOver ? "text-[#FF3B30] dark:text-[#FF453A] bg-[#FF3B30]/10 border-[#FF3B30]/20"
                      : isFull ? "text-[#34C759] bg-[#34C759]/10 border-[#34C759]/20"
                      : "text-[#8E8E93] bg-black/[0.04] dark:bg-white/[0.06] border-transparent"
                    }`}>
                      {groupTotal}/40h
                    </div>
                    {planGroups.length > 1 && (
                      <button onClick={() => removePlanGroup(g.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-[#FF3B30] dark:text-[#FF453A] hover:bg-[#FF3B30]/10 transition-colors text-[18px] leading-none shrink-0">
                        ×
                      </button>
                    )}
                  </div>

                  {/* Rows */}
                  <table className="w-full min-w-[460px]">
                    <thead>
                      <tr className="border-b border-black/[0.04] dark:border-white/[0.04]">
                        <th className={th}>Centro de Custo</th>
                        <th className={th}>Projeto</th>
                        <th className={`${th} text-center`} style={{ width: "90px" }}>Previstas</th>
                        <th style={{ width: "36px" }} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                      {g.rows.map(r => (
                        <tr key={r.id} className="group">
                          <td className={td}>
                            <select value={r.businessUnit} onChange={ev => updatePlanRow(g.id, r.id, "businessUnit", ev.target.value)} className={inputCls}>
                              {bus.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </td>
                          <td className={td}>
                            <Combobox
                              value={r.project}
                              onChange={v => updatePlanRow(g.id, r.id, "project", v)}
                              options={projects}
                              placeholder={projects.length === 0 ? "Carregando…" : "Projeto…"}
                              className={inputCls}
                            />
                          </td>
                          <td className={`${td} text-center`}>
                            <input type="number" min={0} max={40} step={1}
                              value={r.hours_forecast}
                              onChange={ev => updatePlanRow(g.id, r.id, "hours_forecast", ev.target.value)}
                              placeholder="0"
                              className={`${inputCls} text-center tabular-nums`}
                            />
                          </td>
                          <td className="pr-3">
                            <button onClick={() => removePlanRow(g.id, r.id)}
                              className="w-6 h-6 flex items-center justify-center rounded-full text-[#FF3B30] dark:text-[#FF453A] opacity-0 group-hover:opacity-100 hover:bg-[#FF3B30]/10 transition-all text-[18px] leading-none">
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Add row within group */}
                  <div className="px-4 py-2.5 border-t border-black/[0.04] dark:border-white/[0.04] min-w-[460px]">
                    <button onClick={() => addPlanRow(g.id)}
                      className="text-[#007AFF] dark:text-[#0A84FF] text-[15px] font-medium">
                      + Adicionar linha
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Add person */}
            <button onClick={addPlanGroup}
              className="w-full py-4 rounded-2xl border-2 border-dashed border-[#007AFF]/25 dark:border-[#0A84FF]/25 text-[#007AFF] dark:text-[#0A84FF] text-[15px] font-medium mb-5 hover:border-[#007AFF]/50 dark:hover:border-[#0A84FF]/50 hover:bg-[#007AFF]/[0.03] transition-all">
              + Adicionar pessoa
            </button>

            {/* Save */}
            <button onClick={savePlan} disabled={saving} className={btnBlue}>
              {saving ? "Salvando…" : "Salvar Planejamento"}
            </button>

            {/* Reset */}
            <button onClick={() => { if (window.confirm("Limpar todo o planejamento?")) setPlanGroups([blankPlanGroup()]); }}
              className="w-full mt-2 py-3 text-[15px] text-[#FF3B30] dark:text-[#FF453A] font-medium transition-opacity hover:opacity-70">
              Limpar
            </button>
          </>
        )}

        {/* ══════════════════════════════════════════
            VISÃO GERAL  (jornada do gestor)
        ══════════════════════════════════════════ */}
        {view === "dashboard" && (
          <>
            {/* Load controls */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
              <button onClick={loadFromClickUp} disabled={loadingWeek || !person} className={btnGhost}>
                {loadingWeek ? "Carregando…" : "Carregar Semana"}
              </button>
              <button onClick={loadYear} disabled={loadingWeek} className={btnGhost}>
                Carregar Ano
              </button>
              <button onClick={exportExcel} className={`${btnGhost} ml-auto`}>
                Excel
              </button>
            </div>

            {/* Dashboard charts */}
            <Dashboard db={db} />

            {/* Records */}
            <div className={`${card} mt-5`}>
              <button onClick={() => setDbOpen(v => !v)}
                className="w-full px-5 py-4 flex items-center justify-between rounded-2xl hover:bg-[#F2F2F7]/60 dark:hover:bg-[#2C2C2E]/60 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[17px]">Registros</span>
                  <span className="text-[13px] text-[#8E8E93] font-normal">{db.length}</span>
                </div>
                <span className="text-[#8E8E93] text-[13px]">{dbOpen ? "▲" : "▼"}</span>
              </button>

              {dbOpen && (
                <div className="border-t border-black/[0.06] dark:border-white/[0.06]">
                  {/* Filter bar */}
                  <div className="px-4 py-3 flex items-center gap-2 border-b border-black/[0.04] dark:border-white/[0.04]">
                    <input
                      value={dbFilter}
                      onChange={e => setDbFilter(e.target.value)}
                      placeholder="Filtrar por pessoa, projeto ou CC…"
                      className={`${inputCls} max-w-xs`}
                    />
                    {dbFilter && (
                      <button onClick={() => setDbFilter("")} className="text-[13px] text-[#8E8E93] hover:text-black dark:hover:text-white">Limpar</button>
                    )}
                    <span className="ml-auto text-[13px] text-[#8E8E93]">{filteredDb.length} registros</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px]">
                      <thead>
                        <tr className="border-b border-black/[0.06] dark:border-white/[0.06] bg-[#F9F9F9] dark:bg-[#2C2C2E]/40">
                          {[
                            { k: "ISO_Week",           label: "Sem." },
                            { k: "Person",             label: "Pessoa" },
                            { k: "Project",            label: "Projeto" },
                            { k: "Business_Unit",      label: "CC" },
                            { k: "Hours_Forecast",     label: "Prev." },
                            { k: "Hours_Consolidated", label: "Real." },
                            { k: "_desvio",            label: "Desvio" },
                          ].map(col => (
                            <th key={col.k} className={th}>
                              {col.k === "_desvio" ? col.label : (
                                <button onClick={() => toggleSort(col.k)} className="flex items-center gap-1 hover:text-black dark:hover:text-white transition-colors">
                                  {col.label}
                                  {previewSort.field === col.k && (
                                    <span className="text-[#007AFF] dark:text-[#0A84FF]">{previewSort.dir === "asc" ? "↑" : "↓"}</span>
                                  )}
                                </button>
                              )}
                            </th>
                          ))}
                          <th />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                        {pagedDb.map(r => (
                          <tr key={r.ID} className="group hover:bg-[#F2F2F7]/50 dark:hover:bg-[#2C2C2E]/50 transition-colors">
                            {editingId === r.ID ? (
                              <>
                                <td className={td}><span className="text-[#8E8E93] text-[13px] tabular-nums">W{toTwo(r.ISO_Week)}</span></td>
                                <td className={td}><Combobox value={editingValues.Person} onChange={v => changeEditing("Person", v)} options={people} placeholder="Pessoa…" className={inputCls} /></td>
                                <td className={td}><Combobox value={editingValues.Project} onChange={v => changeEditing("Project", v)} options={projects} placeholder="Projeto…" className={inputCls} /></td>
                                <td className={td}>
                                  <select className={inputCls} value={editingValues.Business_Unit} onChange={e => changeEditing("Business_Unit", e.target.value)}>
                                    {bus.map(b => <option key={b} value={b}>{b}</option>)}
                                  </select>
                                </td>
                                <td className={td}><input type="number" min={0} max={40} className={`${inputCls} w-16 text-center`} value={editingValues.Hours_Forecast ?? ""} onChange={e => changeEditing("Hours_Forecast", e.target.value)} /></td>
                                <td className={td}><input type="number" min={0} max={40} className={`${inputCls} w-16 text-center`} value={editingValues.Hours_Consolidated ?? ""} onChange={e => changeEditing("Hours_Consolidated", e.target.value)} /></td>
                                <td className={td} />
                                <td className={td}>
                                  <div className="flex gap-2">
                                    <button onClick={saveEditRow} className="px-3 py-1.5 rounded-[8px] bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[13px] font-medium">Salvar</button>
                                    <button onClick={cancelEditRow} className="px-3 py-1.5 rounded-[8px] bg-[#F2F2F7] dark:bg-[#3A3A3C] text-[13px]">↩</button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className={`${td} tabular-nums text-[#8E8E93] text-[13px]`}>W{toTwo(r.ISO_Week)}</td>
                                <td className={`${td} font-medium text-[15px]`}>{r.Person}</td>
                                <td className={`${td} text-[15px]`}>{r.Project}</td>
                                <td className={td}>
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#F2F2F7] dark:bg-[#3A3A3C] text-[#8E8E93]">
                                    {r.Business_Unit}
                                  </span>
                                </td>
                                <td className={`${td} text-center tabular-nums text-[15px]`}>{r.Hours_Forecast ?? "—"}</td>
                                <td className={`${td} text-center tabular-nums text-[15px]`}>
                                  {r.Hours_Consolidated != null ? r.Hours_Consolidated : <span className="text-[#8E8E93]">—</span>}
                                </td>
                                <td className={`${td} text-center`}>
                                  {r.Hours_Consolidated != null
                                    ? <Desvio forecast={r.Hours_Forecast} consolidated={r.Hours_Consolidated} />
                                    : <span className="text-[#8E8E93]">—</span>}
                                </td>
                                <td className={td}>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => startEditRow(r)} className="px-2 py-1 rounded-[6px] text-[#007AFF] dark:text-[#0A84FF] hover:bg-[#007AFF]/10 text-[13px] transition-colors">✏</button>
                                    <button onClick={() => deleteDbRow(r)} className="px-2 py-1 rounded-[6px] text-[#FF3B30] dark:text-[#FF453A] hover:bg-[#FF3B30]/10 text-[13px] transition-colors">×</button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                        {!pagedDb.length && (
                          <tr>
                            <td colSpan={8} className="py-12 text-center text-[15px] text-[#8E8E93]">
                              {db.length === 0 ? 'Use "Carregar Semana" ou "Carregar Ano".' : "Nenhum resultado para o filtro."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {totalPages > 1 && (
                    <div className="px-4 py-3 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between">
                      <span className="text-[13px] text-[#8E8E93]">Página {currentPage} de {totalPages}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setPreviewPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} className={`${btnGhost} py-1.5 px-3`}>←</button>
                        <button onClick={() => setPreviewPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className={`${btnGhost} py-1.5 px-3`}>→</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {view === "directory" && <Directory onListsChanged={loadLists} />}
      </main>

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-28 sm:bottom-10 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="backdrop-blur-2xl bg-black/80 dark:bg-[#F2F2F7]/90 text-white dark:text-black text-[15px] font-medium px-5 py-3 rounded-2xl shadow-2xl whitespace-nowrap">
            {toast}
          </div>
        </div>
      )}

      {/* ── Settings modal ── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSettingsOpen(false)} />
          <div className={`relative w-full sm:max-w-sm ${card} pt-6 pb-8 px-6 shadow-2xl rounded-t-3xl sm:rounded-2xl`}>
            <div className="sm:hidden w-10 h-1 rounded-full bg-[#8E8E93]/40 mx-auto mb-6" />
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-semibold text-[17px]">Configurações</h2>
              <button onClick={() => setSettingsOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-[#F2F2F7] dark:bg-[#3A3A3C] text-[#8E8E93] hover:text-black dark:hover:text-white text-[18px] leading-none">
                ×
              </button>
            </div>

            {/* Token section */}
            <div className={`${card} overflow-hidden mb-5`} style={{background: ""}}>
              <div className="px-4 pt-3 pb-1">
                <span className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">ClickUp</span>
              </div>
              <div className="px-4 pb-4">
                <label className="block text-[15px] font-medium mb-2">Token de API</label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={tokenInput}
                    onChange={e => setTokenInput(e.target.value)}
                    placeholder="pk_..."
                    className={`${
                      "rounded-[10px] border border-black/[0.08] dark:border-white/[0.1] bg-[#F2F2F7] dark:bg-[#2C2C2E] px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF] dark:focus:ring-[#0A84FF] w-full"
                    } pr-12 font-mono text-[13px]`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    onClick={() => setShowToken(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-black dark:hover:text-white text-[12px] font-medium transition-colors">
                    {showToken ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-[#8E8E93]">
                  Gere em <span className="font-medium">ClickUp → Perfil → Apps → API Token</span>. Salvo apenas neste dispositivo.
                </p>
              </div>
            </div>

            <button onClick={saveSettings}
              className="w-full flex items-center justify-center py-[14px] rounded-[14px] bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[17px] font-semibold transition-opacity active:opacity-70">
              Salvar
            </button>
          </div>
        </div>
      )}

      {/* ── Help modal — slides up from bottom on mobile ── */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHelpOpen(false)} />
          <div className={`relative w-full sm:max-w-sm ${card} pt-6 pb-8 px-6 shadow-2xl rounded-t-3xl sm:rounded-2xl`}>
            {/* Pull handle */}
            <div className="sm:hidden w-10 h-1 rounded-full bg-[#8E8E93]/40 mx-auto mb-6" />
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-[17px]">Atalhos</h2>
              <button onClick={() => setHelpOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-[#F2F2F7] dark:bg-[#3A3A3C] text-[#8E8E93] hover:text-black dark:hover:text-white text-[18px] leading-none">
                ×
              </button>
            </div>
            <div className={`${card} overflow-hidden`}>
              <div className={sep}>
                {[
                  ["Shift + 1", "Lançar"],
                  ["Shift + 2", "Planejamento"],
                  ["Shift + 3", "Visão Geral"],
                  ["?  ou  Ctrl+K", "Esta ajuda"],
                ].map(([k, v]) => (
                  <div key={k} className="px-4 py-3 flex items-center justify-between">
                    <code className="px-2 py-1 rounded-[6px] bg-[#F2F2F7] dark:bg-[#3A3A3C] font-mono text-[13px]">{k}</code>
                    <span className="text-[15px] text-[#8E8E93]">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom nav — mobile only ── */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 backdrop-blur-2xl bg-white/80 dark:bg-black/80 border-t border-black/[0.08] dark:border-white/[0.08] flex">
        {TABS.map(t => (
          <button key={t.k} onClick={() => setView(t.k)}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-colors ${
              view === t.k ? "text-[#007AFF] dark:text-[#0A84FF]" : "text-[#8E8E93]"
            }`}>
            <span className="text-[22px] leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
