# Devpost submission — Stella

**Track:** Autopilot Agent
**Repo:** https://github.com/Bl4ckd09/Stella (branch `autonomous-agents`, MIT license)
**Deployment proof:** [docs/alibaba-cloud-proof.md](./alibaba-cloud-proof.md)
**Architecture diagram:** [docs/architecture.md](./architecture.md)

---

## Elevator pitch (one line)

A self-running business: seven Qwen-powered agents source, qualify, sell, and
file unclaimed UK business-rates relief end-to-end — with a deterministic money
engine, structural compliance gates, and a human holding only a kill switch.

## The problem

Hundreds of thousands of eligible UK small businesses never claim Small Business
Rate Relief — it isn't automatic, the paperwork deters owners, and the "recovery
agent" market is full of misleading no-win-no-fee cold outreach. The work is
real, repetitive, compliance-heavy, and high-stakes (real money, regulated
claims) — exactly the kind of business workflow the Autopilot track targets.

## What it does

Open `/hq`, press **Go hands-off**, and a workforce of seven agents runs the
business one world-step at a time:

- **Ada** (Chief of Staff) decides the next action each cycle.
- **Mara** sources SBRR-eligible prospects from public VOA data.
- **Devi** runs the deterministic relief engine and qualifies/disqualifies.
- **Theo** writes compliant offers and converts customers.
- **Iris** prepares claim packs and council letters, advancing cases.
- **Quinn** reviews *every* outbound artifact and can block it.
- **Otto** books revenue.

A human supervises via Mission Control: a live activity feed, an approval queue
for high-risk actions, an autonomy dial (supervised → assisted → autopilot), and
a hard kill switch.

## How Qwen Cloud makes it work

- **`qwen3.7-max`** writes the customer and council documents (the quality tier).
- **`qwen3.6-flash`** runs the high-volume agent loop.
- **Ada plans via native Qwen function calling** — she picks the next action as a
  structured `tools` call among candidates the system has already vetted for
  consent, approval, and work-in-progress limits.
- **`text-embedding-v4` + `qwen3-rerank`** give the workforce a **cross-session
  experience memory**: it records every outcome and recalls the relevant ones at
  decision time, so Ada's choices improve as history grows.

All four models are called over the OpenAI-compatible DashScope endpoint
(`dashscope-intl.aliyuncs.com/compatible-mode/v1`, Singapore/International).

## What makes it safe (structural, not advisory)

1. **Money-trace guard** re-derives the allowed £ figures and blocks any number
   in agent output that doesn't trace to the deterministic engine.
2. **Compliance gate** scans every artifact for banned claims and missing
   disclosures; failures are rewritten to a safe template and re-checked.
3. **Consent gate** — eligible-but-non-consented owners are held, never cold-contacted.
4. **Authorization gate** — no council letter without a signed Letter of Authority.
5. **Human approval queue** for actions above the autonomy threshold + kill switch.

## Technical highlights

- The whole runtime is a **pure, replayable reducer**: `tick(state) → {state, events}`.
  State lives in the console; the server is stateless. No database needed for the
  autonomous demo, and every run is deterministic and replayable.
- **1,490 tests** (1,441 engine-parity + agent runtime + new planner/memory) green.
- Null-safe LLM everywhere: any Qwen failure falls back to a compliant template,
  so the loop always makes forward progress.

## What we built during the submission period

Stella started as a Cursor "Hands Off" entry; for this hackathon it was
significantly rebuilt to be Qwen-native (all commits on the `qwen-cloud` branch):
the two-tier port to Qwen Cloud, the native function-calling planner, the
`text-embedding-v4` + `qwen3-rerank` experience-memory layer, DashScope-specific
hardening (thinking-mode off + rate-limit retry), 13 new tests, and a live
end-to-end Qwen smoke script.
