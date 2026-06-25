/**
 * Reasoning layer — turns engine facts into the agents' words.
 *
 * Every function here either calls Claude (with the acting agent's system
 * prompt) or, if the LLM is unavailable / disabled / errors, returns a
 * deterministic template. BOTH paths are written to satisfy the compliance
 * guard (free-route disclosure, estimate caveat, only engine figures), so the
 * autonomous loop always makes forward progress and never emits unsafe copy.
 *
 * The £ figures passed to the LLM are presented as authoritative facts and the
 * system prompts forbid changing them — but we still run the output through the
 * compliance guard afterwards, so a hallucinated figure is caught regardless.
 */
import { AGENTS } from "./roster";
import { gbp } from "./format";
import { councilApplyUrl } from "./prospects";
import type { ActionType, AgentId, Deal } from "./types";
import { reason, artifact, reasonAvailable, artifactAvailable } from "../llm";

interface ReasonOpts {
  useLLM: boolean;
}

/** Profile-only context for pre-scan actions (no engine figures exist yet). */
function factsProfile(deal: Deal): string {
  const b = deal.business;
  return [
    `Prospect: ${b.name} (${b.sector}) — ${b.address}, ${b.postcode}`,
    `Borough / billing authority: ${b.borough}`,
    `Rateable value (VOA): ${gbp(b.rateableValue)}`,
    `Note: the relief engine has not run yet — do NOT state any saving figures.`,
  ].join("\n");
}

/** Compact, authoritative fact sheet handed to the LLM. */
function facts(deal: Deal): string {
  const b = deal.business;
  const lines = [
    `Business: ${b.name} (${b.sector}) — ${b.address}, ${b.postcode}`,
    `Borough / billing authority: ${b.borough}`,
    `Owner contact: ${b.contact}`,
    `Rateable value: ${gbp(b.rateableValue)}`,
    `Estimated annual saving (engine): ${gbp(deal.money.estAnnualSaving)}`,
    `Estimated backdated amount (engine): ${gbp(deal.money.estBackdated)}`,
    `Confidence: ${deal.confidence}`,
    `Relief findings (engine):`,
    ...deal.findings.map((f) => `  - ${f.headline} — ${gbp(f.annual_value)}/yr (${f.confidence})`),
  ];
  return lines.join("\n");
}

/** Short reasoning lines run on the FAST/cheap tier (e.g. a small Modal model). */
async function reasonLine(agent: AgentId, prompt: string, maxTokens: number): Promise<string | null> {
  if (!reasonAvailable()) return null;
  try {
    return await reason(prompt, { system: AGENTS[agent].system, maxTokens });
  } catch {
    return null;
  }
}

/** Customer/council artifacts run on the QUALITY tier (e.g. Claude). */
async function artifactText(agent: AgentId, prompt: string, maxTokens: number): Promise<string | null> {
  if (!artifactAvailable()) return null;
  try {
    return await artifact(prompt, { system: AGENTS[agent].system, maxTokens });
  } catch {
    return null;
  }
}

// ── Short reasoning lines for the activity feed ─────────────────────────────

const TEMPLATE_REASON: Record<ActionType, (d: Deal) => string> = {
  source: (d) => `Sourced ${d.business.name} (${d.business.sector}, ${d.business.borough}) — an SBRR-eligible profile worth scanning.`,
  scan: (d) => `Ran the deterministic relief engine on ${d.business.name}; figures come straight from the engine.`,
  qualify: (d) => `${d.business.name} shows ${gbp(d.money.estAnnualSaving)}/yr potential at ${d.confidence} confidence — worth pursuing.`,
  disqualify: (d) => `${d.business.name} has no claimable annual relief; dropping it rather than inventing an opportunity.`,
  hold_no_consent: (d) => `${d.business.name} is eligible but has no consent on file — cannot contact without an opt-in.`,
  outreach: (d) => `Reaching out to ${d.business.contact} at ${d.business.name} with the free-scan summary and options.`,
  convert: (d) => `${d.business.name} chose a paid option after seeing the free route — booking it.`,
  lose: (d) => `${d.business.name} declined or chose the free council route; closing politely.`,
  generate_pack: (d) => `Preparing the £49 claim pack for ${d.business.name} using only engine figures.`,
  open_case: (d) => `Opening a done-for-you case for ${d.business.name}; status starts at awaiting authorization.`,
  request_authorization: (d) => `Requesting a signed Letter of Authority before acting for ${d.business.name}.`,
  draft_letter: (d) => `Drafting the council relief letter for ${d.business.name}; compliance review required before submission.`,
  submit_to_council: (d) => `Submitting ${d.business.name}'s authorised application to ${d.business.borough} council.`,
  record_outcome: (d) => `Recording the council's confirmed outcome for ${d.business.name}.`,
  close: (d) => `Closing ${d.business.name}'s case — work complete.`,
};

export async function agentReasoning(
  agent: AgentId,
  action: ActionType,
  deal: Deal,
  opts: ReasonOpts,
): Promise<string> {
  const fallback = TEMPLATE_REASON[action](deal);
  if (!opts.useLLM) return fallback;
  // Before the engine has run, reason from the prospect profile only — there
  // are no figures yet, and quoting £0 would be misleading.
  const preScan = action === "source" || action === "scan";
  const context = preScan ? factsProfile(deal) : facts(deal);
  const prompt = `Decision: ${action} for this deal.\n\n${context}\n\nIn ONE sentence, explain your reasoning for this action.${preScan ? "" : " Use exact figures only."}`;
  const out = await reasonLine(agent, prompt, 160);
  return out ?? fallback;
}

// ── Outbound artifacts ──────────────────────────────────────────────────────

export async function composeOutreach(deal: Deal, opts: ReasonOpts): Promise<string> {
  const fallback = [
    `Hi ${deal.business.contact},`,
    ``,
    `I ran a free business-rates scan for ${deal.business.name}. Based on public data, you may qualify for an estimated ${gbp(deal.money.estAnnualSaving)}/yr in Small Business Rate Relief (estimated backdated ${gbp(deal.money.estBackdated)}). These are estimates from public data and must be confirmed by your council.`,
    ``,
    `You can apply to ${deal.business.borough} council directly for free — that's always an option and I'll show you how. If you'd rather not deal with the paperwork:`,
    `• £49 Claim Pack — a prepared letter, checklist and council-specific instructions so you can apply yourself.`,
    `• £199 Done-for-you Admin Support — we prepare, send and chase the application after you authorise us.`,
    ``,
    `No success fee, no charge on future savings. Want me to send the free summary?`,
    `— Stella`,
  ].join("\n");
  if (!opts.useLLM) return fallback;
  const prompt = `Write the first outreach message.\n\n${facts(deal)}\n\nLead with the free council route, then offer the £49 claim pack and £199 admin support. Use the exact figures. End by asking if they want the free summary.`;
  const out = await artifactText("closer", prompt, 350);
  return out ?? fallback;
}

export async function composeClaimPack(deal: Deal, opts: ReasonOpts): Promise<string> {
  const b = deal.business;
  const findingsMd = deal.findings
    .map((f) => `### ${f.headline}\n- Estimated value: ${gbp(f.annual_value)}/yr\n- Confidence: ${f.confidence}\n- Action: ${f.action}\n- Source: ${f.source}`)
    .join("\n\n");
  const fallback = [
    `# Stella Claim Pack — ${b.name}`,
    ``,
    `**Property:** ${b.address}, ${b.postcode} (${b.borough}) · UARN ${b.uarn}`,
    `**Rateable value:** ${gbp(b.rateableValue)}`,
    `**Estimated annual saving:** ${gbp(deal.money.estAnnualSaving)} · **Estimated backdated:** ${gbp(deal.money.estBackdated)}`,
    `**Confidence:** ${deal.confidence}`,
    ``,
    `## Relief findings`,
    findingsMd || "_No relief findings._",
    ``,
    `## How to apply yourself for free`,
    `You can contact ${b.borough} council directly for free to check eligibility and apply: ${councilApplyUrl(b.borough)}. Small Business Rate Relief is not automatic — you must apply, and you can ask the council to backdate it.`,
    ``,
    `## Important`,
    `These figures are estimates based on public data and must be confirmed by your council. Stella does not guarantee approval, refund, credit, relief, or grant funding, and is not affiliated with or endorsed by any council, the VOA, GOV.UK, the FCA, or HMRC.`,
  ].join("\n");
  if (!opts.useLLM) return fallback;
  const prompt = `Write a concise claim-pack document (markdown).\n\n${facts(deal)}\nCouncil apply URL: ${councilApplyUrl(b.borough)}\n\nInclude: property summary, the relief findings with exact figures, how to apply free with the council, and the required estimate + no-guarantee disclaimers.`;
  const out = await artifactText("caseworker", prompt, 800);
  return out ?? fallback;
}

export async function composeCouncilLetter(deal: Deal, opts: ReasonOpts): Promise<string> {
  const b = deal.business;
  const reliefList = deal.findings.map((f) => `- ${f.headline} (estimated ${gbp(f.annual_value)}/yr)`).join("\n");
  const fallback = [
    `To: ${b.borough} Council — Business Rates Team`,
    `Re: Small Business Rate Relief — ${b.name}, ${b.address}, ${b.postcode} (UARN ${b.uarn})`,
    ``,
    `Dear Business Rates Team,`,
    ``,
    `I am writing on behalf of ${b.name}, with the business owner's signed authorisation, to apply for Small Business Rate Relief for the above premises (rateable value ${gbp(b.rateableValue)}).`,
    ``,
    `Based on public data we believe the following relief may apply and ask you to confirm and, where appropriate, backdate it:`,
    reliefList || "- Small Business Rate Relief",
    ``,
    `We understand the council makes the final eligibility decision. Please let us know what further evidence you require. A copy of the owner's authorisation is enclosed.`,
    ``,
    `Yours faithfully,`,
    `Stella, on behalf of ${b.contact}, ${b.name}`,
  ].join("\n");
  if (!opts.useLLM) return fallback;
  const prompt = `Write a formal letter to the council's business-rates team requesting Small Business Rate Relief on the customer's behalf (we hold signed authorisation).\n\n${facts(deal)}\n\nReference the property and UARN, list the relief sought with exact figures, acknowledge the council decides, and ask what evidence is needed. Do not guarantee any outcome.`;
  const out = await artifactText("caseworker", prompt, 600);
  return out ?? fallback;
}
