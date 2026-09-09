# Stella

**🏆 Winner — Vercel "Built in London" hackathon.** ([winners](https://community.vercel.com/hackathons/built-in-london/winners))

**£317m of Small Business Rate Relief goes unclaimed in London every year.** It
isn't applied automatically, most owners don't know it exists, and the ones who
do give up somewhere between the valuation roll and the council's contact page.

Stella closes that gap in about ten seconds. A shop owner types their business
name. Stella tells them exactly what they're owed, how far it backdates, who to
send it to — and writes the letter.

```
Souls Food UK Limited · E4 6SY
→ 1B Mount Avenue, London E4 6SY (Waltham Forest)
→ £4,584/yr  ·  £13,752 backdated to April 2023
→ Small Business Rate Relief — 100% off  (RV £12,000, gross bill £4,584/yr)
→ Waltham Forest business rates · 020 8496 3000 · apply online
→ [claim letter drafted, ready to send]
```

## Two ways in, one engine

**Web** — business name + postcode → Companies House verification → matched
property → relief, grants, council contact, and a streamed claim letter.

**Phone** — the owner calls and says their business name out loud. An ElevenLabs
voice agent runs the same lookup and reads back exactly what they can claim,
then offers to email the letter. No form, no account, no app. This matters: the
people leaving the most money on the table are the ones least likely to fill in
a web form.

## The rule that makes it trustworthy

**Every £ figure comes from a deterministic engine. The LLM only writes prose.**

The model never calculates, estimates, or adjusts a number — it receives figures
as authoritative facts and reproduces them verbatim. The voice agent's system
prompt makes the same rule non-negotiable, and the tool response carries a
pre-built `spoken_summary` so the agent has nothing left to invent.

This is enforced in code and by **1,457 parity tests** (`npm test`) that pin
every rule, threshold, and rounding behaviour against captured fixtures. A
number can't drift without a test going red.

## What it actually checks

**Reliefs** — England 2026/27, all traced to gov.uk sources:

- **Small Business Rate Relief** — 100% under £12k RV, with the correct
  1%-per-£30 taper up to £15k, on the right multiplier band (five bands, RHL vs
  non-RHL, small-business vs standard vs high-value).
- **Pub & Live Music Venue Relief** — 15%, with the gov.uk exclusion list
  applied properly (a café or a hotel doesn't quietly qualify).
- **2026 revaluation challenge wedge** — flags businesses sitting just over the
  SBRR cliff (£12k–£16k RV) where a valuation challenge could restore relief.
- **City of London** — flagged as separate billing arrangements rather than
  asserting a national figure it can't stand behind.

Plus the backdating estimate: councils typically backdate to April 2023, so the
lump sum is shown as a conservative 3-year figure.

**Grants** — 12 programmes matched against the business's *real* data, not a
directory dump: Start Up Loans, UK Shared Prosperity Fund, Innovate UK Smart
Grants, R&D tax credits, GLA Good Growth Fund, ELBP, Creative Enterprise, Made
Smarter, High Streets Heritage Action Zones, hospitality energy efficiency, net
zero support, London Growth Hub.

Every match cites the reason from actual company data — SIC code, company age,
borough, rateable value — and every blocker is shown too. Grants the business
can't get are never displayed. That restraint is the point: a list of 40
"maybe"s is worth nothing to someone running a café.

## Grounded in real data

- **311k VOA properties** — the London rating list, with rateable values and UARNs.
- **5.6M Companies House records** — fuzzy name matching (`pg_trgm`), so
  "souls food" finds *Souls Food UK Limited*.
- **33 London councils** — the right phone number, email and application URL for
  the actual billing authority, not a generic gov.uk link.
- **LSOA enrichment** via postcodes.io for deprivation-linked grant eligibility.

## What it hands you

- A **relief breakdown** — headline, annual value, backdated estimate,
  confidence, the rule applied, the action to take, and a source link per finding.
- A **ready-to-send claim letter** to the council, streamed token by token, with
  the UARN and figures dropped in verbatim.
- A **grant application draft**, same treatment.
- The **council's direct contact details** and apply-online link.

## Stack

Next.js 15 (App Router) on Vercel · TypeScript relief + grants engines ·
Supabase Postgres with `pg_trgm` · Claude API for prose (streamed over SSE) ·
ElevenLabs Conversational AI + Twilio for the phone channel · Vitest for parity.

## Run it

```bash
npm install
cp .env.local.example .env.local      # DATABASE_URL at minimum

createdb stella_dev
psql stella_dev -f supabase/migrations/0001_init.sql
npm run db:borough                     # 33 London councils
npm run load:voa                       # 311k VOA properties
# npm run load:companies path/to/BasicCompanyDataAsOneFile-YYYY-MM-DD.csv

npm test                               # 1457 parity tests
npm run dev                            # http://localhost:3000
```

Companies House bulk data is free from
<http://download.companieshouse.gov.uk/en_output.html>.

For production, set `ANTHROPIC_API_KEY` (prose), `ELEVENLABS_API_KEY` +
`VOICE_TOOL_SECRET` (phone), and Twilio credentials, then run
`elevenlabs/create-agent.sh` and `elevenlabs/provision-twilio.sh`.
`VOICE_TOOL_SECRET` must match in both the app env and the ElevenLabs tool
header — it authenticates the agent's webhook calls.

## API

| Route | Does |
|---|---|
| `POST /api/lookup` | postcode or name → properties + relief findings |
| `POST /api/biz-profile` | name + postcode → verified company, property, relief, grants, council |
| `POST /api/letter` | streams the council claim letter (SSE) |
| `POST /api/grant-application` | streams a grant application draft (SSE) |
| `POST /api/grants` | grant matches for a business profile |
| `POST /api/voice-lookup` | ElevenLabs server tool — returns `spoken_summary` |

## Layout

```
src/lib/engines/   relief.ts, grants.ts       ← deterministic, parity-tested
src/lib/           db.ts, lookup.ts, bizProfile.ts, sectors.ts, llm.ts
src/app/api/       lookup, biz-profile, letter, grant-application, grants, voice-lookup
supabase/migrations/0001_init.sql
scripts/           load-voa.ts, load-companies.ts, load-boroughs.ts
elevenlabs/        agent-prompt.md, tool definition, create-agent.sh, provision-twilio.sh
test/              relief.parity.test.ts, grants.parity.test.ts, fixtures/
```

---

*This branch is the frozen hackathon submission. Active development continues on
`voxtral-hosted`.*
