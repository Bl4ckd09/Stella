-- Server-side "always-on" worker state for 24/7 unattended runs.
-- A single row holds the live BusinessState so the Vercel Cron worker can
-- resume across invocations without a browser open. The agent_runs/agent_events
-- tables (0003) remain the observability/audit record.

create table if not exists worker_state (
  id          text primary key default 'default',
  enabled     boolean default true,        -- master on/off (controllable from /hq)
  use_llm     boolean default false,       -- 24/7 defaults to free templated reasoning
  run_id      uuid,
  state       jsonb,                        -- latest BusinessState (events trimmed)
  busy_until  timestamptz,                  -- atomic lock against overlapping cron runs
  updated_at  timestamptz default now()
);

insert into worker_state (id, enabled, use_llm)
  values ('default', true, false)
  on conflict (id) do nothing;

alter table worker_state enable row level security;
