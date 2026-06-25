/**
 * Stella Autonomous — type system for the self-running business.
 *
 * The "Hands-Off" version of Stella turns the human-operated commercial product
 * described in the PRD (free scan → claim pack → done-for-you admin support)
 * into a workforce of AI agents that run the business while a human only
 * supervises a Mission Control console.
 *
 * SACRED RULE (inherited from the rest of the codebase): every £ figure is
 * computed by the deterministic relief engine. Agents reason and write prose;
 * they never invent, alter, or recalculate money. See `compliance.ts` for the
 * money-trace guard that enforces this on agent output.
 *
 * The whole runtime is a pure reducer: `tick(state) → { state, events }`.
 * State lives client-side (the console) and on each tick is handed to the
 * server, which runs one agent action and returns the next state. This makes
 * the autonomous loop fully demoable on stateless serverless with no database.
 */

import type { ReliefFinding } from "../engines/relief";

// ── Agents ──────────────────────────────────────────────────────────────────

export type AgentId =
  | "orchestrator"
  | "scout"
  | "analyst"
  | "closer"
  | "caseworker"
  | "compliance"
  | "cfo";

export type AgentStatus = "idle" | "working" | "blocked";

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  /** One-line description of what this agent owns in the business. */
  charter: string;
  /** System prompt used when this agent reasons via the LLM. */
  system: string;
  emoji: string;
}

// ── Pipeline (a "deal" = one prospect moving through the business) ───────────

export type Stage =
  | "sourced" //            Scout found a prospect
  | "scanning" //           Analyst running the deterministic engine
  | "qualified" //          worth pursuing
  | "disqualified" //       no claimable relief — dropped (ethically)
  | "contacted" //          Closer sent the free-scan + offer
  | "won_claim_pack" //     customer bought the £49 DIY claim pack
  | "won_admin" //          customer bought the £199 admin support
  | "lost" //               customer declined
  | "pack_delivered" //     claim pack generated + delivered
  | "awaiting_authorization" // admin case opened, needs Letter of Authority
  | "authorized" //         signed LoA captured
  | "ready_to_submit" //    council letter drafted + compliance-passed
  | "submitted" //          submitted to the billing authority
  | "awaiting_council" //   waiting on the council's decision
  | "outcome_recorded" //   council confirmed an outcome
  | "closed"; //            case complete

export type Product = "claim_pack" | "admin_support";

export interface Money {
  /** £/yr potential saving — from the deterministic engine, never the LLM. */
  estAnnualSaving: number;
  /** £ conservative backdated estimate — from the engine. */
  estBackdated: number;
  /** £ council-confirmed backdated recovery — set only on a real outcome. */
  confirmedBackdated: number | null;
}

export interface Artifact {
  id: string;
  kind: "outreach" | "claim_pack" | "council_letter" | "customer_update";
  /** Which agent authored it. */
  author: AgentId;
  title: string;
  body: string;
  createdTick: number;
  /** Compliance verdict, set once the Compliance agent reviews it. */
  review: ComplianceVerdict | null;
}

export interface Deal {
  id: string;
  business: ProspectBusiness;
  stage: Stage;
  product: Product | null;
  money: Money;
  /** Headline relief findings from the engine (drives prose + UI). */
  findings: ReliefFinding[];
  confidence: "high" | "medium" | "low" | "none";
  /** Channel the Closer reaches the customer on. */
  channel: "email" | "whatsapp";
  authorized: boolean;
  artifacts: Artifact[];
  /** Human-readable trail of what happened to this deal. */
  history: string[];
  /** Tick at which a pending simulated reply (customer/council) lands. */
  waitUntil: number | null;
  createdTick: number;
  updatedTick: number;
}

// ── Seeded prospect (carries real RV/sector so the engine computes real £) ──

export interface ProspectBusiness {
  name: string;
  postcode: string;
  borough: string;
  sector: string;
  rateableValue: number;
  uarn: string;
  address: string;
  /** Decision-maker name the agents address (simulated). */
  contact: string;
}

// ── Safety & oversight ──────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

export interface ComplianceVerdict {
  pass: boolean;
  /** Why it passed/failed — surfaced in the audit log. */
  reasons: string[];
  /** Banned phrases detected (PRD §8.2). */
  bannedHits: string[];
  /** Required disclosures that were missing. */
  missingDisclosures: string[];
  /** £ figures in the text that do NOT trace to the engine (sacred-rule breach). */
  untracedFigures: string[];
  reviewedBy: AgentId;
}

/**
 * An action the orchestrator wants to take that exceeds the current autonomy
 * level and must be approved by a human before it proceeds.
 */
export interface Approval {
  id: string;
  dealId: string;
  action: ActionType;
  agent: AgentId;
  risk: RiskLevel;
  summary: string;
  createdTick: number;
  decided: "approved" | "rejected" | null;
  /** Set once an approved action has been carried out (so it isn't re-run). */
  consumed?: boolean;
}

/** How much the human has handed off. */
export type AutonomyLevel = "supervised" | "assisted" | "autopilot";

// ── Events (the live activity feed) ─────────────────────────────────────────

export type ActionType =
  | "source"
  | "scan"
  | "qualify"
  | "disqualify"
  | "outreach"
  | "convert"
  | "lose"
  | "generate_pack"
  | "open_case"
  | "request_authorization"
  | "draft_letter"
  | "submit_to_council"
  | "record_outcome"
  | "close";

export interface AgentEvent {
  id: string;
  tick: number;
  agent: AgentId;
  action: ActionType;
  dealId: string | null;
  /** One-line headline for the feed. */
  headline: string;
  /** The agent's reasoning (LLM-generated or templated fallback). */
  reasoning: string;
  risk: RiskLevel;
  /** Money snapshot at the moment of the event (display only). */
  money?: Partial<Money>;
  blocked?: boolean;
}

// ── Top-level business state ────────────────────────────────────────────────

export interface Finances {
  /** Cash actually collected from customers (claim packs + admin support). */
  revenue: number;
  /** Sum of confirmed backdated recovery delivered to customers. */
  clientValueDelivered: number;
  /** Count of paying customers. */
  customers: number;
}

export interface BusinessState {
  /** Monotonic logical clock. One tick ≈ one agent decision. */
  tick: number;
  autonomy: AutonomyLevel;
  /** Master kill switch — when false the loop refuses to act. */
  running: boolean;
  deals: Deal[];
  events: AgentEvent[];
  approvals: Approval[];
  finances: Finances;
  agentStatus: Record<AgentId, AgentStatus>;
  /** Prospects not yet sourced into the pipeline (Scout's backlog). */
  backlog: ProspectBusiness[];
  /** Append-only audit count for the header. */
  decisionsLogged: number;
}

export interface TickResult {
  state: BusinessState;
  /** Events produced by this single tick (usually one). */
  events: AgentEvent[];
}
