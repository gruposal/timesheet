# Timesheet – Horas Semanais (React + Vite)

Aplicativo client-side para lançamento semanal de horas com exportação para Excel e suporte opcional a persistência via Supabase.

## Instalação e desenvolvimento

1. Instale as dependências:

```
npm i
```

2. Execute o servidor de desenvolvimento:

```
npm run dev
```

## (Opcional) Configuração do Supabase

Para salvar e carregar dados do Supabase:

1. Crie um projeto em `https://supabase.com` e obtenha `Project URL` e `anon key` (Settings → API).
2. Crie `.env.local` na raiz do projeto:

```
VITE_SUPABASE_URL=coloque_aqui
VITE_SUPABASE_ANON_KEY=coloque_aqui
```

3. Popular base histórica (~1 ano) para testes:

```
npm run seed
```

No app, use “Carregar Semana” (ou “Carregar Ano”) para listar dados no dashboard.

## Esquema sugerido (Supabase)

Esquema simples, usado pelo app:

```
timesheet_entries(
  id text primary key,
  person text not null,
  project text not null,
  business_unit text not null,
  year int not null,
  iso_week int not null,
  week_start date not null,
  mon int default 0,
  tue int default 0,
  wed int default 0,
  thu int default 0,
  fri int default 0,
  sat int default 0,
  sun int default 0,
  total int generated always as (coalesce(mon,0)+coalesce(tue,0)+coalesce(wed,0)+coalesce(thu,0)+coalesce(fri,0)) stored,
  notes text default '',
  created_at timestamptz default now()
);
```

Tabelas de cadastros usadas na tela “Cadastros”:

```
people(
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);
projects(
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);
business_units(
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);
```

Ative RLS e, para testes, políticas permissivas:

```
alter table timesheet_entries enable row level security;
create policy "read_all" on timesheet_entries for select using (true);
create policy "insert_all" on timesheet_entries for insert with check (true);

alter table people enable row level security;
alter table projects enable row level security;
alter table business_units enable row level security;
create policy "read_all" on people for select using (true);
create policy "insert_all" on people for insert with check (true);
create policy "update_all" on people for update using (true) with check (true);
create policy "delete_all" on people for delete using (true);
create policy "read_all" on projects for select using (true);
create policy "insert_all" on projects for insert with check (true);
create policy "update_all" on projects for update using (true) with check (true);
create policy "delete_all" on projects for delete using (true);
create policy "read_all" on business_units for select using (true);
create policy "insert_all" on business_units for insert with check (true);
create policy "update_all" on business_units for update using (true) with check (true);
create policy "delete_all" on business_units for delete using (true);
```

Esquema relacional (opcional):

```
people(id uuid primary key default gen_random_uuid(), name text not null unique);
projects(id uuid primary key default gen_random_uuid(), name text not null unique);
business_units(id uuid primary key default gen_random_uuid(), name text not null unique);
-- timesheet_entries com person_id/project_id/business_unit_id como FKs
```

Se usar o relacional, adapte o código para gravar `*_id` em vez de texto.

## Migração pronta (SQL)

Um arquivo de migração com tabelas e políticas de RLS está em:

`supabase/migrations/20250808000000_init_timesheet.sql`

Aplicação via Supabase CLI:

```
supabase db push
```

Ou copie o conteúdo do arquivo e execute no SQL Editor do painel do Supabase.
# timesheet
# timesheet
