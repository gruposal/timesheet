// Seed script: populate ~1 year of historical timesheet data into Supabase
// Usage: node scripts/seed.mjs

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import url from "url";

// Lazy load dotenv if available (dev-only dependency)
try {
  const { default: dotenv } = await import("dotenv");
  // Load .env.local first (if exists) then .env, without overwriting existing env vars
  const cwd = process.cwd();
  const envLocal = path.join(cwd, ".env.local");
  if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal, override: false });
  dotenv.config({ override: false });
} catch {}

const env = process.env;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_KEY; // allow both names
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE)) {
  console.error("Missing Supabase env vars. Set VITE_SUPABASE_URL and either SUPABASE_SERVICE_ROLE (recommended) or VITE_SUPABASE_ANON_KEY.");
  process.exit(1);
}
const authKey = SUPABASE_SERVICE_ROLE || SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, authKey);
console.log(`[seed] Using ${SUPABASE_SERVICE_ROLE ? 'service_role' : 'anon'} key`);

// Domain data (mirrors app defaults)
const PEOPLE = [
  "Alice Silva",
  "Bruno Lima",
  "Carla Souza",
  "Diego Santos",
  "Eva Martins",
  "João Casotti",
];
const PROJECTS = [
  "Google – Brand Film",
  "Waze – Cycling Campaign",
  "Nike – Vini Jr Launch",
  "Stone – Investor Day",
  "PRIO – Pegada PRIO S2",
  "Uruguai Meats – O Sabor da Fronteira",
];
const BUSINESS_UNITS = ["Branding", "Comunicação", "Conteúdo", "CSC"];

function toTwo(n) { return String(n).padStart(2, "0"); }

// Simple pseudo-random helper with seed capability (to keep stable results per person/week)
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickOne(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function distributeAcrossWeek(rng, total) {
  // Distribute total hours across Mon..Fri as integers, mildly varied, cap ~10/day
  const days = [0, 0, 0, 0, 0];
  let remaining = total;
  for (let i = 0; i < 5; i += 1) {
    const daysLeft = 5 - i;
    const minForRest = 0;
    const cap = Math.min(10, remaining); // soft cap per day
    const maxForToday = Math.max(0, remaining - minForRest);
    const today = i === 4 ? remaining : Math.min(cap, randomInt(rng, 0, Math.max(0, Math.min(cap, maxForToday))));
    days[i] = today;
    remaining -= today;
  }
  // If some remainder left due to caps, spread it from Monday onward up to 10/day
  let idx = 0;
  while (remaining > 0) {
    if (days[idx] < 10) { days[idx] += 1; remaining -= 1; }
    idx = (idx + 1) % 5;
  }
  return { mon: days[0], tue: days[1], wed: days[2], thu: days[3], fri: days[4] };
}

function getISOWeek(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round((diff / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

function startOfISOWeek(date) {
  const d = new Date(date.valueOf());
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday as start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function main() {
  const today = new Date();
  const startMonday = startOfISOWeek(today);

  // Seed master data (people, projects, business_units)
  try {
    // Upsert by unique name if constraints exist; otherwise insert may duplicate on re-run
    if (Array.isArray(PEOPLE) && PEOPLE.length) {
      const payload = PEOPLE.map((name) => ({ name }));
      const { error } = await supabase.from("people").upsert(payload, { onConflict: "name" });
      if (error) throw error;
    }
    if (Array.isArray(PROJECTS) && PROJECTS.length) {
      const payload = PROJECTS.map((name) => ({ name }));
      const { error } = await supabase.from("projects").upsert(payload, { onConflict: "name" });
      if (error) throw error;
    }
    if (Array.isArray(BUSINESS_UNITS) && BUSINESS_UNITS.length) {
      const payload = BUSINESS_UNITS.map((name) => ({ name }));
      const { error } = await supabase.from("business_units").upsert(payload, { onConflict: "name" });
      if (error) throw error;
    }
    console.log("[seed] Master data upserted: people, projects, business_units");
  } catch (e) {
    console.warn("[seed] Failed seeding master data (continuing):", e?.message || e);
  }

  const weeks = [];
  for (let w = 0; w < 52; w += 1) {
    const d = new Date(startMonday.valueOf());
    d.setDate(d.getDate() - w * 7);
    const year = d.getFullYear();
    const isoWeek = getISOWeek(d);
    const weekStart = startOfISOWeek(d);
    weeks.push({ year, isoWeek, weekStart: formatYmd(weekStart) });
  }

  const rows = [];
  for (const person of PEOPLE) {
    for (const w of weeks) {
      // Seed RNG with stable key so re-running keeps similar data
      const seed = Math.abs((person + w.year + "-" + w.isoWeek).split("").reduce((a, c) => a + c.charCodeAt(0), 0));
      const rng = mulberry32(seed);
      const numRows = randomInt(rng, 1, 3);
      let weeklyRemaining = randomInt(rng, 32, 40);
      for (let idx = 0; idx < numRows; idx += 1) {
        const rowsLeft = numRows - idx;
        const shareBase = Math.floor(weeklyRemaining / rowsLeft);
        const jitter = idx < numRows - 1 ? randomInt(rng, -2, 2) : 0;
        const share = Math.max(0, Math.min(weeklyRemaining, shareBase + jitter));
        weeklyRemaining -= share;

        const dist = distributeAcrossWeek(rng, share);
        const total = dist.mon + dist.tue + dist.wed + dist.thu + dist.fri;
        if (total === 0) continue;

        const project = pickOne(rng, PROJECTS);
        const bu = pickOne(rng, BUSINESS_UNITS);
        const id = `${w.year}-${toTwo(w.isoWeek)}-${person}-${idx + 1}`;
        rows.push({
          id,
          person,
          project,
          business_unit: bu,
          year: w.year,
          iso_week: w.isoWeek,
          week_start: w.weekStart,
          mon: dist.mon,
          tue: dist.tue,
          wed: dist.wed,
          thu: dist.thu,
          fri: dist.fri,
          sat: 0,
          sun: 0,
          notes: rng() < 0.08 ? "ajuste de planejamento" : "",
          // created_at left to default now()
        });
      }
    }
  }

  console.log(`Prepared ${rows.length} rows for upsert…`);

  // Upsert in chunks
  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from("timesheet_entries")
      .upsert(chunk, { onConflict: "id", ignoreDuplicates: false, count: "exact" });
    if (error) {
      console.error("Upsert failed:", error.message);
      process.exit(1);
    }
    inserted += chunk.length;
    console.log(`Upserted ${Math.min(inserted, rows.length)} / ${rows.length}`);
  }

  console.log("Seed completed successfully.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


