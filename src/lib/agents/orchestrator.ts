/**
 * The orchestrator — Stella's autonomous operating loop.
 *
 * `tick(state)` advances the company by exactly one world-step: either the world
 * responds (a customer replies, a Letter of Authority is signed, a council
 * decides) or one agent takes one action. It is an async pure-ish reducer:
 * given a state it returns the next state plus the events produced. State lives
 * in the console; the server runs the reducer. No database, fully replayable.
 *
 * Safety is structural, not advisory:
 *   - £ figures come only from the deterministic engine (`assessProspect`).
 *   - Every outbound artifact passes the compliance guard or is rewritten.
 *   - A signed authorization is a HARD gate before a council letter is drafted
 *     or submitted.
 *   - Actions above the current autonomy threshold wait in a human approval
 *     queue. `running=false` is a kill switch.
 */
import { assess, totals } from "../engines/relief";
import type { Business } from "../engines/relief";
import { gbp, seqId } from "./format";
import { reviewArtifact } from "./compliance";
import { agentReasoning, composeClaimPack, composeCouncilLetter, composeOutreach } from "./reasoning";
import { freshBacklog } from "./prospects";
import { channelVerb, sendOutbound } from "./integrations";
import type {
  ActionType,
  AgentEvent,
  AgentId,
  AgentStatus,
  Approval,
  Artifact,
  AutonomyLevel,
  BusinessState,
  Deal,
  ProspectBusiness,
  RiskLevel,
  TickResult,
} from "./types";

/** An event without its assigned id/tick — filled in by makeEvent. */
type EventDraft = Omit<AgentEvent, "id" | "tick">;

// ── Tunables ────────────────────────────────────────────────────────────────

const PRICES: Record<"claim_pack" | "admin_support", number> = { claim_pack: 49, admin_support: 199 };
const MIN_WIP = 3; //   keep at least this many deals in flight before draining
const MAX_WIP = 6; //   don't source beyond this many active deals
const DELAY_CUSTOMER = 2;
const DELAY_LOA = 2;
const DELAY_COUNCIL = 3;

const TERMINAL: ReadonlySet<string> = new Set(["disqualified", "lost", "closed", "needs_optin"]);

// ── Deterministic RNG (seeded per deal so the simulation is replayable) ─────

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A single deterministic draw in [0,1) for a deal+purpose. */
function draw(deal: Deal, purpose: string): number {
  return mulberry32(hashString(`${deal.id}:${purpose}`))();
}

// ── Engine integration ──────────────────────────────────────────────────────

/** Run the REAL deterministic relief engine on a prospect. Money source of truth. */
export function assessProspect(p: ProspectBusiness): Pick<Deal, "findings" | "money" | "confidence"> {
  const biz: Business = {
    name: p.name,
    rateable_value: p.rateableValue,
    borough: p.borough,
    sector: p.sector,
    uarn: p.uarn,
    address: p.address,
    postcode: p.postcode,
  };
  const findings = assess(biz);
  const t = totals(findings);
  return {
    findings,
    money: { estAnnualSaving: t.total_annual_savings, estBackdated: t.total_backdated, confirmedBackdated: null },
    confidence: t.highest_confidence,
  };
}

// ── State init ───────────────────────────────────────────────────────────────

const ALL_AGENTS: AgentId[] = ["orchestrator", "scout", "analyst", "closer", "caseworker", "compliance", "cfo"];

export function initState(autonomy: AutonomyLevel = "assisted"): BusinessState {
  const agentStatus = Object.fromEntries(ALL_AGENTS.map((a) => [a, "idle" as AgentStatus])) as Record<
    AgentId,
    AgentStatus
  >;
  return {
    tick: 0,
    autonomy,
    running: true,
    deals: [],
    events: [],
    approvals: [],
    finances: { revenue: 0, clientValueDelivered: 0, customers: 0 },
    agentStatus,
    backlog: freshBacklog(),
    decisionsLogged: 0,
  };
}

// ── Risk + approval policy ───────────────────────────────────────────────────

const RISK: Record<ActionType, RiskLevel> = {
  source: "low",
  scan: "low",
  qualify: "low",
  disqualify: "low",
  hold_no_consent: "low",
  outreach: "medium",
  convert: "low",
  lose: "low",
  generate_pack: "low",
  open_case: "low",
  request_authorization: "medium",
  draft_letter: "medium",
  submit_to_council: "high", // irreversible external action on a customer's behalf
  record_outcome: "low",
  close: "low",
};

export function requiresApproval(risk: RiskLevel, autonomy: AutonomyLevel): boolean {
  if (autonomy === "autopilot") return false;
  if (autonomy === "assisted") return risk === "high";
  return risk !== "low"; // supervised
}

// ── Per-deal planning ────────────────────────────────────────────────────────

function isActive(d: Deal): boolean {
  return !TERMINAL.has(d.stage);
}

/** A simulated world reply that is due for this deal, if any. */
type Timer = "customer_reply" | "loa_signed" | "council_decision";

function dueTimer(d: Deal, tick: number): Timer | null {
  if (d.waitUntil === null || tick < d.waitUntil) return null;
  if (d.stage === "contacted") return "customer_reply";
  if (d.stage === "awaiting_authorization") return "loa_signed";
  if (d.stage === "submitted") return "council_decision";
  return null;
}

/** The next agent action this deal wants, or null if it's waiting/terminal. */
function nextAction(d: Deal): ActionType | null {
  if (d.waitUntil !== null) return null; // waiting on a world reply
  switch (d.stage) {
    case "sourced":
      return "scan";
    case "scanning":
      return d.money.estAnnualSaving > 0 ? "qualify" : "disqualify";
    case "qualified":
      // Outreach is a BATCH operation handled by the parallel dispatcher
      // (dispatchOutbound), not the one-at-a-time loop — so qualified owners
      // accumulate and are then contacted together. The consent gate is applied
      // there. Nothing for the sequential loop to do here.
      return null;
    case "won_claim_pack":
      return "generate_pack";
    case "pack_delivered":
      return "close";
    case "won_admin":
      return "open_case";
    case "awaiting_authorization":
      return "request_authorization"; // (only reached when no timer pending)
    case "authorized":
      return "draft_letter";
    case "ready_to_submit":
      return "submit_to_council";
    case "outcome_recorded":
      return "close";
    default:
      return null;
  }
}

const ACTOR: Record<ActionType, AgentId> = {
  source: "scout",
  scan: "analyst",
  qualify: "analyst",
  disqualify: "analyst",
  hold_no_consent: "compliance",
  outreach: "closer",
  convert: "closer",
  lose: "closer",
  generate_pack: "caseworker",
  open_case: "caseworker",
  request_authorization: "caseworker",
  draft_letter: "caseworker",
  submit_to_council: "caseworker",
  record_outcome: "caseworker",
  close: "caseworker",
};

const PRIORITY: Record<ActionType, number> = {
  record_outcome: 100,
  close: 95,
  submit_to_council: 90,
  draft_letter: 85,
  request_authorization: 80,
  open_case: 78,
  generate_pack: 76,
  convert: 70,
  lose: 68,
  outreach: 60,
  hold_no_consent: 58,
  qualify: 50,
  disqualify: 48,
  scan: 40,
  source: 30,
};

// ── Approvals ────────────────────────────────────────────────────────────────

function latestApproval(state: BusinessState, dealId: string, action: ActionType): Approval | undefined {
  for (let i = state.approvals.length - 1; i >= 0; i--) {
    const a = state.approvals[i];
    if (a.dealId === dealId && a.action === action) return a;
  }
  return undefined;
}

type Plan =
  | { kind: "act"; deal: Deal; action: ActionType }
  | { kind: "request_approval"; deal: Deal; action: ActionType }
  | { kind: "source" }
  | { kind: "idle" };

function planTick(state: BusinessState): { timer?: { deal: Deal; timer: Timer }; plan: Plan } {
  // 1. World replies first — the company reacts to inbound before initiating.
  let dueDeal: Deal | null = null;
  let due: Timer | null = null;
  for (const d of state.deals) {
    const t = dueTimer(d, state.tick);
    if (t && (dueDeal === null || (d.waitUntil ?? 0) < (dueDeal.waitUntil ?? 0))) {
      dueDeal = d;
      due = t;
    }
  }
  if (dueDeal && due) return { timer: { deal: dueDeal, timer: due }, plan: { kind: "idle" } };

  // 2. Otherwise pick the best agent action.
  const active = state.deals.filter(isActive).length;
  const candidates: { deal: Deal; action: ActionType; score: number }[] = [];
  for (const d of state.deals) {
    const a = nextAction(d);
    if (!a) continue;
    if (requiresApproval(RISK[a], state.autonomy)) {
      const ap = latestApproval(state, d.id, a);
      if (ap?.decided === "approved" && !ap.consumed) {
        candidates.push({ deal: d, action: a, score: PRIORITY[a] + 5 }); // approved → do it promptly
      } else if (!ap) {
        candidates.push({ deal: d, action: a, score: PRIORITY[a] }); // need to request approval
      }
      // pending or rejected → deal is held, no candidate
      continue;
    }
    candidates.push({ deal: d, action: a, score: PRIORITY[a] });
  }

  // Keep the pipeline full early: prioritise sourcing when WIP is low.
  const canSource = state.backlog.length > 0 && active < MAX_WIP;
  if (canSource && active < MIN_WIP) return { plan: { kind: "source" } };

  if (candidates.length) {
    candidates.sort((x, y) => y.score - x.score || x.deal.createdTick - y.deal.createdTick);
    const best = candidates[0];
    if (requiresApproval(RISK[best.action], state.autonomy)) {
      const ap = latestApproval(state, best.deal.id, best.action);
      if (!ap) return { plan: { kind: "request_approval", deal: best.deal, action: best.action } };
    }
    return { plan: { kind: "act", deal: best.deal, action: best.action } };
  }

  if (canSource) return { plan: { kind: "source" } };
  return { plan: { kind: "idle" } };
}

// ── Event + artifact helpers ─────────────────────────────────────────────────

function makeEvent(state: BusinessState, e: EventDraft): AgentEvent {
  // decisionsLogged doubles as a monotonic event counter → unique ids even when
  // several events are minted before being pushed (e.g. a parallel dispatch).
  state.decisionsLogged += 1;
  return { id: seqId("ev", state.decisionsLogged), tick: state.tick, ...e };
}

/** Compose an artifact via the LLM, run compliance, rewrite to the safe template if blocked. */
async function produceArtifact(
  deal: Deal,
  kind: Artifact["kind"],
  useLLM: boolean,
): Promise<{ artifact: Artifact; note: string }> {
  const compose = async (force: boolean): Promise<string> => {
    const o = { useLLM: useLLM && !force };
    if (kind === "outreach") return composeOutreach(deal, o);
    if (kind === "claim_pack") return composeClaimPack(deal, o);
    return composeCouncilLetter(deal, o);
  };

  const titles: Record<Artifact["kind"], string> = {
    outreach: `Outreach to ${deal.business.contact}`,
    claim_pack: `Claim Pack — ${deal.business.name}`,
    council_letter: `Council letter — ${deal.business.borough}`,
    customer_update: `Update — ${deal.business.name}`,
  };

  const author: AgentId = kind === "outreach" ? "closer" : "caseworker";
  const artifact: Artifact = {
    id: seqId("art", deal.artifacts.length + 1),
    kind,
    author,
    title: titles[kind],
    body: await compose(false),
    createdTick: deal.updatedTick,
    review: null,
  };

  let verdict = reviewArtifact(deal, artifact);
  let note = verdict.pass
    ? "passed compliance on first review"
    : `blocked (${verdict.reasons.join("; ")}) — rewrote with the safe template`;
  if (!verdict.pass) {
    artifact.body = await compose(true); // deterministic, compliance-clean template
    verdict = reviewArtifact(deal, artifact);
  }
  artifact.review = verdict;
  return { artifact, note };
}

// ── Performing one agent action ──────────────────────────────────────────────

async function performAction(
  state: BusinessState,
  deal: Deal,
  action: ActionType,
  useLLM: boolean,
): Promise<AgentEvent[]> {
  const agent = ACTOR[action];
  const events: AgentEvent[] = [];
  deal.updatedTick = state.tick;
  // These actions craft their own narration; everything else gets a reasoning line.
  const reasoning =
    action === "outreach" || action === "hold_no_consent"
      ? ""
      : await agentReasoning(agent, action, deal, { useLLM });

  switch (action) {
    case "scan": {
      const a = assessProspect(deal.business);
      deal.findings = a.findings;
      deal.money = a.money;
      deal.confidence = a.confidence;
      deal.stage = "scanning";
      deal.history.push(`Scanned: ${gbp(a.money.estAnnualSaving)}/yr est. (${a.confidence})`);
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Scanned ${deal.business.name} — engine: ${gbp(a.money.estAnnualSaving)}/yr potential`,
        money: deal.money,
      }));
      break;
    }
    case "qualify": {
      deal.stage = "qualified";
      deal.history.push("Qualified");
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Qualified ${deal.business.name} (${deal.confidence} confidence)`,
        money: deal.money,
      }));
      break;
    }
    case "disqualify": {
      deal.stage = "disqualified";
      deal.history.push("Disqualified — no claimable annual relief");
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Disqualified ${deal.business.name} — no claimable relief, not pursuing`,
      }));
      break;
    }
    case "hold_no_consent": {
      // Consent gate: eligible, but no opt-in on file → never cold-contact.
      deal.stage = "needs_optin";
      deal.history.push("Held: no consent on file — cannot contact (cold outreach is not allowed)");
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], blocked: true,
        reasoning: "No consent/opt-in on file. The PRD bans cold outreach, so this owner can't be contacted until they opt in.",
        headline: `🛡️ Holding ${deal.business.name} — eligible but no consent to contact`,
      }));
      break;
    }
    case "outreach": {
      const drafts = await prepareOutreach(deal, useLLM, state.tick);
      for (const d of drafts) events.push(makeEvent(state, d));
      break;
    }
    case "generate_pack": {
      const { artifact, note } = await produceArtifact(deal, "claim_pack", useLLM);
      deal.artifacts.push(artifact);
      deal.stage = "pack_delivered";
      deal.history.push("Claim pack generated + delivered");
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Generated + delivered the £49 claim pack for ${deal.business.name}`,
      }));
      events.push(complianceEvent(state, deal, artifact, note));
      break;
    }
    case "open_case": {
      deal.stage = "awaiting_authorization";
      deal.history.push("Admin case opened — awaiting authorization");
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Opened done-for-you case for ${deal.business.name} — awaiting authorization`,
      }));
      break;
    }
    case "request_authorization": {
      deal.waitUntil = state.tick + DELAY_LOA;
      deal.history.push("Letter of Authority requested");
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Requested signed Letter of Authority from ${deal.business.contact}`,
      }));
      break;
    }
    case "draft_letter": {
      // HARD GATE: never draft a council letter without authorization.
      if (!deal.authorized) {
        events.push(makeEvent(state, {
          agent: "compliance", action, dealId: deal.id, risk: "high", blocked: true,
          reasoning: "Blocked by the authorization gate: no signed Letter of Authority on file.",
          headline: `🛑 Refused to draft council letter for ${deal.business.name} — not authorized`,
        }));
        break;
      }
      const { artifact, note } = await produceArtifact(deal, "council_letter", useLLM);
      deal.artifacts.push(artifact);
      deal.stage = "ready_to_submit";
      deal.history.push("Council letter drafted — ready to submit");
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Drafted council relief letter for ${deal.business.name}`,
      }));
      events.push(complianceEvent(state, deal, artifact, note));
      break;
    }
    case "submit_to_council": {
      if (!deal.authorized) {
        events.push(makeEvent(state, {
          agent: "compliance", action, dealId: deal.id, risk: "high", blocked: true,
          reasoning: "Blocked by the authorization gate: cannot submit without signed authority.",
          headline: `🛑 Refused to submit ${deal.business.name} — not authorized`,
        }));
        break;
      }
      deal.stage = "submitted";
      deal.waitUntil = state.tick + DELAY_COUNCIL;
      deal.history.push(`Submitted to ${deal.business.borough} council`);
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Submitted ${deal.business.name}'s authorised application to ${deal.business.borough} council`,
      }));
      break;
    }
    case "close": {
      deal.stage = "closed";
      deal.history.push("Closed");
      events.push(makeEvent(state, {
        agent, action, dealId: deal.id, risk: RISK[action], reasoning,
        headline: `Closed ${deal.business.name}'s case`,
      }));
      break;
    }
  }
  return events;
}

function complianceDraft(deal: Deal, artifact: Artifact, note: string): EventDraft {
  const v = artifact.review!;
  return {
    agent: "compliance",
    action: "qualify", // label only; compliance reviews are informational
    dealId: deal.id,
    risk: "low",
    blocked: !v.pass,
    reasoning: v.reasons.join("; "),
    headline: v.pass
      ? `Reviewed ${artifact.kind.replace("_", " ")} for ${deal.business.name} — PASS (${note})`
      : `BLOCKED ${artifact.kind.replace("_", " ")} for ${deal.business.name}`,
  };
}

function complianceEvent(state: BusinessState, deal: Deal, artifact: Artifact, note: string): AgentEvent {
  return makeEvent(state, complianceDraft(deal, artifact, note));
}

/**
 * Compose → compliance-check → SEND one outbound contact, mutating the deal.
 * Returns event drafts (no ids) so it can be run in parallel and the caller
 * assigns ids afterwards. Shared by the sequential loop and the dispatcher.
 */
async function prepareOutreach(deal: Deal, useLLM: boolean, tick: number, visualize = false): Promise<EventDraft[]> {
  deal.updatedTick = tick;
  const reasoning = await agentReasoning("closer", "outreach", deal, { useLLM });
  const { artifact, note } = await produceArtifact(deal, "outreach", useLLM);
  deal.artifacts.push(artifact);
  const sent = await sendOutbound(deal, artifact, { simulateLatency: visualize });
  deal.stage = "contacted";
  deal.waitUntil = tick + DELAY_CUSTOMER;
  deal.history.push(`Outreach ${sent.simulated ? "(sandbox) " : ""}via ${deal.channel} — ${sent.detail}`);
  return [
    {
      agent: "closer",
      action: "outreach",
      dealId: deal.id,
      risk: RISK.outreach,
      reasoning,
      channel: deal.channel,
      headline: `${channelVerb(deal.channel)} ${deal.business.contact} at ${deal.business.name}${sent.simulated ? " (sandbox)" : ""}`,
    },
    complianceDraft(deal, artifact, note),
  ];
}

/** Bounded-concurrency map — runs at most `limit` tasks at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Resolving a world reply (customer / LoA / council) ───────────────────────

function resolveTimer(state: BusinessState, deal: Deal, timer: Timer): AgentEvent[] {
  const events: AgentEvent[] = [];
  deal.waitUntil = null;
  deal.updatedTick = state.tick;

  if (timer === "customer_reply") {
    const p = draw(deal, "convert");
    const convertProb = deal.confidence === "high" ? 0.78 : deal.confidence === "medium" ? 0.55 : 0.35;
    if (p < convertProb) {
      // Bigger backdated estimates skew towards done-for-you admin support.
      const wantsAdmin = draw(deal, "product") < (deal.money.estBackdated >= 3000 ? 0.55 : 0.3);
      const product: "claim_pack" | "admin_support" = wantsAdmin ? "admin_support" : "claim_pack";
      const price = PRICES[product];
      deal.product = product;
      deal.stage = product === "admin_support" ? "won_admin" : "won_claim_pack";
      deal.history.push(`Customer bought ${product === "admin_support" ? "£199 admin support" : "£49 claim pack"}`);
      state.finances.revenue += price;
      state.finances.customers += 1;
      events.push(makeEvent(state, {
        agent: "closer", action: "convert", dealId: deal.id, risk: "low",
        reasoning: `${deal.business.contact} saw the free council route first, then chose to pay for help.`,
        headline: `📥 ${deal.business.contact} bought ${product === "admin_support" ? "£199 Admin Support" : "£49 Claim Pack"}`,
      }));
      events.push(makeEvent(state, {
        agent: "cfo", action: "convert", dealId: deal.id, risk: "low",
        reasoning: "No success fee, no charge on future savings — flat MVP pricing.",
        headline: `💷 Booked ${gbp(price)} — revenue now ${gbp(state.finances.revenue)}`,
      }));
    } else {
      deal.stage = "lost";
      deal.history.push("Customer will apply themselves (free route)");
      events.push(makeEvent(state, {
        agent: "closer", action: "lose", dealId: deal.id, risk: "low",
        reasoning: "Customer chose the free council route — exactly the option we lead with. Closed politely.",
        headline: `📥 ${deal.business.contact} will apply themselves for free — closed`,
      }));
    }
    return events;
  }

  if (timer === "loa_signed") {
    deal.authorized = true;
    deal.stage = "authorized";
    deal.history.push("Letter of Authority signed");
    events.push(makeEvent(state, {
      agent: "caseworker", action: "request_authorization", dealId: deal.id, risk: "low",
      reasoning: "Signed authority captured with timestamp — the submission gate is now unlocked.",
      headline: `✍️ Letter of Authority signed by ${deal.business.contact}`,
    }));
    return events;
  }

  // council_decision
  const r = draw(deal, "council");
  let confirmed = 0;
  let label = "";
  if (r < 0.6) {
    confirmed = Math.round(deal.money.estBackdated);
    label = "confirmed relief in full";
  } else if (r < 0.9) {
    confirmed = Math.round(deal.money.estBackdated * 0.5);
    label = "confirmed partial relief";
  } else {
    confirmed = 0;
    label = "did not confirm relief";
  }
  deal.money.confirmedBackdated = confirmed;
  deal.stage = "outcome_recorded";
  state.finances.clientValueDelivered += confirmed;
  deal.history.push(`Council ${label}: ${gbp(confirmed)} confirmed`);
  events.push(makeEvent(state, {
    agent: "caseworker", action: "record_outcome", dealId: deal.id, risk: "low",
    reasoning: `Outcome recorded with the council's reference as the source of truth. ${label}.`,
    headline: `🏛️ ${deal.business.borough} council ${label} for ${deal.business.name} — ${gbp(confirmed)}`,
    money: deal.money,
  }));
  if (confirmed > 0) {
    events.push(makeEvent(state, {
      agent: "cfo", action: "record_outcome", dealId: deal.id, risk: "low",
      reasoning: "Client value delivered. No success fee charged in the MVP.",
      headline: `💷 ${gbp(confirmed)} recovered for the client — value delivered now ${gbp(state.finances.clientValueDelivered)}`,
    }));
  }
  return events;
}

// ── Sourcing ─────────────────────────────────────────────────────────────────

async function sourceProspect(state: BusinessState, useLLM: boolean): Promise<AgentEvent[]> {
  const p = state.backlog.shift()!;
  const deal: Deal = {
    id: seqId("deal", state.deals.length + 1),
    business: p,
    stage: "sourced",
    product: null,
    money: { estAnnualSaving: 0, estBackdated: 0, confirmedBackdated: null },
    findings: [],
    confidence: "none",
    channel: p.channel,
    consent: p.consent,
    consentSource: p.consentSource,
    authorized: false,
    artifacts: [],
    history: ["Sourced into pipeline"],
    waitUntil: null,
    createdTick: state.tick,
    updatedTick: state.tick,
  };
  state.deals.push(deal);
  const reasoning = await agentReasoning("scout", "source", deal, { useLLM });
  return [
    makeEvent(state, {
      agent: "scout", action: "source", dealId: deal.id, risk: "low", reasoning,
      headline: `Sourced ${p.name} — ${p.sector} in ${p.borough}`,
    }),
  ];
}

// ── Public API: one tick ─────────────────────────────────────────────────────

export interface TickOptions {
  useLLM?: boolean;
}

export async function tick(prev: BusinessState, opts: TickOptions = {}): Promise<TickResult> {
  const useLLM = opts.useLLM ?? false;
  const state: BusinessState = structuredClone(prev);

  if (!state.running) {
    return { state, events: [] };
  }

  state.tick += 1;
  let events: AgentEvent[] = [];

  const { timer, plan } = planTick(state);

  if (timer) {
    events = resolveTimer(state, timer.deal, timer.timer);
  } else if (plan.kind === "source") {
    events = await sourceProspect(state, useLLM);
  } else if (plan.kind === "act") {
    const deal = state.deals.find((d) => d.id === plan.deal.id)!;
    events = await performAction(state, deal, plan.action, useLLM);
    // consume an approval if this action was gated + approved
    const ap = latestApproval(state, deal.id, plan.action);
    if (ap?.decided === "approved") ap.consumed = true;
  } else if (plan.kind === "request_approval") {
    const deal = state.deals.find((d) => d.id === plan.deal.id)!;
    const approval: Approval = {
      id: seqId("ap", state.approvals.length + 1),
      dealId: deal.id,
      action: plan.action,
      agent: ACTOR[plan.action],
      risk: RISK[plan.action],
      summary: approvalSummary(deal, plan.action),
      createdTick: state.tick,
      decided: null,
    };
    state.approvals.push(approval);
    events = [
      makeEvent(state, {
        agent: ACTOR[plan.action], action: plan.action, dealId: deal.id, risk: plan.action ? RISK[plan.action] : "high",
        blocked: true,
        reasoning: `This action is above the '${state.autonomy}' autonomy threshold — pausing for your approval.`,
        headline: `⏸️ Needs your approval: ${approval.summary}`,
      }),
    ];
  }
  // plan.kind === "idle" → no events; company is caught up.

  // Bookkeeping + live agent status. (ids/counter handled in makeEvent.)
  state.events.push(...events);
  for (const a of ALL_AGENTS) state.agentStatus[a] = "idle";
  for (const e of events) state.agentStatus[e.agent] = e.blocked ? "blocked" : "working";

  return { state, events };
}

function approvalSummary(deal: Deal, action: ActionType): string {
  if (action === "submit_to_council")
    return `submit ${deal.business.name} to ${deal.business.borough} council (${gbp(deal.money.estBackdated)} at stake)`;
  if (action === "outreach") return `contact ${deal.business.contact} at ${deal.business.name}`;
  if (action === "draft_letter") return `draft a council letter for ${deal.business.name}`;
  if (action === "request_authorization") return `request authority from ${deal.business.contact}`;
  return `${action} for ${deal.business.name}`;
}

// ── Parallel outbound campaign ───────────────────────────────────────────────

export interface DispatchOptions {
  useLLM?: boolean;
  concurrency?: number;
  /** Add a small per-contact "connecting" delay so concurrency is observable in
   * the UI. Default true; set false for headless/test runs. */
  simulateLatency?: boolean;
}

export interface DispatchResult {
  state: BusinessState;
  events: AgentEvent[];
  dispatched: number;
  skipped: number;
}

/**
 * Fire outbound contact to every qualified+consented owner AT ONCE.
 *
 * This is where the workforce "initiates" — voice calls, WhatsApp and email go
 * out concurrently (bounded by `concurrency`), so the wall-clock is the slowest
 * single contact, not the sum. Owners with no consent on file are NOT contacted
 * — they're surfaced as skipped and held (PRD bans cold outreach). One logical
 * step: all events share a batch id and the current tick.
 */
export async function dispatchOutbound(prev: BusinessState, opts: DispatchOptions = {}): Promise<DispatchResult> {
  const useLLM = opts.useLLM ?? false;
  const visualize = opts.simulateLatency ?? true;
  const concurrency = Math.min(Math.max(1, opts.concurrency ?? 6), 12);
  const state: BusinessState = structuredClone(prev);
  if (!state.running) return { state, events: [], dispatched: 0, skipped: 0 };

  state.tick += 1;
  const batch = seqId("batch", state.tick);

  const ready = state.deals.filter((d) => d.stage === "qualified" && d.consent && d.waitUntil === null);
  const noConsent = state.deals.filter((d) => d.stage === "qualified" && !d.consent);

  // Contact the consented owners concurrently. Each task is self-contained
  // (mutates its own deal, returns drafts) so there are no cross-task races.
  const batches = await mapLimit(ready, concurrency, async (d) => {
    try {
      return await prepareOutreach(d, useLLM, state.tick, visualize);
    } catch {
      return [] as EventDraft[];
    }
  });

  // Hold the non-consented owners.
  for (const d of noConsent) {
    d.stage = "needs_optin";
    d.updatedTick = state.tick;
    d.history.push("Held: no consent on file — cannot contact (cold outreach is not allowed)");
  }

  const drafts: EventDraft[] = [];
  if (ready.length) {
    drafts.push({
      agent: "orchestrator",
      action: "outreach",
      dealId: null,
      risk: "medium",
      batch,
      reasoning: `Firing ${ready.length} contact${ready.length > 1 ? "s" : ""} concurrently across voice, WhatsApp and email; ${noConsent.length} eligible owner(s) skipped for lack of consent.`,
      headline: `📣 Outbound campaign — contacting ${ready.length} consented owner${ready.length > 1 ? "s" : ""} in parallel`,
    });
  }
  for (const b of batches) for (const d of b) drafts.push({ ...d, batch });
  for (const d of noConsent) {
    drafts.push({
      agent: "compliance",
      action: "hold_no_consent",
      dealId: d.id,
      risk: "low",
      blocked: true,
      batch,
      reasoning: "No consent on file — cold outreach is not allowed.",
      headline: `🛡️ Skipped ${d.business.name} — no consent to contact`,
    });
  }

  const events = drafts.map((d) => makeEvent(state, d));
  state.events.push(...events);
  for (const a of ALL_AGENTS) state.agentStatus[a] = "idle";
  for (const e of events) state.agentStatus[e.agent] = e.blocked ? "blocked" : "working";

  return { state, events, dispatched: ready.length, skipped: noConsent.length };
}

// ── Human approval handling (called from the API on the human's behalf) ──────

export function decideApproval(prev: BusinessState, approvalId: string, decision: "approved" | "rejected"): BusinessState {
  const state: BusinessState = structuredClone(prev);
  const ap = state.approvals.find((a) => a.id === approvalId);
  if (!ap || ap.decided) return state;
  ap.decided = decision;
  const deal = state.deals.find((d) => d.id === ap.dealId);
  if (deal) {
    deal.history.push(`Human ${decision} '${ap.action}'`);
    if (decision === "rejected") {
      // Park the deal: it stays put, held by the human. (Oversight in action.)
      deal.history.push("Held by human — not actioned");
    }
  }
  return state;
}

/** Qualified owners waiting for a parallel outbound campaign. */
export function outreachReady(state: BusinessState): { toContact: number; toHold: number } {
  let toContact = 0;
  let toHold = 0;
  for (const d of state.deals) {
    if (d.stage !== "qualified") continue;
    if (d.consent) toContact++;
    else toHold++;
  }
  return { toContact, toHold };
}

/** Whether there is any more sequential (tick) work to do. */
export function hasWork(state: BusinessState): boolean {
  if (!state.running) return false;
  if (state.backlog.length > 0 && state.deals.filter(isActive).length < MAX_WIP) return true;
  for (const d of state.deals) {
    if (d.waitUntil !== null) return true; // a world reply (timer) is pending
    const a = nextAction(d);
    if (!a) continue;
    if (requiresApproval(RISK[a], state.autonomy)) {
      const ap = latestApproval(state, d.id, a);
      if (ap?.decided === "approved" && !ap.consumed) return true;
      if (!ap) return true;
      continue; // pending/rejected → not actionable by the loop
    }
    return true;
  }
  return false;
}
