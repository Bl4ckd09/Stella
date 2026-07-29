# Voxtral browser voice

```text
browser microphone <-> Modal gateway
                       |-> Voxtral Realtime STT on an L4
                       |-> Nebius Qwen tool call -> Stella engine
                       `-> Voxtral TTS on an L4 -> 24 kHz PCM

phone -> ElevenLabs -> Twilio
```

The browser path replaces the ElevenLabs web widget. The phone path does not change.

## Runtime contract

| Item | Value |
|---|---|
| Input | Mono PCM16 at 16 kHz in 20 ms frames |
| STT | `mistralai/Voxtral-Mini-4B-Realtime-2602` |
| Turn end | WebRTC VAD after 600 ms of silence |
| Maximum turn | 15 seconds |
| Agent | Nebius `Qwen/Qwen3-30B-A3B-Instruct-2507` with `lookup_business` |
| TTS | `mistralai/Voxtral-4B-TTS-2603`, voice `casual_female` |
| Output | Streamed mono PCM16 at 24 kHz |
| Scale policy | Zero warm containers and a 20 minute idle window |

The gateway sends `spoken_summary` from `/api/voice-lookup` directly to TTS.
The agent does not edit a deterministic tool result.

The gateway logs only timing metrics and tool outcomes. It keeps audio and text in memory for one session. It does not persist them.

## Secrets

Create two different random values for `VOICE_TOOL_SECRET` and `VOICE_SESSION_SECRET`.
The session secret must contain at least 32 characters.

Create a Modal secret named `stella-voice` with these values:

```text
VOICE_SESSION_SECRET
VOICE_TOOL_SECRET
STELLA_APP_URL
NEBIUS_API_KEY
NEBIUS_VOICE_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507
VOXTRAL_STT_URL
VOXTRAL_TTS_URL
VOXTRAL_VOICE=casual_female
MODAL_PROXY_KEY
MODAL_PROXY_SECRET
```

Add these values to Vercel:

```text
VOICE_SESSION_SECRET
VOICE_TOOL_SECRET
VOXTRAL_GATEWAY_URL
```

The two model endpoints require Modal proxy authentication. The public gateway requires a short-lived signed session token.

## Deploy

1. Install the local tools.

   ```bash
   python3 -m venv .venv
   .venv/bin/python -m pip install -r voice/requirements-dev.txt
   pipx install modal
   npm install
   ```

2. Run the required Nebius contract check.

   ```bash
   npm run voice:contract
   ```

3. Deploy the STT service.

   ```bash
   modal deploy voice/modal_stt.py
   ```

4. Deploy the TTS service.

   ```bash
   modal deploy voice/modal_tts.py
   ```

5. Add both service URLs to the `stella-voice` Modal secret.

6. Deploy the gateway.

   ```bash
   modal deploy voice/modal_gateway.py
   ```

Use `npm run voice:deploy` after all secrets and URLs exist. This command runs the contract check first.

## Verify

1. Run all local tests.

   ```bash
   npm test
   npm run test:voice
   npm run build
   ```

2. Prewarm the three deployed services before a demonstration.

   ```bash
   npm run voice:prewarm
   ```

3. Test the deployed Stella lookup and TTS path.

   ```bash
   npm run voice:smoke -- --app-url https://YOUR-STELLA-APP --text "Souls Food UK at E4 6SY"
   ```

4. Record the same phrase as mono PCM16 at 16 kHz. Run the warm latency check.

   ```bash
   npm run voice:latency -- --app-url https://YOUR-STELLA-APP --wav souls-food.wav --runs 5
   ```

The check requires warm P95 partial text below 800 ms. It requires first audio below two seconds after the turn ends.

## License and rollback

Voxtral TTS and its reference voices use CC BY-NC 4.0. Keep this path for the non-commercial demo.

Use the prior Vercel deployment for a web rollback. The phone service remains independent of this browser path.

Primary references:

- [Voxtral Realtime model card](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602)
- [Voxtral TTS model card](https://huggingface.co/mistralai/Voxtral-4B-TTS-2603)
- [Nebius function calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling)
- [Modal WebSockets](https://modal.com/docs/guide/webhooks)
- [vLLM-Omni speech API](https://docs.vllm.ai/projects/vllm-omni/en/stable/serving/speech_api/)
