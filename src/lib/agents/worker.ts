/**
 * Always-on worker — drives the autonomous loop 24/7 without a browser.
 *
 * The live BusinessState is stored in Postgres (worker_state). Each Vercel Cron
 * tick: atomically claim the worker, load state, advance a few steps (sourcing,
 * scanning, parallel campaigns, cases — exactly like the console driver but
 * server-side), persist events to the audit tables, save the new state, and
 * release. When a run finishes it auto-rolls into a fresh one, so the business
 * keeps operating indefinitely.
 *
 * Unattended runs use `autopilot` (nobody is there to approve) and, by default,
 * the free templated reasoning (no LLM cost) — both toggleable from /hq.
 */
import { pool } from "../db";
import { dispatchOutbound, hasWork, initState, outreachReady, tick } from "./orchestrator";
import { persistRun, persistenceEnabled } from "./persistence";
import type { AgentEvent, BusinessState } from "./types";

const WORKER_ID = "default";
const MAX_EVENTS_IN_STATE = 50; // the full audit trail lives in agent_events

export function workerSteps(): number {
  const n = parseInt(process.env.STELLA_WORKER_STEPS || "15", 10);
  return Number.isFinite(n) ? Math.min(Math.max(1, n), 60) : 15;
}

function pendingOutreach(s: BusinessState): number {
  const o = outreachReady(s);
  return o.toContact + o.toHold;
}

function runDone(s: BusinessState): boolean {
  return !hasWork(s) && pendingOutreach(s) === 0;
}

/** Advance a state up to `maxSteps` world-steps (campaign when owners ready, else tick). */
async function advanceState(
  prev: BusinessState,
  useLLM: boolean,
  maxSteps: number,
): Promise<{ state: BusinessState; events: AgentEvent[] }> {
  let state = prev;
  const events: AgentEvent[] = [];
  for (let i = 0; i < maxSteps; i++) {
    if (pendingOutreach(state) > 0) {
      const r = await dispatchOutbound(state, { useLLM, simulateLatency: false });
      state = r.state;
      events.push(...r.events);
      continue;
    }
    if (!hasWork(state)) break;
    const r = await tick(state, { useLLM });
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

export interface WorkerTickResult {
  ok: boolean;
  skipped?: "locked" | "disabled" | "no_db";
  runId?: string;
  steps?: number;
  events?: number;
  rolledOver?: boolean;
  tick?: number;
}

/** One cron invocation: claim → advance → persist → release. */
export async function workerTick(): Promise<WorkerTickResult> {
  if (!persistenceEnabled()) return { ok: false, skipped: "no_db" };
  const p = pool();

  // Atomic claim: only one invocation may hold the worker at a time.
  const claim = await p.query<{ enabled: boolean; use_llm: boolean; run_id: string | null; state: BusinessState | null }>(
    `update worker_state
        set busy_until = now() + interval '90 seconds'
      where id = $1 and (busy_until is null or busy_until < now())
      returning enabled, use_llm, run_id, state`,
    [WORKER_ID],
  );
  if (claim.rowCount !== 1) return { ok: true, skipped: "locked" };
  const row = claim.rows[0];

  try {
    if (!row.enabled) return { ok: true, skipped: "disabled" };

    let state = row.state;
    let runId = row.run_id ?? undefined;
    let label: string | undefined;
    let rolledOver = false;

    // Start (or roll over to) a fresh run when there's nothing left to do.
    if (!state || runDone(state)) {
      state = initState("autopilot");
      runId = crypto.randomUUID();
      label = `Unattended ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`;
      rolledOver = Boolean(row.state);
    }

    const { state: next, events } = await advanceState(state, row.use_llm, workerSteps());
    if (runId) await persistRun(runId, next, events, label);

    // Trim the in-state event log before persisting the blob (audit trail is in agent_events).
    const slim: BusinessState = { ...next, events: next.events.slice(-MAX_EVENTS_IN_STATE) };
    await p.query(`update worker_state set state = $2::jsonb, run_id = $3, updated_at = now() where id = $1`, [
      WORKER_ID,
      JSON.stringify(slim),
      runId ?? null,
    ]);

    return { ok: true, runId, steps: events.length, events: events.length, rolledOver, tick: next.tick };
  } finally {
    // Always release the lock.
    await p.query(`update worker_state set busy_until = null where id = $1`, [WORKER_ID]).catch(() => {});
  }
}

export interface WorkerStatus {
  enabled: boolean;
  useLLM: boolean;
  runId: string | null;
  updatedAt: string | null;
  busy: boolean;
  tick: number;
  revenue: number;
  clientValue: number;
  customers: number;
}

export async function getWorkerStatus(): Promise<WorkerStatus | null> {
  if (!persistenceEnabled()) return null;
  try {
    const { rows } = await pool().query(
      `select w.enabled, w.use_llm, w.run_id, w.updated_at,
              (w.busy_until is not null and w.busy_until > now()) as busy,
              coalesce(r.tick,0) as tick,
              coalesce(r.revenue,0)::float8 as revenue,
              coalesce(r.client_value,0)::float8 as client_value,
              coalesce(r.customers,0) as customers
         from worker_state w
         left join agent_runs r on r.id = w.run_id
        where w.id = $1`,
      [WORKER_ID],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      enabled: r.enabled,
      useLLM: r.use_llm,
      runId: r.run_id,
      updatedAt: r.updated_at,
      busy: r.busy,
      tick: r.tick,
      revenue: r.revenue,
      clientValue: r.client_value,
      customers: r.customers,
    };
  } catch {
    return null;
  }
}

export async function setWorker(opts: { enabled?: boolean; useLLM?: boolean }): Promise<void> {
  if (!persistenceEnabled()) return;
  const sets: string[] = [];
  const params: unknown[] = [WORKER_ID];
  if (typeof opts.enabled === "boolean") {
    params.push(opts.enabled);
    sets.push(`enabled = $${params.length}`);
  }
  if (typeof opts.useLLM === "boolean") {
    params.push(opts.useLLM);
    sets.push(`use_llm = $${params.length}`);
  }
  if (!sets.length) return;
  await pool().query(`update worker_state set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
}
