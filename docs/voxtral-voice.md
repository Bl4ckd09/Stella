# Voxtral browser voice

```text
browser microphone <-> Modal WebSocket gateway
                       |-> Mistral Voxtral Realtime STT
                       |-> Mistral Small tool call -> Stella engine
                       `-> Mistral hosted Voxtral TTS -> 24 kHz PCM16

phone -> ElevenLabs -> Twilio
```

The browser path replaces the prior ElevenLabs web widget. The phone path does not change.

## Runtime modes

| Item | Hosted production | Self-hosted demo |
|---|---|---|
| Mode | `mistral_api` | `self_hosted` |
| STT | `voxtral-mini-transcribe-realtime-2602` | `mistralai/Voxtral-Mini-4B-Realtime-2602` on Modal |
| Agent | `mistral-small-2603` | Nebius Qwen |
| TTS | `voxtral-mini-tts-2603` | `mistralai/Voxtral-4B-TTS-2603` on Modal |
| Licence | Mistral API commercial terms | TTS weights use CC BY-NC 4.0 |

Both modes accept mono PCM16 at 16 kHz. The gateway ends a turn after 600 ms of silence.
The maximum turn is 15 seconds. The browser receives mono PCM16 at 24 kHz.

The gateway sends `spoken_summary` from `/api/voice-lookup` directly to TTS.
The agent never changes a deterministic tool result.

## Security and privacy

The Next.js route creates a short-lived HMAC token. It registers only an HMAC hash of the token ID.
The Modal gateway redeems that hash through an atomic Supabase function. A second redemption fails.

The rate limiter also uses an atomic Supabase function. It stores only an HMAC hash of the client address.
Set `VOICE_SECURITY_MODE=memory` only for local tests. Production fails closed without Supabase.

The gateway logs timing, provider, runtime mode, and tool outcomes. It never accepts audio or text as metric fields.
Stella keeps audio and text in memory for one session. Mistral processes hosted traffic under its account terms.
Record the provider retention setting before production enablement.

## Hosted production setup

Create a Modal secret named `stella-voice` with these values.

```text
VOICE_SESSION_SECRET
VOICE_TOOL_SECRET
STELLA_APP_URL
VOICE_RUNTIME_MODE=mistral_api
VOICE_SECURITY_MODE=supabase
MISTRAL_API_KEY
MISTRAL_STT_MODEL=voxtral-mini-transcribe-realtime-2602
MISTRAL_STT_TARGET_DELAY_MS=240
MISTRAL_AGENT_MODEL=mistral-small-2603
MISTRAL_TTS_MODEL=voxtral-mini-tts-2603
MISTRAL_TTS_VOICE_ID
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Run `supabase/migrations/0005_voice_security.sql`. Add these values to Vercel.

```text
VOICE_SESSION_SECRET
VOICE_TOOL_SECRET
VOXTRAL_GATEWAY_URL
VOICE_SECURITY_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Install the tools. Check the hosted model and tool contracts. Deploy only the CPU gateway.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r voice/requirements-dev.txt
npm install
npm run voice:contract
npm run voice:deploy
```

## Self-hosted demo setup

Add the Nebius key, both Modal model URLs, and both Modal proxy values to the secret.
Then deploy the two GPU services and the gateway.

```bash
npm run voice:deploy:self-hosted
```

Keep this mode for a non-commercial demonstration. Do not use the self-hosted TTS weights commercially.

## Verification

Run all local checks.

```bash
npm test
npm run test:voice
npm run build
```

Prewarm the configured services. Run a text turn and the evidence runner.

```bash
npm run voice:prewarm
npm run voice:smoke -- --app-url https://YOUR-STELLA-APP --text "Souls Food UK at E4 6SY"
npm run voice:latency -- --app-url https://YOUR-STELLA-APP --wav souls-food.wav --runs 5 --expect "£"
```

The runner records the first run separately. Warm P95 partial text must stay below 800 ms.
Warm P95 first audio must stay below 2 seconds. Interruption cancellation must stay below 250 ms.

Do not run a live check if a provider requires a card charge. Keep the evidence status as `credit_blocked`.

## Rollback

Set the browser voice feature off or restore the prior Vercel deployment. Stop the Modal gateway.
The ElevenLabs and Twilio phone service remains independent.

Primary references include the [Mistral realtime guide](https://docs.mistral.ai/studio-api/audio/speech_to_text/realtime_transcription),
the [Voxtral TTS guide](https://docs.mistral.ai/studio-api/audio/text_to_speech/speech),
and the [Mistral commercial terms](https://legal.mistral.ai/terms/commercial-terms-of-service).
