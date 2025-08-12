import React, { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "./lib/supabase";

function Section({ title, items, onAdd, onRename, onDelete, placeholder, disabled }) {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter((x) => x.name.toLowerCase().includes(f));
  }, [items, filter]);

  return (
    <section className="p-4 bg-white rounded-2xl shadow-sm border">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-lg font-semibold">{title}</h3>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar"
          className="rounded-xl border px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-xl border px-3 py-2"
          disabled={disabled}
        />
        <button
          onClick={async () => {
            if (!name.trim()) return;
            await onAdd(name.trim());
            setName("");
          }}
          disabled={disabled || !name.trim()}
          className="rounded-xl border px-3 py-2 bg-black text-white disabled:opacity-50"
        >
          Adicionar
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="py-2 pr-2">Nome</th>
              <th className="py-2 pr-2 w-40">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => (
              <Row
                key={it.id || it.name}
                item={it}
                onRename={onRename}
                onDelete={onDelete}
                disabled={disabled}
              />
            ))}
            {!filtered.length && (
              <tr>
                <td className="py-4 text-sm text-gray-500" colSpan={2}>Sem itens.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ item, onRename, onDelete, disabled }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.name);
  return (
    <tr className="border-t">
      <td className="py-2 pr-2">
        {editing ? (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded-xl border px-2 py-1 w-full"
            disabled={disabled}
          />
        ) : (
          <span>{item.name}</span>
        )}
      </td>
      <td className="py-2 pr-2">
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={async () => {
                  const n = value.trim();
                  if (n && n !== item.name) await onRename(item, n);
                  setEditing(false);
                }}
                disabled={disabled || !value.trim()}
                className="rounded-lg border px-2 py-1 hover:bg-gray-100"
                title="Salvar"
              >
                💾
              </button>
              <button
                onClick={() => {
                  setValue(item.name);
                  setEditing(false);
                }}
                className="rounded-lg border px-2 py-1 hover:bg-gray-100"
                title="Cancelar"
              >
                ↩️
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                disabled={disabled}
                className="rounded-lg border px-2 py-1 hover:bg-gray-100"
                title="Renomear"
              >
                ✏️
              </button>
              <button
                onClick={async () => { await onDelete(item); }}
                disabled={disabled}
                className="rounded-lg border px-2 py-1 hover:bg-gray-100"
                title="Excluir"
              >
                🗑️
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Directory({ onListsChanged }) {
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [bus, setBus] = useState([]);
  const [toast, setToast] = useState("");

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }

  async function loadAll() {
    if (!supabase) return;
    setLoading(true);
    try {
      const [{ data: p, error: ep }, { data: pr, error: epr }, { data: b, error: eb }] = await Promise.all([
        supabase.from("people").select("id, name").order("name", { ascending: true }),
        supabase.from("projects").select("id, name").order("name", { ascending: true }),
        supabase.from("business_units").select("id, name").order("name", { ascending: true }),
      ]);
      if (ep) throw ep; if (epr) throw epr; if (eb) throw eb;
      setPeople((p || []).map((x) => ({ id: x.id, name: x.name })));
      setProjects((pr || []).map((x) => ({ id: x.id, name: x.name })));
      setBus((b || []).map((x) => ({ id: x.id, name: x.name })));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(e);
      showToast("Falha ao carregar cadastros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (isSupabaseConfigured) loadAll(); }, []);

  async function addItem(table, name) {
    const { data, error } = await supabase.from(table).insert({ name }).select("id, name").single();
    if (error) throw error;
    return data;
  }
  async function renameItem(table, id, name) {
    const { data, error } = await supabase.from(table).update({ name }).eq("id", id).select("id, name").single();
    if (error) throw error;
    return data;
  }
  async function deleteItem(table, id) {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
  }

  const disabled = !isSupabaseConfigured || loading;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      {!isSupabaseConfigured && (
        <div className="mb-4 p-3 rounded-xl border bg-yellow-50 text-yellow-800 text-sm">
          Configure o Supabase em `.env.local` para habilitar os cadastros.
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Section
          title="Pessoas"
          items={people}
          placeholder="Nome da pessoa"
          disabled={disabled}
          onAdd={async (name) => {
            try {
              const d = await addItem("people", name);
              setPeople((prev) => [...prev, { id: d.id, name: d.name }].sort((a,b)=>a.name.localeCompare(b.name)));
              onListsChanged?.();
              showToast("Pessoa adicionada.");
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn(e); showToast("Falha ao adicionar.");
            }
          }}
          onRename={async (item, name) => {
            try {
              const d = await renameItem("people", item.id, name);
              setPeople((prev) => prev.map((x) => (x.id === item.id ? { id: d.id, name: d.name } : x)).sort((a,b)=>a.name.localeCompare(b.name)));
              onListsChanged?.();
              showToast("Pessoa renomeada.");
            } catch (e) { console.warn(e); showToast("Falha ao renomear."); }
          }}
          onDelete={async (item) => {
            try {
              await deleteItem("people", item.id);
              setPeople((prev) => prev.filter((x) => x.id !== item.id));
              onListsChanged?.();
              showToast("Pessoa excluída.");
            } catch (e) { console.warn(e); showToast("Falha ao excluir."); }
          }}
        />

        <Section
          title="Projetos"
          items={projects}
          placeholder="Nome do projeto"
          disabled={disabled}
          onAdd={async (name) => {
            try {
              const d = await addItem("projects", name);
              setProjects((prev) => [...prev, { id: d.id, name: d.name }].sort((a,b)=>a.name.localeCompare(b.name)));
              onListsChanged?.();
              showToast("Projeto adicionado.");
            } catch (e) { console.warn(e); showToast("Falha ao adicionar."); }
          }}
          onRename={async (item, name) => {
            try {
              const d = await renameItem("projects", item.id, name);
              setProjects((prev) => prev.map((x) => (x.id === item.id ? { id: d.id, name: d.name } : x)).sort((a,b)=>a.name.localeCompare(b.name)));
              onListsChanged?.();
              showToast("Projeto renomeado.");
            } catch (e) { console.warn(e); showToast("Falha ao renomear."); }
          }}
          onDelete={async (item) => {
            try {
              await deleteItem("projects", item.id);
              setProjects((prev) => prev.filter((x) => x.id !== item.id));
              onListsChanged?.();
              showToast("Projeto excluído.");
            } catch (e) { console.warn(e); showToast("Falha ao excluir."); }
          }}
        />

        <Section
          title="Unidades de Negócio"
          items={bus}
          placeholder="Nome da BU"
          disabled={disabled}
          onAdd={async (name) => {
            try {
              const d = await addItem("business_units", name);
              setBus((prev) => [...prev, { id: d.id, name: d.name }].sort((a,b)=>a.name.localeCompare(b.name)));
              onListsChanged?.();
              showToast("BU adicionada.");
            } catch (e) { console.warn(e); showToast("Falha ao adicionar."); }
          }}
          onRename={async (item, name) => {
            try {
              const d = await renameItem("business_units", item.id, name);
              setBus((prev) => prev.map((x) => (x.id === item.id ? { id: d.id, name: d.name } : x)).sort((a,b)=>a.name.localeCompare(b.name)));
              onListsChanged?.();
              showToast("BU renomeada.");
            } catch (e) { console.warn(e); showToast("Falha ao renomear."); }
          }}
          onDelete={async (item) => {
            try {
              await deleteItem("business_units", item.id);
              setBus((prev) => prev.filter((x) => x.id !== item.id));
              onListsChanged?.();
              showToast("BU excluída.");
            } catch (e) { console.warn(e); showToast("Falha ao excluir."); }
          }}
        />
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black text-white px-4 py-2 rounded-xl shadow-lg">{toast}</div>
      )}
    </main>
  );
}


