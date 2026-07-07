# Demo video shot list (target < 3:00)

Record `/hq` running on Qwen (env set as in `alibaba-cloud-proof.md`). The
judges' presentation criterion rewards **visualizing the agent's internal
logic** — so show the feed, the gates, and the memory recall, not just a pretty
UI. Keep narration tight; the on-screen events carry the story.

| Time | Shot | Say |
|---|---|---|
| 0:00–0:20 | Title + one-line problem. Cut to `/hq` idle. | "Hundreds of thousands of UK small businesses never claim the rate relief they're owed. Stella is a self-running business that recovers it — seven AI agents on Qwen Cloud, a human holds only the kill switch." |
| 0:20–0:40 | Press **▶ Go hands-off**. Feed starts streaming: source → scan → qualify. | "Press one button. Mara sources from public property data, Devi runs a deterministic engine — every pound is computed law, never guessed by the model." |
| 0:40–1:15 | **Money-shot: the Qwen planner.** Point to the 🧭 "Ada re-prioritised" line and read its reasoning citing a past case. | "Ada decides the next move with native Qwen function calling — and here she overrides the default order, citing a *remembered* outcome from an earlier, similar case. That's the cross-session memory: `text-embedding-v4` and `qwen3-rerank` recalling experience." |
| 1:15–1:40 | **Compliance gate.** Trigger/point to a blocked artifact — an untraced £ or banned phrase caught and rewritten. | "Quinn reviews every outbound artifact. A figure that doesn't trace to the engine, or a banned 'guaranteed' claim, is blocked and rewritten — safety is structural, not a prompt." |
| 1:40–2:05 | **Human approval.** Show a high-risk action (submit to council) pausing in the approval queue; approve it. | "Anything irreversible — like filing with a council — pauses for a human. Autonomy is a dial, from supervised to full autopilot." |
| 2:05–2:30 | Show a finished artifact (claim pack / council letter) written by `qwen3.7-max` with real figures + disclosures. Show revenue tick up. | "The customer-facing documents are written by qwen3.7-max, with the exact engine figures and the required disclosures. Revenue books automatically." |
| 2:30–2:55 | Quick cut: architecture diagram + the deployment-proof code file calling `dashscope-intl.aliyuncs.com`. Terminal: `tsx scripts/qwen-smoke.ts` → "13/13 artifacts pass". | "Four Qwen models, each for its job, on Alibaba Cloud Model Studio. 1,490 tests green; every artifact passes compliance." |
| 2:55–3:00 | Repo URL + "Autopilot Agent track". | "Stella. A business that runs itself — safely — on Qwen Cloud." |

**Recording tips**
- Pre-seed a run so memories exist before you hit record, so the planner has
  experience to recall on camera (the 0:40 shot). Run a few ticks, then start.
- Keep the feed scrolled to the event you're narrating; zoom the reasoning text.
- No third-party music/trademarks (rules). Upload unlisted to YouTube; keep < 3:00.
