import React, { useEffect, useState } from "react";
import { people as cuPeople, projects as cuProjects } from "./lib/clickup/lists.js";

function Section({ title, items, loading, onAdd, onRename, onDelete }) {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");

  const filtered = filter
    ? items.filter(x => x.name.toLowerCase().includes(filter.toLowerCase()))
    : items;

  const inputCls = "rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 w-full";
  const btnPrimary = "px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-700 dark:hover:bg-slate-200 disabled:opacity-40 transition-colors whitespace-nowrap";
  const btnSecondary = "px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors";

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="text-xs text-slate-400">{items.length} {items.length === 1 ? "item" : "itens"}</span>
      </div>

      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={async e => { if (e.key === "Enter" && name.trim()) { await onAdd(name.trim()); setName(""); } }}
          placeholder="Novo item…"
          className={inputCls}
          disabled={loading}
        />
        <button
          onClick={async () => { if (!name.trim()) return; await onAdd(name.trim()); setName(""); }}
          disabled={loading || !name.trim()}
          className={btnPrimary}
        >
          Adicionar
        </button>
      </div>

      {items.length > 5 && (
        <div className="px-5 py-2 border-b border-slate-100 dark:border-slate-800">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filtrar…"
            className={inputCls}
          />
        </div>
      )}

      <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
        {filtered.map(item => (
          <Row key={item.id} item={item} loading={loading} onRename={onRename} onDelete={onDelete} />
        ))}
        {!filtered.length && (
          <li className="px-5 py-6 text-sm text-slate-400 text-center">Sem itens.</li>
        )}
      </ul>
    </div>
  );
}

function Row({ item, loading, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.name);

  const btnSecondary = "px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors";
  const inputCls = "rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 flex-1";

  return (
    <li className="group px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
      {editing ? (
        <>
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={async e => {
              if (e.key === "Enter") { await onRename(item, value.trim()); setEditing(false); }
              if (e.key === "Escape") { setValue(item.name); setEditing(false); }
            }}
            autoFocus
            className={inputCls}
            disabled={loading}
          />
          <button onClick={async () => { if (value.trim()) await onRename(item, value.trim()); setEditing(false); }} className={btnSecondary} disabled={loading}>✓</button>
          <button onClick={() => { setValue(item.name); setEditing(false); }} className={btnSecondary}>↩</button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm">{item.name}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => setEditing(true)} className={btnSecondary} disabled={loading} title="Renomear">✏</button>
            <button onClick={() => onDelete(item)} className={`${btnSecondary} hover:border-red-300 hover:text-red-500`} disabled={loading} title="Excluir">×</button>
          </div>
        </>
      )}
    </li>
  );
}

export default function Directory({ onListsChanged }) {
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [toast, setToast] = useState("");

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 2000); }

  async function loadAll() {
    setLoading(true);
    try {
      const [ppl, projs] = await Promise.all([cuPeople.loadAll(), cuProjects.loadAll()]);
      setPeople(ppl);
      setProjects(projs);
    } catch (e) { console.warn(e); showToast("Erro ao carregar cadastros."); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); }, []);

  const handleAdd = (list, setList, api) => async (name) => {
    try {
      setLoading(true);
      const item = await api.add(name);
      setList(p => [...p, item].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      onListsChanged?.();
      showToast("Adicionado.");
    } catch (e) { console.warn(e); showToast("Erro ao adicionar."); }
    finally { setLoading(false); }
  };

  const handleRename = (list, setList, api) => async (item, name) => {
    try {
      setLoading(true);
      await api.rename(item.id, name);
      setList(p => p.map(x => x.id === item.id ? { ...x, name } : x).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      onListsChanged?.();
      showToast("Renomeado.");
    } catch (e) { console.warn(e); showToast("Erro ao renomear."); }
    finally { setLoading(false); }
  };

  const handleDelete = (setList, api) => async (item) => {
    if (!window.confirm(`Excluir "${item.name}"?`)) return;
    try {
      setLoading(true);
      await api.remove(item.id);
      setList(p => p.filter(x => x.id !== item.id));
      onListsChanged?.();
      showToast("Excluído.");
    } catch (e) { console.warn(e); showToast("Erro ao excluir."); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-base">Cadastros</h2>
        <button
          onClick={loadAll}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
        >
          {loading ? "Carregando…" : "Atualizar"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section
          title="Colaboradores"
          items={people}
          loading={loading}
          onAdd={handleAdd(people, setPeople, cuPeople)}
          onRename={handleRename(people, setPeople, cuPeople)}
          onDelete={handleDelete(setPeople, cuPeople)}
        />
        <Section
          title="Projetos"
          items={projects}
          loading={loading}
          onAdd={handleAdd(projects, setProjects, cuProjects)}
          onRename={handleRename(projects, setProjects, cuProjects)}
          onDelete={handleDelete(setProjects, cuProjects)}
        />
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium px-4 py-3 rounded-xl shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
