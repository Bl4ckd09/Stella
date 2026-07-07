# Proof of Alibaba Cloud usage

Stella's reasoning layer runs on **Alibaba Cloud Model Studio (Qwen Cloud)**,
Singapore / International endpoint
`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`. Four Qwen models are
called live; every code path below hits Alibaba Cloud APIs.

| Capability | Model | Code |
|---|---|---|
| Agent-loop reasoning | `qwen3.6-flash` | [`src/lib/llm.ts`](../src/lib/llm.ts) — `fastTier()`, `openaiComplete` |
| Customer/council artifacts | `qwen3.7-max` | [`src/lib/llm.ts`](../src/lib/llm.ts) — `qualityTier()`, `streamChatResponse` |
| Planner (native function calling) | `qwen3.6-flash` + `tools` | [`src/lib/agents/planner.ts:91`](../src/lib/agents/planner.ts) — `choosePlan` |
| Experience-memory embeddings | `text-embedding-v4` | [`src/lib/agents/memory.ts:78`](../src/lib/agents/memory.ts) — `embedTexts` |
| Memory recall ranking | `qwen3-rerank` | [`src/lib/agents/memory.ts:114`](../src/lib/agents/memory.ts) — `rerank` |

The DashScope base URL is set via `LLM_BASE_URL`; see
[`.env.local.example`](../.env.local.example) for the exact configuration.

## Reproduce it

```bash
export LLM_PROVIDER=openai
export LLM_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
export LLM_API_KEY=sk-...            # a Qwen Cloud key (home.qwencloud.com/api-keys)
export STELLA_ARTIFACT_MODEL=qwen3.7-max
export STELLA_AGENT_MODEL=qwen3.6-flash

# End-to-end: runs the autonomous loop on Qwen and asserts every artifact
# passes the compliance guard.
node --env-file=.env.local node_modules/.bin/tsx scripts/qwen-smoke.ts
```

Observed live run (12 prospects, 82 ticks): 86 Qwen-written reasoning lines,
the function-calling planner overriding the default order citing recalled
experience, 37 accumulated memories, and **13/13 artifacts passing compliance** —
every £ figure traceable to the deterministic engine.
