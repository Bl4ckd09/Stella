# Worklog

## 2026-07-29

- Replaced the ElevenLabs browser widget with an AudioWorklet Voxtral widget.
- Added signed browser sessions and fail-closed voice tool authentication.
- Added separate Modal L4 services for Voxtral STT and TTS.
- Added a Modal WebSocket gateway with Nebius tools, VAD, interruption, and private metrics.
- Added local and deployed verification commands. The phone path stayed unchanged.
- Replaced the unavailable Qwen 3.6 model ID with the live Qwen 3 30B instruct model after its Nebius tool contract passed.
- Fixed the Modal image entrypoints, STT audio packages, TTS memory limits, and split runtime secrets.
- Modal stopped the live GPU test after the Starter workspace used its free credit. A payment method is required to resume it.

## 2026-07-31

- Replayed the Voxtral work onto the current `autonomous-agents` default branch.
- Added a hosted Mistral production mode for realtime STT, Mistral Small, and Voxtral TTS.
- Kept the self-hosted Modal and Nebius mode as a non-commercial demo.
- Added shared Supabase rate limits and atomic single-use session redemption.
- Fixed browser cleanup, retry, focus, error, privacy, and playback queue behaviour.
- Added provider tests, evidence output, deployment checks, and a public case study.
- Kept live performance claims blocked until a credits-only run produces evidence.

## 2026-08-05

- Added GitHub Actions CI for TypeScript tests, Python voice tests, type checks, and production builds.
- Added a Vercel production workflow that runs only after successful default-branch CI.
- Created the GitHub `production` environment and set `VERCEL_DEPLOY_ENABLED=false`.
- Kept Modal outside CI and kept Vercel deployment disabled until credentials exist.

## 2026-08-06

- Upgraded Next, React, Vitest, FastAPI, pytest, and dotenv to patched releases.
- Added a hashed Python lock and dependency audits to CI.
- Removed voice session tokens from WebSocket URLs.
- Added first-frame authentication with a three-second timeout.
- Trusted Vercel client headers only on Vercel and required the configured Stella origin.
- Rejected memory-backed voice security in production and Modal.
- Passed 1,505 TypeScript tests, 17 Python tests, both audits, typecheck, and the production build.
- Kept Vercel deployment disabled and did not deploy Modal.
