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
