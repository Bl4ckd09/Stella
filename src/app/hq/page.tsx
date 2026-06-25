"use client";

/**
 * Stella · Hands-Off HQ — Mission Control for a self-running business.
 *
 * You set it running and walk away. The console holds the business state and
 * ticks the autonomous loop on the server; the AI workforce sources prospects,
 * scans them with the deterministic engine, qualifies, sells, prepares paid
 * work, and advances council cases — while a compliance agent reviews every
 * outbound message and the riskiest action waits for your approval.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_LIST } from "@/lib/agents/roster";
import { gbp } from "@/lib/agents/format";
import type { AgentId, AutonomyLevel, BusinessState, Deal, Stage } from "@/lib/agents/types";

const STAGE_LABEL: Record<Stage, string> = {
  sourced: "Sourced",
  scanning: "Scanning",
  qualified: "Qualified",
  disqualified: "Dropped — ineligible",
  needs_optin: "No consent — not contacted",
  contacted: "Awaiting reply",
  won_claim_pack: "Won — Claim Pack",
  won_admin: "Won — Admin Support",
  lost: "Chose free route",
  pack_delivered: "Pack delivered",
  awaiting_authorization: "Awaiting authority",
  authorized: "Authorized",
  ready_to_submit: "Ready to submit",
  submitted: "Submitted to council",
  awaiting_council: "Awaiting council",
  outcome_recorded: "Outcome recorded",
  closed: "Closed",
};

const COLUMNS: { title: string; stages: Stage[] }[] = [
  { title: "Sourcing", stages: ["sourced", "scanning"] },
  { title: "Qualified", stages: ["qualified"] },
  { title: "Outreach", stages: ["contacted"] },
  { title: "Won", stages: ["won_claim_pack", "won_admin"] },
  { title: "Case work", stages: ["pack_delivered", "awaiting_authorization", "authorized", "ready_to_submit", "submitted", "awaiting_council", "outcome_recorded"] },
  { title: "Closed", stages: ["closed"] },
  { title: "Dropped / Held", stages: ["disqualified", "lost", "needs_optin"] },
];

interface LlmTier {
  provider: string;
  model: string;
  available: boolean;
}
interface LlmStatus {
  reasoning: LlmTier;
  artifacts: LlmTier;
}

const AUTONOMY_HINT: Record<AutonomyLevel, string> = {
  supervised: "You approve every customer/council-facing action.",
  assisted: "Agents run autonomously; you approve only council submissions.",
  autopilot: "Fully hands-off. Nothing waits for you (kill switch still armed).",
};

export default function HQ() {
  const [state, setState] = useState<BusinessState | null>(null);
  const [more, setMore] = useState(true);
  const [auto, setAuto] = useState(false);
  const [useLLM, setUseLLM] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [speed, setSpeed] = useState(1400);
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmStatus | null>(null);

  const stateRef = useRef<BusinessState | null>(null);
  stateRef.current = state;
  const busyRef = useRef(false);

  const boot = useCallback(async (autonomy: AutonomyLevel) => {
    const res = await fetch("/api/agents/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy }),
    });
    const data = await res.json();
    setState(data.state);
    setMore(data.hasWork);
    if (data.llm) setLlm(data.llm);
  }, []);

  useEffect(() => {
    boot("assisted");
  }, [boot]);

  const tickOnce = useCallback(async () => {
    const cur = stateRef.current;
    if (!cur || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/agents/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: cur, useLLM }),
      });
      if (!res.ok) throw new Error(`tick failed (${res.status})`);
      const data = await res.json();
      setState(data.state);
      setMore(data.hasWork);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "tick error");
      setAuto(false);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [useLLM]);

  const decide = useCallback(async (approvalId: string, decision: "approved" | "rejected") => {
    const cur = stateRef.current;
    if (!cur) return;
    const res = await fetch("/api/agents/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: cur, approvalId, decision }),
    });
    const data = await res.json();
    setState(data.state);
    if (decision === "approved") setMore(true);
  }, []);

  const runDispatch = useCallback(async () => {
    const cur = stateRef.current;
    if (!cur || dispatching) return;
    setDispatching(true);
    try {
      const res = await fetch("/api/agents/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: cur, useLLM }),
      });
      if (!res.ok) throw new Error(`dispatch failed (${res.status})`);
      const data = await res.json();
      setState(data.state);
      setMore(data.hasWork);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "dispatch error");
    } finally {
      setDispatching(false);
    }
  }, [dispatching, useLLM]);

  const pending = state?.approvals.filter((a) => a.decided === null) ?? [];
  const readyToContact = state?.deals.filter((d) => d.stage === "qualified").length ?? 0;

  // The autonomous driver: while running, schedule the next step — a parallel
  // outbound campaign when owners have accumulated, otherwise a single tick.
  useEffect(() => {
    if (!auto || !state || !state.running || busy || dispatching) return;
    // Let owners accumulate, then contact a batch in parallel — fire when a few
    // are ready, or when there's nothing else to do (flush the remainder).
    if (readyToContact >= 3 || (readyToContact > 0 && !more)) {
      const t = setTimeout(runDispatch, speed);
      return () => clearTimeout(t);
    }
    if (!more) {
      // Stalled. If only pending approvals remain and auto-approve is on, clear one.
      if (pending.length && autoApprove) {
        const t = setTimeout(() => decide(pending[0].id, "approved"), speed);
        return () => clearTimeout(t);
      }
      return; // idle — caught up or waiting on a human
    }
    const t = setTimeout(tickOnce, speed);
    return () => clearTimeout(t);
  }, [auto, state, busy, dispatching, more, readyToContact, speed, tickOnce, runDispatch, pending, autoApprove, decide]);

  const reset = useCallback(() => {
    setAuto(false);
    setSelected(null);
    boot(state?.autonomy ?? "assisted");
  }, [boot, state?.autonomy]);

  const setAutonomy = (autonomy: AutonomyLevel) => {
    setState((s) => (s ? { ...s, autonomy } : s));
    setMore(true);
  };

  const toggleKill = () => setState((s) => (s ? { ...s, running: !s.running } : s));

  if (!state) return <div className="hq"><div className="hq-boot">Booting Stella HQ…</div></div>;

  const f = state.finances;
  const activeDeals = state.deals.filter((d) => !["closed", "lost", "disqualified"].includes(d.stage)).length;
  const recent = [...state.events].slice(-60).reverse();
  const selectedDeal = state.deals.find((d) => d.id === selected) ?? null;

  return (
    <div className="hq">
      <header className="hq-top">
        <div>
          <h1>Stella · Hands-Off HQ</h1>
          <p className="sub">A business that runs itself. You set the guardrails — the AI workforce does the work.</p>
        </div>
        <a className="hq-back" href="/">← the free scanner</a>
      </header>

      {/* Controls */}
      <div className="hq-controls">
        <button className={`primary ${auto ? "danger" : ""}`} onClick={() => setAuto((a) => !a)}>
          {auto ? "⏸ Pause" : "▶ Go hands-off"}
        </button>
        <button className="ghost" onClick={tickOnce} disabled={auto || busy || !more}>Step</button>
        <button
          className="campaign"
          onClick={runDispatch}
          disabled={dispatching || readyToContact === 0}
          title="Contact every qualified, consented owner at once (voice / WhatsApp / email)"
        >
          {dispatching ? "📣 Dialing…" : `📣 Outbound campaign${readyToContact ? ` (${readyToContact})` : ""}`}
        </button>
        <button className="ghost" onClick={reset}>Reset</button>

        <div className="hq-seg">
          {(["supervised", "assisted", "autopilot"] as AutonomyLevel[]).map((lvl) => (
            <button
              key={lvl}
              className={state.autonomy === lvl ? "on" : ""}
              onClick={() => setAutonomy(lvl)}
              title={AUTONOMY_HINT[lvl]}
            >
              {lvl}
            </button>
          ))}
        </div>

        <label className="hq-check">
          <input type="checkbox" checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)} />
          AI reasoning (Claude)
        </label>
        <label className="hq-check">
          <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
          auto-approve
        </label>
        <label className="hq-check">
          speed
          <input type="range" min={300} max={2600} step={100} value={2900 - speed} onChange={(e) => setSpeed(2900 - Number(e.target.value))} />
        </label>

        <button className={`hq-kill ${state.running ? "" : "tripped"}`} onClick={toggleKill}>
          {state.running ? "● live" : "■ stopped"}
        </button>
      </div>
      <p className="hq-hint">
        {AUTONOMY_HINT[state.autonomy]}
        {llm && (
          <span className="hq-llm">
            {" · "}🧠 reasoning: <b>{llm.reasoning.provider === "openai" ? `Modal ${llm.reasoning.model}` : llm.reasoning.model}</b>
            {" · "}📄 letters: <b>{llm.artifacts.provider === "openai" ? `Modal ${llm.artifacts.model}` : llm.artifacts.model}</b>
            {!useLLM && <span className="muted"> (toggle “AI reasoning” to use them live)</span>}
          </span>
        )}
        {err && <span className="error"> · {err}</span>}
      </p>

      {/* KPIs */}
      <div className="hq-kpis">
        <Kpi label="Revenue booked" value={gbp(f.revenue)} accent="green" />
        <Kpi label="Client value delivered" value={gbp(f.clientValueDelivered)} accent="green" />
        <Kpi label="Paying customers" value={String(f.customers)} />
        <Kpi label="Active deals" value={String(activeDeals)} />
        <Kpi label="Agent decisions" value={String(state.decisionsLogged)} />
        <Kpi label="Cycle" value={`#${state.tick}`} />
      </div>

      {/* Agent roster */}
      <div className="hq-agents">
        {AGENT_LIST.map((a) => (
          <div key={a.id} className={`hq-agent ${state.agentStatus[a.id]}`} title={a.charter}>
            <span className="emoji">{a.emoji}</span>
            <div className="meta">
              <div className="name">{a.name} <span className={`dot ${state.agentStatus[a.id]}`} /></div>
              <div className="role">{a.role}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="hq-main">
        {/* Pipeline */}
        <div className="hq-pipeline">
          {COLUMNS.map((col) => {
            const deals = state.deals.filter((d) => col.stages.includes(d.stage));
            return (
              <div className="hq-col" key={col.title}>
                <div className="hq-col-head">{col.title} <span>{deals.length}</span></div>
                {deals.map((d) => (
                  <DealChip key={d.id} deal={d} onClick={() => setSelected(d.id)} active={d.id === selected} />
                ))}
              </div>
            );
          })}
        </div>

        {/* Feed + approvals */}
        <div className="hq-side">
          {pending.length > 0 && (
            <div className="hq-approvals">
              <div className="hq-approvals-head">⏸ {pending.length} action{pending.length > 1 ? "s" : ""} need your approval</div>
              {pending.map((ap) => (
                <div className="hq-approval" key={ap.id}>
                  <div className="risk high">HIGH RISK</div>
                  <div className="txt">{ap.summary}</div>
                  <div className="btns">
                    <button className="ok" onClick={() => decide(ap.id, "approved")}>Approve</button>
                    <button className="no" onClick={() => decide(ap.id, "rejected")}>Hold</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="hq-feed">
            <div className="hq-feed-head">
              Live activity
              {auto && more && <span className="live-dot">● running</span>}
              {auto && !more && !pending.length && <span className="idle-dot">○ caught up</span>}
            </div>
            {recent.length === 0 && <div className="hq-empty">Press <b>Go hands-off</b> and walk away.</div>}
            {recent.map((e) => (
              <div className={`hq-event ${e.blocked ? "blocked" : ""} ${e.batch ? "batch" : ""} risk-${e.risk}`} key={e.id} onClick={() => e.dealId && setSelected(e.dealId)}>
                <div className="head">
                  <span className="who">{agentEmoji(e.agent)} {agentName(e.agent)}</span>
                  <span className="t">#{e.tick}</span>
                </div>
                <div className="hl">{e.headline}</div>
                {e.reasoning && <div className="rz">{e.reasoning}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedDeal && <DealDrawer deal={selectedDeal} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "green" }) {
  return (
    <div className="hq-kpi">
      <div className={`v ${accent ?? ""}`}>{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function DealChip({ deal, onClick, active }: { deal: Deal; onClick: () => void; active: boolean }) {
  const money = deal.money.confirmedBackdated != null
    ? `${gbp(deal.money.confirmedBackdated)} confirmed`
    : deal.money.estAnnualSaving > 0
      ? `${gbp(deal.money.estAnnualSaving)}/yr est.`
      : "—";
  const chan = deal.channel === "voice" ? "📞" : deal.channel === "whatsapp" ? "💬" : "✉️";
  return (
    <div className={`hq-chip ${active ? "active" : ""}`} onClick={onClick}>
      <div className="n">{deal.business.name}</div>
      <div className="s">{STAGE_LABEL[deal.stage]}</div>
      <div className="m">
        {money} · {chan} {deal.consent ? <span className="ok-tag">opted in</span> : <span className="no-tag">no consent</span>}
      </div>
    </div>
  );
}

function DealDrawer({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  return (
    <div className="hq-drawer-bg" onClick={onClose}>
      <div className="hq-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose}>×</button>
        <h2>{deal.business.name}</h2>
        <div className="sub">{deal.business.address}, {deal.business.postcode} · {deal.business.borough} · {deal.business.sector}</div>
        <div className="sub">Owner: {deal.business.contact} · channel: {deal.channel} · status: {STAGE_LABEL[deal.stage]}</div>
        <div className="sub">
          Consent:{" "}
          {deal.consent ? (
            <span className="ok-tag">opted in — {deal.consentSource}</span>
          ) : (
            <span className="no-tag">no consent on file — cannot be contacted (no cold outreach)</span>
          )}
        </div>

        <div className="hq-money">
          <div><span>RV</span>{gbp(deal.business.rateableValue)}</div>
          <div><span>Est. annual</span>{gbp(deal.money.estAnnualSaving)}</div>
          <div><span>Est. backdated</span>{gbp(deal.money.estBackdated)}</div>
          <div><span>Confirmed</span>{deal.money.confirmedBackdated != null ? gbp(deal.money.confirmedBackdated) : "—"}</div>
        </div>
        <p className="hq-note">All £ figures computed by Stella&apos;s deterministic engine — never by the LLM.</p>

        {deal.findings.length > 0 && (
          <>
            <h3>Engine findings</h3>
            {deal.findings.map((fd, i) => (
              <div className="finding" key={i}>
                <div className="h">{fd.headline} {fd.annual_value > 0 && <span className="v">· {gbp(fd.annual_value)}/yr</span>}</div>
                <div className="ex">{fd.explanation}</div>
              </div>
            ))}
          </>
        )}

        {deal.artifacts.length > 0 && (
          <>
            <h3>Agent artifacts</h3>
            {deal.artifacts.map((a) => (
              <div className="hq-artifact" key={a.id}>
                <div className="ah">
                  <span>{a.title}</span>
                  {a.review && <span className={`vbadge ${a.review.pass ? "pass" : "fail"}`}>{a.review.pass ? "compliance ✓" : "blocked"}</span>}
                </div>
                <pre>{a.body}</pre>
                {a.review && <div className="ar">Compliance: {a.review.reasons.join("; ")}</div>}
              </div>
            ))}
          </>
        )}

        <h3>History</h3>
        <ul className="hq-history">
          {deal.history.map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      </div>
    </div>
  );
}

function agentEmoji(id: AgentId): string {
  return AGENT_LIST.find((a) => a.id === id)?.emoji ?? "🤖";
}
function agentName(id: AgentId): string {
  const a = AGENT_LIST.find((x) => x.id === id);
  return a ? `${a.name} · ${a.role}` : id;
}
