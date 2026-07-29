import json

import httpx
import pytest

from voice.stella_voice.agent import LOOKUP_TOOL, NebiusAgent

SUMMARY = "Engine exact summary: £4,990 per year."


@pytest.mark.asyncio
async def test_tool_summary_bypasses_llm_edits() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/chat/completions"):
            return httpx.Response(200, json={
                "choices": [{"message": {"tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "lookup_business",
                        "arguments": json.dumps({"business_name": "Souls Food UK", "postcode": "E4 6SY"}),
                    },
                }]}}],
            })
        assert request.headers["x-voice-channel"] == "browser"
        return httpx.Response(200, json={"found": True, "spoken_summary": SUMMARY})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    agent = NebiusAgent("key", "https://stella.test", "secret", client=client)
    reply = await agent.respond("Souls Food UK, E4 6SY", [])
    assert reply.text == SUMMARY
    assert reply.tool == "lookup_business"
    assert len(requests) == 2


@pytest.mark.asyncio
async def test_model_and_tool_contract() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"data": [{"id": "Qwen/Qwen3.6-27B"}]})
        body = json.loads(request.content)
        assert body["tools"] == [LOOKUP_TOOL]
        return httpx.Response(200, json={
            "choices": [{"message": {"tool_calls": [{
                "function": {"name": "lookup_business", "arguments": '{"business_name":"Souls Food UK","postcode":"E4 6SY"}'},
            }]}}],
        })

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    agent = NebiusAgent("key", "https://stella.test", "secret", client=client)
    assert (await agent.check_contract())["status"] == "ok"
