# Stella browser voice with Voxtral

## Result

Stella now has a browser voice path built around Voxtral. The existing ElevenLabs and Twilio phone path stays separate.

The implementation is ready for hosted Mistral validation. Local tests cover the protocol, security, interruption, audio conversion, and deterministic lookup boundary.
Live latency remains unverified because no Mistral credentials are configured. No card charge is authorised.
The project makes no measured latency claim yet.

## Problem

Stella calculates UK business relief with a deterministic TypeScript engine. A voice model must never calculate or edit money.
The browser also needs low latency, interruption support, single-use sessions, and no application storage of raw speech.

## Design

```text
16 kHz microphone
       |
       v
Modal WebSocket gateway
       |-> Voxtral Realtime transcription
       |-> Mistral Small function call
       |-> Stella deterministic lookup
       `-> hosted Voxtral speech
       |
       v
24 kHz browser playback
```

The agent can call only `lookup_business`. The lookup route returns an engine-owned `spoken_summary`.
The gateway sends that exact string to TTS. The model cannot revise the figures.

The production mode uses hosted Mistral STT, Mistral Small, and hosted Voxtral TTS.
The earlier self-hosted mode remains available for a non-commercial demonstration.

## Safety controls

1. Supabase redeems each session token once across all gateway containers.
2. Supabase applies one rate limit across all Vercel instances.
3. HMAC hashes replace raw token IDs and client addresses in the security store.
4. The metric schema rejects audio, transcripts, and unknown fields.
5. Provider errors fail closed and release the microphone, socket, audio queue, and playback context.

## Evidence

| Check | Result |
|---|---|
| TypeScript voice tests | Passed locally |
| Python gateway tests | Passed locally |
| Production build | Passed locally |
| Desktop and mobile UI | Passed locally |
| Live warm latency | Credit blocked, no measurement claimed |

The machine-readable record is in `docs/evidence/voxtral-validation.json`.

## Remaining live gate

Use existing credits only. Run the hosted contract check before deployment.
Then record first-run latency, five warm turns, interruption latency, and exact lookup output.

Publish measured values only after the evidence runner passes all thresholds.

## Why this is relevant to Mistral

This project uses Voxtral as a real voice interface around a regulated money workflow.
It shows model integration, tool control, privacy limits, provider migration, and evidence discipline.

References include the [Mistral realtime guide](https://docs.mistral.ai/studio-api/audio/speech_to_text/realtime_transcription)
and the [Voxtral TTS guide](https://docs.mistral.ai/studio-api/audio/text_to_speech/speech).
