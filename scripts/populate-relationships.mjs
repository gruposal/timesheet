/**
 * Populates Colaborador + Projeto relationship fields on all LISTA_REGISTRO_ALOCACAO entries.
 * Parses both naming formats:
 *   New: "2026-W16 | Person | Project"
 *   Old: "Person → Project (Sem N)"
 *
 * Usage: node scripts/populate-relationships.mjs
 * Requires: VITE_CLICKUP_TOKEN in .env.local
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');

// Load .env.local
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
  });
}

const TOKEN = env.VITE_CLICKUP_TOKEN;
const LIST_ENTRIES  = '901326824645';
const LIST_PESSOAS  = '901326824643';
const LIST_PROJETOS = '901326824646';
const FIELD_COLABORADOR = 'dcd6eb4f-4e04-405d-93dd-8cedb3765938';
const FIELD_PROJETO     = 'ac9c3838-f316-45ea-ba05-b177b3148715';

if (!TOKEN) { console.error('VITE_CLICKUP_TOKEN not found in .env.local'); process.exit(1); }

const BASE = 'https://api.clickup.com/api/v2';
const headers = { Authorization: TOKEN, 'Content-Type': 'application/json' };

async function cuFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers, ...opts });
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') || 2);
    console.log(`  Rate limited, waiting ${retry}s...`);
    await new Promise(r => setTimeout(r, retry * 1000));
    return cuFetch(path, opts);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchAllTasks(listId) {
  const tasks = [];
  let page = 0;
  while (true) {
    const data = await cuFetch(`/list/${listId}/task?page=${page}&limit=100&include_closed=true`);
    tasks.push(...(data.tasks || []));
    if (data.last_page || !(data.tasks || []).length) break;
    page++;
  }
  return tasks;
}

function parseName(taskName) {
  // New format: "2026-W16 | Person | Project"
  const newFmt = taskName.match(/^\d{4}-W\d{2}\s*\|\s*(.+?)\s*\|\s*(.+)$/);
  if (newFmt) return { person: newFmt[1].trim(), project: newFmt[2].trim() };

  // Old format: "Person → Project (Sem N)" or "Person → Project"
  const oldFmt = taskName.match(/^(.+?)\s*→\s*(.+?)(?:\s*\(Sem \d+\))?$/);
  if (oldFmt) return { person: oldFmt[1].trim(), project: oldFmt[2].trim() };

  return null;
}

async function main() {
  console.log('Fetching LISTA_PESSOAS...');
  const pessoasTasks = await fetchAllTasks(LIST_PESSOAS);
  const pessoasMap = new Map(pessoasTasks.map(t => [t.name.trim(), t.id]));
  console.log(`  ${pessoasTasks.length} people loaded.`);

  console.log('Fetching LISTA_PROJETOS...');
  const projetosTasks = await fetchAllTasks(LIST_PROJETOS);
  const projetosMap = new Map(projetosTasks.map(t => [t.name.trim(), t.id]));
  console.log(`  ${projetosTasks.length} projects loaded.`);

  console.log('Fetching LISTA_REGISTRO_ALOCACAO...');
  const entries = await fetchAllTasks(LIST_ENTRIES);
  console.log(`  ${entries.length} entries loaded.`);

  let updated = 0, skipped = 0, errors = 0;
  const unmatchedPeople = new Set();
  const unmatchedProjects = new Set();

  for (const entry of entries) {
    const parsed = parseName(entry.name);
    if (!parsed) {
      console.log(`  SKIP (unparseable): ${entry.name}`);
      skipped++;
      continue;
    }

    const pessoaId = pessoasMap.get(parsed.person);
    const projetoId = projetosMap.get(parsed.project);

    if (!pessoaId) unmatchedPeople.add(parsed.person);
    if (!projetoId) unmatchedProjects.add(parsed.project);

    if (!pessoaId || !projetoId) {
      skipped++;
      continue;
    }

    try {
      await cuFetch(`/task/${entry.id}/field/${FIELD_COLABORADOR}`, {
        method: 'POST',
        body: JSON.stringify({ value: { add: [pessoaId] } }),
      });
      await cuFetch(`/task/${entry.id}/field/${FIELD_PROJETO}`, {
        method: 'POST',
        body: JSON.stringify({ value: { add: [projetoId] } }),
      });
      updated++;
      if (updated % 20 === 0) console.log(`  ${updated} updated so far...`);
    } catch (e) {
      console.error(`  ERROR on ${entry.name}: ${e.message}`);
      errors++;
    }

    // Small delay to avoid bursting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n=== Done ===');
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors:  ${errors}`);

  if (unmatchedPeople.size) {
    console.log('\nUnmatched people:');
    [...unmatchedPeople].sort().forEach(n => console.log('  -', n));
  }
  if (unmatchedProjects.size) {
    console.log('\nUnmatched projects:');
    [...unmatchedProjects].sort().forEach(n => console.log('  -', n));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
