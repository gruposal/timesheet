import { cuFetch } from './client.js';
import { LIST_ENTRIES, FIELDS, ccIdToName, ccNameToId } from './fields.js';

// session cache: task name → clickup task id
const taskIdCache = new Map();

export function makeTaskName(year, isoWeek, person, project) {
  const week = String(isoWeek).padStart(2, '0');
  return `${year}-W${week} | ${person} | ${project}`;
}

function fromTask(task) {
  const cf = Object.fromEntries(
    (task.custom_fields || []).map(f => [f.id, f.value ?? null])
  );

  // Dropdown returns orderindex (number), not UUID — resolve name from type_config
  const ccField = (task.custom_fields || []).find(f => f.id === FIELDS.centro_de_custo);
  let businessUnit = '';
  if (ccField && ccField.value != null) {
    const opt = (ccField.type_config?.options || []).find(o => o.orderindex === ccField.value);
    businessUnit = opt?.name ?? ccIdToName(ccField.value) ?? '';
  }

  const entry = {
    ID: task.name,
    _taskId: task.id,
    Year: cf[FIELDS.ano] !== null ? Number(cf[FIELDS.ano]) : null,
    ISO_Week: cf[FIELDS.semana_num] !== null ? Number(cf[FIELDS.semana_num]) : null,
    Person: cf[FIELDS.pessoa] ?? '',
    Project: cf[FIELDS.projeto] ?? '',
    Business_Unit: businessUnit,
    Hours_Forecast: cf[FIELDS.horas_previstas] !== null ? Number(cf[FIELDS.horas_previstas]) : null,
    Hours_Consolidated: cf[FIELDS.horas_realizadas] !== null ? Number(cf[FIELDS.horas_realizadas]) : null,
  };

  taskIdCache.set(task.name, task.id);
  return entry;
}

async function fetchPage(filters, page = 0) {
  const cf = encodeURIComponent(JSON.stringify(filters));
  const data = await cuFetch(
    `/list/${LIST_ENTRIES}/task?custom_fields=${cf}&page=${page}&limit=100&include_closed=true`
  );
  return data;
}

export async function loadForWeek(year, isoWeek) {
  const filters = [
    { field_id: FIELDS.ano,        operator: '=', value: year },
    { field_id: FIELDS.semana_num, operator: '=', value: isoWeek },
  ];
  const data = await fetchPage(filters);
  return (data.tasks || []).map(fromTask);
}

export async function loadLastYear(year) {
  const filters = [
    { field_id: FIELDS.ano, operator: '=', value: year },
  ];
  const rows = [];
  let page = 0;
  while (true) {
    const data = await fetchPage(filters, page);
    const batch = (data.tasks || []).map(fromTask);
    rows.push(...batch);
    if (data.last_page || batch.length === 0) break;
    page++;
  }
  return rows;
}

async function setField(taskId, fieldId, value) {
  await cuFetch(`/task/${taskId}/field/${fieldId}`, {
    method: 'POST',
    body: { value },
  });
}

async function createEntry(row) {
  const name = makeTaskName(row.Year, row.ISO_Week, row.Person, row.Project);
  const ccOptionId = row.Business_Unit ? ccNameToId(row.Business_Unit) : null;

  const task = await cuFetch(`/list/${LIST_ENTRIES}/task`, {
    method: 'POST',
    body: {
      name,
      custom_fields: [
        { id: FIELDS.ano,              value: row.Year },
        { id: FIELDS.semana_num,       value: row.ISO_Week },
        { id: FIELDS.pessoa,           value: row.Person },
        { id: FIELDS.projeto,          value: row.Project },
        ...(ccOptionId ? [{ id: FIELDS.centro_de_custo, value: ccOptionId }] : []),
        { id: FIELDS.horas_previstas,  value: row.Hours_Forecast ?? null },
        { id: FIELDS.horas_realizadas, value: null },
      ],
    },
  });

  taskIdCache.set(name, task.id);
  return task.id;
}

export async function upsertForecast(rows) {
  for (const row of rows) {
    const name = makeTaskName(row.Year, row.ISO_Week, row.Person, row.Project);
    const cachedId = taskIdCache.get(name);

    if (cachedId) {
      await setField(cachedId, FIELDS.horas_previstas, row.Hours_Forecast);
      if (row.Business_Unit) {
        const optId = ccNameToId(row.Business_Unit);
        if (optId) await setField(cachedId, FIELDS.centro_de_custo, optId);
      }
    } else {
      await createEntry(row);
    }
  }
}

export async function upsertConsolidated(rows) {
  for (const row of rows) {
    const name = makeTaskName(row.Year, row.ISO_Week, row.Person, row.Project);
    const cachedId = taskIdCache.get(name);
    if (!cachedId) throw new Error(`Task não encontrada: ${name}. Salve a previsão antes de consolidar.`);
    await setField(cachedId, FIELDS.horas_realizadas, row.Hours_Consolidated);
  }
}

export async function deleteRow(row) {
  const name = makeTaskName(row.Year, row.ISO_Week, row.Person, row.Project);
  const cachedId = taskIdCache.get(name);
  if (!cachedId) return;
  await cuFetch(`/task/${cachedId}`, { method: 'DELETE' });
  taskIdCache.delete(name);
}
