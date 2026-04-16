# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (Vite, hot reload)
npm run build      # Production build → dist/
npm run preview    # Preview production build locally
npm run lint       # ESLint (JS/JSX)
npm run deploy     # Build + publish to GitHub Pages (gh-pages -d dist)
npm run seed       # Populate ~1 year of test data into Supabase (requires env vars)
```

There are no automated tests — the app uses in-module self-tests via `console.assert` that run on page load (see bottom of `TimesheetApp.jsx`). The two exported pure functions (`sumWeek`, `allowedAfterCap`) are the only unit-testable logic.

## Architecture

This is a **client-only React 19 + Vite** app with no routing library. All state lives in a single root component.

### Component tree

```
main.jsx
└── App.jsx          (thin shell)
    └── TimesheetApp.jsx   (all state, all logic, all views)
        ├── Dashboard.jsx  (charts/tables for aggregated hours)
        └── Directory.jsx  (CRUD UI for people/projects/BUs via Supabase)
```

`TimesheetApp.jsx` is the entire application: it owns the in-memory DB (`db` state), the active week's entries (`entries` state), Supabase calls, Excel export, and renders the three views — `timesheet`, `dashboard`, and `directory` — by switching on a `view` state variable.

### Data model

Rows in the timesheet (both in-memory and Supabase) follow this shape:

```js
{
  ID, Year, ISO_Week, Week_Start,
  Person, Project, Business_Unit,
  Mon, Tue, Wed, Thu, Fri, Sat, Sun,  // integer hours
  Total,   // computed (Mon–Fri only)
  Notes, Created_At
}
```

`mapToSupabase` / `mapFromSupabase` convert between PascalCase (app) and snake_case (DB).

The `Total` column in Supabase is a **generated column** (Mon+Tue+Wed+Thu+Fri, not including Sat/Sun).

### Persistence layers

1. **localStorage** (`ts:ui:v1`): active week entries + UI preferences (year, week, person, view, density, theme). Loaded synchronously during `useState` initialization.
2. **Supabase** (optional): full historical DB. Gated by `isSupabaseConfigured` from `src/lib/supabase.js`. When not configured, the app works entirely offline with in-memory + localStorage data.

### Supabase setup

Create `.env.local` in the project root:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Run the migration to create tables + RLS policies:

```bash
supabase db push
# or paste supabase/migrations/20250808000000_init_timesheet.sql into the Supabase SQL editor
```

Tables: `timesheet_entries`, `people`, `projects`, `business_units`.

### Styling

Tailwind utility classes are used inline throughout JSX. Global CSS variables for colors, shadows, and spacing are defined in `src/index.css`. Dark mode is toggled via `data-theme` on `<html>` and a `dark` class. Density (comfortable/compact) is set via `data-density` on `<html>`.

### Business rules

- Hours are integers, Mon–Fri only (Sat/Sun fields exist but are not surfaced in the main entry UI).
- 40h/week cap is enforced across all rows for the same person+week via `allowedAfterCap`.
- `id` for entries is a random 8-char base-36 string (`uid()`); Supabase uses text PK.

### Keyboard shortcuts

`Ctrl/Cmd+B` — export Excel (current week), `Ctrl/Cmd+M` — export full DB, `Ctrl/Cmd+D` — toggle density, `?` / `Ctrl+K` — help modal, `Shift+1/2/3` — switch views.

### Deployment

Deploys to GitHub Pages at `https://gruposal.github.io/timesheet`. The `base` in `vite.config.js` is set to `/timesheet/` in production automatically.
