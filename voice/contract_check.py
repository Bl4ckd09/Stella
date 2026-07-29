from __future__ import annotations

import argparse
import asyncio
import json
import os

from dotenv import load_dotenv

from voice.stella_voice.agent import NebiusAgent

load_dotenv(".env.local")


async def check() -> None:
    agent = NebiusAgent(
        api_key=os.environ["NEBIUS_API_KEY"],
        stella_url=os.environ.get("STELLA_APP_URL", "https://example.invalid"),
        tool_secret=os.environ.get("VOICE_TOOL_SECRET", "contract-check-only"),
        model=os.environ.get("NEBIUS_VOICE_MODEL", "Qwen/Qwen3.6-27B"),
    )
    result = await agent.check_contract()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check the Nebius voice model and tool contract.")
    parser.parse_args()
    asyncio.run(check())
