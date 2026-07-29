from __future__ import annotations

import os

import modal

app = modal.App("stella-voxtral-gateway")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "fastapi==0.116.1",
        "httpx==0.28.1",
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
    from voice.stella_voice.agent import NebiusAgent
    from voice.stella_voice.gateway_app import create_voice_app
    from voice.stella_voice.services import GatewayServices, VoxtralRealtimeTranscriber, VoxtralSynthesizer

    modal_key = os.environ.get("MODAL_PROXY_KEY")
    modal_secret = os.environ.get("MODAL_PROXY_SECRET")
    stella_url = os.environ["STELLA_APP_URL"]
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
    )
    return create_voice_app(
        services,
        session_secret=os.environ["VOICE_SESSION_SECRET"],
        allowed_origin=stella_url,
    )
