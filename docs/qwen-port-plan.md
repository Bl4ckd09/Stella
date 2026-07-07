# Qwen Cloud port plan — Autopilot Agent track

Target: Global AI Hackathon Series with Qwen Cloud, **Autopilot Agent** track.
Deadline **July 9, 2026, 2:00 PM PDT** (10:00 PM BST). Judging: Innovation 30%
(explicitly rewards sophisticated Qwen Cloud API use, MCP/Skills), Technical
depth 30%, Problem value 25%, Presentation 15%.

Positioning: *a self-running business on Qwen Cloud* — real UK rate-relief
workflow, deterministic money engine, 7-agent workforce, human-in-the-loop
checkpoints. Everything below is the "significantly updated during the
submission period" story; keep commits granular.

---

## Phase 0 — accounts (manual, ~30 min, blocking)

1. Sign up at qwencloud.com **with the same email as the Devpost registration**.
   Activate Model Studio with region **Singapore / International** — any other
   region gets **zero** free quota.
2. Verify per-model balances at home.qwencloud.com/benefits (expect ~1M free
   tokens each for qwen3.7-max, qwen3.6-flash, qwen3.7-plus,
   text-embedding-v4, qwen3-rerank; valid 90 days; no card needed).
3. Create an API key; smoke test:
   ```bash
   curl -s https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions \
     -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
     -d '{"model":"qwen3.7-max","messages":[{"role":"user","content":"say ok"}],"max_tokens":10}'
   ```
   If a model ID 404s, check docs.qwencloud.com/changelog/models for the
   current ID and pin the dated snapshot.
4. Separately activate the **alibabacloud.com** console (Function Compute +
   OSS live there; their free tier is a different bucket from Model Studio).
5. Voucher ($40, delayed — non-blocking): qwencloud.com/challenge/hackathon/voucher-application.

## Phase 1 — config-only port (~15 min)

No code needed. Both tiers already resolve per-tier models over one
OpenAI-compatible connection (`src/lib/llm.ts:50-64`):

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=sk-...                    # DashScope key (Bearer auth already wired)
STELLA_ARTIFACT_MODEL=qwen3.7-max     # quality tier: claim packs, council letters
STELLA_AGENT_MODEL=qwen3.6-flash      # fast tier: agent loop reasoning
```

Acceptance: full hands-off run in `/hq` with AI reasoning on; web letter SSE
stream works (`openaiStream` already speaks OpenAI SSE); `npm test` green.

## Phase 2 — llm.ts hardening (~1–2 h)

- **Disable thinking on the fast tier.** Qwen3 hybrid-thinking models can
  default `enable_thinking` on via the compatible endpoint; the loop must stay
  fast/cheap. Inject `enable_thinking: false` in `openaiComplete`/`openaiStream`
  bodies only when the base URL is DashScope (keep Modal/vLLM hosts clean).
  Leave it available (true) for Ada's planning call if it helps quality.
- **429 handling.** Account-wide limits: qwen3.7-max **600 RPM / 1M TPM**,
  flash ~15k RPM. Add one retry with jitter on 429 in `openaiComplete`;
  callers already fall back to templates on throw.
- Update `.env.local.example` with a "Qwen Cloud" block mirroring Phase 1.

## Phase 3 — Qwen-native depth (July 8, the differentiators)

1. **Ada plans via native function calling** (`reasoning.ts`, orchestrator
   decision step): expose the next-action space as OpenAI-style `tools`;
   Ada returns a structured tool call (parallel calls supported) instead of
   parsed prose. Judges' rubric: "algorithmic/engineering innovation."
2. **Experience memory** (`src/lib/agents/memory.ts`, new): after each
   outcome event (won/disqualified/blocked/council decision), write a memory
   line; embed with **text-embedding-v4**; at decision time retrieve top-k by
   cosine, rerank with **qwen3-rerank**, and inject "recalled experience"
   into Ada/Theo prompts. Surface recalls in the /hq activity feed — the
   Presentation rubric rewards visualized internals.
3. **Stretch — qwen3-vl:** parse a scanned council response letter into a
   case-status update (matches the judges' proven taste for document-workflow
   verticals). Only if Phases 1–2 land by midday.

## Phase 4 — Alibaba Cloud deployment (July 8 evening)

- Deploy the cron worker (`src/lib/agents/worker.ts`) to **Function Compute**
  (Node runtime, HTTP + timer trigger; free tier 1M invocations/400k
  CU-seconds). UI stays on Vercel.
- Store generated artifacts (claim packs, letters) in **OSS**.
- The FC handler + OSS client files in-repo are the required "proof of
  Alibaba Cloud deployment" link; they also anchor the architecture diagram
  (Vercel UI → FC worker → Model Studio APIs → OSS artifacts → Supabase).

## Phase 5 — submission kit (July 9, submit by ~11 AM PDT)

- [ ] LICENSE (done — MIT), repo public, default branch merged
- [ ] Architecture diagram (draw once, reuse in README + video)
- [ ] README repositioned: "a self-running business on Qwen Cloud"
- [ ] **Video < 3 min** (YouTube): problem → press "Go hands-off" → visualize
      internals (compliance gate blocking an untraced £, human approval
      checkpoint, memory recall changing Ada's decision) → deployment proof
- [ ] Devpost description incl. explicit **"what changed during the
      submission period"** section (Qwen two-tier port, function-calling
      planner, experience memory, FC/OSS deployment — git history backs it)
- [ ] Track = Autopilot Agent
- [ ] Blog post (separate $500+$500 award, ~10 winners — best EV/hour)

## Gotchas

- Free quota: Singapore/International only; shared across all keys/RAM users.
- Two separate free buckets: Model Studio tokens vs Function Compute compute.
- qwen3.7-max 600 RPM is account-wide — serialize quality-tier bursts.
- If max quota runs dry mid-dev, drop quality tier to qwen3.7-plus and save
  max for the final demo recording.
- Video: no third-party trademarks/copyrighted music; must show the project
  actually functioning.
