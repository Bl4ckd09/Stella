from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

MODEL = "Qwen/Qwen3.6-27B"
LOOKUP_TOOL = {
    "type": "function",
    "function": {
        "name": "lookup_business",
        "description": "Look up a London business and calculate its relief with Stella's deterministic engine.",
        "parameters": {
            "type": "object",
            "properties": {
                "business_name": {"type": "string", "description": "The business name"},
                "postcode": {"type": "string", "description": "The UK premises postcode, when known"},
            },
            "required": ["business_name"],
            "additionalProperties": False,
        },
    },
}

SYSTEM_PROMPT = """You are Stella, a concise voice assistant for London business relief.
Use lookup_business when a user gives a business name or postcode.
Never calculate, change, or estimate money.
Ask one short question when a business name is missing.
The server will speak deterministic tool results without sending them back to you."""


@dataclass(frozen=True)
class AgentReply:
    text: str
    tool: str | None = None
    outcome: str | None = None


class NebiusAgent:
    def __init__(
        self,
        api_key: str,
        stella_url: str,
        tool_secret: str,
        model: str = MODEL,
        base_url: str = "https://api.tokenfactory.nebius.com/v1",
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key or not stella_url or not tool_secret:
            raise ValueError("Nebius and Stella voice settings are required")
        self.api_key = api_key
        self.stella_url = stella_url.rstrip("/")
        self.tool_secret = tool_secret
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def respond(self, text: str, history: list[dict[str, str]]) -> AgentReply:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history[-8:], {"role": "user", "content": text[:500]}]
        response = await self.client.post(
            f"{self.base_url}/chat/completions",
            headers=self.headers,
            json={
                "model": self.model,
                "messages": messages,
                "tools": [LOOKUP_TOOL],
                "tool_choice": "auto",
                "temperature": 0,
                "max_tokens": 180,
            },
        )
        response.raise_for_status()
        message = response.json()["choices"][0]["message"]
        tool_calls = message.get("tool_calls") or []
        if not tool_calls:
            content = str(message.get("content") or "Please tell me your business name and postcode.").strip()
            return AgentReply(content[:800])

        call = tool_calls[0]
        function = call.get("function") or {}
        if function.get("name") != "lookup_business":
            return AgentReply("I cannot use that tool. Please tell me your business name and postcode.", outcome="rejected")
        try:
            arguments = json.loads(function.get("arguments") or "{}")
        except json.JSONDecodeError:
            return AgentReply("I could not read that business name. Please say it again.", tool="lookup_business", outcome="invalid_arguments")
        business_name = str(arguments.get("business_name") or "").strip()[:160]
        postcode = str(arguments.get("postcode") or "").strip()[:12]
        if not business_name and not postcode:
            return AgentReply("Please tell me your business name and postcode.", tool="lookup_business", outcome="missing_arguments")

        lookup = await self.client.post(
            f"{self.stella_url}/api/voice-lookup",
            headers={
                "Content-Type": "application/json",
                "X-Tool-Secret": self.tool_secret,
                "X-Voice-Channel": "browser",
            },
            json={"business_name": business_name, "postcode": postcode},
        )
        lookup.raise_for_status()
        result = lookup.json()
        summary = result.get("spoken_summary")
        if not isinstance(summary, str) or not summary.strip():
            return AgentReply("The lookup did not return a result. Please try again.", tool="lookup_business", outcome="invalid_result")

        # This exact engine-owned string goes to TTS. The LLM never edits it.
        return AgentReply(summary, tool="lookup_business", outcome="found" if result.get("found") else "not_found")

    async def check_contract(self) -> dict[str, Any]:
        models = await self.client.get(f"{self.base_url}/models", headers=self.headers)
        models.raise_for_status()
        model_ids = {item.get("id") for item in models.json().get("data", [])}
        if self.model not in model_ids:
            raise RuntimeError(f"Nebius model is unavailable: {self.model}")

        response = await self.client.post(
            f"{self.base_url}/chat/completions",
            headers=self.headers,
            json={
                "model": self.model,
                "messages": [{"role": "user", "content": "Look up Souls Food UK at E4 6SY."}],
                "tools": [LOOKUP_TOOL],
                "tool_choice": {"type": "function", "function": {"name": "lookup_business"}},
                "temperature": 0,
                "max_tokens": 100,
            },
        )
        response.raise_for_status()
        calls = response.json()["choices"][0]["message"].get("tool_calls") or []
        if not calls or calls[0].get("function", {}).get("name") != "lookup_business":
            raise RuntimeError("Nebius did not return the required lookup tool call")
        arguments = json.loads(calls[0]["function"].get("arguments") or "{}")
        if not arguments.get("business_name"):
            raise RuntimeError("Nebius omitted the required business_name argument")
        return {"model": self.model, "tool": "lookup_business", "status": "ok"}
