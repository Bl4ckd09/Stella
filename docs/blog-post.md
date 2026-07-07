# Building a business that runs itself — on Qwen Cloud

*Submitted for the Blog Post Award, Global AI Hackathon Series with Qwen Cloud.*

Most "AI agent" demos are chatbots with extra steps. I wanted to build something
that does a real, high-stakes job end-to-end — and holds itself to the standards
that job actually requires. So I built **Stella**: a self-running business that
recovers unclaimed UK Small Business Rate Relief, operated by seven AI agents on
Qwen Cloud, where a human supervises but holds only a kill switch.

## The job is real, and that's the point

Hundreds of thousands of eligible UK small businesses never claim the rate relief
they're owed. It isn't automatic, the paperwork deters owners, and the recovery
market is full of misleading no-win-no-fee cold outreach. That makes it a perfect
Autopilot-track problem: repetitive, compliance-heavy, and involving real money
and regulated claims — the kind of workflow where "the model got it mostly right"
is not good enough.

## Two rules that shaped everything

**Rule 1: the model never touches the money.** Every £ figure comes from a
deterministic relief engine with 1,441 parity tests. The Qwen models write prose;
they never compute or alter a number. A money-trace guard re-derives the allowed
figures and blocks any number in agent output that doesn't match.

**Rule 2: safety is structural, not a prompt.** Every outbound artifact passes a
compliance gate — banned-claim scan, required-disclosure check — or is rewritten
to a safe template and re-checked. Consent and authorization are hard gates.
High-risk actions pause for a human.

## Where Qwen Cloud earns its place

The port was almost free — Qwen Cloud is OpenAI-compatible, so a base-URL swap
pointed my existing two-tier LLM seam at
`dashscope-intl.aliyuncs.com/compatible-mode/v1`. That freed the time to go deep
instead of wide, using four Qwen models each for what it's best at:

- **`qwen3.7-max`** writes the customer and council documents.
- **`qwen3.6-flash`** runs the high-volume agent loop.
- **Native function calling** drives the planner: the Chief-of-Staff agent picks
  the next action as a structured `tools` call among candidates the system has
  already vetted — not brittle prompt-parsing.
- **`text-embedding-v4` + `qwen3-rerank`** give the workforce a cross-session
  **experience memory**. It records every outcome and recalls the relevant ones
  at decision time, so the agents' choices improve as history accumulates.

That last piece produced my favourite moment. In a live run, the planner
overrode its default priority order and explained why — citing a *remembered*
outcome from an earlier, similar business. The system had learned something and
used it, in front of me, unscripted.

## The shape that made it work

The whole runtime is a pure, replayable reducer: `tick(state) → {state, events}`.
State lives in the browser; the server is stateless. No database is needed for the
autonomous demo, every run is deterministic, and — critically — every Qwen call
has a compliant template fallback, so a model hiccup never stops the business or
breaks a rule.

1,490 tests, all green. A business that runs itself — safely — on Qwen Cloud.

*Code: https://github.com/Bl4ckd09/Stella*
