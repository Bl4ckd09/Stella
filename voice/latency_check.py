from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import math
import struct
import time
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import websockets

from voice.smoke_deployed import session, websocket_endpoint


def load_pcm(path: str) -> list[bytes]:
    with wave.open(path, "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != 16_000:
            raise ValueError("The WAV file must contain mono PCM16 audio at 16 kHz")
        pcm = source.readframes(source.getnframes())
    frame_bytes = 640
    frames = [pcm[index:index + frame_bytes] for index in range(0, len(pcm), frame_bytes)]
    if frames and len(frames[-1]) < frame_bytes:
        frames[-1] += bytes(frame_bytes - len(frames[-1]))
    return frames


async def run_once(app_url: str, frames: list[bytes], expected: str) -> dict[str, Any]:
    voice_session = await session(app_url)
    endpoint = websocket_endpoint(voice_session["gateway_url"], voice_session["token"])
    speech_started_at = None
    endpoint_at = None
    partial_at = None
    first_audio_at = None
    reply = ""

    async with websockets.connect(endpoint, origin=app_url.rstrip("/")) as socket:
        if json.loads(await socket.recv()).get("type") != "ready":
            raise RuntimeError("Gateway did not become ready")

        async def sender() -> None:
            nonlocal speech_started_at
            for frame in frames:
                if speech_started_at is None and any(frame):
                    speech_started_at = time.perf_counter()
                await socket.send(frame)
                await asyncio.sleep(0.02)
            for _ in range(30):
                await socket.send(bytes(640))
                await asyncio.sleep(0.02)

        send_task = asyncio.create_task(sender())
        while True:
            message = await asyncio.wait_for(socket.recv(), timeout=60)
            if isinstance(message, bytes):
                first_audio_at = first_audio_at or time.perf_counter()
                continue
            event = json.loads(message)
            if event.get("type") == "transcript_partial":
                partial_at = partial_at or time.perf_counter()
            elif event.get("type") == "speech_ended":
                endpoint_at = time.perf_counter()
            elif event.get("type") == "reply_text":
                reply = str(event.get("text") or "")
            elif event.get("type") == "error":
                raise RuntimeError(event.get("message") or "Gateway error")
            elif event.get("type") == "turn_end":
                break
        await send_task

    if speech_started_at is None or partial_at is None or endpoint_at is None or first_audio_at is None:
        raise RuntimeError("The gateway omitted a required latency event")
    if expected and expected not in reply:
        raise RuntimeError(f"The reply did not contain the required value: {expected}")
    return {
        "partial_ms": round((partial_at - speech_started_at) * 1_000, 1),
        "first_audio_after_endpoint_ms": round((first_audio_at - endpoint_at) * 1_000, 1),
        "gateway_url": voice_session["gateway_url"],
    }


def interruption_frames(frames: list[bytes], limit: int = 20) -> list[bytes]:
    start = next(
        (
            index
            for index, frame in enumerate(frames)
            if max((abs(sample) for (sample,) in struct.iter_unpack("<h", frame)), default=0) >= 1_000
        ),
        0,
    )
    selected = frames[start:start + limit]
    if not selected:
        raise ValueError("The WAV file does not contain interruption audio")
    return selected


async def interruption_check(app_url: str, text: str, frames: list[bytes]) -> float:
    voice_session = await session(app_url)
    endpoint = websocket_endpoint(voice_session["gateway_url"], voice_session["token"])
    async with websockets.connect(endpoint, origin=app_url.rstrip("/")) as socket:
        if json.loads(await socket.recv()).get("type") != "ready":
            raise RuntimeError("Gateway did not become ready")
        await socket.send(json.dumps({"type": "text_input", "text": text}))
        while True:
            message = await asyncio.wait_for(socket.recv(), timeout=60)
            if isinstance(message, bytes):
                started = time.perf_counter()
                break
            event = json.loads(message)
            if event.get("type") == "error":
                raise RuntimeError(event.get("message") or "Gateway error")

        async def send_interruption() -> None:
            for frame in interruption_frames(frames):
                await socket.send(frame)
                await asyncio.sleep(0.02)

        send_task = asyncio.create_task(send_interruption())
        try:
            while True:
                message = await asyncio.wait_for(socket.recv(), timeout=5)
                if isinstance(message, bytes):
                    continue
                event = json.loads(message)
                if event.get("type") == "playback_cancel":
                    return round((time.perf_counter() - started) * 1_000, 1)
        finally:
            send_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await send_task


def p95(values: list[float]) -> float:
    return sorted(values)[max(0, math.ceil(len(values) * 0.95) - 1)]


async def gateway_health(gateway_url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{gateway_url.rstrip('/')}/health")
        response.raise_for_status()
        return response.json()


async def check(app_url: str, wav_path: str, runs: int, expected: str, output: str | None) -> None:
    if runs < 3:
        raise ValueError("Use at least three warm runs")
    frames = load_pcm(wav_path)
    first_run = await run_once(app_url, frames, expected)
    warm = [await run_once(app_url, frames, expected) for _ in range(runs)]
    interruption_ms = await interruption_check(app_url, "Souls Food UK at E4 6SY", frames)
    partials = [item["partial_ms"] for item in warm]
    replies = [item["first_audio_after_endpoint_ms"] for item in warm]
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed",
        "health": await gateway_health(first_run["gateway_url"]),
        "first_run": {
            "partial_ms": first_run["partial_ms"],
            "first_audio_after_endpoint_ms": first_run["first_audio_after_endpoint_ms"],
        },
        "warm": {
            "runs": runs,
            "partial_ms": partials,
            "partial_p95_ms": round(p95(partials), 1),
            "first_audio_after_endpoint_ms": replies,
            "first_audio_p95_ms": round(p95(replies), 1),
        },
        "interruption_ms": interruption_ms,
        "thresholds_ms": {"partial_p95": 800, "first_audio_p95": 2_000, "interruption": 250},
    }
    if result["warm"]["partial_p95_ms"] >= 800:
        raise RuntimeError("Warm P95 partial transcription exceeded 800 ms")
    if result["warm"]["first_audio_p95_ms"] >= 2_000:
        raise RuntimeError("Warm P95 first audio exceeded two seconds")
    if interruption_ms >= 250:
        raise RuntimeError("Interruption cancellation exceeded 250 ms")
    rendered = json.dumps(result, indent=2)
    if output:
        Path(output).write_text(f"{rendered}\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Measure the deployed Stella voice path.")
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--wav", required=True, help="A mono PCM16 16 kHz WAV query")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--expect", default="£")
    parser.add_argument("--output")
    args = parser.parse_args()
    asyncio.run(check(args.app_url, args.wav, args.runs, args.expect, args.output))
