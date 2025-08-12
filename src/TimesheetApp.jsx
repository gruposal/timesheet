import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./lib/supabase";
import { format, getISOWeek, startOfISOWeek, endOfISOWeek, setISOWeek, setYear } from "date-fns";
import Dashboard from "./Dashboard.jsx";
import Directory from "./Directory.jsx";

/**
 * Timesheet Web App (React, client-only)
 * - BU before Project
 * - Integer hours (0–24), Mon–Fri, 40h/week cap across all rows
 * - In-memory Database + Excel export (dynamic import of xlsx)
 * - Optional Supabase persistence
 */

// ======= Editable Lists =======
const DEFAULT_PEOPLE = [
  "Alice Silva",
  "Bruno Lima",
  "Carla Souza",
  "Diego Santos",
  "Eva Martins",
  "João Casotti",
];
const DEFAULT_PROJECTS = [
  "Google – Brand Film",
  "Waze – Cycling Campaign",
  "Nike – Vini Jr Launch",
  "Stone – Investor Day",
  "PRIO – Pegada PRIO S2",
  "Uruguai Meats – O Sabor da Fronteira",
];
const DEFAULT_BUS = ["Branding", "Comunicação", "Conteúdo", "CSC"];

// ======= Helpers =======
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_LABELS = { Mon: "Seg", Tue: "Ter", Wed: "Qua", Thu: "Qui", Fri: "Sex" };
const toTwo = (n) => String(n).padStart(2, "0");
const uid = () => Math.random().toString(36).slice(2, 10);
const PERSIST_KEY = "ts:ui:v1";
function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}
function weekStartEnd(year, isoWeek) {
  const base = setYear(new Date(), year);
  const d = setISOWeek(base, isoWeek);
  return { start: startOfISOWeek(d), end: endOfISOWeek(d) };
}
//

function mapToSupabase(row) {
  return {
    id: row.ID,
    year: row.Year,
    iso_week: row.ISO_Week,
    week_start: row.Week_Start,
    person: row.Person,
    project: row.Project,
    business_unit: row.Business_Unit,
    mon: row.Mon,
    tue: row.Tue,
    wed: row.Wed,
    thu: row.Thu,
    fri: row.Fri,
    sat: row.Sat,
    sun: row.Sun,
    notes: row.Notes,
    created_at: row.Created_At,
  };
}

function mapFromSupabase(r) {
  return {
    ID: r.id,
    Year: r.year,
    ISO_Week: r.iso_week,
    Week_Start: r.week_start,
    Person: r.person,
    Project: r.project,
    Business_Unit: r.business_unit,
    Mon: r.mon,
    Tue: r.tue,
    Wed: r.wed,
    Thu: r.thu,
    Fri: r.fri,
    Sat: r.sat,
    Sun: r.sun,
    Total: r.total,
    Notes: r.notes,
    Created_At: r.created_at,
  };
}

// ======= Pure utils (for mini tests) =======
export function sumWeek(entry) {
  return DAYS.reduce((s, d) => s + (Number(entry?.[d]) || 0), 0);
}
export function allowedAfterCap(otherRowsTotal, thisOtherDays, candidate) {
  const used = otherRowsTotal + thisOtherDays;
  const left = Math.max(0, 40 - used);
  return Math.min(left, Math.max(0, candidate));
}

// ======= Mini self-tests (non-blocking) =======
if (typeof window !== "undefined" && !window.__TIMESHEET_SELFTEST__) {
  window.__TIMESHEET_SELFTEST__ = true;
  try {
    console.assert(sumWeek({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8 }) === 40, "sumWeek basic 40h");
    console.assert(sumWeek({ Mon: "", Tue: 2, Wed: 0, Thu: 3, Fri: 1 }) === 6, "sumWeek with blanks");
    console.assert(allowedAfterCap(30, 5, 10) === 5, "cap leaves only 5h");
    console.assert(allowedAfterCap(0, 0, -2) === 0, "cap floors negatives to 0");
    console.log("[Timesheet] self-tests OK");
  } catch (e) {
    console.warn("[Timesheet] self-tests failed", e);
  }
}

export default function TimesheetApp() {
  // Lists
  const [people, setPeople] = useState(DEFAULT_PEOPLE);
  const [projects, setProjects] = useState(DEFAULT_PROJECTS);
  const [bus, setBus] = useState(DEFAULT_BUS);

  // Week + Person
  const today = new Date();
  const persisted = (typeof window !== 'undefined') ? safeJsonParse(window.localStorage.getItem(PERSIST_KEY)||"{}", {}) : {};
  const [selectedYear, setSelectedYear] = useState(Number(persisted.selectedYear) || today.getFullYear());
  const [selectedWeek, setSelectedWeek] = useState(Number(persisted.selectedWeek) || getISOWeek(today));
  const [person, setPerson] = useState(persisted.person || people[0] || "");
  const { start, end } = useMemo(() => weekStartEnd(selectedYear, selectedWeek), [selectedYear, selectedWeek]);

  // Entries & DB
  const blankEntry = () => ({ id: uid(), project: projects[0] || "", businessUnit: bus[0] || "", Mon: "", Tue: "", Wed: "", Thu: "", Fri: "", notes: "" });
  const [entries, setEntries] = useState(() => Array.isArray(persisted.entries) && persisted.entries.length ? persisted.entries : [blankEntry()]);
  const [db, setDb] = useState([]);
  const [dbFilter, setDbFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [previewSort, setPreviewSort] = useState({ field: "Created_At", dir: "desc" });
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(10);
  const [editingId, setEditingId] = useState(null);
  const [editingValues, setEditingValues] = useState(null);
  const [view, setView] = useState(persisted.view || "timesheet");
  const [density, setDensity] = useState(persisted.density || "comfortable");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    const stored = persisted.theme || window.localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") return stored;
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
  });

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-density", density === "compact" ? "compact" : "comfortable");
    }
  }, [density]);

  // Persist UI state locally
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const snapshot = {
      selectedYear,
      selectedWeek,
      person,
      entries,
      view,
      density,
      theme,
    };
    try { window.localStorage.setItem(PERSIST_KEY, JSON.stringify(snapshot)); } catch {}
  }, [selectedYear, selectedWeek, person, entries, view, density, theme]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
      try { window.localStorage.setItem('theme', theme); } catch {}
    }
  }, [theme]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'b' || e.key === 'B') { e.preventDefault(); exportExcel(false); }
        if (e.key === 'm' || e.key === 'M') { e.preventDefault(); exportExcel(true); }
        if (e.key === 'd' || e.key === 'D') { e.preventDefault(); setDensity((d)=> d==='compact'?'comfortable':'compact'); }
        if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setHelpOpen(true); }
      } else {
        if (e.key === '?') { e.preventDefault(); setHelpOpen((v)=>!v); }
        if (e.shiftKey) {
          if (e.key === '1') { e.preventDefault(); setView('timesheet'); }
          if (e.key === '2') { e.preventDefault(); setView('dashboard'); }
          if (e.key === '3') { e.preventDefault(); setView('directory'); }
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load lists from Supabase (if configured)
  async function loadLists() {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const [p, pr, bu] = await Promise.all([
        supabase.from("people").select("name").order("name", { ascending: true }),
        supabase.from("projects").select("name").order("name", { ascending: true }),
        supabase.from("business_units").select("name").order("name", { ascending: true }),
      ]);
      if (p.error) throw p.error; if (pr.error) throw pr.error; if (bu.error) throw bu.error;
      const ppl = (p.data || []).map((x) => x.name).filter(Boolean);
      const projs = (pr.data || []).map((x) => x.name).filter(Boolean);
      const busList = (bu.data || []).map((x) => x.name).filter(Boolean);
      if (ppl.length) setPeople(ppl);
      if (projs.length) setProjects(projs);
      if (busList.length) setBus(busList);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Falha ao carregar listas do Supabase", e);
    }
  }
  useEffect(() => { loadLists(); }, []);

  // Ensure selected person stays valid when list updates
  useEffect(() => {
    if (!people.includes(person)) {
      setPerson(people[0] || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  // Demo data generator (client-only)
  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rndInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)] || ""; }
  function distributeWeek(rng, total) {
    const days = [0, 0, 0, 0, 0]; let rest = total;
    for (let i = 0; i < 5; i += 1) {
      const cap = Math.min(10, rest);
      const today = i === 4 ? rest : rndInt(rng, 0, cap);
      days[i] = today; rest -= today;
    }
    let idx = 0; while (rest > 0) { if (days[idx] < 10) { days[idx] += 1; rest -= 1; } idx = (idx + 1) % 5; }
    return { Mon: days[0], Tue: days[1], Wed: days[2], Thu: days[3], Fri: days[4] };
  }
  function generateDemoData(weeksCount = 52) {
    const baseMonday = startOfISOWeek(new Date());
    const rows = [];
    for (const p of people) {
      for (let w = 0; w < weeksCount; w += 1) {
        const d = new Date(baseMonday.valueOf()); d.setDate(d.getDate() - w * 7);
        const year = d.getFullYear();
        const isoWeek = getISOWeek(d);
        const weekStartStr = format(startOfISOWeek(d), "yyyy-MM-dd");
        const seed = Math.abs((p + year + "-" + isoWeek).split("").reduce((a, c) => a + c.charCodeAt(0), 0));
        const rng = mulberry32(seed);
        const lines = rndInt(rng, 1, 3);
        let remaining = rndInt(rng, 32, 40);
        for (let i = 0; i < lines; i += 1) {
          const left = lines - i; const share = i === lines - 1 ? remaining : Math.max(0, Math.min(remaining, Math.floor(remaining / left) + rndInt(rng, -2, 2)));
          remaining -= share;
          const dist = distributeWeek(rng, share);
          const total = dist.Mon + dist.Tue + dist.Wed + dist.Thu + dist.Fri;
          if (!total) continue;
          rows.push({
            ID: `${year}-${toTwo(isoWeek)}-${p}-${i + 1}`,
            Year: year,
            ISO_Week: isoWeek,
            Week_Start: weekStartStr,
            Person: p,
            Project: pick(rng, projects),
            Business_Unit: pick(rng, bus),
            Mon: dist.Mon, Tue: dist.Tue, Wed: dist.Wed, Thu: dist.Thu, Fri: dist.Fri,
            Sat: 0, Sun: 0,
            Total: total,
            Notes: rng() < 0.08 ? "ajuste de planejamento" : "",
            Created_At: new Date().toISOString(),
          });
        }
      }
    }
    setDb(rows);
    setPreviewPage(1);
    setToastMsg(`${rows.length} linha(s) de dados demo gerada(s).`);
  }

  // Toast
  const [toast, setToast] = useState("");
  const toastRef = useRef(null);
  const [helpOpen, setHelpOpen] = useState(false);
  function setToastMsg(msg) {
    if (!toastRef.current) toastRef.current = { t: null };
    setToast(msg);
    if (toastRef.current.t) clearTimeout(toastRef.current.t);
    toastRef.current.t = setTimeout(() => setToast(""), 2400);
  }

  //

  // Totals & Guards
  const totalWeekHours = useMemo(() => entries.reduce((acc, e) => acc + DAYS.reduce((s, d) => s + (Number(e[d]) || 0), 0), 0), [entries]);
  const dayTotals = useMemo(() => {
    const totals = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 };
    for (const e of entries) {
      for (const d of DAYS) totals[d] += Number(e[d]) || 0;
    }
    return totals;
  }, [entries]);

  function entryTotal(entry) {
    return DAYS.reduce((sum, day) => sum + (Number(entry?.[day]) || 0), 0);
  }

  function updateEntry(id, field, value) {
    setEntries((prev) => prev.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e };
      if (DAYS.includes(field)) {
        if (value === "") { next[field] = ""; return next; }
        let numeric = parseInt(String(value), 10); if (isNaN(numeric)) numeric = 0;
        numeric = Math.max(0, Math.min(24, numeric));
        const otherRowsTotal = prev.filter((r) => r.id !== id)
          .reduce((acc, r) => acc + DAYS.reduce((s, d) => s + (Number(r[d]) || 0), 0), 0);
        const thisOtherDays = DAYS.filter((d) => d !== field).reduce((s, d) => s + (Number(next[d]) || 0), 0);
        const proposed = otherRowsTotal + thisOtherDays + numeric;
        if (proposed > 40) {
          const allowed = Math.max(0, 40 - (otherRowsTotal + thisOtherDays));
          next[field] = allowed; setToastMsg("Limite semanal de 40h atingido.");
        } else { next[field] = numeric; }
      } else { next[field] = value; }
      return next;
    }));
  }

  function addRow() { setEntries((p) => [...p, blankEntry()]); }
  function removeRow(id) {
    setEntries((p) => {
      if (p.length === 1) return p;
      const entry = p.find((e) => e.id === id);
      const label = entry ? `${entry.businessUnit || ''} / ${entry.project || ''}` : '';
      // graceful confirm only if available
      const ok = typeof window !== 'undefined' ? window.confirm(`Remover esta linha?\n${label}`) : true;
      if (!ok) return p;
      return p.filter((e) => e.id !== id);
    });
  }
  function duplicateRow(id) {
    setEntries((prev) => {
      const found = prev.find((e) => e.id === id);
      if (!found) return prev;
      const copy = { ...found, id: uid() };
      return [...prev, copy];
    });
  }
  function clearEntries() { setEntries([blankEntry()]); }

  async function appendToDatabase() {
    if (!person) { setToastMsg("Selecione a pessoa antes de salvar."); return; }
    const createdAt = new Date().toISOString();
    const weekStartStr = format(start, "yyyy-MM-dd");
    const isoWeek = selectedWeek; const year = selectedYear;

    const rows = [];
    entries.forEach((e, idx) => {
      const mon = Number(e.Mon) || 0; const tue = Number(e.Tue) || 0; const wed = Number(e.Wed) || 0; const thu = Number(e.Thu) || 0; const fri = Number(e.Fri) || 0;
      const total = mon + tue + wed + thu + fri;
      if (total > 0) {
        rows.push({
          ID: `${year}-${toTwo(isoWeek)}-${person}-${idx + 1}`,
          Year: year, ISO_Week: isoWeek, Week_Start: weekStartStr, Person: person,
          Project: e.project, Business_Unit: e.businessUnit,
          Mon: mon, Tue: tue, Wed: wed, Thu: thu, Fri: fri, Sat: 0, Sun: 0,
          Total: total, Notes: e.notes || "", Created_At: createdAt,
        });
      }
    });
    setDb((prev) => [...prev, ...rows]);

    // Persistir no Supabase (opcional)
    if (supabase && rows.length) {
      try {
        setSaving(true);
        const payload = rows.map(mapToSupabase);
        // usar upsert para evitar erro de chave duplicada pelo mesmo ID
        const { error } = await supabase
          .from("timesheet_entries")
          .upsert(payload, { onConflict: "id" });
        if (error) throw error;
        setToastMsg(`${rows.length} registro(s) salvo(s) no Supabase.`);
      } catch (e) {
        console.warn(e);
        setToastMsg("Falha ao salvar no Supabase (veja console).");
      } finally { setSaving(false); }
    } else {
      setToastMsg(`${rows.length} registro(s) adicionado(s) à base.`);
    }
  }

  async function loadFromSupabaseForWeek() {
    if (!supabase) { setToastMsg("Supabase não configurado."); return; }
    try {
      setLoadingWeek(true);
      const { data, error } = await supabase
        .from("timesheet_entries")
        .select("*")
        .eq("year", selectedYear)
        .eq("iso_week", selectedWeek)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data || []).map(mapFromSupabase);
      setDb(rows);
      setPreviewPage(1);
      setToastMsg(`Carregado(s) ${rows.length} registro(s) do Supabase.`);
    } catch (e) {
      console.warn(e);
      setToastMsg("Falha ao carregar do Supabase (veja console).");
    } finally { setLoadingWeek(false); }
  }

  async function deleteDbRow(rowId) {
    try {
      if (supabase) {
        const { error } = await supabase.from("timesheet_entries").delete().eq("id", rowId);
        if (error) throw error;
      }
      setDb((prev) => prev.filter((r) => r.ID !== rowId));
      setToastMsg("Registro removido.");
    } catch (e) {
      console.warn(e);
      setToastMsg("Falha ao remover (veja console).");
    }
  }

  function toggleSort(field) {
    setPreviewSort((prev) => {
      if (prev.field === field) {
        return { field, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { field, dir: "asc" };
    });
  }

  function startEditRow(row) {
    setEditingId(row.ID);
    setEditingValues({ ...row });
  }
  function cancelEditRow() {
    setEditingId(null);
    setEditingValues(null);
  }
  function changeEditing(field, value) {
    setEditingValues((prev) => ({ ...prev, [field]: value }));
  }
  async function saveEditRow() {
    if (!editingId || !editingValues) return;
    try {
      if (supabase) {
        const payload = mapToSupabase({ ...editingValues, Created_At: editingValues.Created_At });
        // garantir inteiros nas horas
        ["mon","tue","wed","thu","fri","sat","sun"].forEach((d)=>{
          if (typeof payload[d] !== "undefined") payload[d] = Number(payload[d]) || 0;
        });
        const { error } = await supabase
          .from("timesheet_entries")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      }
      setDb((prev) => prev.map((r) => (r.ID === editingId ? { ...editingValues } : r)));
      setToastMsg("Registro atualizado.");
      cancelEditRow();
    } catch (e) {
      console.warn(e);
      setToastMsg("Falha ao atualizar (veja console).");
    }
  }

  const filteredDb = useMemo(() => {
    if (!dbFilter) return db;
    const f = dbFilter.toLowerCase();
    return db.filter((r) =>
      String(r.Person).toLowerCase().includes(f) ||
      String(r.Project).toLowerCase().includes(f) ||
      String(r.Business_Unit).toLowerCase().includes(f) ||
      String(r.ID).toLowerCase().includes(f)
    );
  }, [db, dbFilter]);

  const sortedDb = useMemo(() => {
    const arr = [...filteredDb];
    const { field, dir } = previewSort;
    const cmp = (a, b) => {
      const va = a?.[field];
      const vb = b?.[field];
      if (va == null && vb == null) return 0;
      if (va == null) return -1;
      if (vb == null) return 1;
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return String(va).localeCompare(String(vb));
    };
    arr.sort((a, b) => (dir === "asc" ? cmp(a, b) : -cmp(a, b)));
    return arr;
  }, [filteredDb, previewSort]);

  const totalPages = Math.max(1, Math.ceil(sortedDb.length / previewPageSize));
  const currentPage = Math.min(previewPage, totalPages);
  const pagedDb = useMemo(() => {
    const startIdx = (currentPage - 1) * previewPageSize;
    return sortedDb.slice(startIdx, startIdx + previewPageSize);
  }, [sortedDb, currentPage, previewPageSize]);

  async function exportExcel(withCurrentAsTemplate = false) {
    const XLSX = await import("xlsx");
    const sheets = {};
    if (withCurrentAsTemplate) {
      const rows = entries.map((e, idx) => {
        const mon = Number(e.Mon) || 0, tue = Number(e.Tue) || 0, wed = Number(e.Wed) || 0, thu = Number(e.Thu) || 0, fri = Number(e.Fri) || 0;
        const total = mon + tue + wed + thu + fri;
        return { ID: `${selectedYear}-${toTwo(selectedWeek)}-${person}-${idx+1}`, Year: selectedYear, ISO_Week: selectedWeek, Week_Start: format(start, "yyyy-MM-dd"), Person: person, Project: e.project, Business_Unit: e.businessUnit, Mon: mon, Tue: tue, Wed: wed, Thu: thu, Fri: fri, Sat: 0, Sun: 0, Total: total, Notes: e.notes || "", Created_At: new Date().toISOString() };
      });
      sheets["Database"] = rows.length ? rows : [{ ID: "", Year: selectedYear, ISO_Week: selectedWeek, Week_Start: format(start, "yyyy-MM-dd"), Person: person || "", Project: "", Business_Unit: "", Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0, Total: 0, Notes: "", Created_At: new Date().toISOString() }];
    } else {
      sheets["Database"] = db.length ? db : [{ ID: "", Year: selectedYear, ISO_Week: selectedWeek, Week_Start: format(start, "yyyy-MM-dd"), Person: "", Project: "", Business_Unit: "", Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0, Total: 0, Notes: "", Created_At: new Date().toISOString() }];
    }
    sheets["People"] = people.map((p) => ({ Person: p }));
    sheets["Projects"] = projects.map((p) => ({ Project: p }));
    sheets["BusinessUnits"] = bus.map((b) => ({ Business_Unit: b }));

    const XLSXwb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, rows]) => {
      const ws = XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(XLSXwb, ws, name);
    });
    const fname = withCurrentAsTemplate ? `Timesheet_Template_${selectedYear}-W${toTwo(selectedWeek)}.xlsx` : `Timesheet_Database_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`;
    XLSX.writeFile(XLSXwb, fname);
  }

  //

  return (
    <div className="min-h-screen animate-fade-in" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="flex min-h-screen">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex md:w-64 md:flex-col glass border-r">
          <div className="h-16 px-6 flex items-center gap-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              T
            </div>
            <div className="font-semibold text-lg truncate" style={{ color: 'var(--text-primary)' }}>Timesheet</div>
          </div>
          <nav className="p-4 space-y-2">
            {[
              {k:'timesheet', label:'Timesheet', icon:'📝', gradient:'from-blue-500 to-blue-600'},
              {k:'dashboard', label:'Dashboard', icon:'📊', gradient:'from-purple-500 to-purple-600'},
              {k:'directory', label:'Cadastros', icon:'👥', gradient:'from-green-500 to-green-600'}
            ].map(it => (
              <button 
                key={it.k} 
                onClick={() => { setView(it.k); }} 
                aria-current={view===it.k ? 'page' : undefined} 
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 group ${
                  view === it.k 
                    ? 'btn-primary shadow-lg transform scale-105' 
                    : 'btn-secondary hover:scale-105'
                }`}
              >
                <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${it.gradient} flex items-center justify-center text-xs ${view === it.k ? 'text-white' : 'opacity-70'}`}>
                  {it.icon}
                </div>
                <span className="font-medium">{it.label}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto p-4 border-t space-y-3" style={{ borderColor: 'var(--border-light)' }}>
            <button
              onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
              className="w-full btn btn-secondary"
              title="Alternar densidade de componentes"
            >
              <span className="text-sm">{density === 'compact' ? '🧘' : '🧱'}</span>
              <span>{density === 'compact' ? 'Conforto' : 'Compacto'}</span>
            </button>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="w-full btn btn-secondary"
              title="Alternar tema"
            >
              <span className="text-sm">{theme === 'dark' ? '🌙' : '☀️'}</span>
              <span>{theme === 'dark' ? 'Escuro' : 'Claro'}</span>
            </button>
          </div>
        </aside>

        {/* Content area */}
        <div className="flex-1 flex flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-20 glass border-b" style={{ borderColor: 'var(--border-light)' }}>
            <div className="px-6 h-16 flex items-center justify-between gap-4 relative">
              <div className="flex items-center gap-4 min-w-0">
                <button 
                  className="md:hidden btn btn-secondary" 
                  onClick={() => setMobileNavOpen(true)} 
                  aria-label="Abrir menu"
                >
                  <span className="text-lg">☰</span>
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-gradient-to-r from-green-400 to-green-500 animate-pulse"></div>
                  <h1 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {view === 'timesheet' ? 'Timesheet – Horas Semanais' : 
                     view === 'dashboard' ? 'Dashboard' : 'Cadastros'}
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                <button 
                  onClick={() => exportExcel(false)} 
                  className="btn btn-secondary" 
                  title="Baixar Excel da Base"
                >
                  <span>📊</span>
                  <span>Base</span>
                </button>
                <button 
                  onClick={() => exportExcel(true)} 
                  className="btn btn-secondary" 
                  title="Baixar Modelo Pré‑preenchido"
                >
                  <span>⬇️</span>
                  <span>Modelo</span>
                </button>
                {isSupabaseConfigured ? (
                  <>
                    <button 
                      onClick={loadFromSupabaseForWeek} 
                      className="btn btn-secondary" 
                      title="Carregar registros da semana do Supabase" 
                      disabled={loadingWeek}
                    >
                      <span>{loadingWeek ? "⏳" : "🔄"}</span>
                      <span>{loadingWeek ? "Carregando…" : "Carregar Semana"}</span>
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          if (!supabase) { setToastMsg("Supabase não configurado."); return; }
                          setLoadingWeek(true);
                          const { data, error } = await supabase
                            .from("timesheet_entries")
                            .select("*")
                            .gte("created_at", new Date(Date.now() - 365*24*60*60*1000).toISOString())
                            .order("created_at", { ascending: false })
                            .limit(2000);
                          if (error) throw error;
                          const rows = (data || []).map(mapFromSupabase);
                          setDb(rows);
                          setPreviewPage(1);
                          setToastMsg(`Carregado(s) ${rows.length} registro(s) do último ano.`);
                        } catch (e) {
                          console.warn(e);
                          setToastMsg("Falha ao carregar ano (veja console).");
                        } finally { setLoadingWeek(false); }
                      }}
                      className="btn btn-secondary"
                      title="Carregar registros do último ano"
                      disabled={loadingWeek}
                    >
                      <span>{loadingWeek ? "⏳" : "📅"}</span>
                      <span>{loadingWeek ? "Carregando…" : "Carregar Ano"}</span>
                    </button>
                    <button 
                      onClick={() => generateDemoData(52)} 
                      className="btn btn-secondary" 
                      title="Gerar dados locais de demonstração (1 ano)"
                    >
                      <span>✨</span>
                      <span>Gerar Demo</span>
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="status-error px-3 py-2 rounded-lg text-xs font-medium" title="Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local e reinicie o servidor">
                      Supabase não configurado
                    </div>
                    <button 
                      onClick={() => generateDemoData(52)} 
                      className="btn btn-secondary" 
                      title="Gerar dados locais de demonstração (1 ano)"
                    >
                      <span>✨</span>
                      <span>Gerar Demo</span>
                    </button>
                  </div>
                )}
              </div>
              {loadingWeek && (<div className="absolute -bottom-px left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-black/50 to-transparent dark:via-white/60 animate-pulse" />)}
            </div>
          </header>

          {/* Mobile nav drawer */}
          {mobileNavOpen && (
            <div className="md:hidden fixed inset-0 z-40">
              <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
              <div className="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-[#0f172a] border-r p-3">
                <div className="h-10 mb-2 flex items-center justify-between">
                  <div className="font-semibold">Menu</div>
                  <button className="rounded-lg border px-2 py-1" onClick={() => setMobileNavOpen(false)} aria-label="Fechar menu">✕</button>
                </div>
                <nav className="space-y-1">
                  {[{k:'timesheet', label:'Timesheet', icon:'🧾'},{k:'dashboard', label:'Dashboard', icon:'📊'},{k:'directory', label:'Cadastros', icon:'📚'}].map(it => (
                    <button key={it.k} onClick={() => { setView(it.k); setMobileNavOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left ${view===it.k ? 'bg-black text-white dark:bg-white dark:text-black' : 'hover:bg-gray-100 dark:hover:bg-white/10'}`}>
                      <span>{it.icon}</span>
                      <span>{it.label}</span>
                    </button>
                  ))}
                </nav>
                <div className="mt-4 space-y-2">
                  <button onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')} className="w-full rounded-xl border px-3 py-2">{density==='compact'?'🧘 Conforto':'🧱 Compacto'}</button>
                  <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="w-full rounded-xl border px-3 py-2">{theme==='dark'?'🌙 Escuro':'☀️ Claro'}</button>
                </div>
              </div>
            </div>
          )}

          {/* Content */}
          {view === 'timesheet' ? (
            <div className="max-w-7xl mx-auto px-6 py-8 animate-fade-in">
              {/* Controls */}
              <section className="grid gap-6 md:grid-cols-3 mb-8">
                <div className="card p-6 animate-scale-in">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <span className="text-white text-sm">👤</span>
                    </div>
                    <label className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Pessoa</label>
                  </div>
                  <select 
                    value={person} 
                    onChange={(e) => setPerson(e.target.value)} 
                    className="input focus-ring"
                  >
                    {people.map((p) => (<option key={p} value={p}>{p}</option>))}
                  </select>
                </div>
                
                <div className="card p-6 animate-scale-in" style={{ animationDelay: '0.1s' }}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                      <span className="text-white text-sm">📅</span>
                    </div>
                    <label className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Período</label>
                  </div>
                  <div className="space-y-3">
                    <select 
                      value={selectedYear} 
                      onChange={(e) => setSelectedYear(Number(e.target.value))} 
                      className="input focus-ring"
                    >
                      {Array.from({ length: 6 }, (_, i) => selectedYear - 2 + i).map((y) => (<option key={y} value={y}>{y}</option>))}
                    </select>
                    <select 
                      value={selectedWeek} 
                      onChange={(e) => setSelectedWeek(Number(e.target.value))} 
                      className="input focus-ring"
                    >
                      {Array.from({ length: 53 }, (_, i) => i + 1).map((w) => (<option key={w} value={w}>Semana {toTwo(w)}</option>))}
                    </select>
                  </div>
                </div>
                
                <div className="card p-6 flex flex-col justify-between animate-scale-in" style={{ animationDelay: '0.2s' }}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                      <span className="text-white text-sm">📊</span>
                    </div>
                    <label className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Resumo</label>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>Período da Semana</div>
                      <div className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
                        {format(start, "dd/MM")} – {format(end, "dd/MM/yyyy")}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>Total de Horas</div>
                      <div className={`font-bold text-2xl tabular-nums ${totalWeekHours > 40 ? 'status-error' : totalWeekHours >= 35 ? 'status-success' : 'status-warning'} px-3 py-2 rounded-lg`}>
                        {totalWeekHours}h <span className="text-sm font-normal opacity-70">/ 40h</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Entries */}
              <section className="card p-6 animate-scale-in" style={{ animationDelay: '0.3s' }}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
                      <span className="text-white text-sm">📝</span>
                    </div>
                    <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Lançamentos</h2>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={addRow} 
                      className="btn btn-secondary"
                      title="Adicionar nova linha de lançamento"
                    >
                      <span>＋</span>
                      <span>Adicionar Linha</span>
                    </button>
                    <button 
                      onClick={clearEntries} 
                      className="btn btn-secondary" 
                      title="Limpar todas as linhas de lançamentos"
                    >
                      <span>🧹</span>
                      <span>Limpar</span>
                    </button>
                    <button 
                      onClick={appendToDatabase} 
                      className="btn btn-primary" 
                      disabled={!person || totalWeekHours > 40 || saving} 
                      title={totalWeekHours > 40 ? "Reduza para 40h" : "Salvar entradas da semana na base"}
                    >
                      <span>{saving ? "⏳" : "⤴️"}</span>
                      <span>{saving ? "Salvando…" : "Adicionar à Base"}</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Unidade de Negócio</th>
                        <th>Projeto</th>
                        {DAYS.map((d) => (<th key={d} className="text-center min-w-[80px]">{DAY_LABELS[d]}</th>))}
                        <th className="text-center">Total</th>
                        <th>Notas</th>
                        <th className="text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e, index) => (
                        <tr key={e.id} className="group animate-slide-in-right" style={{ animationDelay: `${index * 0.05}s` }}>
                          <td className="min-w-[180px]">
                            <select 
                              value={e.businessUnit} 
                              onChange={(ev) => updateEntry(e.id, "businessUnit", ev.target.value)} 
                              className="input focus-ring"
                            >
                              {bus.map((b) => (<option key={b} value={b}>{b}</option>))}
                            </select>
                          </td>
                          <td className="min-w-[250px]">
                            <select 
                              value={e.project} 
                              onChange={(ev) => updateEntry(e.id, "project", ev.target.value)} 
                              className="input focus-ring"
                            >
                              {projects.map((p) => (<option key={p} value={p}>{p}</option>))}
                            </select>
                          </td>
                          {DAYS.map((d) => (
                            <td key={d} className="text-center">
                              <input
                                type="number"
                                min={0}
                                max={24}
                                step={1}
                                value={e[d]}
                                onChange={(ev) => updateEntry(e.id, d, ev.target.value)}
                                onKeyDown={(ev) => {
                                  if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
                                  const selector = `input[data-day="${d}"]`;
                                  const inputs = Array.from((ev.currentTarget.closest('table') || document).querySelectorAll(selector));
                                  const idx = inputs.indexOf(ev.currentTarget);
                                  if (idx === -1) return;
                                  if (ev.key === 'ArrowUp' && idx > 0) {
                                    ev.preventDefault();
                                    const el = inputs[idx - 1];
                                    if (el && typeof el.focus === 'function') el.focus();
                                  }
                                  if (ev.key === 'ArrowDown' && idx < inputs.length - 1) {
                                    ev.preventDefault();
                                    const el = inputs[idx + 1];
                                    if (el && typeof el.focus === 'function') el.focus();
                                  }
                                }}
                                data-day={d}
                                className="w-20 input focus-ring text-center tabular-nums"
                                placeholder="0"
                              />
                            </td>
                          ))}
                          <td className="text-center">
                            <div className={`font-bold text-lg tabular-nums px-3 py-2 rounded-lg ${
                              entryTotal(e) > 10 ? 'status-warning' : 
                              entryTotal(e) > 0 ? 'status-success' : 
                              'status-info'
                            }`}>
                              {entryTotal(e)}h
                            </div>
                          </td>
                          <td className="min-w-[220px]">
                            <input 
                              type="text" 
                              value={e.notes} 
                              onChange={(ev) => updateEntry(e.id, "notes", ev.target.value)} 
                              placeholder="Notas opcionais..." 
                              className="input focus-ring" 
                            />
                          </td>
                          <td>
                            <div className="flex gap-2 justify-center">
                              <button 
                                onClick={() => duplicateRow(e.id)} 
                                className="btn btn-secondary" 
                                title="Duplicar linha"
                              >
                                📄
                              </button>
                              <button 
                                onClick={() => removeRow(e.id)} 
                                className="btn btn-secondary" 
                                title="Remover linha"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {/* Daily totals summary */}
                  <div className="mt-6 p-4 glass rounded-xl">
                    <div className="grid grid-cols-[2fr_repeat(5,1fr)_1fr_2fr] gap-4 items-center">
                      <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Totais por dia</div>
                      {DAYS.map((d) => (
                        <div key={d} className="text-center">
                          <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{DAY_LABELS[d]}</div>
                          <div className={`font-bold text-lg tabular-nums px-2 py-1 rounded-lg ${
                            dayTotals[d] > 10 ? 'status-warning' : 
                            dayTotals[d] > 0 ? 'status-success' : 
                            'status-info'
                          }`}>
                            {dayTotals[d]}h
                          </div>
                        </div>
                      ))}
                      <div className="text-center">
                        <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Total</div>
                        <div className={`font-bold text-xl tabular-nums px-3 py-2 rounded-lg ${
                          totalWeekHours > 40 ? 'status-error' : 
                          totalWeekHours >= 35 ? 'status-success' : 
                          'status-warning'
                        }`}>
                          {totalWeekHours}h
                        </div>
                      </div>
                      <div></div>
                    </div>
                  </div>
                </div>

              </section>

              {/* Database Preview */}
              <section className="mt-8 card p-6 animate-scale-in" style={{ animationDelay: '0.4s' }}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                      <span className="text-white text-sm">💾</span>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Prévia da Base de Dados
                      </h2>
                      <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                        {db.length} registro{db.length !== 1 ? 's' : ''} {filteredDb.length !== db.length && `(${filteredDb.length} filtrados)`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input 
                      value={dbFilter} 
                      onChange={(e) => setDbFilter(e.target.value)} 
                      placeholder="Filtrar registros..." 
                      className="input focus-ring min-w-[200px]" 
                    />
                    <select 
                      value={previewPageSize} 
                      onChange={(e) => {setPreviewPageSize(Number(e.target.value)); setPreviewPage(1);}} 
                      className="input focus-ring"
                    >
                      {[10,20,50].map((n) => (<option key={n} value={n}>{n} por página</option>))}
                    </select>
                    <button 
                      onClick={() => setDb([])} 
                      className="btn btn-secondary" 
                      title="Limpar prévia local (não afeta Supabase)"
                    >
                      <span>🧹</span>
                      <span>Limpar</span>
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="table text-sm">
                    <thead>
                      <tr>
                        {[
                          {k:"ID", label:"ID"},
                          {k:"Year", label:"Ano"},
                          {k:"ISO_Week", label:"Semana"},
                          {k:"Week_Start", label:"Início"},
                          {k:"Person", label:"Pessoa"},
                          {k:"Project", label:"Projeto"},
                          {k:"Business_Unit", label:"BU"},
                          {k:"Mon", label:"Seg"},
                          {k:"Tue", label:"Ter"},
                          {k:"Wed", label:"Qua"},
                          {k:"Thu", label:"Qui"},
                          {k:"Fri", label:"Sex"},
                          {k:"Total", label:"Total"},
                          {k:"Notes", label:"Notas"},
                          {k:"Created_At", label:"Criado"},
                        ].map((col) => (
                          <th key={col.k} className="whitespace-nowrap">
                            <button 
                              onClick={() => toggleSort(col.k)} 
                              className="btn btn-secondary text-xs font-semibold"
                              title={`Ordenar por ${col.label}`}
                            >
                              <span>{col.label}</span>
                              {previewSort.field === col.k && (
                                <span>{previewSort.dir === 'asc' ? '▲' : '▼'}</span>
                              )}
                            </button>
                          </th>
                        ))}
                        <th className="text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedDb.map((r, index) => (
                        <tr key={r.ID} className="group animate-slide-in-right" style={{ animationDelay: `${index * 0.02}s` }}>
                          {editingId === r.ID ? (
                            <>
                              <td className="whitespace-nowrap opacity-60">{r.ID}</td>
                              <td className="whitespace-nowrap">{r.Year}</td>
                              <td className="whitespace-nowrap">{r.ISO_Week}</td>
                              <td className="whitespace-nowrap">{r.Week_Start}</td>
                              <td className="whitespace-nowrap">
                                <input className="input focus-ring" value={editingValues.Person} onChange={(e) => changeEditing('Person', e.target.value)} />
                              </td>
                              <td className="whitespace-nowrap">
                                <input className="input focus-ring" value={editingValues.Project} onChange={(e) => changeEditing('Project', e.target.value)} />
                              </td>
                              <td className="whitespace-nowrap">
                                <input className="input focus-ring" value={editingValues.Business_Unit} onChange={(e) => changeEditing('Business_Unit', e.target.value)} />
                              </td>
                              {['Mon','Tue','Wed','Thu','Fri'].map((d) => (
                                <td key={d} className="whitespace-nowrap text-center">
                                  <input 
                                    type="number" 
                                    min={0} 
                                    max={24} 
                                    step={1} 
                                    className="w-16 input focus-ring text-center tabular-nums" 
                                    value={editingValues[d]} 
                                    onChange={(e) => changeEditing(d, e.target.value)} 
                                  />
                                </td>
                              ))}
                              <td className="whitespace-nowrap text-center">
                                <div className="font-bold tabular-nums status-info px-2 py-1 rounded-lg">
                                  {Number(editingValues.Mon||0)+Number(editingValues.Tue||0)+Number(editingValues.Wed||0)+Number(editingValues.Thu||0)+Number(editingValues.Fri||0)}h
                                </div>
                              </td>
                              <td className="whitespace-nowrap">
                                <input className="input focus-ring" value={editingValues.Notes} onChange={(e) => changeEditing('Notes', e.target.value)} />
                              </td>
                              <td className="whitespace-nowrap opacity-60 text-xs">{new Date(r.Created_At).toLocaleDateString()}</td>
                              <td className="whitespace-nowrap text-center">
                                <div className="flex gap-2 justify-center">
                                  <button onClick={saveEditRow} className="btn btn-secondary" title="Salvar alterações">💾</button>
                                  <button onClick={cancelEditRow} className="btn btn-secondary" title="Cancelar edição">↩️</button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="whitespace-nowrap font-mono text-xs">{r.ID}</td>
                              <td className="whitespace-nowrap tabular-nums">{r.Year}</td>
                              <td className="whitespace-nowrap tabular-nums">W{String(r.ISO_Week).padStart(2, '0')}</td>
                              <td className="whitespace-nowrap text-xs">{new Date(r.Week_Start).toLocaleDateString()}</td>
                              <td className="whitespace-nowrap font-medium">{r.Person}</td>
                              <td className="whitespace-nowrap">{r.Project}</td>
                              <td className="whitespace-nowrap text-xs">{r.Business_Unit}</td>
                              <td className="whitespace-nowrap text-center tabular-nums">{r.Mon}</td>
                              <td className="whitespace-nowrap text-center tabular-nums">{r.Tue}</td>
                              <td className="whitespace-nowrap text-center tabular-nums">{r.Wed}</td>
                              <td className="whitespace-nowrap text-center tabular-nums">{r.Thu}</td>
                              <td className="whitespace-nowrap text-center tabular-nums">{r.Fri}</td>
                              <td className="whitespace-nowrap text-center">
                                <div className={`font-bold tabular-nums px-2 py-1 rounded-lg ${
                                  r.Total > 40 ? 'status-error' : 
                                  r.Total >= 35 ? 'status-success' : 
                                  'status-warning'
                                }`}>
                                  {r.Total}h
                                </div>
                              </td>
                              <td className="whitespace-nowrap text-xs max-w-[150px] truncate">{r.Notes}</td>
                              <td className="whitespace-nowrap text-xs opacity-60">{new Date(r.Created_At).toLocaleDateString()}</td>
                              <td className="whitespace-nowrap text-center">
                                <div className="flex gap-2 justify-center">
                                  <button onClick={() => startEditRow(r)} className="btn btn-secondary" title="Editar registro">✏️</button>
                                  <button onClick={() => deleteDbRow(r.ID)} className="btn btn-secondary" title="Remover registro">🗑️</button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                      {!pagedDb.length && (
                        <tr>
                          <td colSpan="16" className="py-12 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                                <span className="text-2xl opacity-50">📊</span>
                              </div>
                              <div>
                                <div className="font-medium" style={{ color: 'var(--text-secondary)' }}>Nenhum registro encontrado</div>
                                <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                                  {db.length === 0 ? 'Adicione lançamentos para ver os dados aqui' : 'Tente ajustar os filtros'}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                
                {/* Pagination */}
                <div className="flex items-center justify-between mt-6">
                  <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                    Mostrando {pagedDb.length} de {filteredDb.length} registros
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setPreviewPage((p) => Math.max(1, p-1))} 
                      disabled={currentPage <= 1} 
                      className="btn btn-secondary"
                    >
                      <span>←</span>
                      <span>Anterior</span>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Página {currentPage} de {totalPages}
                      </span>
                    </div>
                    <button 
                      onClick={() => setPreviewPage((p) => Math.min(totalPages, p+1))} 
                      disabled={currentPage >= totalPages} 
                      className="btn btn-secondary"
                    >
                      <span>Próxima</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : view === 'dashboard' ? (
            <Dashboard db={db} />
          ) : (
            <Directory onListsChanged={loadLists} />
          )}

          <footer className="max-w-7xl mx-auto px-6 py-12 text-center">
            <div className="glass px-6 py-4 rounded-xl inline-block">
              <div className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                <span className="inline-flex items-center gap-2">
                  <span>⚡</span>
                  <span>Client‑side</span>
                </span>
                <span className="mx-2">•</span>
                <span className="inline-flex items-center gap-2">
                  <span>📊</span>
                  <span>Excel export</span>
                </span>
                <span className="mx-2">•</span>
                <span className="inline-flex items-center gap-2">
                  <span>☁️</span>
                  <span>Optional Supabase</span>
                </span>
              </div>
            </div>
          </footer>
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-scale-in">
          <div className="glass px-4 py-3 rounded-xl shadow-xl max-w-sm">
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{toast}</div>
          </div>
        </div>
      )}
      
      {/* Help modal */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHelpOpen(false)} />
          <div className="relative max-w-lg w-[92%] card p-6 animate-scale-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <span className="text-white text-sm">❓</span>
                </div>
                <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Ajuda Rápida</div>
              </div>
              <button 
                className="btn btn-secondary" 
                onClick={() => setHelpOpen(false)}
                title="Fechar ajuda"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Atalhos de Teclado</div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-3">
                    <code className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">Shift+1 / 2 / 3</code>
                    <span style={{ color: 'var(--text-tertiary)' }}>Alternar entre views</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <code className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">Ctrl+B</code>
                    <span style={{ color: 'var(--text-tertiary)' }}>Exportar base</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <code className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">Ctrl+M</code>
                    <span style={{ color: 'var(--text-tertiary)' }}>Exportar modelo</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <code className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">Ctrl+D</code>
                    <span style={{ color: 'var(--text-tertiary)' }}>Alternar densidade</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <code className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">?</code>
                    <span style={{ color: 'var(--text-tertiary)' }}>Abrir esta ajuda</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
