from __future__ import annotations

import os

import modal

app = modal.App("stella-voxtral-gateway")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "fastapi==0.140.13",
        "httpx==0.28.1",
        "mistralai[realtime]==2.4.5",
        "websockets==15.0.1",
        "webrtcvad-wheels==2.0.14",
    )
    .add_local_python_source("voice")
)
voice_secret = modal.Secret.from_name("stella-voice")
runtime_secret = modal.Secret.from_name("stella-voice-runtime")


@app.function(
    image=image,
    secrets=[voice_secret, runtime_secret],
    min_containers=0,
    scaledown_window=20 * 60,
    timeout=60 * 60,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def gateway():
    from voice.stella_voice.agent import MistralAgent, NebiusAgent
    from voice.stella_voice.gateway_app import create_voice_app
    from voice.stella_voice.security import SupabaseSessionRedeemer
    from voice.stella_voice.services import (
        GatewayServices,
        MistralRealtimeTranscriber,
        MistralSynthesizer,
        VoxtralRealtimeTranscriber,
        VoxtralSynthesizer,
    )

    runtime_mode = os.environ.get("VOICE_RUNTIME_MODE", "mistral_api")
    modal_key = os.environ.get("MODAL_PROXY_KEY")
    modal_secret = os.environ.get("MODAL_PROXY_SECRET")
    stella_url = os.environ["STELLA_APP_URL"]
    if runtime_mode == "mistral_api":
        mistral_key = os.environ["MISTRAL_API_KEY"]
        services = GatewayServices(
            transcriber=MistralRealtimeTranscriber(
                mistral_key,
                model=os.environ.get("MISTRAL_STT_MODEL", "voxtral-mini-transcribe-realtime-2602"),
                target_delay_ms=int(os.environ.get("MISTRAL_STT_TARGET_DELAY_MS", "240")),
            ),
            agent=MistralAgent(
                api_key=mistral_key,
                stella_url=stella_url,
                tool_secret=os.environ["VOICE_TOOL_SECRET"],
                model=os.environ.get("MISTRAL_AGENT_MODEL", "mistral-small-2603"),
            ),
            synthesizer=MistralSynthesizer(
                mistral_key,
                voice_id=os.environ["MISTRAL_TTS_VOICE_ID"],
                model=os.environ.get("MISTRAL_TTS_MODEL", "voxtral-mini-tts-2603"),
            ),
            runtime_mode=runtime_mode,
            provider="mistral_api",
        )
    elif runtime_mode == "self_hosted":
        services = GatewayServices(
            transcriber=VoxtralRealtimeTranscriber(
                os.environ["VOXTRAL_STT_URL"],
                modal_key=modal_key,
                modal_secret=modal_secret,
            ),
            agent=NebiusAgent(
                api_key=os.environ["NEBIUS_API_KEY"],
                stella_url=stella_url,
                tool_secret=os.environ["VOICE_TOOL_SECRET"],
                model=os.environ.get("NEBIUS_VOICE_MODEL", "Qwen/Qwen3-30B-A3B-Instruct-2507"),
            ),
            synthesizer=VoxtralSynthesizer(
                os.environ["VOXTRAL_TTS_URL"],
                modal_key=modal_key,
                modal_secret=modal_secret,
                voice=os.environ.get("VOXTRAL_VOICE", "casual_female"),
            ),
            runtime_mode=runtime_mode,
            provider="modal_nebius",
        )
    else:
        raise ValueError(f"Unsupported VOICE_RUNTIME_MODE: {runtime_mode}")

    session_secret = os.environ["VOICE_SESSION_SECRET"]
    security_mode = os.environ.get("VOICE_SECURITY_MODE", "supabase")
    if security_mode != "supabase":
        raise ValueError(f"Unsupported VOICE_SECURITY_MODE: {security_mode}")
    redeemer = SupabaseSessionRedeemer(
        os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        session_secret,
    )

    return create_voice_app(
        services,
        session_secret=session_secret,
        allowed_origin=stella_url,
        replay_consumer=redeemer.consume,
    )
