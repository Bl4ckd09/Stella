> **Work in progress, not merged.** The browser Mistral voice widget that the
> Voxtral agent replaced (62557dc). Kept for reference only.
>
> Files: `src/lib/mistralVoice.ts`, `src/components/MistralVoiceWidget.tsx`,
> `src/app/api/mistral-voice/route.ts`, `test/mistral-voice.route.test.ts`.
> Current code lives on `voxtral-hosted`.

# Stella — a self-running business on Qwen Cloud

**Global AI Hackathon Series with Qwen Cloud · Autopilot Agent track.**

Stella automates a real UK business workflow end-to-end: a workforce of seven
AI agents sources unclaimed **Small Business Rate Relief** for London SMBs,
scans and qualifies each against a deterministic engine, sells compliantly,
prepares the paid work, files council applications, and books revenue — while a
human only supervises a Mission Control console (and holds a kill switch).

The reasoning layer runs entirely on **Qwen Cloud (Alibaba Cloud Model Studio)**:
`qwen3.7-max` writes customer/council documents, `qwen3.6-flash` runs the agent
loop and a **native function-calling planner**, and `text-embedding-v4` +
`qwen3-rerank` power a **cross-session experience memory** so the workforce makes
better decisions as history accumulates. See [docs/architecture.md](./docs/architecture.md)
for the system diagram and [docs/alibaba-cloud-proof.md](./docs/alibaba-cloud-proof.md)
for the Qwen API code pointers.

Open **`/hq`**, press **▶ Go hands-off**, and walk away.

> **Sacred rule:** every £ figure is computed by the deterministic relief engine
> (1,441 parity tests). Agents reason and write prose — they never invent, alter,
> or recalculate money, and a compliance guard blocks any £ that doesn't trace to
> the engine.

## Built on Qwen Cloud

| Concern | Qwen model | Where |
|---|---|---|
| Customer/council artifacts (quality tier) | `qwen3.7-max` | `src/lib/llm.ts` |
| Agent-loop reasoning (fast tier) | `qwen3.6-flash` | `src/lib/llm.ts` |
| Ada's next-action planner | `qwen3.6-flash` + native function calling | `src/lib/agents/planner.ts` |
| Experience-memory embeddings | `text-embedding-v4` | `src/lib/agents/memory.ts` |
| Memory recall ranking | `qwen3-rerank` | `src/lib/agents/memory.ts` |

OpenAI-compatible via `dashscope-intl.aliyuncs.com/compatible-mode/v1` (Singapore /
International). The provider seam is two-tier and model-agnostic; thinking-mode is
forced off on the loop and a 429-retry rides out the account-wide rate limit.

### What changed during the submission period

Stella began as a Cursor "Hands Off" entry; for this hackathon it was
**significantly updated to be Qwen-native** (all commits on the `qwen-cloud`
branch):

- **Two-tier port to Qwen Cloud** — both LLM tiers now run on Qwen models over
  the DashScope OpenAI-compatible endpoint, with DashScope-specific hardening.
- **Native function-calling planner** (`planner.ts`) — Ada chooses the next
  action via a Qwen `tools` call among pre-vetted candidates, not prompt-parsed
  prose; null-safe fallback to the deterministic order.
- **Cross-session experience memory** (`memory.ts`) — the workforce records
  outcomes and recalls them at decision time via `text-embedding-v4` +
  `qwen3-rerank`, with cosine and recency fallbacks.
- **16 new tests** (1,493 total, green) and a live end-to-end Qwen smoke script.

---

## The workforce

| Agent | Role | Owns |
|---|---|---|
| 🧭 **Ada** | Chief of Staff | Decides the next action each cycle |
| 🔭 **Mara** | Acquisition | Sources SBRR-eligible prospects (public VOA data) |
| 📊 **Devi** | Eligibility Analyst | Runs the deterministic engine; qualifies / disqualifies |
| ✉️ **Theo** | Outreach & Sales | Writes compliant offers; converts customers |
| 📁 **Iris** | Case Operations | Claim packs, council letters, advancing cases |
| 🛡️ **Quinn** | Compliance & Oversight | Reviews **every** outbound artifact; can block |
| 💷 **Otto** | Finance | Books revenue; records confirmed client recoveries |

## How it works

The whole runtime is a **pure, replayable reducer**: `tick(state) → {state, events}`.
One tick = one world-step — either the world responds (a customer replies, a
Letter of Authority is signed, a council decides) or one agent takes one action.

- **State lives in the console; the server is stateless.** Each tick the console
  POSTs the current state to `/api/agents/tick`, the server runs one step
  (engine + compliance + LLM reasoning) and returns the next state. No database
  is needed for the demo, and the whole run is replayable.
- **Real money, fake-proof.** Seeded London businesses are fed through the same
  `engines/relief.ts` the live product uses, so every £ is computed law, not a
  guess. The LLM only writes prose, with a deterministic template fallback for
  every call — so the loop runs even with no API key.
- **The pipeline.** `sourced → scanning → qualified → (campaign) → contacted →
  won → case work → submitted → outcome → closed`, with `disqualified` /
  `needs_optin` side-exits.

### Agents initiate outreach — in parallel

Outreach is a **batch operation**. Qualified owners accumulate, then a single
**outbound campaign** contacts them all at once across **voice (ElevenLabs) /
WhatsApp (Wassist) / email (Resend)** concurrently — wall-clock ≈ the slowest
single contact, not the sum (a 5-contact batch finishes in ~0.9s, not ~3s).
Sends are **sandbox-simulated** unless `STELLA_LIVE_OUTBOUND=true`. Run it
automatically (hands-off) or on demand with the **📣 Outbound campaign** button.

### Safety & oversight (structural, not advisory)

1. **Money trace** — a pure guard re-derives the allowed figures and blocks any
   £ in agent output that doesn't trace to the engine.
2. **Compliance gate** — every artifact is scanned for banned claims ("owed",
   "guaranteed", "no win no fee", implied endorsement) and required disclosures
   (free council route, "estimate must be confirmed"); failures are rewritten
   with a safe template and re-checked.
3. **Consent gate** — only owners who opted in are contacted; eligible-but-
   non-consented owners are **held** (`needs_optin`), never cold-contacted.
4. **Authorization gate (hard)** — no council letter is drafted or submitted
   without a signed Letter of Authority.
5. **Human approval queue** — actions above the autonomy threshold (e.g.
   submitting to a council) pause for a human.
6. **Autonomy dial** (`supervised → assisted → autopilot`) + **kill switch** +
   a full **audit trail** of every decision.

### Cost-aware: two LLM tiers

The LLM layer (`src/lib/llm.ts`) has two tiers so you can spend cleverly:

- **Fast** tier — high-volume agent reasoning (the activity-feed lines).
- **Quality** tier — customer/council documents (claim packs, council letters).

Each tier is independently set to **Claude** or **any OpenAI-compatible endpoint**
(e.g. a **Modal** Managed Inference Endpoint, which serves the OpenAI API under
`/v1`) — no code change. Defaults to Claude for both. Example hybrid (Modal for
the loop, Claude for the letters):

```bash
ANTHROPIC_API_KEY=sk-ant-...            # quality tier (letters)
STELLA_AGENT_PROVIDER=openai            # fast tier → Modal
LLM_BASE_URL=https://<endpoint>/v1
LLM_MODEL=Qwen/Qwen3.6-35B-A3B
MODAL_KEY=wk-...   MODAL_SECRET=ws-...   # or deploy with --unauthenticated
```

See [`.env.local.example`](./.env.local.example) for all options.

## Quick start

```bash
npm install
npm run dev                 # open http://localhost:3000/hq → press "Go hands-off"
npm test                    # 1,493 tests (engine parity + agent runtime + voice route)
```

- **No keys needed** for the core demo — the workforce runs on the deterministic
  engine + templated reasoning.
- Set `ANTHROPIC_API_KEY` (or a Modal/OpenAI endpoint) and toggle **AI reasoning**
  in `/hq` for live LLM-written reasoning and artifacts.

### Agent API

| Route | Purpose |
|---|---|
| `POST /api/agents/tick` | Advance the loop one step (stateless); returns next state + events |
| `POST /api/agents/dispatch` | Run a parallel outbound campaign (consent-gated) |
| `POST /api/agents/approve` | Apply a human approval decision |

---

## The underlying product

The agents are an orchestration layer on top of Stella's existing primitives —
the same engine and channels power a live web + phone product:

- **Web** (`/`): owner types business name (+ postcode) → relief + grants + a
  streamed, ready-to-send claim letter.
- **Web voice**: the default floating voice agent runs on Mistral Voxtral:
  `voxtral-mini-latest` STT → `mistral-small-latest` tool-calling agent →
  `voxtral-mini-tts-2603` TTS. The agent uses the same deterministic lookup and
  letter tools, so every £ figure still comes from the engine.
- **Phone**: the ElevenLabs Conversational AI + Twilio phone path is retained for
  callers. Set `NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs` to restore the old
  ElevenLabs Convai web widget.

### Stack

| Concern | Implementation |
|---|---|
| UI | Next.js 15 (App Router) on **Vercel** |
| Engine | **TypeScript** (`src/lib/engines/`) — parity-tested port of the Python original |
| Data | **Supabase Postgres** (`pg_trgm` fuzzy name search; 311k VOA + 5.6M Companies House rows) |
| LLM (prose) | **Claude** by default; any OpenAI-compatible endpoint (Modal/Nebius/…) via the tier seam |
| Web voice | **Mistral Voxtral** STT/TTS + `mistral-small-latest` tool calling |
| Phone | **ElevenLabs** Conversational AI + **Twilio** |

### Local development (full product, with data)

```bash
cp .env.local.example .env.local       # fill DATABASE_URL at minimum
createdb stella_dev
psql stella_dev -f supabase/migrations/0001_init.sql
npm run db:borough                      # 33 London councils
npm run load:voa                        # 311k VOA properties (data/voa_london_index.csv)
# Companies House (5.6M) — download + unzip, then:
# npm run load:companies path/to/BasicCompanyDataAsOneFile-YYYY-MM-DD.csv
npm run dev
```

> The `/hq` autonomous demo does **not** need the database — only the full
> web/phone lookup product does.

### Production setup (web/phone product)

Fill `.env.local` (and the same vars in Vercel → Settings → Env):

1. **Supabase** (Pro tier — Free 500 MB can't hold 5.6M CH rows). Run
   `supabase/migrations/0001_init.sql`; copy URL, anon key, service-role key, and
   `DATABASE_URL`.
2. **Data load**: `npm run db:borough && npm run load:voa && npm run load:companies …`.
   CH bulk file: <http://download.companieshouse.gov.uk/en_output.html>.
3. **LLM**: `ANTHROPIC_API_KEY` (default Claude), or set the OpenAI/Modal tier
   vars above.
4. **Vercel**: import the repo, add env vars, deploy. SSE + agent routes have
   `maxDuration` set.
5. **Voice**: set `MISTRAL_API_KEY` for the default web voice agent. For the
   phone path, `cd elevenlabs && … ./create-agent.sh` then
   `./provision-twilio.sh`; set `VOICE_TOOL_SECRET` in both Vercel and the
   ElevenLabs tool header.
6. **Outbound (optional, live)**: `STELLA_LIVE_OUTBOUND=true` + the channel creds
   (ElevenLabs phone-number id, Wassist, Resend). Sandbox-simulated otherwise.

## Project layout

```
src/lib/agents/      types, roster, prospects, compliance, reasoning,
                     integrations (outbound), orchestrator (loop + dispatcher)
src/lib/llm.ts       two-tier provider seam (Anthropic | OpenAI/Modal)
src/lib/engines/     relief.ts, grants.ts        (deterministic — parity-tested)
src/lib/             db.ts, lookup.ts, bizProfile.ts, sectors.ts
src/app/hq/          the Mission Control console
src/app/api/agents/  tick, dispatch, approve
src/app/api/         lookup, biz-profile, letter, grant-application, grants,
                     mistral-voice, voice-lookup, voice-letter
supabase/migrations/ 0001_init.sql, 0002_rls.sql
scripts/             load-voa.ts, load-companies.ts, load-boroughs.ts
elevenlabs/          agent-prompt.md, tool definition, create-agent.sh, provision-twilio.sh
test/                agents.* (runtime), relief/grants parity, fixtures/
```
