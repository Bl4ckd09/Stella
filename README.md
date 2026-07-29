# Stella: Unclaimed Business Money Engine

Helps London small businesses find unclaimed **Small Business Rate Relief** and
grants. Three channels share one deterministic engine:

- **Web**: owner types their business name (+ postcode) → relief + grants + a
  ready-to-send claim letter.
- **Browser voice**: owner talks to a Voxtral agent through the web widget.
- **Phone**: owner calls the existing ElevenLabs and Twilio agent.

> **Design rule (inherited, sacred):** every £ figure comes from the
> deterministic engine. The LLM only writes prose / narrates. Enforced in code
> and by 1,457 parity tests against the original Python engine.

## Stack

| Concern | Original (DGX Spark) | This rebuild |
|---|---|---|
| UI | Flask + vanilla JS | Next.js 15 (App Router) on **Vercel**, with v0 for design iteration |
| Engine | Python (`engines/`) | **TypeScript** (`src/lib/engines/`), with parity tests |
| Data | SQLite + CSV | **Supabase Postgres** (`pg_trgm` fuzzy name search) |
| LLM (prose) | Nemotron / Ollama | **Claude API** (Anthropic SDK, `claude-opus-4-8`) |
| Browser voice | None | **Voxtral STT and TTS** on Modal, with Nebius Qwen |
| Phone | None | **ElevenLabs** Conversational AI + **Twilio** |

## What works right now

- ✅ Relief + grants engines ported to TS, **1457/1457 parity tests pass** (`npm test`).
- ✅ Postgres schema + bulk loaders (VOA via `COPY`; CH streaming `COPY`).
- ✅ API routes: `/api/lookup`, `/api/biz-profile`, `/api/letter` (SSE),
  `/api/grant-application` (SSE), `/api/grants`, `/api/voice/session`, and `/api/voice-lookup`.
- ✅ Web UI (business name + postcode → analysis + grants + streamed claim letter).
- ✅ Voxtral browser widget with live text, interruption, streamed audio, and text fallback.
- ✅ ElevenLabs phone agent prompt + server tool + Twilio scripts remain available.
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
# Download and unzip Companies House (5.6M) first. Then run:
# npm run load:companies path/to/BasicCompanyDataAsOneFile-YYYY-MM-DD.csv

npm test                               # parity tests
npm run test:voice                    # gateway, VAD, tool, token, and interruption tests
npm run dev                            # http://localhost:3000
```

## Production setup (credentials & plan levels)

Fill `.env.local` (and the same vars in Vercel → Project → Settings → Env):

1. **Supabase** (Pro, about $25 each month for 8 GB). Free storage cannot hold 5.6M CH rows.
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
5. **Modal browser voice**. Follow `docs/voxtral-voice.md`. Deploy the two L4
   model services and the WebSocket gateway.
6. **ElevenLabs** (paid plan for phone + concurrency; Creator ~$22/mo to start).
   `ELEVENLABS_API_KEY`. Create the agent:
   `cd elevenlabs && ELEVENLABS_API_KEY=… APP_URL=https://your.vercel.app VOICE_TOOL_SECRET=… ./create-agent.sh`
7. **Twilio** (PAYG, ~£1/mo number + per-minute). With `AGENT_ID` from step 6:
   `ELEVENLABS_API_KEY=… AGENT_ID=… TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… ./provision-twilio.sh`
8. Set `VOICE_TOOL_SECRET` to a long random string in **both** Vercel env and the
   ElevenLabs tool header. It authenticates the agent webhook calls.

## Project layout

```
src/lib/engines/   relief.ts, grants.ts      (deterministic and parity-tested)
src/lib/           db.ts, lookup.ts, bizProfile.ts, sectors.ts, llm.ts
src/app/api/       lookup, biz-profile, letter, grant-application, grants, voice-lookup
src/components/    VoxtralVoiceWidget.tsx
voice/             Modal apps, WebSocket gateway, provider clients, tests
supabase/migrations/0001_init.sql
scripts/           load-voa.ts, load-companies.ts, load-boroughs.ts
elevenlabs/        agent-prompt.md, tool definition, create-agent.sh, provision-twilio.sh
test/              relief.parity.test.ts, grants.parity.test.ts, fixtures/
```
