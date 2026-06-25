# Stella — Unclaimed Business Money Engine (cloud rebuild)

> 🤖 **Hands-Off HQ (`/hq`)** — the `autonomous-agents` branch turns Stella into a
> *self-running business operated entirely by an AI workforce* for the Cursor
> "Hands Off" hackathon. Press **Go hands-off** and watch seven agents source,
> qualify, sell, and file claims live — with a compliance guard, a hard
> authorization gate, and a human approval queue. See **[HACKATHON.md](./HACKATHON.md)**.

Helps London small businesses find unclaimed **Small Business Rate Relief** and
grants. Two channels share one deterministic engine:

- **Web**: owner types their business name (+ postcode) → relief + grants + a
  ready-to-send claim letter.
- **Phone**: owner calls an ElevenLabs voice agent and says their business name →
  the agent reads back exactly what they can claim.

> **Design rule (inherited, sacred):** every £ figure comes from the
> deterministic engine. The LLM only writes prose / narrates. Enforced in code
> and by 1,457 parity tests against the original Python engine.

## Stack

| Concern | Original (DGX Spark) | This rebuild |
|---|---|---|
| UI | Flask + vanilla JS | Next.js 15 (App Router) on **Vercel**; v0 for design iteration |
| Engine | Python (`engines/`) | **TypeScript** (`src/lib/engines/`) — parity-tested port |
| Data | SQLite + CSV | **Supabase Postgres** (`pg_trgm` fuzzy name search) |
| LLM (prose) | Nemotron / Ollama | **Claude API** (Anthropic SDK, `claude-opus-4-8`) |
| Phone | — | **ElevenLabs** Conversational AI + **Twilio** |

## What works right now

- ✅ Relief + grants engines ported to TS, **1457/1457 parity tests pass** (`npm test`).
- ✅ Postgres schema + bulk loaders (VOA via `COPY`; CH streaming `COPY`).
- ✅ API routes: `/api/lookup`, `/api/biz-profile`, `/api/letter` (SSE),
  `/api/grant-application` (SSE), `/api/grants`, `/api/voice-lookup` (phone tool).
- ✅ Web UI (business name + postcode → analysis + grants + streamed claim letter).
- ✅ ElevenLabs agent prompt + server-tool definition + Twilio provisioning scripts.
- ✅ Verified end-to-end locally against the real 311k-row VOA dataset.
- ⏳ Needs live credentials to go to production (see below). LLM prose path is
  wired but blank-keys gracefully.

## Local development

```bash
npm install
cp .env.local.example .env.local      # fill DATABASE_URL at minimum

# Local Postgres (or point DATABASE_URL at Supabase):
createdb stella_dev
psql stella_dev -f supabase/migrations/0001_init.sql
npm run db:borough                     # 33 London councils
npm run load:voa                       # 311k VOA properties (data/voa_london_index.csv)
# Companies House (5.6M) — download + unzip first (see below), then:
# npm run load:companies path/to/BasicCompanyDataAsOneFile-YYYY-MM-DD.csv

npm test                               # parity tests
npm run dev                            # http://localhost:3000
```

## Production setup (credentials & plan levels)

Fill `.env.local` (and the same vars in Vercel → Project → Settings → Env):

1. **Supabase** (Pro, ~$25/mo — 8 GB; Free 500 MB can't hold 5.6M CH rows).
   Create project → run `supabase/migrations/0001_init.sql` (SQL editor or
   `psql "$DATABASE_URL" -f`). Copy URL, anon key, service-role key, and the
   `DATABASE_URL` (Settings → Database → Connection string → URI).
2. **Data load**: `npm run db:borough && npm run load:voa && npm run load:companies …`
   pointed at `DATABASE_URL`. CH bulk file is free from
   <http://download.companieshouse.gov.uk/en_output.html> (BasicCompanyDataAsOneFile).
3. **Claude API** (<https://platform.claude.com/settings/keys>). Set
   `ANTHROPIC_API_KEY` (optionally `ANTHROPIC_MODEL`, default `claude-opus-4-8`;
   `claude-haiku-4-5` is cheaper at volume). Pay-as-you-go.
4. **Vercel** (Pro $20/mo for commercial use). Import the repo, add env vars,
   deploy. SSE routes have `maxDuration` set.
5. **ElevenLabs** (paid plan for phone + concurrency; Creator ~$22/mo to start).
   `ELEVENLABS_API_KEY`. Create the agent:
   `cd elevenlabs && ELEVENLABS_API_KEY=… APP_URL=https://your.vercel.app VOICE_TOOL_SECRET=… ./create-agent.sh`
6. **Twilio** (PAYG, ~£1/mo number + per-minute). With `AGENT_ID` from step 5:
   `ELEVENLABS_API_KEY=… AGENT_ID=… TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… ./provision-twilio.sh`
7. Set `VOICE_TOOL_SECRET` to a long random string in **both** Vercel env and the
   ElevenLabs tool header — it authenticates the agent's webhook calls.

## Project layout

```
src/lib/engines/   relief.ts, grants.ts      (deterministic — parity-tested)
src/lib/           db.ts, lookup.ts, bizProfile.ts, sectors.ts, llm.ts
src/app/api/       lookup, biz-profile, letter, grant-application, grants, voice-lookup
supabase/migrations/0001_init.sql
scripts/           load-voa.ts, load-companies.ts, load-boroughs.ts
elevenlabs/        agent-prompt.md, tool definition, create-agent.sh, provision-twilio.sh
test/              relief.parity.test.ts, grants.parity.test.ts, fixtures/
```
