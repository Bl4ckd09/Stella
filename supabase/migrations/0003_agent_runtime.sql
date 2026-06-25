-- Persistent observability for the autonomous agent system (Hands-Off HQ).
-- Each "run" is one session of the autonomous loop; events are the audit trail.
-- Written best-effort by the /api/agents/* route handlers via the pg pool.

create table if not exists agent_runs (
  id          uuid primary key,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  label       text,
  autonomy    text,
  tick        int default 0,
  revenue     numeric(12,2) default 0,
  client_value numeric(12,2) default 0,
  customers   int default 0,
  decisions   int default 0
);

create table if not exists agent_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz default now(),
  run_id      uuid references agent_runs(id) on delete cascade,
  seq         int not null,           -- monotonic per run (the event's numeric id)
  tick        int not null,
  agent       text not null,
  action      text not null,
  deal_id     text,
  risk        text,
  blocked     boolean default false,
  batch       text,
  channel     text,
  headline    text not null,
  reasoning   text,
  unique (run_id, seq)                 -- idempotent inserts on retry
);

create index if not exists idx_agent_events_run on agent_events (run_id, seq desc);
create index if not exists idx_agent_runs_updated on agent_runs (updated_at desc);

-- Match 0002_rls.sql: deny-all RLS. The app connects with the postgres role
-- (bypassrls) via the pg pool, so writes/reads work; anon REST is denied.
alter table agent_runs enable row level security;
alter table agent_events enable row level security;
