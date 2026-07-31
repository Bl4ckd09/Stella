from __future__ import annotations

import argparse
import asyncio
import json
import os

import httpx
from dotenv import load_dotenv

from voice.stella_voice.agent import MistralAgent, NebiusAgent

load_dotenv(".env.local")


async def check_mistral() -> dict[str, object]:
    api_key = os.environ["MISTRAL_API_KEY"]
    agent_model = os.environ.get("MISTRAL_AGENT_MODEL", "mistral-small-2603")
    stt_model = os.environ.get("MISTRAL_STT_MODEL", "voxtral-mini-transcribe-realtime-2602")
    tts_model = os.environ.get("MISTRAL_TTS_MODEL", "voxtral-mini-tts-2603")
    voice_id = os.environ["MISTRAL_TTS_VOICE_ID"]
    agent = MistralAgent(
        api_key=api_key,
        stella_url=os.environ.get("STELLA_APP_URL", "https://example.invalid"),
        tool_secret=os.environ.get("VOICE_TOOL_SECRET", "contract-check-only"),
        model=agent_model,
    )
    agent_result = await agent.check_contract()
    headers = {"authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=20) as client:
        models = await client.get("https://api.mistral.ai/v1/models", headers=headers)
        models.raise_for_status()
        model_ids = {item.get("id") for item in models.json().get("data", [])}
        missing = sorted({stt_model, tts_model} - model_ids)
        if missing:
            raise RuntimeError(f"Mistral voice models are unavailable: {', '.join(missing)}")
        voice = await client.get(f"https://api.mistral.ai/v1/audio/voices/{voice_id}", headers=headers)
        voice.raise_for_status()
    return {
        "runtime_mode": "mistral_api",
        "agent": agent_result,
        "stt_model": stt_model,
        "tts_model": tts_model,
        "voice_id": voice_id,
        "status": "ok",
    }


async def check_self_hosted() -> dict[str, object]:
    agent = NebiusAgent(
        api_key=os.environ["NEBIUS_API_KEY"],
        stella_url=os.environ.get("STELLA_APP_URL", "https://example.invalid"),
        tool_secret=os.environ.get("VOICE_TOOL_SECRET", "contract-check-only"),
        model=os.environ.get("NEBIUS_VOICE_MODEL", "Qwen/Qwen3-30B-A3B-Instruct-2507"),
    )
    return {"runtime_mode": "self_hosted", "agent": await agent.check_contract(), "status": "ok"}


async def check() -> None:
    runtime_mode = os.environ.get("VOICE_RUNTIME_MODE", "mistral_api")
    if runtime_mode == "mistral_api":
        result = await check_mistral()
    elif runtime_mode == "self_hosted":
        result = await check_self_hosted()
    else:
        raise ValueError(f"Unsupported VOICE_RUNTIME_MODE: {runtime_mode}")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check the configured browser voice provider contracts.")
    parser.parse_args()
    asyncio.run(check())
