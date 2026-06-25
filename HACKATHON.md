# Stella · Hands-Off HQ

**Cursor "Hands Off" London Hackathon — a business that runs itself.**

> *"What if you could build a company… and not have to run it?"*

Stella already finds unclaimed UK Small Business Rate Relief for London SMBs (web +
phone, backed by a deterministic relief engine over 311k VOA properties and 5.6M
Companies House records). This branch (`autonomous-agents`) turns that product
into a **self-running business operated entirely by an AI workforce**, with the
founder reduced to a supervisor watching a Mission Control console — and a kill
switch.

Open **`/hq`**, press **▶ Go hands-off**, and walk away.

---

## What it does

A team of seven AI agents runs the whole commercial loop from the PRD
(`free scan → £49 claim pack → £199 done-for-you admin support`) with no human in
the loop except for approvals:

| Agent | Role | Owns |
|---|---|---|
| 🧭 **Ada** | Chief of Staff | Decides what happens next each cycle |
| 🔭 **Mara** | Acquisition | Sources SBRR-eligible prospects into the pipeline |
| 📊 **Devi** | Eligibility Analyst | Runs the deterministic engine, qualifies/disqualifies |
| ✉️ **Theo** | Outreach & Sales | Writes compliant offers, converts customers |
| 📁 **Iris** | Case Operations | Claim packs, council letters, advances cases |
| 🛡️ **Quinn** | Compliance & Oversight | Reviews **every** outbound artifact; can block |
| 💷 **Otto** | Finance | Books revenue, records confirmed client recoveries |

Each tick = one world-step: either the world responds (a customer replies, a
Letter of Authority is signed, a council decides) or one agent takes one action.
The console renders the live activity feed, the deal pipeline, P&L, the agent
roster, and the human approval queue.

---

## How it maps to the judging criteria

### 🔧 Technical execution
- A real **state-machine reducer** (`tick(state) → {state, events}`) drives a
  multi-agent business. Pure, replayable, stateless on the server — runs on
  serverless with **no database** required for the demo.
- Reuses Stella's **production deterministic relief engine** (`engines/relief.ts`,
  1,441 parity tests) so every £ figure is real, computed law, not a guess.
- LLM reasoning via Claude with a **deterministic fallback** for every call, so
  the loop never stalls and works with or without an API key.
- **1,475 tests pass** (incl. 18 new), clean `next build`, clean `tsc`.

### 🧠 Product thinking
- Implements the actual commercial ladder from the v2.0 PRD: free scan, paid
  claim pack, done-for-you admin support, with the exact pricing and the
  compliance-first positioning.
- Honours the real business constraint: this is a **regulated, trust-sensitive**
  domain, so the product is built to be *more* transparent than a claims company.

### 🤖 Agent autonomy
- Press **Go hands-off** and the company sources, scans, qualifies, sells,
  prepares paid work, drafts council letters, submits, and records outcomes on
  its own — sourcing 12 prospects to terminal outcomes, booking revenue and
  delivering client value, fully unattended.
- **Agents initiate, in parallel.** Outreach is a batch operation: qualified
  owners accumulate, then a single **outbound campaign** contacts them all at
  once (voice / WhatsApp / email) concurrently — wall-clock ≈ the slowest single
  contact, not the sum (a 5-contact batch completes in ~0.9s, not ~3s).
- An **autonomy dial** (`supervised → assisted → autopilot`) sets exactly how much
  is handed off.

### 💸 Cost-aware (two LLM tiers)
- The LLM layer has two tiers: a **fast/cheap** tier for the high-volume agent
  reasoning, and a **quality** tier for the customer/council documents. Mix
  providers freely — e.g. a small **Modal**-hosted open model for the loop and
  **Claude** for the letters — via env, no code change. Both default to Claude.

### 🎛️ UX clarity
- One screen: live KPIs, the agent org with live working/idle/blocked status, a
  7-column pipeline, a colour-coded activity feed with each agent's *reasoning*,
  and a drawer per deal showing the engine findings, every artifact, its
  compliance verdict, and the full history.

### 🌍 Real-world applicability
- Real UK business-rates relief, real VOA/Companies House data layer, real
  council workflow, real money. The same engine already powers a live web + phone
  product. Sandbox-ready hooks for hackathon partners (PayPal payments, Wassist
  WhatsApp outreach).

### 🛡️ Safety & oversight design *(this is the heart of it)*
The business is autonomous but **structurally constrained**:
1. **The sacred money rule** — agents never compute £. Every figure comes from the
   deterministic engine, and a pure compliance guard (`compliance.ts`) re-derives
   the allowed figure set and **blocks any £ that doesn't trace to the engine**.
2. **Compliance gate** — every outbound artifact is scanned for the PRD's banned
   claims ("owed", "guaranteed", "no win no fee", implied endorsement) and for
   required disclosures (the free council route, "estimate must be confirmed").
   Fail → the artifact is rewritten with the safe template and re-checked.
3. **Authorization gate (hard)** — a council letter cannot be drafted or submitted
   without a signed Letter of Authority on file. Tested: **0 breaches** across a
   full run.
4. **Consent gate on outbound** — the workforce only calls/messages owners who
   opted in. Eligible-but-non-consented owners are surfaced and **held**
   (`needs_optin`), never cold-contacted — the PRD bans cold outreach. Outbound
   is sandbox-simulated unless `STELLA_LIVE_OUTBOUND=true`.
5. **Human approval queue** — actions above the autonomy threshold (e.g.
   submitting to a council on a customer's behalf) pause and wait for a human.
6. **Kill switch** — flip `running` off and the loop refuses to act.
7. **Full audit trail** — every decision is an event with the agent, action, risk,
   reasoning, and money snapshot.

---

## Run it

```bash
npm install
npm run dev            # open http://localhost:3000/hq
# or
npm test               # 1,475 tests incl. the agent runtime
```

- **No keys needed** for the core demo — the workforce runs on the deterministic
  engine + templated reasoning.
- Set `ANTHROPIC_API_KEY` and toggle **AI reasoning** in `/hq` for live
  Claude-written reasoning and artifacts.

## Where the code lives

```
src/lib/agents/
  types.ts          state, deal, agent, event types (+ consent, channels)
  roster.ts         the 7 agents + their system prompts
  prospects.ts      seeded London businesses (fed to the real engine)
  compliance.ts     the safety guard (banned copy, disclosures, money trace)
  reasoning.ts      LLM prose + deterministic fallbacks (fast/quality tiers)
  integrations.ts   outbound adapters (voice/WhatsApp/email; sandbox-safe)
  orchestrator.ts   the autonomous tick loop + parallel dispatcher + approvals
src/lib/llm.ts               two-tier provider seam (Anthropic | OpenAI/Modal)
src/app/api/agents/tick      advance the loop (stateless)
src/app/api/agents/dispatch  parallel outbound campaign (consent-gated)
src/app/api/agents/approve   human approval decisions
src/app/hq/page.tsx          the Mission Control console
test/agents.*.test.ts        compliance + orchestrator + dispatch tests
```
