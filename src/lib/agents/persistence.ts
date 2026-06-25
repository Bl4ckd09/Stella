/**
 * Persistent observability — writes the autonomous run + its events to Postgres
 * (Supabase) so there's a queryable history beyond the live console.
 *
 * Best-effort: if DATABASE_URL is unset (e.g. the no-DB demo) or a write fails,
 * everything no-ops silently — persistence must never break the agent loop.
 * Server-only (uses the pg pool).
 */
import { pool } from "../db";
import type { AgentEvent, BusinessState } from "./types";

export function persistenceEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validRunId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

/** Numeric, per-run-unique sequence from an event id like "ev-42". */
function seqOf(e: AgentEvent): number {
  const n = parseInt(String(e.id).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Upsert the run's latest metrics and append its new events. Awaited but fully
 * guarded — any failure is swallowed so the tick/dispatch response still returns.
 */
export async function persistRun(
  runId: string,
  state: BusinessState,
  events: AgentEvent[],
  label?: string,
): Promise<void> {
  if (!persistenceEnabled() || !validRunId(runId)) return;
  try {
    const p = pool();
    await p.query(
      `insert into agent_runs (id, label, autonomy, tick, revenue, client_value, customers, decisions, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now())
       on conflict (id) do update set
         label = coalesce(agent_runs.label, excluded.label),
         autonomy = excluded.autonomy, tick = excluded.tick, revenue = excluded.revenue,
         client_value = excluded.client_value, customers = excluded.customers,
         decisions = excluded.decisions, updated_at = now()`,
      [
        runId,
        label ?? null,
        state.autonomy,
        state.tick,
        state.finances.revenue,
        state.finances.clientValueDelivered,
        state.finances.customers,
        state.decisionsLogged,
      ],
    );

    if (events.length) {
      const cols = 12;
      const tuples: string[] = [];
      const params: unknown[] = [];
      events.forEach((e, idx) => {
        const b = idx * cols;
        tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`);
        params.push(
          runId, seqOf(e), e.tick, e.agent, e.action, e.dealId ?? null,
          e.risk, e.blocked ?? false, e.batch ?? null, e.channel ?? null, e.headline, e.reasoning ?? null,
        );
      });
      await p.query(
        `insert into agent_events
           (run_id, seq, tick, agent, action, deal_id, risk, blocked, batch, channel, headline, reasoning)
         values ${tuples.join(",")}
         on conflict (run_id, seq) do nothing`,
        params,
      );
    }
  } catch {
    // best-effort observability — never break the loop
  }
}

export interface RunSummary {
  id: string;
  label: string | null;
  autonomy: string | null;
  tick: number;
  revenue: number;
  client_value: number;
  customers: number;
  decisions: number;
  created_at: string;
  updated_at: string;
}

export async function listRuns(limit = 50): Promise<RunSummary[]> {
  if (!persistenceEnabled()) return [];
  try {
    const { rows } = await pool().query<RunSummary>(
      `select id, label, autonomy, tick,
              revenue::float8 as revenue, client_value::float8 as client_value,
              customers, decisions, created_at, updated_at
         from agent_runs
        order by updated_at desc
        limit $1`,
      [Math.min(Math.max(1, limit), 200)],
    );
    return rows;
  } catch {
    return [];
  }
}

export interface StoredEvent {
  seq: number;
  tick: number;
  agent: string;
  action: string;
  deal_id: string | null;
  risk: string | null;
  blocked: boolean;
  batch: string | null;
  channel: string | null;
  headline: string;
  reasoning: string | null;
  created_at: string;
}

export async function getRunEvents(runId: string, limit = 1000): Promise<StoredEvent[]> {
  if (!persistenceEnabled() || !validRunId(runId)) return [];
  try {
    const { rows } = await pool().query<StoredEvent>(
      `select seq, tick, agent, action, deal_id, risk, blocked, batch, channel, headline, reasoning, created_at
         from agent_events
        where run_id = $1
        order by seq desc
        limit $2`,
      [runId, Math.min(Math.max(1, limit), 5000)],
    );
    return rows;
  } catch {
    return [];
  }
}
