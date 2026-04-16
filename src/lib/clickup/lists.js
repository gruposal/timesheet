import { cuFetch } from './client.js';
import { LIST_PEOPLE, LIST_PROJECTS } from './fields.js';

async function loadList(listId) {
  const rows = [];
  let page = 0;
  while (true) {
    const data = await cuFetch(`/list/${listId}/task?page=${page}&limit=100&include_closed=true`);
    rows.push(...(data.tasks || []).map(t => ({ id: t.id, name: t.name })));
    if (data.last_page || (data.tasks || []).length === 0) break;
    page++;
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function addItem(listId, name) {
  const task = await cuFetch(`/list/${listId}/task`, {
    method: 'POST',
    body: { name },
  });
  return { id: task.id, name: task.name };
}

async function renameItem(taskId, name) {
  await cuFetch(`/task/${taskId}`, {
    method: 'PUT',
    body: { name },
  });
}

async function deleteItem(taskId) {
  await cuFetch(`/task/${taskId}`, { method: 'DELETE' });
}

export const people = {
  loadAll: () => loadList(LIST_PEOPLE),
  add: name => addItem(LIST_PEOPLE, name),
  rename: (id, name) => renameItem(id, name),
  remove: id => deleteItem(id),
};

export const projects = {
  loadAll: () => loadList(LIST_PROJECTS),
  add: name => addItem(LIST_PROJECTS, name),
  rename: (id, name) => renameItem(id, name),
  remove: id => deleteItem(id),
};
